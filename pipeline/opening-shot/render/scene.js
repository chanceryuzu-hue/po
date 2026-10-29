import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import {
  MAX_SEAM, MAX_SEG, armorFrag, armorVert, bgFrag, dustFrag, dustVert, finalFrag, fsVert, seamFrag, seamVert,
} from './shaders.js';
import { FPS, shotState } from './timeline.js';

const params = new URLSearchParams(location.search);
const W = Number(params.get('w') || 1920);
const H = Number(params.get('h') || 1080);
const MSAA = Number(params.get('msaa') || 4);

const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.setClearColor(0x000000, 1);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(25, W / H, 0.05, 30);

/* -------------------------------------------------------------- lights --- */
// Rectangular area lights: centre, half-width vector, half-height vector.
function rectFacing(center, target, halfW, halfH) {
  const c = new THREE.Vector3(...center);
  const n = new THREE.Vector3(...target).sub(c).normalize();
  const upRef = Math.abs(n.y) > 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(upRef, n).normalize();
  const w = new THREE.Vector3().crossVectors(n, u).normalize();
  return { c, u: u.multiplyScalar(halfW), w: w.multiplyScalar(halfH) };
}

const manifest = await (await fetch('./assets/model.json')).json();
const bin = await (await fetch('./assets/model.bin')).arrayBuffer();
const LIGHTS = manifest.lights;

const key = rectFacing(LIGHTS.key, [0, 0.15, 0], 0.95, 0.5);
const rimR = rectFacing(LIGHTS.rimR, [0, 0.12, 0], 0.16, 0.95);
const rimL = rectFacing(LIGHTS.rimL, [0, 0.12, 0], 0.16, 0.95);

const fill = rectFacing([0, 0.55, 2.6], [0, 0.18, 0], 2.3, 0.95);
const top = rectFacing([0, 1.25, -1.15], [0, 0.3, 0], 0.55, 0.12);
const FILL_COL = new THREE.Vector3(0.82, 0.9, 1.0);
const KEY_COL = new THREE.Vector3(1.0, 0.95, 0.88);
const RIM_COL = new THREE.Vector3(1.0, 0.055, 0.03);
const SEAM_COL = new THREE.Vector3(0.78, 0.93, 1.0);
const LOOK = {
  keyRad: Number(params.get('key') || 5),
  fillRad: Number(params.get('fill') || 0.42),
  topRad: Number(params.get('top') || 3.5),
  rimRad: Number(params.get('rim') || 10.5),
  seamI: Number(params.get('seam') || 0.14),
  seamSpec: Number(params.get('seamSpec') || 1),
  seamGlow: Number(params.get('glow') || 6),
  amb: Number(params.get('amb') || 1.4),
  exposure: Number(params.get('exp') || 1.0),
};

/* --------------------------------------------------------------- seams --- */
const seamOrder = ['brow', 'neck', 'sternum'];
const segA = Array.from({ length: MAX_SEG }, () => new THREE.Vector4());
const segB = Array.from({ length: MAX_SEG }, () => new THREE.Vector4());
let segCount = 0;
const seamStates = Array.from({ length: MAX_SEAM }, () => new THREE.Vector4());
for (const seam of manifest.seams) {
  const id = seamOrder.indexOf(seam.name);
  const pts = seam.pts;
  const step = 2;
  for (let i = 0; i + step < pts.length + step - 1; i += step) {
    const a = pts[i];
    const b = pts[Math.min(i + step, pts.length - 1)];
    if (a === b) break;
    segA[segCount].set(a.p[0], a.p[1], a.p[2], a.s);
    segB[segCount].set(b.p[0], b.p[1], b.p[2], b.s + 2 * id);
    segCount++;
  }
}

const shared = {
  uKeyC: { value: key.c }, uKeyU: { value: key.u }, uKeyW: { value: key.w }, uKeyRad: { value: new THREE.Vector3() },
  uRimRC: { value: rimR.c }, uRimRU: { value: rimR.u }, uRimRW: { value: rimR.w }, uRimRRad: { value: new THREE.Vector3() },
  uRimLC: { value: rimL.c }, uRimLU: { value: rimL.u }, uRimLW: { value: rimL.w }, uRimLRad: { value: new THREE.Vector3() },
  uTopC: { value: top.c }, uTopU: { value: top.u }, uTopW: { value: top.w }, uTopRad: { value: new THREE.Vector3() },
  uFillC: { value: fill.c }, uFillU: { value: fill.u }, uFillW: { value: fill.w }, uFillRad: { value: new THREE.Vector3() },
  uRimFloor: { value: -0.27 },
  uSegA: { value: segA },
  uSegB: { value: segB },
  uSegCount: { value: segCount },
  uSeam: { value: seamStates },
  uSeamColor: { value: SEAM_COL },
  uSeamSpec: { value: LOOK.seamSpec },
  uAmb: { value: 0 },
  uAmbTint: { value: new THREE.Vector3(1, 1, 1) },
};

const MATS = {
  0: { uF0: [0.13, 0.135, 0.145], uDiffuse: [0, 0, 0], uRough: 0.34, uAniso: 0.55, uStreak: 1.0, uEdge: 1.0 }, // graphite
  1: { uF0: [0.42, 0.42, 0.43], uDiffuse: [0, 0, 0], uRough: 0.27, uAniso: 0.4, uStreak: 0.8, uEdge: 0.8 }, // platinum
  2: { uF0: [0.06, 0.065, 0.07], uDiffuse: [0, 0, 0], uRough: 0.075, uAniso: 0.0, uStreak: 0.0, uEdge: 0.0 }, // visor
  3: { uF0: [0.03, 0.03, 0.03], uDiffuse: [0.014, 0.014, 0.015], uRough: 0.58, uAniso: 0.0, uStreak: 0.0, uEdge: 0.0 }, // undersuit
};
const materials = {};
for (const [id, m] of Object.entries(MATS)) {
  const u = { ...shared };
  for (const [k, v] of Object.entries(m)) u[k] = { value: Array.isArray(v) ? new THREE.Vector3(...v) : v };
  materials[id] = new THREE.ShaderMaterial({ vertexShader: armorVert, fragmentShader: armorFrag, uniforms: u });
}

const view = (arr, Type) => new Type(bin, arr[0], arr[1]);
const bust = new THREE.Group();
for (const part of manifest.parts) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(view(part.position, Float32Array), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(view(part.normal, Int16Array), 3, true));
  g.setAttribute('aTangent', new THREE.BufferAttribute(view(part.tangent, Int8Array), 3, true));
  g.setAttribute('aBake', new THREE.BufferAttribute(view(part.bake, Uint8Array), 4, true));
  g.setAttribute('aCurv', new THREE.BufferAttribute(view(part.curv, Int8Array), 1, true));
  g.setIndex(new THREE.BufferAttribute(view(part.index, Uint32Array), 1));
  const mesh = new THREE.Mesh(g, materials[part.mat]);
  mesh.name = part.name;
  mesh.renderOrder = part.core ? 1 : 0;
  bust.add(mesh);
}
scene.add(bust);

// glowing seam tubes
const seamMats = {};
for (const seam of manifest.seams) {
  const pts = seam.pts.map((q) => new THREE.Vector3(...q.p));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const tub = pts.length * 8;
  const rad = 10;
  const geo = new THREE.TubeGeometry(curve, tub, seam.radius, rad, false);
  const sAttr = new Float32Array((tub + 1) * (rad + 1));
  for (let i = 0; i <= tub; i++) {
    const tt = curve.getUtoTmapping(i / tub);
    const f = tt * (pts.length - 1);
    const i0 = Math.min(pts.length - 2, Math.floor(f));
    const s = seam.pts[i0].s + (seam.pts[i0 + 1].s - seam.pts[i0].s) * (f - i0);
    for (let j = 0; j <= rad; j++) sAttr[i * (rad + 1) + j] = s;
  }
  geo.setAttribute('aS', new THREE.BufferAttribute(sAttr, 1));
  const mat = new THREE.ShaderMaterial({
    vertexShader: seamVert,
    fragmentShader: seamFrag,
    uniforms: { uState: { value: new THREE.Vector4() }, uColor: { value: SEAM_COL } },
  });
  seamMats[seam.name] = mat;
  scene.add(new THREE.Mesh(geo, mat));
}

/* ---------------------------------------------------------- background --- */
const bgMat = new THREE.ShaderMaterial({
  vertexShader: fsVert,
  fragmentShader: bgFrag,
  depthTest: false,
  depthWrite: false,
  uniforms: {
    uRes: { value: new THREE.Vector2(W, H) },
    uTime: { value: 0 },
    uRimR: { value: 0 },
    uRimL: { value: 0 },
    uKey: { value: 0 },
    uHead: { value: new THREE.Vector2(0.5, 0.6) },
    uScale: { value: 0.5 },
  },
});
const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMat);
bg.frustumCulled = false;
bg.renderOrder = -10;
scene.add(bg);

/* ----------------------------------------------------------- particles --- */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const R = rng(7);
const NDUST = 1400;
const dPos = new Float32Array(NDUST * 3);
const dSeed = new Float32Array(NDUST * 4);
for (let i = 0; i < NDUST; i++) {
  dPos[3 * i] = (R() - 0.5) * 2.8;
  dPos[3 * i + 1] = -0.75 + R() * 1.7;
  dPos[3 * i + 2] = -1.6 + R() * 3.0;
  dSeed.set([R(), R(), R(), R()], 4 * i);
}
const dGeo = new THREE.BufferGeometry();
dGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
dGeo.setAttribute('aSeed', new THREE.BufferAttribute(dSeed, 4));
const fNumber = 2.2;
const sensorH = 0.02025; // 36 x 20.25 mm
const dustMat = new THREE.ShaderMaterial({
  vertexShader: dustVert,
  fragmentShader: dustFrag,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: {
    uTime: { value: 0 },
    uPx: { value: 1 },
    uFocus: { value: 2.0 },
    uRimR: { value: 0 },
    uRimL: { value: 0 },
    uKey: { value: 0 },
    uSeamGlow: { value: 0 },
    uRimRC: { value: rimR.c },
    uRimLC: { value: rimL.c },
  },
});
const dust = new THREE.Points(dGeo, dustMat);
dust.frustumCulled = false;
dust.renderOrder = 5;
scene.add(dust);

/* ---------------------------------------------------------- post chain --- */
const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: MSAA });
const composer = new EffectComposer(renderer, rt);
composer.setPixelRatio(1);
composer.setSize(W, H);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.55, 0.65, 1.6);
bloom.bloomTintColors = [
  new THREE.Vector3(1, 1, 1),
  new THREE.Vector3(1, 1, 1),
  new THREE.Vector3(1, 0.97, 0.96),
  new THREE.Vector3(1, 0.9, 0.88),
  new THREE.Vector3(1, 0.82, 0.8),
];
composer.addPass(bloom);
const final = new ShaderPass(
  new THREE.ShaderMaterial({
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: finalFrag,
    uniforms: {
      tDiffuse: { value: null },
      uRes: { value: new THREE.Vector2(W, H) },
      uExposure: { value: LOOK.exposure },
      uFrame: { value: 0 },
      uGrain: { value: params.has('grain') ? Number(params.get('grain')) : 0.022 },
      uCA: { value: 0.0016 },
    },
  }),
);
composer.addPass(final);

/* -------------------------------------------------------------- render --- */
const headWorld = new THREE.Vector3(0, 0.245, 0);
function apply(t, frame) {
  const s = shotState(t);
  camera.fov = s.fovDeg;
  camera.position.set(...s.camPos);
  if (params.get('cam')) camera.position.set(...params.get('cam').split(',').map(Number));
  const tgt = params.get('tgt') ? params.get('tgt').split(',').map(Number) : s.target;
  camera.lookAt(new THREE.Vector3(...tgt));
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();

  if (params.get('debug')) { s.key = 1; s.rimR = 1; s.rimL = 1; s.ambient = 1; }
  shared.uKeyRad.value.copy(KEY_COL).multiplyScalar(LOOK.keyRad * s.key);
  shared.uFillRad.value.copy(FILL_COL).multiplyScalar(LOOK.fillRad * s.key);
  shared.uTopRad.value.copy(RIM_COL).multiplyScalar(LOOK.topRad * (s.rimR + s.rimL) * 0.5);
  shared.uRimRRad.value.copy(RIM_COL).multiplyScalar(LOOK.rimRad * s.rimR);
  shared.uRimLRad.value.copy(RIM_COL).multiplyScalar(LOOK.rimRad * s.rimL);
  shared.uAmb.value = LOOK.amb * s.ambient;
  seamOrder.forEach((name, i) => {
    const st = s.seams[name];
    if (!seamMats[name]) return;
    seamStates[i].set(st[0], st[1], st[2] * LOOK.seamI, st[3]);
    seamMats[name].uniforms.uState.value.set(st[0], st[1], st[2] * LOOK.seamGlow, st[3]);
  });

  const head = headWorld.clone().project(camera);
  bgMat.uniforms.uHead.value.set((head.x + 1) / 2, (head.y + 1) / 2);
  const dist = camera.position.distanceTo(headWorld);
  bgMat.uniforms.uScale.value = 0.45 / (2 * dist * Math.tan(THREE.MathUtils.degToRad(s.fovDeg / 2)));
  bgMat.uniforms.uTime.value = t;
  bgMat.uniforms.uRimR.value = s.rimR;
  bgMat.uniforms.uRimL.value = s.rimL;
  bgMat.uniforms.uKey.value = s.key;

  const focus = camera.position.distanceTo(new THREE.Vector3(0, 0.2, 0.08));
  const focal = sensorH / 2 / Math.tan(THREE.MathUtils.degToRad(s.fovDeg / 2));
  const aperture = focal / fNumber;
  dustMat.uniforms.uFocus.value = focus;
  dustMat.uniforms.uPx.value = ((aperture * focal) / (1 - focal / focus)) / (sensorH / H);
  dustMat.uniforms.uTime.value = t;
  dustMat.uniforms.uRimR.value = s.rimR;
  dustMat.uniforms.uRimL.value = s.rimL;
  dustMat.uniforms.uKey.value = s.key;
  dustMat.uniforms.uSeamGlow.value = s.seamTotal;

  final.uniforms.uFrame.value = frame;
}

window.renderAt = (t, frame = Math.round(t * FPS)) => {
  apply(t, frame);
  composer.render();
  const gl = renderer.getContext();
  gl.finish();
  return true;
};

window.grab = () => {
  const gl = renderer.getContext();
  const px = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  // base64 in chunks to keep the string building cheap
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < px.length; i += CH) s += String.fromCharCode.apply(null, px.subarray(i, i + CH));
  return btoa(s);
};

window.__ready = true;
document.title = 'ready';
