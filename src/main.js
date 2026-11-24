import * as THREE from 'three'
import { createLoop } from './core/loop.js'
import { EventBus } from './core/eventbus.js'
import { GameState, S } from './core/state.js'
import { Director } from './core/director.js'
import { buildWorld } from './world/builder.js'
import { buildCampus } from './campus/world/campus.js'
import { buildCampusOSM } from './campus/world/campus-osm.js'
import { createSky } from './campus/world/sky.js'
import { Input } from './campus/player/input.js'
import { Player } from './campus/player/player.js'
import { CameraRig } from './campus/player/camera.js'
import { heightAt } from './campus/world/terrain.js'
import { Chaser } from './npc/chaser.js'
import { Bits } from './bits/bits.js'
import { HUD } from './ui/hud.js'
import { Blackout } from './ui/blackout.js'
import { Audio } from './audio/audio.js'
import { createDust } from './campus/fx/dust.js'
import { createMinimap } from './ui/minimap.js'
import { Classmates } from './npc/classmates.js'

const SKY = 0xd8ddd8 // 雾色，贴近天空地平线的暖灰

async function loadJSON(path) {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`加载失败 ${path}: ${res.status}`)
  return res.json()
}

async function main() {
  const params = new URLSearchParams(location.search)
  // 合并版只有「全校园 + 定制教室」一个世界；保留 useCampus 变量给光照/阴影分支
  const useCampus = true

  const [worldData, bitsData, lines] = await Promise.all([
    loadJSON('/data/world.json'),
    loadJSON('/data/bits.json'),
    loadJSON('/data/lines.json')
  ])
  // 室外全校园 + 室内一间「真教室」：教室坐标摆在远处，和校园互不干扰
  let campusData = await loadJSON('/data/campus-osm.json').catch(() => null)
  const campusFallback = campusData ? null : await loadJSON('/data/campus.json')
  const useCampusOsm = !!campusData

  // 题干/选项唯一内容源是 data/lines.json
  {
    const q = document.querySelector('#classq .q')
    if (q && lines.CLASS_Q?.en) q.textContent = lines.CLASS_Q.en
    document.querySelectorAll('#classq .opt span').forEach((el, i) => {
      const copy = lines[`CLASS_OPT_${i + 1}`]
      if (copy?.en) el.textContent = copy.en
    })
  }

  /* ---------- 渲染基础 ---------- */
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  // 静态场景不需要每帧重画阴影：玩家移动超过 4m 再刷新
  renderer.shadowMap.autoUpdate = false
  renderer.shadowMap.needsUpdate = true
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.04
  const appEl = document.getElementById('app')
  appEl.appendChild(renderer.domElement)

  // 轻微暗角 + 顶部暖调，压住画面四角，观感更像相机拍的
  const vignette = document.createElement('div')
  vignette.style.cssText =
    'position:fixed;inset:0;pointer-events:none;' +
    'background:radial-gradient(ellipse at 50% 46%, rgba(0,0,0,0) 46%, rgba(10,12,18,0.26) 100%),' +
    'linear-gradient(to bottom, rgba(255,206,150,0.07), rgba(0,0,0,0) 26%);'
  appEl.appendChild(vignette)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(SKY)

  // 天空穹顶 + 云 + 由穹顶烘出的环境贴图：玻璃、水面、金属都能反射天光
  const sky = createSky(scene, renderer)
  if (sky.envMap) {
    scene.environment = sky.envMap
    scene.environmentIntensity = 0.65
  }

  const camera = new THREE.PerspectiveCamera(useCampus ? 58 : 50, window.innerWidth / window.innerHeight, 0.1, 4200)

  // 午后偏暖的阳光：方向与天空里的太阳一致，影子才会跟光晕对得上
  const hemi = new THREE.HemisphereLight(0xc9ddf2, 0x7a7a66, 0.55)
  scene.add(hemi)
  // 室内靠方向光进不来（天花板挡住），补一盏弱环境光，正式布光归 A
  scene.add(new THREE.AmbientLight(0xffffff, 0.22))
  const sun = new THREE.DirectionalLight(0xffe0b6, 2.7)
  const SUN_DIST = useCampus ? 260 : 40
  const SUN_OFFSET = sky.sunDir.clone().multiplyScalar(SUN_DIST)
  sun.position.copy(SUN_OFFSET)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  // 校园模式：阴影窗跟着玩家走（±200m，约 0.2m/texel），
  // 否则 1.7km 的校区要么糊成一片，要么一大片落在阴影视锥外被当成全黑
  const s = useCampus ? 200 : 26
  sun.shadow.camera.left = -s
  sun.shadow.camera.right = s
  sun.shadow.camera.top = s
  sun.shadow.camera.bottom = -s
  sun.shadow.camera.far = useCampus ? 900 : 120
  sun.shadow.bias = useCampus ? -0.0004 : -0.0007
  sun.shadow.normalBias = 0.03
  // 改过 left/right/top/bottom 必须重算投影矩阵，否则阴影视锥还是默认的 ±5m
  sun.shadow.camera.updateProjectionMatrix()
  sun.target.position.set(0, 0, 0)
  scene.add(sun)
  scene.add(sun.target)

  /* ---------- 世界 / 状态 / 系统 ---------- */
  const bus = new EventBus()
  let world
  let campusSource = ''
  let classroomZone = 'classroom'
  let classroomData = null
  let classEntrance = null

  if (useCampusOsm) {
    world = buildCampusOSM(campusData, scene)
    campusSource = 'osm'
  } else {
    world = buildCampus(campusFallback, scene)
    campusSource = 'blocks'
  }

  // 定制教学楼B：放在 a_teach 标志旁的草地上，玩家从外面走到门口按 E 进教室
  const teachPlaza = world.anchors.get('a_teach')
  const siteOffset = (params.get('classsite') || '0,20').split(',').map(Number)
  const siteX = (teachPlaza?.pos.x ?? 0) + (Number.isFinite(siteOffset[0]) ? siteOffset[0] : 0)
  const siteZ = (teachPlaza?.pos.z ?? 0) + (Number.isFinite(siteOffset[1]) ? siteOffset[1] : -20)
  // 地面有坡：取建筑占地范围内最高点再抬高，避免草地从教室里穿出来
  let terrainMax = -Infinity
  for (const dx of [-6, -3, 0, 3, 6]) {
    for (const dz of [-6, -3, 0, 3, 6]) {
      terrainMax = Math.max(terrainMax, heightAt(siteX + dx, siteZ + dz))
    }
  }
  const siteY = terrainMax + 0.15
  const baseRoom = (worldData.rooms || []).find((r) => r.id === 'classroom')

  if (baseRoom) {
    const W = 12.4 // 外立面宽
    const D = 10.4 // 外立面进深
    classroomData = {
      rooms: [
        {
          ...baseRoom,
          origin: [siteX, siteY, siteZ],
          exit: 'a_out_classroom',
          anchors: [{ id: 'a_classroom', pos: [siteX, siteY, siteZ + 2], yaw: 0 }]
        }
      ]
    }
    const classWorld = buildWorld(classroomData, scene, { outdoor: false })
    world.zones[classroomZone] = classWorld.zones.classroom
    world.zones[classroomZone].floorY = siteY
    world.roomCameras[classroomZone] = classWorld.roomCameras.classroom
    for (const [id, a] of classWorld.anchors) world.anchors.set(id, a)
    for (const it of classWorld.interactables) world.interactables.push(it)

    // 教室里补暖光（楼顶挡住太阳）
    for (const [lx, lz] of [
      [siteX, siteZ],
      [siteX + 2.8, siteZ - 2.2]
    ]) {
      const lamp = new THREE.PointLight(0xffe7c8, 26, 26, 2)
      lamp.position.set(lx, siteY + 3.5, lz)
      scene.add(lamp)
    }

    // 讲台旁老师剪影
    const teacher = new THREE.Group()
    const teacherBody = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.24, 0.92, 6, 10),
      new THREE.MeshStandardMaterial({ color: 0x2f3540, roughness: 0.9 })
    )
    teacherBody.position.y = 0.78
    teacherBody.castShadow = true
    teacher.add(teacherBody)
    const teacherHead = new THREE.Mesh(
      new THREE.SphereGeometry(0.17, 14, 12),
      new THREE.MeshStandardMaterial({ color: 0xd7b48f, roughness: 0.9 })
    )
    teacherHead.position.y = 1.52
    teacherHead.castShadow = true
    teacher.add(teacherHead)
    teacher.position.set(siteX, siteY, siteZ - 2.8)
    scene.add(teacher)

    /* ---------- 室外教学楼B外立面 ---------- */
    const stone = new THREE.MeshStandardMaterial({ color: 0xe7e1d4, roughness: 0.92 })
    const trim = new THREE.MeshStandardMaterial({ color: 0x3e4650, roughness: 0.65 })
    const glass = new THREE.MeshStandardMaterial({
      color: 0x54697a,
      roughness: 0.18,
      metalness: 0.4,
      transparent: true,
      opacity: 0.72
    })
    const paving = new THREE.MeshStandardMaterial({ color: 0xb8b0a2, roughness: 0.96 })

    // 屋顶 + 女儿墙
    const roof = new THREE.Mesh(new THREE.BoxGeometry(W, 0.4, D), trim)
    roof.position.set(siteX, siteY + 4.25, siteZ)
    roof.castShadow = true
    roof.receiveShadow = true
    scene.add(roof)
    const parapet = new THREE.Mesh(new THREE.BoxGeometry(W, 0.5, 0.28), stone)
    parapet.position.set(siteX, siteY + 4.7, siteZ + D / 2 - 0.14)
    scene.add(parapet)

    // 正面外墙：中间留 2.9m 门洞
    const fh = 4.5
    const opening = 2.9
    const sideW = (W - opening) / 2
    for (const sx of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(sideW, fh, 0.32), stone)
      side.position.set(siteX + sx * (opening / 2 + sideW / 2), siteY + fh / 2, siteZ + D / 2 - 0.1)
      side.castShadow = true
      side.receiveShadow = true
      scene.add(side)
      // 外墙窗带
      const win = new THREE.Mesh(new THREE.PlaneGeometry(sideW * 0.72, 1.55), glass)
      win.position.set(siteX + sx * (opening / 2 + sideW / 2), siteY + 2.35, siteZ + D / 2 + 0.08)
      scene.add(win)
    }
    const header = new THREE.Mesh(new THREE.BoxGeometry(W, fh - 2.95, 0.32), stone)
    header.position.set(siteX, siteY + 2.95 + (fh - 2.95) / 2, siteZ + D / 2 - 0.1)
    header.castShadow = true
    scene.add(header)

    // 玻璃门 + 门框
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.85, 0.34), trim)
      post.position.set(siteX + sx * 1.18, siteY + 1.425, siteZ + D / 2 + 0.12)
      scene.add(post)
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(2.52, 0.2, 0.34), trim)
    lintel.position.set(siteX, siteY + 2.96, siteZ + D / 2 + 0.12)
    scene.add(lintel)
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(2.06, 2.56, 0.06), glass)
    leaf.position.set(siteX, siteY + 1.32, siteZ + D / 2 + 0.16)
    scene.add(leaf)
    // 门把手
    const knob = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.06), trim)
    knob.position.set(siteX + 0.78, siteY + 1.15, siteZ + D / 2 + 0.22)
    scene.add(knob)

    // 雨棚
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.16, 1.8), trim)
    canopy.position.set(siteX, siteY + 3.25, siteZ + D / 2 + 0.9)
    canopy.castShadow = true
    scene.add(canopy)

    // 门牌
    const cv = document.createElement('canvas')
    cv.width = 640
    cv.height = 160
    const ctx = cv.getContext('2d')
    ctx.fillStyle = '#0e1319'
    ctx.fillRect(0, 0, cv.width, cv.height)
    ctx.strokeStyle = 'rgba(255,206,120,.75)'
    ctx.lineWidth = 8
    ctx.strokeRect(4, 4, cv.width - 8, cv.height - 8)
    ctx.fillStyle = '#f4f1ea'
    ctx.font = '700 72px "Microsoft YaHei", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('教学楼 B', cv.width / 2, 66)
    ctx.font = '400 30px "Helvetica Neue", Arial, sans-serif'
    ctx.fillStyle = 'rgba(255,206,120,.9)'
    ctx.fillText('TEACHING B', cv.width / 2, 126)
    const signTex = new THREE.CanvasTexture(cv)
    signTex.colorSpace = THREE.SRGBColorSpace
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(2.0, 0.5),
      new THREE.MeshBasicMaterial({ map: signTex, transparent: true })
    )
    sign.position.set(siteX, siteY + 3.55, siteZ + D / 2 + 0.28)
    scene.add(sign)

    // 门前铺装
    const path = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 6.4), paving)
    path.rotation.x = -Math.PI / 2
    path.position.set(siteX, siteY + 0.015, siteZ + D / 2 + 3.8)
    path.receiveShadow = true
    scene.add(path)

    // 门口交互点
    world.interactables.push({
      zone: 'outdoor',
      pos: new THREE.Vector3(siteX, 0, siteZ + D / 2 + 1.2),
      radius: 4.5,
      anchorId: 'a_classroom',
      label: '进入教学楼B'
    })

    // 出生点在门前 6.5m
    classEntrance = {
      id: 'a_teach_entrance',
      label: '教学楼B 门口',
      zone: 'outdoor',
      pos: new THREE.Vector3(siteX, 0, siteZ + D / 2 + 6.5),
      yaw: 0
    }
    world.anchors.set(classEntrance.id, classEntrance)
    world.anchors.set('a_out_classroom', {
      id: 'a_out_classroom',
      label: '教学楼B 门口',
      zone: 'outdoor',
      pos: classEntrance.pos.clone(),
      yaw: 0
    })
  }

  // 供 16 点刷点排除建筑
  world.buildings = (campusData?.buildings || []).map((b) => {
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (const [x, z] of b.polygon || []) {
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minZ = Math.min(minZ, z)
      maxZ = Math.max(maxZ, z)
    }
    return {
      min: new THREE.Vector3(minX, 0, minZ),
      max: new THREE.Vector3(maxX, 0, maxZ)
    }
  })

  // 死亡选点/调试传送的四个锚点；教室用定制教室，其余用校园里最好找的点
  const pick = (id) => world.anchors.get(id)
  const deathAnchors = ['a_teach', 'a_campus', 'a_library', 'a_classroom']
    .map((id) => pick(id))
    .filter(Boolean)
  if (deathAnchors.length) world.anchorList = deathAnchors
  // 地图显示坐标：教室在 x=5000，死亡地图上要落到教学楼B门口
  const anchorDisplay = new Map()
  const entrancePoint = classEntrance?.pos || teachPlaza?.pos
  if (entrancePoint) anchorDisplay.set('a_classroom', { x: entrancePoint.x, z: entrancePoint.z })

  if (params.get('probe') === '1') {
    document.title = world.anchorList
      .map((a) => `${a.id}:${a.pos.x.toFixed(0)},${a.pos.z.toFixed(0)}`)
      .join(' | ')
  }

  const state = new GameState(bus)
  const input = new Input()
  const ui = new HUD()
  const blackout = new Blackout()
  const audio = new Audio()
  const dust = createDust(scene)
  const player = new Player(scene, world)
  const rig = new CameraRig(camera, world)
  const chaser = new Chaser(scene, world)
  // 校园是 1km 尺度，跟随机位要抬高拉远，否则永远只看得到脚下一块地。
  // 加了腿之后角色更高，机位略降一点，跑跳动作才看得清。
  rig.setOffset(0, 2.8, 5.6, 1.3)
  const director = new Director({ bus, ui: blackout, audio, camera: rig, lines })
  const bits = new Bits({
    data: bitsData,
    world,
    player,
    chaser,
    ui,
    audio,
    lines,
    state,
    bus,
    input,
    classroomZone
  })

  // 小地图：室外用校园建筑轮廓，室内用定制教室的 room 矩形
  const campusBounds = world.zones.outdoor.bounds
  const mapBuildings = (campusData?.buildings || []).map((b) => {
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (const [x, z] of b.polygon || []) {
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minZ = Math.min(minZ, z)
      maxZ = Math.max(maxZ, z)
    }
    return {
      pos: [(minX + maxX) / 2, 0, (minZ + maxZ) / 2],
      size: [maxX - minX, 2, maxZ - minZ]
    }
  })
  if (classEntrance) {
    mapBuildings.push({ pos: [siteX, 0, siteZ], size: [12.4, 2, 10.4] })
  }
  const mapData = {
    outdoor: {
      bounds: [
        [campusBounds.min.x, campusBounds.min.z],
        [campusBounds.max.x, campusBounds.max.z]
      ],
      buildings: mapBuildings,
      roads: (campusData?.roads || []).map((r) => r.path),
      props: (world.anchorList || []).map((a) => {
        const pt = anchorDisplay.get(a.id) || a.pos
        return { type: 'door', pos: [pt.x, 0, pt.z] }
      }),
      anchors: [
        {
          id: 'a_plaza',
          pos: [world.anchors.get('a_campus')?.pos.x || 0, 0, world.anchors.get('a_campus')?.pos.z || 0]
        }
      ]
    },
    rooms: classroomData?.rooms || []
  }
  const minimap = createMinimap({ data: mapData, world, display: anchorDisplay })

  const classmates = new Classmates({
    scene,
    data: classroomData || { rooms: [] },
    world,
    player,
    bits,
    state,
    ui,
    audio,
    lines
  })

  // 课堂题选项：鼠标点 = 数字键
  document.querySelectorAll('#classq .opt').forEach((el) => {
    el.addEventListener('click', () => {
      if (!bits.questionOpen) return
      audio.select()
      bits.answer(Number(el.dataset.opt))
    })
  })

  let lastAnchorId = classEntrance?.id || (useCampus ? world.anchorList[0].id : 'a_classroom')
  let escape = null
  let prevSprinting = false
  let prevOverheated = false
  let trailAcc = 0
  let walkAcc = 0

  function applyZoneFx(zoneId) {
    // 房间摆在 x=100 之外，室外雾会把室内一起吃掉，所以按区域开关
    // 校园模式要看见 1km 外的楼群，雾必须拉远，否则远景全白
    if (zoneId === 'outdoor') {
      scene.fog = useCampus ? new THREE.Fog(SKY, 950, 3800) : new THREE.Fog(SKY, 26, 78)
    } else {
      // 室内也要一点空气感：大图书馆 40m 深，没有雾时远处白墙会像一张纸
      scene.fog = new THREE.Fog(0xb9b1a3, 22, 95)
    }
  }

  function goTo(anchorId, withFade = true) {
    const a = world.anchors.get(anchorId)
    if (!a) return
    player.teleport(anchorId)
    rig.setZone(player.zone)
    rig.snapTo(player.pos, player.yaw)
    applyZoneFx(player.zone)
    ui.setZone(a.label)
    // 进教室就把标题卡收掉，别挡上课
    if (player.zone === classroomZone) ui.hideIntro()
    // 第一次从校园走进教室：黑→睁一条缝→闭→更亮→完全睁开，再开始上课
    if (player.zone === classroomZone && state.is(S.PLAY)) {
      state.set(S.WAKEUP)
      director.play('wake_up', { full: true })
      return
    }
    if (withFade) director.play('respawn')
  }

  function findInteractable() {
    return world.interactables.find((x) => {
      if (x.zone !== player.zone) return false
      const dx = x.pos.x - player.pos.x
      const dz = x.pos.z - player.pos.z
      return dx * dx + dz * dz < x.radius * x.radius
    })
  }

  /** 被追时进门：暂停输入 0.5s → 校长停在门口 2m、转身 → 播 PHONE_ESCAPED → 淡出传送 */
  function startDoorEscape(it) {
    const door = it.pos
    let dx = player.pos.x - door.x
    let dz = player.pos.z - door.z
    const len = Math.hypot(dx, dz) || 1
    dx /= len
    dz /= len
    chaser.holdAt(door.x + dx * 2, door.z + dz * 2, player.pos.x, player.pos.z)
    ui.subtitle(lines.PHONE_ESCAPED, 1.6)
    audio.alarm()
    escape = { t: 0.5, anchorId: it.anchorId }
    input.enabled = false
  }

  function tryInteract() {
    const it = findInteractable()
    if (!it) return
    if (state.is(S.PLAY) && bits.getPhase('phone_walk') === 'chase' && player.zone === 'outdoor') {
      startDoorEscape(it)
      return
    }
    audio.select()
    goTo(it.anchorId)
  }

  /* ---------- 玩家动作 → 音效 / 灰尘 / 震屏 ---------- */
  function handlePlayerEvents() {
    for (const ev of player.consumeEvents()) {
      if (ev.type === 'jump') {
        audio.jump()
        dust.spawn(player.pos.x, player.pos.y + 0.06, player.pos.z, {
          count: 6,
          spread: 0.22,
          speed: 0.9,
          up: 0.5,
          size: 0.28,
          life: 0.4,
          color: 0xcfc4b2
        })
      } else if (ev.type === 'land') {
        audio.land(ev.impact)
        dust.burst(player.pos, { count: 9 + Math.round(ev.impact * 10), strength: ev.impact })
        if (ev.impact > 0.35) rig.shake(0.05 + ev.impact * 0.16, 0.16)
      } else if (ev.type === 'unstuck') {
        // 两栋楼夹角里被夹住时的自动脱困提示；local 是挪到旁边，teleport 是退回安全点
        ui.subtitle({ en: 'Unstuck — moved you out of the wall gap.', zh: '卡在墙缝里，已自动脱困。' }, 1.6)
        dust.burst(player.pos, { count: 8, strength: 0.6 })
      }
    }

    // 冲刺状态切换音
    if (player.sprinting && !prevSprinting) audio.sprint()
    prevSprinting = player.sprinting
    if (player.overheated && !prevOverheated) audio.overheat()
    prevOverheated = player.overheated
  }

  // 冲刺时脚下拖出灰尘；走路偶尔带起一点土，站定/腾空都不冒
  function spawnSprintTrail(dt) {
    if (!player.grounded || !player.moving || player.speed < 0.8) {
      trailAcc = 0
      walkAcc = 0
      return
    }
    const speed = player.speed || 1
    const dir = { x: player.vel.x / speed, z: player.vel.z / speed }
    if (!player.sprinting) {
      walkAcc += dt
      if (walkAcc > 0.24) {
        walkAcc = 0
        dust.spawn(player.pos.x, player.pos.y + 0.04, player.pos.z, {
          count: 1,
          spread: 0.1,
          speed: 0.35,
          up: 0.22,
          size: 0.2,
          grow: 0.9,
          life: 0.34,
          color: 0xd6cbb8
        })
      }
      trailAcc = 0
      return
    }
    trailAcc += dt
    while (trailAcc > 0.045) {
      trailAcc -= 0.045
      dust.spawn(player.pos.x, player.pos.y + 0.05, player.pos.z, {
        count: 1,
        spread: 0.16,
        speed: 1.4,
        up: 0.45,
        size: 0.3,
        grow: 1.2,
        life: 0.42,
        color: 0xd6cbb8,
        dir
      })
    }
  }

  /* ---------- 死亡 → 选点 → 醒来 ---------- */
  bus.on('death', (payload) => {
    if (!state.is(S.PLAY)) return
    bits.stars = 0
    bits.questionOpen = false
    ui.showQuestion(false)
    state.set(S.CAUGHT)
    const title =
      payload?.reason === 'class'
        ? lines.WRONG_TITLE?.en || 'WRONG'
        : lines.CAUGHT_TITLE?.en || 'CAUGHT'
    minimap.setMode('select')
    director.play('caught', {
      title,
      sub: payload?.reason === 'class' ? '' : 'RECORDED'
    })
  })

  bus.on('director:done', ({ name }) => {
    if (name === 'caught') {
      state.set(S.ANCHOR)
      // 死亡选点只亮小地图：锚点脉冲 + 键鼠选择
      minimap.beginSelect(world.anchorList, lastAnchorId, (anchor) => {
        audio.confirm()
        lastAnchorId = anchor.id
        state.set(S.WAKEUP)
        player.teleport(anchor.id)
        rig.setZone(anchor.zone)
        rig.snapTo(player.pos, player.yaw)
        applyZoneFx(anchor.zone)
        ui.setZone(anchor.label)
        chaser.despawn()
        director.play('wake_up_map')
      })
      return
    }
    if (name.startsWith('wake_up')) {
      state.set(S.PLAY)
      bits.reset()
      ui.setPhone(player.phoneUp)
      minimap.endSelect()
      minimap.setMode('normal')
    }
  })

  /* ---------- 开场：站在教学楼B外面，走进门才开始上课 ---------- */
  const defaultStart = classEntrance?.id || 'a_teach'
  const startAnchor = params.get('anchor') || defaultStart
  const autoBit = params.get('bit')
  {
    const a = world.anchors.get(startAnchor) || world.anchorList[0]
    player.teleport(a.id)
    // ?at=x,z 调试用：直接把人放到任意坐标（不用非得有锚点）
    const at = params.get('at')
    if (at) {
      const [ax, az] = at.split(',').map(Number)
      if (Number.isFinite(ax) && Number.isFinite(az)) {
        player.pos.set(ax, player.pos.y, az)
        player.prev.copy(player.pos)
        player.pos.y = heightAt(ax, az) + 0.02
        player.sync(1)
      }
    }
    rig.setZone(a.zone)
    rig.snapTo(player.pos, player.yaw)
    applyZoneFx(a.zone)
    ui.setZone(a.label)
    state.set(S.PLAY)
    blackout.clearBlack(0.4)
  }

  if (autoBit) setTimeout(() => bits.force(autoBit), 1600)

  // 布局预览 / 演示兜底：?screen=anchors 直接看死亡选点地图，?spawn=1 在面前放一个校长
  if (params.get('screen') === 'anchors') {
    blackout.blackout(lines.CAUGHT_TITLE?.en || 'CAUGHT', 'SELECT ANCHOR')
    state.set(S.CAUGHT)
    state.set(S.ANCHOR)
    minimap.beginSelect(world.anchorList, world.anchorList[0]?.id, () => {})
  }
  if (params.get('screen') === 'question') {
    ui.showQuestion(true)
  }
  if (params.get('spawn') === '1') {
    chaser.spawn('principal', 'outdoor', new THREE.Vector3(0, 0, -2))
  }

  // 布局检查：?bird=1 冻结跟随，用高位机位看整个校区
  if (params.get('bird') === '1') {
    rig.frozen = true
    const bx = +(params.get('bx') || 520)
    const by = +(params.get('by') || 680)
    const bz = +(params.get('bz') || 900)
    camera.position.set(bx, by, bz)
    rig.lookAt.set(+(params.get('lx') || 0), +(params.get('ly') || 0), +(params.get('lz') || 0))
    camera.lookAt(rig.lookAt)
  }

  // 形象检查：?selfie=1 围着角色转，ang 指定角度（度），dist 指定距离
  const selfie = params.get('selfie') === '1'
  const selfieAng = +((params.get('ang') || 0) * Math.PI / 180)
  const selfieDist = +(params.get('dist') || 3.0)
  if (selfie) rig.frozen = true

  // 默认进校园时给一张标题卡，让人先知道「这是什么、怎么操作」
  if (startAnchor === defaultStart) {
    if (!selfie && !params.get('screen') && params.get('bird') !== '1') ui.showIntro(3.6)
  }

  /* ---------- 每帧逻辑 ---------- */
  const DIGITS = ['Digit1', 'Digit2', 'Digit3', 'Digit4']
  const shadowAnchor = new THREE.Vector3(1e9, 0, 1e9)
  // R 复位回「当前世界的出生点」：旧切片是广场，校园是校园中心
  const resetAnchorId = classEntrance?.id || (useCampus ? world.anchorList[0].id : 'a_plaza')

  function readKeys() {
    if (state.is(S.PLAY)) {
      // 答题面板开着的时候，1-3 属于选项，不是传送
      if (bits.questionOpen) return

      if (input.once('Tab')) {
        player.setPhone(!player.phoneUp)
        ui.setPhone(player.phoneUp)
        audio.select()
      }
      if (input.once('KeyE')) {
        if (!classmates.tryTalk()) tryInteract()
      }
      if (input.once('KeyF')) bits.force(player.zone === classroomZone ? 'class_sleep' : 'phone_walk')
      if (input.once('KeyR')) {
        bits.reset({ keepStars: false })
        goTo(resetAnchorId)
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
        minimap.pick(i)
        audio.select()
      }
      if (input.once('ArrowUp')) minimap.move(-1)
      if (input.once('ArrowDown')) minimap.move(1)
      if (input.once('Enter')) minimap.confirm()
    }
  }

  const loop = createLoop({
    step(dt) {
      state.update(dt)
      readKeys()

      // 进门 0.5 秒演出：冻结输入、校长停在门口，然后传送进定制教室
      if (escape) {
        escape.t -= dt
        if (escape.t <= 0) {
          const anchorId = escape.anchorId
          escape = null
          input.enabled = true
          goTo(anchorId)
          bits.finishEscape()
        }
      } else if (state.is(S.PLAY)) {
        // 答题面板开着时冻结角色，别在题目后面盲走
        if (!bits.questionOpen) player.update(dt, input, rig.camYaw)
        handlePlayerEvents()
        spawnSprintTrail(dt)
        bits.update(dt)
        chaser.update(dt, player.pos, player.zone)
      } else if (state.is(S.WAKEUP)) {
        // 醒来过程中允许小幅挪动，但不出手指令
        bits.update(dt)
      }

      classmates.update(dt, camera)
      ui.setSprint(player)
      // 靠近同学优先提示聊天，其次才是门 / 出入口
      if (state.is(S.PLAY) && !bits.questionOpen && !escape) {
        const talk = classmates.promptText()
        const near = findInteractable()
        ui.setPrompt(talk || (near ? near.label : ''))
      } else {
        ui.setPrompt('')
      }
      director.update(dt)
      ui.update(dt)
      input.endFrame()
    },
    render(alpha, realDt) {
      player.sync(alpha)
      const md = input.consumeMouse()
      if (md.dx || md.dy) rig.addOrbit(md.dx, md.dy)
      // 冲刺收 FOV，镜头有「往前顶」的速度感
      rig.fovBoost = player.sprinting ? 7.5 : 0
      rig.update(realDt, player.pos, player.yaw)
      dust.update(realDt)
      minimap.update(player, camera)
      if (player.pos.distanceToSquared(shadowAnchor) > 2.25) {
        shadowAnchor.copy(player.pos)
        if (useCampus) {
          // 阴影窗跟随：位置与目标一起平移，方向不变
          sun.target.position.set(player.pos.x, 0, player.pos.z)
          sun.position.copy(sun.target.position).add(SUN_OFFSET)
          sun.target.updateMatrixWorld()
        }
        // 玩家动过才重画阴影贴图（静态场景不必每帧重画）
        renderer.shadowMap.needsUpdate = true
      }
      if (selfie) {
        const a = player.yaw + Math.PI + selfieAng
        camera.position.set(
          player.pos.x + Math.sin(a) * selfieDist,
          player.pos.y + 1.55,
          player.pos.z + Math.cos(a) * selfieDist
        )
        camera.lookAt(player.pos.x, player.pos.y + 0.95, player.pos.z)
      }
      renderer.render(scene, camera)

      if (params.get('dbg') === '1') {
        document.title =
          `cam ${camera.position.x.toFixed(1)},${camera.position.y.toFixed(1)},${camera.position.z.toFixed(1)}` +
          ` | ply ${player.pos.x.toFixed(1)},${player.pos.y.toFixed(1)},${player.pos.z.toFixed(1)}` +
          ` | zone ${player.zone}` + ` | fog ${scene.fog ? 'on' : 'off'}` +
          ` | rooms ${Object.keys(world.roomCameras).join(',')}` +
          ` | calls ${renderer.info.render.calls}`
      }

      if (statsEl) {
        fpsAcc += realDt
        fpsFrames++
        if (fpsAcc >= 0.5) {
          const info = renderer.info.render
          statsEl.textContent =
            `draw call  ${info.calls}\n` +
            `triangles  ${(info.triangles / 1000).toFixed(1)}k\n` +
            `fps        ${(fpsFrames / fpsAcc).toFixed(0)}\n` +
            `pos y      ${player.pos.y.toFixed(2)}\n` +
            `ground y   ${heightAt(player.pos.x, player.pos.z).toFixed(2)}\n` +
            `x / z      ${player.pos.x.toFixed(0)} / ${player.pos.z.toFixed(0)}`
          fpsAcc = 0
          fpsFrames = 0
        }
      }
    }
  })

  /* ---------- 性能读数（?stats=1）：draw call / 三角面 / fps ---------- */
  let statsEl = null
  let fpsAcc = 0
  let fpsFrames = 0
  if (params.get('stats') === '1') {
    statsEl = document.createElement('div')
    statsEl.style.cssText =
      'position:fixed;right:10px;bottom:10px;padding:8px 12px;font:12px/1.5 ui-monospace,monospace;' +
      'color:#e9eef5;background:rgba(12,16,22,.72);border-radius:6px;white-space:pre;z-index:99;pointer-events:none'
    document.body.appendChild(statsEl)
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
  })

  /* ---------- 演示用调试钩子（控制台可直接调） ---------- */
  window.__campus = {
    player,
    bits,
    chaser,
    world,
    state,
    director,
    rig,
    dust,
    ui,
    audio,
    heightAt,
    scene,
    camera,
    renderer,
    THREE,
    minimap,
    classmates,
    bus
  }

  renderer.render(scene, camera)
  const bootEl = document.getElementById('boot')
  bootEl.classList.add('hide')
  setTimeout(() => bootEl.remove(), 600)
  loop.start()
}

main().catch((err) => {
  console.error(err)
  const boot = document.getElementById('boot')
  if (boot) boot.textContent = `LOAD FAILED — ${err && err.message ? err.message : err}`
})
