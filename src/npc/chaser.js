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
// 每张图按“上半身 / 下半身”切开：上半身保持原图，下半身按左右腿
// （侧视图按整条下身）绕胯部摆动，这样纸片人也能有走路迈腿的动作。
const SPRITE_VIEWS = ['front', 'left', 'back', 'right']
const SPRITE_URLS = {
  front: '/models/chaser/principal_front.png',
  left: '/models/chaser/principal_left.png',
  back: '/models/chaser/principal_back.png',
  right: '/models/chaser/principal_right.png'
}
const SPRITE_W = 0.82
const SPRITE_H = 2.0
const SPRITE_CANVAS_H = 1024
// 三张立绘的大腿分叉线大约都在 690px；用它作为胯部转轴。
const HIP_CANVAS_Y = 690
const HIP_V = 1 - HIP_CANVAS_Y / SPRITE_CANVAS_H
const HIP_WORLD = SPRITE_H * HIP_V
const LEG_H = HIP_WORLD + 0.035
const LEG_PIVOT_X = 0.09
const LEG_LIFT = 0.06
const WALK_RATE = 9.0

function shortestAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a))
}

// 用一张全立绘贴图裁出局部四边面：UV 负责裁图，顶点负责位置。
// 这样四向 PNG 不需要再切成十几张小图，加载量和仓库体积都保持很小。
function makeCropGeometry(width, height, u0, v0, u1, v1) {
  const geo = new THREE.PlaneGeometry(width, height)
  const pos = geo.attributes.position
  const uv = geo.attributes.uv
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    uv.setXY(i, x > 0 ? u1 : u0, y > 0 ? v1 : v0)
  }
  uv.needsUpdate = true
  return geo
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
    this._sideView = false

    // 一个 root 管位置，body 内的纸片分层负责朝向镜头和迈腿。
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

    this._buildBody()

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

  _buildBody() {
    this.body = new THREE.Group()
    this.body.visible = false
    this.root.add(this.body)

    // 上半身：从胯部向上的整块立绘。
    const upperH = SPRITE_H - HIP_WORLD
    this.upper = new THREE.Mesh(
      makeCropGeometry(SPRITE_W, upperH, 0, HIP_V, 1, 1),
      this.material
    )
    this.upper.position.y = HIP_WORLD + upperH / 2
    this.upper.position.z = 0.002
    this.upper.renderOrder = 2
    this.body.add(this.upper)

    // 正面 / 背面：左腿、右腿分别绕自己的胯部摆动。
    this.legL = new THREE.Group()
    this.legL.position.set(-LEG_PIVOT_X, HIP_WORLD + 0.035, 0)
    this.legLMesh = new THREE.Mesh(
      makeCropGeometry(SPRITE_W / 2, LEG_H, 0, 0, 0.5, HIP_V),
      this.material
    )
    this.legLMesh.position.set(-0.115, -LEG_H / 2, 0)
    this.legLMesh.renderOrder = 1
    this.legL.add(this.legLMesh)
    this.body.add(this.legL)

    this.legR = new THREE.Group()
    this.legR.position.set(LEG_PIVOT_X, HIP_WORLD + 0.035, 0)
    this.legRMesh = new THREE.Mesh(
      makeCropGeometry(SPRITE_W / 2, LEG_H, 0.5, 0, 1, HIP_V),
      this.material
    )
    this.legRMesh.position.set(0.115, -LEG_H / 2, 0)
    this.legRMesh.renderOrder = 1
    this.legR.add(this.legRMesh)
    this.body.add(this.legR)

    // 侧面：两张腿在画面里几乎重叠，不能硬切；整条下身一起绕胯摆动。
    this.lowerWhole = new THREE.Group()
    this.lowerWhole.position.set(0, HIP_WORLD + 0.035, 0)
    this.lowerWholeMesh = new THREE.Mesh(
      makeCropGeometry(SPRITE_W, LEG_H, 0, 0, 1, HIP_V),
      this.material
    )
    this.lowerWholeMesh.position.set(0, -LEG_H / 2, 0)
    this.lowerWholeMesh.renderOrder = 1
    this.lowerWhole.add(this.lowerWholeMesh)
    this.body.add(this.lowerWhole)

    this._setLegVisibility(false)
  }

  _setLegVisibility(side) {
    this._sideView = side
    this.legL.visible = !side
    this.legR.visible = !side
    this.lowerWhole.visible = side
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
          this.body.visible = true
          if (this.view === view || !this.material.map) this._applyView(view)
        },
        undefined,
        () => {
          this._loadErrors += 1
          if (this._loaded === 0 && this._loadErrors >= SPRITE_VIEWS.length) {
            this.body.visible = false
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
    if (this.material.map !== tex) {
      this.material.map = tex
      this.material.needsUpdate = true
    }
    this.body.visible = true
    this.fallback.visible = false
    this._setLegVisibility(view === 'left' || view === 'right')
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
    this.walkPhase = 0
    this.zone = zoneId
    this.pos.copy(from || this.farEnd(zoneId))
    this.root.visible = true
    this.body.visible = this._loaded > 0
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

    // 跑到玩家身边时步频略微加快，脚步和追逐速度匹配。
    this.walkPhase += dt * WALK_RATE * (this.speed / CHASER_SPEED)
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

    // 分层立绘始终面向镜头；根据镜头在角色哪一侧切换四向图。
    const cam = this.camera
    const cameraAngle = cam
      ? Math.atan2(cam.position.x - this.pos.x, cam.position.z - this.pos.z)
      : this.facing
    this.root.rotation.y = cameraAngle
    this._chooseView(cameraAngle)

    const s = this.held ? 0 : Math.sin(this.walkPhase)
    const liftL = Math.max(0, s) * LEG_LIFT
    const liftR = Math.max(0, -s) * LEG_LIFT

    if (this._sideView) {
      // 侧面：整条下半身前后摆，脚尖跟着抬落。
      this.lowerWhole.rotation.z = s * 0.095
      this.lowerWhole.position.y = HIP_WORLD + 0.035 + Math.max(0, Math.abs(s)) * 0.012
      this.legL.rotation.set(0, 0, 0)
      this.legR.rotation.set(0, 0, 0)
    } else {
      // 正面 / 背面：两条腿绕胯前后迈，脚步有抬落差。
      this.legL.rotation.x = s * 0.24
      this.legR.rotation.x = -s * 0.24
      this.legL.rotation.z = s * 0.035
      this.legR.rotation.z = -s * 0.035
      this.legL.position.y = HIP_WORLD + 0.035 + liftL
      this.legR.position.y = HIP_WORLD + 0.035 + liftR
      this.lowerWhole.rotation.z = 0
    }

    // 上半身轻微起伏，和脚步错开半拍，纸片人也有重量感。
    const upperBase = HIP_WORLD + (SPRITE_H - HIP_WORLD) / 2
    this.upper.position.y = upperBase + Math.abs(s) * 0.018
    this.body.rotation.z = s * 0.006
    this.shadow.scale.x = 1 + Math.abs(s) * 0.035
    this.shadow.scale.y = 1 - Math.abs(s) * 0.02
  }

  despawn() {
    this.active = false
    this.held = false
    this.chaseTime = 0
    this.walkPhase = 0
    this.root.visible = false
  }

  // 放弃追逐：走人，但不触发死亡
  abandon() {
    this.despawn()
    this.captured = false
  }
}
