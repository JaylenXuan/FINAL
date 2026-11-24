// 常驻小地图（GTA5 雷达风格）：直接读 world.json 的地形数据绘制，不依赖图片。
// 用法：const mini = createMinimap({ data: worldData, world })
//       mini.update(player)
//       mini.setSelectMode(anchors, (anchor) => ...)  // 死亡后点图选点

const ZONE_LABEL = {
  outdoor: 'Plaza',
  classroom: 'Classroom',
  library: 'Library',
  corridor: 'Corridor'
}

export function createMinimap({ data, world }) {
  const SIZE = 640
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
    pointerEvents: 'none',
    cursor: 'default'
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
  const M = 1.5
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
  let lastPlayer = null
  let selectAnchors = []
  let selectedId = null
  let onConfirmCb = null

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

    ctx.fillStyle = '#202b38'
    ctx.fillRect(sx(bx0), sz(bz0), (bx1 - bx0) * scale, (bz1 - bz0) * scale)

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

    for (const p of outdoor.props || []) {
      if (p.type !== 'door') continue
      const x = sx(p.pos[0]), y = sz(p.pos[2])
      ctx.fillStyle = '#ffd166'
      ctx.fillRect(x - 8, y - 6, 16, 12)
    }
  }

  function drawPlayer(player) {
    if (!player) return
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

  function drawSelect() {
    ctx.fillStyle = 'rgba(6,8,12,.72)'
    ctx.fillRect(0, 0, SIZE, SIZE)

    selectAnchors.forEach((a, i) => {
      const x = sx(a.mx), y = sz(a.mz)
      const sel = a.id === selectedId
      const r = sel ? 32 : 26

      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fillStyle = sel ? 'rgba(255,255,255,.18)' : 'rgba(20,26,34,.85)'
      ctx.fill()
      ctx.strokeStyle = sel ? 'rgba(255,255,255,.98)' : 'rgba(200,214,230,.65)'
      ctx.lineWidth = sel ? 4 : 2.5
      ctx.stroke()

      ctx.fillStyle = sel ? '#ffffff' : '#cfdae8'
      ctx.font = '700 24px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(i + 1), x, y + 1)
    })

    // 图例：避免名字堆在门口
    const rowH = 36
    const boxW = 260
    const boxH = selectAnchors.length * rowH + 24
    const bx = 24
    const by = SIZE - boxH - 24
    ctx.fillStyle = 'rgba(12,16,22,.92)'
    roundedRect(ctx, bx, by, boxW, boxH, 12)
    ctx.fill()
    ctx.strokeStyle = 'rgba(200,214,230,.32)'
    ctx.lineWidth = 2
    ctx.stroke()

    selectAnchors.forEach((a, i) => {
      const ty = by + 20 + i * rowH
      const sel = a.id === selectedId
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = sel ? '#ffd166' : 'rgba(160,176,196,.85)'
      ctx.font = '700 18px system-ui, sans-serif'
      ctx.fillText(String(i + 1), bx + 18, ty)
      ctx.fillStyle = sel ? '#ffffff' : 'rgba(206,218,232,.9)'
      ctx.font = '500 17px system-ui, sans-serif'
      ctx.fillText(a.label, bx + 48, ty)
    })
    ctx.textBaseline = 'alphabetic'
  }

  function drawFrame() {
    ctx.strokeStyle = 'rgba(220,230,240,.35)'
    ctx.lineWidth = 2
    roundedRect(ctx, 1, 1, SIZE - 2, SIZE - 2, 22)
    ctx.stroke()

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

  function render(force = false) {
    const now = performance.now()
    if (!force && now - last < 90) return
    last = now

    drawBase()
    drawPlayer(lastPlayer)
    if (mode === 'select') drawSelect()
    drawFrame()

    if (mode === 'select') {
      tag.textContent = 'CHOOSE RESPAWN'
      tag.style.display = 'block'
    } else {
      tag.textContent = lastPlayer ? (ZONE_LABEL[lastPlayer.zone] || lastPlayer.zone) : ''
      tag.style.display = lastPlayer && lastPlayer.zone === 'outdoor' ? 'block' : 'none'
    }
  }

  function update(player, force = false) {
    lastPlayer = player
    if (mode === 'select') return
    render(force)
  }

  function hitTest(clientX, clientY) {
    const rect = host.getBoundingClientRect()
    const x = ((clientX - rect.left) / rect.width) * SIZE
    const y = ((clientY - rect.top) / rect.height) * SIZE
    let best = null
    let bestD = Infinity
    for (const a of selectAnchors) {
      const d = Math.hypot(sx(a.mx) - x, sz(a.mz) - y)
      if (d < bestD) { bestD = d; best = a }
    }
    return bestD <= 52 ? best : null
  }

  host.addEventListener('click', (e) => {
    if (mode !== 'select') return
    const a = hitTest(e.clientX, e.clientY)
    if (!a) return
    if (a.id === selectedId) {
      onConfirmCb && onConfirmCb(a)
      return
    }
    selectedId = a.id
    render(true)
  })

  function setMode(next) {
    mode = next
    if (next === 'select') {
      host.style.width = '520px'
      host.style.height = '520px'
      host.style.borderColor = 'rgba(255,255,255,.95)'
      host.style.pointerEvents = 'auto'
      host.style.cursor = 'pointer'
    } else {
      host.style.width = '220px'
      host.style.height = '220px'
      host.style.borderColor = 'rgba(220,230,240,.55)'
      host.style.pointerEvents = 'none'
      host.style.cursor = 'default'
      selectAnchors = []
      selectedId = null
      onConfirmCb = null
    }
  }

  const DOOR_FALLBACK = {
    classroom: [-3, -6.2],
    library: [-6.5, -6.2],
    corridor: [-0.5, -6.2]
  }

  function setSelectMode(anchors, onConfirm) {
    selectAnchors = anchors.map((a) => {
      let mx = a.pos.x
      let mz = a.pos.z
      if (a.zone !== 'outdoor') {
        const door = (outdoor.props || []).find((p) => p.type === 'door' && p.to === a.id)
        if (door) {
          mx = door.pos[0]
          mz = door.pos[2]
        } else if (DOOR_FALLBACK[a.zone]) {
          mx = DOOR_FALLBACK[a.zone][0]
          mz = DOOR_FALLBACK[a.zone][1]
        }
      }
      return { ...a, mx, mz }
    })
    selectedId = null
    onConfirmCb = onConfirm || null
    setMode('select')
    render(true)
  }

  return {
    update,
    setMode,
    setSelectMode,
    el: host,
    get mode() { return mode }
  }
}
