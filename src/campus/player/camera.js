import * as THREE from 'three'
import { heightAt, terrainActive } from '../world/terrain.js'

const LOOK_H = 1.2
const SMOOTH = 8 // 8/s

function pointInPoly(x, z, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]
    const [xj, zj] = poly[j]
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

function cameraBlocked(world, x, y, z) {
  const zone = world.zones?.outdoor
  if (!zone) return false
  for (const item of zone.polyColliders || []) {
    const b = item.bbox
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue
    if (pointInPoly(x, z, item.poly)) return true
  }
  for (const b of zone.extraColliders || []) {
    if (x > b.min.x && x < b.max.x && z > b.min.z && z < b.max.z && y < b.max.y) return true
  }
  return false
}

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
    // 室内自由视角：机位固定在教室里的 roomCamera.pos，鼠标只转朝向
    this.indoorYaw = 0
    this.indoorPitch = 0
    this.indoorLookAt = new THREE.Vector3()
    this.dist = 6.2
    this.outdoorDist = 6.2
    this.outdoorPitch = 0.28
    this.indoorDist = 5.2
    this.indoorPitch = 0.26
    this.indoorSide = 1.3
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
    this.outdoorDist = this.dist
    this.outdoorPitch = this.camPitch
  }

  /** 鼠标拖拽 / 指针锁定的视角增量 */
  addOrbit(dx, dy) {
    if (this.mode === 'firstPerson') {
      this.camYaw -= dx * 0.0018
      this.camPitch = Math.min(0.8, Math.max(-0.8, this.camPitch + dy * 0.0014))
      return
    }
    if (this.mode === 'indoor') {
      // 室内：位置不动，鼠标只旋转视线
      this.indoorYaw -= dx * 0.0018
      this.indoorPitch = Math.min(0.7, Math.max(-0.6, this.indoorPitch + dy * 0.0014))
      return
    }
    if (this.camYaw === null) this.camYaw = 0
    // 灵敏度：0.005 太飘了，一划就转半圈；这里降到 0.0022
    this.camYaw -= dx * 0.0014
    this.camPitch = Math.min(1.0, Math.max(-0.05, this.camPitch + dy * 0.001))
    this.followDelay = 1.4 // 手动转视角后先别抢回来
  }

  _resetIndoorLook(room) {
    const dx = room.lookAt.x - room.pos.x
    const dy = room.lookAt.y - room.pos.y
    const dz = room.lookAt.z - room.pos.z
    this.indoorYaw = Math.atan2(dx, dz)
    this.indoorPitch = Math.max(-0.6, Math.min(0.7, Math.atan2(dy, Math.hypot(dx, dz))))
  }

  _indoorLook(room) {
    const cp = Math.cos(this.indoorPitch)
    this.indoorLookAt.set(
      room.pos.x + Math.sin(this.indoorYaw) * cp * 10,
      room.pos.y + Math.sin(this.indoorPitch) * 10,
      room.pos.z + Math.cos(this.indoorYaw) * cp * 10
    )
    return this.indoorLookAt
  }

  /** 室内跟随镜头：仍然在玩家背后，但把机位夹在房间/走廊内部，避免穿墙 */
  _indoorFollowPos(targetPos) {
    if (this.camYaw === null) this.camYaw = 0
    const horiz = this.indoorDist * Math.cos(this.camPitch)
    const vert = this.indoorDist * Math.sin(this.camPitch)
    let x = targetPos.x + Math.sin(this.camYaw) * horiz + Math.cos(this.camYaw) * this.indoorSide
    let z = targetPos.z + Math.cos(this.camYaw) * horiz - Math.sin(this.camYaw) * this.indoorSide
    let y = targetPos.y + 1.5 + vert
    const zone = this.world.zones?.[this.zone]
    if (zone?.origin && zone.size) {
      const m = 0.42
      x = Math.min(zone.origin.x + zone.size.w / 2 - m, Math.max(zone.origin.x - zone.size.w / 2 + m, x))
      z = Math.min(zone.origin.z + zone.size.d / 2 - m, Math.max(zone.origin.z - zone.size.d / 2 + m, z))
      const floor = zone.floorY ?? zone.origin.y
      y = Math.min(floor + zone.size.h - 0.35, Math.max(floor + 1.15, y))
    }
    return this.desired.set(x, y, z)
  }

  /** 室外第三人称：镜头到玩家之间如果隔着一栋楼，就把机位收到墙前，避免穿墙 */
  _avoidOutdoorWalls(targetPos) {
    const world = this.world
    const eyeY = targetPos.y + 1.2
    const dx = this.desired.x - targetPos.x
    const dy = this.desired.y - eyeY
    const dz = this.desired.z - targetPos.z
    const steps = 14
    let free = 0
    for (let i = 1; i <= steps; i++) {
      const k = i / steps
      const x = targetPos.x + dx * k
      const y = eyeY + dy * k
      const z = targetPos.z + dz * k
      if (cameraBlocked(world, x, y, z)) break
      free = k
    }
    if (free < 1) {
      const k = Math.max(0.1, free - 0.04)
      this.desired.set(targetPos.x + dx * k, eyeY + dy * k, targetPos.z + dz * k)
    }
    return this.desired
  }

  /** 把相机放到目标背后（1 秒内不自动跟随） */
  _orbitPos(targetPos, yaw) {
    if (this.camYaw === null) this.camYaw = yaw
    const horiz = this.dist * Math.cos(this.camPitch)
    const vert = this.dist * Math.sin(this.camPitch)
    this.desired.set(
      targetPos.x + Math.sin(this.camYaw) * horiz,
      targetPos.y + 1.15 + vert,
      targetPos.z + Math.cos(this.camYaw) * horiz
    )
    if (this.mode === 'outdoor') this._avoidOutdoorWalls(targetPos)
    return this.desired
  }

  // 传送 / 开场必须硬切，否则 lerp 会从上一个位置慢慢飘过去，前几帧拍到的全是地面
  // 室内没有跟随这一说：机位直接吃 roomCameras，否则会先从玩家头顶飘一段再飞进房间
  snapTo(targetPos, yaw) {
    if (this.mode === 'firstPerson') {
      if (typeof yaw === 'number') this.camYaw = yaw
      this.camPitch = 0
      this.camera.position.set(targetPos.x, targetPos.y + 1.55, targetPos.z)
      this._tmp.set(
        targetPos.x - Math.sin(this.camYaw) * 10,
        targetPos.y + 1.55,
        targetPos.z - Math.cos(this.camYaw) * 10
      )
      this.lookAt.copy(this._tmp)
      this.camera.lookAt(this.lookAt)
      return
    }
    const room = this.world.roomCameras[this.zone]
    if (room) {
      this.camera.position.copy(room.pos)
      this._resetIndoorLook(room)
      this.lookAt.copy(this._indoorLook(room))
      this.camera.lookAt(this.lookAt)
      return
    }
    if (this.mode === 'indoorFollow') {
      if (typeof yaw === 'number') this.camYaw = yaw
      this._indoorFollowPos(targetPos)
      this.camera.position.copy(this.desired)
      this._tmp.copy(targetPos)
      this._tmp.y += this.lookH
      this.lookAt.copy(this._tmp)
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
    const follow = this.world.indoorFollow?.has(zoneId)
    const firstPerson = this.world.firstPersonZones?.has(zoneId)
    this.mode = room ? 'indoor' : firstPerson ? 'firstPerson' : follow ? 'indoorFollow' : 'outdoor'
    if (firstPerson) {
      this.fov = 58
    } else if (follow) {
      this.dist = this.indoorDist
      this.camPitch = this.indoorPitch
      this.fov = 56
    } else if (room) {
      this.fov = room.fov
    } else {
      this.dist = this.outdoorDist
      this.camPitch = this.outdoorPitch
      this.fov = 50
    }
    this.camera.fov = this.fov
    this.camera.updateProjectionMatrix()
    if (snap && room) {
      this.camera.position.copy(room.pos)
      this._resetIndoorLook(room)
      this.lookAt.copy(this._indoorLook(room))
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

    if (this.mode === 'firstPerson') {
      // 教室：第一人称，玩家眼睛高度；鼠标控制朝向
      const eye = 1.55
      this.camera.position.set(targetPos.x, targetPos.y + eye, targetPos.z)
      const cp = Math.cos(this.camPitch)
      this._tmp.set(
        targetPos.x - Math.sin(this.camYaw) * cp * 10,
        targetPos.y + eye - Math.sin(this.camPitch) * 10,
        targetPos.z - Math.cos(this.camYaw) * cp * 10
      )
      this.lookAt.copy(this._tmp)
    } else if (room) {
      // 室内固定机位（校园原有大厅）；教室/走廊走 indoorFollow
      this.camera.position.lerp(room.pos, 1 - Math.exp(-6 * dt))
      const targetLook = this._indoorLook(room)
      this.lookAt.lerp(targetLook, 1 - Math.exp(-14 * dt))
    } else if (this.mode === 'indoorFollow') {
      if (this.camYaw === null) this.camYaw = yaw ?? 0
      this._indoorFollowPos(targetPos)
      const k = 1 - Math.exp(-10 * dt)
      this.camera.position.lerp(this.desired, k)
      this._tmp.copy(targetPos)
      this._tmp.y += this.lookH
      this.lookAt.lerp(this._tmp, k)
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

    if (!room && this.mode === 'outdoor' && terrainActive()) {
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
