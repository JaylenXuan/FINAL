# 规格补丁 v2.1（提案，待 Partner 确认）

针对 REVIEW-v0.2 的两条 P0。**未确认前不要改代码**，确认后照本文抄。

---

## 1. 数值：校长 4.6，刷点 10m，上限 8 秒

| 参数 | 旧 | 新 |
|---|---|---|
| `CHASER_SPEED` | 3.6 | **4.6** |
| 刷点距离 | `farEnd` 四角（18.87m） | **玩家前方 10m** |
| 追逐上限 | 无 | **8 秒** |
| 玩家速度 | 走 3.2 / 跑 6.0 | 不变 |

验算（抓取半径 1.1m，有效距离 8.9m）：

| 玩家 | 相对速度 | 被抓时间 |
|---|---|---|
| 站着 | 4.6 | 1.9 s |
| 走路 3.2 | 1.4 | 6.4 s |
| 跑步 6.0 | −1.4 | 追不上，8 秒后放弃 |

结论：**走路看手机必被抓，跑步能逃但只是暂时**。演示的人正常走路即可。

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
    // 越靠玩家前方分越高
    const score = (p.x - target.pos.x) * fx + (p.z - target.pos.z) * fz
    if (score > bestScore) { bestScore = score; best = p }
  }
  return best || target.pos.clone()
}
```

`insideXZ` 用 `{min,max}` AABB，直接复用 `player.js` 里的判定。

---

## 3. 碰撞：5 行

`update()` 位移之后、`sync()` 之前：

```js
// 圆 vs AABB 推出，复用 player.js 的 resolve
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

`ESCAPE_AFTER` 的 2 秒倒计时保留，但只在玩家**还没传送**时走；已传送则直接 `abandon()`。

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
> - 追逐速度：4.6 m/s（玩家走 3.2、跑 6.0）
> - 追逐上限：8 秒，超时放弃，星保留，bit 复位
> - 逃跑：走到门口按 E，播 0.5 秒演出后传送；校长 2 秒后放弃
> - 后果：被抓 → 死亡、星清零、进入选点
> - 冷却：0（无冷却，死亡后复位）

---

## 7. 验收清单

- [ ] 站着不动，1.9 秒左右被抓
- [ ] 走路，6.4 秒左右被抓
- [ ] 跑步，8 秒后校长放弃，星还在
- [ ] 校长不再穿过教学楼
- [ ] 从教室出来在门口，不在广场中央
- [ ] 连廊能从广场的门进去
- [ ] `node scripts/test-bits.mjs` 仍全过
