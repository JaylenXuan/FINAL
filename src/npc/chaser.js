import * as THREE from 'three'

// 校长 / 保安共用同一套：只有外观不同
// 速度定值 3.6（= 玩家走路 3.2 的 1.125 倍；玩家跑 6.0 一定拉得开，靠"进门"结束追逐）
export const CHASER_SPEED = 3.6

const TYPES = {
  principal: { color: 0x3a3f46, speed: CHASER_SPEED, height: 1.78 },
  guard: { color: 0x2f3b47, speed: CHASER_SPEED, height: 1.75 }
}

export class Chaser {
  constructor(scene, world) {
    this.world = world
    this.active = false
    this.type = null
    this.speed = CHASER_SPEED
    this.pos = new THREE.Vector3()
    this.onCapture = null
    this.captured = false

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
    this.zone = zoneId
    this.pos.copy(from || this.farEnd(zoneId))
    this.body.visible = true
    this.head.visible = true
    this.sync()
  }

  // "far_end"：取 zone 边界上离玩家最远的那个角，避免从玩家背后刷出来
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

  update(dt, target, targetZone) {
    if (!this.active || this.captured) return
    // 玩家进了房间：校长留在原地等 2 秒再放弃（放弃逻辑在 bits 里计时）
    if (targetZone && targetZone !== this.zone) return

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

    const zone = this.world.zones[this.zone]
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
    this.body.position.x = this.pos.x
    this.body.position.z = this.pos.z
    this.head.position.x = this.pos.x
    this.head.position.z = this.pos.z
  }

  despawn() {
    this.active = false
    this.body.visible = false
    this.head.visible = false
  }

  // 放弃追逐：走人，但不触发死亡
  abandon() {
    this.despawn()
    this.captured = false
  }
}
