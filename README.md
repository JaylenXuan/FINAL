# AIE1101 — 校园沙盒（原型 v0.1）

浏览器里跑的 3D 校园小游戏，GTA 风格单人沙盒。当前状态：**垂直切片 v0.2.0（schema v2）**——五态状态机、四个锚点、两个 P0 bit 全链路可跑，美术是灰盒。

运行时依赖只有 `three@0.169.0`，dev 只有 `vite@5.4.11`（`three-player-controller` / `three-mesh-bvh` 已删除，角色为自写胶囊控制器）。

## 跑起来

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm run build      # 产物 dist/
node scripts/test-bits.mjs   # 无头自测，9 组断言（不需要浏览器）
```

## 操作

| 键 | Play | ChooseAnchor |
| --- | --- | --- |
| WASD | 移动 | — |
| Shift | 跑 | — |
| E | 交互（门口进/出房间） | — |
| Tab | 举起 / 放下手机 | — |
| 1-4 | 调试传送 | 选锚点 |
| ↑ ↓ | — | 上下移动高亮 |
| Enter | — | 确认 |
| F | 强制触发当前区域的 P0 bit | — |
| R | 复位（回广场，星清零） | — |

## 演示用 URL 参数（现场兜底）

- `?anchor=a_plaza` — 跳过开场醒来，直接落位（a_classroom / a_corridor / a_library / a_plaza）
- `?bit=phone_walk` — 落地 1.6 秒后强制触发广场 bit
- `?anchor=a_classroom&bit=class_sleep` — 直接进课堂 bit
- `?screen=anchors` — 只看选点界面（调版式用）
- `?spawn=1` — 在面前放一个校长（看模型比例用）

## 玩法规则（v0.2 定稿）

- 违纪星 0-3，**跨 bit 保留，只有死亡清零**；满 3 星时任何一次违规**直接带走**，不再给追逐机会
- 广场玩手机：举手机走 4 秒 → 星 +1 → 校长从最远角追来（速度 3.6，玩家跑 6.0 拉得开）
- **逃跑只有一条路：进门**。进任意房间 2 秒后校长放弃，星保留、bit 复位。演示时只要一直不进门，就一定会被抓
- 教室睡觉：开场醒来 3 秒后被点名，答错 +1 星，3 星被赶出教室

## 目录与归属

```
data/        内容：world.json（schema v2）· bits.json · lines.json
src/core/    Partner：loop（60Hz）· state（五态）· director（三条时间轴）· eventbus
src/world/   Partner：builder（world.json → 几何/碰撞/锚点/机位）· props（道具注册表）
src/player/  Partner：input · player（胶囊移动 + 传送 + 手机）· camera（跟随 / 固定机位）
src/npc/     Partner：chaser（校长与保安共用）
src/bits/    Partner：bits（条件判定 + 逃跑放弃 + 星）
src/ui/      内容：hud（星/字幕/手机/答题）· blackout（黑屏/选点/醒来遮罩）
src/audio/   内容：audio（WebAudio 合成）
scripts/     Partner：test-bits.mjs（无头自测）
docs/        共同：REVIEW（缺口清单）· SPEC-PATCH（规格补丁）· DEV-NOTES（每文件 5 行）
```

完整分工见 `docs/SPEC-PATCH.md` §8。

## 当前已知限制

- 角色是胶囊体，没有 GLB 模型与动画（自写控制器；接入模板需要带 idle/walk/run/jump 命名片段的 GLB，见 `docs/REVIEW.md` 第 1 条）
- 贴图缺（`/public/textures/teach.jpg` 不存在时自动回退纯色）
- 音频全是 WebAudio 合成音，`public/audio/` 为空
- 图书馆只有门厅、连廊只有一段，无道具
- 星星只有两个来源，第 3 颗的来源未定
