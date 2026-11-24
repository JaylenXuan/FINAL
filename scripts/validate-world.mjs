// 数据体检：不依赖 three，跑得比浏览器快。
// 用法：npm run validate
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'))

const errors = []
const warnings = []
const ok = (cond, msg) => { if (!cond) errors.push(msg) }

const world = read('data/world.json')
const bits = read('data/bits.json')
const lines = read('data/lines.json')

/* ---------- world.json ---------- */
ok(world.meta && world.meta.version >= 2, 'world.meta.version 应为 >= 2')

const out = world.outdoor
ok(out && Array.isArray(out.bounds) && out.bounds.length === 2, 'outdoor.bounds 缺失')
if (out?.bounds) {
  const [[x0, z0], [x1, z1]] = out.bounds
  ok(x1 > x0 && z1 > z0, 'outdoor.bounds 的 max 必须大于 min')
}

const anchors = new Map()
const addAnchor = (a, where) => {
  ok(a && typeof a.id === 'string', `${where}: 锚点缺少 id`)
  if (!a?.id) return
  ok(!anchors.has(a.id), `锚点 id 重复：${a.id}（${where}）`)
  anchors.set(a.id, a)
  ok(Array.isArray(a.pos) && a.pos.length === 3, `锚点 ${a.id} 的 pos 必须是三元数组`)
}

for (const a of out?.anchors || []) addAnchor(a, 'outdoor.anchors')

const buildingIds = new Set()
for (const b of out?.buildings || []) {
  ok(typeof b.id === 'string' && b.id, 'building 缺少 id')
  ok(!buildingIds.has(b.id), `building id 重复：${b.id}`)
  buildingIds.add(b.id)
  ok(Array.isArray(b.size) && b.size.every((n) => n > 0), `building ${b.id} 的 size 必须为正数`)
}

const doors = []
for (const p of out?.props || []) {
  ok(typeof p.type === 'string', 'prop 缺少 type')
  ok(Array.isArray(p.pos) && p.pos.length === 3, `prop ${p.type} 的 pos 必须是三元数组`)
  if (p.type === 'door') doors.push(p)
}

for (const room of world.rooms || []) {
  ok(typeof room.id === 'string' && room.id, 'room 缺少 id')
  ok(Array.isArray(room.origin) && room.origin.length === 3, `room ${room.id} 的 origin 必须是三元数组`)
  ok(typeof room.shell === 'string', `room ${room.id} 缺少 shell`)
  ok(['room', 'corridor', undefined].includes(room.kind), `room ${room.id} 的 kind 非法：${room.kind}`)
  for (const a of room.anchors || []) addAnchor(a, `room ${room.id}`)
}

for (const d of doors) {
  ok(typeof d.to === 'string', `门 @${d.pos.join(',')} 缺少 to`)
  if (d.to) ok(anchors.has(d.to), `门指向不存在的锚点：${d.to}`)
}

ok(doors.length >= 3, `门数量偏少（${doors.length}），至少 3 扇`)

/* ---------- bits.json ---------- */
const bitIds = new Set()
for (const b of bits) {
  ok(typeof b.id === 'string' && b.id, 'bit 缺少 id')
  ok(!bitIds.has(b.id), `bit id 重复：${b.id}`)
  bitIds.add(b.id)
  ok(typeof b.zone === 'string', `bit ${b.id} 缺少 zone`)
  ok(['P0', 'P1', 'P2'].includes(b.priority), `bit ${b.id} 的 priority 非法`)
  const lineKeys = []
  if (b.outcome?.line) lineKeys.push(b.outcome.line)
  for (const k of lineKeys) ok(lines[k], `bit ${b.id} 引用了不存在的台词：${k}`)
}

/* ---------- lines.json ---------- */
for (const [k, v] of Object.entries(lines)) {
  ok(/^[A-Z0-9_]+$/.test(k), `台词 key 必须是大写蛇形：${k}`)
  ok(v && typeof v.en === 'string' && v.en.trim(), `台词 ${k} 缺少英文`)
  if (!v?.zh) warnings.push(`台词 ${k} 没有中文`)
}

/* ---------- campus-osm.json ---------- */
try {
  const campus = read('data/campus-osm.json')
  const buildings = campus.buildings || campus.features || []
  ok(Array.isArray(buildings) && buildings.length > 0, 'campus-osm.json 里没有建筑')
} catch (e) {
  warnings.push('campus-osm.json 读取失败（回退到 campus.json）')
}

/* ---------- 输出 ---------- */
if (warnings.length) {
  console.log(`⚠ ${warnings.length} 条警告`)
  for (const w of warnings) console.log('  -', w)
}
if (errors.length) {
  console.log(`✗ ${errors.length} 条错误`)
  for (const e of errors) console.log('  -', e)
  process.exit(1)
}
console.log(`✓ 数据体检通过：${anchors.size} 个锚点、${doors.length} 扇门、${bitIds.size} 条 bit、${Object.keys(lines).length} 条台词`)
