import * as THREE from 'three'
import { createDragon } from './dragon.js'
import { heightAt, terrainActive } from '../world/terrain.js'

export const WALK_SPEED = 3.8
export const SPRINT_SPEED = 8.6
export const JUMP_SPEED = 7.4
export const GRAVITY = 22
const RADIUS = 0.36
const COYOTE = 0.12 // 跑出平台后还允许起跳的宽限
const JUMP_BUFFER = 0.16 // 落地前提前按空格，落地瞬间自动起跳
const TURN_SPEED = 2.7 // A/D / ←/→ 转身速度（rad/s）

/**
 * 冲刺不是无限跑：能量条 0~1，按住 Shift 约 2.4 秒耗尽，
 * 耗尽后进入「过热」冷却，回到 32% 才能再次冲刺（约 1.6s）。
 * 这就是用户要的「加速要有冷却」。
 */
const SPRINT = {
  drain: 0.42,
  regen: 0.26,
  regenDelay: 0.5,
  overheatClear: 0.32
}

// 圆 vs AABB 推出；min==max 高度区间不参与判断（本作全是全高墙）。
// 多跑几轮：两栋楼挨得近时，第一轮把圆的这一半推出来，第二轮才轮到另一半。
function resolve(p, boxes) {
  for (let pass = 0; pass < 3; pass++) {
    let hit = false
    for (const b of boxes) {
      const cx = Math.max(b.min.x, Math.min(p.x, b.max.x))
      const cz = Math.max(b.min.z, Math.min(p.z, b.max.z))
      let dx = p.x - cx
      let dz = p.z - cz
      const d2 = dx * dx + dz * dz
      if (d2 >= RADIUS * RADIUS) continue
      hit = true

      if (d2 < 1e-8) {
        // 圆心已经在盒子里：沿最短边推出去
        const left = p.x - b.min.x
        const right = b.max.x - p.x
        const back = p.z - b.min.z
        const front = b.max.z - p.z
        const m = Math.min(left, right, back, front)
        if (m === left) p.x = b.min.x - RADIUS
        else if (m === right) p.x = b.max.x + RADIUS
        else if (m === back) p.z = b.min.z - RADIUS
        else p.z = b.max.z + RADIUS
        continue
      }

      const d = Math.sqrt(d2)
      p.x += (dx / d) * (RADIUS - d)
      p.z += (dz / d) * (RADIUS - d)
    }
    if (!hit) break
  }
}

function pointInPoly(x, z, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0]
    const zi = poly[i][1]
    const xj = poly[j][0]
    const zj = poly[j][1]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

/* ---------------- 脱困用的几何查询 ---------------- */

function boxOverlaps(p, b) {
  const cx = Math.max(b.min.x, Math.min(p.x, b.max.x))
  const cz = Math.max(b.min.z, Math.min(p.z, b.max.z))
  const dx = p.x - cx
  const dz = p.z - cz
  return dx * dx + dz * dz < (RADIUS - 0.004) * (RADIUS - 0.004)
}

function zoneFree(zone, p) {
  if (zone.bounds) {
    if (p.x < zone.bounds.min.x || p.x > zone.bounds.max.x || p.z < zone.bounds.min.z || p.z > zone.bounds.max.z) return false
  }
  if (zone.containPoly && !pointInPoly(p.x, p.z, zone.containPoly)) return false
  if (zone.polyColliders) {
    for (const item of zone.polyColliders) {
      const b = item.bbox
      if (p.x < b.minX - RADIUS || p.x > b.maxX + RADIUS || p.z < b.minZ - RADIUS || p.z > b.maxZ + RADIUS) continue
      if (pointInPoly(p.x, p.z, item.poly)) return false
    }
  }
  if (zone.colliders) {
    for (const b of zone.colliders) if (boxOverlaps(p, b)) return false
  }
  if (zone.extraColliders) {
    for (const b of zone.extraColliders) if (boxOverlaps(p, b)) return false
  }
  return true
}

function collisionCount(zone, p) {
  let n = 0
  if (zone.containPoly && !pointInPoly(p.x, p.z, zone.containPoly)) n++
  if (zone.polyColliders) {
    for (const item of zone.polyColliders) {
      const b = item.bbox
      if (p.x < b.minX - RADIUS || p.x > b.maxX + RADIUS || p.z < b.minZ - RADIUS || p.z > b.maxZ + RADIUS) continue
      if (pointInPoly(p.x, p.z, item.poly)) n++
    }
  }
  if (zone.colliders) {
    for (const b of zone.colliders) if (boxOverlaps(p, b)) n++
  }
  if (zone.extraColliders) {
    for (const b of zone.extraColliders) if (boxOverlaps(p, b)) n++
  }
  return n
}

/** 被两堵墙夹住时，在附近同心圆上找一个真正空出来的点（不穿墙、不出界） */
function findEscape(zone, from, moveDir) {
  const test = { x: 0, y: 0, z: 0 }
  let best = null
  let bestScore = Infinity
  for (const r of [0.35, 0.55, 0.8, 1.1, 1.5, 2.0, 2.6, 3.4]) {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2
      test.x = from.x + Math.cos(a) * r
      test.z = from.z + Math.sin(a) * r
      if (!zoneFree(zone, test)) continue
      // 距离最近优先；同距离时优先往「想去的方向」挪
      const align = moveDir ? Math.cos(a) * moveDir.x + Math.sin(a) * moveDir.z : 0
      const score = r - align * 0.25
      if (score < bestScore) {
        bestScore = score
        best = { x: test.x, z: test.z }
      }
    }
    if (best) return best
  }
  return null
}

/**
 * 多边形碰撞：人在楼里就推到最近的边上。
 * 用外接矩形会把 L / U 形楼的院子一起封死（看得见却走不过去的「隐形墙」）。
 */
function resolvePolys(p, list) {
  if (!list || !list.length) return
  for (let pass = 0; pass < 4; pass++) {
    let hit = false
    for (const item of list) {
      const b = item.bbox
      if (p.x < b.minX - RADIUS || p.x > b.maxX + RADIUS || p.z < b.minZ - RADIUS || p.z > b.maxZ + RADIUS) continue

      // 找多边形边界上离人最近的点
      const poly = item.poly
      let bx = 0
      let bz = 0
      let bd = Infinity
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i]
        const c = poly[(i + 1) % poly.length]
        const ex = c[0] - a[0]
        const ez = c[1] - a[1]
        const len2 = ex * ex + ez * ez || 1
        let tt = ((p.x - a[0]) * ex + (p.z - a[1]) * ez) / len2
        tt = Math.max(0, Math.min(1, tt))
        const px = a[0] + ex * tt
        const pz = a[1] + ez * tt
        const d = (p.x - px) * (p.x - px) + (p.z - pz) * (p.z - pz)
        if (d < bd) {
          bd = d
          bx = px
          bz = pz
        }
      }

      const inside = pointInPoly(p.x, p.z, poly)
      const dist = Math.sqrt(bd)
      // 人在楼里，或者身体半径已经压进墙：都推到楼外 RADIUS 处。
      // 旧代码把「楼内的人」往最近边再推 RADIUS 进去，等于永远没推出来，
      // 这就是一直能穿墙的根因。
      if (inside) {
        let dx = p.x - bx
        let dz = p.z - bz
        let len = Math.hypot(dx, dz)
        if (len < 1e-4) {
          dx = 0
          dz = 1
          len = 1
        }
        p.x = bx - (dx / len) * RADIUS
        p.z = bz - (dz / len) * RADIUS
        hit = true
      } else if (dist < RADIUS) {
        let dx = p.x - bx
        let dz = p.z - bz
        let len = Math.hypot(dx, dz)
        if (len < 1e-4) {
          dx = 0
          dz = 1
          len = 1
        }
        p.x = bx + (dx / len) * RADIUS
        p.z = bz + (dz / len) * RADIUS
        hit = true
      }
    }
    if (!hit) break
  }
}

/** 把人关在多边形里面：跑出内轮廓就推回最近的边上 */
function containPoly(p, poly) {
  if (pointInPoly(p.x, p.z, poly)) return
  let bx = 0
  let bz = 0
  let bd = Infinity
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const c = poly[(i + 1) % poly.length]
    const ex = c[0] - a[0]
    const ez = c[1] - a[1]
    const len2 = ex * ex + ez * ez || 1
    let tt = ((p.x - a[0]) * ex + (p.z - a[1]) * ez) / len2
    tt = Math.max(0, Math.min(1, tt))
    const px = a[0] + ex * tt
    const pz = a[1] + ez * tt
    const d = (p.x - px) * (p.x - px) + (p.z - pz) * (p.z - pz)
    if (d < bd) {
      bd = d
      bx = px
      bz = pz
    }
  }
  let dx = bx - p.x
  let dz = bz - p.z
  const len = Math.hypot(dx, dz) || 1
  p.x = bx + (dx / len) * RADIUS
  p.z = bz + (dz / len) * RADIUS
}

export class Player {
  constructor(scene, world) {
    this.world = world
    this.zone = 'outdoor'
    this.pos = new THREE.Vector3(0, 0, 6)
    this.prev = this.pos.clone()
    this.vel = new THREE.Vector3()
    // 卡死兜底：记录最近一次「确实走动了」的位置，卡住就退回去
    this.safe = new THREE.Vector3()
    this.stuckT = 0
    this.yaw = Math.PI
    this.phoneUp = false
    this.moving = false
    this.running = false
    this.sprinting = false

    /* ---------- 竖直运动（跳） ---------- */
    this.vy = 0
    this.grounded = true
    this.coyote = 0
    this.jumpBuffer = 0
    this.airHeight = 0
    this.landT = 0
    this.jumpCount = 0

    /* ---------- 冲刺能量 / 冷却 ---------- */
    this.stamina = 1
    this.overheated = false
    this.regenWait = 0
    this.speed = 0

    /* ---------- 地形坡度：人物跟着坡面倾斜，两只脚才不会悬空 / 陷进坡里 ---------- */
    this.groundPitch = 0
    this.groundRoll = 0
    // 每只脚相对身体平面的高度修正（台阶 / 路缘一边高一边低时用）
    this.footLift = [0, 0]
    this.unstuckCount = 0

    // 给 main 消费的一次性事件（起跳 / 落地）：音效、灰尘、震屏都由外面接
    this.events = []

    // 玩家形象：紫色小恶魔龙（按手办照片程序化建模，见 dragon.js）
    this.dragon = createDragon()
    this.group = this.dragon.group

    // 手机：举起来时在左手边，Tab 切换。y 要加上龙身体抬高的那段
    this.phone = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.18, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x111318, emissive: 0x2a3f66, emissiveIntensity: 0.8 })
    )
    this.phoneBaseY = this.dragon.bodyLift + 0.55
    this.phone.position.set(-0.46, this.phoneBaseY, -0.3)
    this.phone.rotation.set(-0.7, 0.3, 0.25)
    this.phone.visible = false
    this.group.add(this.phone)

    scene.add(this.group)
    this.sync(1)
  }

  get activeZone() {
    return this.world.zones[this.zone] || this.world.zones.outdoor
  }

  setPhone(up) {
    this.phoneUp = !!up
  }

  emit(type, data = {}) {
    this.events.push({ type, ...data })
  }

  consumeEvents() {
    const list = this.events
    this.events = []
    return list
  }

  /** 某个点的脚底高度：室内楼面 / 校园地形 / 建筑入口台阶 */
  groundHeightAt(x, z, zone = this.activeZone) {
    if (zone && typeof zone.floorY === 'number') return zone.floorY
    // 草地 mesh 比 heightAt 低 3cm，马路高 5cm；取 +0.02 让鞋底在两种面上都不明显穿/浮。
    let y = heightAt(x, z) + (terrainActive() ? 0.02 : 0)
    // 踩到 OSM 水泥路 / 步道时，鞋底要落在路面顶面，而不是落回草地高度。
    const roads = this.world.roads
    if (roads && roads.length && (!zone || zone.id === 'outdoor')) {
      let bestDist = Infinity
      let bestW = 0
      let bestX = 0
      let bestZ = 0
      for (const r of roads) {
        if (r.bridge || !r.path || r.path.length < 2) continue
        for (let i = 0; i < r.path.length - 1; i++) {
          const ax = r.path[i][0]
          const az = r.path[i][1]
          const bx = r.path[i + 1][0]
          const bz = r.path[i + 1][1]
          const dx = bx - ax
          const dz = bz - az
          const len2 = dx * dx + dz * dz || 1
          let tt = ((x - ax) * dx + (z - az) * dz) / len2
          tt = Math.max(0, Math.min(1, tt))
          const px = ax + dx * tt
          const pz = az + dz * tt
          const d = Math.hypot(x - px, z - pz)
          if (d < bestDist) {
            bestDist = d
            bestW = r.width
            bestX = px
            bestZ = pz
          }
        }
      }
      const surfaceW = Math.max(2.2, bestW * 1.45)
      let roadY = -Infinity
      if (bestW >= 5) {
        if (bestDist <= surfaceW / 2) roadY = heightAt(bestX, bestZ) + 0.05
        else if (bestDist <= surfaceW / 2 + 2.1) roadY = heightAt(bestX, bestZ) + 0.03
      } else if (bestDist <= surfaceW / 2 + 0.3) {
        roadY = heightAt(bestX, bestZ) + 0.045
      }
      if (roadY > y) y = roadY
    }
    // 校园入口的三级台阶只有几何、没有地形，玩家踩上去要抬到台面高度，
    // 否则脚和身体会从台阶里穿过去。
    const pads = this.world.stepPads
    if (pads && pads.length && (!zone || zone.id === 'outdoor')) {
      for (let i = 0; i < pads.length; i++) {
        const p = pads[i]
        const dx = x - p.x
        const dz = z - p.z
        const lx = p.cos * dx - p.sin * dz
        const lz = p.sin * dx + p.cos * dz
        if (Math.abs(lx) <= p.hx && Math.abs(lz) <= p.hz && p.top > y) y = p.top
      }
    }
    return y
  }

  /** 脚底应有的地面高度（室内楼面 / 校园地形 / 广场 0） */
  groundHeight(zone = this.activeZone) {
    return this.groundHeightAt(this.pos.x, this.pos.z, zone)
  }

  /**
   * 采样脚下一小片地形，算出角色应该跟随的坡度。
   * 之前人物永远竖直、两只脚固定在同一水平面上：站在坡上时上坡那只脚陷进地里、
   * 下坡那只脚悬空。现在让整个角色绕脚底中心转到坡面，两只脚才同时贴地。
   * 室内（floorY）和空中不跟随，避免在楼梯/房间里歪着走。
   */
  updateGroundTilt(dt, zone) {
    let targetPitch = 0
    let targetRoll = 0
    if (this.grounded && terrainActive() && !(zone && typeof zone.floorY === 'number')) {
      const fx = -Math.sin(this.yaw)
      const fz = -Math.cos(this.yaw)
      const rx = Math.cos(this.yaw)
      const rz = -Math.sin(this.yaw)
      const d = 0.3
      const hF = this.groundHeightAt(this.pos.x + fx * d, this.pos.z + fz * d, zone)
      const hB = this.groundHeightAt(this.pos.x - fx * d, this.pos.z - fz * d, zone)
      const hR = this.groundHeightAt(this.pos.x + rx * d, this.pos.z + rz * d, zone)
      const hL = this.groundHeightAt(this.pos.x - rx * d, this.pos.z - rz * d, zone)
      const maxSlope = 0.42 // 陡坡上限，避免极端地形让人物横过来
      targetPitch = Math.max(-maxSlope, Math.min(maxSlope, Math.atan2(hF - hB, 2 * d)))
      targetRoll = Math.max(-maxSlope, Math.min(maxSlope, Math.atan2(hR - hL, 2 * d)))
    }
    const k = 1 - Math.exp(-10 * dt)
    this.groundPitch += (targetPitch - this.groundPitch) * k
    this.groundRoll += (targetRoll - this.groundRoll) * k
  }

  /**
   * 两只脚分别采一次地面：一只脚踩在台阶 / 路缘上、另一只还在下面时，
   * 给高那只脚一个抬升（大脚掌会盖住短腿的接缝），这样从侧面看不会一只脚陷进去。
   * 坡道上整体倾斜已经处理过，这里只补「倾斜平面之外」的残差。
   */
  updateFootLift(dt, zone) {
    const target = [0, 0]
    if (this.grounded && terrainActive() && !(zone && typeof zone.floorY === 'number')) {
      const s = 0.88
      const localX = 0.185 * s
      const localZ = -0.09 * s
      const cy = Math.cos(this.yaw)
      const sy = Math.sin(this.yaw)
      for (let i = 0; i < 2; i++) {
        const side = i === 0 ? -1 : 1
        const lx = side * localX
        const wx = this.pos.x + cy * lx + sy * localZ
        const wz = this.pos.z - sy * lx + cy * localZ
        const g = this.groundHeightAt(wx, wz, zone)
        // 身体随坡倾斜后，这个脚位置所在的平面高度
        const tiltY = -localZ * this.groundPitch + lx * this.groundRoll
        target[i] = g - (this.pos.y + tiltY)
      }
    }
    // 台阶落差一般 0.15-0.2m；压到 ±0.1 内，靠大脚掌遮住短腿的接缝
    const k = 1 - Math.exp(-16 * dt)
    for (let i = 0; i < 2; i++) {
      const t = Math.max(-0.1, Math.min(0.1, target[i]))
      this.footLift[i] += (t - this.footLift[i]) * k
    }
  }

  teleport(anchorId) {
    const a = this.world.anchors.get(anchorId)
    if (!a) {
      console.warn(`[player] 未知锚点 ${anchorId}`)
      return
    }
    this.zone = a.zone
    this.pos.copy(a.pos)
    // 室内固定机位是给旧角色摆的：如果机位离得很近，就往它注视的方向挪一点
    const room = this.world.roomCameras && this.world.roomCameras[a.zone]
    if (room) {
      const off = Math.hypot(room.pos.x - this.pos.x, room.pos.z - this.pos.z)
      const dx = room.lookAt.x - this.pos.x
      const dz = room.lookAt.z - this.pos.z
      const d = Math.hypot(dx, dz)
      if (off < 5 && d > 0.5) {
        const k = Math.min(1.4, d * 0.5)
        this.pos.x += (dx / d) * k
        this.pos.z += (dz / d) * k
      }
    }
    const z0 = this.world.zones[a.zone]
    this.pos.y = this.groundHeight(z0)
    this.prev.copy(this.pos)
    this.safe.copy(this.pos)
    this.stuckT = 0
    this.vel.set(0, 0, 0)
    this.vy = 0
    this.grounded = true
    this.airHeight = 0
    this.jumpBuffer = 0
    this.coyote = 0
    this.groundPitch = 0
    this.groundRoll = 0
    this.footLift = [0, 0]
    this.yaw = THREE.MathUtils.degToRad(a.yaw)
    this.events = []
    this.sync(1)
  }

  update(dt, input, camYaw) {
    const zone = this.activeZone
    const axis = input.axis()
    // 坦克式操控：A/D（或 ←/→）只负责转身，W/S（或 ↑/↓）只负责前后走。
    // 鼠标只转镜头，不再参与角色的朝向 / 移动方向。
    if (Math.abs(axis.x) > 0.01) this.yaw -= axis.x * TURN_SPEED * dt
    const drive = -axis.z
    this.moving = Math.abs(drive) > 0.01

    /* ---------- 冲刺：能量条 + 过热冷却 ---------- */
    const wantSprint = this.moving && axis.running
    this.sprinting = wantSprint && !this.overheated && this.stamina > 0
    if (this.sprinting) {
      this.stamina = Math.max(0, this.stamina - SPRINT.drain * dt)
      this.regenWait = SPRINT.regenDelay
      if (this.stamina <= 0) this.overheated = true
    } else {
      this.regenWait = Math.max(0, this.regenWait - dt)
      if (this.regenWait <= 0) this.stamina = Math.min(1, this.stamina + SPRINT.regen * dt)
      if (this.overheated && this.stamina >= SPRINT.overheatClear) this.overheated = false
    }
    if (this.overheated) this.sprinting = false
    this.running = this.sprinting

    const speed = this.sprinting ? SPRINT_SPEED : WALK_SPEED
    const forwardX = -Math.sin(this.yaw)
    const forwardZ = -Math.cos(this.yaw)
    const targetX = forwardX * drive * speed
    const targetZ = forwardZ * drive * speed

    // 加减速，别像贴地飞行；空中操控变弱
    let accel = 20
    if (!this.grounded) accel = 5.5
    else if (!axis.moving) accel = 24
    else if (this.sprinting) accel = 22
    this.vel.x += (targetX - this.vel.x) * Math.min(1, accel * dt)
    this.vel.z += (targetZ - this.vel.z) * Math.min(1, accel * dt)
    if (Math.abs(this.vel.x) < 0.02) this.vel.x = 0
    if (Math.abs(this.vel.z) < 0.02) this.vel.z = 0
    this.speed = Math.hypot(this.vel.x, this.vel.z)

    /* ---------- 起跳输入（带土狼时间 + 预输入缓冲） ---------- */
    if (input.once('Space')) this.jumpBuffer = JUMP_BUFFER
    else this.jumpBuffer = Math.max(0, this.jumpBuffer - dt)
    this.coyote = this.grounded ? COYOTE : Math.max(0, this.coyote - dt)

    this.prev.copy(this.pos)
    const px0 = this.pos.x
    const pz0 = this.pos.z
    this.pos.x += this.vel.x * dt
    this.pos.z += this.vel.z * dt

    // 碰撞求解：函数内部已经多轮推出；这里再叠一轮边界钳制，防止被推进围栏外
    if (zone.containPoly) containPoly(this.pos, zone.containPoly)
    else if (zone.polyColliders) resolvePolys(this.pos, zone.polyColliders)
    else resolve(this.pos, zone.colliders)
    // 合入的定制建筑等额外实体碰撞（不参与校园 L 形楼的多边形逻辑）
    if (zone.extraColliders) resolve(this.pos, zone.extraColliders)
    if (zone.bounds) {
      this.pos.x = Math.min(zone.bounds.max.x, Math.max(zone.bounds.min.x, this.pos.x))
      this.pos.z = Math.min(zone.bounds.max.z, Math.max(zone.bounds.min.z, this.pos.z))
    }

    // 卡死检测：两栋楼夹角把人夹住时，每帧的推出量会互相抵消，
    // 表面上看 moved 不为 0，其实人一直在原地抖。所以用「实际位移 vs 本来想走多远」判断。
    const moved = Math.hypot(this.pos.x - px0, this.pos.z - pz0)
    const wantDist = this.speed * dt
    if (axis.moving && wantDist > 0.002 && moved < Math.max(0.004, wantDist * 0.22)) {
      this.stuckT += dt
    } else {
      this.stuckT = Math.max(0, this.stuckT - dt * 1.5)
    }

    const squeezed = collisionCount(zone, this.pos) >= 2
    if ((this.stuckT > 0.3 && squeezed) || this.stuckT > 0.9) {
      const dirLen = Math.hypot(this.vel.x, this.vel.z)
      const esc = findEscape(zone, this.pos, dirLen > 0.01 ? { x: this.vel.x / dirLen, z: this.vel.z / dirLen } : null)
      if (esc) {
        this.pos.x = esc.x
        this.pos.z = esc.z
        this.vel.multiplyScalar(0.15)
        this.stuckT = 0
        this.unstuckCount++
        this.emit('unstuck', { mode: 'local' })
      } else if (this.stuckT > 1.1) {
        // 附近都没有落脚点：退回最近一次真正空出来的位置，再不行就回本区域锚点
        let safeX = null
        let safeZ = null
        if (this.safe.lengthSq() > 0 && zoneFree(zone, this.safe)) {
          safeX = this.safe.x
          safeZ = this.safe.z
        } else {
          let best = null
          let bd = Infinity
          for (const a of this.world.anchors.values()) {
            if (a.zone !== this.zone) continue
            const d = (a.pos.x - this.pos.x) ** 2 + (a.pos.z - this.pos.z) ** 2
            if (d < bd) {
              bd = d
              best = a
            }
          }
          if (best) {
            safeX = best.pos.x
            safeZ = best.pos.z
          }
        }
        if (safeX !== null) {
          this.pos.x = safeX
          this.pos.z = safeZ
          this.vel.set(0, 0, 0)
          this.stuckT = 0
          this.unstuckCount++
          this.emit('unstuck', { mode: 'teleport' })
        }
      }
    }

    // 安全点只在「确实走动且完全空出来」的位置更新，避免把夹缝坐标当成退路
    if (moved > 0.01 && zoneFree(zone, this.pos)) this.safe.copy(this.pos)

    /* ---------- 贴地 / 跳跃 / 落地 ---------- */
    const groundY = this.groundHeight(zone)

    if (this.jumpBuffer > 0 && (this.grounded || this.coyote > 0)) {
      this.vy = JUMP_SPEED
      this.grounded = false
      this.coyote = 0
      this.jumpBuffer = 0
      this.jumpCount++
      this.pos.y = Math.max(this.pos.y, groundY) + 0.01
      this.emit('jump', { sprint: this.sprinting })
    }

    if (!this.grounded) {
      this.vy -= GRAVITY * dt
      this.pos.y += this.vy * dt
      if (this.pos.y <= groundY && this.vy <= 0) {
        const impact = Math.min(1, Math.abs(this.vy) / 11)
        this.pos.y = groundY
        this.vy = 0
        this.grounded = true
        this.landT = 0.22
        this.emit('land', { impact })
      }
    } else {
      // 上下坡直接贴地（本作地形坡度都很缓）
      this.pos.y = groundY
    }
    this.airHeight = Math.max(0, this.pos.y - groundY)

    // 脚下地形坡度：人物整体绕脚底倾斜，脚才踩在坡面上
    this.updateGroundTilt(dt, zone)
    // 两只脚分别补台阶 / 路缘的落差
    this.updateFootLift(dt, zone)

    // 角色动画：呼吸 / 走路 / 跑步 / 起跳 / 落地 / 扇翅 / 摆尾都在这里驱动
    this.dragon.update(dt, {
      moving: this.moving && this.speed > 0.25,
      sprinting: this.sprinting,
      grounded: this.grounded,
      vy: this.vy,
      speed: this.speed,
      airHeight: this.airHeight,
      groundPitch: this.groundPitch,
      groundRoll: this.groundRoll,
      footLift: this.footLift
    })

    if (this.landT > 0) this.landT = Math.max(0, this.landT - dt)
  }

  // alpha 是插值系数（0-1），渲染时用
  sync(alpha) {
    const x = this.prev.x + (this.pos.x - this.prev.x) * alpha
    const z = this.prev.z + (this.pos.z - this.prev.z) * alpha
    const y = this.prev.y + (this.pos.y - this.prev.y) * alpha
    this.group.position.set(x, y, z)
    this.group.rotation.y = this.yaw
    this.phone.visible = this.phoneUp
    this.phone.position.y = this.phoneUp ? this.phoneBaseY : this.phoneBaseY - 0.16
  }
}
