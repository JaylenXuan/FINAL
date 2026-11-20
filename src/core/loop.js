// 固定步长主循环：逻辑 60Hz，渲染按插值 alpha 走
export function createLoop({ step, render, hz = 60, maxSubSteps = 5 }) {
  const fixed = 1 / hz
  let acc = 0
  let last = performance.now()
  let raf = 0
  let running = false

  function frame(now) {
    if (!running) return
    let real = (now - last) / 1000
    last = now
    if (real > 0.25) real = 0.25 // 切标签页回来不要瞬移
    acc += real

    let steps = 0
    while (acc >= fixed && steps < maxSubSteps) {
      step(fixed)
      acc -= fixed
      steps++
    }
    if (steps === maxSubSteps) acc = 0 // 追不上就丢弃，避免死亡螺旋

    render(acc / fixed, real)
    raf = requestAnimationFrame(frame)
  }

  return {
    start() {
      if (running) return
      running = true
      last = performance.now()
      raf = requestAnimationFrame(frame)
    },
    stop() {
      running = false
      cancelAnimationFrame(raf)
    }
  }
}
