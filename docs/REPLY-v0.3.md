# 回复 v0.3（修订版：速度不改）

> 直接复制下面分隔线内的内容。

---

修订一条：之前说的 4.6 撤回。

演示会举着手机走几步就停下，站着 2.5 秒就被抓，够看黑屏，不需要加速。`CHASER_SPEED` 保持 3.6。

所以 P0-1 只剩两处：

- 刷点：从四角改成玩家前方 10m（16 点采样，排除建筑和越界）
- 追逐上限 12 秒，超时放弃、星保留（给“跑几步再停”留时间）

另外两处不变：

- 防穿墙：`chaser.update` 里调 `resolve()`
- 进门 0.5 秒演出：校长在门口停下、转身，播 `PHONE_ESCAPED`

需要你确认的只剩一件：schema v2.1

- `rooms` 加 `"exit": "a_out_xxx"`
- `outdoor.anchors` 加三个门外点
- `builder` 读 `room.exit || 'a_plaza'`
- 顺便加一扇连廊的门

精确写法在 `docs/PATCH-v2.1.md`，已经按“速度不改”改好了。

仓库：https://github.com/JaylenXuan/FINAL
最新提交以仓库为准；你的 GitHub 用户名发我，加 collaborator。

---

（完）
