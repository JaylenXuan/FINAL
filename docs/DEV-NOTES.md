# 每个文件 5 行说明（可直接当报告素材）

> 格式固定：做什么 / 关键取舍 / 怎么验证 / 对外接口 / 遗留。按 §14"每段关键代码要 5 行中文说明"。

---

## package.json
- 做什么：锁死依赖版本，只留 `dev / build / preview` 三个脚本，`type: module`。
- 关键取舍：运行时只剩 `three@0.169.0`、dev 只剩 `vite@5.4.11`；已删除 `three-player-controller` 与 `three-mesh-bvh`（装上但未使用，也决定不用）。
- 怎么验证：`npm ls --depth=0` 只有 three 与 vite；`npm run build` 通过；`node_modules` 体积明显变小。
- 对外接口：无。只有 Partner 能改这个文件。
- 遗留：无。若将来真要接模板，必须同时补一个带 `idle/walk/run/jump` 命名片段的 GLB，那是另一个 10h 的决定。

## vite.config.js
- 做什么：固定 `127.0.0.1:5173` 且 `strictPort`，构建目标 `es2020`。
- 关键取舍：不开 `base`、不配别名——相对导入路径 `../core/..` 保持肉眼可查，两人合并时不易冲突。
- 怎么验证：`npm run dev` 端口固定不漂移；`npm run build` 只生成 `dist/`。
- 对外接口：无。
- 遗留：现场如果要用 `?bit=` 之外的跳转，需要再加一层重写规则（暂不需要）。

## index.html
- 做什么：一个容器 + 六块 DOM 覆盖层（HUD / 字幕 / 手机 / 答题卡 / 黑屏选点 / 醒来遮罩），样式全内联。
- 关键取舍：UI 用 HTML 覆盖层而不是 canvas 内绘制——字幕和选点列表能直接用 CSS 做，键盘事件也只由一处收。
- 怎么验证：打开页面不报 404；`document.getElementById('anchors').children.length === 4`。
- 对外接口：`#hud #subtitle #phone #classq #black #anchors #wake #boot` 八个 id，ui 层按 id 取。
- 遗留：样式内联在 html 里，等美术定稿后再拆 `src/ui/*.css`（拆之前别动，拆的时候两人一起）。

## data/world.json
- 做什么：广场 + 一面教学楼立面 + 三间房（教室 10×8×4、图书馆 6×6×4、连廊 3×8×3.8）+ 4 个锚点 + 3 个固定机位。
- 关键取舍：**schema v2**，`meta.version: 2`；`rooms[].kind` 显式声明 `room / corridor`；门统一 `type:"door"` + `"to"`；`camera.pos/lookAt` 按相对 `origin` 的局部坐标，教室机位取 `[4.2,3.2,3.6]`。
- 怎么验证：页面加载无 `[builder]` 告警；四个锚点按 1-4 能传送；三个机位都不是"盒子外壳"视图。
- 对外接口：字段名固定，内容侧只改数值；`shell` 形如 `room_<宽>x<深>x<高>`，最短边 <4m 也要写 `kind` 才能变连廊。
- 遗留：立面没有窗户、图书馆只有门厅、连廊没有窗框细节，等实拍贴图替换（贴图名同时要改 `facade`）。

## data/bits.json
- 做什么：两条 P0 bit 的完整数据，照抄 §6 示例，一个字段没改。
- 关键取舍：`cooldown: "TBD"` 保持原样；运行时的兜底规则写在代码里（死亡后复位、无冷却），不往数据里编数值。
- 怎么验证：`node scripts/test-bits.mjs` 里 6 组断言读的就是这份文件；改字段名会直接崩。
- 对外接口：`trigger.all[].seconds`、`trigger.seconds`、`trigger.state`、`outcome.starsPerWrong/threshold/line`。
- 遗留：`actor.spawn: "far_end"` 目前由 `chaser.farEnd(zoneId, avoid)` 实现为"离玩家最远的角"，不是固定刷点。

## data/lines.json
- 做什么：台词表，`key → { en, zh }`，中英双语一起给。
- 关键取舍：英文主字幕、中文小字副字幕——现场演示是英文界面，但试玩同学是中文母语，双语比单语更能测出"笑点到没到"。
- 怎么验证：所有被 `bits/director` 引用的 key 都能取到（现在 8 条：PHONE_CAUGHT / CLASS_KICKED / PHONE_WARN / PHONE_CHASE / CLASS_WAKE / CLASS_WRONG / CLASS_ANSWER_OK / CAUGHT_TITLE）。
- 对外接口：key 大写蛇形；`PHONE_CHASE` 目前读了但还没播（等追逐开始时的喝止）。
- 遗留：缺 3 个选项文案、锚点名显示名（现在由 `anchorLabel()` 从 id 推导）、`F/R` 兜底提示。

## src/core/eventbus.js
- 做什么：一个 30 行的 `on/off/emit`，模块之间只通过事件说话。
- 关键取舍：不做通配、不做优先级、不做异步——单向写、同步派发，够用且好排查。
- 怎么验证：`bus.on('death')` 在 `test-bits.mjs` 里被触发 3 次，断言次数对得上。
- 对外接口：`bus.on(type, fn) → unsubscribe`、`bus.emit(type, payload)`。
- 遗留：事件名没有集中登记（现在是字符串），等事件超过 10 个再抽常量表。

## src/core/state.js
- 做什么：五态状态机 `Boot→Play→Caught→ChooseAnchor→WakeUp→Play`，非法跳转拒绝并告警。
- 关键取舍：转移表写成字面量常量而不是 if-else 链——加状态时只改一张表，报告里也好画图。
- 怎么验证：`test-bits.mjs` 第 6 组断言 `Caught → WakeUp` 被拒且 `current` 不变。
- 对外接口：`state.current`、`state.is(...names)`、`state.set(next)`、事件 `state:enter`。
- 遗留：没有 `state:exit`，需要在离开时做清理就得自己记 `prev`。

## src/core/loop.js
- 做什么：固定 60Hz 逻辑步 + 渲染插值 alpha，最多追 5 个子步。
- 关键取舍：`real > 0.25` 直接截断（切标签页回来不瞬移），追不上就丢时间（不进入死亡螺旋）。
- 怎么验证：把窗口切走 10 秒再回来，角色不会穿到墙里；`alpha` 恒在 0-1。
- 对外接口：`createLoop({step, render}).start()/stop()`。
- 遗留：没有暂停/慢动作接口，未来 `timeScale` 要加在这里而不是散在各模块。

## src/core/director.js
- 做什么：只播三条时间轴——`caught`（1.1s）、`wake_up_full`（2.0s）、`wake_up_light`（1.2s）、`respawn`（0.45s）。
- 关键取舍：不写通用过场编辑器，每条轴就是 `{at, run}` 的数组；时间和表现分离，改时长不改逻辑。
- 怎么验证：被抓到进入选点、醒来交还控制，两次实测都在 3 秒预算内（`director:done` 事件打点）。
- 对外接口：`director.play('caught' | 'wake_up' | 'respawn', {full})`、`director.playing`。
- 遗留：`respawn` 与 `wake_up` 有重复的淡入逻辑，第三周若加"传送演出"应抽成一个 `fadeIn(seconds)`。

## src/world/props.js
- 做什么：道具注册表：`tree / bench / gate / desk / podium / door`，每个返回 `{object, solid, interact}`。
- 关键取舍：门只有一种 `door`，去向由数据里的 `to` 决定（schema v2）——加门只改 `world.json`，不改这个文件；`solid` 只给 `[宽,高,深]`，碰撞盒由 builder 统一算。
- 怎么验证：`createProp('unknow')` 与缺 `to` 的 door 都只 `console.warn` 并跳过，不整页崩。
- 对外接口：`createProp(type, data)`、`PROP_TYPES`（新增 type 必须在这里登记）。
- 遗留：椅子与桌腿仍是分开两块（能看到缝）；门没有开合动画，靠 E 交互 + 淡入淡出。

## src/world/builder.js
- 做什么：读 `world.json`(v2) 生成地面/绿化收边/立面/道具/房间壳/碰撞盒/锚点/机位，返回 `{zones, anchors, anchorList, interactables, roomCameras}`。
- 关键取舍：房间形态按 `kind` 判定（不再用长宽比猜）；碰撞只产 AABB，圆 vs AABB 的推出留给 player；四条数据校验内建（`kind` 非法值、`door.to` 不存在、四个锚点缺项、机位越界）。
- 怎么验证：加载后 `Object.keys(world.zones)` 应为 `outdoor/classroom/library/corridor`；控制台没有 `[builder]` 开头的告警；四个锚点都能传。
- 对外接口：`buildWorld(data, scene)`、`anchorLabel(id)`；`interactables[]` 是门与房间出口的统一表（`zone/pos/radius/anchorId/label`）。
- 遗留：立面仍是"一张贴图 + 纯色回退"，没有窗；`ground.size` 与 `bounds` 的关系靠人工保证（规格 §5 已写明"地面大一圈"）。

## src/player/input.js
- 做什么：键盘状态 + 本帧按下集合；`Tab` 阻止默认焦点切换。
- 关键取舍：不在这里做键位语义（"1 是传送还是选点"由 main 按状态决定），避免输入层被状态污染。
- 怎么验证：按住 W 松开后 `axis().moving === false`；`once()` 只在按下那一帧为真（不会连发）。
- 对外接口：`isDown(code)`、`once(code)`、`axis() → {x,z,moving,running}`、`endFrame()`。
- 遗留：没有手柄/触屏；`window.blur` 时清空按键（已处理，防"卡住一直走"）。

## src/player/player.js
- 做什么：胶囊角色（1.75m）、加减速移动、圆 vs AABB 碰撞推出、锚点传送、手机举起状态。
- 关键取舍：走路 3.2 / 跑 6.0 由"米"直接给，不做单位缩放；碰撞只做 XZ 圆，不引入物理引擎（原型阶段最省时间）。
- 怎么验证：贴着教学楼立面走不穿墙；贴着 `bounds` 走不出广场；`teleport('a_corridor')` 后 `zone === 'corridor'`。
- 对外接口：`player.teleport(anchorId)`、`player.setPhone(bool)`、`player.pos`、`player.zone`、`player.moving`。
- 遗留：没有跳跃/台阶（§2 不做多层，够用）；`phoneUp` 目前只有 Tab 和 bits 读，没有"举手机时不能跑"的约束。

## src/player/camera.js
- 做什么：室外固定角度跟随（偏移 `[0,6,9]`、看向 +1.2m、平滑 8/s），室内用 `world.json` 的固定机位，加一个短促震屏。
- 关键取舍：不做鼠标环绕（§11 明确不要）；室内直接 `lerp` 到机位，不做轨道插值——固定机位就是固定机位。
- 怎么验证：`?anchor=a_classroom` 能看到讲台与课桌（不是盒子外壳）；被抓瞬间有 0.3s 抖动。
- 对外接口：`rig.setZone(zoneId, snap)`、`rig.update(dt, targetPos)`、`rig.shake(amp, dur)`。
- 遗留：室外相机没有做遮挡规避，站在立面正后方会被墙挡（广场 20m 内基本碰不到）。

## src/npc/chaser.js
- 做什么：校长/保安共用，速度定值 `CHASER_SPEED = 3.6`，直线追、`bounds` 内夹取、距离 < 1.1m 判定抓住。
- 关键取舍：玩家不在同一 zone 时校长**原地不动**（否则会穿过墙追到 x=100 的房间）；"放弃"的 2 秒倒计时放在 bits 里，因为那是 bit 规则不是 NPC 规则。
- 怎么验证：`?spawn=1` 在面前生成；`?bit=phone_walk` 站桩会被抓、按 Shift 跑能拉开；进教室后校长停在原地 2 秒后消失。
- 对外接口：`spawn(type, zoneId, from)`、`update(dt, target, targetZone)`、`onCapture(cb)`、`abandon()`、`despawn()`、`farEnd(zoneId, avoid)`。
- 遗留：没有寻路（会被桌角卡住）、没有动画（胶囊平移）、没有视线判断（按拍板不做"计时丢失"）。

## src/bits/bits.js
- 做什么：两条 P0 bit 的判定与推进：手机计时、加星、生成追逐者、逃跑放弃、课堂点名答题、死亡事件。
- 关键取舍：星**跨 bit 保留**、死亡清零；满 3 星任何违规**直接带走**（第三次玩手机不进入追逐）；进房间 2 秒（`ESCAPE_AFTER`）校长放弃、bit 复位；`reset({keepStars})` 默认保星。
- 怎么验证：`node scripts/test-bits.mjs` 九组断言（含"进门逃跑"与"3 星直接带走"两组）。
- 对外接口：`bits.update(dt)`、`bits.force(bitId)`、`bits.reset({keepStars})`、`bits.stars`、`bits.questionOpen`。
- 遗留：逃跑成功没有台词（等文案侧补 `PHONE_ESCAPED`）；`sequence` 里的动词仍是按 id 的 if 分支，加第 3 条 bit 时要重构成动词表。

## src/ui/hud.js
- 做什么：三颗星、区域名、双语字幕（2 秒自动收）、手机面板升降、答题卡显隐。
- 关键取舍：只管显示不管状态；字幕用"计时器 + class 切换"，不用 CSS animation，便于中途覆盖。
- 怎么验证：加星后 1-3 颗依次点亮；按 Tab 手机面板滑出/收起；答错后字幕能被新字幕直接顶掉。
- 对外接口：`ui.setStars(n)`、`ui.setZone(name)`、`ui.subtitle({en,zh}, dur)`、`ui.setPhone(bool)`、`ui.showQuestion(bool)`。
- 遗留：没有"星星闪烁"和"被抓时的红色描边"，属于打磨项。

## src/ui/blackout.js
- 做什么：黑屏（可带标题）、选点列表（1-4 / ↑↓ / Enter）、醒来遮罩的开关，全程不出鼠标。
- 关键取舍：用 DOM 而不是 canvas；`setBlack(0/1)` 走"关过渡立即生效"再恢复过渡，保证传送不硬切。
- 怎么验证：`?screen=anchors` 直接看版式；死亡后默认高亮上一次重生的锚点；确认后有音效、不刷新页面。
- 对外接口：`blackout.showPicker(anchors, defaultId, onConfirm)`、`pick(i)`、`move(±1)`、`confirm()`、`wakeOn/Off()`、`clearBlack(s)`。
- 遗留：锚点行没有显示缩略图/描述（§10 只要求名字）；`blackout()` 的标题字号在 1280 宽下偏大，等演示机分辨率定了再调。

## src/audio/audio.js
- 做什么：WebAudio 合成音——选中、确认、加星、警报、闷响、耳鸣。
- 关键取舍：零素材、零加载、零版权风险；`AudioContext` 懒创建并在 `suspended` 时 `resume()`（Chrome 自动播放策略）。
- 怎么验证：第一次按键后能听到确认音；黑屏后耳鸣有 1.4s 衰减。
- 对外接口：`audio.select/confirm/star/alarm/thud/tinnitus(dur)`。
- 遗留：没有环境音与脚步（需要素材，属 B 的 `public/audio/`）；`master.gain` 固定 0.35，现场音量要实测。

## src/main.js
- 做什么：装配层——加载三份数据、建场景灯光、串起 state/player/camera/chaser/bits/ui/director、按键分发、每帧调度。
- 关键取舍：所有"按键 → 做什么"集中在这一个文件按状态分派；`chaser.update` 传入 `player.zone` 以支持"进房间即放弃"；`R` 键走 `reset({keepStars:false})`。
- 怎么验证：开场教室醒来 → 3 秒被点名；按 4 到广场、Tab 举手机 4 秒被追；跑进楼 2 秒后校长放弃且星还在；第三次违规直接黑屏。
- 对外接口：URL 参数 `?anchor= / ?bit= / ?screen=anchors|question / ?spawn=1`；控制台 `window.__campus`。
- 遗留：`F` 的 bit 选择仍是"教室→课堂、其他→手机"的简化判断，第 3 条 bit 出现后要改成按 zone 查表。

## scripts/test-bits.mjs
- 做什么：无头自测，不需要浏览器和 three.js，直接跑 bit 判定、逃跑与状态机。
- 关键取舍：手写假 world/player/chaser/ui（各 10 行以内），断言只查结果不查实现，重构 bits 内部不会误报。
- 怎么验证：`node scripts/test-bits.mjs` 九组全过；把 `seconds: 4` 改成 3、或把 `ESCAPE_AFTER` 改成 5，都会立刻失败。
- 对外接口：`node scripts/test-bits.mjs`，失败时非零退出码（可直接挂 CI）。
- 遗留：没有覆盖 director 时间轴、选点键盘流、相机平滑，这三块靠人工点验（`?screen=anchors` / `?screen=question`）。
