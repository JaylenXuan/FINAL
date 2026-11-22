import * as THREE from 'three'
import { cloudTexture } from './facade.js'

/**
 * 天空：渐变穹顶 + 太阳光晕 + 几片云 + 由穹顶烘出的环境贴图
 *
 * 环境贴图是这次「看起来像真的」的关键：
 * 立面玻璃、水面、金属都能反射天空，而不是靠材质自带的灰。
 */
export function createSky(scene, renderer, opts = {}) {
  const sunDir = (opts.sunDir || new THREE.Vector3(0.62, 0.5, 0.42)).clone().normalize()

  const uniforms = {
    topColor: { value: new THREE.Color('#3f7fbf') },
    midColor: { value: new THREE.Color('#9fc2e2') },
    horColor: { value: new THREE.Color('#ece2d4') },
    sunDir: { value: sunDir }
  }

  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 topColor;
      uniform vec3 midColor;
      uniform vec3 horColor;
      uniform vec3 sunDir;
      varying vec3 vDir;

      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -1.0, 1.0);

        // 地平线 → 中天 → 天顶 三段渐变
        vec3 col = mix(horColor, midColor, smoothstep(0.0, 0.22, h));
        col = mix(col, topColor, smoothstep(0.18, 0.78, h));

        // 太阳：一个小圆盘 + 大范围暖光晕
        float sd = max(dot(d, normalize(sunDir)), 0.0);
        col += vec3(1.0, 0.86, 0.66) * pow(sd, 900.0) * 3.0;
        col += vec3(1.0, 0.78, 0.55) * pow(sd, 12.0) * 0.16;
        col += vec3(1.0, 0.7, 0.5) * pow(sd, 3.0) * 0.05;

        // 地平线以下稍微压暗，避免出现一条硬边
        col *= mix(1.0, 0.82, smoothstep(0.0, -0.14, h));

        // 轻微抖动，消除大面积渐变的色带
        float n = fract(sin(dot(d.xy, vec2(12.9898, 78.233))) * 43758.5453);
        col += (n - 0.5) * 0.006;

        gl_FragColor = vec4(col, 1.0);
      }
    `
  })

  const sky = new THREE.Mesh(new THREE.SphereGeometry(3600, 40, 24), mat)
  sky.frustumCulled = false
  sky.renderOrder = -1000
  sky.name = 'sky'
  scene.add(sky)

  /* ---------- 云 ---------- */
  const tex = cloudTexture()
  const clouds = new THREE.Group()
  clouds.name = 'clouds'
  const cloudRnd = (() => {
    let s = 1234567
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0
      return s / 4294967296
    }
  })()
  for (let i = 0; i < 9; i++) {
    const m = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      opacity: 0.34 + cloudRnd() * 0.26,
      depthWrite: false,
      fog: false,
      color: 0xffffff
    })
    const s = new THREE.Sprite(m)
    const a = cloudRnd() * Math.PI * 2
    const r = 1000 + cloudRnd() * 1700
    s.position.set(Math.cos(a) * r, 420 + cloudRnd() * 420, Math.sin(a) * r)
    const w = 620 + cloudRnd() * 700
    s.scale.set(w, w * 0.45, 1)
    clouds.add(s)
  }
  scene.add(clouds)

  /* ---------- 环境贴图：拿穹顶自己烘一张 ---------- */
  let envMap = null
  try {
    const pmrem = new THREE.PMREMGenerator(renderer)
    const envScene = new THREE.Scene()
    // 单独放一个小一号的穹顶，保证在 cube 相机的裁剪范围内
    const envSky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 20), mat)
    envScene.add(envSky)
    envMap = pmrem.fromScene(envScene, 0.02, 1, 4000).texture
    pmrem.dispose()
  } catch (err) {
    console.warn('[sky] 环境贴图生成失败，退回无反射', err)
  }

  return { sky, clouds, envMap, sunDir, uniforms }
}
