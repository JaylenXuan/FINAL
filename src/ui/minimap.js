// 常驻小地图（GTA5 雷达风格）
// - 全部由 data/world.json 的 building / room / prop 矩形生成 SVG，不手画
// - 常态 220×220，死亡选点时放大到 320×320，只亮地图、锚点脉冲、键鼠选点
// - 玩家箭头跟着 yaw 转；室内显示当前 room 的俯视图

const NS = 'http://www.w3.org/2000/svg'
const SIZE = 220
const ANCHOR_COLOR = {
  a_classroom: '#ffd166',
  a_corridor: '#5fd3c4',
  a_library: '#78c8ff',
  a_plaza: '#ff8f6b'
}
const ZONE_LABEL = { outdoor: 'Plaza', classroom: 'Classroom', library: 'Library', corridor: 'Corridor' }

function svgEl(tag, attrs = {}, parent = null) {
  const node = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v))
  if (parent) parent.appendChild(node)
  return node
}

function roundedPath(x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  return `M${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h - rr} Q${x + w},${y + h} ${x + w - rr},${y + h} H${x + rr} Q${x},${y + h} ${x},${y + h - rr} V${y + rr} Q${x},${y} ${x + rr},${y} Z`
}

export function createMinimap({ data, world, display = null }) {
  const host = document.createElement('div')
  host.id = 'minimap'
  Object.assign(host.style, {
    position: 'fixed',
    left: '16px',
    top: '16px',
    width: `${SIZE}px`,
    height: `${SIZE}px`,
    borderRadius: '16px',
    overflow: 'hidden',
    background: 'rgba(10,14,20,.94)',
    border: '1px solid rgba(220,232,244,.62)',
    boxShadow: '0 8px 28px rgba(0,0,0,.5)',
    zIndex: '60',
    transition: 'width .28s ease, height .28s ease, border-color .28s',
    pointerEvents: 'none'
  })

  const svg = svgEl('svg', { viewBox: `0 0 ${SIZE} ${SIZE}`, width: '100%', height: '100%' }, host)
  const defs = svgEl('defs', {}, svg)
  const clip = svgEl('clipPath', { id: 'minimap-clip' }, defs)
  svgEl('path', { d: roundedPath(1, 1, SIZE - 2, SIZE - 2, 15) }, clip)
  const clipped = svgEl('g', { 'clip-path': 'url(#minimap-clip)' }, svg)
  const baseG = svgEl('g', {}, clipped)
  const dynG = svgEl('g', {}, clipped)
  const frameG = svgEl('g', {}, svg)

  const tag = document.createElement('div')
  Object.assign(tag.style, {
    position: 'absolute',
    left: '12px',
    bottom: '10px',
    color: 'rgba(220,232,244,.82)',
    font: '600 10.5px/1 system-ui, sans-serif',
    letterSpacing: '.09em',
    textTransform: 'uppercase',
    textShadow: '0 1px 4px rgba(0,0,0,.8)',
    pointerEvents: 'none'
  })
  host.appendChild(tag)

  document.body.appendChild(host)

  let mode = 'normal'
  let select = null
  let playerRef = null
  let builtZone = null
  let builtCenter = null
  let arrow = null
  let markers = []
  let pulseT = 0
  let selectToken = 0
  let lastDraw = 0
  let playerCam = null

  /* ---------------- 坐标 ---------------- */
  function makeMap(view) {
    const pad = 16
    const spanX = view.maxX - view.minX
    const spanZ = view.maxZ - view.minZ
    const s = Math.min((SIZE - pad * 2) / spanX, (SIZE - pad * 2) / spanZ)
    const cx = (view.minX + view.maxX) / 2
    const cz = (view.minZ + view.maxZ) / 2
    return {
      s,
      tx: (x) => SIZE / 2 + (x - cx) * s,
      tz: (z) => SIZE / 2 + (z - cz) * s
    }
  }

  function outdoorView() {
    const [[x0, z0], [x1, z1]] = data.outdoor.bounds
    const m = 2.4
    return { minX: x0 - m, maxX: x1 + m, minZ: z0 - m, maxZ: z1 + m }
  }

  // 常驻时是 GTA 式局部雷达：以玩家为中心 260m，建筑看得清；
  // 死亡选点时再缩到全校区，让四个锚点都进画面。
  function localView(center, span = 260) {
    const h = span / 2
    return { minX: center.x - h, maxX: center.x + h, minZ: center.z - h, maxZ: center.z + h }
  }

  function roomView(room) {
    const m = /^room_([\d.]+)x([\d.]+)x/.exec(room.shell)
    const w = m ? +m[1] : 10
    const d = m ? +m[2] : 8
    return { minX: -w / 2 - 0.8, maxX: w / 2 + 0.8, minZ: -d / 2 - 0.8, maxZ: d / 2 + 0.8 }
  }

  /* ---------------- 数据查询 ---------------- */
  const doors = (data.outdoor.props || []).filter((p) => p.type === 'door')

  function doorForAnchor(id) {
    return doors.find((p) => p.to === id) || null
  }

  function anchorMapPoint(a) {
    const custom = display?.get(a.id)
    if (custom) return { x: custom.x, z: custom.z }
    if (a.id === 'a_plaza') return { x: a.pos.x, z: a.pos.z }
    const door = doorForAnchor(a.id)
    if (door) return { x: door.pos[0], z: door.pos[2] }
    if (a.zone === 'outdoor') return { x: a.pos.x, z: a.pos.z }
    const room = (data.rooms || []).find((r) => r.id === a.zone)
    if (room) return { x: room.origin[0], z: room.origin[2] }
    return { x: a.pos.x, z: a.pos.z }
  }

  /* ---------------- 绘制基座 ---------------- */
  function clear(g) {
    while (g.firstChild) g.removeChild(g.firstChild)
  }

  function rect(g, x, z, w, d, r, fill, stroke, strokeW = 1, extra = {}) {
    const n = svgEl('path', { d: roundedPath(x, z, w, d, r), fill, stroke, 'stroke-width': strokeW, ...extra }, g)
    return n
  }

  function drawOutdoorBase(map) {
    const [[x0, z0], [x1, z1]] = data.outdoor.bounds
    // 底色 / 广场铺装
    rect(baseG, map.tx(x0), map.tz(z0), (x1 - x0) * map.s, (z1 - z0) * map.s, 5, '#1c2734', 'rgba(120,142,166,.35)', 1)

    // 道路：由 campus-osm.json 的 path 直接画，局部雷达里是最清楚的方向参照
    for (const path of data.outdoor.roads || []) {
      if (!path || path.length < 2) continue
      const d = path.map(([x, z], i) => `${i ? 'L' : 'M'}${map.tx(x)},${map.tz(z)}`).join(' ')
      svgEl('path', {
        d,
        fill: 'none',
        stroke: 'rgba(96,142,174,.85)',
        'stroke-width': path.length > 20 ? 1.2 : 1.8,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round'
      }, baseG)
    }

    // 道路 / 广场连线：由数据里的锚点和门生成，不手画
    const plaza = (data.outdoor.anchors || []).find((a) => a.id === 'a_plaza') || { pos: [0, 0, 6] }
    const roadG = svgEl('g', { stroke: '#4f7d9c', 'stroke-width': 2.2, 'stroke-linecap': 'round', opacity: .9 }, baseG)
    for (const p of data.outdoor.props || []) {
      if (!['door', 'gate'].includes(p.type)) continue
      svgEl('path', {
        d: `M${map.tx(plaza.pos[0])},${map.tz(plaza.pos[2])} L${map.tx(p.pos[0])},${map.tz(p.pos[2])}`,
        'stroke-dasharray': p.type === 'gate' ? '3 3' : '0'
      }, roadG)
    }
    // 广场中心环形
    svgEl('ellipse', {
      cx: map.tx(plaza.pos[0]),
      cy: map.tz(plaza.pos[2]),
      rx: 10,
      ry: 10,
      fill: 'none',
      stroke: '#5d8fb0',
      'stroke-width': 1.6,
      opacity: .9
    }, baseG)

    // 建筑：直接读 world.json 的矩形
    for (const b of data.outdoor.buildings || []) {
      const [w, , d] = b.size
      rect(baseG, map.tx(b.pos[0] - w / 2), map.tz(b.pos[2] - d / 2), w * map.s, d * map.s, 2.5, '#334358', '#7b90aa', 1.2)
    }

    // 树 / 长椅 / 闸机
    for (const p of data.outdoor.props || []) {
      if (p.type === 'tree') {
        svgEl('circle', { cx: map.tx(p.pos[0]), cy: map.tz(p.pos[2]), r: 4.4, fill: 'rgba(88,132,94,.75)' }, baseG)
      } else if (p.type === 'bench') {
        rect(baseG, map.tx(p.pos[0]) - 4, map.tz(p.pos[2]) - 2, 8, 4, 1, 'rgba(156,128,92,.9)', 'none', 0)
      } else if (p.type === 'gate') {
        svgEl('path', {
          d: `M${map.tx(p.pos[0]) - 7},${map.tz(p.pos[2])} L${map.tx(p.pos[0]) + 7},${map.tz(p.pos[2])}`,
          stroke: '#79c6ff',
          'stroke-width': 2,
          'stroke-linecap': 'round'
        }, baseG)
      }
    }

    // 门：亮色小矩形（anchors 图标画在 dynamic 层）
    for (const p of doors) {
      rect(baseG, map.tx(p.pos[0]) - 4, map.tz(p.pos[2]) - 3, 8, 6, 1.2, '#c9a86a', 'rgba(255,225,160,.65)', 0.8)
    }
  }

  function drawRoomBase(room, map) {
    const m = /^room_([\d.]+)x([\d.]+)x/.exec(room.shell)
    const w = m ? +m[1] : 10
    const d = m ? +m[2] : 8
    rect(baseG, map.tx(-w / 2), map.tz(-d / 2), w * map.s, d * map.s, 3, '#1c2734', 'rgba(120,142,166,.5)', 1.2)

    // 室内道具：直接读 room.props（桌椅 / 讲台）
    for (const p of room.props || []) {
      if (p.type === 'desk') {
        rect(baseG, map.tx(p.pos[0]) - 4.5, map.tz(p.pos[2]) - 3, 9, 6, 1.2, '#594a38', 'rgba(180,150,110,.65)', 0.7)
      } else if (p.type === 'podium') {
        rect(baseG, map.tx(p.pos[0]) - 7, map.tz(p.pos[2]) - 3, 14, 6, 1, '#44503f', 'rgba(150,190,160,.6)', 0.7)
      }
    }

    // 门洞：普通房间在前墙中间，连廊两端都通
    const doorW = 2.2 * map.s
    if (room.kind === 'corridor') {
      rect(baseG, map.tx(-doorW / 2), map.tz(-d / 2) - 1, doorW, 2, 0.5, '#ffd166', 'none', 0)
      rect(baseG, map.tx(-doorW / 2), map.tz(d / 2) - 1, doorW, 2, 0.5, '#ffd166', 'none', 0)
    } else {
      rect(baseG, map.tx(-doorW / 2), map.tz(d / 2) - 1, doorW, 2, 0.5, '#ffd166', 'none', 0)
    }
    svgEl('text', {
      x: SIZE / 2,
      y: 26,
      'text-anchor': 'middle',
      fill: 'rgba(220,232,244,.9)',
      'font-size': 12,
      'font-weight': 700,
      'letter-spacing': '.08em'
    }, baseG).textContent = ZONE_LABEL[room.id] || room.id
  }

  function drawAnchorIcons(points, withLabels = false) {
    for (let i = 0; i < points.length; i++) {
      const p = points[i]
      const color = ANCHOR_COLOR[p.anchor.id] || '#ffffff'
      const g = svgEl('g', { 'data-anchor-index': i }, dynG)
      svgEl('circle', { cx: p.x, cy: p.y, r: 5.2, fill: color, stroke: 'rgba(8,12,18,.95)', 'stroke-width': 1.2 }, g)
      svgEl('circle', { cx: p.x, cy: p.y, r: 2, fill: '#10151c' }, g)
      if (withLabels) {
        const t = svgEl('text', {
          x: p.x,
          y: p.y - 10,
          'text-anchor': 'middle',
          fill: 'rgba(240,245,250,.95)',
          'font-size': 9,
          'font-weight': 700,
          'letter-spacing': '.04em',
          'paint-order': 'stroke',
          stroke: 'rgba(6,9,14,.9)',
          'stroke-width': 2.4
        }, g)
        t.textContent = p.anchor.label || p.anchor.id
      }
      g.style.cursor = 'pointer'
      g.addEventListener('click', (e) => {
        e.stopPropagation()
        if (!select) return
        if (select.index === i) confirm()
        else pick(i)
      })
    }
  }

  function drawPlayerArrow() {
    arrow = svgEl('g', {}, dynG)
    svgEl('polygon', {
      points: '0,-9 -6.5,7 0,4.2 6.5,7',
      fill: '#8fd4ff',
      stroke: 'rgba(6,10,16,.95)',
      'stroke-width': 1.4,
      'stroke-linejoin': 'round'
    }, arrow)
    return arrow
  }

  function drawFrame() {
    clear(frameG)
    svgEl('path', {
      d: roundedPath(1.5, 1.5, SIZE - 3, SIZE - 3, 15),
      fill: 'none',
      stroke: 'rgba(220,232,244,.35)',
      'stroke-width': 1.2
    }, frameG)
    // N + 小三角
    const n = svgEl('text', {
      x: SIZE - 22,
      y: 24,
      'text-anchor': 'middle',
      fill: 'rgba(220,232,244,.92)',
      'font-size': 12,
      'font-weight': 800
    }, frameG)
    n.textContent = 'N'
    svgEl('path', { d: `M${SIZE - 22},29 l-3,7 h6 Z`, fill: 'rgba(220,232,244,.8)' }, frameG)
  }

  /* ---------------- 构建 ---------------- */
  function currentSelectPoints() {
    if (!select) return []
    const map = makeMap(outdoorView())
    return select.anchors.map((a) => {
      const pt = anchorMapPoint(a)
      return { anchor: a, x: map.tx(pt.x), y: map.tz(pt.z) }
    })
  }

  function buildNormal() {
    clear(baseG)
    clear(dynG)
    markers = []
    const zone = playerRef?.zone || 'outdoor'
    builtZone = zone
    if (zone === 'outdoor') {
      const center = { x: playerRef?.pos?.x || 0, z: playerRef?.pos?.z || 0 }
      const map = makeMap(localView(center))
      builtCenter = center
      drawOutdoorBase(map)
      const points = (world.anchorList || []).map((a) => {
        const pt = anchorMapPoint(a)
        return { anchor: a, x: map.tx(pt.x), y: map.tz(pt.z) }
      })
      drawAnchorIcons(points, false)
      drawPlayerArrow()
      tag.textContent = 'CAMPUS'
      tag.style.display = 'block'
      dynG._map = map
    } else {
      builtCenter = null
      const room = (data.rooms || []).find((r) => r.id === zone)
      if (room) {
        const map = makeMap(roomView(room))
        drawRoomBase(room, map)
        drawPlayerArrow()
        dynG._map = map
        tag.textContent = ZONE_LABEL[zone] || zone
        tag.style.display = 'block'
      } else {
        // 未知室内 zone：退回户外图
        const map = makeMap(outdoorView())
        drawOutdoorBase(map)
        drawPlayerArrow()
        dynG._map = map
        tag.style.display = 'none'
      }
    }
    drawFrame()
  }

  function buildSelect() {
    clear(baseG)
    clear(dynG)
    markers = []
    const map = makeMap(outdoorView())
    drawOutdoorBase(map)
    const points = currentSelectPoints()
    for (let i = 0; i < points.length; i++) {
      const p = points[i]
      const color = ANCHOR_COLOR[p.anchor.id] || '#ffffff'
      const g = svgEl('g', { 'data-index': i }, dynG)
      const ring = svgEl('circle', {
        cx: p.x,
        cy: p.y,
        r: 8,
        fill: 'none',
        stroke: color,
        'stroke-width': 2,
        opacity: .75
      }, g)
      const dot = svgEl('circle', {
        cx: p.x,
        cy: p.y,
        r: 5.2,
        fill: color,
        stroke: 'rgba(8,12,18,.95)',
        'stroke-width': 1.2
      }, g)
      // 透明大热区：图标很小也能点
      svgEl('circle', { cx: p.x, cy: p.y, r: 15, fill: 'transparent' }, g)
      const label = svgEl('text', {
        x: p.x,
        y: p.y - 15,
        'text-anchor': 'middle',
        fill: 'rgba(240,245,250,.98)',
        'font-size': 10,
        'font-weight': 700,
        'letter-spacing': '.04em',
        'paint-order': 'stroke',
        stroke: 'rgba(6,9,14,.95)',
        'stroke-width': 3
      }, g)
      label.textContent = p.anchor.label || p.anchor.id
      label.setAttribute('opacity', '0')
      g.style.cursor = 'pointer'
      g.addEventListener('click', (e) => {
        e.stopPropagation()
        if (!select) return
        if (select.index === i) confirm()
        else pick(i)
      })
      markers.push({ g, ring, dot, label, x: p.x, y: p.y, color })
    }
    // 顶部提示
    const hint = svgEl('text', {
      x: SIZE / 2,
      y: SIZE - 16,
      'text-anchor': 'middle',
      fill: 'rgba(225,235,245,.9)',
      'font-size': 8.5,
      'letter-spacing': '.04em',
      'paint-order': 'stroke',
      stroke: 'rgba(6,9,14,.9)',
      'stroke-width': 2.4
    }, dynG)
    hint.textContent = '↑↓ / 1-4  ·  Enter / 双击确认'
    tag.style.display = 'none'
    drawFrame()
    paintSelection()
  }

  /* ---------------- 选择 ---------------- */
  function paintSelection() {
    if (!select) return
    for (let i = 0; i < markers.length; i++) {
      const m = markers[i]
      const sel = i === select.index
      m.dot.setAttribute('r', sel ? 6.4 : 5)
      m.ring.setAttribute('r', sel ? 13 : 8)
      m.ring.setAttribute('opacity', sel ? '1' : '.55')
      m.label.setAttribute('opacity', sel ? '1' : '0')
      m.g.setAttribute('transform', sel ? `translate(${m.x} ${m.y}) scale(1.12) translate(${-m.x} ${-m.y})` : '')
    }
  }

  function pick(i) {
    if (!select) return
    if (i < 0 || i >= select.anchors.length) return
    select.index = i
    paintSelection()
  }

  function move(delta) {
    if (!select) return
    pick((select.index + delta + select.anchors.length) % select.anchors.length)
  }

  function confirm() {
    if (!select || select.confirmed) return
    select.confirmed = true
    const anchor = select.anchors[select.index]
    const cb = select.onConfirm
    endSelect()
    if (cb) cb(anchor)
  }

  function beginSelect(anchors, defaultId, onConfirm) {
    select = {
      anchors: anchors.slice(0, 4),
      index: Math.max(0, anchors.findIndex((a) => a.id === defaultId)),
      onConfirm,
      confirmed: false,
      token: selectToken + 1
    }
    if (!select.anchors.length) return
    setMode('select')
    // 死亡时地图展示户外总览，不按当前 zone 重建
    buildSelect()
    const token = ++selectToken
    const pulse = () => {
      if (!select || select.token !== token) return
      pulseT = performance.now() / 1000
      const k = (Math.sin(pulseT * 5) + 1) / 2
      for (let i = 0; i < markers.length; i++) {
        const m = markers[i]
        const sel = i === select.index
        const base = sel ? 13 : 8
        m.ring.setAttribute('r', (base + k * (sel ? 2.6 : 1.3)).toFixed(2))
        m.ring.setAttribute('opacity', ((sel ? 0.75 : 0.38) + k * 0.25).toFixed(2))
        m.g.setAttribute('data-selected', sel ? '1' : '0')
      }
      requestAnimationFrame(pulse)
    }
    requestAnimationFrame(pulse)
  }

  function endSelect() {
    select = null
    setMode('normal')
    if (playerRef) buildNormal()
  }

  function setMode(next) {
    mode = next
    const big = mode === 'select'
    host.style.width = big ? '320px' : `${SIZE}px`
    host.style.height = big ? '320px' : `${SIZE}px`
    host.style.borderColor = big ? 'rgba(255,255,255,.95)' : 'rgba(220,232,244,.62)'
    host.style.pointerEvents = big ? 'auto' : 'none'
  }

  function update(player, camera = null) {
    playerRef = player
    playerCam = camera
    const now = performance.now()
    if (mode === 'select') {
      // 选点时不按 zone 重建；脉冲由 beginSelect 的 rAF 处理
      return
    }
    if (!builtZone || builtZone !== player.zone) buildNormal()
    else if (
      player.zone === 'outdoor' &&
      builtCenter &&
      Math.hypot(player.pos.x - builtCenter.x, player.pos.z - builtCenter.z) > 18
    ) {
      buildNormal()
    }
    if (!arrow) return

    let x
    let z
    let yaw = player.yaw
    if (player.zone === 'outdoor') {
      x = player.pos.x
      z = player.pos.z
    } else {
      const room = (data.rooms || []).find((r) => r.id === player.zone)
      if (!room) return
      x = player.pos.x - room.origin[0]
      z = player.pos.z - room.origin[2]
    }
    const map = dynG._map
    if (!map) return
    const px = map.tx(x)
    const pz = map.tz(z)
    arrow.setAttribute('transform', `translate(${px} ${pz}) rotate(${(-yaw * 180) / Math.PI})`)
    if (now - lastDraw > 80) {
      lastDraw = now
      // 玩家每帧都动，箭头逐帧更新；这里只节流不需要的东西，保持简单
    }
  }

  drawFrame()
  setMode('normal')

  return {
    update,
    setMode,
    beginSelect,
    endSelect,
    move,
    pick,
    confirm,
    el: host,
    get mode() {
      return mode
    },
    get selected() {
      return select ? select.anchors[select.index] : null
    }
  }
}
