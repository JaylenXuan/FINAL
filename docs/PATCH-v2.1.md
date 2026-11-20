# 规格补丁 v2.1（修订版：速度不改）

> 变更：撤回 4.6。演示会走几步就停下，3.6 足够在 2–3 秒内抓到，不需要加速。
> 其余（刷点、超时、防穿墙、出口锚点）不变。

---

## 1. 数值：速度保持 3.6，只改刷点和超时

| 参数 | 旧 | 新 |
|---|---|---|
| `CHASER_SPEED` | 3.6 | **3.6（不变）** |
| 刷点距离 | `farEnd` 四角（18.87m） | **玩家前方 10m** |
| 追逐上限 | 无 | **12 秒** |
| 玩家速度 | 走 3.2 / 跑 6.0 | 不变 |

验算（抓取半径 1.1m，有效距离 8.9m）：

| 玩家 | 相对速度 | 结果 |
|---|---|---|
| 站着不动 | 3.6 | **2.5 秒被抓** |
| 朝校长走 | 6.8 | 1.3 秒被抓 |
| 背对走开 | 0.4 | 22 秒（12 秒超时，放弃） |
| 跑步 6.0 | −2.4 | 追不上，12 秒后放弃 |

演示用法：举手机往前走几步（约 5m）→ 停下 → 校长 1–2 秒内追上 → 黑屏。

---

## 2. 刷点：前方 10m 圆周采样

替换 `Chaser.farEnd()`：

```js
spawnAhead(target, dist = 10) {
  const b = this.world.zones[this.zone]?.bounds
  const fx = Math.sin(target.yaw || 0), fz = Math.cos(target.yaw || 0)
  let best = null, bestScore = -Infinity
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2
    const p = new THREE.Vector3(
      target.pos.x + Math.sin(a) * dist,
      0,
      target.pos.z + Math.cos(a) * dist
    )
    if (b && (p.x < b.min.x || p.x > b.max.x || p.z < b.min.z || p.z > b.max.z)) continue
    if (this.world.buildings?.some((bb) => insideXZ(p, bb))) continue
    const score = (p.x - target.pos.x) * fx + (p.z - target.pos.z) * fz
    if (score > bestScore) { bestScore = score; best = p }
  }
  return best || target.pos.clone()
}
```

`insideXZ` 复用 `player.js` 的 AABB 判定。

---

## 3. 碰撞：5 行

`update()` 位移之后、`sync()` 之前：

```js
const fixed = resolve(this.pos, 0.35, this.world.colliders || [])
this.pos.x = fixed.x
this.pos.z = fixed.z
```

验收：起点 `(-10,-10)`、玩家 `(0,6)` 时，校长不再从楼里穿出。

---

## 4. 进门：0.5 秒演出，不改传送

按 E 且正在被追时：

1. 暂停输入 0.5 秒
2. 校长停在门口 2m 处，转身
3. 播 `PHONE_ESCAPED`
4. 再走原来的淡出 + 传送

`ESCAPE_AFTER` 的 2 秒倒计时保留，但只在玩家还没传送时走；已传送则直接 `abandon()`。

---

## 5. 数据：出口锚点（schema v2.1）

### world.json 追加三个锚点

```json
"anchors": [
  { "id": "a_plaza", "pos": [0, 0, 6], "yaw": 180 },
  { "id": "a_out_classroom", "pos": [-3, 0, -4.6], "yaw": 180 },
  { "id": "a_out_library", "pos": [-6.5, 0, -4.6], "yaw": 180 },
  { "id": "a_out_corridor", "pos": [-0.5, 0, -4.6], "yaw": 180 }
]
```

### 加一扇连廊的门

```json
{ "type": "door", "pos": [-0.5, 0, -6.2], "rotationY": 0, "to": "a_corridor" }
```

（现在连廊只能靠 1-4 调试传送进去，正常玩没有入口。）

### rooms 加 exit

```json
"classroom": { "exit": "a_out_classroom" }
"library":   { "exit": "a_out_library" }
"corridor":  { "exit": "a_out_corridor" }
```

`builder` 出口处：`const exitId = room.exit || 'a_plaza'`。

验收：从教室按 E 出来，站在门口 1.6m 处，不是广场中心（12.5m 外）。

---

## 6. 规格 §9 替换文本

> bit 1 phone_walk
> - 触发：举手机 + 移动超过 4 秒
> - 立刻生效：违纪星 +1
> - 演员：校长，在玩家前方 10m 出现（16 点采样，排除建筑与越界）
> - 追逐速度：3.6 m/s（保持不变；玩家走 3.2、跑 6.0）
> - 追逐上限：12 秒，超时放弃，星保留，bit 复位
> - 逃跑：走到门口按 E，播 0.5 秒演出后传送；校长 2 秒后放弃
> - 后果：被抓 → 死亡、星清零、进入选点
> - 冷却：0（无冷却，死亡后复位）

---

## 7. 验收清单

- [ ] 站着不动，2.5 秒左右被抓
- [ ] 走几步停下，1–2 秒内被抓
- [ ] 跑步，12 秒后校长放弃，星还在
- [ ] 校长不再穿过教学楼
- [ ] 从教室出来在门口，不在广场中央
- [ ] 连廊能从广场的门进去
- [ ] `node scripts/test-bits.mjs` 仍全过
