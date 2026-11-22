import { S } from '../core/state.js'

const ESCAPE_AFTER = 2 // 进房间后校长放弃的秒数（规格 §9）

/**
 * bit 系统：只做条件判定 + 序列推进 + 复位。
 * 数据来自 bits.json，行为写在下面的 runner 里（sequence 的动词表由数据约束）
 */
export class Bits {
  constructor({ data, world, player, chaser, ui, audio, lines, state, bus, input }) {
    this.data = data
    this.world = world
    this.player = player
    this.chaser = chaser
    this.ui = ui
    this.audio = audio
    this.lines = lines
    this.state = state
    this.bus = bus
    this.input = input

    this.stars = 0
    this.enabled = data.filter((b) => b.enabled !== false)
    this.timers = new Map() // bitId → 累计秒
    this.phase = new Map() // bitId → 'idle' | 'chase' | 'question' | 'done'
    this.questionOpen = false
    this.answerWait = 0
    this.fleeTimer = 0 // 玩家躲进房间后，校长放弃的倒计时

    this.chaser.onCapture = () => this.onCaught('phone_walk')
    // 追逐上限 12 秒：超时校长放弃，星保留，bit 复位
    this.chaser.onTimeout = () => {
      this.setPhase('phone_walk', 'idle')
      this.timers.set('phone_walk', 0)
      this.fleeTimer = 0
    }

    this.bus.on('state:enter', ({ state: st }) => {
      if (st === S.WAKEUP) this.armClassSleep()
    })
  }

  get stars() {
    return this._stars
  }

  set stars(v) {
    this._stars = Math.max(0, Math.min(3, v))
    this.ui.setStars(this._stars)
  }

  addStar(n = 1) {
    this.stars = this._stars + n
    this.audio.star()
    return this._stars
  }

  get(id) {
    return this.enabled.find((b) => b.id === id)
  }

  setPhase(id, p) {
    this.phase.set(id, p)
  }

  getPhase(id) {
    return this.phase.get(id) || 'idle'
  }

  update(dt) {
    for (const bit of this.enabled) {
      if (bit.id === 'phone_walk') this.tickPhoneWalk(dt, bit)
      if (bit.id === 'class_sleep') this.tickClassSleep(dt, bit)
    }
  }

  /* ---------------- bit 1：广场玩手机 ---------------- */
  tickPhoneWalk(dt, bit) {
    const phase = this.getPhase(bit.id)

    // 追逐中：进任意房间 2 秒后校长放弃，星保留、bit 复位（逃跑只有这一条路）
    if (phase === 'chase') {
      if (this.player.zone !== 'outdoor') {
        this.fleeTimer += dt
        if (this.fleeTimer >= ESCAPE_AFTER) {
          this.chaser.abandon()
          this.fleeTimer = 0
          this.timers.set(bit.id, 0)
          this.setPhase(bit.id, 'idle')
        }
      } else {
        this.fleeTimer = 0
      }
      return
    }

    if (phase !== 'idle') return

    const ok = this.state.is(S.PLAY) && this.player.zone === 'outdoor' && this.player.phoneUp && this.player.moving
    if (!ok) {
      this.timers.set(bit.id, 0)
      return
    }

    const t = (this.timers.get(bit.id) || 0) + dt
    this.timers.set(bit.id, t)
    const need = bit.trigger.all.find((c) => 'seconds' in c)?.seconds ?? 4
    if (t >= need) this.firePhoneWalk(bit)
  }

  firePhoneWalk(bit) {
    if (this.getPhase(bit.id) === 'chase') return
    this.setPhase(bit.id, 'chase')
    this.timers.set(bit.id, 0)
    this.fleeTimer = 0

    const n = this.addStar(bit.onTrigger.stars || 1)
    // 星满 3：任何一次违规直接被带走，不再给追逐机会
    if (n >= 3) {
      this.setPhase(bit.id, 'done')
      this.bus.emit('death', { line: bit.outcome.line, reason: 'stars' })
      return
    }

    this.ui.subtitle(this.lines.PHONE_WARN, 1.4)
    this.audio.alarm()

    // PATCH-v2.1：玩家前方 10m 的 16 点采样，排除建筑和越界
    const from = this.chaser.spawnAhead(this.player, 10)
    this.chaser.spawn(bit.actor.type, 'outdoor', from)
    this.ui.setZone('Plaza')
  }

  /* ---------------- bit 2：教室睡觉被点名 ---------------- */
  armClassSleep() {
    this.timers.set('class_sleep', 0)
    if (this.getPhase('class_sleep') === 'done') this.setPhase('class_sleep', 'idle')
  }

  tickClassSleep(dt, bit) {
    const phase = this.getPhase(bit.id)
    if (phase === 'done') return

    if (this.questionOpen) {
      // 键盘/小键盘每帧都读：pressed 每帧结束会清空，延迟读会吞掉按得快的人
      this.readAnswer()
      return
    }

    if (!(this.player.zone === 'classroom' && this.state.is(S.PLAY, S.WAKEUP))) {
      this.timers.set(bit.id, 0)
      return
    }

    const t = (this.timers.get(bit.id) || 0) + dt
    this.timers.set(bit.id, t)
    if (t >= (bit.trigger.seconds || 3)) this.askQuestion(bit)
  }

  askQuestion(bit) {
    this.timers.set(bit.id, 0)
    this.setPhase(bit.id, 'question')
    this.ui.subtitle(this.lines.CLASS_WAKE, 1.6)
    this.questionOpen = true
    this.answerWait = 0
    this.ui.showQuestion(true)
  }

  readAnswer() {
    const keys = [
      [['Digit1', 'Numpad1'], 1],
      [['Digit2', 'Numpad2'], 2],
      [['Digit3', 'Numpad3'], 3]
    ]
    const hit = keys.find(([codes]) => codes.some((c) => this.input.once(c)))
    if (!hit) return
    this.answer(hit[1])
  }

  answer(choice) {
    const bit = this.get('class_sleep')
    const correct = 3 // C：家长不要过度干预孩子的大学生活
    this.questionOpen = false
    this.ui.showQuestion(false)

    if (choice === correct) {
      this.ui.subtitle(this.lines.CLASS_ANSWER_OK, 1.6)
      this.setPhase(bit.id, 'done')
      this.audio.confirm()
      return
    }

    this.addStar(bit.outcome.starsPerWrong || 1)
    this.ui.subtitle(this.lines.CLASS_WRONG, 1.2)
    // 一错直接除名：不再回 idle 循环（bits.json threshold = 1）
    this.setPhase(bit.id, 'done')
    this.bus.emit('death', { line: bit.outcome.line, reason: 'class' })
  }

  /* ---------------- 被抓 ---------------- */
  onCaught(bitId) {
    const bit = this.get(bitId)
    this.setPhase(bitId, 'done')
    this.bus.emit('death', { line: bit?.outcome?.line || 'PHONE_CAUGHT', reason: 'chase' })
  }

  /** 进门 0.5s 演出结束、已经传送进房间：立刻结束追逐，星保留 */
  finishEscape() {
    if (this.getPhase('phone_walk') !== 'chase') return
    this.chaser.abandon()
    this.fleeTimer = 0
    this.timers.set('phone_walk', 0)
    this.setPhase('phone_walk', 'idle')
  }

  /* ---------------- 复位 / 演示直跳 ---------------- */
  // keepStars 默认 true：星跨 bit 保留，只有死亡和手动 R 才清零
  reset({ keepStars = true } = {}) {
    if (!keepStars) this.stars = 0
    this.fleeTimer = 0
    this.timers.clear()
    this.phase.clear()
    this.questionOpen = false
    this.ui.showQuestion(false)
    this.chaser.despawn()
  }

  // F 键：演示用，直接触发当前区域的 P0 bit
  force(id) {
    const bit = this.get(id)
    if (!bit) return
    if (bit.id === 'phone_walk') {
      if (this.player.zone !== 'outdoor') return this.ui.subtitle({ en: 'Force: go to the plaza first.', zh: '先到广场再按 F。' }, 1.4)
      this.setPhase(bit.id, 'idle')
      this.firePhoneWalk(bit)
    }
    if (bit.id === 'class_sleep') {
      if (this.player.zone !== 'classroom') return this.ui.subtitle({ en: 'Force: go to the classroom first.', zh: '先到教室再按 F。' }, 1.4)
      this.setPhase(bit.id, 'idle')
      this.askQuestion(bit)
    }
  }
}
