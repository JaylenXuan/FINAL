// 键盘输入：只记录状态与「本帧按下」，不做键位语义
export class Input {
  constructor() {
    this.down = new Set()
    this.pressed = new Set()
    this.enabled = true

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') e.preventDefault()
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
    })
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
