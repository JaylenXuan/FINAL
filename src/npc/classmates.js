import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

/**
 * 下课后留在教室的三个同学：鲸鱼娘（VRM）+ 奶龙 / 奶蛙（透明立牌兜底）。
 * 框架先接好：靠近 2m 按 E → 转向你 + 头顶气泡 + 一句字幕；走开 / 5 秒自动结束。
 * 台词从 lines.json 的 CM_1/2/3 读，内容以后替换。
 */
export class Classmates {
  constructor({ scene, data, world, player, bits, state, ui, audio, lines }) {
    this.scene = scene
    this.data = data
    this.world = world
    this.player = player
    this.bits = bits
    this.state = state
    this.ui = ui
    this.audio = audio
    this.lines = lines

    this.rooms = data.rooms || []
    this.roomById = new Map(this.rooms.map((r) => [r.id, r]))
    this.roomIds = new Set(this.rooms.map((r) => r.id))
    this.currentRoom = null
    this.origin = [100, 0, 0]
    this.list = []
    this.nearest = null
    this.talk = null
    this.talkTimer = 0
    this.bubbleEl = document.getElementById('bubble')
    this.canTalk = false
    this.vrmReady = false
    this.seatH = 0.46

    this._tmp = new THREE.Vector3()
    this._build()
    // 12MB 的 VRM 不阻塞冷启动：进教室或 5 秒后再拉
    this._whaleStarted = false
    this._whaleTimer = 0
  }

  _build() {
    const [ox, oy, oz] = this.origin
    // 三个人的座位相对房间中心固定；换教室时整组搬过去。
    // 站位从左到右：鲸鱼娘、奶蛙、奶龙，后排也留一组视觉纵深。
    const defs = [
      { id: 'cm_whale', name: '鲸鱼娘', line: 'CM_1', kind: 'vrm', pos: [-3.25, 0, -0.35] },
      { id: 'cm_nailong', name: '奶龙', line: 'CM_2', kind: 'billboard', img: '/models/billboards/nailong.png', pos: [3.25, 0, -0.35] },
      { id: 'cm_naiwa', name: '奶蛙', line: 'CM_3', kind: 'billboard', img: '/models/billboards/naiwa.png', pos: [1.65, 0, -1.25] }
    ]
    for (const d of defs) {
      const g = new THREE.Group()
      g.position.set(ox + d.pos[0], oy + d.pos[1], oz + d.pos[2])
      g.visible = false
      this.scene.add(g)
      const cm = { ...d, group: g, object: null, baseY: oy + d.pos[1], chair: null }
      cm.chair = this._chair()
      g.add(cm.chair)
      // 桌子放在人物和镜头之间，挡住腿；远看就是三个人坐在课桌前
      cm.desk = this._desk()
      g.add(cm.desk)
      if (d.kind === 'vrm') {
        cm.object = this._placeholder()
        g.add(cm.object)
      } else {
        this._billboard(cm)
      }
      this.list.push(cm)
    }
  }

  /** 简单椅子：坐面在 seatH，靠背朝 -Z，和人物朝向一起转 */
  _chair() {
    const g = new THREE.Group()
    const mat = new THREE.MeshStandardMaterial({ color: 0x3b3f45, roughness: 0.7, metalness: 0.45 })
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.07, 0.56), mat)
    seat.position.set(0, this.seatH, 0)
    seat.castShadow = true
    g.add(seat)
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.07), mat)
    back.position.set(0, this.seatH + 0.36, -0.245)
    back.castShadow = true
    g.add(back)
    for (const [x, z] of [[-0.24, -0.2], [0.24, -0.2], [-0.24, 0.2], [0.24, 0.2]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.055, this.seatH, 0.055), mat)
      leg.position.set(x, this.seatH / 2, z)
      g.add(leg)
    }
    return g
  }

  /** 小课桌：朝镜头一侧放，遮住腿，让立牌/VRM 都像坐在桌前 */
  _desk() {
    const g = new THREE.Group()
    const wood = new THREE.MeshStandardMaterial({ color: 0xcbb999, roughness: 0.9 })
    const metal = new THREE.MeshStandardMaterial({ color: 0x62656a, roughness: 0.6, metalness: 0.4 })
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.07, 0.56), wood)
    top.position.set(0, 0.74, 0.62)
    top.castShadow = true
    top.receiveShadow = true
    g.add(top)
    for (const x of [-0.48, 0.48]) {
      for (const z of [0.42, 0.82]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.72, 0.05), metal)
        leg.position.set(x, 0.36, z)
        g.add(leg)
      }
    }
    return g
  }

  _placeholder() {
    const g = new THREE.Group()
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.3, 0.9, 6, 12),
      new THREE.MeshStandardMaterial({ color: 0x5b6f8a, roughness: 0.8 })
    )
    body.position.y = 0.8
    body.castShadow = true
    g.add(body)
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 14, 12),
      new THREE.MeshStandardMaterial({ color: 0xe6c9ae, roughness: 0.9 })
    )
    head.position.y = 1.52
    head.castShadow = true
    g.add(head)
    return g
  }

  _billboard(cm) {
    const tex = new THREE.TextureLoader().load(cm.img)
    tex.colorSpace = THREE.SRGBColorSpace
    const aspect = tex.image ? tex.image.width / tex.image.height : 0.55
    const h = 1.38
    const w = Math.max(0.45, Math.min(1.3, h * aspect))
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        alphaTest: 0.08,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    )
    // 立牌底边落在椅面上，看起来是坐着而不是悬空
    mesh.position.y = this.seatH + h / 2
    mesh.castShadow = false
    cm.group.add(mesh)
    cm.object = mesh
    cm.billboard = true
  }

  async _loadWhale() {
    const cm = this.list.find((c) => c.kind === 'vrm')
    if (!cm) return
    try {
      // 动态引入：three-vrm 只在真正要加载 VRM 时才进主包
      const { VRMLoaderPlugin, VRMUtils } = await import('@pixiv/three-vrm')
      const loader = new GLTFLoader()
      loader.register((parser) => new VRMLoaderPlugin(parser))
      const gltf = await new Promise((resolve, reject) => {
        loader.load('/models/characters/deepseek-reset.vrm', resolve, undefined, reject)
      })
      const vrm = gltf.userData.vrm
      if (!vrm) throw new Error('VRM 没有 userData.vrm')
      VRMUtils.removeUnnecessaryVertices?.(gltf.scene)
      VRMUtils.combineSkeletons?.(gltf.scene)
      vrm.scene.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true
          o.receiveShadow = true
          o.frustumCulled = false
        }
      })
      // 按包围盒缩放到 1.55m，并把脚底对到 y=0
      const box = new THREE.Box3().setFromObject(vrm.scene)
      const size = box.getSize(new THREE.Vector3())
      const scale = size.y > 0.01 ? 1.55 / size.y : 1
      vrm.scene.scale.setScalar(scale)
      const box2 = new THREE.Box3().setFromObject(vrm.scene)
      vrm.scene.position.y = -box2.min.y
      vrm.scene.rotation.y = Math.PI // VRM 默认朝 +Z，先面向房间内侧
      cm.group.remove(cm.object)
      cm.object = vrm.scene
      cm.group.add(vrm.scene)
      cm.vrm = vrm
      this._seatVrm(vrm)
      this.vrmReady = true
      console.info('[classmates] 鲸鱼娘 VRM 已加载')
    } catch (err) {
      console.warn('[classmates] VRM 加载失败，保留占位小人：', err)
    }
  }

  /** 把 VRM 摆成坐姿：髋部下沉 + 大腿前伸 + 小腿垂下来 */
  _seatVrm(vrm) {
    try {
      const hips = vrm.humanoid.getNormalizedBoneNode('hips')
      if (hips) hips.position.y -= 0.26
      for (const side of ['left', 'right']) {
        const upper = vrm.humanoid.getNormalizedBoneNode(side + 'UpperLeg')
        const lower = vrm.humanoid.getNormalizedBoneNode(side + 'LowerLeg')
        if (upper) upper.rotation.x = -Math.PI / 2
        if (lower) lower.rotation.x = Math.PI / 2
      }
    } catch (err) {
      console.warn('[classmates] 坐姿骨骼调整失败：', err)
    }
  }

  /** 任意一间教室里都能聊天；答题 / 被追时禁用 */
  _refreshCanTalk() {
    this.canTalk =
      this.state.is('Play') &&
      this.roomIds.has(this.player.zone) &&
      !this.bits.questionOpen &&
      this.bits.getPhase('phone_walk') !== 'chase'
    return this.canTalk
  }

  _facePlayer(cm) {
    if (!cm.object) return
    // 只转人物本体，椅子和桌子保持不动
    const dx = this.player.pos.x - cm.group.position.x
    const dz = this.player.pos.z - cm.group.position.z
    cm.object.rotation.y = Math.atan2(dx, dz)
  }

  _faceCamera(camera) {
    for (const cm of this.list) {
      if (!cm.object) continue
      // 立牌和 VRM 都转向镜头；坐着也能看清脸
      cm.object.rotation.y =
        Math.atan2(camera.position.x - cm.group.position.x, camera.position.z - cm.group.position.z)
    }
  }

  _startTalk(cm) {
    this.talk = cm
    this.talkTimer = 5
    this._facePlayer(cm)
    this.audio.select()
    this.ui.subtitle(this.lines[cm.line], 3)
    this._bubble(`…`)
  }

  endTalk() {
    this.talk = null
    this.talkTimer = 0
    this._hideBubble()
  }

  /** E 键入口：靠近同学时开始/结束对话；返回 true 表示这次 E 已被聊天消费 */
  tryTalk() {
    if (!this._refreshCanTalk()) return false
    if (this.talk) {
      this.endTalk()
      return true
    }
    if (!this.nearest) return false
    this._startTalk(this.nearest)
    return true
  }

  promptText() {
    if (!this._refreshCanTalk()) return ''
    if (this.talk) return 'End'
    return this.nearest ? 'Talk' : ''
  }

  _bubble(text) {
    if (!this.bubbleEl) return
    this.bubbleEl.textContent = text
    this.bubbleEl.classList.add('show')
    this.bubbleShownAt = performance.now()
  }

  _hideBubble() {
    if (!this.bubbleEl) return
    this.bubbleEl.classList.remove('show')
  }

  /** 三个人共用一套模型：玩家进哪间教室，就把整组座位搬到那间教室 */
  _syncRoom() {
    const room = this.roomById.get(this.player.zone) || null
    if (room === this.currentRoom) return
    if (this.talk) this.endTalk()
    this.currentRoom = room
    for (const cm of this.list) {
      if (!room) {
        cm.group.visible = false
        continue
      }
      const [ox, oy, oz] = room.origin
      this.origin = [ox, oy, oz]
      cm.baseY = oy
      cm.group.position.set(ox + cm.pos[0], oy, oz + cm.pos[2])
      cm.group.visible = true
    }
  }

  update(dt, camera) {
    this._refreshCanTalk()
    this._syncRoom()

    this._whaleTimer += dt
    if (!this._whaleStarted && (this.roomIds.has(this.player.zone) || this._whaleTimer > 5)) {
      this._whaleStarted = true
      this._loadWhale()
    }

    const visible = !!this.currentRoom
    for (const cm of this.list) cm.group.visible = visible

    if (visible) {
      // 鲸鱼娘的 VRM 需要每帧 update（spring bone / lookAt 用）
      for (const cm of this.list) {
        if (cm.vrm) cm.vrm.update(dt)
      }
      // 轻微呼吸浮动
      const t = performance.now() / 1000
      for (const cm of this.list) {
        if (cm.group.children.length) cm.group.position.y = cm.baseY + Math.sin(t * 1.6 + cm.pos[0]) * 0.012
      }
      this._faceCamera(camera)
    }

    // 最近的同学（2m 内）
    this.nearest = null
    if (visible && this.canTalk) {
      let best = null
      let bestD = 4
      for (const cm of this.list) {
        const dx = cm.group.position.x - this.player.pos.x
        const dz = cm.group.position.z - this.player.pos.z
        const d = dx * dx + dz * dz
        if (d < bestD) {
          bestD = d
          best = cm
        }
      }
      this.nearest = best
    }

    if (this.talk) {
      this.talkTimer -= dt
      const cm = this.talk
      const dx = cm.group.position.x - this.player.pos.x
      const dz = cm.group.position.z - this.player.pos.z
      if (!this.canTalk || this.talkTimer <= 0 || dx * dx + dz * dz > 6.25) {
        this.endTalk()
      } else {
        this._facePlayer(cm)
      }
    }

    // 气泡 1.5 秒后自动收，字幕继续留到 3 秒
    if (this.talk && this.bubbleEl?.classList.contains('show') && performance.now() - this.bubbleShownAt > 1500) {
      this._hideBubble()
    }
    this._projectBubble(camera)
  }

  _projectBubble(camera) {
    const el = this.bubbleEl
    if (!el || !this.talk || !camera) return
    if (!el.classList.contains('show')) return
    const cm = this.talk
    this._tmp.set(cm.group.position.x, cm.group.position.y + 1.95, cm.group.position.z)
    this._tmp.project(camera)
    const x = (this._tmp.x * 0.5 + 0.5) * window.innerWidth
    const y = (-this._tmp.y * 0.5 + 0.5) * window.innerHeight
    el.style.left = `${x}px`
    el.style.top = `${y}px`
  }
}
