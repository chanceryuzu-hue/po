// Meshes every SDF part with surface nets, culls hidden surfaces, bakes
// ambient occlusion, light visibility and edge curvature per vertex, and
// writes render/assets/model.bin + model.json.
//   node model/build.mjs [--quick]
import { writeFileSync, mkdirSync } from 'node:fs';
import { PARTS, seamDefs, rigGeometry } from './sdf.mjs';
import { CULL_CAMERAS, apply as applyM, invert, rigPose } from '../render/rig.js';

const QUICK = process.argv.includes('--quick');
const OUT = new URL('../render/assets/', import.meta.url);
const { abs, sqrt, min, max, hypot } = Math;
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

// Lights (must match render/scene.js)
export const LIGHTS = {
  key: [0.0, 1.45, 0.6],
  rimR: [1.35, 0.42, -0.95],
  rimL: [-1.35, 0.38, -0.95],
};
const CAMS = CULL_CAMERAS;
const ONLY = (() => {
  const i = process.argv.indexOf('--only');
  return i > 0 ? process.argv[i + 1].split(',') : null;
})();

// Helmet configurations: moving parts are evaluated through the inverse of
// their rig pose. Static parts bake with the helmet sealed; the head and the
// padding are only ever seen open, so they bake with the helmet open.
const GEO = rigGeometry();
const CONFIGS = { closed: { fwd: {}, inv: {} }, open: { fwd: rigPose(1, GEO), inv: {} } };
for (const [k, m] of Object.entries(CONFIGS.open.fwd)) CONFIGS.open.inv[k] = invert(m);
let CFG = CONFIGS.closed;

/* ------------------------------------------------------------ meshing --- */

function grad(f, x, y, z, e = 0.0003) {
  const gx = f(x + e, y, z) - f(x - e, y, z);
  const gy = f(x, y + e, z) - f(x, y - e, z);
  const gz = f(x, y, z + e) - f(x, y, z - e);
  const l = hypot(gx, gy, gz) || 1;
  return [gx / l, gy / l, gz / l, l / (2 * e)];
}

function surfaceNets(part) {
  const h = part.res * (QUICK ? 2 : 1);
  const f = part.sdf;
  const [x0, y0, z0, x1, y1, z1] = part.bbox;
  const nx = Math.ceil((x1 - x0) / h) + 1;
  const ny = Math.ceil((y1 - y0) / h) + 1;
  const nz = Math.ceil((z1 - z0) / h) + 1;
  const B = 8;
  const bx = Math.ceil((nx - 1) / B), by = Math.ceil((ny - 1) / B), bz = Math.ceil((nz - 1) / B);
  const active = new Uint8Array(bx * by * bz);
  const margin = 2.6 * 0.87 * B * h;
  for (let k = 0; k < bz; k++)
    for (let j = 0; j < by; j++)
      for (let i = 0; i < bx; i++) {
        const cx = x0 + (i + 0.5) * B * h, cy = y0 + (j + 0.5) * B * h, cz = z0 + (k + 0.5) * B * h;
        if (abs(f(cx, cy, cz)) < margin) active[i + bx * (j + by * k)] = 1;
      }
  const N = nx * ny * nz;
  const field = new Float32Array(N).fill(NaN);
  const idx = (i, j, k) => i + nx * (j + ny * k);
  for (let k = 0; k < bz; k++)
    for (let j = 0; j < by; j++)
      for (let i = 0; i < bx; i++) {
        if (!active[i + bx * (j + by * k)]) continue;
        for (let kk = k * B; kk <= min(nz - 1, k * B + B); kk++)
          for (let jj = j * B; jj <= min(ny - 1, j * B + B); jj++)
            for (let ii = i * B; ii <= min(nx - 1, i * B + B); ii++) {
              const n = idx(ii, jj, kk);
              if (field[n] !== field[n]) field[n] = f(x0 + ii * h, y0 + jj * h, z0 + kk * h);
            }
      }
  const cellV = new Int32Array(N).fill(-1);
  const pos = [];
  const cornerOff = [];
  for (let c = 0; c < 8; c++) cornerOff.push([c & 1, (c >> 1) & 1, (c >> 2) & 1]);
  const edges = [
    [0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const vals = new Float64Array(8);
  for (let k = 0; k < nz - 1; k++)
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        let neg = 0, nan = false;
        for (let c = 0; c < 8; c++) {
          const v = field[idx(i + cornerOff[c][0], j + cornerOff[c][1], k + cornerOff[c][2])];
          if (v !== v) { nan = true; break; }
          vals[c] = v;
          if (v < 0) neg++;
        }
        if (nan || neg === 0 || neg === 8) continue;
        let sx = 0, sy = 0, sz = 0, cnt = 0;
        for (const [a, b] of edges) {
          const va = vals[a], vb = vals[b];
          if ((va < 0) === (vb < 0)) continue;
          const t = va / (va - vb);
          const A = cornerOff[a], Bc = cornerOff[b];
          sx += A[0] + (Bc[0] - A[0]) * t;
          sy += A[1] + (Bc[1] - A[1]) * t;
          sz += A[2] + (Bc[2] - A[2]) * t;
          cnt++;
        }
        let px = x0 + (i + sx / cnt) * h, py = y0 + (j + sy / cnt) * h, pz = z0 + (k + sz / cnt) * h;
        // project onto the surface (bounded to the cell)
        const cx = x0 + (i + 0.5) * h, cy = y0 + (j + 0.5) * h, cz = z0 + (k + 0.5) * h;
        for (let it = 0; it < 3; it++) {
          const d = f(px, py, pz);
          const g = grad(f, px, py, pz);
          const s = d / max(g[3], 0.3);
          px -= g[0] * s; py -= g[1] * s; pz -= g[2] * s;
          px = min(max(px, cx - h), cx + h);
          py = min(max(py, cy - h), cy + h);
          pz = min(max(pz, cz - h), cz + h);
        }
        cellV[idx(i, j, k)] = pos.length / 3;
        pos.push(px, py, pz);
      }
  const tris = [];
  const axes = [
    [0, 1, 2],
    [1, 2, 0],
    [2, 0, 1],
  ];
  const step = [1, nx, nx * ny];
  const dims = [nx, ny, nz];
  for (let k = 1; k < nz - 1; k++)
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const n0 = idx(i, j, k);
        const v0 = field[n0];
        if (v0 !== v0) continue;
        const ijk = [i, j, k];
        for (const [a, b, c] of axes) {
          if (ijk[a] >= dims[a] - 1) continue;
          const v1 = field[n0 + step[a]];
          if (v1 !== v1 || (v0 < 0) === (v1 < 0)) continue;
          const q00 = cellV[n0 - step[b] - step[c]];
          const q10 = cellV[n0 - step[c]];
          const q11 = cellV[n0];
          const q01 = cellV[n0 - step[b]];
          if (q00 < 0 || q10 < 0 || q11 < 0 || q01 < 0) continue;
          if (v0 < 0) tris.push(q00, q10, q11, q00, q11, q01);
          else tris.push(q00, q11, q10, q00, q01, q11);
        }
      }
  return { pos: new Float32Array(pos), tris: new Uint32Array(tris), h };
}

/* --------------------------------------------------- scene-wide queries --- */

const bounds = []; // per part bounding spheres at rest (filled after meshing)
function partBound(i) {
  const b = bounds[i];
  const rig = PARTS[i].rig;
  if (!b || !rig || !CFG.fwd[rig]) return b;
  return [...applyM(CFG.fwd[rig], b), b[3]];
}
function partSDF(i, x, y, z) {
  const rig = PARTS[i].rig;
  if (rig && CFG.inv[rig]) [x, y, z] = applyM(CFG.inv[rig], [x, y, z]);
  return PARTS[i].sdf(x, y, z);
}
function sceneSDF(x, y, z, filter) {
  let best = 1e9;
  for (let i = 0; i < PARTS.length; i++) {
    if (filter && !filter(PARTS[i])) continue;
    const b = partBound(i);
    if (!b) continue;
    const dc = hypot(x - b[0], y - b[1], z - b[2]) - b[3];
    if (dc > best) continue;
    const d = partSDF(i, x, y, z);
    if (d < best) best = d;
  }
  return best;
}
const isStaticPlate = (p) => !p.core && !p.rig && !p.head;
const staticPlateSDF = (x, y, z) => sceneSDF(x, y, z, isStaticPlate);
const coreSDF = (x, y, z) => sceneSDF(x, y, z, (p) => p.core);
const byName = (n) => PARTS.findIndex((p) => p.name === n);
const padSDF = (x, y, z) => PARTS[byName('padding')].sdf(x, y, z);
const headSDF = (x, y, z) => PARTS[byName('head')].sdf(x, y, z);
const neckSuitSDF = (x, y, z) => PARTS[byName('neckSuit')].sdf(x, y, z);

function bakeAO(px, py, pz, n) {
  const hs = [0.002, 0.005, 0.01, 0.018, 0.03, 0.05];
  const ws = [0.22, 0.2, 0.18, 0.16, 0.14, 0.1];
  let occ = 0;
  for (let i = 0; i < hs.length; i++) {
    const hh = hs[i];
    const d = sceneSDF(px + n[0] * hh, py + n[1] * hh, pz + n[2] * hh);
    occ += ws[i] * max(0, (hh - d) / hh);
  }
  return min(1, max(0, 1 - occ * 1.15));
}
function bakeShadow(px, py, pz, n, L) {
  let lx = L[0] - px, ly = L[1] - py, lz = L[2] - pz;
  const dist = hypot(lx, ly, lz);
  lx /= dist; ly /= dist; lz /= dist;
  if (n[0] * lx + n[1] * ly + n[2] * lz < -0.25) return 0;
  const ox = px + n[0] * 0.0018, oy = py + n[1] * 0.0018, oz = pz + n[2] * 0.0018;
  let res = 1, t = 0.002, ph = 1e9;
  const k = 7;
  const tmax = min(0.9, dist);
  for (let i = 0; i < 72 && t < tmax; i++) {
    const hh = sceneSDF(ox + lx * t, oy + ly * t, oz + lz * t);
    if (hh < 0.0002) return 0;
    const yy = (hh * hh) / (2 * ph);
    const d = sqrt(max(0, hh * hh - yy * yy));
    res = min(res, (k * d) / max(1e-5, t - yy));
    ph = hh;
    t += clamp(hh * 0.85, 0.0015, 0.05);
  }
  return clamp(res, 0, 1);
}
function clamp(x, a, b) {
  return x < a ? a : x > b ? b : x;
}
function curvature(f, px, py, pz, n) {
  // average SDF around the point in its tangent plane: > 0 on convex edges
  let tx = abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let ux = [n[1] * tx[2] - n[2] * tx[1], n[2] * tx[0] - n[0] * tx[2], n[0] * tx[1] - n[1] * tx[0]];
  let l = hypot(...ux);
  ux = ux.map((c) => c / l);
  const vx = [n[1] * ux[2] - n[2] * ux[1], n[2] * ux[0] - n[0] * ux[2], n[0] * ux[1] - n[1] * ux[0]];
  const r = 0.0035;
  let s = 0;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const c = Math.cos(a) * r, d = Math.sin(a) * r;
    s += f(px + ux[0] * c + vx[0] * d, py + ux[1] * c + vx[1] * d, pz + ux[2] * c + vx[2] * d);
  }
  return s / 6 / r;
}
function brushTangent(brush, p, n) {
  let t;
  if (brush.type === 'axis') t = brush.v;
  else {
    const c = brush.c, v = brush.v;
    const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
    t = [v[1] * d[2] - v[2] * d[1], v[2] * d[0] - v[0] * d[2], v[0] * d[1] - v[1] * d[0]];
  }
  const dn = t[0] * n[0] + t[1] * n[1] + t[2] * n[2];
  let x = t[0] - n[0] * dn, y = t[1] - n[1] * dn, z = t[2] - n[2] * dn;
  let l = hypot(x, y, z);
  if (l < 1e-4) {
    // fall back to horizontal circumferential
    x = -n[2]; y = 0; z = n[0];
    l = hypot(x, y, z) || 1;
  }
  return [x / l, y / l, z / l];
}

/* --------------------------------------------------------------- build --- */

const meshes = [];
for (let pi = 0; pi < PARTS.length; pi++) {
  const part = PARTS[pi];
  if (ONLY && !ONLY.includes(part.name) && !part.core && !part.head) {
    // look-dev builds: skip parts that were not asked for (cores and head still occlude)
    meshes.push({ pos: new Float32Array(0), tris: new Uint32Array(0), h: 0 });
    continue;
  }
  const m = surfaceNets(part);
  const P = m.pos;
  let bx0 = 1e9, by0 = 1e9, bz0 = 1e9, bx1 = -1e9, by1 = -1e9, bz1 = -1e9;
  for (let i = 0; i < P.length; i += 3) {
    bx0 = min(bx0, P[i]); bx1 = max(bx1, P[i]);
    by0 = min(by0, P[i + 1]); by1 = max(by1, P[i + 1]);
    bz0 = min(bz0, P[i + 2]); bz1 = max(bz1, P[i + 2]);
  }
  const c = [(bx0 + bx1) / 2, (by0 + by1) / 2, (bz0 + bz1) / 2];
  bounds[pi] = [...c, hypot(bx1 - bx0, by1 - by0, bz1 - bz0) / 2 + 0.004];
  meshes.push(m);
  log(`${part.name}: ${P.length / 3} verts, ${m.tris.length / 3} tris (h=${(m.h * 1000).toFixed(1)}mm)`);
}

const out = [];
let totalTris = 0, totalVerts = 0;
for (let pi = 0; pi < PARTS.length; pi++) {
  const part = PARTS[pi];
  const { pos, tris } = meshes[pi];
  const nv = pos.length / 3;
  const f = part.sdf;
  const normals = new Float32Array(nv * 3);
  const keepV = new Uint8Array(nv);
  const hidden = new Uint8Array(nv);
  CFG = CONFIGS.closed;
  for (let v = 0; v < nv; v++) {
    const x = pos[3 * v], y = pos[3 * v + 1], z = pos[3 * v + 2];
    const g = grad(f, x, y, z);
    normals[3 * v] = g[0]; normals[3 * v + 1] = g[1]; normals[3 * v + 2] = g[2];
    // hidden: never visible in any helmet configuration
    if (part.rig) hidden[v] = 0;
    // the face half is kept whole so the padding's edge never shows a cut line
    else if (part.head) hidden[v] = padSDF(x, y, z) < -0.0012 || neckSuitSDF(x, y, z) < -0.0005 ? 1 : 0;
    else if (part.name === 'padding') {
      const gh = grad(headSDF, x, y, z);
      const facesHead = g[0] * gh[0] + g[1] * gh[1] + g[2] * gh[2] < -0.5;
      hidden[v] = staticPlateSDF(x, y, z) < -0.0004 || (facesHead && headSDF(x, y, z) < -0.0008) ? 1 : 0;
    } else if (part.core) hidden[v] = staticPlateSDF(x, y, z) < -0.0004 || padSDF(x, y, z) < -0.0004 ? 1 : 0;
    else hidden[v] = coreSDF(x, y, z) < -0.0006 ? 1 : 0;
  }
  const kept = [];
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    if (hidden[a] && hidden[b] && hidden[c]) continue;
    const cy = (pos[3 * a + 1] + pos[3 * b + 1] + pos[3 * c + 1]) / 3;
    if (cy < -0.66) continue;
    // drop surfaces facing away from every camera position on the path
    const cx = (pos[3 * a] + pos[3 * b] + pos[3 * c]) / 3;
    const cz = (pos[3 * a + 2] + pos[3 * b + 2] + pos[3 * c + 2]) / 3;
    const nx = normals[3 * a] + normals[3 * b] + normals[3 * c];
    const ny = normals[3 * a + 1] + normals[3 * b + 1] + normals[3 * c + 1];
    const nz = normals[3 * a + 2] + normals[3 * b + 2] + normals[3 * c + 2];
    let visible = !!part.rig;
    for (const C of CAMS) {
      const dx = C[0] - cx, dy = C[1] - cy, dz = C[2] - cz;
      if ((nx * dx + ny * dy + nz * dz) / (hypot(nx, ny, nz) * hypot(dx, dy, dz) + 1e-9) > -0.12) visible = true;
    }
    if (!visible) continue;
    // fix winding against the SDF normal
    const ax = pos[3 * b] - pos[3 * a], ay = pos[3 * b + 1] - pos[3 * a + 1], az = pos[3 * b + 2] - pos[3 * a + 2];
    const bxv = pos[3 * c] - pos[3 * a], byv = pos[3 * c + 1] - pos[3 * a + 1], bzv = pos[3 * c + 2] - pos[3 * a + 2];
    const fx = ay * bzv - az * byv, fy = az * bxv - ax * bzv, fz = ax * byv - ay * bxv;
    if (fx * nx + fy * ny + fz * nz < 0) kept.push(a, c, b);
    else kept.push(a, b, c);
    keepV[a] = keepV[b] = keepV[c] = 1;
  }
  // compact
  const remap = new Int32Array(nv).fill(-1);
  let n = 0;
  for (let v = 0; v < nv; v++) if (keepV[v]) remap[v] = n++;
  const P = new Float32Array(n * 3);
  const Nn = new Int16Array(n * 3);
  const T = new Int8Array(n * 3);
  const bake = new Uint8Array(n * 4);
  const curv = new Int8Array(n);
  CFG = part.bake === 'open' ? CONFIGS.open : CONFIGS.closed;
  for (let v = 0; v < nv; v++) {
    const r = remap[v];
    if (r < 0) continue;
    const p = [pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]];
    const nn = [normals[3 * v], normals[3 * v + 1], normals[3 * v + 2]];
    P.set(p, 3 * r);
    Nn[3 * r] = Math.round(nn[0] * 32767);
    Nn[3 * r + 1] = Math.round(nn[1] * 32767);
    Nn[3 * r + 2] = Math.round(nn[2] * 32767);
    const tg = brushTangent(part.brush, p, nn);
    T[3 * r] = Math.round(tg[0] * 127);
    T[3 * r + 1] = Math.round(tg[1] * 127);
    T[3 * r + 2] = Math.round(tg[2] * 127);
    if (QUICK) {
      bake.set([255, 255, 255, 255], 4 * r);
    } else {
      bake[4 * r] = Math.round(bakeAO(...p, nn) * 255);
      bake[4 * r + 1] = Math.round(bakeShadow(...p, nn, LIGHTS.key) * 255);
      bake[4 * r + 2] = Math.round(bakeShadow(...p, nn, LIGHTS.rimR) * 255);
      bake[4 * r + 3] = Math.round(bakeShadow(...p, nn, LIGHTS.rimL) * 255);
    }
    curv[r] = Math.round(clamp(curvature(f, ...p, nn) * 2.5, -1, 1) * 127);
  }
  const I = new Uint32Array(kept.length);
  for (let i = 0; i < kept.length; i++) I[i] = remap[kept[i]];
  out.push({ part, P, Nn, T, bake, curv, I });
  totalTris += I.length / 3;
  totalVerts += n;
  log(`baked ${part.name}: ${n} verts, ${I.length / 3} tris`);
}

// pack
const chunks = [];
let offset = 0;
const manifest = { parts: [], seams: seamDefs(), lights: LIGHTS, geo: GEO };
const add = (arr) => {
  const pad = (4 - (offset % 4)) % 4;
  if (pad) {
    chunks.push(Buffer.alloc(pad));
    offset += pad;
  }
  const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
  chunks.push(buf);
  const o = offset;
  offset += buf.length;
  return [o, arr.length];
};
for (const o of out) {
  manifest.parts.push({
    name: o.part.name,
    mat: o.part.mat,
    core: !!o.part.core,
    rig: o.part.rig || null,
    head: !!o.part.head,
    position: add(o.P),
    normal: add(o.Nn),
    tangent: add(o.T),
    bake: add(o.bake),
    curv: add(o.curv),
    index: add(o.I),
  });
}
mkdirSync(OUT, { recursive: true });
writeFileSync(new URL('model.bin', OUT), Buffer.concat(chunks));
writeFileSync(new URL('model.json', OUT), JSON.stringify(manifest));
log(`done: ${totalVerts} verts, ${totalTris} tris, ${(offset / 1e6).toFixed(1)} MB`);
