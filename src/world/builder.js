import * as THREE from 'three'
import { createProp } from './props.js'

const WALL_T = 0.22
const DOOR_W = 2.2

const M = {
  paving: new THREE.MeshStandardMaterial({ color: 0xb9b3a6, roughness: 0.95 }),
  lawn: new THREE.MeshStandardMaterial({ color: 0x7d9464, roughness: 1 }),
  facade: new THREE.MeshStandardMaterial({ color: 0xd8cfc0, roughness: 0.9 }),
  wall: new THREE.MeshStandardMaterial({ color: 0xe6e0d4, roughness: 0.95 }),
  floor: new THREE.MeshStandardMaterial({ color: 0x8e8577, roughness: 0.9 }),
  ceiling: new THREE.MeshStandardMaterial({ color: 0xf0ece2, roughness: 1 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x9fc2cf, transparent: true, opacity: 0.35, roughness: 0.15, metalness: 0.1 })
}

// 墙面 / 地面统一用「底面中心」对齐
function slab(w, h, d, mat, cx, cy, cz) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
  m.position.set(cx, cy + h / 2, cz)
  m.castShadow = true
  m.receiveShadow = true
  return m
}

function worldAABB(cx, cy, cz, w, h, d) {
  return {
    min: new THREE.Vector3(cx - w / 2, cy, cz - d / 2),
    max: new THREE.Vector3(cx + w / 2, cy + h, cz + d / 2)
  }
}

function parseShell(shell) {
  const m = /^room_([\d.]+)x([\d.]+)x([\d.]+)$/.exec(shell)
  if (!m) {
    console.warn(`[builder] 无法解析 shell: ${shell}，回退 10x8x4`)
    return { w: 10, d: 8, h: 4 }
  }
  return { w: +m[1], d: +m[2], h: +m[3] }
}

export function anchorLabel(id) {
  const raw = id.replace(/^a_/, '')
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

/**
 * 读 world.json → 场景 + 碰撞盒 + 锚点 + 机位
 * 返回结构供 player / camera / bits 查询，不反向依赖它们
 */
export function buildWorld(data, scene) {
  const zones = {}
  const anchors = new Map()
  const interactables = []
  const roomCameras = {}
  const buildings = []
  const root = new THREE.Group()
  scene.add(root)

  const texLoader = new THREE.TextureLoader()

  /* ---------- 室外 ---------- */
  const out = data.outdoor
  const [gw, gd] = out.ground.size
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(gw, gd), M.paving)
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  root.add(ground)

  // 广场边界用绿化带收边（比隐形墙好看，也让 bounds 有视觉依据）
  const [[bx0, bz0], [bx1, bz1]] = out.bounds
  const edgeMat = M.lawn
  const edge = 0.6
  root.add(slab(bx1 - bx0, 0.12, edge, edgeMat, (bx0 + bx1) / 2, 0, bz0))
  root.add(slab(bx1 - bx0, 0.12, edge, edgeMat, (bx0 + bx1) / 2, 0, bz1))
  root.add(slab(edge, 0.12, bz1 - bz0, edgeMat, bx0, 0, (bz0 + bz1) / 2))
  root.add(slab(edge, 0.12, bz1 - bz0, edgeMat, bx1, 0, (bz0 + bz1) / 2))

  const outdoorColliders = []
  zones.outdoor = {
    id: 'outdoor',
    colliders: outdoorColliders,
    bounds: { min: new THREE.Vector3(bx0 + 0.4, 0, bz0 + 0.4), max: new THREE.Vector3(bx1 - 0.4, 0, bz1 - 0.4) }
  }

  for (const b of out.buildings) {
    const [w, h, d] = b.size
    const mat = M.facade.clone()
    // facade 只是文件名，缺图就用纯色，不阻塞 W0
    texLoader.load(
      `/textures/${b.facade}`,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace
        mat.map = tex
        mat.color.set(0xffffff)
        mat.needsUpdate = true
      },
      undefined,
      () => console.info(`[builder] 缺贴图 /textures/${b.facade}，用纯色代替`)
    )
    const mesh = slab(w, h, d, mat, b.pos[0], b.pos[1], b.pos[2])
    mesh.rotation.y = THREE.MathUtils.degToRad(b.rotationY || 0)
    root.add(mesh)
    const buildingBox = worldAABB(b.pos[0], b.pos[1], b.pos[2], w, h, d)
    outdoorColliders.push(buildingBox)
    // 校长的 16 点刷点要排除建筑
    buildings.push(buildingBox)
  }

  for (const p of out.props) {
    const built = createProp(p.type, p)
    if (!built) continue
    built.object.position.set(p.pos[0], p.pos[1], p.pos[2])
    built.object.rotation.y = THREE.MathUtils.degToRad(p.rotationY || 0)
    root.add(built.object)

    if (built.solid) {
      const [w, h, d] = built.solid
      const rot = ((p.rotationY || 0) % 180 + 180) % 180
      const sw = rot === 90 ? d : w
      const sd = rot === 90 ? w : d
      outdoorColliders.push(worldAABB(p.pos[0], p.pos[1], p.pos[2], sw, h, sd))
    }
    if (built.interact) {
      interactables.push({
        zone: 'outdoor',
        pos: new THREE.Vector3(p.pos[0], 0, p.pos[2]),
        radius: built.interact.radius,
        anchorId: built.interact.anchorId,
        label: anchorLabel(built.interact.anchorId)
      })
    }
  }

  for (const a of out.anchors) addAnchor(a, 'outdoor')

  /* ---------- 室内 ---------- */
  for (const room of data.rooms) {
    const [ox, oy, oz] = room.origin
    const { w, d, h } = parseShell(room.shell)
    // kind 由数据显式声明（schema v2），不再靠长宽比猜房间类型
    const kind = room.kind || 'room'
    if (kind !== 'room' && kind !== 'corridor') {
      console.warn(`[builder] ${room.id} 的 kind="${kind}" 不认识，按 room 处理`)
    }
    const isCorridor = kind === 'corridor'
    const colliders = []

    const g = new THREE.Group()
    g.position.set(ox, oy, oz)
    root.add(g)

    g.add(slab(w, 0.15, d, M.floor, 0, -0.15, 0))
    g.add(slab(w + 0.4, 0.2, d + 0.4, M.ceiling, 0, h, 0))

    const wallH = h
    // 长边墙（左右）
    for (const sx of [-1, 1]) {
      const cx = (sx * w) / 2
      if (isCorridor) {
        // 为了「两侧有窗」：下段 0-0.9，上段 2.6-h，中间留空当窗
        g.add(slab(WALL_T, 0.9, d, M.wall, cx, 0, 0))
        g.add(slab(WALL_T, wallH - 2.6, d, M.wall, cx, 2.6, 0))
        g.add(slab(WALL_T, 0.08, d, M.glass, cx, 2.5, 0))
      } else {
        g.add(slab(WALL_T, wallH, d, M.wall, cx, 0, 0))
      }
      colliders.push(worldAABB(ox + cx, oy, oz, WALL_T, wallH, d))
    }

    // 短边墙（前后）：连廊两端敞开，普通房间后墙实、前墙留门洞
    if (!isCorridor) {
      g.add(slab(w, wallH, WALL_T, M.wall, 0, 0, -d / 2))
      colliders.push(worldAABB(ox, oy, oz - d / 2, w, wallH, WALL_T))

      const side = (w - DOOR_W) / 2
      for (const sx of [-1, 1]) {
        const cx = sx * (DOOR_W / 2 + side / 2)
        g.add(slab(side, wallH, WALL_T, M.wall, cx, 0, d / 2))
        colliders.push(worldAABB(ox + cx, oy, oz + d / 2, side, wallH, WALL_T))
      }
      // 门洞上方的过梁
      g.add(slab(DOOR_W, wallH - 2.4, WALL_T, M.wall, 0, 2.4, d / 2))
    }

    for (const p of room.props || []) {
      const built = createProp(p.type, p)
      if (!built) continue
      built.object.position.set(p.pos[0], p.pos[1], p.pos[2])
      built.object.rotation.y = THREE.MathUtils.degToRad(p.rotationY || 0)
      g.add(built.object)
      if (built.solid) {
        const [pw, ph, pd] = built.solid
        const rot = ((p.rotationY || 0) % 180 + 180) % 180
        colliders.push(
          worldAABB(ox + p.pos[0], oy + p.pos[1], oz + p.pos[2], rot === 90 ? pd : pw, ph, rot === 90 ? pw : pd)
        )
      }
    }

    zones[room.id] = { id: room.id, colliders, bounds: null, origin: new THREE.Vector3(ox, oy, oz), size: { w, d, h } }

    // 房间出口：schema v2.1 用 room.exit 指定门外锚点，缺省回广场
    const exitId = room.exit || 'a_plaza'
    interactables.push({
      zone: room.id,
      pos: new THREE.Vector3(ox, 0, oz + d / 2 + 0.6),
      radius: 2.0,
      anchorId: exitId,
      label: anchorLabel(exitId)
    })

    if (room.camera) {
      const cp = room.camera.pos
      const inside =
        Math.abs(cp[0]) < w / 2 - WALL_T && Math.abs(cp[2]) < d / 2 - WALL_T && cp[1] > 0.2 && cp[1] < h - 0.1
      if (!inside) {
        console.warn(`[builder] ${room.id} 的机位 [${cp}] 落在房间外面（房间 ${w}×${d}×${h}），看到的会是盒子外壳`)
      }
      roomCameras[room.id] = {
        // camera.pos 按「房间局部坐标」解释（world.json 里是相对 origin 的）
        pos: new THREE.Vector3(ox + room.camera.pos[0], oy + room.camera.pos[1], oz + room.camera.pos[2]),
        lookAt: new THREE.Vector3(ox + room.camera.lookAt[0], oy + room.camera.lookAt[1], oz + room.camera.lookAt[2]),
        fov: room.camera.fov || 50
      }
    }

    for (const a of room.anchors) addAnchor(a, room.id)
  }

  function addAnchor(a, zoneId) {
    if (anchors.has(a.id)) {
      console.warn(`[builder] 锚点 id 重复：${a.id}`)
      return
    }
    anchors.set(a.id, {
      id: a.id,
      label: anchorLabel(a.id),
      zone: zoneId,
      pos: new THREE.Vector3(a.pos[0], a.pos[1], a.pos[2]),
      yaw: a.yaw || 0
    })
  }

  // 锚点顺序就是选点界面 1-4 的顺序：教室 / 连廊 / 图书馆 / 广场。
  // a_out_* 只是房间出口，不进选点列表（schema v2.1）。
  const order = ['a_classroom', 'a_corridor', 'a_library', 'a_plaza']
  const anchorList = order.map((id) => anchors.get(id)).filter(Boolean)

  // 门的 to 必须在锚点表里存在，否则按 E 会没反应（这类数据错误最难自查）
  for (const it of interactables) {
    if (!anchors.has(it.anchorId)) {
      console.warn(`[builder] 门/出口指向了不存在的锚点：${it.anchorId}（zone=${it.zone}）`)
    }
  }
  const known = new Set(anchorList.map((a) => a.id))
  for (const id of order) {
    if (!known.has(id)) console.warn(`[builder] 缺少锚点 ${id}，选点界面会少一项`)
  }

  return { root, zones, anchors, anchorList, interactables, roomCameras, buildings }
}
