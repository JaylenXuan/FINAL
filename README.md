# AIE1101 — Campus + Classroom（合并版）

浏览器里跑的 3D 校园小游戏：**全校园自由探索 + 进教学楼上课**。
外面是港中深 OSM 真实轮廓的校园，玩家是紫色小恶魔龙，可冲刺、跳跃、举手机；
走到「教学楼B」主入口按 E，进入一条横贯整栋楼的长走廊；走廊北墙有 8 间教室门，按 E 进入任意一间。01 班有醒来眨眼、课堂点名、答对聊天 / 答错 WRONG 死亡，其余 7 间是不同的主题教室，可自由看看。

## 跑起来

```bash
npm install
npm run dev        # http://127.0.0.1:5181
npm run build      # 产物 dist/
npm run validate   # 数据体检：锚点/门/台词
node scripts/test-bits.mjs   # 无头 bit 自测，不需要浏览器
```

默认 URL 直接进校园；5181 是项目固定端口（`vite.config.js` 与 `package.json` 都写死），端口被占时直接报错而不是漂移。

## 操作

| 键 | 作用 |
| --- | --- |
| W/S 或 ↑/↓ | 前进 / 后退 |
| A/D 或 ←/→ | 左右平移（相对镜头方向，不再原地转身） |
| 鼠标 | 走廊/教室都是玩家位置的第一人称，拖动转视线 |
| Shift | 冲刺（有能量条，耗尽过热后冷却） |
| Space | 跳跃 |
| E | 交互：进/出教学楼、和同学聊天 |
| Tab | 举起 / 放下手机 |
| 1-4 | 传送 / 死亡选点（对应四个锚点） |
| ↑ ↓ + Enter | 死亡地图选点 / 确认 |
| F | 强制触发当前区域事件 |
| R | 复位（回教学楼B门口，星清零） |

鼠标也可以直接点死亡地图上的锚点：点一次选中，再点一次确认。

## 演示流程

1. 开局站在「教学楼B」主入口前，镜头能看到龙、校园和教学楼外立面。
2. 按 E 进入教学楼 → 沿着长走廊走到 01 班门口，按 E 进教室 → 2.2 秒眨眼醒来（黑→一条缝→闭→更亮→完全睁开）。
3. 老师点名三选一：**正确答案是第 3 项**（Parents, stop micromanaging...）。
4. 答对：`Correct. Class dismissed.`，可以在 01 班和鲸鱼娘 / 奶龙 / 奶蛙聊天（靠近 2m 按 E）。
5. 答错：字幕 `Wrong.`，直接 WRONG 死亡；全屏压黑，只有左上角地图放大到 520，四个锚点脉冲，键鼠选点后淡入醒来。
6. 其他 7 间教室（考场、社团、实验室、自习室、音乐室、美术室、会议室）有各自的桌椅和主题色，鼠标可以自由环视。
7. 教室门口按 E 回走廊，走到主入口按 E 可回校园；校园里举手机走路 4 秒会触发校长追逐（前方 10m 刷点，12 秒超时，进教室可逃）。

## 两套世界怎么合

- `data/campus-osm.json`：真实校园建筑/道路/地形，`src/campus/world/` 生成可视世界。
- `data/world.json`：一间 10×8 定制教室基础数据；`src/main.js` 复制成 8 间不同主题教室，并在 B 栋里生成一条 36m 长走廊，由 `src/world/builder.js` 生成课桌/碰撞。
- `src/main.js` 把两套 `zones / anchors / interactables / roomCameras` 合成一个世界：B 栋主入口 = 走廊，走廊的 8 个门 = 8 间教室入口，教室出口回到走廊对应门口。
- 教室内部复用 `src/bits`、`src/core/director`、`src/ui/minimap`、`src/npc/classmates`；室外复用校园的 `src/campus/player`（龙模型/冲刺/跳跃/地形/带半径的楼体碰撞）与 `src/campus/world`。

## 目录

```
data/             campus-osm.json（校园）· world.json（教室）· bits.json · lines.json
src/campus/       从校园版合并进来的 world / player / fx（OSM 地形、龙模型、第三人称相机）
src/world/        builder.js：定制教室几何/碰撞/机位
src/core/         loop · state（五态）· director（caught / 醒来眨眼 / 地图醒来）
src/player/       旧切片遗留文件（合并版未使用）
src/npc/          chaser（校长，10m 前方刷点/12s 超时/防穿墙）· classmates（VRM + 立牌）
src/bits/         课堂点名、手机追逐、星、逃跑
src/ui/           hud（冲刺条/字幕/题卡）· minimap（常驻 SVG 雷达 + 死亡选点）· blackout
src/audio/        WebAudio 合成音
scripts/          test-bits.mjs
docs/             PATCH / FRAMEWORK / REVIEW / DEV-NOTES（内容侧文档）
```

## 素材与许可

- 校园数据来自 OpenStreetMap 提取，见 `data/campus-osm.json` 的 `meta`。
- 鲸鱼娘 VRM：`public/models/characters/deepseek-reset.vrm`，来源 `dsh-plugin-whale-mate@0.6.3`，原作者 B站 **@hihihihi202**；许可为署名、非商用、允许修改，课程项目使用，详见 `CREDITS.md`。
- 奶龙 / 奶蛙暂用 `public/models/billboards/*.png` 透明立牌兜底；GLB 到位后替换。
- `@pixiv/three-vrm@3.5.5`（MIT）用于加载 VRM。

## 已知限制

- 教学楼B是放在校园 `a_teach` 标志旁的定制一层建筑，不是 OSM B 栋内部的逐层空间；外面只有 1 个主入口，里面是一条长走廊和 8 间主题教室，教室门是 E 交互而非物理穿门。
- 走廊和教室都用玩家位置的第一人称镜头（眼睛高度），鼠标只转视线，不移动机位；室外第三人称镜头遇到楼体会自动收到墙前，避免穿墙。
- 鲸鱼娘是静态站姿（长裙不能坐）；奶龙 / 奶蛙为 2D 立牌。
- 校园里除教学楼B外的室内仍使用校园版生成大厅；楼体碰撞已按真实多边形 + 人物半径修正，树/小型摆件仍不挡人。
- 音频全部为 WebAudio 合成音。
