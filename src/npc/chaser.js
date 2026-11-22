import * as THREE from 'three'
import { heightAt, terrainActive } from '../campus/world/terrain.js'

// 校长 / 保安共用同一套：只有外观不同
// 速度定值 3.6（= 玩家走路 3.2 的 1.125 倍；玩家跑 6.0 一定拉得开，靠"进门"结束追逐）
export const CHASER_SPEED = 3.6
export const CHASE_TIMEOUT = 12

const TYPES = {
  principal: { color: 0x3a3f46, speed: CHASER_SPEED, height: 1.78 },
  guard: { color: 0x2f3b47, speed: CHASER_SPEED, height: 1.75 }
}

// 圆 vs AABB 推出。和 player.js 同一套手感：校长也不能穿教学楼。
function resolveCircle(p, radius, boxes) {
  if (!boxes || !boxes.length) return
  for (const b of boxes) {
    const cx = Math.max(b.min.x, Math.min(p.x, b.max.x))
    const cz = Math.max(b.min.z, Math.min(p.z, b.max.z))
    let dx = p.x - cx
    let dz = p.z - cz
    const d2 = dx * dx + dz * dz
    if (d2 >= radius * radius) continue
    if (d2 < 1e-8) {
      const left = p.x - b.min.x
      const right = b.max.x - p.x
      const back = p.z - b.min.z
      const front = b.max.z - p.z
      const m = Math.min(left, right, back, front)
      if (m === left) p.x = b.min.x - radius
      else if (m === right) p.x = b.max.x + radius
      else if (m === back) p.z = b.min.z - radius
      else p.z = b.max.z + radius
      continue
    }
    const d = Math.sqrt(d2)
    p.x += (dx / d) * (radius - d)
    p.z += (dz / d) * (radius - d)
  }
}

function insideXZ(p, box) {
  return p.x > box.min.x && p.x < box.max.x && p.z > box.min.z && p.z < box.max.z
}

export class Chaser {
  constructor(scene, world) {
    this.world = world
    this.active = false
    this.type = null
    this.speed = CHASER_SPEED
    this.pos = new THREE.Vector3()
    this.onCapture = null
    this.onTimeout = null
    this.captured = false
    this.chaseTime = 0
    this.held = false

    const mat = new THREE.MeshStandardMaterial({ color: TYPES.principal.color, roughness: 0.85 })
    this.body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 1.14, 6, 12), mat)
    this.body.position.y = 0.89
    this.body.visible = false
    this.body.castShadow = true
    scene.add(this.body)

    this.head = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 14, 12),
      new THREE.MeshStandardMaterial({ color: 0xd7b48f, roughness: 0.9 })
    )
    this.head.position.y = 1.63
    this.head.visible = false
    scene.add(this.head)
  }

  spawn(type = 'principal', zoneId = 'outdoor', from = null) {
    const cfg = TYPES[type] || TYPES.principal
    this.type = type
    this.speed = cfg.speed
    this.body.material = new THREE.MeshStandardMaterial({ color: cfg.color, roughness: 0.85 })
    this.active = true
    this.captured = false
    this.held = false
    this.chaseTime = 0
    this.zone = zoneId
    this.pos.copy(from || this.farEnd(zoneId))
    this.body.visible = true
    this.head.visible = true
    this.sync()
  }

  /**
   * 在玩家前方 10m 的圆周上采 16 个点：
   * - 排除 zone 外（越界）
   * - 排除建筑 AABB
   * - 取「最朝向玩家前方」的那个点
   * 不再用 farEnd 的远角（18.87m 远、还可能在楼后）。
   */
  spawnAhead(target, dist = 10) {
    const base = target?.pos || target
    if (!base) return new THREE.Vector3()
    const yaw = target?.yaw || 0
    const fx = Math.sin(yaw)
    const fz = Math.cos(yaw)
    const zone = this.world.zones[this.zone] || this.world.zones.outdoor
    const b = zone?.bounds
    const buildings = this.world.buildings || []
    let best = null
    let bestScore = -Infinity
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2
      const p = new THREE.Vector3(base.x + Math.sin(a) * dist, 0, base.z + Math.cos(a) * dist)
      if (b && (p.x < b.min.x + 0.4 || p.x > b.max.x - 0.4 || p.z < b.min.z + 0.4 || p.z > b.max.z - 0.4)) continue
      if (buildings.some((bb) => insideXZ(p, bb))) continue
      const score = (p.x - base.x) * fx + (p.z - base.z) * fz
      if (score > bestScore) {
        bestScore = score
        best = p
      }
    }
    return best || new THREE.Vector3(base.x, 0, base.z)
  }

  // "far_end"：保留给调试/旧路径，正式刷点走 spawnAhead
  farEnd(zoneId, avoid = null) {
    const zone = this.world.zones[zoneId] || this.world.zones.outdoor
    if (!zone.bounds) {
      return new THREE.Vector3(zone.origin.x, 0, zone.origin.z + 2)
    }
    const b = zone.bounds
    const corners = [
      new THREE.Vector3(b.min.x, 0, b.min.z),
      new THREE.Vector3(b.max.x, 0, b.min.z),
      new THREE.Vector3(b.min.x, 0, b.max.z),
      new THREE.Vector3(b.max.x, 0, b.max.z)
    ]
    if (!avoid) return corners[0]
    let best = corners[0]
    let bestD = -1
    for (const c of corners) {
      const d = (c.x - avoid.x) ** 2 + (c.z - avoid.z) ** 2
      if (d > bestD) {
        bestD = d
        best = c
      }
    }
    return best
  }

  /** 进门演出的 0.5 秒：停在门口 2m 处，转身看向玩家，不再继续追 */
  holdAt(x, z, lookX, lookZ) {
    if (!this.active) return
    this.held = true
    this.pos.set(x, 0, z)
    this.body.rotation.y = Math.atan2(lookX - x, lookZ - z) + Math.PI
    this.sync()
  }

  release() {
    this.held = false
  }

  update(dt, target, targetZone) {
    if (!this.active || this.captured) return
    // 玩家进了房间：校长留在原地等 2 秒再放弃（放弃逻辑在 bits 里计时）
    if (targetZone && targetZone !== this.zone) return
    if (this.held) return

    this.chaseTime += dt
    if (this.chaseTime >= CHASE_TIMEOUT) {
      this.abandon()
      this.onTimeout && this.onTimeout()
      return
    }

    const dx = target.x - this.pos.x
    const dz = target.z - this.pos.z
    const dist = Math.hypot(dx, dz)

    if (dist > 0.001) {
      const nx = dx / dist
      const nz = dz / dist
      this.pos.x += nx * this.speed * dt
      this.pos.z += nz * this.speed * dt
      this.body.rotation.y = Math.atan2(nx, nz) + Math.PI
    }

    // 防穿墙：追逐路径上也要被楼体挡住，不能从教学楼里穿出来
    const zone = this.world.zones[this.zone]
    if (zone?.colliders) resolveCircle(this.pos, 0.35, zone.colliders)
    if (zone?.bounds) {
      this.pos.x = Math.min(zone.bounds.max.x, Math.max(zone.bounds.min.x, this.pos.x))
      this.pos.z = Math.min(zone.bounds.max.z, Math.max(zone.bounds.min.z, this.pos.z))
    }

    this.sync()

    if (dist < 1.1 && !this.captured) {
      this.captured = true
      this.onCapture && this.onCapture({ type: this.type })
    }
  }

  sync() {
    // 校园地形有高差：校长也要踩在地上，不然会半截陷进山坡或浮着追人
    const gy = heightAt(this.pos.x, this.pos.z) + (terrainActive() ? 0.02 : 0)
    this.body.position.x = this.pos.x
    this.body.position.z = this.pos.z
    this.body.position.y = gy + 0.89
    this.head.position.x = this.pos.x
    this.head.position.z = this.pos.z
    this.head.position.y = gy + 1.63
  }

  despawn() {
    this.active = false
    this.held = false
    this.chaseTime = 0
    this.body.visible = false
    this.head.visible = false
  }

  // 放弃追逐：走人，但不触发死亡
  abandon() {
    this.despawn()
    this.captured = false
  }
}
