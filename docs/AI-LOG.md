# AI 使用日志

> 交付物之一（"AI 使用说明"）的素材库。每次和 AI 协作追加一段，三行说清：让它做什么 / 关键产出落在哪 / 人改了什么。
> 规则：不写"用了 AI 辅助"这种空话，写具体到文件和决定。

| 日期 | 让 AI 做什么 | 关键产出（文件） | 人改了什么 / 没采纳什么 |
| --- | --- | --- | --- |
| 2026-11-19 | 读完规格 v1.1，找漏洞，并搭 W0 垂直切片（五态状态机 + 两个 P0 bit + 选点 + 醒来） | `src/core/*`、`src/world/*`、`src/player/*`、`src/npc/chaser.js`、`src/bits/bits.js`、`src/ui/*`、`src/audio/audio.js`、`src/main.js`、`scripts/test-bits.mjs`、`docs/REVIEW.md`、`docs/DEV-NOTES.md` | 未采纳"直接接 `three-player-controller`"：实测其强制要求带 `idle/walk/run/jump` 命名片段的 GLB，无模型跑不起来 → 改自写胶囊控制器（后于 v0.2.0 彻底删依赖）；机位 `[6,5,8]` 被拒绝，改 `[4.2,3.2,3.6]` |
| 2026-11-20 | 按四条拍板改代码：`kind` / `to` 字段、schema v2、删两个依赖、校长速度 3.6 + 进门放弃、星跨 bit 保留 | `data/world.json`(v2)、`src/world/props.js`、`src/world/builder.js`、`src/npc/chaser.js`、`src/bits/bits.js`、`src/main.js`、`CHANGELOG.md` v0.2.0、`docs/SPEC-PATCH.md` | 补了三条自测（进门逃跑 / 3 星直接带走 / reset 保星）；AI 建议的"用长宽比推断连廊"被否，改成显式 `kind` |
