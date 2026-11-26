// 像素风手机：常驻右下，Tab 开关；内部有消息 / 地图 / 相机 / 音乐 / 系统五个应用。
const APPS = [
  { id: 'msg', name: 'MESSAGES', ico: '✉', badge: 3 },
  { id: 'map', name: 'MAP', ico: '▣' },
  { id: 'cam', name: 'CAMERA', ico: '◎' },
  { id: 'music', name: 'MUSIC', ico: '♪' },
  { id: 'sys', name: 'SYSTEM', ico: '⚙' }
]

const THREADS = [
  {
    id: 'roommate',
    from: 'ROOMMATE',
    time: '16:41',
    preview: '帮我带份饭，食堂 17:00 关。',
    body: '帮我带份饭，食堂 17:00 关门。\n\n—— 你室友\n16:41'
  },
  {
    id: 'library',
    from: 'LIBRARY',
    time: '16:12',
    preview: '你借的书今天到期。',
    body: '你借的书今天到期。\n逾期一天，借阅权限停一周。\n\n—— 图书馆\n16:12'
  },
  {
    id: 'club',
    from: 'CLUB',
    time: '15:58',
    preview: '18:00 报名截止，过期不候。',
    body: '社团招新 18:00 截止，过期不候。\n地点：大草坪。\n\n—— 社团联合会\n15:58'
  }
]

const TRACKS = [
  { id: 't1', name: 'CAMPUS WALK', len: '1:42' },
  { id: 't2', name: 'LIBRARY RAIN', len: '2:10' },
  { id: 't3', name: 'SUNSET LAWN', len: '1:58' }
]

export class PhoneUI {
  constructor({ onToggle = null, getStatus = null } = {}) {
    this.el = document.getElementById('phone')
    this.onToggle = onToggle
    this.getStatus = getStatus
    this.open = false
    this.app = null
    this.thread = null
    this.playing = null

    if (!this.el) return
    this.el.innerHTML = `
      <div class="p-status"><span>CAMPUS · 4G</span><span>16:47</span></div>
      <div class="p-screen"></div>
    `
    this.screen = this.el.querySelector('.p-screen')

    this.screen.addEventListener('click', (e) => this._onClick(e))
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.open) this.toggle(false)
    })
    this.render()
  }

  toggle(force) {
    if (!this.el) return
    this.open = typeof force === 'boolean' ? force : !this.open
    this.el.classList.toggle('up', this.open)
    if (!this.open) {
      this.app = null
      this.thread = null
    }
    this.render()
    if (this.onToggle) this.onToggle(this.open)
  }

  close() {
    if (this.open) this.toggle(false)
  }

  _onClick(e) {
    const back = e.target.closest('[data-back]')
    if (back) {
      if (this.thread) this.thread = null
      else this.app = null
      this.render()
      return
    }
    const app = e.target.closest('[data-app]')
    if (app) {
      this.app = app.getAttribute('data-app')
      this.thread = null
      this.render()
      return
    }
    const thread = e.target.closest('[data-thread]')
    if (thread) {
      this.thread = thread.getAttribute('data-thread')
      this.render()
      return
    }
    const track = e.target.closest('[data-track]')
    if (track) {
      const id = track.getAttribute('data-track')
      this.playing = this.playing === id ? null : id
      this.render()
    }
  }

  _status() {
    const s = this.getStatus ? this.getStatus() : null
    return s || { zone: 'outdoor', stars: 0 }
  }

  render() {
    if (!this.screen) return
    if (!this.open) {
      this.screen.innerHTML = ''
      return
    }
    if (!this.app) this.screen.innerHTML = this._home()
    else if (this.app === 'msg') this.screen.innerHTML = this._messages()
    else if (this.app === 'map') this.screen.innerHTML = this._map()
    else if (this.app === 'cam') this.screen.innerHTML = this._camera()
    else if (this.app === 'music') this.screen.innerHTML = this._music()
    else this.screen.innerHTML = this._system()
  }

  _home() {
    const tiles = APPS.map((a) => `
      <div class="p-app" data-app="${a.id}">
        ${a.badge ? `<span class="p-badge">${a.badge}</span>` : ''}
        <div class="p-ico">${a.ico}</div>
        <div class="p-name">${a.name}</div>
      </div>`).join('')
    return `
      <div class="p-title">HOME · 16:47</div>
      <div class="p-grid">${tiles}</div>
      <div class="p-note">TAB 收起 · ESC 关闭<br>做题、赶路、被抓，都别忘了看手机。</div>
    `
  }

  _messages() {
    if (this.thread) {
      const t = THREADS.find((x) => x.id === this.thread)
      return `
        <div class="p-back" data-back="1">← MESSAGES</div>
        <div class="p-title">${t.from} · ${t.time}</div>
        <div class="p-body">${t.body}</div>
      `
    }
    const rows = THREADS.map((t) => `
      <div class="p-row" data-thread="${t.id}">
        <div class="t">${t.from} <span style="color:#ffcc66">${t.time}</span></div>
        <div class="s">${t.preview}</div>
      </div>`).join('')
    return `
      <div class="p-back" data-back="1">← HOME</div>
      <div class="p-title">MESSAGES · 3</div>
      ${rows}
    `
  }

  _map() {
    const s = this._status()
    return `
      <div class="p-back" data-back="1">← HOME</div>
      <div class="p-title">MAP · CAMPUS</div>
      <div class="p-body">ZONE   ${String(s.zone || 'outdoor').toUpperCase()}
STARS  ${s.stars ?? 0} / 3

ANCHORS
01  CLASSROOM
02  CORRIDOR
03  LIBRARY
04  PLAZA</div>
      <div class="p-note">死亡后，左上角地图会接管选点。</div>
    `
  }

  _camera() {
    return `
      <div class="p-back" data-back="1">← HOME</div>
      <div class="p-title">CAMERA</div>
      <div class="p-cam"><span class="p-rec">● REC</span><i></i></div>
      <div class="p-note">按住 TAB 收起手机，画面里的取景框会留在相机里（演示用）。</div>
    `
  }

  _music() {
    const rows = TRACKS.map((t) => `
      <div class="p-row" data-track="${t.id}">
        <div class="t">${this.playing === t.id ? '❚❚' : '▶'} ${t.name}</div>
        <div class="s">${t.len}</div>
      </div>`).join('')
    return `
      <div class="p-back" data-back="1">← HOME</div>
      <div class="p-title">MUSIC · SYNTH</div>
      ${rows}
      <div class="p-note">没有音频素材，播放状态只做 UI 演示。</div>
    `
  }

  _system() {
    return `
      <div class="p-back" data-back="1">← HOME</div>
      <div class="p-title">SYSTEM</div>
      <div class="p-body">BUILD   DEV
AIE1101 · FINAL
CUHK-SHENZHEN

NON-OFFICIAL COURSEWORK</div>
      <div class="p-note">素材：three.js / VRM / 奶龙与奶蛙立牌，详见 CREDITS.md。</div>
    `
  }
}
