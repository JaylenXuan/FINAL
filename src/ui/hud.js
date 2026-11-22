// HUD 只负责「显示」，不改任何游戏状态
export class HUD {
  constructor() {
    this.starsEl = document.getElementById('stars')
    this.zoneEl = document.getElementById('zone')
    this.subEl = document.getElementById('subtitle')
    this.subEn = this.subEl.querySelector('.en')
    this.subZh = this.subEl.querySelector('.zh')
    this.phoneEl = document.getElementById('phone')
    this.classq = document.getElementById('classq')
    this.sprintEl = document.getElementById('sprint')
    this.sprintFill = this.sprintEl.querySelector('.fill')
    this.sprintState = this.sprintEl.querySelector('.state')
    this.speedlines = document.getElementById('speedlines')
    this.introEl = document.getElementById('intro')
    this.promptEl = document.getElementById('prompt')
    this.promptLabel = this.promptEl ? this.promptEl.querySelector('.label') : null
    this._promptText = null
    this.subTimer = 0
    this.starEls = [...this.starsEl.querySelectorAll('i')]
    this._lastSprintKey = ''
    this._introTimer = 0
  }

  setStars(n) {
    this.starEls.forEach((el, i) => el.classList.toggle('on', i < n))
  }

  setZone(name) {
    this.zoneEl.textContent = name
  }

  setPhone(up) {
    this.phoneEl.classList.toggle('up', !!up)
  }

  /**
   * 冲刺能量条：能量 / 过热冷却 / 加速中三种状态。
   * 只读 player 状态，不改它。
   */
  setSprint({ stamina = 1, overheated = false, sprinting = false } = {}) {
    const pct = Math.max(0, Math.min(1, stamina))
    this.sprintFill.style.width = `${(pct * 100).toFixed(1)}%`
    this.sprintEl.classList.toggle('active', !!sprinting && !overheated)
    this.sprintEl.classList.toggle('overheat', !!overheated)
    this.speedlines.classList.toggle('on', !!sprinting && !overheated)

    const state = overheated ? '冷却中' : sprinting ? '加速中' : pct < 0.999 ? '回能中' : '就绪'
    if (state !== this._lastSprintKey) {
      this.sprintState.textContent = state
      this._lastSprintKey = state
    }
  }

  showIntro(seconds = 3.4) {
    if (!this.introEl) return
    this.introEl.classList.add('show')
    this._introTimer = seconds
  }

  hideIntro() {
    if (!this.introEl) return
    this.introEl.classList.remove('show')
    this.introEl.classList.add('hide')
  }

  // line: { en, zh }，来自 lines.json；2 秒后自动收
  subtitle(line, dur = 2) {
    if (!line) return
    this.subEn.textContent = line.en || ''
    this.subZh.textContent = line.zh || ''
    this.subEl.classList.add('show')
    this.subTimer = dur
  }

  showQuestion(on) {
    this.classq.classList.toggle('show', !!on)
  }

  /** 靠近门 / 出入口时的小提示；传空字符串隐藏 */
  setPrompt(text) {
    if (!this.promptEl) return
    const t = text || ''
    if (t === this._promptText) return
    this._promptText = t
    if (t) {
      this.promptLabel.textContent = t
      this.promptEl.classList.add('show')
    } else {
      this.promptEl.classList.remove('show')
    }
  }

  update(dt) {
    if (this.subTimer > 0) {
      this.subTimer -= dt
      if (this.subTimer <= 0) this.subEl.classList.remove('show')
    }
    if (this._introTimer > 0) {
      this._introTimer -= dt
      if (this._introTimer <= 0) this.hideIntro()
    }
  }
}
