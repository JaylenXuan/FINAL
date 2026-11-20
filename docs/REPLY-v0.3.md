# 回复 v0.3（发给 Partner）

> 直接复制下面分隔线内的内容。

---

v0.2 收到了，32 个文件，代码能跑。REVIEW-v0.2 我对着代码核过，两条 P0 都成立。第 1 条是我上一轮拍错了：3.6 对走路 3.2 只快 0.4，18.87m 要 47 秒，规则不成立。改。

## 一、P0-1 追不上：改速度 + 改刷点 + 加超时

- `CHASER_SPEED = 4.6`
- 刷点：玩家前方 10m，16 点圆周采样，排除建筑 AABB 和 bounds 外的点
- 追逐上限 8 秒，超时 `abandon()`，星保留，bit 复位
- 验算：站着 1.9s 被抓；走路 6.4s 被抓；跑步 6.0 跑得掉，8 秒后放弃

这样"走路看手机必被抓、跑步能逃但只是暂时"才成立。

## 二、P0-2 穿墙：5 行

- `chaser.update` 位移后调用 `player.js` 的 `resolve()`，圆 vs AABB 推出
- 刷点采样时先排除建筑内的点
- 验收：`(-10,-10)` 到 `(0,6)` 不再穿楼

## 三、P0-4 进门：改表现，不改传送

- 被追时按 E：先停 0.5 秒，校长在门口 2m 停下、转身
- 播 `PHONE_ESCAPED`，再淡出、传送
- §9 措辞改成"从门离开广场"
- 不做门洞触发体

## 四、P1 这周清掉

5. `chaser.bitId`：spawn 时记 `bit.id`，`onCapture` 读回来
6. 三星分支：不要直接 `emit death`，改成 0.6 秒短序列（喊话 → 校长秒到 → 抓），复用 `caught` 时间轴，文案用 `STAR_LIMIT`
7. 出口锚点：`room.exit` + `a_out_*` 三个点，builder 读 `room.exit || 'a_plaza'`；顺便加一扇连廊的门（现在连廊只能调试传送进去）
8. `pendingDeath`：非 PLAY 状态收到 `death` 先排队，回 PLAY 立刻结算

## 五、P2

9. 室内阴影排 W3，按房间挂灯，`castShadow` 只开一盏
10. `?perf=1` 显示 calls / triangles / fps
11. `?screen=anchors` 先 `state.set(ANCHOR)` 再开 picker
12. `input.once` 改成 `consume`，或在文件头写清"查询不消费"

## 六、内容侧已经交的

- `data/lines.json`：8 → 19 条，新增 `PHONE_ESCAPED`、`STAR_LIMIT`、`CAUGHT_SUB`、`CLASS_Q`、`CLASS_OPT_1/2/3`、四个锚点名
- `data/bits.json`：`cooldown` 改成 `0`
- `docs/test-log.md`：试玩记录表
- `docs/SHOT-LIST.md`：拍摄清单（周日之前拍完）
- `docs/PATCH-v2.1.md`：上面所有改动的精确写法（含 JSON 片段和验收清单）
- `docs/WORK-LOG-2026-11-20.md`：这一轮的工作记录

其中 5 个 key 已经写好、但还没接线，需要你在对应位置加引用：

- `STAR_LIMIT` — 三星分支
- `PHONE_ESCAPED` — 逃跑演出
- `CAUGHT_SUB` — 黑屏副标题（`director.js:8` 现在写死 `'RECORDED'`）
- `CLASS_Q` / `CLASS_OPT_1/2/3` — 问题卡（现在写死在 `index.html`）
- `ANCHOR_*` — 现在由 `anchorLabel(id)` 推导，可换成读 lines

## 七、需要你回三句

1. `CHASER_SPEED 4.6` 可以吗？不改的话走路永远抓不到。
2. `room.exit` + `a_out_*` 走 schema v2.1，可以吗？
3. 仓库链接发我。你给的是个人主页，不是仓库地址；如果是私有库，先把我加成 collaborator。

---

（完）
