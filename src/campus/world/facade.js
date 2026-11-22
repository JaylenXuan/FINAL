import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * 校园材质库：立面 / 石材 / 沥青 / 铺装 / 树 / 棕榈 / 路灯 / 标牌
 *
 * 参照港中大（深圳）实景：
 *   · 下园教学组团——浅灰石材 + 铝板竖向格栅 + 带状玻璃，屋顶有深灰压顶
 *   · 大学图书馆——青灰墙 + 跳跃的黄色点缀，北侧依山、周边水塘
 *   · 学生中心 / 下沉广场——锈红色竖向格栅屏风 + 玻璃盒体
 *   · 上园书院——学勤淡黄、思廷灰绿、祥波朱红、道扬蓝白、厚含橙白、第七紫白
 *   · 体育馆——白色金属墙 + 橙色大屋顶
 *
 * 一张立面贴图覆盖 4 开间 × 4 层（12.8m × 15.6m），避免 3.2m 一格的机械重复，
 * 并用第二张自发光贴图点亮部分窗户（黄昏氛围）。
 */

const WIN_W = 3.2
const WALL_H = 3.9
export const FACADE_BAYS = 4

export const PALETTE = {
  academic: { wall: '#d8d3c9', accent: '#9d9789', glass: '#6f8494', roof: '#7b7d7c', plinth: '#c6c0b4' },
  library: { wall: '#b8b2a8', accent: '#e8c14a', glass: '#5e7784', roof: '#6f7273', plinth: '#c9c3b6' },
  lab: { wall: '#c6cbcd', accent: '#a9b0b4', glass: '#5d7783', roof: '#75797c', plinth: '#bdb9ae' },
  civic: { wall: '#e0d8c9', accent: '#bdb3a1', glass: '#6f8494', roof: '#8b8578', plinth: '#cec5b2' },
  sports: { wall: '#dfe2e2', accent: '#e2662a', glass: '#6f8f96', roof: '#c2542a', plinth: '#c9c6bf' },
  terracotta: { wall: '#8d4a34', accent: '#b5563a', glass: '#3d4b50', roof: '#6d6a63', plinth: '#8f8478' },
  utility: { wall: '#d2ccc0', accent: '#b3ab9d', glass: '#7c8b93', roof: '#8d8a82', plinth: '#c2bcae' },
  college_diligentia: { wall: '#eadfc4', accent: '#e2b93f', glass: '#6f8494', roof: '#8a8478', plinth: '#d8cdb2' },
  college_muse: { wall: '#dcdfdd', accent: '#3e7d5b', glass: '#64808a', roof: '#7d8382', plinth: '#c8ccc7' },
  college_harmonia: { wall: '#dccdc2', accent: '#a8412f', glass: '#6f8494', roof: '#7c746c', plinth: '#cab9ac' },
  college_ling: { wall: '#e3e6e9', accent: '#2f5f9e', glass: '#5f7f96', roof: '#7b8389', plinth: '#cbd0d4' },
  college_minerva: { wall: '#f0ece7', accent: '#e0762c', glass: '#6a8593', roof: '#83807b', plinth: '#d8d3cb' },
  college_seventh: { wall: '#e6e0ea', accent: '#6f4fa0', glass: '#6b8197', roof: '#827c86', plinth: '#d3ccd6' },
  college_shaw: { wall: '#ded9d2', accent: '#9a6a4f', glass: '#6f8494', roof: '#7e7a73', plinth: '#cbc5bb' },
  college: { wall: '#e2dbcf', accent: '#b9a37e', glass: '#6f8494', roof: '#807c73', plinth: '#cfc7b8' }
}

/** 按真实建筑名映射到配色：书院各有一套主色，图书馆带黄色点缀 */
export function styleKeyFor(b) {
  const hay = `${b.name || ''} ${b.nameEn || ''}`.toLowerCase()
  const has = (...keys) => keys.some((k) => hay.includes(k.toLowerCase()))
  if (has('图书馆', 'library')) return 'library'
  if (has('学生中心', 'student centre', 'student center')) return 'terracotta'
  if (has('会议', 'conference')) return 'terracotta'
  if (has('学勤', 'diligentia')) return 'college_diligentia'
  if (has('思廷', 'muse')) return 'college_muse'
  if (has('祥波', 'harmonia')) return 'college_harmonia'
  if (has('道扬', 'ling college')) return 'college_ling'
  if (has('厚含', 'minerva')) return 'college_minerva'
  if (has('第七', 'seventh')) return 'college_seventh'
  if (has('逸夫', 'shaw college')) return 'college_shaw'
  if (b.style && PALETTE[b.style]) return b.style
  return 'academic'
}

export const UV_U = WIN_W * FACADE_BAYS
export const UV_V = WALL_H * FACADE_BAYS

/* ---------------- 小工具 ---------------- */

function prng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

function shade(hex, k) {
  const c = new THREE.Color(hex)
  if (k >= 0) c.lerp(new THREE.Color(0xffffff), k)
  else c.lerp(new THREE.Color(0x000000), -k)
  return `#${c.getHexString()}`
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

function finish(canvas, { repeat = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas)
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = aniso
  return t
}

/* ---------------- 立面 ---------------- */

const facadeCache = new Map()

/**
 * 返回 { map, emissiveMap }
 * 一格 256px = 3.2m × 3.9m，共 4×4 格
 */
export function facadeMaps(key) {
  if (facadeCache.has(key)) return facadeCache.get(key)
  const cfg = PALETTE[key] || PALETTE.academic
  const S = 1024
  const cell = S / FACADE_BAYS

  const c = makeCanvas(S, S)
  const g = c.getContext('2d')
  const e = makeCanvas(S, S)
  const ge = e.getContext('2d')
  ge.fillStyle = '#000000'
  ge.fillRect(0, 0, S, S)

  // 高度图：亮=凸出，暗=凹进
  const hc = makeCanvas(S, S)
  const gh = hc.getContext('2d')
  gh.fillStyle = '#9a9a9a'
  gh.fillRect(0, 0, S, S)

  const college = key.startsWith('college')
  g.fillStyle = college ? shade(cfg.wall, 0) : cfg.wall
  g.fillRect(0, 0, S, S)
  if (college) {
    // 墙面掺 14% 主色：远看是一栋「淡黄 / 朱红 / 蓝白」的楼，而不是一排灰盒子
    g.fillStyle = cfg.accent
    g.globalAlpha = 0.14
    g.fillRect(0, 0, S, S)
    g.globalAlpha = 1
  }

  // 石材 / 涂料的细腻噪点
  const rnd = prng(key.length * 7919 + 13)
  for (let i = 0; i < 2600; i++) {
    const v = rnd() > 0.5 ? 255 : 0
    g.fillStyle = `rgba(${v},${v},${v},0.028)`
    g.fillRect(rnd() * S, rnd() * S, 2, 2)
  }

  if (key === 'terracotta') {
    // 锈红色竖向格栅屏风：整面密排百叶，缝里透出玻璃与室内暖光
    for (let x = 0; x < S; x += 18) {
      const v = 0.86 + ((x * 37) % 23) / 100
      const c = new THREE.Color(cfg.wall).multiplyScalar(v)
      g.fillStyle = `#${c.getHexString()}`
      g.fillRect(x, 0, 12, S)
      g.fillStyle = 'rgba(0,0,0,0.35)'
      g.fillRect(x + 12, 0, 6, S)
      if ((x / 18) % 7 === 3) {
        ge.fillStyle = 'rgba(255,196,132,0.5)'
        ge.fillRect(x + 12, 0, 6, S)
      }
    }
    for (let y = 0; y < S; y += 256) {
      g.fillStyle = 'rgba(0,0,0,0.22)'
      g.fillRect(0, y, S, 14)
    }
    const map = finish(c)
    const emissiveMap = finish(e)
    const out = { map, emissiveMap }
    facadeCache.set(key, out)
    return out
  }

  for (let row = 0; row < FACADE_BAYS; row++) {
    for (let col = 0; col < FACADE_BAYS; col++) {
      const x0 = col * cell
      const y0 = row * cell
      const r = prng((row * 7919 + col * 104729 + key.length * 31 + 7) >>> 0)

      // 竖向铝格栅：每 0.8m 一根，密排竖缝是港中深立面最明显的特征
      for (let fx = x0 + 8; fx < x0 + cell; fx += 64) {
        g.fillStyle = shade(cfg.wall, -0.14)
        g.fillRect(fx, y0, 9, cell)
        g.fillStyle = shade(cfg.wall, 0.12)
        g.fillRect(fx + 9, y0, 2, cell)
        gh.fillStyle = '#ffffff'
        gh.fillRect(fx, y0, 11, cell)
      }

      // 楼板带（每层顶部一道深一点的横带）
      g.fillStyle = shade(cfg.wall, -0.06)
      g.fillRect(x0, y0 + 4, cell, 30)
      gh.fillStyle = '#6e6e6e'
      gh.fillRect(x0, y0 + 4, cell, 30)

      // 横向带窗：宽 2.3m、高 1.8m，中间细铝挺
      const wx = x0 + 14
      const wy = y0 + 52
      const ww = cell - 28
      const wh = 118

      const grd = g.createLinearGradient(0, wy, 0, wy + wh)
      grd.addColorStop(0, shade(cfg.glass, 0.34))
      grd.addColorStop(0.4, cfg.glass)
      grd.addColorStop(1, shade(cfg.glass, -0.26))

      const lit = r() < 0.07
      const blind = !lit && r() < 0.26

      g.fillStyle = grd
      g.fillRect(wx, wy, ww, wh)
      gh.fillStyle = '#242424'
      gh.fillRect(wx, wy, ww, wh)

      // 玻璃上的天光反射
      g.save()
      g.beginPath()
      g.rect(wx, wy, ww, wh)
      g.clip()
      g.fillStyle = 'rgba(255,255,255,0.12)'
      g.beginPath()
      g.moveTo(wx - 30, wy + wh)
      g.lineTo(wx + ww * 0.5, wy)
      g.lineTo(wx + ww * 0.74, wy)
      g.lineTo(wx + 4, wy + wh)
      g.fill()
      g.restore()

      if (blind) {
        g.fillStyle = 'rgba(238,234,224,0.6)'
        g.fillRect(wx + 3, wy + 3, ww - 6, wh * (0.3 + r() * 0.45))
        g.fillStyle = 'rgba(0,0,0,0.1)'
        for (let b = 0; b < 7; b++) g.fillRect(wx + 3, wy + 5 + b * 8, ww - 6, 1.4)
      }

      // 窗框
      g.strokeStyle = shade(cfg.wall, -0.5)
      g.lineWidth = 3
      g.strokeRect(wx, wy, ww, wh)
      gh.strokeStyle = '#b4b4b4'
      gh.lineWidth = 4
      gh.strokeRect(wx, wy, ww, wh)

      // 竖挺：每 0.55m 一根
      g.lineWidth = 2
      g.strokeStyle = shade(cfg.glass, -0.42)
      gh.strokeStyle = '#8a8a8a'
      gh.lineWidth = 3
      for (let mx = wx + 40; mx < wx + ww - 8; mx += 40) {
        g.beginPath()
        g.moveTo(mx, wy)
        g.lineTo(mx, wy + wh)
        g.stroke()
        gh.beginPath()
        gh.moveTo(mx, wy)
        gh.lineTo(mx, wy + wh)
        gh.stroke()
      }

      // 窗台：书院用主色，其余用石材色
      g.fillStyle = college ? cfg.accent : shade(cfg.wall, -0.12)
      g.fillRect(wx - 5, wy + wh, ww + 10, 8)
      g.fillStyle = 'rgba(0,0,0,0.10)'
      g.fillRect(wx - 5, wy + wh + 8, ww + 10, 3)
      gh.fillStyle = '#d8d8d8'
      gh.fillRect(wx - 5, wy + wh, ww + 10, 8)

      // 书院：窗侧一小段主色竖板，是实景里最好认的一层颜色
      if (college) {
        g.fillStyle = cfg.accent
        g.fillRect(x0 + 18, wy - 6, 6, wh + 10)
      }

      // 亮灯的窗（自发光贴图）
      if (lit) {
        const eg = ge.createLinearGradient(0, wy, 0, wy + wh)
        eg.addColorStop(0, '#ffe3b8')
        eg.addColorStop(1, '#f0b46a')
        ge.fillStyle = eg
        ge.fillRect(wx + 2, wy + 2, ww - 4, wh - 4)
        gh.fillStyle = '#242424'
        gh.fillRect(wx + 2, wy + 2, ww - 4, wh - 4)
        ge.strokeStyle = 'rgba(40,26,16,0.55)'
        ge.lineWidth = 3
        ge.beginPath()
        ge.moveTo(wx + ww / 2, wy)
        ge.lineTo(wx + ww / 2, wy + wh)
        ge.stroke()
      }
    }
  }

  const map = finish(c)
  const emissiveMap = finish(e)
  const normalMap = normalFromHeight(hc, 3.2)
  const out = { map, emissiveMap, normalMap }
  facadeCache.set(key, out)
  return out
}

/** 由高度图（灰度画布）生成法线贴图，让窗洞和格栅有真实的进退关系 */
function normalFromHeight(src, strength = 2.4) {
  const w = src.width
  const h = src.height
  const data = src.getContext('2d').getImageData(0, 0, w, h).data
  const out = makeCanvas(w, h)
  const og = out.getContext('2d')
  const img = og.createImageData(w, h)
  const H = (x, y) => {
    const xi = (x + w) % w
    const yi = (y + h) % h
    return data[(yi * w + xi) * 4] / 255
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x - 1, y) - H(x + 1, y)) * strength
      const dy = (H(x, y - 1) - H(x, y + 1)) * strength
      const len = Math.hypot(dx, dy, 1)
      const i = (y * w + x) * 4
      img.data[i] = ((dx / len) * 0.5 + 0.5) * 255
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255
      img.data[i + 2] = (1 / len) * 0.5 * 255 + 127
      img.data[i + 3] = 255
    }
  }
  og.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(out)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 4
  return t
}

/* ---------------- 石材 / 沥青 / 铺装 ---------------- */

let stoneTex = null
export function stoneTexture() {
  if (stoneTex) return stoneTex
  const S = 256
  const c = makeCanvas(S, S)
  const g = c.getContext('2d')
  g.fillStyle = '#cfc9bd'
  g.fillRect(0, 0, S, S)
  const rnd = prng(991)
  for (let i = 0; i < 900; i++) {
    const v = rnd() > 0.5 ? 255 : 0
    g.fillStyle = `rgba(${v},${v},${v},0.05)`
    g.fillRect(rnd() * S, rnd() * S, 2, 2)
  }
  // 横向石缝
  g.strokeStyle = 'rgba(90,84,74,0.28)'
  g.lineWidth = 2
  for (let y = 0; y <= S; y += 64) {
    g.beginPath()
    g.moveTo(0, y)
    g.lineTo(S, y)
    g.stroke()
  }
  stoneTex = finish(c)
  stoneTex.repeat.set(4, 1)
  return stoneTex
}

let asphaltTex = null
let asphaltMarked = null
export function asphaltTexture(marked) {
  if (marked && asphaltMarked) return asphaltMarked
  if (!marked && asphaltTex) return asphaltTex
  const S = 256
  const c = makeCanvas(S, S)
  const g = c.getContext('2d')
  g.fillStyle = '#77797b'
  g.fillRect(0, 0, S, S)
  const rnd = prng(marked ? 4242 : 1717)
  // 骨料细一点、透明度低一点：站远了才不会像碎石路
  for (let i = 0; i < 3200; i++) {
    const v = 96 + Math.floor(rnd() * 52)
    g.fillStyle = `rgba(${v},${v},${v},0.22)`
    g.fillRect(rnd() * S, rnd() * S, 1.6, 1.6)
  }
  if (marked) {
    // 两侧边线
    g.fillStyle = 'rgba(232,230,222,0.75)'
    g.fillRect(S * 0.055, 0, 4, S)
    g.fillRect(S * 0.945 - 4, 0, 4, S)
    // 中间虚线
    g.fillStyle = 'rgba(240,236,222,0.8)'
    g.fillRect(S * 0.5 - 3, S * 0.08, 6, S * 0.46)
  }
  const t = finish(c)
  asphaltMarked = marked ? t : asphaltMarked
  asphaltTex = marked ? asphaltTex : t
  return t
}

let pavingTex = null
export function pavingTexture() {
  if (pavingTex) return pavingTex
  const S = 256
  const c = makeCanvas(S, S)
  const g = c.getContext('2d')
  g.fillStyle = '#c9c3b6'
  g.fillRect(0, 0, S, S)
  const rnd = prng(5150)
  // 400×400 的方砖
  for (let y = 0; y < S; y += 32) {
    for (let x = 0; x < S; x += 32) {
      const v = 0.97 + rnd() * 0.06
      const col = new THREE.Color('#c9c3b6').multiplyScalar(v)
      g.fillStyle = `#${col.getHexString()}`
      g.fillRect(x + 1, y + 1, 30, 30)
    }
  }
  g.strokeStyle = 'rgba(120,114,102,0.35)'
  g.lineWidth = 1.5
  for (let i = 0; i <= S; i += 32) {
    g.beginPath()
    g.moveTo(i, 0)
    g.lineTo(i, S)
    g.moveTo(0, i)
    g.lineTo(S, i)
    g.stroke()
  }
  pavingTex = finish(c)
  return pavingTex
}

let grassTex = null
export function grassTexture() {
  if (grassTex) return grassTex
  const S = 512
  const c = makeCanvas(S, S)
  const g = c.getContext('2d')
  const base = [0x9a, 0xa6, 0x6e]
  g.fillStyle = '#9aa66e'
  g.fillRect(0, 0, S, S)
  const rnd = prng(7717)

  // 1) 逐像素细颗粒：只抖动 ±7，不堆色块 —— 大块斑点一贴到 1km 地面上就成了迷彩
  const img = g.getImageData(0, 0, S, S)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 15
    d[i] = base[0] + n
    d[i + 1] = base[1] + n
    d[i + 2] = base[2] + n * 0.8
  }
  g.putImageData(img, 0, 0)

  // 2) 竖向短笔触当草叶：数量够多、透明度够低，远看是绒面而不是噪点
  for (let i = 0; i < 14000; i++) {
    const v = 0.86 + rnd() * 0.28
    const col = new THREE.Color('#9aa66e').multiplyScalar(v)
    g.fillStyle = `rgba(${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)},0.2)`
    g.fillRect(rnd() * S, rnd() * S, 1, 1.4 + rnd() * 2.4)
  }
  grassTex = finish(c)
  return grassTex
}

/* ---------------- 标牌 ---------------- */

let lobbyTex = null
let lobbyEmissive = null
export function lobbyMaps() {
  if (lobbyTex) return { map: lobbyTex, emissiveMap: lobbyEmissive }
  const S = 512
  const c = makeCanvas(S, 256)
  const g = c.getContext('2d')
  const e = makeCanvas(S, 256)
  const ge = e.getContext('2d')
  ge.fillStyle = '#000000'
  ge.fillRect(0, 0, S, 256)

  g.fillStyle = '#b9b3a6'
  g.fillRect(0, 0, S, 256)

  // 16 个分格（每格 0.5m）：玻璃幕墙 + 铝竖挺 + 一道横梁
  for (let i = 0; i < 16; i++) {
    const x = i * 32
    const isDoor = i >= 6 && i <= 8

    const grd = g.createLinearGradient(0, 24, 0, 236)
    grd.addColorStop(0, '#6b8794')
    grd.addColorStop(0.45, isDoor ? '#33474f' : '#3f5965')
    grd.addColorStop(1, '#2b4049')
    g.fillStyle = grd
    g.fillRect(x + 3, 24, 26, 212)

    if (i % 4 !== 1) {
      g.fillStyle = 'rgba(255,206,146,0.14)'
      g.fillRect(x + 5, 46, 22, 54)
      ge.fillStyle = 'rgba(255,196,128,0.4)'
      ge.fillRect(x + 5, 46, 22, 54)
    }

    if (isDoor) {
      g.fillStyle = '#22313a'
      g.fillRect(x + 4, 110, 24, 126)
      g.strokeStyle = 'rgba(220,214,200,0.5)'
      g.lineWidth = 1.5
      g.strokeRect(x + 4, 110, 24, 126)
      ge.fillStyle = 'rgba(255,214,160,0.16)'
      ge.fillRect(x + 4, 132, 24, 104)
    }

    g.fillStyle = '#9a978e'
    g.fillRect(x + 1, 20, 3, 218)
  }

  // 横梁 + 顶部雨棚 + 底部石材
  g.fillStyle = '#8b8880'
  g.fillRect(0, 96, S, 4)
  g.fillStyle = '#75726b'
  g.fillRect(0, 0, S, 20)
  g.fillStyle = '#a9a294'
  g.fillRect(0, 236, S, 20)
  lobbyTex = finish(c)
  lobbyTex.wrapT = THREE.ClampToEdgeWrapping
  lobbyEmissive = finish(e)
  lobbyEmissive.wrapT = THREE.ClampToEdgeWrapping
  return { map: lobbyTex, emissiveMap: lobbyEmissive }
}

export function signTexture(cn, en) {
  const W = 640
  const H = 256
  const c = makeCanvas(W, H)
  const g = c.getContext('2d')
  g.fillStyle = '#2f3236'
  g.fillRect(0, 0, W, H)
  g.fillStyle = '#3a3e43'
  g.fillRect(10, 10, W - 20, H - 20)

  g.fillStyle = '#f5f1e6'
  g.textAlign = 'center'
  g.font = '600 96px "Noto Sans SC", "Microsoft YaHei", sans-serif'
  g.fillText(cn, W / 2, 118)
  g.font = '400 42px "Helvetica Neue", Arial, sans-serif'
  g.fillStyle = 'rgba(245,241,230,0.78)'
  g.fillText(en, W / 2, 186)

  g.fillStyle = '#e8c14a'
  g.fillRect(W / 2 - 70, 210, 140, 6)
  const t = finish(c, { repeat: false })
  return t
}

/* ---------------- 棕榈 / 路灯几何 ---------------- */

export function palmGeometry() {
  const parts = []
  const trunk = new THREE.CylinderGeometry(0.17, 0.3, 7.2, 7)
  trunk.translate(0, 3.6, 0)
  parts.push(trunk)

  // 叶片：一条向下弯的窄带，绕 Y 排一圈
  for (let f = 0; f < 9; f++) {
    const seg = 5
    const len = 2.9
    const pos = []
    const uvs = []
    const idx = []
    for (let i = 0; i <= seg; i++) {
      const t = i / seg
      const x = t * len
      const y = 7.1 + Math.sin(t * 1.5) * 0.55 - t * t * 1.75
      const w = 0.42 * (1 - t) + 0.03
      pos.push(x, y, -w, x, y, w)
      uvs.push(t, 0, t, 1)
      if (i < seg) {
        const b = i * 2
        idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3)
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geo.setIndex(idx)
    geo.computeVertexNormals()
    geo.rotateY((f / 9) * Math.PI * 2)
    parts.push(geo)
  }
  return mergeGeometries(parts)
}

export function lampGeometry() {
  const parts = []
  const pole = new THREE.CylinderGeometry(0.075, 0.11, 5.4, 6)
  pole.translate(0, 2.7, 0)
  parts.push(pole)
  const arm = new THREE.BoxGeometry(0.09, 0.09, 1.15)
  arm.translate(0, 5.34, 0.5)
  parts.push(arm)
  return mergeGeometries(parts)
}

export function lampHeadGeometry() {
  const g = new THREE.BoxGeometry(0.34, 0.14, 0.62)
  g.translate(0, 5.3, 1.02)
  return g
}

/* ---------------- 水面波纹 ---------------- */

let rippleTex = null
export function rippleNormal() {
  if (rippleTex) return rippleTex
  const S = 256
  const hc = makeCanvas(S, S)
  const g = hc.getContext('2d')
  const img = g.createImageData(S, S)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // 几组不同方向的正弦叠加，得到不规则的水面起伏
      const v =
        Math.sin((x / S) * Math.PI * 6 + Math.sin((y / S) * Math.PI * 3.3) * 1.4) * 0.44 +
        Math.sin((y / S) * Math.PI * 8 + Math.sin((x / S) * Math.PI * 2.7) * 1.1) * 0.3 +
        Math.sin((x / S) * Math.PI * 17 + (y / S) * Math.PI * 13) * 0.14
      const c = (v * 0.5 + 0.5) * 255
      const i = (y * S + x) * 4
      img.data[i] = c
      img.data[i + 1] = c
      img.data[i + 2] = c
      img.data[i + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  rippleTex = normalFromHeight(hc, 0.9)
  rippleTex.repeat.set(0.55, 0.55)
  return rippleTex
}

/* ---------------- 云 ---------------- */

export function cloudTexture() {
  const S = 256
  const c = makeCanvas(S, S)
  const g = c.getContext('2d')
  const rnd = prng(90210)
  g.clearRect(0, 0, S, S)
  for (let i = 0; i < 30; i++) {
    const x = S * (0.2 + rnd() * 0.6)
    const y = S * (0.42 + rnd() * 0.22)
    const r = S * (0.08 + rnd() * 0.16)
    const grd = g.createRadialGradient(x, y, 0, x, y, r)
    grd.addColorStop(0, 'rgba(255,255,255,0.55)')
    grd.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grd
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    g.fill()
  }
  return finish(c, { repeat: false })
}

/* ---------------- 室内 ---------------- */

let floorTex = null
/** 室内地面：浅灰水磨石 / 方砖，600 一块 */
export function interiorFloorTexture() {
  if (floorTex) return floorTex
  const S = 256
  const c = makeCanvas(S, S)
  const g = c.getContext('2d')
  g.fillStyle = '#d7d3c9'
  g.fillRect(0, 0, S, S)
  const rnd = prng(9911)
  for (let i = 0; i < 3000; i++) {
    const v = 196 + Math.floor(rnd() * 44)
    g.fillStyle = `rgba(${v},${v - 3},${v - 12},0.3)`
    g.fillRect(rnd() * S, rnd() * S, 2, 2)
  }
  g.strokeStyle = 'rgba(150,146,138,0.5)'
  g.lineWidth = 2
  for (let i = 0; i <= S; i += 64) {
    g.beginPath()
    g.moveTo(i, 0)
    g.lineTo(i, S)
    g.moveTo(0, i)
    g.lineTo(S, i)
    g.stroke()
  }
  floorTex = finish(c)
  return floorTex
}
