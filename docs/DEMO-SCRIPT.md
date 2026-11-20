# 演示脚本（3–4 分钟）

> 现场用 Chrome 全屏，提前打开 `http://127.0.0.1:5173/?anchor=a_classroom`。
> 所有时间都是大概，按现场节奏微调。

## 开场前 30 秒

- 关掉无关窗口，F11 全屏
- 确认声音开着（警报、脚步）
- 手放在 `R` 上：崩了就按 R 回广场

## 分镜

| 时间 | 画面 | 操作 | 讲解（英文，一句就够） |
|---|---|---|---|
| 0:00 | 教室，眨眼醒来 | 不用操作，等 2 秒 | "You fell asleep in class. This is how you wake up." |
| 0:15 | 老师点名，三选一（三道都是校园梗） | 按 `3` 答对 | "Only one of these is something he actually said." |
| 0:25 | 老师下课 | 不用操作 | "Correct. Class dismissed." |
| 0:35 | 教室自由活动 | 走到同学旁边按 `E`，聊一句 | "Now you can walk around and talk to people." |
| 0:55 | 出门到广场 | 走到门口按 `E` | "Everything is connected by doors and anchors." |
| 1:10 | 广场 | 按 `Tab` 举手机，往前走 4 秒 | "Phone out, walking. This is the rule we all know." |
| 1:25 | 校长从前面出现 | 继续走两步，**停下** | "Here he comes." |
| 1:35 | 被抓住，震屏 | 不用操作 | "Caught." |
| 1:40 | 黑屏 `CAUGHT` | 等 1 秒 | "GTA-style death screen." |
| 1:50 | 选点界面 | 按 `1` 选教室，`Enter` | "You choose where to wake up." |
| 2:00 | 教室醒来（完整版） | 看老师、同学 | "Same wake-up, full version." |
| 2:20 | 传送到连廊 | 按 `3` | "Corridor — this is the campus look we're going for." |
| 2:40 | 传送到图书馆 | 按 `4` | "Library lobby, next to be dressed." |
| 2:55 | 回广场自由走 | 按 `1` | "One street, three interiors, all teleport-linked." |
| 3:15 | 复位 | 按 `R` | "Reset in one second, so we can run it again." |

## 注意

- **答错一次就直接死**。演示时不要故意答错，死亡留给广场的手机 bit，节奏更顺。
- 如果老师问“答错会怎样”，按 `1` 演示一次，反正 3 秒就黑屏重来。

## 讲解要点（挑 3 条说，别念稿）

1. **一个循环**：做不该做的事 → 星 +1 → 被追 → 黑屏 → 选点重生。
2. **一个系统**：所有事件都是 `bits.json` 里的一份配置，加新事件不改代码。
3. **一个取舍**：室内 + 传送，换来 3 分钟里没有赶路。

## 翻车兜底

| 情况 | 动作 |
|---|---|
| 卡住 / 黑屏不恢复 | 按 `R` |
| 想直接演手机 bit | 地址加 `?bit=phone_walk`，落地 1.6 秒后自动触发 |
| 想直接看选点界面 | 地址加 `?screen=anchors` |
| 想重看开场 | 地址加 `?anchor=a_classroom` |
| WebGL 崩了 | 切到提前录好的 90 秒视频 |

## 排练要求

- 第 4 周至少连演 3 遍，每遍掐表
- 超过 4 分钟就砍掉图书馆那一站
- 每次排练后把卡点写进 `docs/test-log.md`
