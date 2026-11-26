import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import {
  PALETTE,
  styleKeyFor,
  facadeMaps,
  stoneTexture,
  asphaltTexture,
  pavingTexture,
  grassTexture,
  signTexture,
  palmTrunkGeometry,
  palmFrondGeometry,
  lampGeometry,
  lampHeadGeometry,
  lobbyMaps,
  rippleNormal,
  UV_U,
  UV_V,
  interiorFloorTexture
} from './facade.js'
import { initTerrain, addFlatSpot, heightAt, dropGeometry, bakeGround } from './terrain.js'

/**
 * 校园层（真实轮廓版）：读 campus-osm.json（由 tools/osm-extract.mjs 从 OSM 省包切出）
 *
 * 与 campus.js 的区别：
 *   campus.js   用「矩形体块」摆一个示意校园（坐标是估的）
 *   本文件      用 OSM 的真实多边形轮廓，按边生成墙面（坐标是实测绘的）
 *
 * 视觉参照港中大（深圳）实景：
 *   浅灰石材 + 竖向铝格栅 + 带状玻璃；图书馆青灰墙配黄色点缀；
 *   书院各有一套主色（学勤淡黄、祥波朱红、道扬蓝白、厚含橙白、第七紫白）；
 *   屋顶深灰压顶、裙房石材勒脚、锈红格栅屏风、成排行道树与棕榈。
 *
 * 返回结构与 buildWorld / buildCampus 同形，player / camera / bits 无需感知。
 */

/**
 * 校区范围（局部米，+X 东、+Z 南）
 * 只保留港中大（深圳）本体：西到神仙岭水库，东到信息学院西墙，
 * 北到上园书院，南到龙翔大道。周边大运中心、信息学院、住宅区不参与渲染，
 * 否则整张图会变成「一片城市」而不是校园。
 */
const CAMPUS = { minX: -1700, maxX: -10, minZ: -560, maxZ: 360 }

function inCampus(x, z) {
  return x > CAMPUS.minX && x < CAMPUS.maxX && z > CAMPUS.minZ && z < CAMPUS.maxZ
}

/* ---------------- 多边形工具 ---------------- */

function signedArea(pts) {
  let a = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1]
  }
  return a / 2
}

function centroid(pts) {
  let x = 0
  let z = 0
  for (const p of pts) {
    x += p[0]
    z += p[1]
  }
  return [x / pts.length, z / pts.length]
}

function bboxOf(pts) {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const [x, z] of pts) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  return { minX, maxX, minZ, maxZ }
}

function pointInPoly(x, z, pts) {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i]
    const [xj, zj] = pts[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

function polygonPlane(pts, y) {
  const shape = new THREE.Shape()
  shape.moveTo(pts[0][0], -pts[0][1])
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], -pts[i][1])
  shape.closePath()
  const geo = new THREE.ShapeGeometry(shape)
  geo.rotateX(-Math.PI / 2)
  geo.translate(0, y, 0)
  return geo
}

function offsetPolygon(pts, k) {
  const [cx, cz] = centroid(pts)
  return pts.map(([x, z]) => [cx + (x - cx) * k, cz + (z - cz) * k])
}

/** 给几何体刷一层顶点色，用于把多栋楼合并成一个 mesh */
function paintGeometry(geo, hex, mul = 1) {
  const c = new THREE.Color(hex).multiplyScalar(mul)
  const n = geo.attributes.position.count
  const arr = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r
    arr[i * 3 + 1] = c.g
    arr[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  return geo
}

function tintOf(id) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 997
  return 0.88 + ((h % 100) / 100) * 0.2
}

/* ---------------- 墙 / 腰线 ---------------- */

/**
 * 按多边形的每一条边生成一片墙面
 * @param uScale 每多少米一个 UV 循环（横向）
 * @param vScale 每多少米一个 UV 循环（竖向）
 */
function wallGeometry(poly, y0, y1, uScale, vScale, tint = 1) {
  const pos = []
  const nor = []
  const uv = []
  const col = []
  const idx = []

  const ccw = signedArea(poly) > 0
  const [cx, cz] = centroid(poly)
  let v = 0

  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j]
    const [bx, bz] = poly[i]
    const dx = bx - ax
    const dz = bz - az
    const len = Math.hypot(dx, dz)
    if (len < 0.4) continue

    let nx = dz / len
    let nz = -dx / len
    const mx = (ax + bx) / 2 - cx
    const mz = (az + bz) / 2 - cz
    if (nx * mx + nz * mz < 0) {
      nx = -nx
      nz = -nz
    }

    pos.push(ax, y0, az, ax, y1, az, bx, y1, bz, bx, y0, bz)
    for (let k = 0; k < 4; k++) {
      nor.push(nx, 0, nz)
      col.push(tint, tint, tint)
    }

    const u = len / uScale
    const vTop = (y1 - y0) / vScale
    uv.push(0, 0, 0, vTop, u, vTop, u, 0)

    if (ccw) idx.push(v, v + 1, v + 2, v, v + 2, v + 3)
    else idx.push(v, v + 2, v + 1, v, v + 3, v + 2)
    v += 4
  }

  if (!v) return null
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  geo.setIndex(idx)
  return geo
}

/* ---------------- 道路 / 铺装 ---------------- */

function ribbonGeometry(path, width, y, uvScale = 8) {
  if (path.length < 2) return null
  const half = width / 2
  const left = []
  const right = []

  for (let i = 0; i < path.length; i++) {
    const p = path[i]
    const prev = path[Math.max(0, i - 1)]
    const next = path[Math.min(path.length - 1, i + 1)]
    let dx = next[0] - prev[0]
    let dz = next[1] - prev[1]
    const len = Math.hypot(dx, dz) || 1
    dx /= len
    dz /= len
    const nx = -dz
    const nz = dx
    left.push([p[0] + nx * half, p[1] + nz * half])
    right.push([p[0] - nx * half, p[1] - nz * half])
  }

  const pos = []
  const nor = []
  const uv = []
  const idx = []
  let v = 0
  let run = 0

  for (let i = 0; i < path.length - 1; i++) {
    const a = left[i]
    const b = right[i]
    const c = left[i + 1]
    const d = right[i + 1]
    const segLen = Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1])
    const v0 = run / uvScale
    const v1 = (run + segLen) / uvScale
    run += segLen

    // 每个顶点各自贴合地形：路是沿坡走的，不是一块斜板
    pos.push(
      a[0], heightAt(a[0], a[1]) + y, a[1],
      b[0], heightAt(b[0], b[1]) + y, b[1],
      c[0], heightAt(c[0], c[1]) + y, c[1],
      d[0], heightAt(d[0], d[1]) + y, d[1]
    )
    for (let k = 0; k < 4; k++) nor.push(0, 1, 0)
    uv.push(0, v0, 1, v0, 0, v1, 1, v1)
    idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3)
    v += 4
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setIndex(idx)
  return geo
}

/* ---------------- 树 ---------------- */

function makeRandom(seed = 20261120) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

function scatterTrees(data, boxes, LB, limit = 1000) {
  const rand = makeRandom()
  const pts = []
  const { minX, maxX, minZ, maxZ } = LB
  const w = maxX - minX
  const d = maxZ - minZ

  const blocked = (x, z, pad) => {
    for (const b of boxes) {
      if (x > b.minX - pad && x < b.maxX + pad && z > b.minZ - pad && z < b.maxZ + pad) return true
    }
    return false
  }

  for (const g of data.greens || []) {
    const area = Math.abs(signedArea(g.polygon))
    const n = Math.min(220, Math.floor(area / 320))
    const bb = bboxOf(g.polygon)
    let tries = 0
    let placed = 0
    while (placed < n && tries < n * 14) {
      tries++
      const x = bb.minX + rand() * (bb.maxX - bb.minX)
      const z = bb.minZ + rand() * (bb.maxZ - bb.minZ)
      if (!pointInPoly(x, z, g.polygon)) continue
      if (blocked(x, z, 4)) continue
      pts.push([x, z])
      placed++
    }
  }

  // 行道树：沿主要道路两侧每 15m 一棵
  for (const r of data.roads || []) {
    if (r.width < 5 || r.bridge || r.path.length < 2) continue
    let acc = 0
    for (let i = 0; i < r.path.length - 1; i++) {
      const [ax, az] = r.path[i]
      const [bx, bz] = r.path[i + 1]
      const len = Math.hypot(bx - ax, bz - az)
      if (len < 0.5) continue
      const dx = (bx - ax) / len
      const dz = (bz - az) / len
      const nx = -dz
      const nz = dx
      const off = r.width / 2 + 3.2
      for (let dd = acc; dd < len; dd += 15) {
        const px = ax + dx * dd
        const pz = az + dz * dd
        for (const s of [1, -1]) {
          const tx = px + nx * off * s
          const tz = pz + nz * off * s
          if (blocked(tx, tz, 3)) continue
          if (pts.length >= limit) break
          pts.push([tx, tz])
        }
      }
      acc = (acc + len) % 15
    }
  }

  let tries = 0
  while (pts.length < limit && tries < limit * 14) {
    tries++
    const x = minX + rand() * w
    const z = minZ + rand() * d
    if (blocked(x, z, 6)) continue
    let wet = false
    for (const wt of data.water || []) {
      const bb = bboxOf(wt.polygon)
      if (x > bb.minX - 6 && x < bb.maxX + 6 && z > bb.minZ - 6 && z < bb.maxZ + 6) {
        wet = true
        break
      }
    }
    if (wet) continue
    if (pts.some((p) => Math.abs(p[0] - x) < 8 && Math.abs(p[1] - z) < 8)) continue
    pts.push([x, z])
  }

  return pts
}

/** 棕榈：只种在大块绿地和湖边，深圳感最强的一层 */
function scatterPalms(data, boxes, limit = 110) {
  const rand = makeRandom(8801)
  const out = []
  const blocked = (x, z) =>
    boxes.some((b) => x > b.minX - 3 && x < b.maxX + 3 && z > b.minZ - 3 && z < b.maxZ + 3)

  const spots = [...(data.greens || [])].sort(
    (a, b) => Math.abs(signedArea(b.polygon)) - Math.abs(signedArea(a.polygon))
  )
  for (const g of spots) {
    const area = Math.abs(signedArea(g.polygon))
    if (area < 1200) continue
    const n = Math.min(18, Math.floor(area / 2600))
    const bb = bboxOf(g.polygon)
    let placed = 0
    let tries = 0
    while (placed < n && tries < n * 20) {
      tries++
      const x = bb.minX + rand() * (bb.maxX - bb.minX)
      const z = bb.minZ + rand() * (bb.maxZ - bb.minZ)
      if (!pointInPoly(x, z, g.polygon)) continue
      if (blocked(x, z)) continue
      out.push([x, z])
      placed++
      if (out.length >= limit) return out
    }
  }
  return out
}

/* ---------------- 锚点 ---------------- */

const ANCHOR_RULES = [
  { id: 'a_library', keys: ['图书馆', 'library'], prefer: '大学图书馆', label: '图书馆', en: 'Library' },
  { id: 'a_teach', keys: ['教学楼', 'teaching', 'lecture'], prefer: '教学楼b', label: '教学楼', en: 'Teaching Building' },
  { id: 'a_admin', keys: ['行政', 'administration'], prefer: '行政楼', label: '行政楼', en: 'Administration' },
  { id: 'a_sports', keys: ['体育馆', '体育', 'sports'], prefer: '大学体育馆', label: '体育馆', en: 'Sports Center' },
  { id: 'a_college', keys: ['书院', 'college'], prefer: '学勤书院', label: '书院', en: 'College' },
  { id: 'a_lab', keys: ['实验', 'research', '科研'], prefer: '科研楼', label: '科研楼', en: 'Research Building' }
]

function pickAnchors(buildings, waters = []) {
  const named = buildings.filter(
    (b) => (b.name || b.nameEn) && b.polygon.length >= 4 && b.style !== 'utility' && (b.height || 0) >= 8
  )
  const boxes = buildings.map((b) => bboxOf(b.polygon))
  const inAnyBox = (x, z, pad = 2) =>
    boxes.some((bx) => x > bx.minX - pad && x < bx.maxX + pad && z > bx.minZ - pad && z < bx.maxZ + pad)
  const inWater = (x, z) => waters.some((w) => pointInPoly(x, z, w.polygon))

  function freeSpot(x, z) {
    if (!inAnyBox(x, z) && !inWater(x, z)) return [x, z]
    for (let r = 4; r <= 120; r += 4) {
      for (let a = 0; a < 360; a += 12) {
        const rad = (a * Math.PI) / 180
        const px = x + Math.cos(rad) * r
        const pz = z + Math.sin(rad) * r
        if (!inAnyBox(px, pz) && !inWater(px, pz)) return [px, pz]
      }
    }
    return [x, z]
  }

  const anchors = []
  const used = new Set()

  for (const rule of ANCHOR_RULES) {
    let best = null
    let bestArea = 0
    for (const b of named) {
      if (used.has(b.id)) continue
      const hay = `${b.name || ''} ${b.nameEn || ''}`.toLowerCase()
      if (!rule.keys.some((k) => hay.includes(k.toLowerCase()))) continue
      const area = Math.abs(signedArea(b.polygon))
      const preferHit = rule.prefer && hay.includes(rule.prefer.toLowerCase()) ? 1e7 : 0
      if (preferHit + area > bestArea) {
        bestArea = preferHit + area
        best = b
      }
    }
    if (!best) continue
    used.add(best.id)
    const [cx, cz] = centroid(best.polygon)
    const dist = Math.hypot(cx, cz) || 1
    let ax = cx
    let az = cz
    for (let t = 0; t <= 60; t += 2) {
      const px = cx - (cx / dist) * t
      const pz = cz - (cz / dist) * t
      if (!pointInPoly(px, pz, best.polygon)) {
        ax = px
        az = pz
        break
      }
    }
    // 出楼之后再多退 7m：贴着墙出生的话，第三人称机位会顶在墙上，一睁眼全是墙皮
    const ox = ax - cx
    const oz = az - cz
    const ol = Math.hypot(ox, oz) || 1
    const [fx, fz] = freeSpot(ax + (ox / ol) * 7, az + (oz / ol) * 7)
    anchors.push({
      id: rule.id,
      zone: 'outdoor',
      pos: new THREE.Vector3(fx, 0, fz),
      yaw: (Math.atan2(fx, fz) * 180) / Math.PI,
      label: best.name || rule.label,
      en: best.nameEn || rule.en,
      building: best
    })
  }

  return anchors
}

/** 在道路折线上找离给定点最近的点，用来把出生点放在路上而不是草坪里 */
function nearestRoadPoint(roads, x, z) {
  let best = [x, z]
  let bd = Infinity
  for (const r of roads) {
    if (r.bridge) continue
    for (const p of r.path) {
      const d = (p[0] - x) ** 2 + (p[1] - z) ** 2
      if (d < bd) {
        bd = d
        best = p
      }
    }
  }
  return best
}

/** 找多边形上离锚点最近的顶点，用来放雨棚和标牌 */
function nearestVertex(poly, x, z) {
  let best = poly[0]
  let bd = Infinity
  for (const p of poly) {
    const d = (p[0] - x) ** 2 + (p[1] - z) ** 2
    if (d < bd) {
      bd = d
      best = p
    }
  }
  return best
}

/* ---------------- 主入口 ---------------- */

export function buildCampusOSM(data, scene) {
  const root = new THREE.Group()
  root.name = 'campus-osm'
  scene.add(root)

  // 只取校区范围内的要素；范围外的大运中心 / 信息学院 / 住宅区全部丢掉
  const allBuildings = data.buildings || []
  const buildings = allBuildings.filter((b) => {
    if (!b.polygon || b.polygon.length < 3) return false
    const [cx, cz] = centroid(b.polygon)
    return inCampus(cx, cz)
  })

  const view = {
    roads: (data.roads || []).filter((r) => {
      const [cx, cz] = centroid(r.path)
      return inCampus(cx, cz)
    }),
    greens: (data.greens || []).filter((g) => {
      const [cx, cz] = centroid(g.polygon)
      return inCampus(cx, cz)
    }),
    pitches: (data.pitches || []).filter((p) => {
      const [cx, cz] = centroid(p.polygon)
      return inCampus(cx, cz)
    }),
    // 水面放宽：神仙岭水库在校区西边界外，但它是校园最重要的景观背景
    water: (data.water || []).filter((w) => {
      if (w.polygon.some(([x, z]) => inCampus(x, z))) return true
      const [cx, cz] = centroid(w.polygon)
      return (
        cx > CAMPUS.minX - 420 &&
        cx < CAMPUS.maxX + 240 &&
        cz > CAMPUS.minZ - 240 &&
        cz < CAMPUS.maxZ + 240
      )
    })
  }

  const boxes = buildings.map((b) => bboxOf(b.polygon))
  const colliders = []
  // 建筑碰撞用「真实多边形」而不是外接矩形：
  // L 形 / U 形的楼，外接矩形会把中间的院子和凹口一起堵死，视觉上明明能走却撞墙。
  const polyColliders = []

  /* ---------- 地形 ----------
   * 先把地形高程定下来：水面和运动场需要「压平」，而压平的目标高度本身
   * 要用未压平时的地形算，所以顺序必须是 init → 算高度 → addFlatSpot。
   */
  initTerrain()
  const waterPlanes = []
  for (const w of view.water || []) {
    if (Math.abs(signedArea(w.polygon)) < 60) continue
    const [wcx, wcz] = centroid(w.polygon)
    let rMax = 0
    for (const [px, pz] of w.polygon) rMax = Math.max(rMax, Math.hypot(px - wcx, pz - wcz))
    waterPlanes.push({ poly: w.polygon, cx: wcx, cz: wcz, r: rMax, level: heightAt(wcx, wcz) })
  }
  // 水池：把周围压平到 waterLevel，水面就比岸低不了多少 —— 之前压到 level-0.35 而水面在 level+0.05，
  // 中间露了 40cm 的缝，从侧面能看见水面下面是草。
  for (const w of waterPlanes) {
    w.surface = w.level - 0.32
    addFlatSpot(w.cx, w.cz, w.r + 26, w.surface - 0.05)
  }
  // 运动场要平：跑道建在坡上会变成滑梯
  const pitchLevels = new Map()
  for (const p of view.pitches || []) {
    if (Math.abs(signedArea(p.polygon)) < 900) continue
    const [pcx, pcz] = centroid(p.polygon)
    const bb = bboxOf(p.polygon)
    const r = Math.max(bb.maxX - bb.minX, bb.maxZ - bb.minZ) * 0.62 + 6
    const lv = heightAt(pcx, pcz)
    pitchLevels.set(p, lv)
    addFlatSpot(pcx, pcz, r, lv)
  }

  /* ---------- 范围 ---------- */
  const LB = {
    minX: CAMPUS.minX,
    maxX: CAMPUS.maxX,
    minZ: CAMPUS.minZ,
    maxZ: CAMPUS.maxZ
  }
  const spanX = LB.maxX - LB.minX
  const spanZ = LB.maxZ - LB.minZ

  /* ---------- 地表 ---------- */
  const lawnTex = grassTexture().clone()
  lawnTex.needsUpdate = true
  lawnTex.repeat.set(spanX / 9, spanZ / 9)
  // 草地用细网格 + 顶点色做低频色差：一张贴图铺满 1.6km 一定会看出重复，
  // 叠一层 100m 级的明暗起伏，「整片塑料草皮」的感觉就没了
  // 地形网格：4km 见方要盖住远景，但校区里又要有 20–30m 的精度，
  // 折中 128×72 格（32m 一格）；再密三角面就顶到红线了，树那边会一起降数量
  const LAWN_SEG = 128
  const LAWN_SEG_Z = 72
  const lawnGeo = new THREE.PlaneGeometry(spanX * 2.4, spanZ * 2.4, LAWN_SEG, LAWN_SEG_Z)
  {
    const lp = lawnGeo.attributes.position
    const lc = new Float32Array(lp.count * 3)
    const h2 = (a, b) => {
      const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
      return s - Math.floor(s)
    }
    const noise = (x, y) => {
      const xi = Math.floor(x)
      const yi = Math.floor(y)
      const xf = x - xi
      const yf = y - yi
      const u = xf * xf * (3 - 2 * xf)
      const v = yf * yf * (3 - 2 * yf)
      const a = h2(xi, yi) * (1 - u) + h2(xi + 1, yi) * u
      const b = h2(xi, yi + 1) * (1 - u) + h2(xi + 1, yi + 1) * u
      return a * (1 - v) + b * v
    }
    // 平面绕 X 转 -90° 之后：local(x, y, z) → world(cx + x, z, cz - y)
    const cx0 = (LB.minX + LB.maxX) / 2
    const cz0 = (LB.minZ + LB.maxZ) / 2
    for (let i = 0; i < lp.count; i++) {
      const x = lp.getX(i)
      const y = lp.getY(i)
      const n = noise(x / 120, y / 120) * 0.55 + noise(x / 38, y / 38) * 0.3 + noise(x / 11, y / 11) * 0.15
      const t = 0.88 + n * 0.26
      lc[i * 3] = t * 1.02
      lc[i * 3 + 1] = t
      lc[i * 3 + 2] = t * 0.94
      // 高程写进 local z（转完就是世界 y）
      lp.setZ(i, heightAt(cx0 + x, cz0 - y))
    }
    lp.needsUpdate = true
    lawnGeo.computeVertexNormals()
    lawnGeo.setAttribute('color', new THREE.BufferAttribute(lc, 3))

    // 关键：把这张网格的高度「烘焙」成唯一地面来源。
    // 之后的路、树、楼、以及**玩家的脚**，全部按逐三角形插值取值，
    // 和渲染出来的地面对齐，不会再出现「下半身被地面削掉」。
    const heights = new Float32Array(lp.count)
    for (let i = 0; i < lp.count; i++) heights[i] = lp.getZ(i)
    bakeGround(
      cx0 - (spanX * 2.4) / 2,
      cz0 + (spanZ * 2.4) / 2,
      (spanX * 2.4) / LAWN_SEG,
      (spanZ * 2.4) / LAWN_SEG_Z,
      LAWN_SEG,
      LAWN_SEG_Z,
      heights,
      -0.03 // 地表 mesh 自身还压低了 3cm
    )
  }
  const lawn = new THREE.Mesh(
    lawnGeo,
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: lawnTex,
      vertexColors: true,
      roughness: 1,
      envMapIntensity: 0.3
    })
  )
  lawn.rotation.x = -Math.PI / 2
  lawn.position.set((LB.minX + LB.maxX) / 2, -0.03, (LB.minZ + LB.maxZ) / 2)
  lawn.receiveShadow = true
  lawn.name = 'osm_lawn'
  root.add(lawn)

  /* ---------- 远景丘陵 ----------
   * 学校的实际位置在龙岗的山坳里，地平线是层层叠叠的小山，不是一条直线。
   * 一圈环面 + 正弦叠加的脊线就够用：站在地面只看到 1km 内，远景全靠雾吃掉细节。
   */
  {
    const cx = (LB.minX + LB.maxX) / 2
    const cz = (LB.minZ + LB.maxZ) / 2
    const R0 = 900
    const R1 = 3000
    const SEG = 160
    const RINGS = 9
    const ridgeAt = (a) =>
      (Math.sin(a * 2 + 0.7) * 0.5 + 0.5) * 0.42 +
      (Math.sin(a * 5 + 2.1) * 0.5 + 0.5) * 0.26 +
      (Math.sin(a * 9 + 4.3) * 0.5 + 0.5) * 0.18 +
      (Math.sin(a * 17 + 1.1) * 0.5 + 0.5) * 0.14
    const pos = []
    const col = []
    const idx = []
    for (let j = 0; j <= RINGS; j++) {
      const t = j / RINGS
      const r = R0 + (R1 - R0) * t
      for (let i = 0; i <= SEG; i++) {
        const a = (i / SEG) * Math.PI * 2
        const ridge = ridgeAt(a)
        // 内圈沉到地面以下，从草坪里「长」出来，不会留下一道圆环裂缝
        const h = -14 + Math.pow(t, 1.42) * (40 + ridge * 175)
        pos.push(cx + Math.cos(a) * r, h, cz + Math.sin(a) * r)
        const k = 0.86 + ridge * 0.3 - t * 0.1
        col.push(0.33 * k, 0.41 * k, 0.3 * k)
      }
    }
    const stride = SEG + 1
    for (let j = 0; j < RINGS; j++) {
      for (let i = 0; i < SEG; i++) {
        const a = j * stride + i
        const b = a + 1
        const c = a + stride
        const d = c + 1
        // 逆时针朝上，法线才朝 +Y；顺手反了的话整圈山会背面剔除、凭空消失
        idx.push(a, b, c, b, d, c)
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    geo.setIndex(idx)
    geo.computeVertexNormals()
    const hills = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        vertexColors: true,
        roughness: 1,
        flatShading: true,
        envMapIntensity: 0.2
      })
    )
    hills.name = 'osm_hills'
    root.add(hills)
  }

  /* ---------- 绿地 ----------
   * 有了地形之后，绿地不能再用「一个平面多边形」画：几百米的多边形只有边界顶点，
   * 三角化之后会直接穿进山坡里。草地统一由地表网格 + 顶点色承担，这里只留一个开关。
   */
  const greenGeos = []
  const DRAW_GREENS = false
  const greenPalette = [1.0, 0.965, 1.02, 0.985]
  let gi = 0
  for (const g of DRAW_GREENS ? view.greens || [] : []) {
    if (Math.abs(signedArea(g.polygon)) < 600) continue
    const geo = polygonPlane(g.polygon, 0.025)
    const k = greenPalette[gi++ % greenPalette.length]
    const col = new Float32Array(geo.attributes.position.count * 3)
    for (let i = 0; i < geo.attributes.position.count; i++) {
      col[i * 3] = k
      col[i * 3 + 1] = k
      col[i * 3 + 2] = k
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    greenGeos.push(geo)
  }
  if (greenGeos.length) {
    // 草坪用纯色：和底层草皮贴图叠在一起会出现明显的「迷彩块」
    const m = new THREE.Mesh(
      mergeGeometries(greenGeos),
      new THREE.MeshStandardMaterial({
        color: 0x94a76b,
        vertexColors: true,
        roughness: 1,
        envMapIntensity: 0.25
      })
    )
    m.receiveShadow = true
    root.add(m)
  }

  /* ---------- 球场（按颜色合并，压 draw call） ---------- */
  const PITCH_COLOR = { track: 0x9a5b4c, stadium: 0x74905a, pitch: 0x608a4c }
  const pitchBuckets = {}
  for (const p of view.pitches || []) {
    if (Math.abs(signedArea(p.polygon)) < 40) continue
    const color = p.sport && /basket|volley|tennis/i.test(p.sport) ? 0x4c6d8c : PITCH_COLOR[p.kind] || 0x74905a
    if (!pitchBuckets[color]) pitchBuckets[color] = []
    const lv = pitchLevels.has(p) ? pitchLevels.get(p) : heightAt(...centroid(p.polygon))
    pitchBuckets[color].push(polygonPlane(p.polygon, lv + 0.12))
  }
  for (const [color, geos] of Object.entries(pitchBuckets)) {
    const mesh = new THREE.Mesh(
      mergeGeometries(geos),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(+color), roughness: 0.95, envMapIntensity: 0.2 })
    )
    mesh.receiveShadow = true
    root.add(mesh)
  }

  /* ---------- 水体 + 石岸（所有水面合成 3 个 mesh） ---------- */
  const rimGeos = []
  const shallowGeos = []
  const deepGeos = []
  for (const w of waterPlanes) {
    const [cx, cz] = [w.cx, w.cz]
    // 石岸：按形心整体放大 3%，不要「每个顶点沿法线外推 1.6m」——
    // 凹多边形那样外推会自交，earcut 三角化后会吐出几条横跨整个池子的薄片，
    // 在水面高度上看起来就是一条不该存在的横带。按形心缩放永远不会自交。
    const rim = w.poly.map(([x, z]) => [cx + (x - cx) * 1.03, cz + (z - cz) * 1.03])
    // 水面必须是一个水平面：取该水体压平后的高度，别跟着地形一起歪
    rimGeos.push(polygonPlane(rim, w.surface - 0.015))
    shallowGeos.push(polygonPlane(w.poly, w.surface + 0.02))

    const inner = w.poly.map(([x, z]) => [cx + (x - cx) * 0.982, cz + (z - cz) * 0.982])
    deepGeos.push(polygonPlane(inner, w.surface + 0.04))
  }
  if (rimGeos.length) {
    const m = new THREE.Mesh(
      mergeGeometries(rimGeos),
      new THREE.MeshStandardMaterial({ color: 0x938b7c, roughness: 0.95 })
    )
    m.receiveShadow = true
    root.add(m)
  }
  if (shallowGeos.length) {
    root.add(
      new THREE.Mesh(
        mergeGeometries(shallowGeos),
        new THREE.MeshPhysicalMaterial({
          color: 0x41646c,
          roughness: 0.08,
          metalness: 0.35,
          envMapIntensity: 1.6,
          clearcoat: 1,
          clearcoatRoughness: 0.04,
          normalMap: rippleNormal(),
          normalScale: new THREE.Vector2(0.16, 0.16),
          polygonOffset: true,
          polygonOffsetFactor: -2
        })
      )
    )
    root.add(
      new THREE.Mesh(
        mergeGeometries(deepGeos),
        new THREE.MeshPhysicalMaterial({
          color: 0x244a54,
          roughness: 0.04,
          metalness: 0.25,
          envMapIntensity: 1.9,
          transparent: true,
          opacity: 0.86
        })
      )
    )
  }

  /* ---------- 道路：人行道 → 车行道 ---------- */
  const walkGeos = []
  const roadGeos = []
  const pathGeos = []
  const curbGeos = []
  let roadCount = 0

  for (const r of view.roads || []) {
    if (r.bridge) continue
    const width = Math.max(2.2, r.width * 1.45)
    if (r.width >= 5) {
      if (r.width >= 6.5) {
        const walk = ribbonGeometry(r.path, width + 4.2, 0.03, 4)
        if (walk) walkGeos.push(walk)
      }
      const g = ribbonGeometry(r.path, width, 0.05, 9)
      if (g) {
        roadGeos.push(g)
        roadCount++
      }
    } else {
      // 步道加一圈 0.3m 的混凝土路缘：没有这条边，沥青就像直接刷在草地上
      const edge = ribbonGeometry(r.path, width + 0.6, 0.035, 3)
      if (edge) curbGeos.push(edge)
      const g = ribbonGeometry(r.path, width, 0.045, 6)
      if (g) {
        pathGeos.push(g)
        roadCount++
      }
    }
  }

  const paving = pavingTexture()
  const walkTex = paving.clone()
  walkTex.needsUpdate = true
  walkTex.repeat.set(5, 1)
  if (walkGeos.length) {
    const m = new THREE.Mesh(
      mergeGeometries(walkGeos),
      new THREE.MeshStandardMaterial({ color: 0xffffff, map: walkTex, roughness: 0.95, envMapIntensity: 0.25, polygonOffset: true, polygonOffsetFactor: -1 })
    )
    m.receiveShadow = true
    m.name = 'osm_sidewalk'
    root.add(m)
  }
  if (pathGeos.length) {
    const m = new THREE.Mesh(
      mergeGeometries(pathGeos),
      new THREE.MeshStandardMaterial({ color: 0xffffff, map: asphaltTexture(false), roughness: 0.98 })
    )
    m.receiveShadow = true
    m.name = 'osm_paths'
    root.add(m)
  }
  if (curbGeos.length) {
    const m = new THREE.Mesh(
      mergeGeometries(curbGeos),
      new THREE.MeshStandardMaterial({
        color: 0xc6c0b1,
        roughness: 0.96,
        envMapIntensity: 0.2,
        polygonOffset: true,
        polygonOffsetFactor: -1
      })
    )
    m.receiveShadow = true
    m.name = 'osm_curbs'
    root.add(m)
  }
  if (roadGeos.length) {
    const road = new THREE.Mesh(
      mergeGeometries(roadGeos),
      new THREE.MeshStandardMaterial({ color: 0xffffff, map: asphaltTexture(true), roughness: 0.92, envMapIntensity: 0.25 })
    )
    road.receiveShadow = true
    road.name = 'osm_roads'
    root.add(road)
  }

  /* ---------- 建筑 ---------- */
  const bucket = {}
  const roofGeos = []
  const parapetGeos = []
  const lobbyGeos = []
  const plinthGeos = []
  const unitGeos = []
  const apronGeos = []
  let skipped = 0

  const roofRnd = makeRandom(31337)
  const enterable = []
  const ENTERABLE = /教学楼|图书馆|行政|学生中心|科研|实验/

  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i]
    if (!b.polygon || b.polygon.length < 3) {
      skipped++
      continue
    }
    const key = styleKeyFor(b)
    if (!bucket[key]) bucket[key] = { walls: [] }
    const cfg = PALETTE[key] || PALETTE.academic

    const h = Math.max(3, Math.min(120, b.height || 15))
    const tint = tintOf(b.id)

    // 楼基：取 footprint 的最高点往下退 1.8m（最多埋进坡里 1.8m），
    // 而不是取形心平均高度 —— 否则大台阶地上的楼会「一半悬空一半进山」。
    // footprint 内的高差全部由勒脚 / 基础裙吃掉。
    let hMin = Infinity
    let hMax = -Infinity
    for (const [px, pz] of b.polygon) {
      const hh = heightAt(px, pz)
      if (hh < hMin) hMin = hh
      if (hh > hMax) hMax = hh
    }
    const base = Math.max(hMin + 0.3, hMax - 1.8)
    const foot = hMin - 1.6

    const wall = wallGeometry(b.polygon, base, base + h, UV_U, UV_V, tint)
    if (wall) bucket[key].walls.push(wall)
    roofGeos.push(paintGeometry(polygonPlane(b.polygon, base + h + 0.03), cfg.roof, 0.9))

    // 石材勒脚 + 一段埋进土里的基础：坡地上楼不会「悬空」也不会「浮着」
    const plinth = wallGeometry(offsetPolygon(b.polygon, 1.018), foot, base + 1.15, 4, 1.15, tint)
    if (plinth) plinthGeos.push(plinth)

    // 底层大堂玻璃（3.4m 高），让楼不是直接从草里长出来的方盒子
    if (Math.abs(signedArea(b.polygon)) > 240) {
      const lobby = wallGeometry(offsetPolygon(b.polygon, 1.008), base + 0.9, base + 4.35, 8, 3.45, tint)
      if (lobby) lobbyGeos.push(lobby)
    }

    // 屋顶压顶：深灰 / 书院主色，远看就是一条清晰的轮廓线
    const cap = wallGeometry(offsetPolygon(b.polygon, 1.02), base + h - 0.15, base + h + 0.62, 4, 0.77, 1)
    if (cap) parapetGeos.push(paintGeometry(cap, cfg.accent))

    // 屋面设备：大一点的楼放 1-2 个机房盒子，打破平屋顶
    const area = Math.abs(signedArea(b.polygon))
    if (area > 1400 && h > 10) {
      const bb = boxes[i]
      const n = area > 5000 ? 2 : 1
      for (let k = 0; k < n; k++) {
        const w = (bb.maxX - bb.minX) * (0.18 + roofRnd() * 0.12)
        const d = (bb.maxZ - bb.minZ) * (0.14 + roofRnd() * 0.1)
        const hh = 1.3 + roofRnd() * 1.6
        const cx = bb.minX + (bb.maxX - bb.minX) * (0.3 + k * 0.38)
        const cz = bb.minZ + (bb.maxZ - bb.minZ) * (0.32 + roofRnd() * 0.34)
        const box = new THREE.BoxGeometry(w, hh, d)
        box.translate(cx, base + h + hh / 2, cz)
        unitGeos.push(box)
      }
    }

    // 铺装裙边
    const bb = boxes[i]
    const span = Math.max(bb.maxX - bb.minX, bb.maxZ - bb.minZ, 4)
    const k = 1 + 13 / span
    const [gx, gz] = centroid(b.polygon)
    const apronGeo = polygonPlane(
      b.polygon.map(([x, z]) => [gx + (x - gx) * k, gz + (z - gz) * k]),
      base + 0.02
    )
    apronGeos.push(dropGeometry(apronGeo, 0.05))

    colliders.push({
      min: new THREE.Vector3(bb.minX, 0, bb.minZ),
      max: new THREE.Vector3(bb.maxX, h, bb.maxZ)
    })
    // 碰撞用「勒脚外轮廓」而不是楼体轮廓：勒脚比楼体向外鼓 1.8% 且高出地面，
    // 之前玩家能贴到楼体边上，身体和腿就会插进勒脚 / 台阶里。
    const plinthPoly = offsetPolygon(b.polygon, 1.018)
    polyColliders.push({ poly: plinthPoly, bbox: bboxOf(plinthPoly) })

    // 登记「可以进去」的楼：教学 / 图书馆 / 行政 / 学生中心 / 科研，体量够大的
    if (ENTERABLE.test(`${b.name || ''} ${b.nameEn || ''}`) && area > 600 && enterable.length < 6) {
      enterable.push({ b, base, h })
    }
  }

  // 裙边
  const apronTex = paving.clone()
  apronTex.needsUpdate = true
  apronTex.repeat.set(0.5, 0.5)
  if (apronGeos.length) {
    const apron = new THREE.Mesh(
      mergeGeometries(apronGeos),
      new THREE.MeshStandardMaterial({ color: 0xffffff, map: apronTex, roughness: 0.94, envMapIntensity: 0.25 })
    )
    apron.receiveShadow = true
    apron.name = 'osm_pavement'
    root.add(apron)
  }

  // 勒脚
  if (plinthGeos.length) {
    const m = new THREE.Mesh(
      mergeGeometries(plinthGeos),
      new THREE.MeshStandardMaterial({ color: 0xffffff, map: stoneTexture(), roughness: 0.9, vertexColors: true })
    )
    m.castShadow = true
    m.receiveShadow = true
    m.name = 'osm_plinth'
    root.add(m)
  }

  // 底层大堂
  if (lobbyGeos.length) {
    const lob = lobbyMaps()
    const m = new THREE.Mesh(
      mergeGeometries(lobbyGeos),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: lob.map,
        emissiveMap: lob.emissiveMap,
        emissive: 0xffd8a4,
        emissiveIntensity: 0.45,
        vertexColors: true,
        roughness: 0.34,
        metalness: 0.35,
        envMapIntensity: 1.1
      })
    )
    m.castShadow = true
    m.receiveShadow = true
    m.name = 'osm_lobbies'
    root.add(m)
  }

  let drawCalls = 5 // 地表 + 绿地 + 裙边 + 勒脚 + 大堂

  // 外墙 / 屋面按配色合并
  for (const [key, g] of Object.entries(bucket)) {
    const cfg = PALETTE[key] || PALETTE.academic
    const maps = facadeMaps(key)
    if (g.walls.length) {
      const mesh = new THREE.Mesh(
        mergeGeometries(g.walls),
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          map: maps.map,
          normalMap: maps.normalMap,
          normalScale: new THREE.Vector2(0.55, 0.55),
          emissiveMap: maps.emissiveMap,
          emissive: 0xffcf95,
          emissiveIntensity: 0.5,
          vertexColors: true,
          roughness: 0.78,
          metalness: 0.06,
          envMapIntensity: 0.55,
          side: THREE.DoubleSide
        })
      )
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.name = `osm_walls_${key}`
      root.add(mesh)
      drawCalls++
    }
  }

  // 屋面：所有楼合成一个（顶点色区分）
  if (roofGeos.length) {
    const mesh = new THREE.Mesh(
      mergeGeometries(roofGeos),
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.9,
        metalness: 0.08,
        envMapIntensity: 0.4,
        side: THREE.DoubleSide
      })
    )
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.name = 'osm_roofs'
    root.add(mesh)
    drawCalls++
  }

  // 屋顶压顶：同样合成一个
  if (parapetGeos.length) {
    const mesh = new THREE.Mesh(
      mergeGeometries(parapetGeos),
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.72,
        metalness: 0.12,
        envMapIntensity: 0.6
      })
    )
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.name = 'osm_cap'
    root.add(mesh)
    drawCalls++
  }

  // 屋顶设备
  if (unitGeos.length) {
    const mesh = new THREE.Mesh(
      mergeGeometries(unitGeos),
      new THREE.MeshStandardMaterial({ color: 0x9aa0a0, roughness: 0.85, metalness: 0.15 })
    )
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.name = 'osm_roof_units'
    root.add(mesh)
    drawCalls++
  }

  /* ---------- 树 ---------- */
  const treePts = scatterTrees(view, boxes, LB)
  let treeCount = 0
  if (treePts.length) {
    // 树干 + 三根分叉：近处能看出是一棵有结构的树，而不是一根棍子顶个球
    const trunkParts = [new THREE.CylinderGeometry(0.2, 0.36, 4.2, 7).translate(0, 2.1, 0)]
    for (let i = 0; i < 3; i++) {
      const branch = new THREE.CylinderGeometry(0.085, 0.16, 1.9, 5)
      branch.translate(0, 0.95, 0)
      branch.rotateZ(0.62 + i * 0.18)
      branch.rotateY((i / 3) * Math.PI * 2 + 0.35)
      branch.translate(0, 3.05, 0)
      trunkParts.push(branch)
    }
    const trunkGeo = mergeGeometries(trunkParts)

    // 多层次树冠：细节 1 的几何 + 5 个错落团块，轮廓不再是两个尖球；
    // 只增加实例几何的三角形，不增加 draw call，树多也不会卡。
    const blobs = [
      [0, 5.45, 0, 2.3],
      [-1.45, 4.95, 0.25, 1.75],
      [1.35, 5.0, -0.3, 1.8],
      [0.15, 6.55, 0.1, 1.65],
      [-0.55, 5.95, -1.05, 1.4],
      [0.7, 4.65, 0.95, 1.35]
    ]
    const crownParts = blobs.map(([x, y, z, r]) => {
      const g = new THREE.IcosahedronGeometry(r, 1)
      g.scale(1, 0.86 + (r % 0.2) * 0.3, 1)
      g.translate(x, y, z)
      return g
    })
    const crown = mergeGeometries(crownParts)

    const trunk = new THREE.InstancedMesh(
      trunkGeo,
      new THREE.MeshStandardMaterial({ color: 0x6a5541, roughness: 1 }),
      treePts.length
    )
    const leaves = new THREE.InstancedMesh(
      crown,
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, vertexColors: false, envMapIntensity: 0.25 }),
      treePts.length
    )

    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const s = new THREE.Vector3()
    const p = new THREE.Vector3()
    const rand = makeRandom(4242)
    const col = new THREE.Color()
    const greens = [0x5d7b43, 0x6f8d4e, 0x527039, 0x7a9657, 0x66834a]

    treePts.forEach(([x, z], i) => {
      const sc = 0.78 + rand() * 0.55
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2)
      s.set(sc, sc * (0.9 + rand() * 0.25), sc)
      p.set(x, heightAt(x, z) - 0.15, z)
      m.compose(p, q, s)
      trunk.setMatrixAt(i, m)
      leaves.setMatrixAt(i, m)
      col.setHex(greens[i % greens.length])
      col.offsetHSL((rand() - 0.5) * 0.014, (rand() - 0.5) * 0.04, (rand() - 0.5) * 0.07)
      leaves.setColorAt(i, col)
    })
    trunk.castShadow = leaves.castShadow = true
    leaves.receiveShadow = true
    root.add(trunk, leaves)
    treeCount = treePts.length
    drawCalls += 2
  }

  /* ---------- 棕榈 ---------- */
  const palmPts = scatterPalms(view, boxes)
  if (palmPts.length) {
    // 树干和叶片分开两个实例网格：树干是棕色，叶片是绿色，不能再共用一套材质
    const palmsTrunk = new THREE.InstancedMesh(
      palmTrunkGeometry(),
      new THREE.MeshStandardMaterial({ color: 0x7b6247, roughness: 0.95, envMapIntensity: 0.2 }),
      palmPts.length
    )
    const palmsLeaves = new THREE.InstancedMesh(
      palmFrondGeometry(),
      new THREE.MeshStandardMaterial({ color: 0x5f8146, roughness: 0.9, envMapIntensity: 0.3, side: THREE.DoubleSide }),
      palmPts.length
    )
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const s = new THREE.Vector3()
    const p = new THREE.Vector3()
    const rand = makeRandom(7788)
    palmPts.forEach(([x, z], i) => {
      const sc = 0.85 + rand() * 0.5
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2)
      s.set(sc, sc, sc)
      p.set(x, heightAt(x, z) - 0.1, z)
      m.compose(p, q, s)
      palmsTrunk.setMatrixAt(i, m)
      palmsLeaves.setMatrixAt(i, m)
    })
    palmsTrunk.castShadow = palmsLeaves.castShadow = true
    palmsTrunk.receiveShadow = palmsLeaves.receiveShadow = true
    root.add(palmsTrunk, palmsLeaves)
    drawCalls += 2
  }

  /* ---------- 路灯 ---------- */
  const lampPts = []
  {
    const rand = makeRandom(5150)
    for (const r of view.roads || []) {
      if (r.width < 5 || r.bridge || r.path.length < 2) continue
      let acc = 20 + rand() * 10
      for (let i = 0; i < r.path.length - 1; i++) {
        const [ax, az] = r.path[i]
        const [bx, bz] = r.path[i + 1]
        const len = Math.hypot(bx - ax, bz - az)
        if (len < 0.5) continue
        const dx = (bx - ax) / len
        const dz = (bz - az) / len
        const nx = -dz
        const nz = dx
        const off = r.width / 2 + 1.6
        for (let dd = acc; dd < len; dd += 55) {
          const side = ((Math.floor(dd / 55) + i) % 2) * 2 - 1
          lampPts.push([ax + dx * dd + nx * off * side, az + dz * dd + nz * off * side, Math.atan2(dx, dz)])
        }
        acc = (acc + len) % 55
      }
      if (lampPts.length > 180) break
    }
  }
  if (lampPts.length) {
    const pole = new THREE.InstancedMesh(
      lampGeometry(),
      new THREE.MeshStandardMaterial({ color: 0x4a4e52, roughness: 0.6, metalness: 0.5 }),
      lampPts.length
    )
    const head = new THREE.InstancedMesh(
      lampHeadGeometry(),
      new THREE.MeshStandardMaterial({ color: 0xfff2d4, emissive: 0xffd393, emissiveIntensity: 1.1, roughness: 0.4 }),
      lampPts.length
    )
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const s = new THREE.Vector3(1, 1, 1)
    const p = new THREE.Vector3()
    const axis = new THREE.Vector3(0, 1, 0)
    lampPts.forEach(([x, z, rot], i) => {
      q.setFromAxisAngle(axis, rot)
      p.set(x, heightAt(x, z), z)
      m.compose(p, q, s)
      pole.setMatrixAt(i, m)
      head.setMatrixAt(i, m)
    })
    pole.castShadow = true
    root.add(pole, head)
    drawCalls += 2
  }

  /* ---------- 人行道长椅（沿主路，每 46m 一张，避开楼和水） ---------- */
  const benchPts = []
  {
    const rand = makeRandom(8848)
    for (const r of view.roads) {
      if (r.width < 5 || r.bridge || r.path.length < 2) continue
      for (let i = 0; i < r.path.length - 1; i++) {
        const [ax, az] = r.path[i]
        const [bx, bz] = r.path[i + 1]
        const len = Math.hypot(bx - ax, bz - az)
        if (len < 8) continue
        const dx = (bx - ax) / len
        const dz = (bz - az) / len
        for (let dd = 18; dd < len; dd += 46) {
          if (benchPts.length >= 90) break
          const side = rand() > 0.5 ? 1 : -1
          const off = r.width / 2 + 2.4
          const x = ax + dx * dd - dz * off * side
          const z = az + dz * dd + dx * off * side
          if (boxes.some((b) => x > b.minX - 1.5 && x < b.maxX + 1.5 && z > b.minZ - 1.5 && z < b.maxZ + 1.5)) continue
          if (view.water.some((w) => pointInPoly(x, z, w.polygon))) continue
          benchPts.push([x, z, Math.atan2(dx, dz)])
        }
      }
    }
  }
  if (benchPts.length) {
    const seat = new THREE.BoxGeometry(1.7, 0.09, 0.5)
    seat.translate(0, 0.45, 0)
    const back = new THREE.BoxGeometry(1.7, 0.42, 0.08)
    back.translate(0, 0.68, -0.21)
    const legs = []
    for (const sx of [-0.7, 0.7]) {
      const l = new THREE.BoxGeometry(0.09, 0.45, 0.46)
      l.translate(sx, 0.22, 0)
      legs.push(l)
    }
    const benchGeo = mergeGeometries([seat, back, ...legs])
    const bench = new THREE.InstancedMesh(
      benchGeo,
      new THREE.MeshStandardMaterial({ color: 0x8a6b4a, roughness: 0.85, envMapIntensity: 0.25 }),
      benchPts.length
    )
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const s = new THREE.Vector3(1, 1, 1)
    const p = new THREE.Vector3()
    const axis = new THREE.Vector3(0, 1, 0)
    benchPts.forEach(([x, z, rot], i) => {
      q.setFromAxisAngle(axis, rot)
      p.set(x, heightAt(x, z), z)
      m.compose(p, q, s)
      bench.setMatrixAt(i, m)
    })
    bench.castShadow = true
    bench.receiveShadow = true
    bench.name = 'osm_benches'
    root.add(bench)
    drawCalls++
  }

  /* ---------- 垃圾桶 + 指路牌 ----------
   * 街道家具的两个最低配：沿主路交替放，都用 InstancedMesh，两个 draw call 解决。
   */
  {
    const binPts = []
    const signPts = []
    const rand = makeRandom(3131)
    for (const r of view.roads) {
      if (r.width < 5 || r.bridge || r.path.length < 2) continue
      for (let i = 0; i < r.path.length - 1; i++) {
        const [ax, az] = r.path[i]
        const [bx, bz] = r.path[i + 1]
        const len = Math.hypot(bx - ax, bz - az)
        if (len < 10) continue
        const dx = (bx - ax) / len
        const dz = (bz - az) / len
        const off = r.width / 2 + 2.1
        for (let dd = 30; dd < len; dd += 90) {
          if (binPts.length >= 70) break
          const side = rand() > 0.5 ? 1 : -1
          const x = ax + dx * dd - dz * off * side
          const z = az + dz * dd + dx * off * side
          if (boxes.some((b) => x > b.minX - 1 && x < b.maxX + 1 && z > b.minZ - 1 && z < b.maxZ + 1)) continue
          if (view.water.some((w) => pointInPoly(x, z, w.polygon))) continue
          const rot = Math.atan2(dx, dz)
          if (binPts.length * 2 <= signPts.length + 1) binPts.push([x, z, rot])
          else if (signPts.length < 40) signPts.push([x, z, rot])
        }
      }
    }

    if (binPts.length) {
      const body = new THREE.CylinderGeometry(0.3, 0.26, 0.9, 12)
      body.translate(0, 0.45, 0)
      const lid = new THREE.CylinderGeometry(0.32, 0.32, 0.08, 12)
      lid.translate(0, 0.92, 0)
      const bin = new THREE.InstancedMesh(
        mergeGeometries([body, lid]),
        new THREE.MeshStandardMaterial({ color: 0x3f5a45, roughness: 0.8 }),
        binPts.length
      )
      const m = new THREE.Matrix4()
      const q = new THREE.Quaternion()
      const sv = new THREE.Vector3(1, 1, 1)
      const pv = new THREE.Vector3()
      const axis = new THREE.Vector3(0, 1, 0)
      binPts.forEach(([x, z, rot], i) => {
        q.setFromAxisAngle(axis, rot)
        pv.set(x, heightAt(x, z), z)
        m.compose(pv, q, sv)
        bin.setMatrixAt(i, m)
      })
      bin.castShadow = true
      bin.name = 'osm_bins'
      root.add(bin)
      drawCalls++
    }

    if (signPts.length) {
      const pole = new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6)
      pole.translate(0, 1.2, 0)
      const plate = new THREE.BoxGeometry(0.95, 0.34, 0.06)
      plate.translate(0.42, 2.15, 0)
      const sp = new THREE.InstancedMesh(
        mergeGeometries([pole, plate]),
        new THREE.MeshStandardMaterial({ color: 0x2f5f8f, roughness: 0.6, metalness: 0.2 }),
        signPts.length
      )
      const m = new THREE.Matrix4()
      const q = new THREE.Quaternion()
      const sv = new THREE.Vector3(1, 1, 1)
      const pv = new THREE.Vector3()
      const axis = new THREE.Vector3(0, 1, 0)
      signPts.forEach(([x, z, rot], i) => {
        q.setFromAxisAngle(axis, rot + Math.PI / 2)
        pv.set(x, heightAt(x, z), z)
        m.compose(pv, q, sv)
        sp.setMatrixAt(i, m)
      })
      sp.castShadow = true
      sp.name = 'osm_signposts'
      root.add(sp)
      drawCalls++
    }
  }

  /* ---------- 锚点 + 入口雨棚 + 标牌 ---------- */
  const anchorList = pickAnchors(buildings, view.water)

  // 出生点放在学生中心 / 下沉广场一带的路上，一睁眼就是校园而不是草坡
  // 在学生中心附近找一处「离楼至少 9m」的路点，避免一出生就贴着墙
  const candidates = []
  for (const r of view.roads) {
    for (const [x, z] of r.path) {
      const d = Math.hypot(x + 414, z + 109)
      if (d < 120) candidates.push([d, x, z])
    }
  }
  candidates.sort((a, b) => a[0] - b[0])
  let ccx = -414
  let ccz = -109
  for (const [, x, z] of candidates) {
    const clear =
      boxes.every((b) => x < b.minX - 9 || x > b.maxX + 9 || z < b.minZ - 9 || z > b.maxZ + 9) &&
      !view.water.some((w) => pointInPoly(x, z, w.polygon))
    if (clear) {
      ccx = x
      ccz = z
      break
    }
  }
  anchorList.unshift({
    id: 'a_campus',
    zone: 'outdoor',
    pos: new THREE.Vector3(ccx, 0, ccz),
    yaw: (Math.atan2(-414 - ccx, -109 - ccz) * 180) / Math.PI,
    label: '校园中心',
    en: 'Campus Center',
    building: null
  })

  /* ---------- 室内（教学楼 / 图书馆 / 行政楼 / 学生中心 / 科研楼） ----------
   * 校园模式原来一间都进不去。这里按楼的轮廓直接生成：内墙按 0.9 缩一圈、
   * 4.2m 高、地面铺水磨石、加一套桌椅，门口给一层交互。
   * 材质加了一点自发光 —— 室内没有单独布光，全靠这一手才不发黑。
   */
  const interiorZones = {}
  const roomCameras = {}
  const interactables = []
  const floorGeos = []
  const ceilGeos = []
  const innerWallGeos = []
  const deskGeos = []
  const lampStripGeos = []
  const panelGeos = []
  const beamGeos = []

  for (const { b, base } of enterable) {
    const poly = b.polygon
    const [cx, cz] = centroid(poly)
    const bb = bboxOf(poly)
    const spanX = bb.maxX - bb.minX
    const spanZ = bb.maxZ - bb.minZ
    const H = 4.2
    const zoneId = `in_${b.id}`
    const inner = offsetPolygon(poly, 0.9)

    floorGeos.push(polygonPlane(inner, base + 0.04))
    ceilGeos.push(polygonPlane(inner, base + H))
    const wg = wallGeometry(inner, base, base + H, 6, H, 1)
    if (wg) innerWallGeos.push(wg)

    // 门在哪：离最近道路最近的轮廓顶点
    const rp = nearestRoadPoint(view.roads, cx, cz)
    const [ex, ez] = nearestVertex(poly, rp[0], rp[1])
    let inX = cx - ex
    let inZ = cz - ez
    const il = Math.hypot(inX, inZ) || 1
    inX /= il
    inZ /= il

    // 桌椅：中心 3.4 × 3.6 网格，最多铺满 7 × 5，避开门口
    for (let gx = -3; gx <= 3; gx++) {
      for (let gz = -2; gz <= 2; gz++) {
        const px = cx + gx * 3.4
        const pz = cz + gz * 3.6
        if (!pointInPoly(px, pz, inner)) continue
        if (Math.hypot(px - ex, pz - ez) < 6) continue
        const top = new THREE.BoxGeometry(1.5, 0.06, 0.72)
        top.translate(px, base + 0.74, pz)
        deskGeos.push(top)
        const body = new THREE.BoxGeometry(1.28, 0.7, 0.56)
        body.translate(px, base + 0.37, pz)
        deskGeos.push(body)
        // 椅子：座面 + 靠背，一把 0.85m 高
        for (const side of [-1, 1]) {
          const seat = new THREE.BoxGeometry(0.42, 0.06, 0.42)
          seat.translate(px, base + 0.45, pz + side * 0.62)
          deskGeos.push(seat)
          const back = new THREE.BoxGeometry(0.42, 0.42, 0.06)
          back.translate(px, base + 0.65, pz + side * 0.8)
          deskGeos.push(back)
        }
      }
    }

    // 顶灯：两条发光灯带，室内没有单独布光，靠这个才不像仓库
    const lx = Math.max(spanX * 0.45, 6)
    for (const off of [-0.28, 0.28]) {
      const strip = new THREE.BoxGeometry(lx, 0.14, 0.5)
      strip.translate(cx, base + H - 0.12, cz + spanZ * off)
      lampStripGeos.push(strip)
    }

    // 真实点光：只有发光灯带的 emissive 照不亮桌椅和人物，室内会像一间黑仓库。
    // 每间按长边放两盏，不投影（室内没有动态阴影需求，10 盏灯的开销也可控）。
    for (const off of spanX > spanZ ? [-0.25, 0.25] : [0]) {
      const lamp = new THREE.PointLight(0xffe7c8, 16, Math.max(spanX, spanZ) * 1.6, 2)
      lamp.position.set(cx + spanX * off, base + H - 0.6, cz + spanZ * (spanX > spanZ ? 0 : 0.18))
      lamp.castShadow = false
      root.add(lamp)
    }

    // 靠墙的柜子 / 展板：大进深建筑里空白墙一眼望不到头，加一排 2m 高的柜体才有尺度
    for (let i = 0; i < inner.length; i++) {
      const a = inner[i]
      const b = inner[(i + 1) % inner.length]
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (len < 4.5) continue
      const ux = (b[0] - a[0]) / len
      const uz = (b[1] - a[1]) / len
      const mx = (a[0] + b[0]) * 0.5
      const mz = (a[1] + b[1]) * 0.5
      let nx = cx - mx
      let nz = cz - mz
      const nl = Math.hypot(nx, nz) || 1
      nx /= nl
      nz /= nl
      const count = Math.min(5, Math.floor(len / 6))
      for (let k = 0; k < count; k++) {
        const t = (k + 0.5) / count
        const px = a[0] + (b[0] - a[0]) * t
        const pz = a[1] + (b[1] - a[1]) * t
        const w = Math.min(5, (len / count) * 0.62)
        const hgt = 2.05
        const g = new THREE.BoxGeometry(w, hgt, 0.36)
        g.rotateY(Math.atan2(-uz, ux))
        g.translate(px + nx * 0.24, base + hgt / 2 + 0.08, pz + nz * 0.24)
        panelGeos.push(g)
      }
    }

    // 大跨度室内加一排天花横梁：不然抬头是一整块白板，像仓库
    if (spanX > 20 || spanZ > 20) {
      for (let x = bb.minX + 7; x < bb.maxX - 5; x += 9) {
        const g = new THREE.BoxGeometry(0.3, 0.34, spanZ * 0.88)
        g.translate(x, base + H - 0.2, cz)
        beamGeos.push(g)
      }
    }

    // 室内落点：从门口往里退，但**一定要落在内轮廓里**。
    // 楼进深小的时候「退 5m」会直接退到对面墙里，人一进场就贴在墙缝里动不了。
    const depth = Math.min(5, Math.max(2.2, Math.min(spanX, spanZ) * 0.18))
    let ix = ex + inX * depth
    let iz = ez + inZ * depth
    if (!pointInPoly(ix, iz, inner)) {
      ix = cx
      iz = cz
    }

    // 室内固定机位：落在落点「靠门口」的一侧，视线朝房间中心。
    // 旧代码用的是 +inX（往房间深处），结果相机跑到玩家前面、回头看墙，画面里根本没有人。
    // 沿「出门方向」回退，撞到内墙就停，这样机位不会穿墙；进深大的楼能退到 4-5m，人才不会贴脸。
    const backMax = Math.min(5.5, Math.max(1.0, depth - 0.9))
    let camX = ix
    let camZ = iz
    for (let k = 1; k <= 10; k++) {
      const t = (k / 10) * backMax
      const tx = ix - inX * t
      const tz = iz - inZ * t
      if (!pointInPoly(tx, tz, inner)) break
      camX = tx
      camZ = tz
    }
    // 视线不要死盯着房间正中心：从角色背后看向房间深处，角色落在画面下半部
    const lookDist = Math.min(14, Math.max(5, Math.min(spanX, spanZ) * 0.4))
    roomCameras[zoneId] = {
      pos: new THREE.Vector3(camX, base + 2.35, camZ),
      lookAt: new THREE.Vector3(ix + inX * lookDist, base + 1.3, iz + inZ * lookDist),
      fov: 66,
      size: { w: spanX, d: spanZ, h: H }
    }

    interiorZones[zoneId] = {
      id: zoneId,
      colliders: [],
      // 室内用内轮廓「关住」玩家：否则能一路走进墙里（视觉上人在墙体内）
      containPoly: inner,
      centerX: cx,
      centerZ: cz,
      bounds: {
        min: new THREE.Vector3(bb.minX + 1.2, 0, bb.minZ + 1.2),
        max: new THREE.Vector3(bb.maxX - 1.2, 0, bb.maxZ - 1.2)
      },
      origin: new THREE.Vector3(cx, base, cz),
      size: { w: spanX, d: spanZ, h: H },
      // 楼面比楼基高 4cm（地面几何体在这里），脚踩上去就正好
      floorY: base + 0.05
    }

    // 门口内外两个锚点 + 两处交互
    const inId = `a_in_${b.id}`
    const outId = `a_out_${b.id}`
    anchorList.push({
      id: inId,
      zone: zoneId,
      pos: new THREE.Vector3(ix, base, iz),
      // 角色本地前方是 -Z，朝向「进门方向」的 yaw 要取反（旧值让角色进门后一直面朝门外）
      yaw: (Math.atan2(-inX, -inZ) * 180) / Math.PI,
      label: b.name || '室内',
      en: b.nameEn || 'Indoor',
      building: null
    })
    anchorList.push({
      id: outId,
      zone: 'outdoor',
      pos: new THREE.Vector3(ex - inX * 4, 0, ez - inZ * 4),
      yaw: (Math.atan2(inX, inZ) * 180) / Math.PI,
      label: '门外',
      en: 'Outside',
      building: null
    })
    interactables.push({
      zone: 'outdoor',
      pos: new THREE.Vector3(ex, 0, ez),
      radius: 3.4,
      anchorId: inId,
      label: b.name || '进入'
    })
    interactables.push({
      zone: zoneId,
      pos: new THREE.Vector3(ix, base, iz),
      radius: 3.4,
      anchorId: outId,
      label: '出门'
    })
  }

  if (floorGeos.length) {
    const ft = interiorFloorTexture()
    ft.repeat.set(1, 1)
    const m = new THREE.Mesh(
      mergeGeometries(floorGeos),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: ft,
        roughness: 0.9,
        emissive: 0xfff4e2,
        emissiveIntensity: 0.16
      })
    )
    m.receiveShadow = true
    m.name = 'osm_indoor_floor'
    root.add(m)
    drawCalls++

    const ceil = new THREE.Mesh(
      mergeGeometries(ceilGeos),
      new THREE.MeshStandardMaterial({
        color: 0xe4dfd4,
        roughness: 1,
        side: THREE.DoubleSide,
        emissive: 0xfff6e8,
        emissiveIntensity: 0.22
      })
    )
    ceil.name = 'osm_indoor_ceiling'
    root.add(ceil)
    drawCalls++

    const walls = new THREE.Mesh(
      mergeGeometries(innerWallGeos),
      new THREE.MeshStandardMaterial({
        color: 0xe9e4d9,
        roughness: 0.92,
        side: THREE.DoubleSide,
        emissive: 0xfff4e4,
        emissiveIntensity: 0.18
      })
    )
    walls.receiveShadow = true
    walls.name = 'osm_indoor_walls'
    root.add(walls)
    drawCalls++

    const strips = new THREE.Mesh(
      mergeGeometries(lampStripGeos),
      new THREE.MeshStandardMaterial({
        color: 0xfff6e2,
        emissive: 0xfff2d6,
        emissiveIntensity: 1.6,
        roughness: 0.6
      })
    )
    strips.name = 'osm_indoor_lights'
    root.add(strips)
    drawCalls++

    const desks = new THREE.Mesh(
      mergeGeometries(deskGeos),
      new THREE.MeshStandardMaterial({
        color: 0xb98f5f,
        roughness: 0.8,
        emissive: 0xffe9c9,
        emissiveIntensity: 0.1
      })
    )
    desks.castShadow = true
    desks.receiveShadow = true
    desks.name = 'osm_indoor_desks'
    root.add(desks)
    drawCalls++

    if (panelGeos.length) {
      const panels = new THREE.Mesh(
        mergeGeometries(panelGeos),
        new THREE.MeshStandardMaterial({ color: 0x6f5a44, roughness: 0.84 })
      )
      panels.castShadow = true
      panels.receiveShadow = true
      panels.name = 'osm_indoor_panels'
      root.add(panels)
      drawCalls++
    }

    if (beamGeos.length) {
      const beams = new THREE.Mesh(
        mergeGeometries(beamGeos),
        new THREE.MeshStandardMaterial({ color: 0xc9c2b4, roughness: 0.9 })
      )
      beams.castShadow = true
      beams.name = 'osm_indoor_beams'
      root.add(beams)
      drawCalls++
    }
  }

  const anchors = new Map()
  for (const a of anchorList) anchors.set(a.id, a)

  const canopyGeos = []
  const stepGeos = []
  // 台阶的可站立高度：只画几何不让玩家踩上去，脚会插进台阶里。
  // 每级台阶登记成一个带旋转的矩形，player.groundHeight 会取这个高度。
  const stepPads = []
  const signMeshes = []

  // 入口构件：不再只给 6 个锚点做，凡是体量够的楼都补一套「台阶 + 雨棚 + 两根柱子」，
  // 否则整片校园的楼都是从草里直接长出来的方盒子，走近了特别空
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i]
    if (!b.polygon || b.polygon.length < 3) continue
    const area = Math.abs(signedArea(b.polygon))
    if (area < 520 || (b.height || 0) < 6) continue

    const [gx, gz] = centroid(b.polygon)
    const rp = nearestRoadPoint(view.roads, gx, gz)
    const [vx, vz] = nearestVertex(b.polygon, rp[0], rp[1])
    let dx = vx - gx
    let dz = vz - gz
    const d = Math.hypot(dx, dz) || 1
    if (d < 4) continue
    dx /= d
    dz /= d
    const angle = Math.atan2(dx, dz)
    const gh = heightAt(vx, vz)

    // 三级台阶：每级外扩 0.55m、降 0.15m
    for (let s2 = 0; s2 < 3; s2++) {
      const cx = vx + dx * (0.32 + s2 * 0.56)
      const cz = vz + dz * (0.32 + s2 * 0.56)
      const st = new THREE.BoxGeometry(7.2 - s2 * 0.6, 0.16, 0.58)
      st.rotateY(angle)
      st.translate(cx, gh + 0.42 - s2 * 0.14, cz)
      stepGeos.push(st)
      stepPads.push({
        x: cx,
        z: cz,
        hx: (7.2 - s2 * 0.6) * 0.5,
        hz: 0.29,
        cos: Math.cos(angle),
        sin: Math.sin(angle),
        top: gh + 0.42 - s2 * 0.14 + 0.08
      })
    }

    // 雨棚：3.5m 高、6m 宽的薄板，两根细柱
    const slab = new THREE.BoxGeometry(6.2, 0.3, 4.0)
    slab.rotateY(angle)
    slab.translate(vx + dx * 2.2, gh + 4.35, vz + dz * 2.2)
    canopyGeos.push(slab)

    for (const s of [-1, 1]) {
      const col = new THREE.CylinderGeometry(0.12, 0.12, 4.2, 8)
      const ox = Math.cos(angle) * s * 2.5
      const oz = -Math.sin(angle) * s * 2.5
      col.translate(vx + dx * 3.6 + ox, gh + 2.1, vz + dz * 3.6 + oz)
      canopyGeos.push(col)
    }
  }

  // 标牌只给锚点楼，不然整片校园都是牌子
  for (const a of anchorList) {
    if (!a.building) continue
    const poly = a.building.polygon
    const [vx, vz] = nearestVertex(poly, a.pos.x, a.pos.z)
    let dx = a.pos.x - vx
    let dz = a.pos.z - vz
    const d = Math.hypot(dx, dz) || 1
    dx /= d
    dz /= d
    const angle = Math.atan2(dx, dz)

    const tex = signTexture(a.label, a.en || '')
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(2.9, 1.16),
      new THREE.MeshStandardMaterial({
        map: tex,
        emissiveMap: tex,
        emissive: 0xffffff,
        emissiveIntensity: 0.22,
        roughness: 0.65,
        metalness: 0.15,
        side: THREE.FrontSide
      })
    )
    // 标牌立在入口一侧 5.5m，别挡住玩家正对大门的路
    const tx = Math.cos(angle)
    const tz = -Math.sin(angle)
    sign.position.set(vx + dx * 2.2 + tx * 5.5, heightAt(vx, vz) + 2.45, vz + dz * 2.2 + tz * 5.5)
    sign.rotation.y = angle - 0.22
    sign.castShadow = true
    root.add(sign)
    signMeshes.push(sign)
    drawCalls++
  }

  if (stepGeos.length) {
    const m = new THREE.Mesh(
      mergeGeometries(stepGeos),
      new THREE.MeshStandardMaterial({ color: 0xc3bcae, roughness: 0.92, envMapIntensity: 0.25 })
    )
    m.receiveShadow = true
    m.name = 'osm_steps'
    root.add(m)
    drawCalls++
  }

  /* ---------- 空中连廊：把贴得近的楼接起来 ----------
   * 官网写「以廊联系校园」，OSM 里没有连廊要素，只能按距离推：
   * 两栋楼轮廓最近点小于 32m 就认为是一个建筑群，在 4.2–9.8m 之间架一条玻璃廊。
   */
  {
    const bridgeGeos = []
    const cand = []
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i]
      if (!b.polygon || b.polygon.length < 3) continue
      if ((b.height || 0) < 8 || Math.abs(signedArea(b.polygon)) < 380) continue
      cand.push(b.polygon)
    }
    let made = 0
    for (let i = 0; i < cand.length && made < 14; i++) {
      for (let j = i + 1; j < cand.length && made < 14; j++) {
        let best = null
        for (const [ax, az] of cand[i]) {
          for (const [bx, bz] of cand[j]) {
            const dd = Math.hypot(bx - ax, bz - az)
            if (!best || dd < best.d) best = { d: dd, ax, az, bx, bz }
          }
        }
        if (!best || best.d > 42 || best.d < 10) continue
        const len = best.d
        const mx = (best.ax + best.bx) / 2
        const mz = (best.az + best.bz) / 2
        const gh = heightAt(mx, mz)
        const ang = Math.atan2(best.bx - best.ax, best.bz - best.az)
        // 廊体 + 顶部檐板
        const body = new THREE.BoxGeometry(3.4, 5.2, len + 1.2)
        body.rotateY(ang)
        body.translate(mx, gh + 7.0, mz)
        bridgeGeos.push(body)
        const roof = new THREE.BoxGeometry(4.0, 0.32, len + 1.6)
        roof.rotateY(ang)
        roof.translate(mx, gh + 9.7, mz)
        bridgeGeos.push(roof)
        made++
      }
    }
    if (bridgeGeos.length) {
      const m = new THREE.Mesh(
        mergeGeometries(bridgeGeos),
        new THREE.MeshStandardMaterial({
          color: 0x9db3bf,
          roughness: 0.28,
          metalness: 0.35,
          envMapIntensity: 1.1
        })
      )
      m.castShadow = true
      m.receiveShadow = true
      m.name = 'osm_bridges'
      root.add(m)
      drawCalls++
    }
  }

  /* ---------- 斑马线 ----------
   * 校区里 6.5m 以上的主路每隔 80m 给一条过街斑马线：白条压在沥青上 5mm，
   * 合并成一个 mesh，不加 draw call 负担。
   */
  {
    const crossGeos = []
    const crossTex = null
    for (const r of view.roads) {
      if (r.bridge || r.width < 6.5 || r.path.length < 2) continue
      for (let i = 0; i < r.path.length - 1; i++) {
        const [ax, az] = r.path[i]
        const [bx, bz] = r.path[i + 1]
        const len = Math.hypot(bx - ax, bz - az)
        if (len < 40) continue
        const dx = (bx - ax) / len
        const dz = (bz - az) / len
        const ang = Math.atan2(dx, dz)
        for (let dd = 40; dd < len - 20; dd += 80) {
          const cx = ax + dx * dd
          const cz = az + dz * dd
          const gy = heightAt(cx, cz) + 0.135
          // 6 条白条，横向铺满路面
          for (let k = -2.5; k <= 2.5; k++) {
            const bw = 0.45
            const bl = 3.2
            const bar = new THREE.PlaneGeometry(bw, bl)
            bar.rotateX(-Math.PI / 2)
            bar.rotateY(ang)
            // 沿路的法向排布
            const nx = Math.cos(ang)
            const nz = -Math.sin(ang)
            bar.translate(cx + nx * k * 0.95, gy, cz + nz * k * 0.95)
            crossGeos.push(bar)
          }
        }
      }
    }
    if (crossGeos.length) {
      const m = new THREE.Mesh(
        mergeGeometries(crossGeos),
        new THREE.MeshStandardMaterial({
          color: 0xe8e5da,
          roughness: 0.85,
          polygonOffset: true,
          polygonOffsetFactor: -2
        })
      )
      m.name = 'osm_crosswalks'
      root.add(m)
      drawCalls++
    }
  }

  /* ---------- 校门 ----------
   * 数据里没有「校门」要素，按「校区边界上最宽的那条路」推：那里一定是主入口。
   */
  {
    let best = null
    const margin = 26
    for (const r of view.roads) {
      if (r.bridge || r.width < 6 || r.path.length < 2) continue
      for (const p of r.path) {
        const nearEdge =
          Math.abs(p[0] - LB.maxX) < margin ||
          Math.abs(p[0] - LB.minX) < margin ||
          Math.abs(p[1] - LB.maxZ) < margin ||
          Math.abs(p[1] - LB.minZ) < margin
        if (!nearEdge) continue
        if (!best || r.width > best.w) best = { w: r.width, x: p[0], z: p[1], road: r }
      }
    }
    if (best) {
      // 找这条路上穿过该点的那一段，拿方向
      let dir = [0, 1]
      let bd = Infinity
      for (let i = 0; i < best.road.path.length - 1; i++) {
        const a = best.road.path[i]
        const b = best.road.path[i + 1]
        const d = Math.hypot((a[0] + b[0]) / 2 - best.x, (a[1] + b[1]) / 2 - best.z)
        if (d < bd) {
          bd = d
          const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
          dir = [(b[0] - a[0]) / l, (b[1] - a[1]) / l]
        }
      }
      const ang = Math.atan2(dir[0], dir[1])
      const nx = Math.cos(ang)
      const nz = -Math.sin(ang)
      const gh = heightAt(best.x, best.z)
      const halfSpan = Math.max(7, best.w * 0.75)
      const gateGeos = []

      // 两根门柱
      for (const side of [-1, 1]) {
        const p1 = new THREE.BoxGeometry(1.5, 6.4, 1.5)
        p1.translate(best.x + nx * halfSpan * side, gh + 3.2, best.z + nz * halfSpan * side)
        gateGeos.push(p1)
        const cap = new THREE.BoxGeometry(1.9, 0.35, 1.9)
        cap.translate(best.x + nx * halfSpan * side, gh + 6.55, best.z + nz * halfSpan * side)
        gateGeos.push(cap)
      }
      // 横梁
      const beam = new THREE.BoxGeometry(halfSpan * 2 + 1.5, 0.9, 1.2)
      beam.rotateY(ang)
      beam.translate(best.x, gh + 7.4, best.z)
      gateGeos.push(beam)

      const gm = new THREE.Mesh(
        mergeGeometries(gateGeos),
        new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.82, envMapIntensity: 0.3 })
      )
      gm.castShadow = true
      gm.receiveShadow = true
      gm.name = 'osm_gate'
      root.add(gm)
      drawCalls++

      // 校名牌
      const gtex = signTexture('香港中文大学（深圳）', 'CUHK-Shenzhen')
      const gp = new THREE.Mesh(
        new THREE.PlaneGeometry(9.5, 1.5),
        new THREE.MeshStandardMaterial({
          map: gtex,
          emissiveMap: gtex,
          emissive: 0xffffff,
          emissiveIntensity: 0.18,
          roughness: 0.6,
          side: THREE.DoubleSide
        })
      )
      gp.position.set(best.x - nx * 0.0, gh + 6.0, best.z - nz * 0.0)
      gp.rotation.y = ang
      gp.translateZ(0.62)
      root.add(gp)
      drawCalls++
    }
  }

  if (canopyGeos.length) {
    const m = new THREE.Mesh(
      mergeGeometries(canopyGeos),
      new THREE.MeshStandardMaterial({ color: 0x8c9195, roughness: 0.5, metalness: 0.45, envMapIntensity: 0.8 })
    )
    m.castShadow = true
    m.receiveShadow = true
    m.name = 'osm_canopies'
    root.add(m)
    drawCalls++
  }

  /* ---------- zone ---------- */
  const pad = 60
  const zones = {
    outdoor: {
      id: 'outdoor',
      colliders,
      polyColliders,
      bounds: {
        min: new THREE.Vector3(LB.minX - pad, 0, LB.minZ - pad),
        max: new THREE.Vector3(LB.maxX + pad, 0, LB.maxZ + pad)
      },
      origin: new THREE.Vector3(0, 0, 0),
      size: { w: spanX, d: spanZ, h: 120 }
    },
    ...interiorZones
  }

  const stats = {
    buildings: buildings.length - skipped,
    skipped,
    roads: roadCount,
    trees: treeCount,
    palms: palmPts.length,
    lamps: lampPts.length,
    drawCalls,
    source: data.meta.source,
    named: buildings.filter((b) => b.name || b.nameEn).length
  }

  console.info(
    `[campus-osm] ${stats.buildings} 栋真实轮廓 / ${stats.roads} 段路 / ${stats.trees} 棵树 / ` +
      `${stats.palms} 棵棕榈 / ${stats.lamps} 盏灯 / 约 ${stats.drawCalls} draw call`
  )

  return {
    root,
    zones,
    anchors,
    anchorList,
    interactables,
    roomCameras,
    roads: view.roads,
    stepPads,
    districts: [],
    campusStats: stats
  }
}
