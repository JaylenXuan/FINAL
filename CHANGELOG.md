# CHANGELOG

> 规则：只追加，不改别人的行；改 schema 必须先在这里写一条，等两人确认后再动代码。

## Unreleased · 内容侧 — 2026-11-20

**改了**
- `data/lines.json`：8 → 19 条，新增 `PHONE_ESCAPED`、`STAR_LIMIT`、`CAUGHT_SUB`、`CLASS_Q`、`CLASS_OPT_1/2/3`、`ANCHOR_CLASSROOM/CORRIDOR/LIBRARY/PLAZA`。
- `data/bits.json`：两条 bit 的 `cooldown` 由 `"TBD"` 改为 `0`，与代码"无冷却、死亡后复位"一致。

**新增（文档）**
- `docs/test-log.md`、`docs/SHOT-LIST.md`、`docs/REPLY-v0.3.md`、`docs/PATCH-v2.1.md`（提案，未确认）、`docs/WORK-LOG-2026-11-20.md`。

**没有改**
- `src/`、`data/world.json`、`index.html`、`package.json`。

**待确认（见 PATCH-v2.1）**
- `CHASER_SPEED` 3.6 → 4.6；刷点改前方 10m；追逐上限 8 秒。
- `rooms[].exit` + `a_out_*` 三个出口锚点（schema v2.1）。
- 连廊补一扇门（现在只能调试传送进去）。

## v0.2.0 — 2026-11-20 · schema v2 + 四条拍板落地（Partner 侧）

**schema v2（已确认，`meta.version: 2`）**
- `rooms[].kind: "room" | "corridor"`，缺省 `room`；房间形态由数据显式声明，不再按长宽比推断。
- 门统一 `type: "door"` + `"to": "a_classroom"`；删掉 `door_classroom` / `door_library` 两个 type。
- `a_corridor` 归到连廊这条 `rooms` 记录自己的 `anchors`（`outdoor.anchors` 只剩 `a_plaza`）。
- `rooms[].camera.pos / lookAt` 定为**相对 origin 的局部坐标**，且必须落在房间包围盒内；教室示例机位由 `[6,5,8]`（错，在房间外）改为 `[4.2, 3.2, 3.6]`。
- 地面 `26×26` 包 `bounds 20×20`（相机偏移 `[0,6,9]` 会出界）。
- 规格侧改动整理成可照抄的补丁：`docs/SPEC-PATCH.md`（§3 / §5 / §6 / §8 / §9 / §12）。

**依赖**
- 删除 `three-player-controller@0.6.3` 与 `three-mesh-bvh@0.7.8`（装上但没有使用，也不打算用）；`package.json` 运行时依赖只剩 `three@0.169.0`，dev 只剩 `vite@5.4.11`。
- 连带好处：不需要再为 MIT 模板署名；`npm install` 从 14 个包降到 3 个。

**规则（按拍板）**
- 校长速度固定 `CHASER_SPEED = 3.6`（玩家走 3.2、跑 6.0）；删除"1.05×走路 / 0.6×跑步"的双值写法。
- 逃跑只有一条路：进任意房间（`player.zone !== 'outdoor'`）→ 2 秒后校长放弃，星保留、bit 复位。移动端没有"丢失视线"分支，也不做体力。
- 星跨 bit 保留，死亡才清零；**满 3 星时任何一次违规直接带走**（`phone_walk` 第三次触发不再进入追逐，直接 `death`）。
- `bits.reset()` 默认保星；只有死亡流程和手动 `R`（`reset({ keepStars: false })`）才清零。
- 玩家不在同一 zone 时校长原地不动（不穿墙追到 x=100 的房间）。

**校验（builder 新增，数据写错会当场说出来）**
- `kind` 非法值告警并回落 `room`。
- `door.to` 指向不存在的锚点告警。
- 四个锚点（教室/连廊/图书馆/广场）缺任何一个告警（选点界面会少一项）。
- 机位越界告警保留。

**验证**
- `node scripts/test-bits.mjs` → 9 组通过（新增：进门逃跑 / 3 星直接带走 / reset 保星）。
- `npm run build` → 通过。
- 截图点验：v2 数据下两扇门正常渲染、教室新机位取景正常（`?anchor=a_classroom`）。

**留给内容侧的三处**
1. 逃跑成功没有台词（缺一条 `PHONE_ESCAPED`），`bits` 里只做了行为，没加文案。
2. `bits.json` 的 `cooldown` 仍写 `"TBD"`：代码行为是"无冷却、死亡后复位"，数据里要不要改成 `0` 由内容侧定。
3. `world.json` 的摆位/贴图名仍是占位值，等实拍后由内容侧替换。

## v0.1.0 — 2026-11-19 · W0 垂直切片（B 侧骨架 + A 侧占位数据）

**新增（B 的文件）**
- `package.json` / `vite.config.js` / `index.html`：Vite + three 0.169.0（写死）+ 原生 ESM，UI 用 HTML 覆盖层。
- `src/core/`：`loop`（固定 60Hz + 插值）、`state`（五态 + 非法跳转拦截）、`director`（caught / wake_up_full / wake_up_light / respawn）、`eventbus`。
- `src/world/`：`builder`（world.json → 几何/碰撞/锚点/机位）、`props`（道具注册表）。
- `src/player/`：`input`、`player`（胶囊移动 + 锚点传送 + 手机状态）、`camera`（室外跟随 / 室内固定机位 / 震屏）。
- `src/npc/chaser.js`：校长与保安共用，直线追 + 距离判定。
- `src/bits/bits.js`：phone_walk、class_sleep 全链路（计时 → 加星 → 追逐 / 点名答题 → 死亡）。
- `src/ui/`：`hud`（星/区域/双语字幕/手机/答题卡）、`blackout`（黑屏/选点/醒来遮罩）。
- `src/audio/audio.js`：WebAudio 合成音（无素材）。
- `src/main.js`：装配 + 按键分派 + 死亡→选点→醒来流程。
- `scripts/test-bits.mjs`：无头自测，6 组断言。
- `README.md`、`docs/REVIEW.md`（规格缺口清单）、`docs/DEV-NOTES.md`（每文件 5 行说明）、`.gitignore`。

**新增（A 的文件的占位版本，等 A 覆盖）**
- `data/world.json`：广场 26×26 地面（bounds 20×20）、一面立面、教室/图书馆/连廊三条 rooms、4 个锚点、3 个机位。

**没有做的事（刻意的）**
- 没有改 schema：`world.json` 字段名与 §6 完全一致；`camera.pos/lookAt` 按"相对 origin 的局部坐标"解释（**新增约定，需确认**）。
- 没有加 `door` 字段：门 → 房间用 prop 的 `type` 约定（`door_classroom` / `door_library`，在 `world/props.js` 注册）。**如需改成字段，属改 schema，等确认。**
- 没有接 `three-player-controller`：其 `PlayerControllerOptions` 强制要求带 `idle/walk/run/jump` 命名片段的 GLB，当前无角色模型，按 §15 备案走自写控制器。**接口已按 §7 对齐（`teleport / setPhone / update / onCapture`），后续替换只动 `src/player/player.js`。**
- 没有编 `cooldown: "TBD"` 的数值：运行时兜底为"死亡后复位、无冷却"。
- 没有做图书馆与食堂的 bit。

**需要两人确认的 4 件事**
1. `camera.pos/lookAt` 是相对 `origin` 的局部坐标 —— 确认后写进规格 §6 规则。
2. 连廊用 `rooms` 里一条 `shell: "room_3x8x3.8"` 表达（最短边 < 4m 视为走廊，两端敞开、两侧开窗）。
3. 门 → 房间用 prop type 约定，还是给 prop 加 `to` 字段（后者是改 schema）。
4. 校长速度取 3.36（1.05×走路）还是 3.6（0.6×跑步），以及"玩家跑起来就追不上"要不要加丢失分支。

**验证记录**
- `node scripts/test-bits.mjs` → 6 组通过（计时 / 中断清零 / 加星 / 逐出 / 答对 / 状态机）。
- `npm run build` → 通过，产物 517KB（gzip 134KB）。
- 截图点验：教室内部机位、广场、选点界面、追逐者比例（`?screen=anchors`、`?spawn=1`）。
