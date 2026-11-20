# 补丁：醒来眨眼 + 课堂问答 + 下课自由活动

> 三个部分：A 眨眼（视觉）、B 答题（逻辑 + 文案）、C 下课后（设计，待实现）。
> 我这边已同步改 `data/lines.json` 和 `data/bits.json`。

---

## A. 醒来眨眼

现在的 `wake_up_full` 只有「黑幕淡出 + 模糊」，2.0 秒，看起来像直接睁眼。

改成 2.2 秒的「睁—闭—再睁」：

| 时间 | 黑幕不透明度 | 感觉 |
|---|---|---|
| 0.00 | 1.00 | 全黑 |
| 0.25 | 0.72 | 眼皮抬一条缝 |
| 0.55 | 1.00 | 又闭上 |
| 0.75 | 0.42 | 再睁开，更亮 |
| 1.10 | 0.92 | 第三次眨 |
| 1.30 | 0.00 | 完全睁开 |
| 2.05 | — | 关掉模糊遮罩 |

### 1. `src/ui/blackout.js` 加方法

```js
fadeBlack(v, seconds = 0.2) {
  this.el.classList.add('show')
  this.el.style.transitionDuration = `${seconds}s`
  this.el.style.opacity = String(v)
  void this.el.offsetWidth
}
```

### 2. `src/core/director.js` 替换 `wake_up_full`

```js
wake_up_full: {
  dur: 2.2,
  steps: [
    { at: 0.00, run: (d) => { d.ui.setBlack(1); d.ui.wakeOn(); d.audio.tinnitus(2.0) } },
    { at: 0.25, run: (d) => d.ui.fadeBlack(0.72, 0.18) },
    { at: 0.55, run: (d) => d.ui.fadeBlack(1.00, 0.10) },
    { at: 0.75, run: (d) => d.ui.fadeBlack(0.42, 0.22) },
    { at: 1.10, run: (d) => d.ui.fadeBlack(0.92, 0.10) },
    { at: 1.30, run: (d) => d.ui.fadeBlack(0.00, 0.55) },
    { at: 2.05, run: (d) => { d.ui.wakeOff(); d.ui.clearBlack(0.01) } }
  ]
}
```

验收：进游戏先全黑 0.25 秒，亮一条缝，再闭、再睁，至少两次眨眼。

---

## B. 课堂问答

### 1. 题目（三道全是校园梗，只有一句是真的）

`index.html` 替换 `#classq` 卡片：

```html
<div id="classq">
  <div class="card">
    <div class="q">Which one did Principal Xu actually say?</div>
    <div class="opt" data-opt="1"><kbd>1</kbd><span>Ranking 260 in the gaokao beats 2,600.</span></div>
    <div class="opt" data-opt="2"><kbd>2</kbd><span>Walk while you're on your phone.</span></div>
    <div class="opt" data-opt="3"><kbd>3</kbd><span>Parents, stop micromanaging your kid's college life.</span></div>
  </div>
</div>
```

正确答案是 **3**。

### 2. 答错一次直接请出去

`data/bits.json` 里 `class_sleep.outcome.threshold` 已改成 **1**，代码里 `n >= (threshold || 3)` 会自动生效，不用改。

但 `answer()` 里的 `correct` 要改成 3：

```js
const correct = 3
```

并且**删掉「再被点名」的循环**：答错 → 加星 → 立刻 `emit('death', ...)`，不再回到 idle。

验收：
- 按 1 或 2：字幕 `Wrong.` → 直接黑屏，**大字显示 WRONG**（不是 CAUGHT）
- 按 3：字幕 `Correct. Class dismissed.` → 老师下课 → 可以在教室走动

### 2.5 死亡大字按原因区分

`director.js` 现在写死 `CAUGHT_TITLE`，要按 `death` 的 `reason` 换：

```js
// main.js
bus.on('death', (payload) => {
  ...
  const title = payload?.reason === 'class' ? 'WRONG' : 'CAUGHT'
  director.play('caught', { title })
})

// director.js caught 时间轴
{ at: 0.3, run: (d) => d.ui.blackout(d.opts?.title || 'CAUGHT', 'RECORDED') }
```

`lines.json` 里已加 `WRONG_TITLE`（`WRONG / 答错`），可以直接取。

### 3. 键位与鼠标

`readAnswer()` 加小键盘：

```js
const keys = [
  [['Digit1', 'Numpad1'], 1],
  [['Digit2', 'Numpad2'], 2],
  [['Digit3', 'Numpad3'], 3]
]
const hit = keys.find(([codes]) => codes.some((c) => this.input.once(c)))
```

`src/main.js` 加点击：

```js
document.querySelectorAll('#classq .opt').forEach((el) => {
  el.addEventListener('click', () => {
    if (!bits.questionOpen) return
    bits.answer(Number(el.dataset.opt))
  })
})
```

`index.html` 样式加 `#classq .opt { cursor: pointer; }`。

### 4. 测试要改

`scripts/test-bits.mjs` 里「连续答错 → 3 星 → 逐出」这条断言要改成「答错一次 → 直接死亡」。不改的话测试会红。

---

## C. 下课后自由活动（待实现）

答对后老师下课，玩家留在教室，可以走动。这一段建议做成 **30–45 秒的自由活动**，不要长，否则演示节奏拖。

### 最容易做的三个交互（按成本排）

| 交互 | 做法 | 成本 |
|---|---|---|
| **和同学聊天** | 靠近同学按 E，弹一句气泡（随机 3 选 1） | 1–2h |
| **掰手腕** | 按空格连打，双方进度条，赢了三选一 | 2–3h |
| **递纸条** | 靠近同学按 E，纸条飞过去，老师回头（无判定） | 1–2h |

推荐：**聊天（三个同学各一句）+ 掰手腕（一个同学）**。聊天负责“这教室有人”，掰手腕负责“有个小游戏”，加起来 4 小时左右，比再加一个 bit 便宜。

### 需要的数据

```json
"classmates": [
  { "id": "cm_1", "pos": [-3, 0, 1], "line": "CM_1" },
  { "id": "cm_2", "pos": [3, 0, 1], "line": "CM_2" },
  { "id": "cm_3", "pos": [0, 0, 3], "line": "CM_3" }
]
```

台词三条我先写在 `lines.json` 里（`CM_1/2/3`），等位置定了再接。

---

## D. 我这边已同步改的

- `data/lines.json`：题干与三个选项换成新版；`CLASS_ANSWER_OK` 改成 “Correct. Class dismissed.”
- `data/bits.json`：`class_sleep` 的 `threshold` 从 3 改成 1
