// Plans the Scene 03 renders: which release poses to render (spaced by how
// far things move on screen, so cross-fades never jump), the crop window
// that contains every moving part, and where the face landmarks land.
//   node scripts/plan-helmet.mjs <out.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { CAMERAS, rigPose, apply, HC } from '../render/rig.js';

const out = process.argv[2] || 'plan.json';
const assets = new URL('../render/assets/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('model.json', assets)));
const bin = readFileSync(new URL('model.bin', assets));
const GEO = manifest.geo;

const FULL_W = 4000;
const cam = CAMERAS.helmet;
const K = cam.fullH / 2 / Math.tan(((cam.fov / 2) * Math.PI) / 180);

// camera basis (three.js lookAt with up = +y)
const sub = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const nrm = (a) => a.map((v) => v / Math.hypot(...a));
const zAxis = nrm(sub(cam.pos, cam.target));
const xAxis = nrm(cross([0, 1, 0], zAxis));
const yAxis = cross(zAxis, xAxis);
export function project(p) {
  const d = sub(p, cam.pos);
  const xc = dot(d, xAxis), yc = dot(d, yAxis), zc = dot(d, zAxis);
  return [FULL_W / 2 + (K * xc) / -zc, cam.fullH / 2 - (K * yc) / -zc];
}

// sample vertices of every moving part (and the face region)
const parts = manifest.parts.filter((p) => p.index[1]);
const pts = {};
for (const p of parts) {
  if (!p.rig && !p.head) continue;
  const pos = new Float32Array(bin.buffer, bin.byteOffset + p.position[0], p.position[1]);
  const step = Math.max(1, Math.floor(pos.length / 3 / 600));
  const arr = [];
  for (let i = 0; i < pos.length / 3; i += step) arr.push([pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]]);
  pts[p.name] = { rig: p.rig, arr };
}

function screenPoints(pose) {
  const s = [];
  for (const { rig, arr } of Object.values(pts)) {
    const m = rig ? pose[rig] : null;
    for (const q of arr) s.push(project(m ? apply(m, q) : q));
  }
  return s;
}

// motion along p
const FINE = 600;
const ps = [];
let prev = null;
let acc = 0;
let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
for (let i = 0; i <= FINE; i++) {
  const p = i / FINE;
  const s = screenPoints(rigPose(p, GEO));
  for (const [x, y] of s) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  if (prev) {
    // the largest move of any sampled point, plus a floor so slow phases still get poses
    let m = 0;
    for (let j = 0; j < s.length; j++) m = Math.max(m, Math.hypot(s[j][0] - prev[j][0], s[j][1] - prev[j][1]));
    acc += m + 6 / FINE * 100;
  }
  ps.push({ p, acc });
  prev = s;
}
const N = Number(process.env.POSES || 40);
const poses = [];
for (let k = 0; k < N; k++) {
  const target = (acc * k) / (N - 1);
  const hit = ps.find((q) => q.acc >= target - 1e-9) || ps[ps.length - 1];
  poses.push(Number(hit.p.toFixed(4)));
}
poses[0] = 0;
poses[N - 1] = 1;
const uniq = [...new Set(poses)];

// crop: everything that moves, plus a feather band and a bloom pad
const FEATHER = 40, PAD = 64;
const crop = {
  x: Math.floor(x0 - FEATHER - 8),
  y: Math.floor(y0 - FEATHER - 8),
};
crop.w = Math.ceil(x1 + FEATHER + 8) - crop.x;
crop.h = Math.ceil(y1 + FEATHER + 8) - crop.y;
crop.w += crop.w % 2;
crop.h += crop.h % 2;

const f = GEO.face;
const landmarks = {
  eyeR: project([-f.eyeX, f.eyeY, f.eyeZ]), // the head's right eye is on the image's left
  eyeL: project([f.eyeX, f.eyeY, f.eyeZ]),
  chin: project([0, f.chinY, f.chinZ]),
  helmet: project(HC),
};

// windows onto the virtual plane
const helm = landmarks.helmet;
const desktop = { x: Math.round(helm[0] - 0.62 * 2560), y: 0, w: 2560, h: 1440 };
const portrait = { x: Math.round(helm[0] - 540), y: Math.round(helm[1] - 0.34 * 1920), w: 1080, h: 1920 };

const plan = {
  camera: 'helmet',
  fullW: FULL_W,
  fullH: cam.fullH,
  K,
  poses: uniq,
  crop,
  feather: FEATHER,
  pad: PAD,
  landmarks,
  windows: { desktop, portrait },
  motionPx: Math.round(acc),
};
writeFileSync(out, JSON.stringify(plan, null, 2));
console.log(JSON.stringify({ poses: uniq.length, crop, desktop, portrait, landmarks, motionPx: plan.motionPx }));
