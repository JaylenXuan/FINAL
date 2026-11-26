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

// 用户提供的三视图拆出来的四向立绘：正面 / 左侧 / 背面 / 右侧。
// 全部由 public/models/chaser 下的透明 PNG 提供；没有额外生成费用。
const SPRITE_VIEWS = ['front', 'left', 'back', 'right']
const SPRITE_URLS = {
  front: '/models/chaser/principal_front.png',
  left: '/models/chaser/principal_left.png',
  back: '/models/chaser/principal_back.png',
  right: '/models/chaser/principal_right.png'
}
const SPRITE_W = 0.82
const SPRITE_H = 2.0
const SPRITE_BOTTOM_Y = 0

function shortestAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a))
}

function makeShadowTexture() {
  if (typeof document === 'undefined') return null
  const size = 96
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const g = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(0,0,0,0.34)')
  g.addColorStop(0.55, 'rgba(0,0,0,0.14)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
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
  constructor(scene, world, camera = null) {
    this.world = world
    this.camera = camera
    this.active = false
    this.type = null
    this.speed = CHASER_SPEED
    this.pos = new THREE.Vector3()
    this.onCapture = null
    this.onTimeout = null
    this.captured = false
    this.chaseTime = 0
    this.held = false
    this.facing = 0
    this.view = 'front'
    this.walkPhase = 0
    this.textures = {}
    this._loaded = 0
    this._loadErrors = 0

    // 一个 root 管位置，billboard 只负责朝向镜头（四向选图）。
    this.root = new THREE.Group()
    this.root.visible = false
    scene.add(this.root)

    this.material = new THREE.MeshBasicMaterial({
      transparent: true,
      alphaTest: 0.38,
      side: THREE.DoubleSide,
      depthWrite: true,
      toneMapped: false
    })
    this.billboard = new THREE.Mesh(new THREE.PlaneGeometry(SPRITE_W, SPRITE_H), this.material)
    this.billboard.position.y = SPRITE_H / 2
    this.billboard.visible = false
    this.billboard.frustumCulled = true
    this.root.add(this.billboard)

    const shadowTex = makeShadowTexture()
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      toneMapped: false
    })
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 0.52), shadowMat)
    this.shadow.rotation.x = -Math.PI / 2
    this.shadow.position.y = 0.018
    this.shadow.renderOrder = 1
    this.root.add(this.shadow)

    // 图片加载失败时才退回旧胶囊，避免学校长真的"消失"。
    this.fallback = new THREE.Group()
    this.fallback.visible = true
    const fbMat = new THREE.MeshStandardMaterial({ color: TYPES.principal.color, roughness: 0.85 })
    const fbBody = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 1.14, 6, 12), fbMat)
    fbBody.position.y = 0.89
    fbBody.castShadow = true
    const fbHead = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 14, 12),
      new THREE.MeshStandardMaterial({ color: 0xd7b48f, roughness: 0.9 })
    )
    fbHead.position.y = 1.63
    this.fallback.add(fbBody, fbHead)
    this.root.add(this.fallback)

    this._loadSprites()
  }

  _loadSprites() {
    const loader = new THREE.TextureLoader()
    for (const view of SPRITE_VIEWS) {
      loader.load(
        SPRITE_URLS[view],
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace
          tex.anisotropy = 4
          this.textures[view] = tex
          this._loaded += 1
          this.fallback.visible = false
          this.billboard.visible = true
          if (this.view === view || !this.material.map) this._applyView(view)
        },
        undefined,
        () => {
          this._loadErrors += 1
          if (this._loaded === 0 && this._loadErrors >= SPRITE_VIEWS.length) {
            this.billboard.visible = false
            this.fallback.visible = true
          }
        }
      )
    }
  }

  _applyView(view) {
    const tex = this.textures[view] || this.textures.front
    if (!tex) return
    this.view = view
    if (this.material.map === tex) return
    this.material.map = tex
    this.material.needsUpdate = true
    this.billboard.visible = true
    this.fallback.visible = false
  }

  _chooseView(cameraAngle) {
    // cameraAngle = 从校长指向镜头的方向。
    // rel=0 时镜头在校长正前方，用正面；rel=±π 时在背后，用背面。
    const rel = shortestAngle(cameraAngle - this.facing)
    let view = 'front'
    if (Math.abs(rel) > 2.35) view = 'back'
    else if (rel > 0.62) view = 'left'
    else if (rel < -0.62) view = 'right'
    this._applyView(view)
  }

  spawn(type = 'principal', zoneId = 'outdoor', from = null) {
    const cfg = TYPES[type] || TYPES.principal
    this.type = type
    this.speed = cfg.speed
    this.active = true
    this.captured = false
    this.held = false
    this.chaseTime = 0
    this.zone = zoneId
    this.pos.copy(from || this.farEnd(zoneId))
    this.root.visible = true
    this.billboard.visible = this._loaded > 0
    this.fallback.visible = this._loaded === 0
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
    this.facing = Math.atan2(lookX - x, lookZ - z)
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
      this.facing = Math.atan2(nx, nz)
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
    this.root.position.set(this.pos.x, gy, this.pos.z)

    // 立绘始终面向镜头；根据镜头在角色哪一侧切换四向图。
    const cam = this.camera
    const cameraAngle = cam
      ? Math.atan2(cam.position.x - this.pos.x, cam.position.z - this.pos.z)
      : this.facing
    this.root.rotation.y = cameraAngle
    this._chooseView(cameraAngle)

    this.walkPhase += 0.16
    const bob = this.held ? 0 : Math.abs(Math.sin(this.walkPhase)) * 0.025
    this.billboard.position.y = SPRITE_H / 2 + bob
    this.billboard.rotation.z = this.held ? 0 : Math.sin(this.walkPhase) * 0.012
    this.shadow.position.y = 0.018 + bob * 0.15
  }

  despawn() {
    this.active = false
    this.held = false
    this.chaseTime = 0
    this.root.visible = false
  }

  // 放弃追逐：走人，但不触发死亡
  abandon() {
    this.despawn()
    this.captured = false
  }
}
