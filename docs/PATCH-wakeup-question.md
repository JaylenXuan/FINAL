# 补丁：醒来眨眼 + 课堂答题可交互

> 两个问题分开改，都在 Partner 侧文件里，照抄即可。
> 我这边只改了 `data/lines.json` 的题干与选项。

---

## A. 醒来眨眼

现在的 `wake_up_full` 只有「黑幕淡出 + 模糊」，一共 2.0 秒，所以看起来像直接睁眼。

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

### 1. `src/ui/blackout.js` 加一个方法

```js
// 带过渡地改黑幕透明度；和 setBlack 的区别是不打断 CSS 过渡
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

### 3. 验收

- 进游戏先全黑约 0.25 秒，然后亮一条缝
- 亮 → 暗 → 更亮，至少两次眨眼
- 2 秒后画面完全清楚，老师站在桌前

---

## B. 课堂答题可交互

现在大概率有两个问题：

1. 只认主键盘的 `Digit1/2/3`，小键盘和鼠标点击都不响应
2. 题目是「老师刚问了什么」，玩家没上下文，只能瞎选

### 1. 换一道不需要上下文的题

`index.html` 里替换 `#classq` 的卡片：

```html
<div id="classq">
  <div class="card">
    <div class="q">What is 12 × 12?</div>
    <div class="opt" data-opt="1"><kbd>1</kbd><span>124</span></div>
    <div class="opt" data-opt="2"><kbd>2</kbd><span>144</span></div>
    <div class="opt" data-opt="3"><kbd>3</kbd><span>154</span></div>
  </div>
</div>
```

正确项改成第 2 个。

### 2. `src/bits/bits.js`：正确答案改 2，键位加小键盘

```js
const correct = 2

readAnswer() {
  const keys = [
    [['Digit1', 'Numpad1'], 1],
    [['Digit2', 'Numpad2'], 2],
    [['Digit3', 'Numpad3'], 3]
  ]
  const hit = keys.find(([codes]) => codes.some((c) => this.input.once(c)))
  if (!hit) return
  this.answer(hit[1])
}
```

### 3. `src/main.js`：选项可点击

在 `bits` 创建之后加：

```js
document.querySelectorAll('#classq .opt').forEach((el) => {
  el.addEventListener('click', () => {
    if (!bits.questionOpen) return
    bits.answer(Number(el.dataset.opt))
  })
})
```

顺手给选项加个手型光标（`index.html` 的样式里）：

```css
#classq .opt { cursor: pointer; }
```

### 4. 验收

- 题目出现后，主键盘 1/2/3、小键盘 1/2/3、鼠标点击都能答
- 选 2 正确，字幕「Sit down. Pay attention.」，不扣星
- 选 1 或 3 错误，星 +1，字幕「Wrong. Again.」
- 连错 3 次，被请出教室，黑屏

---

## C. 我这边同步改的

`data/lines.json` 已更新（等接线后生效）：

```json
"CLASS_Q":     { "en": "What is 12 × 12?", "zh": "12 × 12 等于多少？" },
"CLASS_OPT_1": { "en": "124", "zh": "124" },
"CLASS_OPT_2": { "en": "144", "zh": "144" },
"CLASS_OPT_3": { "en": "154", "zh": "154" }
```
