// 常驻小地图（GTA5 雷达风格）：直接读 world.json 的地形数据绘制，不依赖图片。
// 用法：const mini = createMinimap({ data: worldData, world }); mini.update(player)

const ZONE_LABEL = {
  outdoor: 'Plaza',
  classroom: 'Classroom',
  library: 'Library',
  corridor: 'Corridor'
}

export function createMinimap({ data, world }) {
  const SIZE = 640 // canvas 分辨率
  const host = document.createElement('div')
  host.id = 'minimap'
  Object.assign(host.style, {
    position: 'fixed',
    left: '24px',
    top: '24px',
    width: '220px',
    height: '220px',
    borderRadius: '14px',
    overflow: 'hidden',
    background: 'rgba(12,16,22,.92)',
    border: '1px solid rgba(220,230,240,.55)',
    boxShadow: '0 6px 24px rgba(0,0,0,.45)',
    zIndex: '60',
    transition: 'width .25s ease, height .25s ease',
    pointerEvents: 'none'
  })

  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  canvas.style.display = 'block'
  host.appendChild(canvas)

  const tag = document.createElement('div')
  Object.assign(tag.style, {
    position: 'absolute',
    left: '12px',
    bottom: '10px',
    color: 'rgba(220,232,244,.85)',
    font: '600 11px/1 system-ui, sans-serif',
    letterSpacing: '.08em',
    textTransform: 'uppercase'
  })
  host.appendChild(tag)

  document.body.appendChild(host)
  const ctx = canvas.getContext('2d')

  const outdoor = data.outdoor
  const [[bx0, bz0], [bx1, bz1]] = outdoor.bounds
  const M = 1.5 // 外扩，留出边界
  const minX = bx0 - M, maxX = bx1 + M
  const minZ = bz0 - M, maxZ = bz1 + M
  const span = Math.max(maxX - minX, maxZ - minZ)
  const cx = (minX + maxX) / 2
  const cz = (minZ + maxZ) / 2
  const scale = SIZE / span

  const sx = (x) => (x - cx) * scale + SIZE / 2
  const sz = (z) => (z - cz) * scale + SIZE / 2

  let mode = 'normal'
  let last = 0

  function roundedRect(c, x, y, w, h, r) {
    c.beginPath()
    c.moveTo(x + r, y)
    c.arcTo(x + w, y, x + w, y + h, r)
    c.arcTo(x + w, y + h, x, y + h, r)
    c.arcTo(x, y + h, x, y, r)
    c.arcTo(x, y, x + w, y, r)
    c.closePath()
  }

  function drawBase() {
    ctx.clearRect(0, 0, SIZE, SIZE)
    ctx.fillStyle = '#0e1116'
    ctx.fillRect(0, 0, SIZE, SIZE)

    // 地面
    ctx.fillStyle = '#202b38'
    ctx.fillRect(sx(bx0), sz(bz0), (bx1 - bx0) * scale, (bz1 - bz0) * scale)

    // 建筑
    for (const b of outdoor.buildings || []) {
      const [w, , d] = b.size
      const x = sx(b.pos[0] - w / 2)
      const y = sz(b.pos[2] - d / 2)
      ctx.fillStyle = '#39465a'
      roundedRect(ctx, x, y, w * scale, d * scale, 6)
      ctx.fill()
      ctx.strokeStyle = '#6d7f96'
      ctx.lineWidth = 2
      ctx.stroke()
    }

    // 道具：树 / 长椅 / 闸机
    for (const p of outdoor.props || []) {
      if (!['tree', 'bench', 'gate'].includes(p.type)) continue
      const x = sx(p.pos[0]), y = sz(p.pos[2])
      if (p.type === 'tree') {
        ctx.fillStyle = 'rgba(96,146,104,.95)'
        ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill()
      } else if (p.type === 'bench') {
        ctx.fillStyle = 'rgba(160,132,94,.95)'
        ctx.fillRect(x - 6, y - 2.5, 12, 5)
      } else {
        ctx.strokeStyle = 'rgba(120,200,255,.85)'
        ctx.lineWidth = 2
        ctx.beginPath(); ctx.moveTo(x - 7, y); ctx.lineTo(x + 7, y); ctx.stroke()
      }
    }

    // 门 = 可交互点
    for (const p of outdoor.props || []) {
      if (p.type !== 'door') continue
      const x = sx(p.pos[0]), y = sz(p.pos[2])
      ctx.fillStyle = '#ffd166'
      ctx.fillRect(x - 8, y - 6, 16, 12)
    }

    // 锚点
    for (const a of world.anchorList || []) {
      if (a.zone !== 'outdoor') continue
      const x = sx(a.pos.x), y = sz(a.pos.z)
      ctx.strokeStyle = 'rgba(255,255,255,.95)'
      ctx.lineWidth = 2.5
      ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.stroke()
      ctx.fillStyle = '#ffd166'
      ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill()
    }
  }

  function drawPlayer(player) {
    const zone = player.zone
    if (zone === 'outdoor') {
      const x = sx(player.pos.x), y = sz(player.pos.z)
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(-player.yaw)
      ctx.fillStyle = '#78c8ff'
      ctx.strokeStyle = 'rgba(10,14,20,.9)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(0, -11)
      ctx.lineTo(-7, 8)
      ctx.lineTo(7, 8)
      ctx.closePath()
      ctx.fill(); ctx.stroke()
      ctx.restore()
    } else {
      // 室内：室外地图压暗，门口点一个蓝圈，顶部给房间名
      ctx.fillStyle = 'rgba(14,17,22,.58)'
      ctx.fillRect(0, 0, SIZE, SIZE)

      const door = (outdoor.props || []).find(
        (p) => p.type === 'door' && world.anchors.get(p.to)?.zone === zone
      )
      if (door) {
        const x = sx(door.pos[0]), y = sz(door.pos[2])
        ctx.strokeStyle = '#78c8ff'
        ctx.lineWidth = 3
        ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.stroke()
        ctx.fillStyle = '#78c8ff'
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill()
      }

      ctx.fillStyle = 'rgba(20,26,34,.95)'
      roundedRect(ctx, SIZE / 2 - 100, 40, 200, 44, 10)
      ctx.fill()
      ctx.strokeStyle = 'rgba(120,200,255,.75)'
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.fillStyle = 'rgba(226,236,246,.95)'
      ctx.font = '600 21px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(ZONE_LABEL[zone] || zone, SIZE / 2, 69)
    }
  }

  function drawFrame() {
    ctx.strokeStyle = 'rgba(220,230,240,.35)'
    ctx.lineWidth = 2
    roundedRect(ctx, 1, 1, SIZE - 2, SIZE - 2, 22)
    ctx.stroke()

    // N
    ctx.fillStyle = 'rgba(210,222,236,.9)'
    ctx.font = '700 18px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('N', SIZE - 26, 34)
    ctx.beginPath()
    ctx.moveTo(SIZE - 26, 40)
    ctx.lineTo(SIZE - 31, 54)
    ctx.lineTo(SIZE - 21, 54)
    ctx.closePath()
    ctx.fill()
  }

  function update(player, force = false) {
    const now = performance.now()
    if (!force && now - last < 90) return
    last = now
    drawBase()
    drawPlayer(player)
    drawFrame()
    tag.textContent = ZONE_LABEL[player.zone] || player.zone || ''
    tag.style.display = player.zone === 'outdoor' ? 'block' : 'none'
  }

  function setMode(next) {
    mode = next
    const big = mode === 'select'
    host.style.width = big ? '320px' : '220px'
    host.style.height = big ? '320px' : '220px'
    host.style.borderColor = big ? 'rgba(255,255,255,.95)' : 'rgba(220,230,240,.55)'
  }

  return { update, setMode, el: host, get mode() { return mode } }
}
