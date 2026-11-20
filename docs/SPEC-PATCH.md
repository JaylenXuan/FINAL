# 规格补丁：v1.1 → v2（照抄进正文即可）

> 由四条拍板反推出来的文档改动。**代码已按这份实现**，文档改完即与代码一致。
> 涉及 §3、§5、§6、§8、§9、§12 六处；其余章节不动。

---

## §3 技术栈（整节替换）

- three.js：0.169.0，写死，不升级
- Vite：5.4.11
- 原生 JS（ESM），无框架，不用 React / Vue / TypeScript
- UI 用 HTML/CSS 覆盖层，不画在 canvas 里
- 音频用 WebAudio：UI / 警报 / 耳鸣走合成音，环境声用 2 段 CC0 素材（ogg 优先、mp3 兜底，总包 < 5MB）
- 演示用 Chrome kiosk 全屏，不打包 exe
- **不使用** `three-player-controller` 与 `three-mesh-bvh`（角色为自写胶囊控制器，见 §4）；依赖表只有 three + vite

## §5 单位、坐标、比例（追加两条）

- 地面尺寸必须比 `outdoor.bounds` 大一圈：相机偏移是 `[0, 6, 9]`，玩家贴近边界时镜头会退到地面之外。示例：`ground.size = [26, 26]` 包住 `bounds = [[-10,-10],[10,10]]`。
- 房间机位（`rooms[].camera`）的 `pos` / `lookAt` 是**相对该房间 `origin` 的局部坐标**，且 `pos` 必须落在房间包围盒内部（含墙厚）。落在外面看到的是盒子外壳，`world/builder.js` 会打 `[builder] … 落在房间外面` 告警。

## §6 数据格式（规则段追加，schema 升到 v2）

```json
"meta": { "version": 2, "unit": "meter", "up": "Y" }
```

房间：

```json
{
  "id": "corridor",
  "kind": "corridor",
  "shell": "room_3x8x3.8",
  "origin": [300, 0, 0],
  "props": [],
  "camera": { "pos": [0, 1.8, 3.2], "lookAt": [0, 1.4, -4], "fov": 55 },
  "anchors": [ { "id": "a_corridor", "pos": [0, 0, 1.5], "yaw": 0 } ]
}
```

门：

```json
{ "type": "door", "pos": [-3, 0, -6.2], "rotationY": 0, "to": "a_classroom" }
```

新增规则：

- `rooms[].kind` 只能是 `"room"` 或 `"corridor"`，缺省 `"room"`。`kind` 决定房间两端是否敞开、两侧是否开窗；**不要用长宽比推断房间类型**（3.5m 宽的储藏室会被误判）。
- 门统一 `type: "door"`，去向写在 `to` 字段，`to` 必须是已存在的锚点 id。**不要用 type 后缀编码目的地**——那样每加一扇门都要改 `props.js`。
- 连廊是 `rooms` 里的一条记录（`kind: "corridor"`），锚点放在它自己的 `anchors` 里，不放 `outdoor.anchors`。

## §8 目录与文件所有权（整节替换）

规则：A/B 的叫法作废，按目录拆。

| 归属 | 负责范围 |
| --- | --- |
| Partner（模拟/引擎） | `src/core/` `src/world/` `src/player/` `src/npc/` `src/bits/` `src/main.js` `index.html` `package.json` `vite.config.js` `scripts/` 灯光实现、性能、拍摄 |
| 内容（表现/内容） | `src/ui/` `src/audio/` `data/world.json` `data/bits.json` `data/lines.json` `public/textures/` `public/audio/` 贴图处理、文案、UI 视觉、测试记录、报告、演示 |
| 共同 | `README.md` `CREDITS.md` `CHANGELOG.md` `docs/` |

- `main.js` 与 `index.html` 归 Partner；内容侧要改通过 ui 模块和 data 文件。
- `data/world.json` 字段名固定，内容侧只改数值（摆位、机位、尺寸）。
- 任何 schema 改动走 CHANGELOG，两人确认。

## §9 已定 bit 的规格（替换对应条目）

bit 1 phone_walk
- 触发：举手机 + 移动超过 4 秒
- 立刻生效：违纪星 +1
- 演员：校长，从广场远端（离玩家最远的角）出现
- 追逐速度：**固定 3.6 m/s**（玩家走 3.2、跑 6.0）
- 逃跑规则：**进任意房间，校长 2 秒后放弃**，星保留，bit 复位；不做体力、不做计时丢失
- 后果：被抓 → 死亡、星清零、进入选点
- 冷却：**无冷却，死亡后复位**

bit 2 class_sleep
- 节奏：3 秒后重新点名；选项固定；答对即结束；下次在教室醒来重新武装
- 其余不变

违纪星（§10 同步）
- 星**跨 bit 保留**，只有死亡才清零
- 满 3 星时，**任何一次违规直接“被带走”**，不再给追逐机会

## §12 分工与工时（整节替换）

Partner（模拟/引擎，约 32h）
- 控制器、相机、锚点、bit 系统、追逐与放弃、状态机、性能
- 拍摄（4 个地点 × 10 张 + 4 张平拍）
- 报告里的“系统”部分

内容（表现/内容，约 28h）
- 贴图后期、灯光观感、UI 视觉、文案（写）、音效与环境声
- `data/` 三份文件的数值与台词、测试记录、报告汇总、现场讲解

共同（约 4h）
- 每周一次 30 分钟同步；每周各自跑一遍完整 demo；第 3 周找 3 个同学试玩并记录
