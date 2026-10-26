/* ==========================================================================
   3D-сцена главного экрана: ночная трасса, бегущая разметка, асфальтоукладчик,
   светящиеся сферы-огни, параллакс от мыши и прокрутки.
   Подключается из fx.js только на мощных устройствах. Контроль FPS:
   при просадке снижается разрешение, при повторной — сцена замирает
   на последнем кадре (статичная картинка), а в этой вкладке 3D больше не грузится.
   ========================================================================== */
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, Points,
  BoxGeometry, CylinderGeometry, PlaneGeometry, BufferGeometry, BufferAttribute,
  MeshStandardMaterial, MeshBasicMaterial, ShaderMaterial,
  HemisphereLight, DirectionalLight, PointLight,
  CanvasTexture, RepeatWrapping, SRGBColorSpace, ACESFilmicToneMapping,
  AdditiveBlending, NormalBlending, DoubleSide, Vector3
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
// тень и свежий слой за укладчиком, туман к горизонту
const ROAD_FS = /* glsl */`
  uniform float uOffset;
  uniform vec3 uFog;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform vec3 uPaver;
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

    vec2 dp = vec2(x - uPaver.x, vW.z - uPaver.y);
    float fresh = uPaver.z * (1.0 - smoothstep(1.45, 1.6, abs(dp.x))) * smoothstep(2.2, 2.6, dp.y);
    col = mix(col, vec3(0.035, 0.037, 0.042) * (0.9 + 0.2 * grain), fresh);

    float center = line(x, 0.09) * dash(s, 9.0, 0.45);
    float lanes = (line(x - 3.45, 0.06) + line(x + 3.45, 0.06)) * dash(s + 4.5, 9.0, 0.3);
    float edges = line(ax - 6.6, 0.08);
    col = mix(col, vec3(0.8, 0.82, 0.85), max(lanes, edges) * 0.85 * (1.0 - fresh));
    col = mix(col, vec3(1.0, 0.76, 0.12), center);
    col += vec3(1.0, 0.68, 0.06) * exp(-x * x * 2.4) * softDash(s, 9.0, 0.45) * 0.28;

    float ls = (s - uLampPhase) / uLampGap;
    float dz = (ls - floor(ls + 0.5)) * uLampGap;
    float dxl = ax - 8.5;
    float pool = exp(-(dxl * dxl * 0.06 + dz * dz * 0.035));
    float streak = exp(-(dxl + 1.4) * (dxl + 1.4) * 1.2) * exp(-(dz - 3.0) * (dz - 3.0) * 0.025) * onRoad;
    col += vec3(1.0, 0.75, 0.4) * (pool * 0.07 + streak * 0.12);

    float shadow = exp(-(dp.x * dp.x / 2.2 + (dp.y + 0.2) * (dp.y + 0.2) / 8.0)) * uPaver.z;
    col *= 1.0 - 0.7 * shadow;
    float work = exp(-(dp.x * dp.x / 3.5 + (dp.y - 4.0) * (dp.y - 4.0) / 10.0)) * uPaver.z;
    col += vec3(1.0, 0.9, 0.7) * work * 0.09;
    col += vec3(0.9, 0.8, 0.6) * fresh * work * 0.12;

    col = mix(col, uFog, smoothstep(uFogNear, uFogFar, vDepth));
    gl_FragColor = vec4(col, 1.0);
  }
`;

// Небо: от зарева над городом к тёмному зениту, мерцающие звёзды
const SKY_FS = /* glsl */`
  uniform float uTime;
  uniform vec3 uFog;
  varying vec3 vW;
  varying float vDepth;
  ${NOISE}
  void main() {
    float h = vW.y;
    vec3 top = vec3(0.04, 0.045, 0.058);
    vec3 col = mix(uFog, top, pow(smoothstep(-2.0, 90.0, h), 0.45));
    col += vec3(0.95, 0.6, 0.15) * exp(-max(h, 0.0) * 0.06) * exp(-abs(vW.x) * 0.004) * 0.1;
    vec2 g = vW.xy * 0.35;
    float r = hash(floor(g));
    float d = length(fract(g) - 0.5);
    float star = step(0.985, r) * (1.0 - smoothstep(0.04, 0.12, d)) * smoothstep(25.0, 70.0, h);
    star *= 0.55 + 0.45 * sin(uTime * (0.8 + r * 2.5) + r * 60.0);
    col += vec3(0.85, 0.9, 1.0) * star * 0.7;
    gl_FragColor = vec4(col, 1.0);
  }
`;

// Светящиеся точки: фонари, боке, огни города, фары укладчика
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

// Пар над свежим асфальтом
const STEAM_VS = /* glsl */`
  attribute float aSeed;
  uniform float uTime;
  uniform float uScale;
  uniform float uMaxSize;
  varying float vA;
  void main() {
    float life = fract(aSeed * 7.31 + uTime * 0.2);
    vec3 p = position;
    p.y = 0.1 + life * 2.3;
    p.z += life * 6.0;
    p.x += sin(life * 5.0 + aSeed * 30.0) * 0.3;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = min((0.8 + life * 2.2) * uScale / max(-mv.z, 0.1), uMaxSize);
    gl_Position = projectionMatrix * mv;
    vA = sin(life * 3.14159) * 0.09;
  }
`;
const STEAM_FS = /* glsl */`
  varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    gl_FragColor = vec4(0.85, 0.8, 0.74, pow(1.0 - d, 1.8) * vA);
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

function canvasTexture(w, h, paint, repeatX) {
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
    t.repeat.set(repeatX, 1);
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

// Низкополигональный асфальтоукладчик из примитивов. Перед машины — к −Z (едет от камеры)
function buildPaver(treadTex, stripeTex) {
  const g = new Group();
  const M = {
    yellow: new MeshStandardMaterial({ color: 0xf2b705, roughness: 0.42, metalness: 0.2, flatShading: true }),
    dark: new MeshStandardMaterial({ color: 0x3b4049, roughness: 0.5, metalness: 0.5, flatShading: true }),
    rubber: new MeshStandardMaterial({ color: 0x15171a, roughness: 0.95, metalness: 0.05 }),
    tread: new MeshStandardMaterial({ map: treadTex, roughness: 0.9, metalness: 0.1 }),
    steel: new MeshStandardMaterial({ color: 0x9aa1aa, roughness: 0.32, metalness: 0.9 }),
    hot: new MeshStandardMaterial({ color: 0x15110e, roughness: 0.55, metalness: 0, emissive: 0x4a1d05, emissiveIntensity: 1 }),
    stripes: new MeshStandardMaterial({ map: stripeTex, roughness: 0.5, metalness: 0.1 }),
    seat: new MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.8, metalness: 0.1 }),
    lamp: new MeshBasicMaterial({ color: 0xfff1d0, toneMapped: false }),
    tail: new MeshBasicMaterial({ color: 0xff3020, toneMapped: false }),
    screen: new MeshBasicMaterial({ color: 0x3fb6e0, toneMapped: false }),
    beacon: new MeshBasicMaterial({ color: 0xff8c1a, toneMapped: false })
  };
  const add = (geo, mat, x, y, z) => {
    const m = new Mesh(geo, mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  const box = (w, h, d, mat, x, y, z, rz = 0) => {
    const m = add(new BoxGeometry(w, h, d), mat, x, y, z);
    m.rotation.z = rz;
    return m;
  };
  const cylX = (r, len, mat, x, y, z, seg = 18) => {
    const m = add(new CylinderGeometry(r, r, len, seg), mat, x, y, z);
    m.rotation.z = Math.PI / 2;
    return m;
  };
  const cylY = (r, h, mat, x, y, z, seg = 12) => add(new CylinderGeometry(r, r, h, seg), mat, x, y, z);

  // гусеничный ход
  for (const s of [-1, 1]) {
    box(0.5, 0.62, 3.4, [M.tread, M.tread, M.rubber, M.rubber, M.rubber, M.rubber], s * 1.05, 0.31, -0.25);
    cylX(0.31, 0.5, M.rubber, s * 1.05, 0.31, -1.95);
    cylX(0.31, 0.5, M.rubber, s * 1.05, 0.31, 1.45);
    for (const z of [-1.3, -0.5, 0.3, 1.0]) cylX(0.15, 0.04, M.steel, s * 1.32, 0.26, z, 14);
  }
  // рама
  box(2.1, 0.5, 4.2, M.yellow, 0, 0.85, -0.3);
  // приёмный бункер с горячей смесью
  box(2.6, 0.08, 1.25, M.dark, 0, 0.62, -3.0);
  box(2.3, 0.32, 1.05, M.hot, 0, 0.8, -3.0);
  box(0.08, 0.78, 1.3, M.yellow, -1.33, 1.02, -3.0, 0.36);
  box(0.08, 0.78, 1.3, M.yellow, 1.33, 1.02, -3.0, -0.36);
  box(2.62, 0.34, 0.08, M.yellow, 0, 0.74, -3.66);
  // моторный отсек
  box(1.9, 0.95, 1.7, M.yellow, 0, 1.55, -1.25);
  box(1.72, 0.1, 1.5, M.yellow, 0, 2.07, -1.25);
  for (let i = 0; i < 4; i++) box(1.35, 0.03, 0.09, M.dark, 0, 2.13, -1.8 + i * 0.36);
  for (const s of [-1, 1]) box(0.02, 0.45, 1.15, M.dark, s * 0.96, 1.5, -1.25);
  cylY(0.07, 0.9, M.steel, 0.62, 2.5, -1.75);
  cylY(0.095, 0.06, M.dark, 0.62, 2.96, -1.75);
  // площадка оператора
  box(2.6, 0.12, 1.5, M.dark, 0, 1.13, 0.65);
  box(1.3, 0.55, 0.36, M.dark, 0, 1.46, 0.2);
  box(0.36, 0.14, 0.02, M.screen, 0, 1.6, 0.39);
  for (const s of [-1, 1]) {
    box(0.18, 0.28, 0.18, M.dark, s * 0.62, 1.33, 0.95);
    box(0.5, 0.12, 0.5, M.seat, s * 0.62, 1.52, 0.95);
    box(0.5, 0.55, 0.1, M.seat, s * 0.62, 1.82, 1.18);
    box(0.36, 0.42, 0.3, M.dark, s * 1.12, 1.4, 1.3);
  }
  // навес с рабочими фарами и маячком
  for (const sx of [-1, 1]) for (const z of [0.08, 1.32]) cylY(0.045, 1.45, M.dark, sx * 1.15, 1.92, z, 8);
  box(2.72, 0.1, 1.8, M.dark, 0, 2.66, 0.7);
  box(2.76, 0.06, 1.84, M.yellow, 0, 2.59, 0.7);
  box(0.16, 0.1, 0.06, M.lamp, -1.05, 2.5, 1.62);
  box(0.16, 0.1, 0.06, M.lamp, 1.05, 2.5, 1.62);
  cylY(0.1, 0.16, M.beacon, 0.95, 2.79, 0.25, 14);
  // шнек и выглаживающая плита
  cylX(0.17, 3.0, M.steel, 0, 0.3, 1.5, 16);
  box(3.3, 0.42, 0.7, M.yellow, 0, 0.36, 2.05);
  box(3.3, 0.06, 0.82, M.dark, 0, 0.6, 2.05);
  for (const s of [-1, 1]) box(0.06, 0.64, 0.95, M.dark, s * 1.68, 0.38, 2.05);
  box(3.0, 0.05, 0.38, M.dark, 0, 0.72, 2.6);
  box(3.1, 0.16, 0.02, M.stripes, 0, 0.36, 2.415);
  box(0.12, 0.08, 0.02, M.tail, -1.45, 0.5, 2.435);
  box(0.12, 0.08, 0.02, M.tail, 1.45, 0.5, 2.435);
  return g;
}

/* ------------------------------------------------------------------
   Сцена
   ------------------------------------------------------------------ */
function start({ host, hero, stage, lite, onReady, onFail }) {
  const PAVER = { x: 1.8, z: -10 };
  const LAMP_GAP = 14;
  const LAMP_PHASE = 12;
  const LAMPS_PER_SIDE = lite ? 12 : 18;
  const LAMP_WRAP = LAMPS_PER_SIDE * LAMP_GAP;
  const ROAD_WRAP = 1008; // кратно периодам разметки (9) и фонарей (14·12, 14·18): без скачков
  const SPEED = lite ? 4.6 : 4.2;
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
      uPaver: { value: new Vector3(PAVER.x, PAVER.z, lite ? 0 : 1) },
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
  const sky = new Mesh(new PlaneGeometry(1600, 500), new ShaderMaterial({
    uniforms: { uTime: shared.uTime, uFog: { value: FOG } },
    vertexShader: WORLD_VS,
    fragmentShader: SKY_FS,
    depthWrite: false
  }));
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
  const cityPts = glowPoints(city, shared, { twinkle: 0.8, core: 0.2 });
  scene.add(cityPts);

  // фонари вдоль дороги — «светящиеся сферы», едут навстречу вместе с разметкой
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

  let paver = null;
  let beaconPts = null;
  let beaconLight = null;
  let treadTex = null;
  let steam = null;
  scene.add(new HemisphereLight(0x8a9bc0, 0x0b0c0e, lite ? 0.6 : 1.0));

  if (!lite) {
    treadTex = canvasTexture(64, 16, (g, w, h) => {
      g.fillStyle = '#16181b';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#2d3137';
      for (let i = 0; i < 8; i++) g.fillRect(i * 8 + 1, 0, 4, h);
    }, 5);
    const stripeTex = canvasTexture(128, 16, (g, w, h) => {
      g.fillStyle = '#f2b705';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#111317';
      for (let x = -16; x < w + 16; x += 16) {
        g.beginPath();
        g.moveTo(x, h);
        g.lineTo(x + 8, h);
        g.lineTo(x + 16, 0);
        g.lineTo(x + 8, 0);
        g.closePath();
        g.fill();
      }
    });
    paver = buildPaver(treadTex, stripeTex);
    paver.position.set(PAVER.x, 0, PAVER.z);
    scene.add(paver);

    // огни укладчика: рабочие фары, стоп-сигналы, экран пульта
    paver.add(glowPoints([
      [-1.05, 2.5, 1.68, 1.5, 0.9, 1, 0.93, 0.78],
      [1.05, 2.5, 1.68, 1.5, 0.9, 1, 0.93, 0.78],
      [-1.45, 0.5, 2.47, 0.8, 0.9, 1, 0.2, 0.12],
      [1.45, 0.5, 2.47, 0.8, 0.9, 1, 0.2, 0.12],
      [0, 1.6, 0.42, 0.35, 0.35, 0.4, 0.88, 1]
    ], shared, { core: 0.2 }));
    beaconPts = glowPoints([[0.95, 2.82, 0.25, 2.6, 1, 1, 0.55, 0.1]], shared, { core: 0.18, gain: 0.4 });
    paver.add(beaconPts);

    const key = new DirectionalLight(0xffd9a6, 2.3);
    key.position.set(-7, 9, 7);
    key.target.position.set(PAVER.x, 0, PAVER.z);
    const rim = new DirectionalLight(0x86a8ff, 2.8);
    rim.position.set(7, 6, -26);
    rim.target.position.set(PAVER.x, 1, PAVER.z);
    const work = new PointLight(0xfff0d0, 10, 14, 2);
    work.position.set(PAVER.x, 2.4, PAVER.z + 2.4);
    beaconLight = new PointLight(0xff8a1e, 0, 10, 2);
    beaconLight.position.set(PAVER.x + 0.95, 3.0, PAVER.z + 0.25);
    scene.add(key, key.target, rim, rim.target, work, beaconLight);

    // пар над свежим слоем
    const n = 70;
    const sp = new Float32Array(n * 3);
    const ss = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      sp.set([PAVER.x + (random() - 0.5) * 2.8, 0, PAVER.z + 2.5 + random() * 6.5], i * 3);
      ss[i] = random();
    }
    const steamGeo = new BufferGeometry();
    steamGeo.setAttribute('position', new BufferAttribute(sp, 3));
    steamGeo.setAttribute('aSeed', new BufferAttribute(ss, 1));
    steam = new Points(steamGeo, new ShaderMaterial({
      uniforms: { uTime: shared.uTime, uScale: shared.uScale, uMaxSize: shared.uMaxSize },
      vertexShader: STEAM_VS,
      fragmentShader: STEAM_FS,
      transparent: true,
      depthWrite: false,
      blending: NormalBlending
    }));
    steam.frustumCulled = false;
    scene.add(steam);
  }

  /* ---------------- камера и кадрирование ---------------- */
  // на компьютере — ракурс 3/4 сбоку-сзади: видны бункер, мотор, навес и плита
  const camBase = lite ? new Vector3(0, 2.5, 4) : new Vector3(-6.2, 3.7, 1.2);
  const look = lite ? new Vector3(0, 1.45, -40) : new Vector3(PAVER.x + 0.3, 1.05, PAVER.z - 0.6);
  const lookNow = new Vector3();
  const pointer = { x: 0, y: 0, cx: 0, cy: 0 };
  let W = 1;
  let H = 1;
  let heroH = 1;
  let quality = 1;

  function resize() {
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
    if (!running && !dead) renderer.render(scene, camera);
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

  function step(dt, t) {
    const sp = Math.min(1, Math.max(0, (window.scrollY || 0) / heroH));
    intro = Math.min(1, intro + dt / 2.8);
    const e = 1 - Math.pow(1 - intro, 3);
    distance += SPEED * (1 + sp * 1.6) * (0.35 + 0.65 * e) * dt;

    shared.uTime.value = t;
    roadMat.uniforms.uOffset.value = distance % ROAD_WRAP;
    lampPts.material.uniforms.uShift.value = distance % LAMP_WRAP;
    orbPts.material.uniforms.uShift.value = (distance * 0.35) % 72;

    const k = 1 - Math.exp(-dt * 2.6);
    pointer.cx += (pointer.x - pointer.cx) * k;
    pointer.cy += (pointer.y - pointer.cy) * k;
    camera.position.set(
      camBase.x + pointer.cx * 1.6 + Math.sin(t * 0.23) * 0.25,
      camBase.y - pointer.cy * 0.45 + Math.sin(t * 0.31) * 0.06 + sp * 2.4 - (1 - e) * 0.7,
      camBase.z + sp * 3.2 + (1 - e) * 7.5
    );
    lookNow.set(look.x, look.y - sp * 0.4, look.z);
    camera.lookAt(lookNow);

    if (paver) {
      paver.position.y = Math.sin(t * 33) * 0.008;
      treadTex.offset.x = (distance * 5 / 3.4) % 1;
      const flash = Math.pow(0.5 + 0.5 * Math.sin(t * 7), 6);
      beaconPts.material.uniforms.uGain.value = 0.3 + flash * 1.1;
      beaconLight.intensity = flash * 7;
    }
  }

  function frame(now) {
    if (!running) return;
    raf = window.requestAnimationFrame(frame);
    if (lastTick) watch(now - lastTick);
    lastTick = now;
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
    frozen = true;
    sync();
    if (onFail) onFail('slow');
  }

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    dead = true;
    sync();
    host.classList.remove('is-on');
    if (onFail) onFail('lost');
  });

  if (!lite) {
    window.addEventListener('pointermove', (e) => {
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
    }, { passive: true });
  }

  const ro = new ResizeObserver(() => resize());
  ro.observe(host);
  if (stage) ro.observe(stage);
  const io = new IntersectionObserver((entries) => {
    visible = entries[entries.length - 1].isIntersecting;
    sync();
  });
  io.observe(hero || host);
  document.addEventListener('visibilitychange', sync);

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
