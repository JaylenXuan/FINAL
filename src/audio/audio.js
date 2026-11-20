// WebAudio 合成音：原型阶段没有任何音频素材，先保证「有反馈」
export class Audio {
  constructor() {
    this.ctx = null
    this.master = null
  }

  ensure() {
    if (this.ctx) return this.ctx
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    this.ctx = new AC()
    this.master = this.ctx.createGain()
    this.master.gain.value = 0.35
    this.master.connect(this.ctx.destination)
    return this.ctx
  }

  tone(freq, dur, type = 'sine', gain = 0.3, slideTo = null) {
    const ctx = this.ensure()
    if (!ctx) return
    if (ctx.state === 'suspended') ctx.resume()
    const t0 = ctx.currentTime
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t0)
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur)
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(g).connect(this.master)
    osc.start(t0)
    osc.stop(t0 + dur + 0.02)
  }

  select() {
    this.tone(880, 0.07, 'square', 0.12)
  }

  confirm() {
    this.tone(660, 0.09, 'triangle', 0.2)
    setTimeout(() => this.tone(990, 0.14, 'triangle', 0.18), 70)
  }

  star() {
    this.tone(520, 0.16, 'sawtooth', 0.16, 240)
  }

  alarm() {
    this.tone(740, 0.12, 'square', 0.16)
    setTimeout(() => this.tone(620, 0.16, 'square', 0.14), 130)
  }

  thud() {
    this.tone(140, 0.28, 'sine', 0.5, 60)
  }

  // 耳鸣：高频细音 + 缓慢衰减，醒来演出专用
  tinnitus(dur = 1.4) {
    const ctx = this.ensure()
    if (!ctx) return
    const t0 = ctx.currentTime
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(4200, t0)
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(0.09, t0 + 0.15)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(g).connect(this.master)
    osc.start(t0)
    osc.stop(t0 + dur + 0.05)
  }
}
