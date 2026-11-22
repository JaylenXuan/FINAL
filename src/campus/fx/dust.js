import * as THREE from 'three'

/**
 * 灰尘 / 冲刺拖尾粒子。
 * 不用 Points 是因为 Sprite 的 billboard + 单张软圆贴图就够了，
 * 每个粒子一个 material 才能单独淡出（池子固定 64 个，不会每帧 new）。
 */
function softCircleTexture() {
  const S = 96
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')
  const grd = g.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2)
  grd.addColorStop(0, 'rgba(255,255,255,0.95)')
  grd.addColorStop(0.42, 'rgba(255,255,255,0.5)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, S, S)
  return new THREE.CanvasTexture(c)
}

export function createDust(scene, { max = 72 } = {}) {
  const tex = softCircleTexture()
  const pool = []
  for (let i = 0; i < max; i++) {
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      color: 0xd9cfbd
    })
    const sprite = new THREE.Sprite(mat)
    sprite.visible = false
    sprite.renderOrder = 3
    scene.add(sprite)
    pool.push({
      sprite,
      life: 0,
      maxLife: 1,
      vel: new THREE.Vector3(),
      size: 0.4,
      grow: 0.6,
      drag: 2.2,
      gravity: 0.2
    })
  }
  let cursor = 0

  function spawn(x, y, z, opts = {}) {
    const {
      count = 1,
      spread = 0.25,
      speed = 0.9,
      up = 0.8,
      color = 0xd9cfbd,
      size = 0.42,
      grow = 0.7,
      life = 0.55,
      drag = 2.4,
      gravity = 0.35,
      dir = null
    } = opts
    for (let i = 0; i < count; i++) {
      const p = pool[cursor]
      cursor = (cursor + 1) % pool.length
      const a = Math.random() * Math.PI * 2
      const r = Math.random() * spread
      p.sprite.position.set(x + Math.cos(a) * r, y + Math.random() * 0.1, z + Math.sin(a) * r)
      if (dir) {
        p.vel.set(
          -dir.x * speed * (0.3 + Math.random() * 0.7) + Math.cos(a) * spread * 2,
          0.1 + Math.random() * up,
          -dir.z * speed * (0.3 + Math.random() * 0.7) + Math.sin(a) * spread * 2
        )
      } else {
        p.vel.set(Math.cos(a) * speed * (0.3 + Math.random() * 0.7), 0.1 + Math.random() * up, Math.sin(a) * speed * (0.3 + Math.random() * 0.7))
      }
      p.life = life * (0.75 + Math.random() * 0.5)
      p.maxLife = p.life
      p.size = size * (0.7 + Math.random() * 0.7)
      p.grow = grow
      p.drag = drag
      p.gravity = gravity
      p.sprite.scale.setScalar(p.size)
      p.sprite.material.color.setHex(color)
      p.sprite.material.opacity = 0
      p.sprite.visible = true
    }
  }

  /** 落地烟：一圈向外炸开的尘土 */
  function burst(pos, { count = 10, strength = 1, color = 0xd8cebc } = {}) {
    spawn(pos.x, pos.y + 0.04, pos.z, {
      count,
      spread: 0.18,
      speed: 0.9 + strength * 1.1,
      up: 0.55 + strength * 0.5,
      size: 0.3 + strength * 0.22,
      grow: 1.1,
      life: 0.42 + strength * 0.22,
      color,
      drag: 3.2,
      gravity: 0.2
    })
  }

  function update(dt) {
    for (const p of pool) {
      if (p.life <= 0) continue
      p.life -= dt
      if (p.life <= 0) {
        p.sprite.visible = false
        p.sprite.material.opacity = 0
        continue
      }
      const t = p.life / p.maxLife
      const k = Math.max(0, 1 - p.drag * dt)
      p.vel.x *= k
      p.vel.z *= k
      p.vel.y += p.gravity * dt
      p.sprite.position.x += p.vel.x * dt
      p.sprite.position.y += p.vel.y * dt
      p.sprite.position.z += p.vel.z * dt
      p.sprite.scale.setScalar(p.size * (1 + (1 - t) * p.grow))
      p.sprite.material.opacity = Math.min(0.7, t * 0.9)
    }
  }

  return { spawn, burst, update }
}
