import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * 校园层：读 campus.json（全校园体块）→ 合并几何 → 一个 zone
 * 与 builder.js 的区别：builder 造「能进去的房间」，这里只造「看得见的楼」
 * 返回结构与 buildWorld 同形（zones / anchors / anchorList / interactables / roomCameras），
 * 所以 player / camera / bits 不需要知道用的是哪一套
 */

const WALL_H = 3.9 // 层高，与规格 §5 一致
const WIN_W = 3.2 // 一个窗格的横向模数

const STYLE = {
  admin: { wall: 0xdad6cc, roof: 0xa7a197, sign: 0x8c8578 },
  teach: { wall: 0xcec8bb, roof: 0x9b958a, sign: 0x87806f },
  lib: { wall: 0xdccfbd, roof: 0xa69881, sign: 0x8d7c63 },
  research: { wall: 0xc2c7c9, roof: 0x8e949e, sign: 0x76808c },
  conf: { wall: 0xd3cabe, roof: 0x9f9486, sign: 0x847968 },
  college: { wall: 0xe2d4c0, roof: 0xae987d, sign: 0x94795c },
  sport: { wall: 0xc0c7cf, roof: 0x89939e, sign: 0x6f7b87 },
  dorm: { wall: 0xd7cec1, roof: 0xa39a8a, sign: 0x89806f },
  service: { wall: 0xd1cbbf, roof: 0x9e9687, sign: 0x857d6e }
}

// 灰度砖缝纹理：靠材质 color 上色，同一条纹理复用到广场 / 道路 / 操场
let pavingTex = null
function getPavingTex() {
  if (pavingTex) return pavingTex
  const S = 128
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, S, S)
  g.strokeStyle = '#c9c9c9'
  g.lineWidth = 2
  g.strokeRect(0, 0, S, S)
  g.strokeStyle = '#dcdcdc'
  g.lineWidth = 1
  g.beginPath()
  g.moveTo(S / 2, 0)
  g.lineTo(S / 2, S)
  g.moveTo(0, S / 2)
  g.lineTo(S, S / 2)
  g.stroke()
  pavingTex = new THREE.CanvasTexture(c)
  pavingTex.wrapS = pavingTex.wrapT = THREE.RepeatWrapping
  pavingTex.colorSpace = THREE.SRGBColorSpace
  pavingTex.anisotropy = 4
  return pavingTex
}

// 每块地面按自己的尺寸设 repeat，砖缝才不会随尺寸拉伸
function pavingMat(color, w, d, cell = 4) {
  const t = getPavingTex().clone()
  t.needsUpdate = true
  t.repeat.set(Math.max(1, w / cell), Math.max(1, d / cell))
  return new THREE.MeshStandardMaterial({ color, map: t, roughness: 0.95 })
}

// 一张灰度窗格纹理，靠材质 color 上色：一栋楼一种色，窗格本身是灰的
function makeWindowTexture() {
  const S = 256
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')

  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, S, S)

  // 窗洞：偏上留窗台，偏下留墙裙
  const wx = S * 0.2
  const wy = S * 0.14
  const ww = S * 0.6
  const wh = S * 0.6
  const grd = g.createLinearGradient(0, wy, 0, wy + wh)
  grd.addColorStop(0, '#6b7b8a')
  grd.addColorStop(1, '#3f4b58')
  g.fillStyle = grd
  g.fillRect(wx, wy, ww, wh)

  g.strokeStyle = '#f0f0f0'
  g.lineWidth = S * 0.022
  g.strokeRect(wx, wy, ww, wh)
  g.beginPath()
  g.moveTo(S / 2, wy)
  g.lineTo(S / 2, wy + wh)
  g.stroke()

  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

// BoxGeometry 六面 uv 依次是 px/nx/py/ny/pz/nz，每面 4 顶点
// 按「几个窗宽 / 几层」缩 uv，让所有楼的窗格是同一个物理尺寸
function tileUV(geo, w, h, d) {
  const uv = geo.attributes.uv
  const cols = Math.max(1, Math.round(w / WIN_W))
  const colsSide = Math.max(1, Math.round(d / WIN_W))
  const rows = Math.max(1, Math.round(h / WALL_H))
  const faces = [
    [0, colsSide, rows],
    [4, colsSide, rows],
    [8, 1, 1],
    [12, 1, 1],
    [16, cols, rows],
    [20, cols, rows]
  ]
  for (const [start, su, sv] of faces) {
    for (let i = start; i < start + 4; i++) {
      uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv)
    }
  }
  uv.needsUpdate = true
}

function aabb(x, y, z, w, h, d) {
  return {
    min: new THREE.Vector3(x - w / 2, y, z - d / 2),
    max: new THREE.Vector3(x + w / 2, y + h, z + d / 2)
  }
}

// 固定种子的伪随机：每次加载树的分布一致，方便截图对比
function makeRandom(seed = 20261120) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

function buildTrees(root, data, colliders) {
  const rand = makeRandom()
  const half = data.ground.size[0] / 2 - 40
  const pts = []
  let guard = 0
  while (pts.length < 900 && guard < 26000) {
    guard++
    const x = (rand() * 2 - 1) * half
    const z = (rand() * 2 - 1) * half
    let bad = false

    for (const b of colliders) {
      if (x > b.min.x - 6 && x < b.max.x + 6 && z > b.min.z - 6 && z < b.max.z + 6) {
        bad = true
        break
      }
    }
    if (bad) continue

    for (const w of data.water || []) {
      if (Math.abs(x - w.pos[0]) < w.size[0] / 2 + 8 && Math.abs(z - w.pos[2]) < w.size[2] / 2 + 8) {
        bad = true
        break
      }
    }
    if (bad) continue

    // 广场 / 操场 / 球场不长树，锚点周围也留出空地，免得一棵树怼在镜头中央
    for (const lm of data.landmarks || []) {
      if (Math.abs(x - lm.pos[0]) < lm.size[0] / 2 + 6 && Math.abs(z - lm.pos[2]) < lm.size[2] / 2 + 6) {
        bad = true
        break
      }
    }
    if (bad) continue

    for (const a of data.anchors || []) {
      if (Math.hypot(x - a.pos[0], z - a.pos[2]) < 14) {
        bad = true
        break
      }
    }
    if (bad) continue

    // 主轴上不种，留出视线
    if (Math.abs(x) < 16) continue

    pts.push([x, z])
  }

  const trunkGeo = new THREE.CylinderGeometry(0.38, 0.5, 5.2, 6)
  trunkGeo.translate(0, 2.6, 0)
  // 阔叶树冠：低面数二十面体压扁一点，比圆锥少一点塑料感
  const crownGeo = new THREE.IcosahedronGeometry(4.6, 1)
  crownGeo.scale(1, 1.12, 1)
  crownGeo.translate(0, 9.4, 0)

  const trunk = new THREE.InstancedMesh(
    trunkGeo,
    new THREE.MeshStandardMaterial({ color: 0x6b5642, roughness: 1 }),
    pts.length
  )
  const crown = new THREE.InstancedMesh(
    crownGeo,
    new THREE.MeshStandardMaterial({ color: 0x5f7d4e, roughness: 1 }),
    pts.length
  )
  const m = new THREE.Matrix4()
  pts.forEach(([x, z], i) => {
    m.makeTranslation(x, 0, z)
    trunk.setMatrixAt(i, m)
    crown.setMatrixAt(i, m)
  })
  trunk.castShadow = crown.castShadow = true
  trunk.receiveShadow = crown.receiveShadow = true
  root.add(trunk, crown)
  return pts.length
}

export function buildCampus(data, scene) {
  const root = new THREE.Group()
  root.name = 'campus'
  scene.add(root)

  const anchors = new Map()
  const colliders = []
  const [exMin, exMinZ, exMax, exMaxZ] = data.meta.extent

  /* ---------- 地面 / 草坪 / 水 / 路 ---------- */
  const groundW = data.ground.size[0]
  const groundD = data.ground.size[1]

  // 草坪铺得比校区大一圈，避免鸟瞰时看到「浮岛」边缘
  const lawn = new THREE.Mesh(
    new THREE.PlaneGeometry(groundW * 2.4, groundD * 2.4),
    new THREE.MeshStandardMaterial({ color: 0x788a63, roughness: 1 })
  )
  lawn.rotation.x = -Math.PI / 2
  lawn.position.y = -0.02
  lawn.receiveShadow = true
  root.add(lawn)

  for (const r of data.roads || []) {
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(r.size[0], r.size[2]),
      pavingMat(0x5c5f63, r.size[0], r.size[2], 8)
    )
    road.rotation.x = -Math.PI / 2
    road.position.set(r.pos[0], 0.06, r.pos[2])
    road.receiveShadow = true
    root.add(road)
  }

  for (const w of data.water || []) {
    // 浅水边（大一圈、色更浅）+ 深水（原尺寸），两层叠出岸线层次
    const shallow = new THREE.Mesh(
      new THREE.PlaneGeometry(w.size[0] + 14, w.size[2] + 14),
      new THREE.MeshStandardMaterial({ color: 0x86a9ad, roughness: 0.3, metalness: 0.2 })
    )
    shallow.rotation.x = -Math.PI / 2
    shallow.position.set(w.pos[0], 0.07, w.pos[2])
    root.add(shallow)

    const lake = new THREE.Mesh(
      new THREE.PlaneGeometry(w.size[0], w.size[2]),
      new THREE.MeshStandardMaterial({ color: 0x3d6f7d, roughness: 0.1, metalness: 0.5 })
    )
    lake.rotation.x = -Math.PI / 2
    lake.position.set(w.pos[0], 0.1, w.pos[2])
    root.add(lake)
  }

  // 下沉广场 / 田径场 / 球场：用浅色铺装表示，不参与碰撞
  for (const lm of data.landmarks || []) {
    const color = lm.id === 'track' ? 0x7d4a41 : lm.id === 'courts' ? 0x44617c : 0xb5ae9f
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(lm.size[0], lm.size[2]),
      pavingMat(color, lm.size[0], lm.size[2], lm.id === 'track' ? 6 : 3.2)
    )
    pad.rotation.x = -Math.PI / 2
    pad.position.set(lm.pos[0], 0.08, lm.pos[2])
    pad.receiveShadow = true
    root.add(pad)

    if (lm.id === 'track') {
      const inner = new THREE.Mesh(
        new THREE.PlaneGeometry(lm.size[0] - 24, lm.size[2] - 24),
        new THREE.MeshStandardMaterial({ color: 0x6f8a57, roughness: 1 })
      )
      inner.rotation.x = -Math.PI / 2
      inner.position.set(lm.pos[0], 0.09, lm.pos[2])
      root.add(inner)
    }
  }

  /* ---------- 建筑：按 style 合并成少数 draw call ---------- */
  const tex = makeWindowTexture()
  const bucket = {}

  for (const b of data.buildings || []) {
    const [x, , z] = b.pos
    const [w, h, d] = b.size
    const style = STYLE[b.style] ? b.style : 'teach'

    if (!bucket[style]) bucket[style] = { walls: [], caps: [] }

    const wall = new THREE.BoxGeometry(w, h, d)
    tileUV(wall, w, h, d)
    wall.translate(x, h / 2, z)
    bucket[style].walls.push(wall)

    // 檐口：略外扩 1.6m，压住顶面，顺便给楼一条水平线
    const cap = new THREE.BoxGeometry(w + 1.6, 0.7, d + 1.6)
    cap.translate(x, h - 0.15, z)
    bucket[style].caps.push(cap)

    colliders.push(aabb(x, 0, z, w, h, d))
  }

  let meshCount = 0
  for (const [style, g] of Object.entries(bucket)) {
    const cfg = STYLE[style]
    const wallMesh = new THREE.Mesh(
      mergeGeometries(g.walls),
      new THREE.MeshStandardMaterial({
        color: cfg.wall,
        map: tex,
        roughness: 0.82,
        metalness: 0.03
      })
    )
    wallMesh.castShadow = true
    wallMesh.receiveShadow = true
    wallMesh.name = `walls_${style}`
    root.add(wallMesh)

    const capMesh = new THREE.Mesh(
      mergeGeometries(g.caps),
      new THREE.MeshStandardMaterial({ color: cfg.roof, roughness: 0.9 })
    )
    capMesh.castShadow = true
    capMesh.receiveShadow = true
    capMesh.name = `caps_${style}`
    root.add(capMesh)

    meshCount += 2
  }

  const treeCount = buildTrees(root, data, colliders)

  /* ---------- 锚点 ---------- */
  for (const a of data.anchors || []) {
    anchors.set(a.id, {
      id: a.id,
      zone: 'outdoor',
      pos: new THREE.Vector3(a.pos[0], a.pos[1] || 0, a.pos[2]),
      yaw: a.yaw || 0,
      label: a.name || a.id,
      en: a.en || ''
    })
  }

  /* ---------- zone：player 只认 colliders + bounds ---------- */
  const zones = {
    outdoor: {
      id: 'outdoor',
      colliders,
      bounds: {
        min: new THREE.Vector3(exMin, 0, exMinZ),
        max: new THREE.Vector3(exMax, 0, exMaxZ)
      },
      origin: new THREE.Vector3(0, 0, 0),
      size: { w: groundW, d: groundD, h: 40 }
    }
  }

  const stats = {
    buildings: (data.buildings || []).length,
    trees: treeCount,
    drawCalls: meshCount + 2 + (data.roads || []).length + (data.water || []).length,
    source: data.meta.source
  }

  console.info(
    `[campus] ${stats.buildings} 栋 / ${stats.trees} 棵树 / 约 ${stats.drawCalls} draw call（数据源：${stats.source}）`
  )

  return {
    root,
    zones,
    anchors,
    anchorList: [...anchors.values()],
    interactables: [],
    roomCameras: {},
    districts: data.districts || [],
    campusStats: stats
  }
}
