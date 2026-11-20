import * as THREE from 'three'

export const WALK_SPEED = 3.2
export const RUN_SPEED = 6.0
const RADIUS = 0.32

// 圆 vs AABB 推出；min==max 高度区间不参与判断（本作全是全高墙）
function resolve(p, boxes) {
  for (const b of boxes) {
    const cx = Math.max(b.min.x, Math.min(p.x, b.max.x))
    const cz = Math.max(b.min.z, Math.min(p.z, b.max.z))
    let dx = p.x - cx
    let dz = p.z - cz
    const d2 = dx * dx + dz * dz
    if (d2 >= RADIUS * RADIUS) continue

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
}

export class Player {
  constructor(scene, world) {
    this.world = world
    this.zone = 'outdoor'
    this.pos = new THREE.Vector3(0, 0, 6)
    this.prev = this.pos.clone()
    this.vel = new THREE.Vector3()
    this.yaw = Math.PI // 度转弧度在这里算，数据里是度
    this.phoneUp = false
    this.moving = false
    this.running = false

    this.group = new THREE.Group()
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x37506e, roughness: 0.8 })
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.15, 6, 12), bodyMat)
    body.position.y = 0.875
    body.castShadow = true
    this.group.add(body)

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 12), new THREE.MeshStandardMaterial({ color: 0xd7b48f, roughness: 0.9 }))
    head.position.y = 1.6
    this.group.add(head)

    // 手机：举起来时在胸前，Tab 切换
    this.phone = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.18, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x111318, emissive: 0x2a3f66, emissiveIntensity: 0.8 })
    )
    this.phone.position.set(0, 1.24, -0.34)
    this.phone.rotation.x = -0.9
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

  teleport(anchorId) {
    const a = this.world.anchors.get(anchorId)
    if (!a) {
      console.warn(`[player] 未知锚点 ${anchorId}`)
      return
    }
    this.zone = a.zone
    this.pos.copy(a.pos)
    this.prev.copy(a.pos)
    this.vel.set(0, 0, 0)
    this.yaw = THREE.MathUtils.degToRad(a.yaw)
    this.sync(1)
  }

  update(dt, input) {
    const axis = input.axis()
    this.moving = axis.moving
    this.running = axis.moving && axis.running

    const speed = this.running ? RUN_SPEED : WALK_SPEED
    const targetX = axis.x * speed
    const targetZ = axis.z * speed

    // 加减速，别像贴地飞行
    const accel = axis.moving ? 14 : 20
    this.vel.x += (targetX - this.vel.x) * Math.min(1, accel * dt)
    this.vel.z += (targetZ - this.vel.z) * Math.min(1, accel * dt)
    if (Math.abs(this.vel.x) < 0.02) this.vel.x = 0
    if (Math.abs(this.vel.z) < 0.02) this.vel.z = 0

    this.prev.copy(this.pos)
    this.pos.x += this.vel.x * dt
    this.pos.z += this.vel.z * dt

    const zone = this.activeZone
    resolve(this.pos, zone.colliders)
    if (zone.bounds) {
      this.pos.x = Math.min(zone.bounds.max.x, Math.max(zone.bounds.min.x, this.pos.x))
      this.pos.z = Math.min(zone.bounds.max.z, Math.max(zone.bounds.min.z, this.pos.z))
    }

    if (axis.moving) {
      const want = Math.atan2(this.vel.x, this.vel.z) + Math.PI
      let diff = ((want - this.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI
      this.yaw += diff * Math.min(1, 12 * dt)
    }
    this.phoneUp = this.phoneUp // 手机状态由 Tab / bits 控制
  }

  // alpha 是插值系数（0-1），渲染时用
  sync(alpha) {
    const x = this.prev.x + (this.pos.x - this.prev.x) * alpha
    const z = this.prev.z + (this.pos.z - this.prev.z) * alpha
    this.group.position.set(x, 0, z)
    this.group.rotation.y = this.yaw
    this.phone.visible = this.phoneUp
    this.phone.position.y = this.phoneUp ? 1.24 : 1.0
  }
}
