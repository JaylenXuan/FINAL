import * as THREE from 'three'

/**
 * 玩家形象：紫罗兰小恶魔龙（按用户提供的手办照片还原）
 *
 * 结构（局部坐标，角色朝向 -Z，与 player.js 的 yaw 约定一致）：
 *   root
 *    └ bob（呼吸 / 走跑起伏）
 *       ├ 身体（旋转体做出梨形 + 收腰）、头（大头）
 *       ├ head（角、圆鳞、眼、眉、嘴、獠牙、腮红）
 *       ├ wingL / wingR（蝙蝠翅膀，可扇）
 *       ├ armL / armR（短手，右手拿三叉戟）
 *       ├ footL / footR（脚 + 黑爪）
 *       └ tail（尾巴，分段摆动）
 *
 * 全部程序化几何，无外部模型 / 贴图，贴合「不引入新依赖」的约束。
 */

// 比例接近原手办，但给腿留出一截可见的「短粗腿」空间：
// 0.455m 的腿 + 大脚掌，整体 0.88，总高约 1.86m。
// v0.13.0 那种 0.75m 的细长腿太像两根棍子；这一版腿短、粗、和身体同色。
const BODY_LIFT = 0.455
const LEG = {
  hipY: 0.455,
  spread: 0.185,
  thigh: 0.22,
  shin: 0.13,
  footH: 0.105
}

const C = {
  body: 0xa583c9,
  bodyDeep: 0x9370b8,
  accent: 0x6f4a93,
  accentDark: 0x4a2f66,
  membrane: 0x7a53a3,
  claw: 0x2a2130,
  eye: 0xf2a01e,
  eyeDark: 0x2c1e30,
  white: 0xfffdf6,
  // 手办右脸上那块淡紫色的贴片（不是腮红）
  patch: 0xc7b0dd
}

// 手办是哑光硅胶，不是亮面塑料：高光给弱一点，粗糙度给高一点，
// 否则小恶魔会变成一个「紫塑料球」，比丑还糟 —— 会觉得廉价
function toyMat(color, { rough = 0.78, emissive = 0x000000, ei = 0 } = {}) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: rough,
    metalness: 0,
    clearcoat: 0.12,
    clearcoatRoughness: 0.65,
    emissive,
    emissiveIntensity: ei
  })
}

const BODY_MAT = toyMat(C.body)
const ARM_MAT = new THREE.MeshPhysicalMaterial({
  color: C.body,
  roughness: 0.78,
  metalness: 0,
  clearcoat: 0.12,
  clearcoatRoughness: 0.65,
  side: THREE.DoubleSide
})
const BODY_DEEP = toyMat(C.bodyDeep, { rough: 0.66 })
const ACCENT_MAT = toyMat(C.accent, { rough: 0.52 })
const ACCENT_DARK = toyMat(C.accentDark, { rough: 0.58 })
// 角上的环：用中紫而不是接近黑，否则小角看起来像一截螺丝 / 糖纸
const HORN_BAND = toyMat(0x5c3a7e, { rough: 0.7 })
const MEMBRANE_MAT = new THREE.MeshPhysicalMaterial({
  color: C.membrane,
  roughness: 0.58,
  metalness: 0,
  clearcoat: 0.25,
  side: THREE.DoubleSide
})

/** 背上一片圆鳞：竖向椭圆，贴着脊背，不是一颗珠子 */
function scute(r, sx, sy, sz) {
  const g = new THREE.SphereGeometry(r, 16, 12)
  g.scale(sx, sy, sz)
  return new THREE.Mesh(g, ACCENT_MAT)
}

/** 身体：用旋转体做梨形，腰部收一点，头才能「坐」上去 */
function makeTorso() {
  // (半径, 高度) 从下往上；底部收口在 y≈0.06
  const prof = [
    [0.0, 0.05],
    [0.185, 0.06],
    [0.31, 0.12],
    [0.405, 0.23],
    [0.443, 0.38],
    [0.448, 0.52],
    [0.415, 0.66],
    [0.375, 0.79],
    [0.345, 0.9],
    [0.325, 0.97]
  ]
  const pts = prof.map(([r, y]) => new THREE.Vector2(r, y))
  const g = new THREE.LatheGeometry(pts, 32)
  g.scale(1, 1, 0.94)
  const m = new THREE.Mesh(g, BODY_MAT)
  return m
}

/** 角：旋转体做锥形，再把顶点往后掰（curl=0 就是一根直的小尖角，手办那款） */
function makeHorn(height = 0.44, base = 0.086, curl = 0.28) {
  const pts = []
  const seg = 10
  for (let i = 0; i <= seg; i++) {
    const t = i / seg
    const r = base * Math.pow(1 - t, 0.8)
    pts.push(new THREE.Vector2(Math.max(r, 0.0008), t * height))
  }
  const g = new THREE.LatheGeometry(pts, 18)
  const pos = g.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i)
    const k = y / height
    pos.setZ(i, pos.getZ(i) + k * k * height * curl)
  }
  g.computeVertexNormals()
  return new THREE.Mesh(g, ACCENT_MAT)
}

/** 角根的黑条纹 */
function hornBands(height, base, curl = 0.28) {
  const grp = new THREE.Group()
  for (const t of [0.28, 0.62]) {
    const r = base * Math.pow(1 - t, 0.8) * 1.05
    const g = new THREE.TorusGeometry(r, 0.0075, 6, 20)
    g.rotateX(Math.PI / 2)
    const m = new THREE.Mesh(g, HORN_BAND)
    m.position.y = height * t
    m.position.z = Math.pow(t, 2) * height * curl
    grp.add(m)
  }
  return grp
}

/** 蝙蝠翅膀：2D 轮廓挤出，指骨处留凹口 */
function makeWing() {
  const s = new THREE.Shape()
  s.moveTo(0, 0.02)
  s.quadraticCurveTo(0.05, 0.24, 0.36, 0.36)
  s.quadraticCurveTo(0.31, 0.2, 0.4, 0.15)
  s.quadraticCurveTo(0.26, 0.13, 0.31, 0.0)
  s.quadraticCurveTo(0.18, 0.03, 0.22, -0.12)
  s.quadraticCurveTo(0.1, -0.07, 0.06, -0.16)
  s.quadraticCurveTo(0.02, -0.05, 0, 0.02)
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.018, bevelEnabled: false, curveSegments: 8 })
  g.translate(0, 0, -0.009)
  const wing = new THREE.Mesh(g, MEMBRANE_MAT)

  // 前缘骨 + 两根指骨：从一张纸变成有结构的翅膀
  const bone = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 0.5, 6), ACCENT_MAT)
  bone.rotation.z = -0.75
  bone.position.set(0.18, 0.19, 0)
  wing.add(bone)

  for (const [x1, y1, len, rot] of [
    [0.3, 0.16, 0.26, 0.5],
    [0.23, 0.04, 0.22, 0.15]
  ]) {
    const finger = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.013, len, 5), ACCENT_MAT)
    finger.rotation.z = rot
    finger.position.set(x1, y1 - len * 0.4, 0)
    wing.add(finger)
  }
  return wing
}

/* ---------------- 脸：画在 canvas 上，再贴到颅骨表面 ----------------
 * 上一版用球体拼五官（凸出的吻部 + 眼球 + 眉毛），结果是一个「紫色怪物」：
 * 手办的脸其实是平的，五官是印上去的。所以这里全部改成贴花。
 */

const HEAD_A = 0.475 * 1.02
const HEAD_B = 0.475 * 0.95
const HEAD_C = 0.475 * 0.94

// 给定脸蛋上的 (x,y)，求椭球正面的 z（贴花必须落在球面上，否则会飘）
function surfaceZ(x, y) {
  const t = 1 - (x / HEAD_A) ** 2 - (y / HEAD_B) ** 2
  return -HEAD_C * Math.sqrt(Math.max(t, 0.0001))
}

function canvasTex(c, { aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = aniso
  return t
}

/** 眼睛：杏仁形 + 半睁的上眼睑 + 竖瞳 + 高光 */
function eyeTexture(side) {
  const W = 320
  const H = 240
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')
  g.translate(W / 2, H / 2)
  // 内眼角永远朝鼻子：+x 那只眼不镜像（贴图 u=0 在 -x），-x 那只要镜像
  if (side < 0) g.scale(-1, 1)

  const hw = W * 0.44
  const hh = H * 0.42
  const path = () => {
    g.beginPath()
    g.moveTo(-hw, hh * 0.06)
    g.bezierCurveTo(-hw * 0.5, hh * 1.1, hw * 0.32, hh * 1.05, hw, -hh * 0.18)
    g.lineTo(hw * 0.8, -hh * 0.46)
    // 上缘做成往上拱的弧线，直着一条就是「死鱼眼」，拱起来才萌
    g.quadraticCurveTo(0, -hh * 0.82, -hw * 0.9, -hh * 0.4)
    g.closePath()
  }

  // 虹膜（上亮下暗，像手办的树脂眼）
  path()
  const grd = g.createLinearGradient(0, -hh, 0, hh)
  grd.addColorStop(0, '#ffc857')
  grd.addColorStop(0.55, '#f5a21a')
  grd.addColorStop(1, '#c46f0c')
  g.fillStyle = grd
  g.fill()

  // 瞳孔：压在虹膜偏下的位置，上眼睑只盖掉它一点点
  g.save()
  path()
  g.clip()
  g.beginPath()
  g.ellipse(hw * 0.02, hh * 0.24, hw * 0.3, hh * 0.44, 0, 0, Math.PI * 2)
  g.fillStyle = '#241826'
  g.fill()
  g.restore()

  // 上眼睑：只压掉最上面一条，才有手办那种「半睁着不理你」的表情
  // （上一版盖了 60%，瞳孔全被吃掉，看起来像没有眼珠）
  g.beginPath()
  g.moveTo(-hw * 0.9, -hh * 0.4)
  g.quadraticCurveTo(0, -hh * 0.82, hw * 0.8, -hh * 0.46)
  g.lineTo(hw * 0.56, -hh * 0.2)
  g.quadraticCurveTo(0, -hh * 0.3, -hw * 0.62, -hh * 0.06)
  g.closePath()
  g.fillStyle = '#3a2a40'
  g.fill()

  // 高光
  g.beginPath()
  g.arc(-hw * 0.22, hh * 0.08, hh * 0.2, 0, Math.PI * 2)
  g.fillStyle = 'rgba(255,255,255,0.95)'
  g.fill()
  g.beginPath()
  g.arc(hw * 0.3, hh * 0.5, hh * 0.085, 0, Math.PI * 2)
  g.fillStyle = 'rgba(255,255,255,0.7)'
  g.fill()

  // 眼线
  path()
  g.lineWidth = 8
  g.lineJoin = 'round'
  g.strokeStyle = '#2c1e30'
  g.stroke()

  return canvasTex(c, { aniso: 8 })
}

/** 鼻子 + 嘴 + 獠牙，一张贴图搞定下半张脸 */
function mouthTexture() {
  const W = 320
  const H = 320
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')

  // 两个鼻孔：短竖线，淡淡的（v≈0.34 落在眼睛和嘴中间）
  for (const sx of [-1, 1]) {
    g.beginPath()
    g.ellipse(W / 2 + sx * 33, H * 0.34, 5.5, 11, sx * 0.18, 0, Math.PI * 2)
    g.fillStyle = 'rgba(96,66,120,0.8)'
    g.fill()
  }

  // 微笑：一条细弧线，两端上翘
  g.beginPath()
  g.moveTo(W * 0.33, H * 0.615)
  g.quadraticCurveTo(W * 0.5, H * 0.7, W * 0.67, H * 0.615)
  g.lineWidth = 7.5
  g.lineCap = 'round'
  g.strokeStyle = '#2c1e30'
  g.stroke()

  // 两颗小獠牙，挂在嘴角
  for (const sx of [-1, 1]) {
    const x = W / 2 + sx * W * 0.15
    g.beginPath()
    g.moveTo(x - 7, H * 0.612)
    g.lineTo(x + 7, H * 0.612)
    g.lineTo(x, H * 0.664)
    g.closePath()
    g.fillStyle = '#fffdf6'
    g.fill()
  }

  return canvasTex(c, { aniso: 8 })
}

/** 眉毛：外高内低的一小段弧，粗的一头在外侧 */
function browTexture(flip = false) {
  const W = 192
  const H = 96
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')
  if (flip) {
    g.translate(W, 0)
    g.scale(-1, 1)
  }
  g.lineCap = 'round'
  // 两段重叠的笔画，做出「外粗内细」的眉毛
  g.strokeStyle = '#3f2657'
  g.lineWidth = 23
  g.beginPath()
  g.moveTo(W * 0.16, H * 0.62)
  g.quadraticCurveTo(W * 0.45, H * 0.24, W * 0.78, H * 0.34)
  g.stroke()
  g.lineWidth = 13
  g.beginPath()
  g.moveTo(W * 0.7, H * 0.33)
  g.quadraticCurveTo(W * 0.86, H * 0.4, W * 0.93, H * 0.5)
  g.stroke()
  return canvasTex(c, { aniso: 8 })
}

/** 脸颊上的浅色小圆点 */
function dotTexture() {
  const S = 96
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')
  const grd = g.createRadialGradient(S / 2, S / 2, S * 0.08, S / 2, S / 2, S * 0.5)
  grd.addColorStop(0, 'rgba(226,210,242,0.95)')
  grd.addColorStop(0.65, 'rgba(226,210,242,0.75)')
  grd.addColorStop(1, 'rgba(226,210,242,0)')
  g.fillStyle = grd
  g.beginPath()
  g.arc(S / 2, S / 2, S * 0.46, 0, Math.PI * 2)
  g.fill()
  return canvasTex(c)
}

/** 右脸那块淡紫色贴片 */
function patchTexture() {
  const S = 128
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')
  const grd = g.createRadialGradient(S / 2, S / 2, S * 0.12, S / 2, S / 2, S * 0.46)
  grd.addColorStop(0, 'rgba(199,176,221,0.92)')
  grd.addColorStop(1, 'rgba(199,176,221,0)')
  g.fillStyle = grd
  g.beginPath()
  g.ellipse(S / 2, S / 2, S * 0.42, S * 0.3, -0.22, 0, Math.PI * 2)
  g.fill()
  return canvasTex(c)
}

/**
 * 把一块平面贴花「按射线推到椭球面上」：
 * 直接放平面会飘在脸前面（球面是弯的），立起来又会陷进去，
 * 所以每个顶点沿球心方向投影一次，贴花就完全服帖了。
 */
function faceDecal(tex, w, h, x, y, rotZ = 0, lift = 1.004) {
  const geo = new THREE.PlaneGeometry(w, h, 14, 14)
  const m = new THREE.Matrix4().makeRotationZ(rotZ)
  m.setPosition(x, y, surfaceZ(x, y))
  geo.applyMatrix4(m)

  const p = geo.attributes.position
  for (let i = 0; i < p.count; i++) {
    const vx = p.getX(i)
    const vy = p.getY(i)
    const vz = p.getZ(i)
    const k = lift / Math.sqrt((vx / HEAD_A) ** 2 + (vy / HEAD_B) ** 2 + (vz / HEAD_C) ** 2)
    p.setXYZ(i, vx * k, vy * k, vz * k)
  }
  p.needsUpdate = true
  geo.computeVertexNormals()

  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      map: tex,
      transparent: true,
      roughness: 0.4,
      metalness: 0,
      depthWrite: false,
      side: THREE.DoubleSide
    })
  )
  mesh.renderOrder = 2
  return mesh
}

/** 三叉戟：杆 + 横担 + 三尖，和手办一样比角色还高 */
function makeTrident() {
  const g = new THREE.Group()
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.025, 1.66, 10), ACCENT_MAT)
  shaft.position.y = 0.22
  g.add(shaft)

  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.055, 10), ACCENT_DARK)
  collar.position.y = 1.0
  g.add(collar)

  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.05, 0.05), ACCENT_MAT)
  bar.position.y = 1.04
  g.add(bar)

  for (const x of [-0.14, 0, 0.14]) {
    const prong = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.027, 0.32, 8), ACCENT_MAT)
    prong.position.set(x, 1.22, 0)
    g.add(prong)
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.032, 0.09, 8), ACCENT_MAT)
    tip.position.set(x, 1.4, 0)
    g.add(tip)
  }

  const butt = new THREE.Mesh(new THREE.ConeGeometry(0.032, 0.1, 8), ACCENT_DARK)
  butt.position.y = -0.66
  butt.rotation.x = Math.PI
  g.add(butt)
  return g
}

/** 脚下的软阴影（圆形渐变），远处没实时阴影时也不会像浮在空中 */
let blobTex = null
function getBlobTex() {
  if (blobTex) return blobTex
  const S = 128
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')
  const grd = g.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2)
  grd.addColorStop(0, 'rgba(24,16,30,0.55)')
  grd.addColorStop(0.5, 'rgba(24,16,30,0.24)')
  grd.addColorStop(1, 'rgba(24,16,30,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, S, S)
  blobTex = new THREE.CanvasTexture(c)
  return blobTex
}

export function createDragon() {
  const root = new THREE.Group()
  root.name = 'player-dragon'

  const bob = new THREE.Group()
  root.add(bob)

  // 身体（躯干 / 头 / 手 / 翅膀 / 尾巴 / 三叉戟）全部挂在 body 上，抬高后给腿让位
  const body = new THREE.Group()
  body.position.y = BODY_LIFT
  bob.add(body)

  /* ---------- 身体 ---------- */
  const torso = makeTorso()
  body.add(torso)

  /* ---------- 头 ---------- */
  const head = new THREE.Group()
  head.position.set(0, 1.14, 0)
  body.add(head)

  const skullGeo = new THREE.SphereGeometry(0.475, 40, 30)
  skullGeo.scale(1.02, 0.95, 0.94)
  const skull = new THREE.Mesh(skullGeo, BODY_MAT)
  head.add(skull)

  /* 五官：全部是贴花。
   * 手办的脸是平的、五官「印」在球面上 —— 上一版凸出一个吻部球 + 立体眼球 + 粗眉毛，
   * 立体感是有了，但像一个紫薯怪物。改成贴花之后才回到「软胶手办」的味道。 */
  head.add(faceDecal(eyeTexture(1), 0.163, 0.127, 0.152, 0.036, 0, 1.004))
  head.add(faceDecal(eyeTexture(-1), 0.163, 0.127, -0.152, 0.036, 0, 1.004))
  // 眉毛：一小截外高内低的弧线，表情立刻从「生硬」变成「有点脾气」
  head.add(faceDecal(browTexture(), 0.14, 0.062, 0.155, 0.125, -0.14, 1.005))
  head.add(faceDecal(browTexture(true), 0.14, 0.062, -0.155, 0.125, 0.14, 1.005))
  // 两颊的小圆点（手办上那对浅色斑点）
  head.add(faceDecal(dotTexture(), 0.062, 0.062, 0.272, -0.05, 0, 1.005))
  head.add(faceDecal(dotTexture(), 0.062, 0.062, -0.272, -0.05, 0, 1.005))
  head.add(faceDecal(mouthTexture(), 0.4, 0.4, 0, -0.095, 0, 1.003))
  // 右脸那块淡紫贴片（手办上的小细节，别做成腮红）
  head.add(faceDecal(patchTexture(), 0.095, 0.08, -0.285, -0.03, 0.18, 1.005))

  /* 两只角：手办是小短角，别做成牛角 */
  for (const side of [-1, 1]) {
    const horn = new THREE.Group()
    horn.add(makeHorn(0.31, 0.095, 0.06))
    horn.add(hornBands(0.31, 0.095, 0.06))
    horn.position.set(side * 0.16, 0.39, 0.01)
    horn.rotation.x = 0.1
    horn.rotation.z = -side * 0.4
    head.add(horn)
  }

  /* 头顶一串圆珠，从前到后 */
  const crest = [
    [0, 0.432, -0.02, 0.075],
    [0, 0.418, 0.11, 0.07],
    [0, 0.372, 0.235, 0.062],
    [0, 0.3, 0.33, 0.052]
  ]
  for (const [x, y, z, r] of crest) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), BODY_MAT)
    s.position.set(x, y, z)
    head.add(s)
  }

  /* ---------- 背部鳞片：从脖颈一路排到尾巴根 ---------- */
  const backSpikes = [
    [1.02, 0.25, 0.085],
    [0.92, 0.33, 0.1],
    [0.79, 0.39, 0.108],
    [0.65, 0.425, 0.104],
    [0.5, 0.44, 0.092],
    [0.37, 0.43, 0.078]
  ]
  for (const [y, z, r] of backSpikes) {
    const s = scute(r, 0.58, 1.22, 0.72)
    s.position.set(0, y, z)
    s.rotation.x = -0.18
    body.add(s)
  }

  /* ---------- 翅膀 ---------- */
  // 手办的翅膀是「缩在肩后」的，不能张到脑袋两侧 —— 张太开会变成两排尖刺
  const wingL = new THREE.Group()
  const wingR = new THREE.Group()
  wingR.position.set(0.235, 0.84, 0.32)
  wingL.position.set(-0.235, 0.84, 0.32)
  const wrr = makeWing()
  wrr.scale.setScalar(0.82)
  wingR.add(wrr)
  const wl = makeWing()
  wl.scale.set(-0.82, 0.82, 0.82)
  wingL.add(wl)
  wingR.rotation.set(0.05, -0.78, 0.12)
  wingL.rotation.set(0.05, 0.78, -0.12)
  body.add(wingL, wingR)

  /* ---------- 手 ----------
   * 手办的手是「短锥形小臂 + 比腕子略粗的拳头 + 几根手指」，
   * 千万别用「胶囊 + 等大球」，也别用整圈圆环当握姿。
   * 上一版是「胶囊 + 等大球」两只叠在一起，看着像一坨肉块。
   * 手办的手是很短的锥形小臂 + 一只比腕子还小的拳头 + 几根手指头。
   */
  function makeFist() {
    const g = new THREE.Group()

    // 手掌：竖向长椭圆，贴住杆的外侧
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.068, 16, 12), BODY_MAT)
    palm.scale.set(0.82, 1.2, 0.98)
    palm.position.set(0.052, 0.004, 0)
    g.add(palm)

    // 四根手指：实心胶囊，横着从手掌绕到杆前面。
    // 上一版用的是 Torus 圆弧，从侧面能直接看穿，跑起来特别明显 —— 所以这里一粒环都不用。
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.021, 0.068, 4, 10), BODY_MAT)
      f.rotation.z = Math.PI / 2
      f.position.set(0.002, 0.036 - i * 0.026, -0.031)
      g.add(f)
      // 指尖往回勾一点，包住杆的另一侧
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.021, 10, 8), BODY_MAT)
      tip.position.set(-0.048, 0.036 - i * 0.026, -0.018)
      g.add(tip)
    }

    // 拇指：从手掌斜压到杆的前面
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.021, 0.05, 4, 10), BODY_MAT)
    thumb.position.set(0.035, 0.062, -0.03)
    thumb.rotation.set(0.2, 0, 1.15)
    g.add(thumb)
    return g
  }

  function makeArm(side, { hand: withHand = true } = {}) {
    const g = new THREE.Group()

    // 小臂：旋转体做锥形（肩粗腕细）。
    // 关键：**两端必须封口**。LatheGeometry 只生成侧壁，
    // 开口的管子一摆动就能看见里面是空的 —— 像半个塑料罐。
    const pts = [
      new THREE.Vector2(0.0001, 0.024),
      new THREE.Vector2(0.056, 0.018),
      new THREE.Vector2(0.098, 0.004),
      new THREE.Vector2(0.111, -0.022)
    ]
    for (let i = 1; i <= 6; i++) {
      const t = i / 6
      pts.push(new THREE.Vector2(0.111 * (1 - t * 0.34), -0.022 - t * 0.245))
    }
    pts.push(new THREE.Vector2(0.062, -0.288))
    pts.push(new THREE.Vector2(0.0001, -0.3))
    // LatheGeometry 的剖面必须「从下往上」给，否则三角面绕序反了、法线朝内，
    // 从外面看就是半个壳（里面那层反而露出来）—— 之前一直是这个毛病。
    pts.reverse()
    const armGeo = new THREE.LatheGeometry(pts, 18)
    // 双面材质兜底：就算哪一段绕序反了，也不会出现「只有半个壳」
    const arm = new THREE.Mesh(armGeo, ARM_MAT)
    g.add(arm)

    // 肩头埋一颗小球，把「圆柱插在身体上」的接缝糊掉
    const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.096, 14, 10), BODY_MAT)
    shoulder.position.y = 0.005
    g.add(shoulder)

    if (!withHand) return g

    // 拳头：比腕子粗一点点、压扁，不能是一个大圆球
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.058, 16, 12), BODY_MAT)
    hand.scale.set(1.0, 0.88, 1.15)
    hand.position.set(0, -0.315, -0.012)
    g.add(hand)

    // 三根小手指头，朝前下方
    for (let i = -1; i <= 1; i++) {
      const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.026, 4, 8), BODY_MAT)
      f.position.set(i * 0.03, -0.352, -0.04)
      f.rotation.x = -0.5
      g.add(f)
    }
    return g
  }

  // 左手：往外伸出来一点，不要贴着身体垂着（用户说的「拿出来」）
  const armL = new THREE.Group()
  armL.position.set(-0.295, 0.83, -0.1)
  armL.rotation.z = -0.6
  armL.rotation.x = 0.25
  armL.add(makeArm(-1))
  body.add(armL)

  // 右手：抬起来往前，手掌正好落在三叉戟的杆上
  const armR = new THREE.Group()
  armR.position.set(0.295, 0.83, -0.12)
  armR.rotation.z = 0.484
  armR.rotation.x = 0.908
  armR.add(makeArm(1, { hand: false }))
  body.add(armR)

  // 三叉戟：杆穿过右手的握点（握点由 armR 的姿态算出来是 0.447 / 0.655 / -0.165）
  const trident = makeTrident()
  trident.position.set(0.42, 0.72, -0.3)
  trident.rotation.z = 0.06
  body.add(trident)

  // 握杆的手：不是「一个圆环套在杆上」（那样看着像杆子插穿了手掌），
  // 而是手掌竖着贴在杆外侧 + 四根手指绕过去 + 一根拇指压在上面。
  const fist = makeFist()
  fist.position.set(0.42, 0.72, -0.3)
  body.add(fist)

  /* ---------- 腿 ----------
   * 手办原来是「球脚直接长在肚子下面」，没有腿。跑起来只能整只脚原地转，
   * 远看像企鹅滑行。这里补出髋 / 膝 / 踝三段，走 / 跑 / 跳才有真正的步态。
   */
  function makeFoot() {
    const foot = new THREE.Group()

    // 回到手办原来的大脚掌：扁椭圆 + 三只黑爪。脚大，短腿才有力，不会像两根棍子。
    const geo = new THREE.SphereGeometry(0.195, 20, 14)
    geo.scale(1.22, 0.6, 1.4)
    const sole = new THREE.Mesh(geo, BODY_MAT)
    sole.position.set(0, 0.015, -0.1)
    foot.add(sole)

    for (let i = -1; i <= 1; i++) {
      const toe = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), BODY_MAT)
      toe.scale.set(1, 0.72, 1.25)
      toe.position.set(i * 0.088, 0.007, -0.29)
      foot.add(toe)

      const claw = new THREE.Mesh(new THREE.ConeGeometry(0.038, 0.125, 6), toyMat(C.claw, { rough: 0.38 }))
      claw.position.set(i * 0.088, 0.003, -0.378)
      claw.rotation.x = -Math.PI / 2.05
      foot.add(claw)
    }
    return foot
  }

  const legs = []
  for (const side of [-1, 1]) {
    const hip = new THREE.Group()
    hip.position.set(side * LEG.spread, LEG.hipY, 0.02)

    // 髋关节的小球：糊住「腿插进身体」的接缝
    const hipBall = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 12), BODY_MAT)
    hip.add(hipBall)

    // 大腿：短、粗、和身体同色；不是 v0.13.0 那种深色细长锥台
    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.125, LEG.thigh * 0.97, 14), BODY_MAT)
    thigh.position.y = -LEG.thigh * 0.5
    thigh.scale.set(1, 1, 1.08)
    hip.add(thigh)

    // 膝
    const knee = new THREE.Group()
    knee.position.y = -LEG.thigh
    hip.add(knee)
    const kneeBall = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), BODY_MAT)
    kneeBall.scale.set(1, 0.95, 1.05)
    knee.add(kneeBall)

    // 小腿：再短一截，把大脚掌接上去
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.108, LEG.shin * 0.95, 12), BODY_MAT)
    shin.position.y = -LEG.shin * 0.5
    knee.add(shin)

    // 脚踝一道深色软胶环：角色是手办，接缝处有一圈深色分件很正常
    const ankleRing = new THREE.Mesh(new THREE.TorusGeometry(0.116, 0.013, 6, 16), ACCENT_DARK)
    ankleRing.rotation.x = Math.PI / 2
    ankleRing.position.y = -LEG.shin + 0.012
    knee.add(ankleRing)

    // 踝 + 大脚掌
    const ankle = new THREE.Group()
    ankle.position.y = -LEG.shin
    knee.add(ankle)
    ankle.add(makeFoot())

    bob.add(hip)
    legs.push({ side, hip, knee, ankle })
  }

  /* ---------- 尾巴：往后再往下垂，不能翘成一截蝎子尾 ---------- */
  const tail = new THREE.Group()
  tail.position.set(0, 0.24, 0.36)
  const tailSegs = []
  const tailSpec = [
    [0.155, 0.0, 0.0],
    [0.138, -0.015, 0.1],
    [0.12, -0.035, 0.19],
    [0.1, -0.055, 0.27],
    [0.08, -0.07, 0.34],
    [0.062, -0.08, 0.4],
    [0.046, -0.085, 0.45]
  ]
  for (const [r, y, z] of tailSpec) {
    const pivot = new THREE.Group()
    pivot.position.set(0, y, z)
    const seg = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), BODY_MAT)
    pivot.add(seg)
    tail.add(pivot)
    tailSegs.push(pivot)
  }
  // 尾巴上的小鳞（只留两片，多了会像一节节虫子）
  for (let i = 0; i < 2; i++) {
    const s = scute(0.036 - i * 0.008, 0.5, 1.05, 0.6)
    s.position.set(0, 0.115 - i * 0.05, 0.09 + i * 0.11)
    tail.add(s)
  }
  body.add(tail)

  /* ---------- 软阴影 ---------- */
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(1.4, 1.4),
    new THREE.MeshBasicMaterial({ map: getBlobTex(), transparent: true, depthWrite: false })
  )
  blob.rotation.x = -Math.PI / 2
  blob.position.y = 0.02
  blob.renderOrder = 2
  root.add(blob)

  root.traverse((o) => {
    if (o.isMesh && o !== blob) {
      o.castShadow = true
      o.receiveShadow = true
    }
  })

  /* ---------- 动画 ----------
   * 一个 update 吃「移动 / 冲刺 / 是否着地 / 垂直速度 / 速度」，
   * 内部合成 walk → run → sprint 的连续步态，以及起跳收腿、落地屈膝。
   */
  const state = {
    t: 0,
    phase: 0,
    move: 0,
    sprint: 0,
    air: 0,
    land: 0,
    lean: 0,
    prevGrounded: true,
    prevVy: 0
  }

  function update(dt, opts = {}) {
    const moving = !!opts.moving
    const sprinting = !!opts.sprinting
    const grounded = opts.grounded !== false
    const vy = opts.vy || 0
    const speed = opts.speed || 0
    const airHeight = Math.max(0, opts.airHeight || 0)
    // 地面坡度（弧度）：由 player 采样脚下地形传入。
    // 人物整体绕脚底中心倾斜，两只脚才会同时贴住坡面，而不是「两只脚在一个水平面上」。
    const groundPitch = opts.groundPitch || 0
    const groundRoll = opts.groundRoll || 0
    // 左右脚各自的抬升量（台阶 / 路缘一边高一边低）
    const footLift = opts.footLift || [0, 0]

    state.t = (state.t + dt) % 1000
    const t = state.t

    // 步频跟着真实速度走：走得慢就迈得慢，冲刺时腿才是「快」的
    state.phase += dt * (moving ? 5.0 + speed * 1.1 : 1.0)

    const kMove = 1 - Math.exp(-11 * dt)
    state.move += ((moving ? 1 : 0) - state.move) * kMove
    const kSprint = 1 - Math.exp(-8 * dt)
    state.sprint += ((sprinting ? 1 : 0) - state.sprint) * kSprint
    const kAir = 1 - Math.exp(-13 * dt)
    state.air += ((grounded ? 0 : 1) - state.air) * kAir

    // 落地冲击：从空中回到地面的那一下
    if (grounded && !state.prevGrounded) state.land = Math.min(1, Math.abs(state.prevVy) / 8.5)
    state.prevGrounded = grounded
    state.prevVy = vy
    state.land = Math.max(0, state.land - dt / 0.24)

    const m = state.move
    const sp = state.sprint
    const air = state.air
    const landing = state.land
    const stride = state.phase

    // 身体前倾：模型朝 -Z，前倾是 rotation.x 取负
    const leanTarget = -(0.05 * m + 0.26 * sp) * (1 - air * 0.55) - 0.04 * air * (vy > 0 ? 1 : -0.4)
    state.lean += (leanTarget - state.lean) * Math.min(1, 9 * dt)
    body.rotation.x = state.lean
    body.rotation.z = Math.sin(stride) * 0.035 * m * (1 + sp * 0.7)

    // 整体随地形倾斜（只转 bob，不转影子），角色才像站在坡上而不是嵌进去
    bob.rotation.x = groundPitch
    bob.rotation.z = groundRoll

    // 重心起伏 + 落地压缩
    const bobY = Math.sin(stride * 2) * (0.014 + 0.026 * sp) * m
    const breathe = Math.sin(t * 1.7) * 0.008 * (1 - m)
    bob.position.y = bobY + breathe
    body.position.y = BODY_LIFT - landing * 0.05

    // 头：抵消身体前倾，顺便表现步伐的上下颠
    head.rotation.x = -state.lean * 0.58 + Math.sin(stride * 2 + 0.6) * 0.016 * m
    head.rotation.z = -Math.sin(stride) * 0.02 * m
    head.rotation.y = Math.sin(t * 0.7) * 0.05 * (1 - m)
    head.position.y = 1.14 + Math.sin(stride * 2 + 1.2) * 0.009 * m

    // 腿：短腿靠「髋部前后摆 + 抬膝」出步态，不靠拉长
    const swing = 0.56 * m + 0.72 * sp
    const kneeAmp = 0.8 * m + 1.0 * sp
    const rise = Math.max(0, vy) / 7.4
    const fall = Math.max(0, -vy) / 7.4
    for (let li = 0; li < legs.length; li++) {
      const leg = legs[li]
      const ph = stride + (leg.side > 0 ? Math.PI : 0)
      const swinging = Math.max(0, Math.sin(ph + 0.85))
      const hipSwing = Math.sin(ph) * swing
      const kneeSwing = -(0.06 + swinging * kneeAmp) * m

      // 空中姿势：起跳收腿、最高点保持屈膝、下落把脚伸向地面
      const hipAir = 0.16 + 0.28 * rise - 0.05 * fall
      const kneeAir = 0.45 + 0.55 * rise + 0.2 * fall

      leg.hip.rotation.x = (1 - air) * hipSwing + air * hipAir + landing * -0.16
      leg.hip.rotation.z = leg.side * (0.03 + air * 0.12 + sp * 0.02)
      leg.knee.rotation.x =
        (1 - air) * kneeSwing + air * -kneeAir - landing * 0.42 - (1 - air) * 0.02
      // 踝：接地时脚掌尽量贴平坡面，空中脚尖下垂
      leg.ankle.rotation.x =
        -(leg.hip.rotation.x + leg.knee.rotation.x) * 0.6 * (1 - air) - air * 0.1 + landing * 0.14
      // 单脚高度修正：台阶边缘一只脚高一脚低时，把高那只脚抬起来，
      // 大脚掌会盖住小腿接缝，所以看起来像膝盖自然弯曲，而不是脚陷进台阶。
      leg.ankle.position.y = -LEG.shin + (1 - air) * footLift[li]
    }

    // 手：左手随步伐摆（和左腿反相），右手握戟保持稳定
    armL.rotation.x = 0.25 + Math.sin(stride + Math.PI) * (0.3 * m + 0.34 * sp)
    armL.rotation.z = -0.6 - 0.05 * m
    armR.rotation.x = 0.908 + Math.sin(stride) * 0.04 * m
    trident.rotation.z = 0.06 + Math.sin(t * 1.4) * 0.015

    // 翅膀：站着轻扇，跑起来扇得更快，跳起来张开缓冲
    const flapFreq = 3.0 + m * 4.5 + sp * 3.5
    const flap = Math.sin(t * flapFreq + air * 1.5)
    const amp = 0.1 + m * 0.16 + sp * 0.14 + air * 0.3
    const spread = air * 0.5 + sp * 0.2
    wingR.rotation.z = 0.12 + flap * amp + spread
    wingL.rotation.z = -0.12 - flap * amp - spread
    wingR.rotation.y = -0.78 - m * 0.1 - spread * 0.7
    wingL.rotation.y = 0.78 + m * 0.1 + spread * 0.7

    // 尾巴分节摆动：跑得越快甩得越开，跳起来向后拉直
    for (let i = 0; i < tailSegs.length; i++) {
      tailSegs[i].rotation.y =
        Math.sin(t * 2.4 - i * 0.55) * (0.06 + i * 0.03) * (1 + m * 0.5 + sp * 0.5)
      tailSegs[i].rotation.x = -0.05 - i * 0.018 + Math.sin(t * 1.6 - i * 0.4) * 0.025 - air * 0.16
    }

    // 软阴影：跟着坡面转，跳得越高越小越淡
    blob.rotation.x = -Math.PI / 2 + groundPitch
    blob.rotation.z = groundRoll
    blob.position.y = 0.02 - airHeight
    const bs = Math.max(0.4, 1 - airHeight * 0.32)
    blob.scale.setScalar(bs)
    blob.material.opacity = Math.max(0.12, 0.85 - airHeight * 0.42)
  }

  // 手办比例 0.88：短粗腿 + 大脚掌，总高约 1.86m
  root.scale.setScalar(0.88)

  return {
    group: root,
    update,
    body,
    blob,
    legs,
    bodyLift: BODY_LIFT,
    height: (BODY_LIFT + 1.66) * 0.88,
    materials: { BODY_MAT, BODY_DEEP, ACCENT_MAT, ACCENT_DARK, MEMBRANE_MAT }
  }
}

