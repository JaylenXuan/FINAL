// 极简事件总线：单向通信，模块之间不直接互相 import
export class EventBus {
  constructor() {
    this.map = new Map()
  }

  on(type, fn) {
    if (!this.map.has(type)) this.map.set(type, new Set())
    this.map.get(type).add(fn)
    return () => this.off(type, fn)
  }

  off(type, fn) {
    this.map.get(type)?.delete(fn)
  }

  emit(type, payload) {
    const set = this.map.get(type)
    if (!set) return
    for (const fn of [...set]) fn(payload)
  }
}
