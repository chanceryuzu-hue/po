// Turns the Scene 03 renders into page assets.
//   node scripts/pack-helmet.mjs <renderDir> <publicAssetsDir>
//
// For each release pose: trims the bloom margin, makes the head transparent
// (alpha = 1 - head matte), un-premultiplies, feathers the crop's border so
// it melts into the sealed frame underneath, and writes WebP at full, 3/4
// (desktop release) and 1/2 (phone release) size. Also writes the face mask,
// the placeholder head, the light on the head (for relighting a portrait),
// the sealed frames and a manifest.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CAMERAS, HC } from '../render/rig.js';

const require = createRequire(import.meta.url);
const sharp = require('/opt/npm-tools/node_modules/sharp');

const [renderDir = 'out/helmet', outRoot = '../public/assets'] = process.argv.slice(2);
const OUT = join(outRoot, 'helmet');
mkdirSync(join(OUT, 'poses/d'), { recursive: true });
mkdirSync(join(OUT, 'poses/m'), { recursive: true });
const plan = JSON.parse(readFileSync(join(renderDir, 'plan.json')));
const { crop, pad, feather } = plan;
const W = crop.w, H = crop.h, N = W * H;

async function raw(file, region) {
  let img = sharp(file);
  if (region) img = img.extract(region);
  const { data, info } = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== (region?.width ?? info.width)) throw new Error('size');
  return data; // RGB
}
const trim = { left: pad, top: pad, width: W, height: H };

function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(src.length);
  const pass = (a, b, horiz) => {
    const len = horiz ? w : h, lines = horiz ? h : w, stride = horiz ? 1 : w, step = horiz ? w : 1;
    const inv = 1 / (2 * r + 1);
    for (let l = 0; l < lines; l++) {
      const base = l * step;
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += a[base + Math.min(len - 1, Math.max(0, i)) * stride];
      for (let i = 0; i < len; i++) {
        b[base + i * stride] = acc * inv;
        acc += a[base + Math.min(len - 1, i + r + 1) * stride] - a[base + Math.max(0, i - r) * stride];
      }
    }
  };
  for (let k = 0; k < 3; k++) {
    pass(src, tmp, true);
    pass(tmp, src, false);
  }
  return src;
}

// border feather: alpha ramps to 0 over `feather` px at the crop edge
const edge = new Float32Array(N);
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const d = Math.min(x, y, W - 1 - x, H - 1 - y) / feather;
    const t = Math.min(1, Math.max(0, d));
    edge[y * W + x] = t * t * (3 - 2 * t);
  }

// bloom that reaches the crop from outside it: the sealed full frame vs the sealed crop
const desk = plan.windows.desktop;
const base = await raw(join(renderDir, 'desktop.png'), { left: crop.x - desk.x, top: crop.y - desk.y, width: W, height: H });
const pose0 = await raw(join(renderDir, 'crop/beauty_00.png'), trim);
const corr = [0, 1, 2].map((c) => {
  const d = new Float32Array(N);
  for (let i = 0; i < N; i++) d[i] = base[3 * i + c] - pose0[3 * i + c];
  return boxBlur(d, W, H, 18);
});
let maxCorr = 0;
for (const ch of corr) for (const v of ch) maxCorr = Math.max(maxCorr, Math.abs(v));
console.log(`bloom correction: max ${maxCorr.toFixed(1)} levels`);

async function layer(beautyFile, matteFile) {
  const rgb = await raw(beautyFile, trim);
  const matte = await raw(matteFile, trim);
  const out = Buffer.alloc(N * 4);
  for (let i = 0; i < N; i++) {
    const head = matte[3 * i] / 255;
    const a = (1 - head) * edge[i];
    const keep = 1 - head; // beauty is premultiplied by (1 - head): undo it
    for (let c = 0; c < 3; c++) {
      const v = rgb[3 * i + c] + corr[c][i] * keep;
      out[4 * i + c] = keep > 0.02 ? Math.min(255, Math.max(0, Math.round(v / keep))) : 0;
    }
    out[4 * i + 3] = Math.round(a * 255);
  }
  return out;
}
const webp = (buf, w, h, file, q = 86) =>
  sharp(buf, { raw: { width: w, height: h, channels: 4 } }).webp({ quality: q, alphaQuality: 90, effort: 5 }).toFile(file);
async function writeScaled(buf, scale, file, q) {
  const w = Math.round(W * scale), h = Math.round(H * scale);
  const img = sharp(buf, { raw: { width: W, height: H, channels: 4 } });
  const scaled = scale === 1 ? img : img.resize(w, h, { kernel: 'lanczos3' });
  await scaled.webp({ quality: q, alphaQuality: 90, effort: 5 }).toFile(file);
}

const d = [], m = [];
let openBuf = null;
for (let k = 0; k < plan.poses.length; k++) {
  const n = String(k).padStart(2, '0');
  const buf = await layer(join(renderDir, `crop/beauty_${n}.png`), join(renderDir, `crop/matte_${n}.png`));
  await writeScaled(buf, 0.75, join(OUT, `poses/d/${n}.webp`), 80);
  await writeScaled(buf, 0.5, join(OUT, `poses/m/${n}.webp`), 80);
  d.push(`poses/d/${n}.webp`);
  m.push(`poses/m/${n}.webp`);
  if (k === plan.poses.length - 1) openBuf = buf;
  process.stdout.write('.');
}
console.log();
await webp(openBuf, W, H, join(OUT, 'open.webp'), 88);
const clearBuf = await layer(join(renderDir, 'crop/clear.png'), join(renderDir, 'crop/clear_matte.png'));
await webp(clearBuf, W, H, join(OUT, 'clear.webp'), 88);

// face mask: where the head shows when open (slightly grown, soft edged)
{
  const matte = await raw(join(renderDir, `crop/matte_${String(plan.poses.length - 1).padStart(2, '0')}.png`), trim);
  const a = new Float32Array(N);
  for (let i = 0; i < N; i++) a[i] = matte[3 * i] / 255;
  // grow by ~2 px so the face runs just under the padding edge
  const g = boxBlur(Float32Array.from(a), W, H, 1);
  const out = Buffer.alloc(N * 4);
  for (let i = 0; i < N; i++) {
    const v = Math.min(1, Math.max(a[i], g[i] * 2.2));
    out[4 * i] = out[4 * i + 1] = out[4 * i + 2] = 255;
    out[4 * i + 3] = Math.round(v * 255);
  }
  await sharp(out, { raw: { width: W, height: H, channels: 4 } }).webp({ lossless: true, effort: 5 }).toFile(join(OUT, 'face-mask.webp'));
}
await sharp(join(renderDir, 'crop/clay.png')).extract(trim).webp({ quality: 90, effort: 5 }).toFile(join(OUT, 'face-clay.webp'));
await sharp(join(renderDir, 'crop/shading.png')).extract(trim).webp({ quality: 92, effort: 5 }).toFile(join(OUT, 'shading.webp')); // in colour: the cool fill tints the face
await sharp(join(renderDir, 'desktop.png')).webp({ quality: 84, effort: 5 }).toFile(join(OUT, 'base-desktop.webp'));
await sharp(join(renderDir, 'portrait.png')).webp({ quality: 84, effort: 5 }).toFile(join(OUT, 'base-portrait.webp'));

// the visor slit, for the scan
const cam = CAMERAS.helmet;
const K = plan.K;
const sub = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const nrm = (a) => a.map((v) => v / Math.hypot(...a));
const zA = nrm(sub(cam.pos, cam.target)), xA = nrm(cross([0, 1, 0], zA)), yA = cross(zA, xA);
const project = (p) => {
  const q = sub(p, cam.pos);
  const zc = dot(q, zA);
  return [plan.fullW / 2 + (K * dot(q, xA)) / -zc, cam.fullH / 2 - (K * dot(q, yA)) / -zc];
};
const top = project([0, HC[1] + 0.038, HC[2] + 0.14]);
const bot = project([0, HC[1] + 0.006, HC[2] + 0.14]);
const left = project([-0.104, HC[1] + 0.017, HC[2] + 0.062]);
const right = project([0.104, HC[1] + 0.017, HC[2] + 0.062]);

const manifest = {
  windows: plan.windows,
  crop,
  landmarks: { eyeR: plan.landmarks.eyeR, eyeL: plan.landmarks.eyeL, chin: plan.landmarks.chin },
  slit: { x0: left[0], x1: right[0], y: (top[1] + bot[1]) / 2, h: Math.abs(bot[1] - top[1]) / 2 },
  poses: { p: plan.poses, d, m },
  open: 'open.webp',
  clear: 'clear.webp',
  face: { clay: 'face-clay.webp', mask: 'face-mask.webp', shading: 'shading.webp', shadingScale: 0.25 },
};
writeFileSync(join(OUT, 'helmet.json'), JSON.stringify(manifest));
console.log('packed', JSON.stringify(manifest.slit));
