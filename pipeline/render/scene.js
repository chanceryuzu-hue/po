// Renderer for the portfolio's page assets (Scene 03 helmet poses and the
// stills). Loaded headless by scripts/*.mjs; everything is driven by the
// query string and `window.renderPass(...)`.
//
//   ?cam=helmet|core|final      which camera (render/rig.js CAMERAS)
//   &win=x,y,w,h                window onto the camera's virtual image plane
//   &fullW=4000                 virtual plane width (height comes from the camera)
//   &msaa=4
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import {
  MAX_SEAM, MAX_SEG, armorFrag, armorVert, bgFrag, dustFrag, dustVert, finalFrag, fsVert, seamFrag, seamVert,
} from './shaders.js';
import { CAMERAS, HC, RIGS, rigPose, identity } from './rig.js';

const params = new URLSearchParams(location.search);
const CAM = CAMERAS[params.get('cam') || 'helmet'];
const SCALE = Number(params.get('scale') || 1); // look-dev: render the same framing smaller
const FULL_H = CAM.fullH * SCALE;
const FULL_W = Number(params.get('fullW') || 4000) * SCALE;
const [WX, WY, W, H] = (params.get('win') || `${(4000 - 2560) / 2},0,2560,1440`).split(',').map((v) => Math.round(Number(v) * SCALE));
const MSAA = Number(params.get('msaa') || 4);

const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.setClearColor(0x000000, 1);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CAM.fov, FULL_W / FULL_H, 0.05, 30);
camera.position.set(...CAM.pos);
camera.lookAt(new THREE.Vector3(...CAM.target));
camera.setViewOffset(FULL_W, FULL_H, WX, WY, W, H);
if (params.get('debugCam')) {
  // look-dev only: a free camera, no lens shift
  const [px, py, pz, tx, ty, tz] = params.get('debugCam').split(',').map(Number);
  camera.clearViewOffset();
  camera.aspect = W / H;
  camera.position.set(px, py, pz);
  camera.lookAt(tx, ty, tz);
}
camera.updateProjectionMatrix();
camera.updateMatrixWorld();

/* -------------------------------------------------------------- lights --- */
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
const GEO = manifest.geo;

const key = rectFacing(LIGHTS.key, [0, 0.15, 0], 0.95, 0.5);
const rimR = rectFacing(LIGHTS.rimR, [0, 0.12, 0], 0.16, 0.95);
const rimL = rectFacing(LIGHTS.rimL, [0, 0.12, 0], 0.16, 0.95);
const fill = rectFacing([0, 0.55, 2.6], [0, 0.18, 0], 2.3, 0.95);
const top = rectFacing([0, 1.25, -1.15], [0, 0.3, 0], 0.55, 0.12);
const FILL_COL = new THREE.Vector3(0.82, 0.9, 1.0);
const KEY_COL = new THREE.Vector3(1.0, 0.95, 0.88);
const RIM_COL = new THREE.Vector3(1.0, 0.055, 0.03);
const SEAM_COL = new THREE.Vector3(0.78, 0.93, 1.0);
const num = (k, d) => (params.has(k) ? Number(params.get(k)) : d);
const LOOK = {
  keyRad: num('key', 5),
  fillRad: num('fill', 0.42),
  topRad: num('top', 3.5),
  rimRad: num('rim', 10.5),
  seamI: num('seam', 0.14),
  seamSpec: num('seamSpec', 1),
  seamGlow: num('glow', 6),
  amb: num('amb', 1.4),
  exposure: num('exp', 1.0),
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
  uQuiltC: { value: new THREE.Vector3(...HC) },
};

const MATS = {
  0: { uF0: [0.13, 0.135, 0.145], uDiffuse: [0, 0, 0], uRough: 0.34, uAniso: 0.55, uStreak: 1.0, uEdge: 1.0 }, // graphite
  1: { uF0: [0.42, 0.42, 0.43], uDiffuse: [0, 0, 0], uRough: 0.27, uAniso: 0.4, uStreak: 0.8, uEdge: 0.8 }, // platinum
  2: { uF0: [0.06, 0.065, 0.07], uDiffuse: [0, 0, 0], uRough: 0.075, uAniso: 0.0, uStreak: 0.0, uEdge: 0.0 }, // visor
  3: { uF0: [0.03, 0.03, 0.03], uDiffuse: [0.014, 0.014, 0.015], uRough: 0.58, uAniso: 0.0, uStreak: 0.0, uEdge: 0.0 }, // undersuit
  4: { uF0: [0.78, 0.6, 0.34], uDiffuse: [0, 0, 0], uRough: 0.26, uAniso: 0.3, uStreak: 0.6, uEdge: 0.9 }, // brass latch pins
  5: { uF0: [0.028, 0.028, 0.028], uDiffuse: [0.03, 0.029, 0.028], uRough: 0.72, uAniso: 0.0, uStreak: 0.0, uEdge: 0.0, uQuilt: 1 }, // padding
  6: { uF0: [0.035, 0.035, 0.035], uDiffuse: [0.17, 0.155, 0.14], uRough: 0.48, uAniso: 0.0, uStreak: 0.0, uEdge: 0.0 }, // placeholder head (clay)
};
const materials = {};
for (const [id, m] of Object.entries(MATS)) {
  const u = { ...shared, uOut: { value: 0 }, uQuilt: { value: 0 } };
  for (const [k, v] of Object.entries(m)) u[k] = { value: Array.isArray(v) ? new THREE.Vector3(...v) : v };
  materials[id] = new THREE.ShaderMaterial({ vertexShader: armorVert, fragmentShader: armorFrag, uniforms: u });
}
// the head gets its own material so passes can treat it separately
const headMat = materials[6];

const view = (arr, Type) => new Type(bin, arr[0], arr[1]);
const meshes = [];
const rigMeshes = {};
let headMesh = null;
let visorMesh = null;
for (const part of manifest.parts) {
  if (!part.index[1]) continue;
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
  mesh.frustumCulled = false;
  if (part.rig) {
    mesh.matrixAutoUpdate = false;
    (rigMeshes[part.rig] ||= []).push(mesh);
  }
  if (part.head) headMesh = mesh;
  if (part.name === 'visor') visorMesh = mesh;
  meshes.push(mesh);
  scene.add(mesh);
}

// glowing seam tubes
const seamMats = {};
const seamMeshes = [];
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
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  m.userData.glow = mat;
  seamMeshes.push(m);
  scene.add(m);
}
const blackMat = new THREE.MeshBasicMaterial({ color: 0x000000 });

/* ---------------------------------------------------------- background --- */
const headWorld = new THREE.Vector3(0, 0.245, 0);
function toVirtual(v) {
  // project with the un-shifted camera onto the virtual plane (px, y down)
  const c = camera.clone();
  c.clearViewOffset();
  c.aspect = FULL_W / FULL_H;
  c.updateProjectionMatrix();
  const p = v.clone().project(c);
  return new THREE.Vector2(((p.x + 1) / 2) * FULL_W, ((1 - p.y) / 2) * FULL_H);
}
const dist = camera.position.distanceTo(headWorld);
const bgMat = new THREE.ShaderMaterial({
  vertexShader: fsVert,
  fragmentShader: bgFrag,
  depthTest: false,
  depthWrite: false,
  uniforms: {
    uRes: { value: new THREE.Vector2(W, H) },
    uOff: { value: new THREE.Vector2(WX, WY) },
    uHeadPx: { value: toVirtual(headWorld) },
    uScalePx: { value: (0.45 / (2 * dist * Math.tan(THREE.MathUtils.degToRad(CAM.fov / 2)))) * FULL_H },
    uTime: { value: num('bgTime', 11) },
    uRimR: { value: 0 },
    uRimL: { value: 0 },
    uKey: { value: 0 },
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
const fNumber = num('fstop', 2.2);
const sensorH = 0.02025;
const focusPt = new THREE.Vector3(...(params.get('focus') || '0,0.2,0.08').split(',').map(Number));
const focus = camera.position.distanceTo(focusPt);
const focal = sensorH / 2 / Math.tan(THREE.MathUtils.degToRad(CAM.fov / 2));
const dustMat = new THREE.ShaderMaterial({
  vertexShader: dustVert,
  fragmentShader: dustFrag,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: {
    uTime: { value: num('dustTime', 11) },
    uPx: { value: ((focal / fNumber) * focal) / (1 - focal / focus) / (sensorH / FULL_H) },
    uFocus: { value: focus },
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
dust.visible = params.get('dust') !== '0';
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
      uGrain: { value: 0 },
      uCA: { value: 0 },
      uVig: { value: 0 },
      uRaw: { value: 0 },
      uRawScale: { value: 1 },
    },
  }),
);
composer.addPass(final);

/* ------------------------------------------------------------- state ---- */
const bump = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return Math.sin(t * Math.PI);
};
const PRESETS = {
  // the end of the opening shot: everything lit
  lit: { key: 1, rimR: 1, rimL: 0.62, ambient: 1, seams: 1 },
  // Scene 06: the light settles; rims hold, the key drops back
  final: { key: 0.42, rimR: 1.18, rimL: 0.9, ambient: 0.55, seams: 1 },
};

function setRig(p) {
  const pose = rigPose(p, GEO);
  for (const rig of RIGS) {
    const m = pose[rig] || identity();
    for (const mesh of rigMeshes[rig] || []) {
      mesh.matrix.set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[9], m[10], m[11], 0, 0, 0, 1);
      mesh.matrixWorldNeedsUpdate = true;
    }
  }
}

function setLights(preset, p) {
  const s = PRESETS[preset];
  shared.uKeyRad.value.copy(KEY_COL).multiplyScalar(LOOK.keyRad * s.key);
  shared.uFillRad.value.copy(FILL_COL).multiplyScalar(LOOK.fillRad * s.key);
  shared.uTopRad.value.copy(RIM_COL).multiplyScalar(LOOK.topRad * (s.rimR + s.rimL) * 0.5);
  shared.uRimRRad.value.copy(RIM_COL).multiplyScalar(LOOK.rimRad * s.rimR);
  shared.uRimLRad.value.copy(RIM_COL).multiplyScalar(LOOK.rimRad * s.rimL);
  shared.uAmb.value = LOOK.amb * s.ambient;
  // the release: the brow line flares as the latches let go
  const flare = 1 + 0.7 * bump(0.0, 0.2, p);
  seamOrder.forEach((name, i) => {
    const k = s.seams * (name === 'brow' ? flare : 1) * (name === 'neck' ? 0.8 : 1);
    seamStates[i].set(0, 1.04, k * LOOK.seamI, 0);
    if (seamMats[name]) seamMats[name].uniforms.uState.value.set(0, 1.04, k * LOOK.seamGlow, 0);
  });
  bgMat.uniforms.uRimR.value = s.rimR;
  bgMat.uniforms.uRimL.value = s.rimL;
  bgMat.uniforms.uKey.value = s.key;
  dustMat.uniforms.uRimR.value = s.rimR;
  dustMat.uniforms.uRimL.value = s.rimL;
  dustMat.uniforms.uKey.value = s.key;
  dustMat.uniforms.uSeamGlow.value = s.seams;
}

/**
 * Passes:
 *  beauty   the scene, the head held out (black)
 *  clear    as beauty with the visor glass removed (scan reveal)
 *  matte    head coverage, white on black (add `clear` to drop the visor)
 *  shading  irradiance on the head (white diffuse), linear, sqrt-encoded x 0.5
 *  clay     the scene with the placeholder head visible
 */
function setPass(pass, clear) {
  const isMatte = pass === 'matte';
  const isShading = pass === 'shading';
  for (const m of Object.values(materials)) m.uniforms.uOut.value = isMatte || isShading ? 1 : 0;
  headMat.uniforms.uOut.value = isMatte ? 2 : isShading ? 3 : pass === 'clay' ? 0 : 1;
  for (const s of seamMeshes) s.material = isMatte || isShading ? blackMat : s.userData.glow;
  bg.visible = !(isMatte || isShading);
  dust.visible = params.get('dust') !== '0' && !(isMatte || isShading);
  if (visorMesh) visorMesh.visible = !clear;
  bloom.enabled = !(isMatte || isShading);
  final.uniforms.uRaw.value = isMatte ? 2 : isShading ? 1 : 0;
  final.uniforms.uRawScale.value = 0.25; // shading: sqrt(irradiance x 0.25)
  final.uniforms.uVig.value = num('vig', 0);
}

window.renderPass = ({ p = 0, pass = 'beauty', clear = false, preset = 'lit' } = {}) => {
  setRig(p);
  setLights(preset, p);
  setPass(pass, clear);
  composer.render();
  renderer.getContext().finish();
  return true;
};

window.grab = () => {
  const gl = renderer.getContext();
  const px = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < px.length; i += CH) s += String.fromCharCode.apply(null, px.subarray(i, i + CH));
  return btoa(s);
};

/** Project world points to the virtual plane (px, y down), for the page's alignment data. */
window.project = (pts) => pts.map((p) => toVirtual(new THREE.Vector3(...p)).toArray());

window.__ready = true;
document.title = 'ready';
