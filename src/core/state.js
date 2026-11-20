// 五态状态机：Boot → Play → Caught → ChooseAnchor → WakeUp → Play
export const S = {
  BOOT: 'Boot',
  PLAY: 'Play',
  CAUGHT: 'Caught',
  ANCHOR: 'ChooseAnchor',
  WAKEUP: 'WakeUp'
}

const NEXT = {
  Boot: ['Play'],
  Play: ['Caught', 'WakeUp'],
  Caught: ['ChooseAnchor'],
  ChooseAnchor: ['WakeUp'],
  WakeUp: ['Play']
}

export class GameState {
  constructor(bus) {
    this.bus = bus
    this.current = S.BOOT
    this.prev = null
    this.time = 0 // 进入当前状态后累计秒数
  }

  is(...names) {
    return names.includes(this.current)
  }

  can(next) {
    return (NEXT[this.current] || []).includes(next)
  }

  set(next) {
    if (next === this.current) return
    if (!this.can(next)) {
      console.warn(`[state] illegal transition ${this.current} -> ${next}`)
      return
    }
    this.prev = this.current
    this.current = next
    this.time = 0
    this.bus.emit('state:enter', { state: next, from: this.prev })
  }

  update(dt) {
    this.time += dt
  }
}
