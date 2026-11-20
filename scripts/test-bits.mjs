// 无头自测：不依赖 three.js / 浏览器，直接跑 bit 判定与状态机
// 用法：node scripts/test-bits.mjs
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { EventBus } from '../src/core/eventbus.js'
import { GameState, S } from '../src/core/state.js'
import { Bits } from '../src/bits/bits.js'

const data = JSON.parse(readFileSync(new URL('../data/bits.json', import.meta.url)))
const lines = JSON.parse(readFileSync(new URL('../data/lines.json', import.meta.url)))

function makeEnv({ zone = 'outdoor' } = {}) {
  const bus = new EventBus()
  const state = new GameState(bus)
  const log = { deaths: [], stars: [], subs: [], question: false, spawned: [], abandoned: 0 }
  const pressed = new Set()

  const player = { zone, phoneUp: false, moving: false, pos: { x: 0, z: 6 } }
  const world = { zones: { outdoor: { bounds: { min: { x: -10, z: -10 }, max: { x: 10, z: 10 } } } }, anchors: new Map() }
  const chaser = {
    onCapture: null,
    spawn: (type, z, from) => log.spawned.push({ type, z, from }),
    farEnd: () => ({ x: -10, z: -10 }),
    despawn: () => {},
    abandon: () => { log.abandoned++ }
  }
  const ui = {
    setStars: (n) => log.stars.push(n),
    subtitle: (line) => log.subs.push(line),
    showQuestion: (on) => (log.question = on),
    setZone: () => {}
  }
  const audio = { star(){}, alarm(){}, select(){}, confirm(){}, tinnitus(){}, thud(){} }
  const input = { once: (code) => pressed.has(code) }

  const bits = new Bits({ data, world, player, chaser, ui, audio, lines, state, bus, input })
  bus.on('death', (p) => log.deaths.push(p))

  const step = (seconds) => {
    const dt = 1 / 60
    for (let t = 0; t < seconds; t += dt) {
      state.update(dt)
      bits.update(dt)
    }
  }

  state.set(S.PLAY)
  return { bus, state, bits, player, chaser, log, step, press: (c) => pressed.add(c), release: () => pressed.clear() }
}

/* 1. phone_walk：举手机 + 走动 4s 触发，星 +1，校长生成 */
{
  const env = makeEnv()
  env.player.phoneUp = true
  env.player.moving = true
  env.step(3.0)
  assert.equal(env.log.spawned.length, 0, '4 秒前不该触发')
  env.step(1.2)
  assert.equal(env.log.spawned.length, 1, '4 秒后应该生成校长')
  assert.deepEqual(env.log.deaths, [], '触发不等于死亡')
  assert.equal(env.log.stars.at(-1), 1, '触发立刻 +1 星')
  assert.equal(env.bits.getPhase('phone_walk'), 'chase')
  console.log('✓ phone_walk 计时 / 加星 / 生成追逐者')

  // 走动中断要清零
  const env2 = makeEnv()
  env2.player.phoneUp = true
  env2.player.moving = true
  env2.step(2)
  env2.player.moving = false
  env2.step(1)
  env2.player.moving = true
  env2.step(2)
  assert.equal(env2.log.spawned.length, 0, '中断后应重新计时')
  console.log('✓ phone_walk 中断清零')
}

/* 2. 被抓 → death 事件 */
{
  const env = makeEnv()
  env.player.phoneUp = true
  env.player.moving = true
  env.step(4.2)
  env.chaser.onCapture({ type: 'principal' })
  assert.equal(env.log.deaths.length, 1)
  assert.equal(env.log.deaths[0].line, 'PHONE_CAUGHT')
  assert.equal(env.bits.getPhase('phone_walk'), 'done')
  console.log('✓ 被抓发出 death(PHONE_CAUGHT)')
}

/* 3. class_sleep：进教室醒来，3 秒后被点名 */
{
  const env = makeEnv({ zone: 'classroom' })
  env.state.set(S.WAKEUP)
  env.step(3.1)
  assert.equal(env.log.question, true, '3 秒后应弹出答题')
  assert.ok(env.bits.questionOpen)
  console.log('✓ class_sleep 3 秒后点名')
}

/* 4. 答错一次：+1 星 → 直接死亡 */
{
  const env = makeEnv({ zone: 'classroom' })
  env.state.set(S.WAKEUP)
  env.step(3.1)

  const answer = (code) => {
    env.press(code)
    env.step(0.4)
    env.release()
    env.step(0.1)
  }

  answer('Digit2')
  assert.equal(env.log.deaths.length, 1, '答错应直接死亡')
  assert.equal(env.log.deaths[0].line, 'CLASS_KICKED')
  console.log('✓ class_sleep 答错一次 → 直接逐出')
}

/* 5. 答对不扣星，bit 结束 */
{
  const env = makeEnv({ zone: 'classroom' })
  env.state.set(S.WAKEUP)
  env.step(3.1)
  env.press('Digit3')
  env.step(0.4)
  assert.equal(env.bits.stars, 0)
  assert.equal(env.bits.getPhase('class_sleep'), 'done')
  assert.equal(env.log.question, false)
  console.log('✓ class_sleep 答对不扣星')
}

/* 6. 逃跑：进房间 2 秒后校长放弃，星保留、bit 复位 */
{
  const env = makeEnv()
  env.player.phoneUp = true
  env.player.moving = true
  env.step(4.2)
  assert.equal(env.log.stars.at(-1), 1)

  env.player.zone = 'classroom'
  env.step(1.5)
  assert.equal(env.log.abandoned, 0, '2 秒前不该放弃')
  env.step(0.8)
  assert.equal(env.log.abandoned, 1, '2 秒后校长应放弃')
  assert.equal(env.bits.stars, 1, '逃跑不扣星')
  assert.equal(env.bits.getPhase('phone_walk'), 'idle', 'bit 应复位，允许再次触发')
  console.log('✓ 进门逃跑 → 校长放弃、星保留、bit 复位')
}

/* 7. 星跨 bit 保留；满 3 星再违规直接被带走 */
{
  const env = makeEnv()
  for (let i = 0; i < 3; i++) {
    env.player.phoneUp = true
    env.player.moving = true
    env.step(4.2)
    if (i < 2) {
      env.player.zone = 'classroom'
      env.step(2.2)
      env.player.zone = 'outdoor'
      env.step(0.1)
    }
  }
  assert.equal(env.bits.stars, 3, '三次违规应累计 3 星')
  assert.equal(env.log.deaths.length, 1, '满 3 星应直接被抓走')
  assert.equal(env.log.deaths[0].reason, 'stars')
  console.log('✓ 3 星时任何一次违规直接带走')
}

/* 8. reset() 默认不清星（只有死亡和手动 R 才清） */
{
  const env = makeEnv()
  env.player.phoneUp = true
  env.player.moving = true
  env.step(4.2)
  env.bits.reset()
  assert.equal(env.bits.stars, 1, 'reset() 默认保留星')
  env.bits.reset({ keepStars: false })
  assert.equal(env.bits.stars, 0, '显式清星才归零')
  console.log('✓ reset 默认保星，R 键显式清星')
}

/* 9. 状态机拒绝非法跳转 */
{
  const env = makeEnv()
  env.state.set(S.CAUGHT) // Play → Caught 合法
  assert.equal(env.state.current, S.CAUGHT)
  env.state.set(S.WAKEUP) // Caught → WakeUp 非法
  assert.equal(env.state.current, S.CAUGHT, '非法跳转应被拒绝')
  console.log('✓ 状态机拦截非法跳转')
}

console.log('\n全部通过')
