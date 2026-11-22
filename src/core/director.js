// 只播三条时间轴：被抓、醒来（完整/简化）、重生淡入。不做通用过场编辑器。
const TIMELINES = {
  // 定格 0.3 + 黑屏 0.8 = 1.1s，远早于 3s 上限
  caught: {
    dur: 1.1,
    steps: [
      { at: 0, run: (d) => { d.camera.shake(0.5, 0.35); d.audio.thud() } },
      { at: 0.3, run: (d) => { d.ui.blackout(d.opts?.title || d.lines?.CAUGHT_TITLE?.en || 'CAUGHT', d.opts?.sub ?? 'RECORDED') } }
    ]
  },
  // 完整版 2.2s：全黑 → 睁一条缝 → 闭上 → 更亮 → 再眨 → 完全睁开
  wake_up_full: {
    dur: 2.2,
    steps: [
      { at: 0.0, run: (d) => { d.ui.setBlack(1); d.ui.wakeOn(); d.audio.tinnitus(2.0) } },
      { at: 0.25, run: (d) => d.ui.fadeBlack(0.72, 0.18) },
      { at: 0.55, run: (d) => d.ui.fadeBlack(1.0, 0.1) },
      { at: 0.75, run: (d) => d.ui.fadeBlack(0.42, 0.22) },
      { at: 1.1, run: (d) => d.ui.fadeBlack(0.92, 0.1) },
      { at: 1.3, run: (d) => d.ui.fadeBlack(0.0, 0.55) },
      { at: 2.05, run: (d) => { d.ui.wakeOff(); d.ui.clearBlack(0.01) } }
    ]
  },
  // 死亡选点确认：地图缩回 + 0.3s 淡入醒来（不做开场的长眨眼）
  wake_up_map: {
    dur: 0.42,
    steps: [
      { at: 0, run: (d) => { d.ui.setBlack(1); d.ui.wakeOn() } },
      { at: 0.08, run: (d) => d.ui.clearBlack(0.3) },
      { at: 0.38, run: (d) => { d.ui.wakeOff(); d.ui.clearBlack(0.02) } }
    ]
  },
  // 简化版 1.2s：只有模糊 + 耳鸣
  wake_up_light: {
    dur: 1.2,
    steps: [
      { at: 0, run: (d) => { d.ui.wakeOn(); d.ui.clearBlack(0.3); d.audio.tinnitus(1.0) } },
      { at: 0.9, run: (d) => { d.ui.wakeOff() } }
    ]
  },
  // 锚点传送用：瞬间压黑 → 0.3 淡入，不显示标题（不硬切）
  respawn: {
    dur: 0.45,
    steps: [
      { at: 0, run: (d) => { d.ui.setBlack(1) } },
      { at: 0.12, run: (d) => { d.ui.wakeOn(); d.ui.clearBlack(0.3) } },
      { at: 0.32, run: (d) => { d.ui.wakeOff() } }
    ]
  }
}

export class Director {
  constructor(deps) {
    this.deps = deps // { bus, ui, audio, camera, lines }
    this.t = 0
    this.name = null
    this.tl = null
    this.cursor = 0
  }

  get playing() {
    return this.tl !== null
  }

  play(name, opts = {}) {
    let key = name
    if (name === 'wake_up') key = opts.full === false ? 'wake_up_light' : 'wake_up_full'
    const tl = TIMELINES[key]
    if (!tl) {
      console.warn(`[director] unknown timeline ${name}`)
      return
    }
    this.name = key
    this.tl = tl
    this.t = 0
    this.cursor = 0
    this.opts = opts
    // 时间轴 step 拿到的是 deps 对象；把 opts 挂上去，caught 才能按 reason 显示 WRONG/CAUGHT
    this.deps.opts = opts
    this.deps.bus.emit('director:start', { name: key })
  }

  update(dt) {
    if (!this.tl) return
    this.t += dt
    while (this.cursor < this.tl.steps.length && this.tl.steps[this.cursor].at <= this.t) {
      this.tl.steps[this.cursor].run(this.deps)
      this.cursor++
    }
    if (this.t >= this.tl.dur) {
      const done = this.name
      this.tl = null
      this.name = null
      this.deps.bus.emit('director:done', { name: done })
    }
  }
}
