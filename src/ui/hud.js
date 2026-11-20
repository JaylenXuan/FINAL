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
    this.subTimer = 0
    this.starEls = [...this.starsEl.querySelectorAll('i')]
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

  update(dt) {
    if (this.subTimer > 0) {
      this.subTimer -= dt
      if (this.subTimer <= 0) this.subEl.classList.remove('show')
    }
  }
}
