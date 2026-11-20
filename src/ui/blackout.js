// 黑屏 / 选点 / 醒来遮罩。全程不弹窗口、不出鼠标，只吃键盘
export class Blackout {
  constructor() {
    this.el = document.getElementById('black')
    this.titleEl = this.el.querySelector('.title')
    this.subEl = this.el.querySelector('.sub')
    this.listEl = document.getElementById('anchors')
    this.wakeEl = document.getElementById('wake')
    this.anchors = []
    this.index = 0
    this.onConfirm = null
    this.confirmed = false
  }

  setBlack(v) {
    this.el.style.transitionDuration = '0s'
    this.el.style.opacity = String(v)
    this.el.classList.toggle('show', v > 0.5)
    // 强制回流，让下次过渡从当前值开始
    void this.el.offsetWidth
    this.el.style.transitionDuration = ''
  }

  blackout(title = '', sub = '') {
    this.titleEl.textContent = title
    this.subEl.textContent = sub
    this.el.classList.add('show')
    this.el.style.opacity = '1'
  }

  clearBlack(seconds = 0.3) {
    this.el.style.transitionDuration = `${seconds}s`
    this.el.style.opacity = '0'
    this.el.classList.remove('show')
    this.listEl.classList.remove('show')
  }

  wakeOn() {
    this.wakeEl.classList.add('show')
  }

  wakeOff() {
    this.wakeEl.classList.remove('show')
  }

  /* ---------- 选点 ---------- */
  showPicker(anchors, defaultId, onConfirm) {
    this.anchors = anchors
    this.onConfirm = onConfirm
    this.confirmed = false
    const d = anchors.findIndex((a) => a.id === defaultId)
    this.index = d >= 0 ? d : 0

    this.listEl.innerHTML = ''
    anchors.forEach((a, i) => {
      const row = document.createElement('div')
      row.className = 'row'
      row.innerHTML = `<kbd>${i + 1}</kbd><span>${a.label}</span>`
      this.listEl.appendChild(row)
    })
    this.titleEl.textContent = ''
    this.subEl.textContent = ''
    this.el.classList.add('show')
    this.el.style.opacity = '1'
    this.listEl.classList.add('show')
    this.paint()
  }

  paint() {
    ;[...this.listEl.children].forEach((row, i) => row.classList.toggle('sel', i === this.index))
  }

  move(delta) {
    if (this.confirmed) return
    this.index = (this.index + delta + this.anchors.length) % this.anchors.length
    this.paint()
  }

  pick(i) {
    if (this.confirmed || i < 0 || i >= this.anchors.length) return
    this.index = i
    this.paint()
  }

  confirm() {
    if (this.confirmed || !this.onConfirm) return
    this.confirmed = true
    this.listEl.classList.remove('show')
    this.onConfirm(this.anchors[this.index])
  }
}
