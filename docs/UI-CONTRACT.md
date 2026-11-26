# UI 交接清单（给视觉/建模负责人）

> 你可以重做外观，但请保留 `id` 和公开方法签名。改完跑一遍验收命令即可，不需要改逻辑。

## 1. 谁改哪里

| 归你 | 归我 |
|---|---|
| `index.html` 的 `<style>`、`#hud` 等 DOM 结构与文案 | `data/*.json`、`docs/`、`CHANGELOG` |
| `src/ui/*.js` 的视觉实现 | `src/bits`、`src/core`、`src/npc` 的逻辑 |
| `public/models/`、`public/textures/` | 构建、测试、git 同步 |

约定：`id` 不改名；公开方法不改名、不改参数；要加新元素可以，告诉我 `id` 和用途，我来绑事件。

## 2. DOM 清单（index.html）

| id | 位置 | 用途 | 谁在写 |
|---|---|---|---|
| `app` | 329 | three.js canvas 容器 | main.js |
| `speedlines` | 331 | 冲刺速度线 | hud.js |
| `hud` | 333 | HUD 总容器 | — |
| `hud-top` | 334 | 顶部条 | — |
| `stars` | 335 | 违纪星，3 个 `<i>` | `ui.setStars(n)` |
| `zone` | 335 | 当前区域名 | `ui.setZone(name)` |
| `hint` | 337 | 左下操作提示 | 静态文案，可直接改 |
| `prompt` | 355 | `E` 交互提示，`.label` 是文本 | `ui.setPrompt(text)` |
| `sprint` | 357 | 冲刺能量条 | `ui.setSprint({stamina,overheated,sprinting})` |
| `subtitle` | 365 | 双语字幕，`.en` / `.zh` | `ui.subtitle({en,zh}, dur)` |
| `phone` | 366 | 举手机的示意 | `ui.setPhone(up)` |
| `classq` | 374 | 课堂题卡，`.q` + 三个 `.opt[data-opt]` | `ui.showQuestion(on)` |
| `bubble` | 384 | 同学聊天气泡 | `classmates.js` |
| `black` | 386 | 死亡/黑屏，`.title` / `.sub` | `blackout.blackout()` |
| `anchors` | 389 | 旧选点列表（现在选点走地图） | `blackout.showPicker()` |
| `intro` | 392 | 开场标题卡 | `ui.showIntro(sec)` |
| `wake` | 401 | 醒来暗角 | `blackout.wakeOn/Off()` |
| `boot` | 402 | 加载页 | main.js |

## 3. CSS 分段（都在 index.html 的 `<style>` 里）

| 行号 | 段 |
|---|---|
| 45 | HUD |
| 101 | 冲刺能量条 |
| 139 | 交互提示 |
| 156 | 冲刺速度线 |
| 170 | 字幕 |
| 185 | 手机 |
| 199 | 课堂题卡 |
| 222 | 聊天气泡 |
| 236 | 黑屏 + 选点 |
| 267 | 醒来暗角 |
| 276 | 加载页 |
| 294 | 开场标题卡 |

可以整段重写，只要选择器里的 `id` 不变。

## 4. JS 公开接口（src/ui）

### HUD（`src/ui/hud.js`）

| 方法 | 调用时机 |
|---|---|
| `setStars(n)` | 违纪星变化 |
| `setZone(name)` | 进入房间 / 传送 |
| `setPhone(up)` | 按 Tab 举/放手机 |
| `setSprint({stamina,overheated,sprinting})` | 每帧 |
| `showIntro(sec)` / `hideIntro()` | 开场；任意键可跳过 |
| `subtitle({en,zh}, dur)` | 所有台词 |
| `showQuestion(on)` | 课堂点名 |
| `setPrompt(text)` | 靠近门/同学 |
| `update(dt)` | 每帧，字幕计时 |

### Blackout（`src/ui/blackout.js`）

| 方法 | 用途 |
|---|---|
| `blackout(title, sub)` | 死亡大字 |
| `clearBlack(sec)` / `setBlack(v)` / `fadeBlack(v,sec)` | 黑幕控制 |
| `wakeOn()` / `wakeOff()` | 醒来暗角 |
| `showPicker(anchors, defaultId, cb, {showList})` | 旧列表选点（默认关） |
| `pick(i)` / `move(d)` / `confirm()` | 键鼠选点 |

### Minimap（`src/ui/minimap.js`）

| 方法 | 用途 |
|---|---|
| `update(player, camera)` | 每帧 |
| `setMode('normal' | 'select')` | 常驻 / 死亡放大 |
| `beginSelect(anchors, defaultId, cb)` | 死亡选点 |
| `endSelect()` | 醒来收起 |
| `setSelectMode(anchors, cb)` | 兼容旧调用 |
| `move(d)` / `pick(i)` / `confirm()` | 键盘 |
| `el` / `mode` / `selected` | 只读 |

## 5. 状态与界面

| 状态 | 可见 | 不可见 |
|---|---|---|
| `Play` | HUD、字幕、手机、地图 | 黑屏、选点 |
| `Caught` | 黑屏 + 大字 | HUD |
| `Anchor` | 只有左上角地图（放大） | 其余全黑 |
| `WakeUp` | 暗角 + 场景 | 黑屏、选点 |

## 6. 三个常见改动的正确姿势

**改题卡**
只改 `#classq` 里的文案和样式。三个选项必须保留 `data-opt="1/2/3"`；正确项由 `src/bits/bits.js` 的 `correct = 3` 决定，改题时两边一起改。

**改死亡屏**
改 `#black .title` / `.sub` 的样式即可。文字来自 `lines.json` 的 `CAUGHT_TITLE` / `WRONG_TITLE`，不要写死在 CSS 里。

**加 HUD 元素**
在 `#hud` 里加 `<div id="xxx">`，把 id 和用途告诉我，我在 `hud.js` 里绑定。不要用 JS 里没有的 id。

## 7. 不要碰

- `src/main.js` 的调用顺序和五态状态机
- `src/core/director.js` 的时间轴时长（改视觉时长要同步 `wake_up_map` / `caught`）
- `src/bits/bits.js` 的 `correct` / `threshold`
- `#classq` 的 `data-opt` 编号

## 8. 验收命令

```bash
npm run validate          # 数据体检
node scripts/test-bits.mjs # 9 组逻辑测试
npm run build             # 构建
```

预览：`http://127.0.0.1:5181`，改完 HMR 自动刷新。
