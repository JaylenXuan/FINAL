import * as THREE from 'three'
import { createLoop } from './core/loop.js'
import { EventBus } from './core/eventbus.js'
import { GameState, S } from './core/state.js'
import { Director } from './core/director.js'
import { buildWorld } from './world/builder.js'
import { Input } from './player/input.js'
import { Player } from './player/player.js'
import { CameraRig } from './player/camera.js'
import { Chaser } from './npc/chaser.js'
import { Bits } from './bits/bits.js'
import { HUD } from './ui/hud.js'
import { Blackout } from './ui/blackout.js'
import { Audio } from './audio/audio.js'

const SKY = 0x8f9aa8

async function loadJSON(path) {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`加载失败 ${path}: ${res.status}`)
  return res.json()
}

async function main() {
  const [worldData, bitsData, lines] = await Promise.all([
    loadJSON('/data/world.json'),
    loadJSON('/data/bits.json'),
    loadJSON('/data/lines.json')
  ])

  /* ---------- 渲染基础 ---------- */
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  document.getElementById('app').appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(SKY)

  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 400)

  // 黄昏：方向光压长影子，半球光补室内外反差
  const hemi = new THREE.HemisphereLight(0xcfdcf0, 0x6b6357, 1.1)
  scene.add(hemi)
  // 室内靠方向光进不来（天花板挡住），先补一盏环境光，正式布光归 A
  scene.add(new THREE.AmbientLight(0xffffff, 0.45))
  const sun = new THREE.DirectionalLight(0xffcf9e, 2.4)
  sun.position.set(18, 24, 12)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  const s = 26
  sun.shadow.camera.left = -s
  sun.shadow.camera.right = s
  sun.shadow.camera.top = s
  sun.shadow.camera.bottom = -s
  sun.shadow.camera.far = 90
  sun.shadow.bias = -0.0007
  scene.add(sun)

  /* ---------- 世界 / 状态 / 系统 ---------- */
  const bus = new EventBus()
  const world = buildWorld(worldData, scene)
  const state = new GameState(bus)
  const input = new Input()
  const ui = new HUD()
  const blackout = new Blackout()
  const audio = new Audio()
  const player = new Player(scene, world)
  const rig = new CameraRig(camera, world)
  const chaser = new Chaser(scene, world)
  const director = new Director({ bus, ui: blackout, audio, camera: rig, lines })
  const bits = new Bits({ data: bitsData, world, player, chaser, ui, audio, lines, state, bus, input })

  let lastAnchorId = 'a_classroom'

  function applyZoneFx(zoneId) {
    // 房间摆在 x=100 之外，室外雾会把室内一起吃掉，所以按区域开关
    scene.fog = zoneId === 'outdoor' ? new THREE.Fog(SKY, 26, 78) : null
  }

  function goTo(anchorId, withFade = true) {
    const a = world.anchors.get(anchorId)
    if (!a) return
    player.teleport(anchorId)
    rig.setZone(player.zone)
    applyZoneFx(player.zone)
    ui.setZone(a.label)
    if (withFade) director.play('respawn')
  }

  function tryInteract() {
    const it = world.interactables.find((x) => {
      if (x.zone !== player.zone) return false
      const dx = x.pos.x - player.pos.x
      const dz = x.pos.z - player.pos.z
      return dx * dx + dz * dz < x.radius * x.radius
    })
    if (!it) return
    audio.select()
    goTo(it.anchorId)
  }

  /* ---------- 死亡 → 选点 → 醒来 ---------- */
  bus.on('death', () => {
    if (!state.is(S.PLAY)) return
    bits.stars = 0
    bits.questionOpen = false
    ui.showQuestion(false)
    state.set(S.CAUGHT)
    director.play('caught')
  })

  bus.on('director:done', ({ name }) => {
    if (name === 'caught') {
      state.set(S.ANCHOR)
      blackout.showPicker(world.anchorList, lastAnchorId, (anchor) => {
        audio.confirm()
        lastAnchorId = anchor.id
        state.set(S.WAKEUP)
        player.teleport(anchor.id)
        rig.setZone(anchor.zone)
        applyZoneFx(anchor.zone)
        ui.setZone(anchor.label)
        chaser.despawn()
        director.play('wake_up', { full: anchor.id === 'a_classroom' })
      })
      return
    }
    if (name.startsWith('wake_up')) {
      state.set(S.PLAY)
      bits.reset() // 清冷却/相位，星已在死亡时归零
      ui.setPhone(player.phoneUp)
    }
  })

  /* ---------- 开场：睡在教室，被叫醒 ---------- */
  // 演示备用入口：?anchor=a_plaza 直接落位不开场，?bit=phone_walk 落地后自动触发
  const params = new URLSearchParams(location.search)
  const startAnchor = params.get('anchor')
  const autoBit = params.get('bit')
  const skipOpening = !!startAnchor || !!params.get('screen')

  if (skipOpening) {
    const a = world.anchors.get(startAnchor) || world.anchors.get('a_plaza')
    player.teleport(a.id)
    rig.setZone(a.zone)
    applyZoneFx(a.zone)
    ui.setZone(a.label)
    state.set(S.PLAY)
    blackout.clearBlack(0.4)
  } else {
    player.teleport('a_classroom')
    rig.setZone('classroom')
    applyZoneFx('classroom')
    ui.setZone('Classroom')
    state.set(S.PLAY)
    state.set(S.WAKEUP)
    director.play('wake_up', { full: true })
  }

  if (autoBit) setTimeout(() => bits.force(autoBit), 1600)

  // 布局预览 / 演示兜底：?screen=anchors 直接看选点界面，?spawn=1 在面前放一个校长
  if (params.get('screen') === 'anchors') {
    blackout.showPicker(world.anchorList, 'a_classroom', () => {})
  }
  if (params.get('screen') === 'question') {
    ui.showQuestion(true)
  }
  if (params.get('spawn') === '1') {
    chaser.spawn('principal', 'outdoor', new THREE.Vector3(0, 0, -2))
  }

  /* ---------- 每帧逻辑 ---------- */
  const DIGITS = ['Digit1', 'Digit2', 'Digit3', 'Digit4']

  function readKeys() {
    if (state.is(S.PLAY)) {
      // 答题面板开着的时候，1-3 属于选项，不是传送
      if (bits.questionOpen) return

      if (input.once('Tab')) {
        player.setPhone(!player.phoneUp)
        ui.setPhone(player.phoneUp)
        audio.select()
      }
      if (input.once('KeyE')) tryInteract()
      if (input.once('KeyF')) bits.force(player.zone === 'classroom' ? 'class_sleep' : 'phone_walk')
      if (input.once('KeyR')) {
        bits.reset({ keepStars: false })
        goTo('a_plaza')
      }
      const i = DIGITS.findIndex((c) => input.once(c))
      if (i >= 0 && world.anchorList[i]) {
        audio.select()
        goTo(world.anchorList[i].id)
      }
    }

    if (state.is(S.ANCHOR)) {
      const i = DIGITS.findIndex((c) => input.once(c))
      if (i >= 0 && i < world.anchorList.length) {
        blackout.pick(i)
        audio.select()
      }
      if (input.once('ArrowUp')) blackout.move(-1)
      if (input.once('ArrowDown')) blackout.move(1)
      if (input.once('Enter')) blackout.confirm()
    }
  }

  const loop = createLoop({
    step(dt) {
      state.update(dt)
      readKeys()

      if (state.is(S.PLAY)) {
        player.update(dt, input)
        bits.update(dt)
        chaser.update(dt, player.pos, player.zone)
      } else if (state.is(S.WAKEUP)) {
        // 醒来过程中允许小幅挪动，但不出手指令
        bits.update(dt)
      }

      director.update(dt)
      ui.update(dt)
      input.endFrame()
    },
    render(alpha, realDt) {
      player.sync(alpha)
      rig.update(realDt, player.pos)
      renderer.render(scene, camera)
    }
  })

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
  })

  /* ---------- 演示用调试钩子（控制台可直接调） ---------- */
  window.__campus = { player, bits, chaser, world, state, director, rig }

  renderer.render(scene, camera)
  const bootEl = document.getElementById('boot')
  bootEl.classList.add('hide')
  setTimeout(() => bootEl.remove(), 600)
  loop.start()
}

main().catch((err) => {
  console.error(err)
  const boot = document.getElementById('boot')
  if (boot) boot.textContent = 'LOAD FAILED — 看控制台'
})
