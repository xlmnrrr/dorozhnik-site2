/* ==========================================================================
   3D-сцена главного экрана: ночная трасса, самосвал Volvo FMX с горячим
   асфальтом в кузове, фонарные столбы, бегущая разметка, огни города,
   параллакс от мыши и прокрутки.
   Подключается из fx.js только на подходящих устройствах:
   - fx-full (ПК): самосвал, столбы, PBR-материалы с отражениями, фары, пар;
   - fx-lite (телефоны, планшеты): вид от первого лица — разметка и огни
     летят на зрителя, без тяжёлой геометрии.
   Контроль FPS: при просадке снижается разрешение, при повторной — последний
   кадр остаётся статичной картинкой, ресурсы GPU освобождаются, а в этой
   вкладке 3D больше не грузится.
   ========================================================================== */
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, Points, InstancedMesh, Sprite,
  BoxGeometry, CylinderGeometry, PlaneGeometry, SphereGeometry, BufferGeometry, BufferAttribute,
  MeshStandardMaterial, MeshPhysicalMaterial, MeshBasicMaterial, ShaderMaterial, SpriteMaterial,
  HemisphereLight, DirectionalLight, PointLight, SpotLight, PMREMGenerator,
  CanvasTexture, RepeatWrapping, SRGBColorSpace, ACESFilmicToneMapping,
  AdditiveBlending, NormalBlending, DoubleSide, BackSide, Vector3, Matrix4, Color
} from '../vendor/three.custom.min.js';

/* ------------------------------------------------------------------
   Шейдеры
   ------------------------------------------------------------------ */
const NOISE = /* glsl */`
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
`;

const WORLD_VS = /* glsl */`
  varying vec3 vW;
  varying float vDepth;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vec4 mv = viewMatrix * w;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

// Дорога: асфальт с зерном, разметка со сглаживанием, свечение, блики фонарей,
// пятно от фар (параметры берутся из SpotLight самосвала), тень машины, туман к горизонту
const ROAD_FS = /* glsl */`
  uniform float uOffset;
  uniform vec3 uFog;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform vec3 uTruck;
  uniform vec3 uHeadA;
  uniform vec3 uHeadB;
  uniform vec3 uHeadDir;
  uniform vec3 uSpot;
  uniform float uLampGap;
  uniform float uLampPhase;
  varying vec3 vW;
  varying float vDepth;
  ${NOISE}
  float line(float d, float hw) { float w = fwidth(d); return 1.0 - smoothstep(hw - w, hw + w, abs(d)); }
  float dash(float s, float period, float duty) {
    float t = s / period;
    float f = fract(t);
    float w = fwidth(t) * 1.5;
    return smoothstep(0.0, w, f) * (1.0 - smoothstep(duty - w, duty, f));
  }
  float softDash(float s, float period, float duty) {
    float f = fract(s / period);
    return smoothstep(0.0, 0.06, f) * (1.0 - smoothstep(duty - 0.02, duty + 0.08, f));
  }
  // Освещённость точки дороги прожектором: конус с мягким краем, закон косинуса, затухание
  float spotPool(vec3 lp) {
    vec3 L = vec3(vW.x, 0.0, vW.z) - lp;
    float d = max(length(L), 0.01);
    float cone = smoothstep(uSpot.x, uSpot.y, dot(L / d, uHeadDir));
    return cone * clamp(lp.y / d, 0.0, 1.0) / (1.0 + d * d * 0.018);
  }
  void main() {
    float x = vW.x;
    float ax = abs(x);
    float s = vW.z - uOffset;
    float near = 1.0 - smoothstep(8.0, 40.0, vDepth);

    float grain = noise(vec2(x, s) * 7.0) * 0.55 + noise(vec2(x, s) * 23.0) * 0.45;
    vec3 asphalt = vec3(0.085, 0.09, 0.1) * (0.84 + 0.32 * mix(0.5, grain, near));
    float onRoad = 1.0 - smoothstep(7.0, 7.25, ax);
    vec3 ground = vec3(0.04, 0.045, 0.05) * (0.8 + 0.4 * noise(vec2(x, s) * 0.5));
    vec3 col = mix(ground, asphalt, onRoad);

    float center = line(x, 0.09) * dash(s, 9.0, 0.45);
    float lanes = (line(x - 3.45, 0.06) + line(x + 3.45, 0.06)) * dash(s + 4.5, 9.0, 0.3);
    float edges = line(ax - 6.6, 0.08);
    col = mix(col, vec3(0.8, 0.82, 0.85), max(lanes, edges) * 0.85);
    col = mix(col, vec3(1.0, 0.76, 0.12), center);
    col += vec3(1.0, 0.68, 0.06) * exp(-x * x * 2.4) * softDash(s, 9.0, 0.45) * 0.28;

    float ls = (s - uLampPhase) / uLampGap;
    float dz = (ls - floor(ls + 0.5)) * uLampGap;
    float dxl = ax - 8.5;
    float pool = exp(-(dxl * dxl * 0.06 + dz * dz * 0.035));
    float streak = exp(-(dxl + 1.4) * (dxl + 1.4) * 1.2) * exp(-(dz - 3.0) * (dz - 3.0) * 0.025) * onRoad;
    col += vec3(1.0, 0.75, 0.4) * (pool * 0.07 + streak * 0.12);

    // фары: свет умножается на цвет покрытия — разметка в пятне вспыхивает ярче асфальта
    if (uSpot.z > 0.0) {
      float head = (spotPool(uHeadA) + spotPool(uHeadB)) * uSpot.z * (0.75 + 0.5 * grain);
      col += col * vec3(1.0, 0.93, 0.8) * head * 7.0 + vec3(1.0, 0.9, 0.72) * head * 0.035;
    }

    // мягкая тень под машиной
    vec2 dp = vec2(x - uTruck.x, vW.z - uTruck.y);
    float shadow = exp(-(dp.x * dp.x / 1.7 + dp.y * dp.y / 13.0)) * uTruck.z;
    col *= 1.0 - 0.72 * shadow;

    col = mix(col, uFog, smoothstep(uFogNear, uFogFar, vDepth));
    gl_FragColor = vec4(col, 1.0);
  }
`;

// Небо: от зарева над городом к тёмному зениту, мерцающие звёзды
// и «жидкий металл» — медленные переливы, как блики на полированной стали
const SKY_FS = /* glsl */`
  uniform float uTime;
  uniform float uMetal;
  uniform vec3 uFog;
  varying vec3 vW;
  varying float vDepth;
  ${NOISE}
  void main() {
    float h = vW.y;
    vec3 top = vec3(0.04, 0.045, 0.058);
    vec3 col = mix(uFog, top, pow(smoothstep(-2.0, 90.0, h), 0.45));
    col += vec3(0.95, 0.6, 0.15) * exp(-max(h, 0.0) * 0.06) * exp(-abs(vW.x) * 0.004) * 0.1;
    if (uMetal > 0.0) {
      vec2 q = vW.xy * vec2(0.0042, 0.0068);
      float t = uTime * 0.035;
      vec2 warp = vec2(noise(q * 3.0 + vec2(t, 0.0)), noise(q * 3.0 + vec2(4.1, t)));
      float m = noise(q * 4.0 + warp * 2.4 + vec2(t * 0.6, -t));
      float sheen = smoothstep(0.62, 0.98, 0.5 + 0.5 * sin(m * 6.0 + h * 0.012 - t * 1.4));
      vec3 tint = mix(vec3(0.34, 0.4, 0.52), vec3(1.0, 0.7, 0.3), smoothstep(0.35, 0.75, m));
      col += tint * (sheen * 0.045 + m * 0.014) * smoothstep(10.0, 60.0, h) * uMetal;
    }
    vec2 g = vW.xy * 0.35;
    float r = hash(floor(g));
    float d = length(fract(g) - 0.5);
    float star = step(0.985, r) * (1.0 - smoothstep(0.04, 0.12, d)) * smoothstep(25.0, 70.0, h);
    star *= 0.55 + 0.45 * sin(uTime * (0.8 + r * 2.5) + r * 60.0);
    col += vec3(0.85, 0.9, 1.0) * star * 0.7;
    gl_FragColor = vec4(col, 1.0);
  }
`;

// Светящиеся точки: фонари, боке, огни города, фары и маячки самосвала
const GLOW_VS = /* glsl */`
  attribute float aSize;
  attribute float aAlpha;
  attribute float aSeed;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uShift;
  uniform float uWrap;
  uniform float uNear;
  uniform float uDrift;
  uniform float uScale;
  uniform float uMaxSize;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uTwinkle;
  uniform float uGain;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec3 p = position;
    float edge = 1.0;
    if (uWrap > 0.0) {
      p.z = mod(p.z + uShift, uWrap) - uWrap + uNear;
      edge = (1.0 - smoothstep(uNear - 6.0, uNear - 1.0, p.z)) * smoothstep(uNear - uWrap, uNear - uWrap + 12.0, p.z);
    }
    p.x += sin(uTime * 0.21 + aSeed * 6.2831) * uDrift;
    p.y += cos(uTime * 0.17 + aSeed * 4.0) * uDrift * 0.6;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float depth = max(-mv.z, 0.1);
    gl_PointSize = min(aSize * uScale / depth, uMaxSize);
    gl_Position = projectionMatrix * mv;
    float fog = smoothstep(uFogNear, uFogFar, depth);
    float tw = 1.0 - uTwinkle * 0.6 * (0.5 + 0.5 * sin(uTime * (1.1 + aSeed * 2.3) + aSeed * 40.0));
    vAlpha = aAlpha * uGain * (1.0 - fog * 0.8) * tw * edge * smoothstep(0.6, 3.0, depth);
    vColor = aColor;
  }
`;
const GLOW_FS = /* glsl */`
  uniform float uCore;
  uniform float uBokeh;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float halo = pow(1.0 - d, 2.2);
    float core = 1.0 - smoothstep(0.0, uCore + 0.001, d);
    float disc = (1.0 - smoothstep(0.78, 1.0, d)) * (0.55 + 0.45 * (1.0 - d * d));
    float a = mix(halo * 0.8 + core, disc * 0.5 + halo * 0.25, uBokeh) * vAlpha;
    gl_FragColor = vec4(vColor, a);
  }
`;

// Окружение для отражений: тёмное небо, зарево у горизонта, полосы фонарей
const ENV_VS = /* glsl */`
  varying vec3 vP;
  void main() {
    vP = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const ENV_FS = /* glsl */`
  varying vec3 vP;
  void main() {
    vec3 d = normalize(vP);
    float h = d.y;
    vec3 sky = mix(vec3(0.15, 0.13, 0.11), vec3(0.03, 0.035, 0.05), smoothstep(0.0, 0.6, h));
    sky += vec3(1.0, 0.6, 0.22) * exp(-abs(h) * 9.0) * 0.4;
    vec3 ground = vec3(0.022, 0.024, 0.028);
    gl_FragColor = vec4(h < 0.0 ? mix(ground, sky, exp(h * 14.0)) : sky, 1.0);
  }
`;

/* ------------------------------------------------------------------
   Вспомогательное
   ------------------------------------------------------------------ */
function rand(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
// Остаток, всегда неотрицательный (для движения в обе стороны)
function wrap(v, m) { return ((v % m) + m) % m; }

function canvasTexture(w, h, paint, repeatX, repeatY) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d'), w, h);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  if (repeatX) {
    t.wrapS = RepeatWrapping;
    t.wrapT = RepeatWrapping;
    t.repeat.set(repeatX, repeatY || 1);
  }
  return t;
}

// Облако светящихся точек; items: [x, y, z, size, alpha, r, g, b]
function glowPoints(items, shared, params) {
  const n = items.length;
  const pos = new Float32Array(n * 3);
  const size = new Float32Array(n);
  const alpha = new Float32Array(n);
  const seed = new Float32Array(n);
  const color = new Float32Array(n * 3);
  items.forEach((it, i) => {
    pos.set([it[0], it[1], it[2]], i * 3);
    size[i] = it[3];
    alpha[i] = it[4];
    color.set([it[5], it[6], it[7]], i * 3);
    seed[i] = (i * 0.618034) % 1;
  });
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new BufferAttribute(size, 1));
  geo.setAttribute('aAlpha', new BufferAttribute(alpha, 1));
  geo.setAttribute('aSeed', new BufferAttribute(seed, 1));
  geo.setAttribute('aColor', new BufferAttribute(color, 3));
  const mat = new ShaderMaterial({
    uniforms: {
      uTime: shared.uTime,
      uScale: shared.uScale,
      uMaxSize: shared.uMaxSize,
      uFogNear: shared.uFogNear,
      uFogFar: shared.uFogFar,
      uShift: { value: 0 },
      uWrap: { value: params.wrap || 0 },
      uNear: { value: params.near || 0 },
      uDrift: { value: params.drift || 0 },
      uTwinkle: { value: params.twinkle || 0 },
      uGain: { value: params.gain === undefined ? 1 : params.gain },
      uCore: { value: params.core || 0.12 },
      uBokeh: { value: params.bokeh ? 1 : 0 }
    },
    vertexShader: GLOW_VS,
    fragmentShader: GLOW_FS,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending
  });
  const pts = new Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

/* ------------------------------------------------------------------
   Текстуры, нарисованные в коде (без загрузки картинок)
   ------------------------------------------------------------------ */
function makeTextures() {
  return {
    // протектор: поперечные грунтозацепы «ёлочкой»
    tread: canvasTexture(128, 32, (g, w, h) => {
      g.fillStyle = '#141518';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#2b2e33';
      for (let i = 0; i < 8; i++) {
        const x = i * 16;
        g.beginPath();
        g.moveTo(x + 2, 0); g.lineTo(x + 9, 0); g.lineTo(x + 14, h / 2); g.lineTo(x + 9, h); g.lineTo(x + 2, h); g.lineTo(x + 7, h / 2);
        g.closePath();
        g.fill();
      }
      g.fillStyle = 'rgba(0,0,0,.55)';
      g.fillRect(0, h / 2 - 1, w, 2);
    }, 12),
    // боковина шины с ободком
    sidewall: canvasTexture(128, 128, (g, w) => {
      const c = w / 2;
      g.fillStyle = '#121316';
      g.fillRect(0, 0, w, w);
      g.strokeStyle = '#24262b';
      g.lineWidth = 3;
      for (const r of [60, 52]) { g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.stroke(); }
    }),
    // диск: ступица, гайки, вентиляционные окна
    rim: canvasTexture(128, 128, (g, w) => {
      const c = w / 2;
      const grad = g.createRadialGradient(c, c, 4, c, c, 64);
      grad.addColorStop(0, '#d7dbe0');
      grad.addColorStop(0.55, '#a6acb4');
      grad.addColorStop(0.8, '#80868e');
      grad.addColorStop(1, '#5a5f66');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, w);
      g.fillStyle = '#17191c';
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        g.beginPath();
        g.ellipse(c + Math.cos(a) * 38, c + Math.sin(a) * 38, 7, 4.5, a, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#3a3e44';
      g.beginPath(); g.arc(c, c, 20, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#e9ecef';
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + 0.3;
        g.beginPath(); g.arc(c + Math.cos(a) * 15, c + Math.sin(a) * 15, 2.6, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = '#25282c';
      g.beginPath(); g.arc(c, c, 7, 0, Math.PI * 2); g.fill();
    }),
    // решётка радиатора: горизонтальные ламели и сетка за ними
    grille: canvasTexture(256, 128, (g, w, h) => {
      g.fillStyle = '#050608';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#1d2025';
      g.lineWidth = 1;
      for (let x = 0; x < w; x += 6) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + h * 0.4, h); g.stroke(); }
      for (let x = 0; x < w; x += 6) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + h * 0.4, 0); g.stroke(); }
      for (let y = 6; y < h; y += 14) {
        const grad = g.createLinearGradient(0, y, 0, y + 7);
        grad.addColorStop(0, '#4a4f57');
        grad.addColorStop(0.5, '#23262b');
        grad.addColorStop(1, '#0b0c0e');
        g.fillStyle = grad;
        g.fillRect(4, y, w - 8, 7);
      }
      g.strokeStyle = '#30343a';
      g.lineWidth = 6;
      g.strokeRect(3, 3, w - 6, h - 6);
    }),
    // борт кузова: панели между рёбрами жёсткости, потёртости у кромок
    ribs: canvasTexture(512, 128, (g, w, h) => {
      g.fillStyle = '#f2b705';
      g.fillRect(0, 0, w, h);
      const n = 8;
      for (let i = 0; i < n; i++) {
        const x = (i / n) * w;
        const grad = g.createLinearGradient(x, 0, x + w / n, 0);
        grad.addColorStop(0, 'rgba(0,0,0,.28)');
        grad.addColorStop(0.12, 'rgba(255,255,255,.12)');
        grad.addColorStop(0.5, 'rgba(0,0,0,0)');
        grad.addColorStop(0.9, 'rgba(0,0,0,.12)');
        grad.addColorStop(1, 'rgba(0,0,0,.3)');
        g.fillStyle = grad;
        g.fillRect(x, 0, w / n, h);
      }
      const edge = g.createLinearGradient(0, 0, 0, h);
      edge.addColorStop(0, 'rgba(0,0,0,.35)');
      edge.addColorStop(0.1, 'rgba(0,0,0,0)');
      edge.addColorStop(0.85, 'rgba(0,0,0,0)');
      edge.addColorStop(1, 'rgba(40,24,8,.45)');
      g.fillStyle = edge;
      g.fillRect(0, 0, w, h);
    }),
    // горячая смесь: тёмная корка и светящиеся трещины (карта свечения)
    hot: canvasTexture(256, 256, (g, w, h) => {
      const r = rand(77);
      g.fillStyle = '#d0560c';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 40; i++) { // тёмные остывшие пятна корки
        const x = r() * w;
        const y = r() * h;
        const grad = g.createRadialGradient(x, y, 0, x, y, 10 + r() * 26);
        grad.addColorStop(0, 'rgba(60,14,0,.7)');
        grad.addColorStop(1, 'rgba(20,6,0,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, w, h);
      }
      for (let i = 0; i < 70; i++) {
        let x = r() * w;
        let y = r() * h;
        g.strokeStyle = 'rgba(255,' + Math.round(150 + r() * 80) + ',60,' + (0.35 + r() * 0.6).toFixed(2) + ')';
        g.lineWidth = 0.8 + r() * 2.2;
        g.beginPath();
        g.moveTo(x, y);
        for (let k = 0; k < 5; k++) { x += (r() - 0.5) * 34; y += (r() - 0.5) * 34; g.lineTo(x, y); }
        g.stroke();
      }
      for (let i = 0; i < 260; i++) {
        g.fillStyle = 'rgba(255,190,80,' + (r() * 0.7).toFixed(2) + ')';
        g.fillRect(r() * w, r() * h, 2, 2);
      }
    }, 2, 2),
    // мягкое облачко пара
    puff: canvasTexture(128, 128, (g, w) => {
      const c = w / 2;
      const r = rand(5);
      for (let i = 0; i < 9; i++) {
        const x = c + (r() - 0.5) * 34;
        const y = c + (r() - 0.5) * 34;
        const grad = g.createRadialGradient(x, y, 0, x, y, 26 + r() * 22);
        grad.addColorStop(0, 'rgba(255,255,255,.6)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, w, w);
      }
    })
  };
}

/* ------------------------------------------------------------------
   Материалы — один набор на всю сцену
   ------------------------------------------------------------------ */
function makeMaterials(tex) {
  const paint = { color: 0xf2b705, metalness: 0.62, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.25 };
  return {
    paint: new MeshPhysicalMaterial(paint),
    ribs: new MeshPhysicalMaterial({ ...paint, color: 0xffffff, map: tex.ribs, metalness: 0.68, roughness: 0.34 }),
    chassis: new MeshStandardMaterial({ color: 0x1b1e23, metalness: 0.7, roughness: 0.42 }),
    plastic: new MeshStandardMaterial({ color: 0x121316, metalness: 0.2, roughness: 0.55 }),
    steel: new MeshStandardMaterial({ color: 0xb4bac2, metalness: 0.9, roughness: 0.24 }),
    chrome: new MeshStandardMaterial({ color: 0xe8ebef, metalness: 1, roughness: 0.08 }),
    bumper: new MeshStandardMaterial({ color: 0x5c626b, metalness: 0.8, roughness: 0.32 }),
    glass: new MeshPhysicalMaterial({ color: 0x0a0e13, metalness: 0.9, roughness: 0.04, clearcoat: 1, envMapIntensity: 1.6 }),
    grille: new MeshStandardMaterial({ map: tex.grille, metalness: 0.6, roughness: 0.38 }),
    tread: new MeshStandardMaterial({ map: tex.tread, metalness: 0.05, roughness: 0.92 }),
    sidewall: new MeshStandardMaterial({ map: tex.sidewall, metalness: 0.05, roughness: 0.8 }),
    rim: new MeshStandardMaterial({ map: tex.rim, metalness: 0.85, roughness: 0.3 }),
    rimEdge: new MeshStandardMaterial({ color: 0x8d939b, metalness: 0.85, roughness: 0.3 }),
    hot: new MeshStandardMaterial({
      color: 0x140a04, roughness: 1, metalness: 0, envMapIntensity: 0,
      emissive: 0xffffff, emissiveMap: tex.hot, // цвет свечения задаёт текстура emissiveIntensity: 1,
      toneMapped: false // ACES уводит яркий оранжевый в розовый — свечение выводим как есть
    }),
    lamp: new MeshBasicMaterial({ color: 0xfff4df, toneMapped: false }),
    drl: new MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
    amber: new MeshBasicMaterial({ color: 0xffa21a, toneMapped: false }),
    beacon: new MeshBasicMaterial({ color: 0xff8c1a, toneMapped: false }),
    tail: new MeshBasicMaterial({ color: 0xff2a18, toneMapped: false }),
    pole: new MeshStandardMaterial({ color: 0x3a3f47, metalness: 0.75, roughness: 0.38 }),
    poleLamp: new MeshBasicMaterial({ color: 0xfff0d6, toneMapped: false })
  };
}

/* ------------------------------------------------------------------
   Самосвал Volvo FMX 6×4 из примитивов. Перед машины смотрит в +Z (к камере).
   Возвращает корневую группу и части для анимации.
   ------------------------------------------------------------------ */
function buildDumpTruck(M) {
  const root = new Group();
  const sprung = new Group(); // всё, что на рессорах: рама, кабина, кузов
  const cab = new Group();    // кабина качается ещё и на своей подвеске
  root.add(sprung);
  sprung.add(cab);
  const geos = new Map();     // одинаковые размеры — одна геометрия
  const boxGeo = (w, h, d) => {
    const k = w + ':' + h + ':' + d;
    if (!geos.has(k)) geos.set(k, new BoxGeometry(w, h, d));
    return geos.get(k);
  };
  const cylGeo = (rt, rb, h, seg) => {
    const k = 'c' + rt + ':' + rb + ':' + h + ':' + seg;
    if (!geos.has(k)) geos.set(k, new CylinderGeometry(rt, rb, h, seg));
    return geos.get(k);
  };
  const put = (parent, geo, mat, x, y, z) => {
    const m = new Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  const box = (p, w, h, d, mat, x, y, z, rx = 0, rz = 0) => {
    const m = put(p, boxGeo(w, h, d), mat, x, y, z);
    m.rotation.set(rx, 0, rz);
    return m;
  };
  const cylY = (p, r, h, mat, x, y, z, seg = 14) => put(p, cylGeo(r, r, h, seg), mat, x, y, z);
  const cylZ = (p, r, len, mat, x, y, z, seg = 18) => {
    const m = put(p, cylGeo(r, r, len, seg), mat, x, y, z);
    m.rotation.x = Math.PI / 2;
    return m;
  };

  /* ---- колёса: передняя ось одинарная, задний тандем со спаренными шинами ---- */
  const R = 0.54;
  const wheels = [];
  const tireMat = [M.tread, M.sidewall, M.sidewall];
  const rimMat = [M.rimEdge, M.rim, M.rim];
  const wheel = (x, z, width, withRim) => {
    const g = new Group();
    g.position.set(x, R, z);
    const tire = put(g, cylGeo(R, R, width, 30), tireMat, 0, 0, 0);
    tire.rotation.z = Math.PI / 2;
    if (withRim) {
      const s = Math.sign(x);
      const rim = put(g, cylGeo(0.34, 0.34, 0.04, 24), rimMat, s * (width / 2 - 0.01), 0, 0);
      rim.rotation.z = Math.PI / 2;
    }
    root.add(g);
    wheels.push(g);
  };
  for (const s of [-1, 1]) {
    wheel(s * 1.04, 2.75, 0.4, true);
    for (const z of [-1.35, -2.75]) {
      wheel(s * 0.76, z, 0.3, false);
      wheel(s * 1.09, z, 0.3, true);
    }
  }

  /* ---- рама, баки, крылья ---- */
  for (const s of [-1, 1]) box(sprung, 0.22, 0.3, 7.6, M.chassis, s * 0.46, 0.95, -0.15);
  for (const z of [2.75, -1.35, -2.75]) cylY(sprung, 0.09, 2.0, M.chassis, 0, R, z, 8).rotation.z = Math.PI / 2;
  box(sprung, 0.55, 0.08, 1.05, M.plastic, -1.02, 1.2, 2.75);
  box(sprung, 0.55, 0.08, 1.05, M.plastic, 1.02, 1.2, 2.75);
  for (const s of [-1, 1]) {
    box(sprung, 0.78, 0.07, 2.75, M.plastic, s * 0.94, 1.22, -2.05);
    box(sprung, 0.6, 0.5, 0.03, M.plastic, s * 0.95, 0.7, -3.4); // брызговики
  }
  const tank = cylZ(sprung, 0.33, 1.25, M.steel, -1.0, 0.85, 0.7, 24); // топливный бак
  tank.scale.set(1, 1, 0.92);
  box(sprung, 0.5, 0.08, 1.1, M.chassis, -1.0, 0.5, 0.7);
  cylZ(sprung, 0.17, 0.5, M.steel, -1.0, 0.75, -0.15, 16);  // бак AdBlue
  box(sprung, 0.55, 0.5, 0.75, M.chassis, 1.0, 0.82, 0.55); // аккумуляторный ящик
  box(sprung, 0.56, 0.04, 0.76, M.steel, 1.0, 1.08, 0.55);

  /* ---- кабина ---- */
  box(cab, 2.42, 1.02, 2.12, M.paint, 0, 1.62, 2.86);     // низ кабины
  box(cab, 2.4, 1.1, 1.95, M.paint, 0, 2.66, 2.74);        // верх кабины
  box(cab, 2.44, 0.14, 1.98, M.paint, 0, 3.27, 2.72);      // крыша
  box(cab, 2.2, 0.08, 1.4, M.plastic, 0, 3.36, 2.6);       // люк и обтекатель
  box(cab, 2.16, 0.98, 0.06, M.glass, 0, 2.66, 3.76, -0.14); // лобовое стекло с наклоном
  for (const s of [-1, 1]) {
    box(cab, 0.03, 0.72, 1.25, M.glass, s * 1.215, 2.68, 2.95);   // боковое окно
    box(cab, 0.03, 0.06, 1.95, M.plastic, s * 1.22, 2.1, 2.74);  // уплотнитель
    box(cab, 0.05, 0.06, 0.24, M.chrome, s * 1.235, 2.0, 2.35);   // ручка двери
  }
  box(cab, 2.34, 0.09, 0.42, M.plastic, 0, 3.2, 3.86, 0.28);  // солнцезащитный козырёк
  for (let i = 0; i < 5; i++) box(cab, 0.1, 0.05, 0.06, M.amber, -0.5 + i * 0.25, 3.15, 4.06); // габариты
  // перед: решётка радиатора, фары, бампер
  box(cab, 1.62, 0.92, 0.05, M.grille, 0, 1.68, 3.93);
  box(cab, 1.72, 0.06, 0.07, M.plastic, 0, 2.17, 3.93);
  box(cab, 0.2, 0.06, 0.03, M.chrome, 0, 1.68, 3.97, 0, 0.6); // диагональная полоса на решётке
  for (const s of [-1, 1]) {
    box(cab, 0.4, 0.24, 0.1, M.plastic, s * 0.97, 1.2, 3.92);
    box(cab, 0.34, 0.16, 0.04, M.lamp, s * 0.97, 1.22, 3.98);
    box(cab, 0.3, 0.03, 0.03, M.drl, s * 0.98, 1.34, 3.99);
    box(cab, 0.03, 0.12, 0.03, M.drl, s * 1.12, 1.26, 3.99);
  }
  box(cab, 2.5, 0.4, 0.38, M.bumper, 0, 0.9, 3.98);        // стальной бампер
  box(cab, 1.5, 0.08, 0.62, M.steel, 0, 0.66, 3.82);       // защита картера
  box(cab, 0.62, 0.05, 0.16, M.chassis, 0, 1.08, 4.17);    // ступенька на бампере
  for (const s of [-1, 1]) {
    cylZ(cab, 0.07, 0.05, M.lamp, s * 0.82, 0.88, 4.17, 14); // противотуманные фары
    box(cab, 0.16, 0.12, 0.1, M.chassis, s * 0.38, 0.86, 4.2); // буксирные проушины
  }
  // зеркала на кронштейнах
  for (const s of [-1, 1]) {
    box(cab, 0.26, 0.04, 0.04, M.plastic, s * 1.33, 2.9, 3.45, 0, s * 0.3);
    box(cab, 0.26, 0.04, 0.04, M.plastic, s * 1.33, 2.32, 3.45, 0, -s * 0.3);
    box(cab, 0.1, 0.46, 0.2, M.plastic, s * 1.47, 2.6, 3.47);
    box(cab, 0.02, 0.4, 0.16, M.glass, s * 1.47, 2.6, 3.36);
    box(cab, 0.1, 0.2, 0.18, M.plastic, s * 1.43, 2.12, 3.62); // зеркало бордюра
  }
  // лестница за передним колесом
  for (const s of [-1, 1]) {
    for (const y of [0.42, 0.78, 1.12]) box(cab, 0.34, 0.04, 0.3, M.steel, s * 1.12, y, 1.98);
    box(cab, 0.04, 0.9, 0.06, M.chassis, s * 1.27, 0.78, 1.84);
    box(cab, 0.04, 0.9, 0.06, M.chassis, s * 1.27, 0.78, 2.12);
    cylY(cab, 0.022, 0.9, M.chrome, s * 1.24, 2.3, 1.83, 8);  // поручень
  }
  // маячки на крыше
  const beacons = [];
  for (const s of [-1, 1]) {
    cylY(cab, 0.12, 0.05, M.plastic, s * 0.82, 3.37, 2.25);
    beacons.push(cylY(cab, 0.1, 0.18, M.beacon, s * 0.82, 3.48, 2.25));
  }

  /* ---- за кабиной: выхлоп, воздухозаборник, защитный козырёк кузова ---- */
  cylY(sprung, 0.085, 2.0, M.steel, 1.02, 2.4, 1.6, 16);
  cylY(sprung, 0.12, 0.9, M.chrome, 1.02, 2.1, 1.6, 16); // теплозащитный кожух
  cylY(sprung, 0.09, 0.08, M.chassis, 1.02, 3.42, 1.6, 16);
  box(sprung, 0.3, 1.5, 0.28, M.plastic, -1.04, 2.4, 1.62);
  box(sprung, 0.36, 0.2, 0.34, M.plastic, -1.04, 3.22, 1.62);

  /* ---- самосвальный кузов ---- */
  const body = new Group();
  body.position.set(0, 1.32, -1.38);
  body.rotation.x = -0.035; // корма чуть выше — характерная посадка самосвала
  sprung.add(body);
  box(body, 1.4, 0.18, 5.4, M.chassis, 0, -0.06, 0);       // подрамник
  box(body, 2.36, 0.12, 5.5, M.ribs, 0, 0.1, 0);           // пол
  for (const s of [-1, 1]) {
    box(body, 0.08, 1.32, 5.5, M.ribs, s * 1.2, 0.76, 0, 0, s * -0.07); // борт с развалом
    for (let i = 0; i < 7; i++) box(body, 0.07, 1.3, 0.09, M.paint, s * 1.27, 0.76, -2.4 + i * 0.8, 0, s * -0.07); // рёбра
    box(body, 0.14, 0.14, 5.6, M.paint, s * 1.27, 1.44, 0);       // верхняя обвязка
    box(body, 0.12, 0.12, 5.5, M.paint, s * 1.18, 0.12, 0);       // нижняя обвязка
  }
  box(body, 2.62, 1.55, 0.1, M.paint, 0, 0.86, 2.76);       // передний борт
  box(body, 2.5, 0.08, 0.95, M.paint, 0, 1.68, 3.15, -0.12); // козырёк над кабиной
  for (const x of [-0.8, 0, 0.8]) box(body, 0.08, 1.4, 0.08, M.paint, x, 0.86, 2.83);
  box(body, 2.56, 1.3, 0.1, M.ribs, 0, 0.78, -2.78);        // задний борт
  for (const s of [-1, 1]) {
    box(body, 0.12, 0.08, 0.04, M.tail, s * 0.95, -0.28, -2.86);
    box(body, 0.06, 0.06, 0.04, M.amber, s * 1.2, 1.3, -2.86);
  }
  // горячий асфальт: плоский слой и «горка» над бортами
  box(body, 2.28, 0.06, 5.36, M.hot, 0, 1.12, 0);
  const heap = put(body, new SphereGeometry(1, 20, 10), M.hot, 0, 1.12, -0.2);
  heap.scale.set(1.08, 0.42, 2.45);
  // гидроцилиндр подъёма — между кабиной и кузовом
  const ram = cylY(sprung, 0.13, 1.15, M.steel, 0, 1.72, 1.5, 18);
  ram.rotation.x = -0.18;
  const rod = cylY(sprung, 0.075, 0.55, M.chrome, 0, 2.42, 1.4, 14);
  rod.rotation.x = -0.18;

  // задние фонари на раме
  for (const s of [-1, 1]) box(sprung, 0.3, 0.12, 0.05, M.tail, s * 0.9, 0.78, -3.82);
  box(sprung, 2.2, 0.08, 0.08, M.chassis, 0, 0.78, -3.82);

  return { root, sprung, cab, body, wheels, beacons, radius: R };
}

// Фонарные столбы вдоль дороги: 3 InstancedMesh (опора, консоль, плафон)
function buildLampPosts(M, count) {
  const pole = new CylinderGeometry(0.08, 0.13, 5.8, 8);
  pole.translate(0, 2.9, 0);
  const meshes = [
    new InstancedMesh(pole, M.pole, count),
    new InstancedMesh(new BoxGeometry(1.35, 0.08, 0.1), M.pole, count),
    new InstancedMesh(new BoxGeometry(0.6, 0.1, 0.26), M.poleLamp, count)
  ];
  meshes.forEach((m) => { m.frustumCulled = false; });
  return meshes;
}

// Карта окружения для металла и лака (без неё металлические поверхности выглядят чёрными)
function buildEnvironment(renderer) {
  const pmrem = new PMREMGenerator(renderer);
  const env = new Scene();
  const parts = [];
  const sky = new Mesh(new SphereGeometry(50, 32, 16), new ShaderMaterial({
    vertexShader: ENV_VS, fragmentShader: ENV_FS, side: BackSide, depthWrite: false
  }));
  env.add(sky);
  parts.push(sky);
  const strip = new MeshBasicMaterial({ color: new Color(7, 5.2, 3.4) }); // HDR: ярче белого
  const stripGeo = new BoxGeometry(1.2, 0.35, 3.4);
  for (let i = 0; i < 6; i++) {
    for (const s of [-1, 1]) {
      const m = new Mesh(stripGeo, strip);
      m.position.set(s * 13, 9, 24 - i * 11);
      env.add(m);
    }
  }
  const soft = new Mesh(new BoxGeometry(34, 0.4, 14), new MeshBasicMaterial({ color: new Color(0.45, 0.52, 0.7) }));
  soft.position.set(0, 28, 6);
  env.add(soft);
  const rt = pmrem.fromScene(env, 0.035);
  env.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
  pmrem.dispose();
  return rt;
}

/* ------------------------------------------------------------------
   Сцена
   ------------------------------------------------------------------ */
function start({ host, hero, stage, lite, onReady, onFail }) {
  const TRUCK = { x: 1.7, z: -10 };
  const LAMP_GAP = 14;
  const LAMP_PHASE = 12;
  const LAMPS_PER_SIDE = 12;
  const LAMP_WRAP = LAMPS_PER_SIDE * LAMP_GAP;
  const ROAD_WRAP = 1008; // кратно периодам разметки (9) и фонарей (14·12): без скачков
  const SPEED = lite ? 4.6 : 4.4;
  const DIR = lite ? 1 : -1;  // телефон: мир летит на зрителя; ПК: машина едет к камере, дорога уходит назад
  const FOG = new Vector3(0.105, 0.09, 0.075);
  const random = rand(20260527);

  const renderer = new WebGLRenderer({
    antialias: !lite,
    alpha: false,
    stencil: false,
    powerPreference: 'high-performance',
    failIfMajorPerformanceCaveat: true
  });
  renderer.setClearColor(0x111317, 1);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);

  const gl = renderer.getContext();
  const pointRange = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
  const shared = {
    uTime: { value: 0 },
    uScale: { value: 800 },
    uMaxSize: { value: Math.min(pointRange ? pointRange[1] : 64, 512) },
    uFogNear: { value: lite ? 16 : 20 },
    uFogFar: { value: lite ? 110 : 140 }
  };

  const scene = new Scene();
  const camera = new PerspectiveCamera(lite ? 52 : 40, 1, 0.1, 420);

  // дорога и грунт
  const roadMat = new ShaderMaterial({
    uniforms: {
      uOffset: { value: 0 },
      uFog: { value: FOG },
      uFogNear: shared.uFogNear,
      uFogFar: shared.uFogFar,
      uTruck: { value: new Vector3(TRUCK.x, TRUCK.z, lite ? 0 : 1) },
      // на телефоне — «свои» фары зрителя, на ПК — фары самосвала (обновляются в step)
      uHeadA: { value: new Vector3(-0.85, 0.9, 3.2) },
      uHeadB: { value: new Vector3(0.85, 0.9, 3.2) },
      uHeadDir: { value: new Vector3(0, -0.07, -1).normalize() },
      uSpot: { value: new Vector3(Math.cos(0.42), Math.cos(0.16), lite ? 0.9 : 2.4) },
      uLampGap: { value: LAMP_GAP },
      uLampPhase: { value: LAMP_PHASE }
    },
    vertexShader: WORLD_VS,
    fragmentShader: ROAD_FS,
    extensions: { derivatives: true }
  });
  const road = new Mesh(new PlaneGeometry(120, 260), roadMat);
  road.rotation.x = -Math.PI / 2;
  road.position.z = -110;
  scene.add(road);

  // небо
  const skyMat = new ShaderMaterial({
    uniforms: { uTime: shared.uTime, uFog: { value: FOG }, uMetal: { value: lite ? 0 : 1 } },
    vertexShader: WORLD_VS,
    fragmentShader: SKY_FS,
    depthWrite: false
  });
  const sky = new Mesh(new PlaneGeometry(1600, 500), skyMat);
  sky.position.set(0, 180, -245);
  scene.add(sky);

  // силуэт холмов на горизонте
  const xs = [];
  for (let x = -520; x <= 520; x += 8) xs.push(x);
  const ridgePos = new Float32Array(xs.length * 6);
  xs.forEach((x, i) => {
    const h = 5 + 6 * Math.sin(x * 0.012 + 1.1) + 3.5 * Math.sin(x * 0.041 + 0.3) + 1.8 * Math.sin(x * 0.11);
    ridgePos.set([x, -4, 0, x, Math.max(1.5, h), 0], i * 6);
  });
  const ridgeIdx = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const a = i * 2;
    ridgeIdx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const ridgeGeo = new BufferGeometry();
  ridgeGeo.setAttribute('position', new BufferAttribute(ridgePos, 3));
  ridgeGeo.setIndex(ridgeIdx);
  const ridge = new Mesh(ridgeGeo, new MeshBasicMaterial({ color: 0x08090b, toneMapped: false, side: DoubleSide }));
  ridge.position.z = -236;
  scene.add(ridge);

  // огни города у горизонта
  const city = [];
  for (let i = 0; i < (lite ? 80 : 140); i++) {
    const warm = random() > 0.2;
    city.push([(random() - 0.5) * 760, 0.3 + random() * 4.5, -233, 1.4 + random() * 1.2, 0.6 + random() * 0.35,
      warm ? 1 : 0.7, warm ? 0.78 : 0.82, warm ? 0.42 : 1]);
  }
  scene.add(glowPoints(city, shared, { twinkle: 0.8, core: 0.2 }));

  // фонари вдоль дороги — «светящиеся сферы», едут вместе с разметкой
  const lamps = [];
  for (let i = 0; i < LAMPS_PER_SIDE; i++) {
    for (const side of [-1, 1]) lamps.push([side * 8.5, 5.4, -i * LAMP_GAP, 2.6, 1, 1, 0.84, 0.58]);
  }
  const lampPts = glowPoints(lamps, shared, { wrap: LAMP_WRAP, near: LAMP_PHASE, core: 0.14 });
  scene.add(lampPts);

  // боке: крупные мягкие сферы в воздухе
  const palette = [[1, 0.72, 0.1], [1, 0.86, 0.6], [0.55, 0.7, 1]];
  const orbs = [];
  for (let i = 0; i < (lite ? 14 : 28); i++) {
    const c = palette[i % 3 === 2 && random() > 0.4 ? 2 : (random() > 0.5 ? 0 : 1)];
    orbs.push([(random() - 0.5) * 32, 1.5 + random() * 8.5, -6 - random() * 66, 0.8 + random() * 2.4, 0.18 + random() * 0.32, c[0], c[1], c[2]]);
  }
  const orbPts = glowPoints(orbs, shared, { wrap: 72, near: -4, drift: 0.6, bokeh: true });
  scene.add(orbPts);

  scene.add(new HemisphereLight(0x8a9bc0, 0x0b0c0e, lite ? 0.6 : 0.9));

  /* ---------------- самосвал, столбы, свет (только ПК) ---------------- */
  let truck = null;
  let posts = null;
  let envRT = null;
  let M = null;
  let beaconPts = null;
  let beaconLight = null;
  let hotLight = null;
  let heads = null;
  const steam = [];
  const tmpA = new Vector3();
  const tmpB = new Vector3();
  const mtx = new Matrix4();
  const beaconColor = new Color(0xff8c1a);

  if (!lite) {
    envRT = buildEnvironment(renderer);
    scene.environment = envRT.texture;
    const tex = makeTextures();
    M = makeMaterials(tex);
    M.puff = new SpriteMaterial({ map: tex.puff, color: 0xe6d8c8, transparent: true, depthWrite: false, blending: NormalBlending });

    truck = buildDumpTruck(M);
    truck.root.position.set(TRUCK.x, 0, TRUCK.z);
    scene.add(truck.root);

    // огни машины: фары, ходовые огни, противотуманки, габариты на козырьке
    const lightPts = [
      [-0.97, 1.22, 4.06, 2.4, 1, 1, 0.95, 0.84], [0.97, 1.22, 4.06, 2.4, 1, 1, 0.95, 0.84],
      [-0.98, 1.34, 4.04, 0.9, 0.8, 0.92, 0.96, 1], [0.98, 1.34, 4.04, 0.9, 0.8, 0.92, 0.96, 1],
      [-0.82, 0.88, 4.22, 1.1, 0.75, 1, 0.92, 0.75], [0.82, 0.88, 4.22, 1.1, 0.75, 1, 0.92, 0.75]
    ];
    for (let i = 0; i < 5; i++) lightPts.push([-0.5 + i * 0.25, 3.15, 4.1, 0.45, 0.8, 1, 0.62, 0.12]);
    truck.cab.add(glowPoints(lightPts, shared, { core: 0.2 }));
    beaconPts = glowPoints([[-0.82, 3.5, 2.25, 2.4, 1, 1, 0.55, 0.1], [0.82, 3.5, 2.25, 2.4, 1, 1, 0.55, 0.1]], shared, { core: 0.18, gain: 0.4 });
    truck.cab.add(beaconPts);

    // фары: настоящие SpotLight; их же положение и конус берёт шейдер дороги
    heads = [-0.97, 0.97].map((x) => {
      const spot = new SpotLight(0xfff1d6, 60, 34, 0.42, 0.62, 1.6);
      spot.position.set(x, 1.22, 4.1);
      spot.target.position.set(x * 1.4, 0, 16);
      truck.cab.add(spot, spot.target);
      return spot;
    });
    roadMat.uniforms.uSpot.value.set(Math.cos(heads[0].angle), Math.cos(heads[0].angle * (1 - heads[0].penumbra)), 2.4);

    // маячки и подсветка горячей смеси изнутри кузова
    beaconLight = new PointLight(0xff8a1e, 0, 11, 2);
    beaconLight.position.set(0, 3.7, 2.25);
    truck.cab.add(beaconLight);
    hotLight = new PointLight(0xff6a1e, 6, 6, 2);
    hotLight.position.set(0, 2.9, 0);
    truck.body.add(hotLight);

    // пар над горячим асфальтом
    for (let i = 0; i < 13; i++) {
      const sp = new Sprite(i ? M.puff.clone() : M.puff);
      sp.userData = { seed: random(), x: (random() - 0.5) * 1.7, z: (random() - 0.5) * 4.2 };
      truck.root.add(sp);
      steam.push(sp);
    }

    // столбы освещения — синхронно со светящимися фонарями
    posts = buildLampPosts(M, LAMPS_PER_SIDE * 2);
    scene.add(...posts);

    const key = new DirectionalLight(0xffd9a6, 2.2);
    key.position.set(-8, 9, 6);
    key.target.position.set(TRUCK.x, 1, TRUCK.z);
    const rim = new DirectionalLight(0x86a8ff, 2.6);
    rim.position.set(8, 6, -28);
    rim.target.position.set(TRUCK.x, 1.5, TRUCK.z);
    const fill = new PointLight(0xfff0d0, 9, 16, 2);
    fill.position.set(TRUCK.x - 3.5, 4.2, TRUCK.z + 6.5);
    scene.add(key, key.target, rim, rim.target, fill);
  }

  /* ---------------- камера и кадрирование ---------------- */
  // на компьютере — ракурс 3/4 спереди: видны кабина, решётка, кузов с горячей смесью
  const camBase = lite ? new Vector3(0, 2.5, 4) : new Vector3(-8.4, 5.1, 4.6);
  const look = lite ? new Vector3(0, 1.45, -40) : new Vector3(TRUCK.x + 0.1, 1.55, TRUCK.z + 0.2);
  const lookNow = new Vector3();
  const pointer = { x: 0, y: 0, cx: 0, cy: 0 };
  let W = 1;
  let H = 1;
  let heroH = 1;
  let quality = 1;

  function resize() {
    if (dead) return;
    const r = host.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    heroH = Math.max(1, hero ? hero.offsetHeight : H);
    let dpr = Math.min(window.devicePixelRatio || 1, (lite ? 1.25 : 1.5) * quality);
    const budget = (lite ? 1.1e6 : 2.8e6) * quality;
    if (W * H * dpr * dpr > budget) dpr = Math.sqrt(budget / (W * H));
    renderer.setPixelRatio(Math.max(0.5, dpr));
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    // главный объект — в центр «сцены» справа; на узких экранах точка схода по центру сверху
    let ax = W * 0.5;
    let ay = H * 0.34;
    if (!lite && stage) {
      const s = stage.getBoundingClientRect();
      if (s.width > 40 && s.height > 40) {
        ax = s.left - r.left + s.width / 2;
        ay = s.top - r.top + s.height * 0.56;
      }
    }
    camera.setViewOffset(W, H, W / 2 - ax, H / 2 - ay, W, H);
    camera.updateProjectionMatrix();
    shared.uScale.value = (H * renderer.getPixelRatio()) / (2 * Math.tan((camera.fov * Math.PI) / 360));
    if (!running) renderer.render(scene, camera);
  }

  /* ---------------- анимация ---------------- */
  let distance = 0;
  let intro = 0;
  let running = false;
  let frozen = false;
  let dead = false;
  let visible = true;
  let raf = 0;
  let lastTick = 0;
  let lastRender = 0;
  let tick = 0;
  let ready = false;

  function placePosts(shift) {
    for (let i = 0; i < LAMPS_PER_SIDE; i++) {
      const z = wrap(-i * LAMP_GAP + shift, LAMP_WRAP) - LAMP_WRAP + LAMP_PHASE;
      for (let k = 0; k < 2; k++) {
        const side = k ? 1 : -1;
        const n = i * 2 + k;
        posts[0].setMatrixAt(n, mtx.makeTranslation(side * 9.7, 0, z));
        posts[1].setMatrixAt(n, mtx.makeTranslation(side * 9.05, 5.76, z));
        posts[2].setMatrixAt(n, mtx.makeTranslation(side * 8.5, 5.66, z));
      }
    }
    posts.forEach((m) => { m.instanceMatrix.needsUpdate = true; });
  }

  function step(dt, t) {
    const sp = Math.min(1, Math.max(0, (window.scrollY || 0) / heroH));
    intro = Math.min(1, intro + dt / 3.2);
    const e = 1 - Math.pow(1 - intro, 3);
    const v = SPEED * (1 + sp * 1.6) * (0.35 + 0.65 * e);
    distance += v * dt;
    const travel = DIR * distance;

    shared.uTime.value = t;
    roadMat.uniforms.uOffset.value = wrap(travel, ROAD_WRAP);
    const lampShift = wrap(travel, LAMP_WRAP);
    lampPts.material.uniforms.uShift.value = lampShift;
    orbPts.material.uniforms.uShift.value = wrap(travel * 0.35, 72);

    const k = 1 - Math.exp(-dt * 2.6);
    pointer.cx += (pointer.x - pointer.cx) * k;
    pointer.cy += (pointer.y - pointer.cy) * k;
    camera.position.set(
      camBase.x + pointer.cx * 1.6 + Math.sin(t * 0.23) * 0.25,
      camBase.y - pointer.cy * 0.45 + Math.sin(t * 0.31) * 0.06 + sp * 2.4 - (1 - e) * 0.6,
      camBase.z + sp * 3.2 + (1 - e) * 6
    );
    lookNow.set(look.x, look.y - sp * 0.4, look.z);
    camera.lookAt(lookNow);

    if (!truck) return;
    // въезд из глубины кадра навстречу камере, затем движение «на месте» относительно камеры
    const tz = TRUCK.z - Math.pow(1 - e, 2) * 34;
    truck.root.position.z = tz;
    roadMat.uniforms.uTruck.value.set(TRUCK.x, tz - 0.4, 1);

    // колёса и подвеска
    const spin = distance / truck.radius;
    truck.wheels.forEach((w) => { w.rotation.x = spin; });
    const bump = Math.sin(t * 2.3) * 0.5 + Math.sin(t * 5.7 + 1.3) * 0.3 + Math.sin(t * 13.1) * 0.2;
    truck.sprung.position.y = 0.012 * bump + Math.sin(t * 31) * 0.003;
    truck.sprung.rotation.x = Math.sin(t * 1.7) * 0.004 + bump * 0.002;
    truck.sprung.rotation.z = Math.sin(t * 1.25 + 0.6) * 0.005;
    truck.cab.rotation.x = Math.sin(t * 2.1 + 0.4) * 0.006;
    truck.cab.rotation.z = Math.sin(t * 1.6 + 2.0) * 0.007;

    // маячки: два вращающихся отражателя — короткие вспышки
    const flash = Math.pow(0.5 + 0.5 * Math.sin(t * 7.5), 6);
    const flash2 = Math.pow(0.5 + 0.5 * Math.sin(t * 7.5 + Math.PI), 6);
    beaconPts.material.uniforms.uGain.value = 0.3 + Math.max(flash, flash2) * 1.1;
    beaconLight.intensity = (flash + flash2) * 9;
    M.beacon.color.copy(beaconColor).multiplyScalar(0.55 + Math.max(flash, flash2) * 0.9);
    // горячая смесь «дышит»
    const heat = 1 + 0.1 * Math.sin(t * 1.3) + 0.05 * Math.sin(t * 4.7);
    M.hot.emissiveIntensity = heat;
    hotLight.intensity = 5 + heat * 4;

    // пар: поднимается из кузова, расширяется и сносится назад встречным потоком
    for (const s of steam) {
      const d = s.userData;
      const life = (d.seed + t * 0.16) % 1;
      s.position.set(
        d.x + Math.sin(life * 4 + d.seed * 20) * 0.25,
        2.7 + life * 3.4,
        -1.38 + d.z - life * (2.2 + v * 0.35)
      );
      const sc = 0.9 + life * 2.8;
      s.scale.set(sc, sc, 1);
      s.material.opacity = Math.sin(life * Math.PI) * 0.42;
      s.material.color.setRGB(1, 0.78 + life * 0.14, 0.6 + life * 0.28); // снизу подсвечен смесью
      s.material.rotation = d.seed * 6 + life * 0.8;
    }

    // фары → шейдер дороги
    truck.root.updateMatrixWorld();
    heads[0].getWorldPosition(roadMat.uniforms.uHeadA.value);
    heads[1].getWorldPosition(roadMat.uniforms.uHeadB.value);
    heads[0].target.getWorldPosition(tmpB);
    roadMat.uniforms.uHeadDir.value.copy(tmpB.sub(heads[0].getWorldPosition(tmpA))).normalize();

    placePosts(lampShift);
  }

  function frame(now) {
    if (!running) return;
    raf = window.requestAnimationFrame(frame);
    if (lastTick) watch(now - lastTick);
    lastTick = now;
    if (dead || !running) return;
    if (lite && (tick++ & 1)) return; // на телефонах — 30 кадров в секунду
    const dt = lastRender ? Math.min((now - lastRender) / 1000, 0.1) : 0;
    lastRender = now;
    step(dt, now / 1000);
    renderer.render(scene, camera);
    if (!ready) {
      ready = true;
      host.classList.add('is-on');
      if (onReady) onReady();
    }
  }

  function sync() {
    const should = visible && !document.hidden && !frozen && !dead;
    if (should && !running) {
      running = true;
      lastTick = 0;
      lastRender = 0;
      raf = window.requestAnimationFrame(frame);
    } else if (!should && running) {
      running = false;
      window.cancelAnimationFrame(raf);
    }
  }

  /* ---------------- освобождение ресурсов ---------------- */
  function destroy() {
    if (dead) return;
    dead = true;
    sync();
    ro.disconnect();
    io.disconnect();
    document.removeEventListener('visibilitychange', sync);
    window.removeEventListener('pointermove', onPointer);
    const trash = new Set();
    scene.traverse((o) => {
      if (o.geometry) trash.add(o.geometry);
      if (o.isInstancedMesh) trash.add(o);
      (Array.isArray(o.material) ? o.material : (o.material ? [o.material] : [])).forEach((m) => {
        trash.add(m);
        Object.keys(m).forEach((key) => { if (m[key] && m[key].isTexture) trash.add(m[key]); });
      });
    });
    trash.forEach((x) => { try { x.dispose(); } catch (err) { /* уже освобождено */ } });
    if (envRT) envRT.dispose();
    renderer.dispose();
  }

  // Последний кадр — статичной картинкой вместо холста, затем GPU освобождается
  function freezeToImage() {
    let url = '';
    try {
      renderer.render(scene, camera);
      url = canvas.toDataURL('image/jpeg', 0.86);
    } catch (err) { url = ''; }
    if (!url) { destroy(); return; }
    const img = new Image();
    img.className = 'hero-snap';
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    img.onload = () => {
      host.appendChild(img);
      destroy();
      canvas.remove();
    };
    img.src = url;
  }

  /* ---------------- контроль производительности ---------------- */
  const wd = { n: 0, sum: 0, level: 0, done: false };
  function watch(ms) {
    if (wd.done || ms > 250) return; // пауза/скрытая вкладка — не показатель
    wd.n++;
    if (wd.n <= 30) return;          // разогрев: компиляция шейдеров
    wd.sum += ms;
    if (wd.n < 120) return;
    const avg = wd.sum / 89;
    wd.n = 0;
    wd.sum = 0;
    if (avg <= 24) { wd.done = true; return; }
    if (wd.level === 0) {
      wd.level = 1;
      quality = 0.6;
      resize();
      return;
    }
    wd.done = true;
    frozen = true;
    sync();
    freezeToImage();
    if (onFail) onFail('slow');
  }

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    destroy();
    host.classList.remove('is-on');
    if (onFail) onFail('lost');
  });

  function onPointer(e) {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
  }
  if (!lite) window.addEventListener('pointermove', onPointer, { passive: true });

  const ro = new ResizeObserver(() => resize());
  ro.observe(host);
  if (stage) ro.observe(stage);
  const io = new IntersectionObserver((entries) => {
    visible = entries[entries.length - 1].isIntersecting;
    sync();
  });
  io.observe(hero || host);
  document.addEventListener('visibilitychange', sync);

  if (posts) placePosts(0);
  step(0, 0);
  resize();
  sync();
}

/* Запуск — в конце модуля, когда все константы с шейдерами уже объявлены */
const opts = window.DZFX && window.DZFX.hero;
if (opts) {
  try {
    start(opts);
  } catch (err) {
    if (opts.onFail) opts.onFail('init', err);
  }
}
