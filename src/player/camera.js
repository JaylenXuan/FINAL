import * as THREE from 'three'

const OFFSET = new THREE.Vector3(0, 6, 9)
const LOOK_H = 1.2
const SMOOTH = 8 // 8/s

export class CameraRig {
  constructor(camera, world) {
    this.camera = camera
    this.world = world
    this.zone = 'outdoor'
    this.mode = 'outdoor'
    this.fov = 50
    this.lookAt = new THREE.Vector3()
    this.desired = new THREE.Vector3()
    this.shakeAmp = 0
    this.shakeT = 0
    this.shakeDur = 0
    this._tmp = new THREE.Vector3()
  }

  setZone(zoneId, snap = true) {
    this.zone = zoneId
    const room = this.world.roomCameras[zoneId]
    this.mode = room ? 'indoor' : 'outdoor'
    this.fov = room ? room.fov : 50
    this.camera.fov = this.fov
    this.camera.updateProjectionMatrix()
    if (snap && room) {
      this.camera.position.copy(room.pos)
      this.lookAt.copy(room.lookAt)
      this.camera.lookAt(this.lookAt)
    }
  }

  shake(amp = 0.4, dur = 0.3) {
    this.shakeAmp = amp
    this.shakeT = 0
    this.shakeDur = dur
  }

  update(dt, targetPos) {
    const room = this.world.roomCameras[this.zone]

    if (room) {
      // 室内固定机位：位置不动，只做轻微推近避免完全静止
      this.camera.position.lerp(room.pos, 1 - Math.exp(-6 * dt))
      this.lookAt.lerp(room.lookAt, 1 - Math.exp(-6 * dt))
    } else {
      this.desired.copy(targetPos).add(OFFSET)
      const k = 1 - Math.exp(-SMOOTH * dt)
      this.camera.position.lerp(this.desired, k)
      this._tmp.copy(targetPos)
      this._tmp.y += LOOK_H
      this.lookAt.lerp(this._tmp, k)
    }

    // 震屏：被抓定格时叠一个短促抖动
    let sx = 0
    let sy = 0
    if (this.shakeDur > 0 && this.shakeT < this.shakeDur) {
      const f = 1 - this.shakeT / this.shakeDur
      sx = (Math.random() - 0.5) * this.shakeAmp * f
      sy = (Math.random() - 0.5) * this.shakeAmp * f
      this.shakeT += dt
    }

    this.camera.position.x += sx
    this.camera.position.y += sy
    this.camera.lookAt(this.lookAt)
    this.camera.position.x -= sx
    this.camera.position.y -= sy
  }
}
