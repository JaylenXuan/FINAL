// 键盘输入：只记录状态与「本帧按下」，不做键位语义
export class Input {
  constructor() {
    this.down = new Set()
    this.pressed = new Set()
    this.enabled = true

    window.addEventListener('keydown', (e) => {
      // Tab / Space / 方向键都给浏览器留了默认行为（切焦点 / 滚动 / 翻页），必须拦掉
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault()
      if (['ShiftLeft', 'ShiftRight'].includes(e.code)) this.down.add('Shift')
      this.down.add(e.code)
      if (!e.repeat) this.pressed.add(e.code)
    })
    window.addEventListener('keyup', (e) => {
      if (['ShiftLeft', 'ShiftRight'].includes(e.code)) this.down.delete('Shift')
      this.down.delete(e.code)
    })
    window.addEventListener('blur', () => {
      this.down.clear()
      this.pressed.clear()
      this.dragging = false
    })

    /* ---------- 鼠标看视角 ----------
     * 两种都支持：按住左键拖（预览面板里最稳），或者点一下画面锁定指针（FPS 手感）。
     */
    this.mouseDX = 0
    this.mouseDY = 0
    this.dragging = false
    const canvas = document.querySelector('canvas')
    const locked = () => canvas && document.pointerLockElement === canvas

    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.dragging = true
    })
    window.addEventListener('mouseup', () => {
      this.dragging = false
    })
    window.addEventListener('mousemove', (e) => {
      if (!this.dragging && !locked()) return
      this.mouseDX += e.movementX || 0
      this.mouseDY += e.movementY || 0
    })
    if (canvas) {
      canvas.addEventListener('click', () => {
        if (!locked() && canvas.requestPointerLock) {
          try {
            canvas.requestPointerLock()
          } catch {
            /* 预览面板可能不允许，拖拽模式照样能用 */
          }
        }
      })
    }
  }

  /** 取走本帧累积的鼠标增量 */
  consumeMouse() {
    const dx = this.enabled ? this.mouseDX : 0
    const dy = this.enabled ? this.mouseDY : 0
    this.mouseDX = 0
    this.mouseDY = 0
    return { dx, dy }
  }

  isDown(code) {
    return this.enabled && this.down.has(code)
  }

  once(code) {
    return this.enabled && this.pressed.has(code)
  }

  // 移动轴：W/S 前后，A/D 左右（世界轴，-Z 为前）
  axis() {
    let x = 0
    let z = 0
    if (this.isDown('KeyW') || this.isDown('ArrowUp')) z -= 1
    if (this.isDown('KeyS') || this.isDown('ArrowDown')) z += 1
    if (this.isDown('KeyA') || this.isDown('ArrowLeft')) x -= 1
    if (this.isDown('KeyD') || this.isDown('ArrowRight')) x += 1
    const len = Math.hypot(x, z)
    if (len > 1) {
      x /= len
      z /= len
    }
    return { x, z, moving: len > 0.01, running: this.isDown('Shift') }
  }

  endFrame() {
    this.pressed.clear()
  }
}
