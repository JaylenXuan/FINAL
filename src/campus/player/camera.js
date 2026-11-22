import * as THREE from 'three'
import { heightAt, terrainActive } from '../world/terrain.js'

const LOOK_H = 1.2
const SMOOTH = 8 // 8/s

export class CameraRig {
  constructor(camera, world) {
    this.camera = camera
    this.world = world
    this.zone = 'outdoor'
    this.mode = 'outdoor'
    this.fov = 50
    this.offset = new THREE.Vector3(0, 6, 9) // 旧版固定偏移，保留给尚未迁移的调用
    // 第三人称环绕镜头：相机围绕角色转，方位角 camYaw 会跟着角色朝向走
    this.camYaw = null
    this.camPitch = 0.28
    this.dist = 6.2
    this.followDelay = 0
    this.lookH = LOOK_H
    this.lookAt = new THREE.Vector3()
    this.desired = new THREE.Vector3()
    this.shakeAmp = 0
    this.shakeT = 0
    this.shakeDur = 0
    // 冲刺时收一点 FOV：不是单纯的「拉远」，而是镜头跟着速度往前顶
    this.fovBoost = 0
    this._tmp = new THREE.Vector3()
    this.frozen = false // 调试鸟瞰用：冻结跟随，机位由外部直接给
  }

  // 换尺度时用：校园 1km 级，机位要抬高拉远
  setOffset(x, y, z, lookH = LOOK_H) {
    this.offset.set(x, y, z)
    this.lookH = lookH
    // 旧接口是「机位在角色后上方多远」，换算成环绕镜头的距离 / 俯角
    const d = Math.hypot(x, z) || 6
    this.dist = Math.max(4.5, d)
    this.camPitch = Math.atan2(y - 1.1, d)
  }

  /** 鼠标拖拽 / 指针锁定的视角增量 */
  addOrbit(dx, dy) {
    if (this.camYaw === null) this.camYaw = 0
    // 灵敏度：0.005 太飘了，一划就转半圈；这里降到 0.0022
    this.camYaw -= dx * 0.0014
    this.camPitch = Math.min(1.0, Math.max(-0.05, this.camPitch + dy * 0.001))
    this.followDelay = 1.4 // 手动转视角后先别抢回来
  }

  /** 把相机放到目标背后（1 秒内不自动跟随） */
  _orbitPos(targetPos, yaw) {
    if (this.camYaw === null) this.camYaw = yaw
    const horiz = this.dist * Math.cos(this.camPitch)
    const vert = this.dist * Math.sin(this.camPitch)
    return this.desired.set(
      targetPos.x + Math.sin(this.camYaw) * horiz,
      targetPos.y + 1.15 + vert,
      targetPos.z + Math.cos(this.camYaw) * horiz
    )
  }

  // 传送 / 开场必须硬切，否则 lerp 会从上一个位置慢慢飘过去，前几帧拍到的全是地面
  // 室内没有跟随这一说：机位直接吃 roomCameras，否则会先从玩家头顶飘一段再飞进房间
  snapTo(targetPos, yaw) {
    const room = this.world.roomCameras[this.zone]
    if (room) {
      this.camera.position.copy(room.pos)
      this.lookAt.copy(room.lookAt)
      this.camera.lookAt(this.lookAt)
      return
    }
    if (typeof yaw === 'number') this.camYaw = yaw
    this._orbitPos(targetPos, this.camYaw ?? 0)
    this.camera.position.copy(this.desired)
    this._tmp.copy(targetPos)
    this._tmp.y += this.lookH
    this.lookAt.copy(this._tmp)
    this.camera.lookAt(this.lookAt)
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

  update(dt, targetPos, yaw) {
    if (this.frozen) {
      this.camera.lookAt(this.lookAt)
      return
    }

    const room = this.world.roomCameras[this.zone]

    if (room) {
      // 室内固定机位：位置不动，只做轻微推近避免完全静止
      this.camera.position.lerp(room.pos, 1 - Math.exp(-6 * dt))
      this.lookAt.lerp(room.lookAt, 1 - Math.exp(-6 * dt))
    } else {
      // 视角只由鼠标决定：键盘只负责移动，不许它偷偷把镜头拽走
      if (this.camYaw === null) this.camYaw = yaw ?? 0
      this._orbitPos(targetPos, this.camYaw)
      // 机位也要「离地」：相机滑进山坡里的时候，地面会像一堵墙横切角色，
      // 看起来就像人被埋了半截。这里把相机顶到地表以上 1.1m。
      if (terrainActive()) {
        const need = heightAt(this.desired.x, this.desired.z) + 1.1
        if (this.desired.y < need) this.desired.y = need
      }
      const k = 1 - Math.exp(-SMOOTH * dt)
      this.camera.position.lerp(this.desired, k)
      this._tmp.copy(targetPos)
      this._tmp.y += this.lookH
      this.lookAt.lerp(this._tmp, k)
    }

    if (!room && terrainActive()) {
      const need = heightAt(this.camera.position.x, this.camera.position.z) + 1.0
      if (this.camera.position.y < need) this.camera.position.y = need
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

    // 冲刺 FOV：平滑推到 base + boost，松开后慢慢回来
    const fovTarget = this.fov + this.fovBoost
    if (Math.abs(this.camera.fov - fovTarget) > 0.015) {
      this.camera.fov += (fovTarget - this.camera.fov) * Math.min(1, 6 * dt)
      this.camera.updateProjectionMatrix()
    }

    this.camera.position.x += sx
    this.camera.position.y += sy
    this.camera.lookAt(this.lookAt)
    this.camera.position.x -= sx
    this.camera.position.y -= sy
  }
}
