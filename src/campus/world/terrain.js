/**
 * 校园地形：学校建在山坡上（西高东低），再叠两层缓坡起伏。
 *
 * 这个模块是**渲染和人物共用的唯一高程来源**：
 * 建筑、道路、树、水面、玩家、NPC 全部调 heightAt(x, z)，
 * 只要大家都用同一个函数，就不会出现「人穿地」「楼悬空」。
 *
 * 约定：只在小学校区（?campus=1）里启用；广场/教室那套不用，heightAt 直接返回 0。
 */

let active = false
/** 需要「压平」的地方：运动场、水面。避免水塘长在斜坡上、跑道变成滑坡 */
let flats = []

export function initTerrain() {
  active = true
  flats = []
}

/** 把一个圆盘区域压平到 height（边缘平滑过渡，不会有一圈硬边） */
export function addFlatSpot(x, z, r, h) {
  flats.push({ x, z, r, h })
}

export function terrainActive() {
  return active
}

/** 未经过压平处理的原始起伏 */
export function rawHeight(x, z) {
  // 西高东低：书院区（x≈-1400）比教学区（x≈-200）高约 9m，和实际校园一致
  const slope = (-x - 200) * 0.006
  // 两层次级起伏：周期约 1km 和 780m，最大坡度 2–3%。
  // 别把波长做短：楼是二十几米到上百米长的，地形太陡会出现「一栋楼一半埋进山里」。
  const h1 = 4.4 * Math.sin(x / 165 + 0.6) * Math.cos(z / 185 - 0.2)
  const h2 = 2.2 * Math.sin(x / 125 - z / 140 + 1.4)
  // 一层很长的波：把整片片区抬高 / 压低 7m，站远了能看出「学校建在坡上」，
  // 但坡度只有 1.4%，楼的 footprint 里几乎看不出来
  const h3 = 7.0 * Math.sin((x + z * 1.25) / 900 + 2.1)
  return slope + h1 + h2 + h3
}

/** 地表网格的精确高度：烘焙之后所有东西都踩这个，和渲染出来的面完全一致 */
let grid = null

/**
 * 把地表网格的顶点高度存成一张规则网格，之后 heightAt 改成**逐三角形插值**。
 * 这一步是整个「人陷地 / 路被草吃掉」问题的根治办法：
 * 解析曲面再准，也架不住 32m 一格的网格在凹处把面抬高。
 */
export function bakeGround(minX, maxZ, dx, dz, nx, nz, heights, yOffset = 0) {
  grid = { minX, maxZ, dx, dz, nx, nz, heights, yOffset, minZ: maxZ - nz * dz }
}

function gridHeight(x, z) {
  const fx = (x - grid.minX) / grid.dx
  // 注意：PlaneGeometry 的顶点是 (x, -y)，高度行号 j=0 对应的是**最小 Z**，
  // 不是最大 Z。旧代码用 (maxZ - z)/dz，整张高度图在 Z 轴上是镜像的：
  // 校园中心附近误差小，越往南北两端偏得越多（最多差出 9m+），
  // 表现就是人物下半身被画出来的地面切掉、路牌/树悬空。
  const fz = (z - grid.minZ) / grid.dz
  const i0 = Math.floor(fx)
  const j0 = Math.floor(fz)
  if (i0 < 0 || j0 < 0 || i0 >= grid.nx || j0 >= grid.nz) return null
  const t = fx - i0
  const u = fz - j0
  const H = (i, j) => grid.heights[j * (grid.nx + 1) + i]
  const h00 = H(i0, j0)
  const h10 = H(i0 + 1, j0)
  const h01 = H(i0, j0 + 1)
  const h11 = H(i0 + 1, j0 + 1)
  // PlaneGeometry 的两个三角形：(a,b,d) 与 (b,c,d)，对角线是 b-d
  let h
  if (t + u <= 1) h = h00 + (h10 - h00) * t + (h01 - h00) * u
  else h = h11 + (1 - u) * (h10 - h11) + (1 - t) * (h01 - h11)
  return h + grid.yOffset
}

export function heightAt(x, z) {
  if (!active) return 0
  if (grid) {
    const h = gridHeight(x, z)
    if (h !== null) return h
  }
  let h = rawHeight(x, z)
  for (let i = 0; i < flats.length; i++) {
    const f = flats[i]
    const dx = x - f.x
    const dz = z - f.z
    const d = Math.sqrt(dx * dx + dz * dz)
    if (d >= f.r) continue
    const t = d / f.r
    const k = t * t * (3 - 2 * t) // smoothstep：中心 0 → 边缘 1
    h = f.h * (1 - k) + h * k
  }
  return h
}

/** 把一段几何的每个顶点压到地形上（y 用 heightAt + lift） */
export function dropGeometry(geo, lift = 0) {
  if (!active) return geo
  const p = geo.attributes.position
  for (let i = 0; i < p.count; i++) {
    p.setY(i, heightAt(p.getX(i), p.getZ(i)) + lift)
  }
  p.needsUpdate = true
  geo.computeVertexNormals()
  return geo
}
