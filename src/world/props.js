import * as THREE from 'three'

// 道具注册表：新增 type 必须在这里登记，world.json 只能引用登记过的 type
// 约定：pos 是「底面中心」，所以几何体一律上传到 h/2
const MAT = {
  trunk: new THREE.MeshStandardMaterial({ color: 0x6b5844, roughness: 0.9 }),
  leaf: new THREE.MeshStandardMaterial({ color: 0x4f7a4a, roughness: 0.85 }),
  wood: new THREE.MeshStandardMaterial({ color: 0xb9a284, roughness: 0.75 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x8d9298, roughness: 0.5, metalness: 0.3 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x22262e, roughness: 0.7 }),
  board: new THREE.MeshStandardMaterial({ color: 0x2b3a33, roughness: 0.95 })
}

function box(w, h, d, mat, y = h / 2) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
  m.position.y = y
  m.castShadow = true
  m.receiveShadow = true
  return m
}

// 黑板字：用 2D canvas 画中文再当纹理，不建模字体
function makeBoardTexture() {
  const c = document.createElement('canvas')
  c.width = 1024
  c.height = 900
  const x = c.getContext('2d')

  x.fillStyle = '#22352c'
  x.fillRect(0, 0, c.width, c.height)
  // 粉笔灰
  for (let i = 0; i < 900; i++) {
    x.fillStyle = `rgba(235,240,232,${Math.random() * 0.05})`
    x.fillRect(Math.random() * c.width, Math.random() * c.height, 2, 2)
  }

  x.fillStyle = 'rgba(245,243,232,.92)'
  x.font = '700 74px "Microsoft YaHei", "PingFang SC", sans-serif'
  x.fillText('AIE1101', 80, 150)
  x.font = '500 40px "Microsoft YaHei", "PingFang SC", sans-serif'
  x.fillStyle = 'rgba(245,243,232,.7)'
  x.fillText('Final Project · Campus Sandbox', 84, 210)

  x.strokeStyle = 'rgba(245,243,232,.35)'
  x.lineWidth = 3
  x.beginPath(); x.moveTo(80, 250); x.lineTo(944, 250); x.stroke()

  x.fillStyle = 'rgba(245,243,232,.95)'
  x.font = '700 64px "Microsoft YaHei", "PingFang SC", sans-serif'
  x.fillText('点名 · Roll Call', 84, 370)
  x.font = '500 38px "Microsoft YaHei", "PingFang SC", sans-serif'
  x.fillStyle = 'rgba(245,243,232,.8)'
  x.fillText('Answer the question.', 84, 440)
  x.fillText('答错一次，请出教室。', 84, 500)

  x.fillStyle = 'rgba(255,196,75,.85)'
  x.font = '700 34px "Microsoft YaHei", sans-serif'
  x.fillText('2026 · AIE1101', 700, 820)

  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

const builders = {
  tree() {
    const g = new THREE.Group()
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 1.4, 8), MAT.trunk)
    trunk.position.y = 0.7
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5, 0), MAT.leaf)
    crown.position.y = 2.4
    crown.castShadow = true
    g.add(trunk, crown)
    return { object: g, solid: [0.5, 2.6, 0.5] }
  },

  bench() {
    const g = new THREE.Group()
    g.add(box(1.7, 0.08, 0.46, MAT.wood, 0.44))
    g.add(box(1.7, 0.34, 0.06, MAT.wood, 0.62).translateZ(-0.2))
    const legL = box(0.08, 0.44, 0.42, MAT.metal, 0.22)
    legL.position.x = -0.7
    const legR = legL.clone()
    legR.position.x = 0.7
    g.add(legL, legR)
    return { object: g, solid: [1.7, 0.7, 0.5] }
  },

  gate() {
    const g = new THREE.Group()
    g.add(box(0.18, 1.2, 0.18, MAT.metal, 0.6).translateX(-1.0))
    g.add(box(0.18, 1.2, 0.18, MAT.metal, 0.6).translateX(1.0))
    g.add(box(2.2, 0.16, 0.16, MAT.metal, 1.2))
    return { object: g, solid: [0.3, 1.2, 0.3] }
  },

  desk() {
    const g = new THREE.Group()
    g.add(box(1.2, 0.05, 0.62, MAT.wood, 0.73))
    const leg = box(0.05, 0.72, 0.05, MAT.metal, 0.36)
    ;[[-0.52, -0.26], [0.52, -0.26], [-0.52, 0.26], [0.52, 0.26]].forEach(([x, z]) => {
      const l = leg.clone()
      l.position.set(x, 0.36, z)
      g.add(l)
    })
    const seat = box(0.44, 0.05, 0.42, MAT.dark, 0.44)
    seat.position.z = 0.56
    const back = box(0.44, 0.42, 0.05, MAT.dark, 0.68)
    back.position.set(0, 0.68, 0.76)
    g.add(seat, back)
    return { object: g, solid: [1.2, 0.78, 1.05] }
  },

  podium() {
    const g = new THREE.Group()
    g.add(box(2.4, 2.2, 0.12, MAT.board, 1.55).translateZ(-0.28)) // 黑板
    // 黑板字：贴一张 canvas 纹理，不建模字体
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 1.95),
      new THREE.MeshBasicMaterial({ map: makeBoardTexture() })
    )
    face.position.set(0, 1.55, -0.215)
    g.add(face)
    g.add(box(1.7, 1.0, 0.62, MAT.wood, 0.5))
    g.add(box(1.9, 0.06, 0.7, MAT.wood, 1.03))
    return { object: g, solid: [1.9, 1.1, 0.8] }
  },

  // 门不再按 type 后缀区分，通到哪里由数据里的 to 决定（schema v2）
  door(data) {
    if (!data.to) {
      console.warn('[props] door 缺少 to 字段，已跳过', data)
      return null
    }
    return doorProp(0x7a6a52, data.to)
  }
}

// 门本身不挡路：靠 E 交互 + director 淡入淡出切区
function doorProp(color, anchorId) {
  const g = new THREE.Group()
  const frame = new THREE.MeshStandardMaterial({ color: 0x2a2e36, roughness: 0.8 })
  const leaf = new THREE.MeshStandardMaterial({ color, roughness: 0.6 })
  g.add(box(2.2, 0.12, 0.24, frame, 2.26))
  g.add(box(0.12, 2.2, 0.24, frame, 1.1).translateX(-1.05))
  g.add(box(0.12, 2.2, 0.24, frame, 1.1).translateX(1.05))
  g.add(box(1.9, 2.15, 0.08, leaf, 1.08))
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), MAT.metal)
  knob.position.set(0.78, 1.05, 0.1)
  g.add(knob)
  return { object: g, solid: null, interact: { anchorId, radius: 2.2 } }
}

export function createProp(type, data = {}) {
  const make = builders[type]
  if (!make) {
    console.warn(`[props] 未登记的 type: ${type}（已跳过，请在 world/props.js 登记）`)
    return null
  }
  return make(data)
}

export const PROP_TYPES = Object.keys(builders)
