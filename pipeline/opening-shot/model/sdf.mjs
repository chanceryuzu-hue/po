// Signed-distance model of an original armored hero bust ("the Sentinel").
// Units: metres. y up, z toward the camera, x to image right.
// Every armour plate is a separate SDF so it can be meshed on its own,
// leaving real gaps between plates where the light seams sit.

const { sqrt, abs, min, max, atan2, exp, cos, sin, hypot, PI } = Math;

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export function ss(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
export function smin(a, b, k) {
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return b + (a - b) * h - k * h * (1 - h);
}
export const smax = (a, b, k) => -smin(-a, -b, k);

function ellipsoid(x, y, z, a, b, c) {
  const k0 = sqrt((x / a) ** 2 + (y / b) ** 2 + (z / c) ** 2);
  const k1 = sqrt((x / (a * a)) ** 2 + (y / (b * b)) ** 2 + (z / (c * c)) ** 2);
  return k1 === 0 ? -min(a, b, c) : (k0 * (k0 - 1)) / k1;
}
function capsule(px, py, pz, ax, ay, az, bx, by, bz, r) {
  const pax = px - ax, pay = py - ay, paz = pz - az;
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const h = clamp((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz), 0, 1);
  return hypot(pax - bax * h, pay - bay * h, paz - baz * h) - r;
}

/** Thin plate cut from an outer surface. o: outer distance (already offset), r: region distance (<0 inside). */
function plate(o, r, gap, thick, round, panel = 0, inset = 0.012) {
  // optional raised centre panel, inset from the plate's edges
  if (panel) o -= panel * ss(-inset + 0.0016, -inset - 0.0016, r);
  const a = smax(o, r + gap, round);
  return smax(a, -(o + thick), round * 0.6);
}

/* ================================================================ helmet === */

export const HC = [0, 0.222, 0.004];
const TH_TIP = 1.15;
const W_CREST = 0.0165;

export function helmBase(x, y, z) {
  const yy = y < 0 ? y * 0.82 : y * 1.07; // compact crown, straighter cheeks
  const ty = ss(0.0, -0.12, y);
  const tz = ss(-0.05, 0.07, z);
  const sx = 1 - 0.17 * ty * tz; // narrower jaw
  const cz = 0.012 * ss(-0.03, -0.12, y) * ss(-0.02, 0.06, z); // chin forward
  let d = ellipsoid(x / sx, yy, z - cz, 0.121, 0.15, 0.142) * sx;
  d -= 0.0062 * exp(-(((y - 0.046) / 0.013) ** 2)) * ss(0.02, 0.1, z); // brow ridge
  // faceted muzzle: two planes meeting on a centre ridge, plus a chin plane
  const ax = abs(x);
  const lowFace = ss(0.012, -0.012, y);
  const prow = 0.44 * ax - 0.04 * y + 0.897 * z - (0.124 + 0.2 * (1 - lowFace));
  d = smax(d, prow, 0.006);
  const chin = -0.62 * y + 0.78 * z - 0.17;
  d = smax(d, chin, 0.008);
  // faceted crown: roof planes, flat temples, flat forehead
  d = smax(d, y - 0.129, 0.022);
  d = smax(d, 0.42 * ax + 0.907 * y - 0.137, 0.014);
  d = smax(d, ax - 0.113, 0.016);
  d = smax(d, 0.5 * y + 0.866 * z - 0.133, 0.012);
  return d;
}
export const visorTop = (th) => 0.038 - 0.026 * (th / 1.25) ** 2;
export const visorBot = (th) => 0.006 + 0.012 * (th / 1.25) ** 2;
function crownLine(a) {
  // a = |theta|
  if (a < TH_TIP) return visorTop(a);
  const y0 = visorTop(TH_TIP);
  return y0 - 0.02 * ss(TH_TIP, 2.0, a) - 0.045 * ss(2.2, 3.05, a);
}
const yUpper = (a) => (a < TH_TIP ? visorTop(a) : crownLine(a));
const yLower = (a) => (a < TH_TIP ? visorBot(a) : crownLine(a));
const yBottom = (a) => -0.13 + 0.035 * ss(0.25, 1.5, a) - 0.012 * ss(1.9, 2.9, a);
const thJaw = (y) => 0.93 + 1.6 * y;
const TH_NECK = 2.45;

function helmLocal(px, py, pz) {
  return [px - HC[0], py - HC[1], pz - HC[2]];
}

function crownD(x, y, z) {
  const a = abs(atan2(x, z));
  const ridge = (1 - ss(0.006, 0.026, abs(x))) * ss(-0.06, 0.02, y) * (1 - ss(0.05, 0.12, z) * ss(0.06, 0.03, y));
  const base = helmBase(x, y, z) - 0.0032 * ridge;
  const r = yUpper(a) - y;
  return plate(base, r, 0.0016, 0.012, 0.0014, 0.0011, 0.016);
}
function visorD(x, y, z) {
  const th = atan2(x, z);
  const base = helmBase(x, y, z);
  const r = max(y - visorTop(th), visorBot(th) - y);
  return plate(base + 0.0018, r, 0.0028, 0.012, 0.0012);
}
function faceD(x, y, z) {
  const a = abs(atan2(x, z));
  const rho = hypot(x, z);
  let base = helmBase(x, y, z);
  // centre ridge and a crisp chin facet
  base -= 0.0028 * (1 - ss(0.0, 0.022, abs(x))) * ss(0.0, -0.05, y) * ss(0.0, 0.08, z);
  const r = max(y - yLower(a), (a - thJaw(y)) * rho, yBottom(a) - y);
  return plate(base - 0.0012, r, 0.0018, 0.012, 0.0014);
}
function cheekD(x, y, z, side) {
  const th = atan2(x, z) * side; // positive on this side
  const rho = hypot(x, z);
  const a = abs(th);
  const base = helmBase(x, y, z);
  const r = max(y - yLower(a), (thJaw(y) - th) * rho, (th - TH_NECK) * rho, yBottom(a) - y);
  return plate(base, r, 0.0018, 0.012, 0.0014, 0.0011, 0.01);
}
function neckGuardD(x, y, z) {
  const a = abs(atan2(x, z));
  const rho = hypot(x, z);
  const flare = 0.006 * ss(-0.05, -0.12, y);
  const base = helmBase(x, y, z) - flare;
  const r = max(y - crownLine(a), (TH_NECK - a) * rho, yBottom(a) - 0.01 - y);
  return plate(base, r, 0.0018, 0.012, 0.0014);
}
function helmCoreD(x, y, z) {
  return helmBase(x, y, z) + 0.0068;
}

/* ================================================================= torso === */

const NECK0 = [0, 0.0, -0.012];
const NECKDIR = (() => {
  const v = [0, 1, 0.2];
  const l = hypot(...v);
  return v.map((c) => c / l);
})();

export function torsoBase(x, y, z) {
  const ax = abs(x);
  let d = ellipsoid(x, y + 0.16, z + 0.028, 0.172, 0.245, 0.116);
  d = smin(d, capsule(ax, y, z, 0.035, 0.055, -0.035, 0.17, 0.004, -0.035, 0.046), 0.045);
  d = smin(d, hypot(ax - 0.196, y + 0.042, z + 0.02) - 0.084, 0.04);
  d = smin(d, capsule(ax, y, z, 0.205, -0.06, -0.022, 0.262, -0.5, -0.035, 0.066), 0.03);
  d -= 0.019 * exp(-(((ax - 0.084) / 0.07) ** 2 + ((y + 0.092) / 0.068) ** 2)) * ss(-0.02, 0.07, z);
  return d;
}
const CH = 0.0075; // sternum channel half-width
export const yCol = (ax) => -0.021 + 0.017 * ss(0.01, 0.17, ax) + 0.006 * ss(0.11, 0.17, ax);
export const yLow = (ax) => -0.176 + 0.09 * ss(0.012, 0.165, ax);
const X_SIDE = 0.163;
const neckRho = (x, y, z) => {
  const px = x - NECK0[0], py = y - NECK0[1], pz = z - NECK0[2];
  const h = px * NECKDIR[0] + py * NECKDIR[1] + pz * NECKDIR[2];
  return [hypot(px - NECKDIR[0] * h, py - NECKDIR[1] * h, pz - NECKDIR[2] * h), h];
};

const sideCut = (x, z) => (abs(atan2(x, z + 0.04)) - 1.02) * hypot(x, z + 0.04);
function pecRegion(x, y, z, side) {
  const ax = side * x;
  return max(CH - ax, y - yCol(abs(x)), yLow(abs(x)) - y, sideCut(x, z));
}
function collarRegion(x, y, z, side) {
  const ax = side * x;
  const [rho] = neckRho(x, y, z);
  return max(CH - ax, yCol(abs(x)) - y, ax - X_SIDE, 0.101 - rho, -0.085 - z);
}
function abRegion(x, y, z) {
  return max(y - yLow(abs(x)), sideCut(x, z), -0.62 - y);
}
function pecD(x, y, z, side) {
  return plate(torsoBase(x, y, z), pecRegion(x, y, z, side), 0.0024, 0.014, 0.0018, 0.0016, 0.015);
}
function collarD(x, y, z, side) {
  return plate(torsoBase(x, y, z) - 0.0025, collarRegion(x, y, z, side), 0.0022, 0.014, 0.0016, 0.0012, 0.011);
}
function abD(x, y, z) {
  return plate(torsoBase(x, y, z) + 0.002, abRegion(x, y, z), 0.0024, 0.014, 0.0018, 0.0014, 0.013);
}
const armRegion = (x, y, z) => max(0.168 - abs(x), y + 0.112, -0.62 - y);
function armD(x, y, z, side) {
  return plate(torsoBase(x, y, z) - 0.0015, max(armRegion(x, y, z), -side * x), 0.002, 0.014, 0.0022, 0.0014, 0.013);
}
function backShellD(x, y, z) {
  const ru = min(
    armRegion(x, y, z),
    pecRegion(x, y, z, 1),
    pecRegion(x, y, z, -1),
    collarRegion(x, y, z, 1),
    collarRegion(x, y, z, -1),
    abRegion(x, y, z),
    max(abs(x) - CH, -0.03 - z, y - 0.0), // sternum channel
    neckRho(x, y, z)[0] - 0.101,
  );
  return plate(torsoBase(x, y, z), max(-ru, -0.62 - y), 0.0022, 0.014, 0.0018);
}
function torsoCoreD(x, y, z) {
  return max(torsoBase(x, y, z) + 0.0078, -0.64 - y);
}

/* pauldrons: three lames per shoulder */
const SH = (s) => [s * 0.196, -0.042, -0.02];
const SHAX = (s) => {
  const v = [s * 0.62, 0.78, 0.05];
  const l = hypot(...v);
  return v.map((c) => c / l);
};
function lameD(x, y, z, s, k) {
  const c = SH(s);
  const A = SHAX(s);
  const off = [0, -0.009, -0.018][k];
  const R = [0.121, 0.115, 0.109][k];
  const a0 = [-1, 0.84, 1.18][k];
  const a1 = [0.97, 1.32, 1.66][k];
  const xin = [0.132, 0.148, 0.158][k];
  const cx = c[0] + A[0] * off, cy = c[1] + A[1] * off, cz = c[2] + A[2] * off;
  let vx = x - cx, vy = y - cy, vz = z - cz;
  // squash along the shoulder axis so the lames read as shells, not balls
  const va = vx * A[0] + vy * A[1] + vz * A[2];
  const sq = 0.86;
  vx += A[0] * va * (1 / sq - 1); vy += A[1] * va * (1 / sq - 1); vz += A[2] * va * (1 / sq - 1);
  const l = (hypot(vx, vy, vz) || 1e-6);
  const al = Math.acos(clamp((vx * A[0] + vy * A[1] + vz * A[2]) / l, -1, 1));
  const r = max(al - a1, a0 - al) * l;
  const rr = max(r, xin - s * x);
  return plate((l - R) * sq, rr, 0.0015, 0.011, 0.0022, k === 0 ? 0.0012 : 0, 0.013);
}

/* gorget rings around the neck */
function ringD(x, y, z, k) {
  const [rho, h] = neckRho(x, y, z);
  const h0 = [0.009, 0.041][k];
  const h1 = [0.05, 0.088][k];
  const r0 = [0.099, 0.085][k];
  const r1 = [0.088, 0.074][k];
  const t = clamp((h - h0) / (h1 - h0), 0, 1);
  const rad = r0 + (r1 - r0) * t;
  const dr = rho - rad;
  const dh = max(h0 - h, h - h1);
  const outer = smax(dr, dh, 0.0016);
  return smax(outer, -(dr + 0.012), 0.001);
}
function neckSuitD(x, y, z) {
  const [rho, h] = neckRho(x, y, z);
  const r = 0.06 + 0.0011 * cos((h * 2 * PI) / 0.0075);
  const hc = clamp(h, -0.03, 0.2);
  return max(hypot(rho, h - hc) - r, -0.04 - h);
}

/* ================================================================ parts === */

const local = (f) => (x, y, z) => {
  const [a, b, c] = helmLocal(x, y, z);
  return f(a, b, c);
};

// material: 0 graphite, 1 platinum, 2 visor, 3 undersuit
// brush: { type: 'axis' | 'around', v: [x,y,z], c?: [x,y,z] }
const HB = [HC[0] - 0.13, HC[1] - 0.17, HC[2] - 0.15, HC[0] + 0.13, HC[1] + 0.16, HC[2] + 0.17];
export const PARTS = [
  { name: 'crown', mat: 0, res: 0.0014, bbox: HB, sdf: local(crownD), brush: { type: 'axis', v: [0, 0, 1] } },
  { name: 'visor', mat: 2, res: 0.0011, bbox: HB, sdf: local(visorD), brush: { type: 'around', v: [0, 1, 0], c: HC } },
  { name: 'face', mat: 1, res: 0.0013, bbox: HB, sdf: local(faceD), brush: { type: 'around', v: [0, 1, 0], c: HC } },
  { name: 'cheekR', mat: 0, res: 0.0014, bbox: HB, sdf: local((x, y, z) => cheekD(x, y, z, 1)), brush: { type: 'axis', v: [0, 0.3, 1] } },
  { name: 'cheekL', mat: 0, res: 0.0014, bbox: HB, sdf: local((x, y, z) => cheekD(x, y, z, -1)), brush: { type: 'axis', v: [0, 0.3, 1] } },
  { name: 'neckGuard', mat: 0, res: 0.0014, bbox: HB, sdf: local(neckGuardD), brush: { type: 'around', v: [0, 1, 0], c: HC } },
  { name: 'helmCore', mat: 3, res: 0.002, bbox: HB, sdf: local(helmCoreD), brush: { type: 'around', v: [0, 1, 0], c: HC }, core: true },

  { name: 'ring0', mat: 1, res: 0.0012, bbox: [-0.12, -0.03, -0.13, 0.12, 0.08, 0.13], sdf: (x, y, z) => ringD(x, y, z, 0), brush: { type: 'around', v: NECKDIR, c: NECK0 } },
  { name: 'ring1', mat: 0, res: 0.0012, bbox: [-0.1, 0.02, -0.12, 0.1, 0.11, 0.12], sdf: (x, y, z) => ringD(x, y, z, 1), brush: { type: 'around', v: NECKDIR, c: NECK0 } },
  { name: 'neckSuit', mat: 3, res: 0.002, bbox: [-0.08, -0.06, -0.1, 0.08, 0.24, 0.12], sdf: neckSuitD, brush: { type: 'around', v: NECKDIR, c: NECK0 }, core: true },

  { name: 'pecR', mat: 0, res: 0.0018, bbox: [0.0, -0.28, -0.06, 0.2, 0.03, 0.14], sdf: (x, y, z) => pecD(x, y, z, 1), brush: { type: 'axis', v: [1, 0, 0] } },
  { name: 'pecL', mat: 0, res: 0.0018, bbox: [-0.2, -0.28, -0.06, 0.0, 0.03, 0.14], sdf: (x, y, z) => pecD(x, y, z, -1), brush: { type: 'axis', v: [1, 0, 0] } },
  { name: 'collarR', mat: 1, res: 0.0016, bbox: [0.0, -0.06, -0.12, 0.2, 0.09, 0.1], sdf: (x, y, z) => collarD(x, y, z, 1), brush: { type: 'axis', v: [1, 0, 0] } },
  { name: 'collarL', mat: 1, res: 0.0016, bbox: [-0.2, -0.06, -0.12, 0.0, 0.09, 0.1], sdf: (x, y, z) => collarD(x, y, z, -1), brush: { type: 'axis', v: [1, 0, 0] } },
  { name: 'ab', mat: 0, res: 0.0026, bbox: [-0.2, -0.64, -0.06, 0.2, -0.12, 0.14], sdf: abD, brush: { type: 'axis', v: [1, 0, 0] } },
  { name: 'armR', mat: 0, res: 0.003, bbox: [0.14, -0.64, -0.13, 0.36, -0.08, 0.08], sdf: (x, y, z) => armD(x, y, z, 1), brush: { type: 'axis', v: [0, 1, 0] } },
  { name: 'armL', mat: 0, res: 0.003, bbox: [-0.36, -0.64, -0.13, -0.14, -0.08, 0.08], sdf: (x, y, z) => armD(x, y, z, -1), brush: { type: 'axis', v: [0, 1, 0] } },
  { name: 'backShell', mat: 0, res: 0.003, bbox: [-0.36, -0.64, -0.17, 0.36, 0.1, 0.06], sdf: backShellD, brush: { type: 'around', v: [0, 1, 0], c: [0, 0, -0.03] } },
  { name: 'torsoCore', mat: 3, res: 0.003, bbox: [-0.36, -0.64, -0.17, 0.36, 0.1, 0.12], sdf: torsoCoreD, brush: { type: 'around', v: [0, 1, 0], c: [0, 0, -0.03] }, core: true },
];
for (const s of [1, -1]) {
  for (let k = 0; k < 3; k++) {
    const c = SH(s);
    PARTS.push({
      name: `lame${s > 0 ? 'R' : 'L'}${k}`,
      mat: k === 0 ? 0 : 0,
      res: 0.0018,
      bbox: [c[0] - 0.15, c[1] - 0.16, c[2] - 0.15, c[0] + 0.15, c[1] + 0.15, c[2] + 0.15],
      sdf: (x, y, z) => lameD(x, y, z, s, k),
      brush: { type: 'around', v: SHAX(s), c },
    });
  }
}

/* ================================================================ seams === */

/** Point on a part's surface found by bisection along a ray from `o` in direction `d`. */
export function surfaceAlong(f, o, d, r0, r1) {
  let a = r0, b = r1;
  const fa = f(o[0] + d[0] * a, o[1] + d[1] * a, o[2] + d[2] * a);
  for (let i = 0; i < 60; i++) {
    const m = (a + b) / 2;
    const fm = f(o[0] + d[0] * m, o[1] + d[1] * m, o[2] + d[2] * m);
    if (Math.sign(fm) === Math.sign(fa)) a = m;
    else b = m;
  }
  const t = (a + b) / 2;
  return [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
}

export function seamDefs() {
  const seams = [];
  // Brow: along the top edge of the visor, inset into the gap. s = 0 at centre, 1 at the tips.
  {
    const pts = [];
    const N = 31;
    for (let i = 0; i < N; i++) {
      const th = -TH_TIP * 0.96 + ((2 * TH_TIP * 0.96) * i) / (N - 1);
      const y = visorTop(th) + 0.0004;
      const dir = [sin(th), 0, cos(th)];
      const p = surfaceAlong((x, yy, z) => helmBase(x, yy, z) + 0.0035, [0, y, 0], dir, 0.0, 0.2);
      pts.push({ p: [p[0] + HC[0], p[1] + HC[1], p[2] + HC[2]], s: abs(th) / (TH_TIP * 0.96) });
    }
    seams.push({ name: 'brow', radius: 0.0011, pts });
  }
  // Neck: front arc under the lower gorget ring.
  {
    const pts = [];
    const N = 25;
    for (let i = 0; i < N; i++) {
      const th = -1.45 + (2.9 * i) / (N - 1);
      const h = 0.0075;
      const rho = 0.1005;
      // build an orthonormal frame around the neck axis
      const ux = [1, 0, 0];
      const uz = [0, -NECKDIR[2], NECKDIR[1]];
      const p = [
        NECK0[0] + NECKDIR[0] * h + rho * (ux[0] * sin(th) + uz[0] * cos(th)),
        NECK0[1] + NECKDIR[1] * h + rho * (ux[1] * sin(th) + uz[1] * cos(th)),
        NECK0[2] + NECKDIR[2] * h + rho * (ux[2] * sin(th) + uz[2] * cos(th)),
      ];
      pts.push({ p, s: abs(th) / 1.45 });
    }
    seams.push({ name: 'neck', radius: 0.0012, pts });
  }
  // Sternum: down the channel between the chest plates. s = 0 at the top.
  {
    const pts = [];
    const N = 14;
    const y0 = -0.03, y1 = -0.168;
    for (let i = 0; i < N; i++) {
      const y = y0 + ((y1 - y0) * i) / (N - 1);
      const p = surfaceAlong((x, yy, z) => torsoBase(x, yy, z) + 0.0045, [0, y, -0.1], [0, 0, 1], 0, 0.3);
      pts.push({ p, s: i / (N - 1) });
    }
    seams.push({ name: 'sternum', radius: 0.0016, pts });
  }
  // (Clavicle and lower-chest seams were tried and removed: too graphic.)
  for (const side of []) {
    for (const kind of ['clav', 'low']) {
      const pts = [];
      const N = 16;
      for (let i = 0; i < N; i++) {
        const ax = CH + 0.004 + ((0.145 - CH) * i) / (N - 1);
        const y = kind === 'clav' ? yCol(ax) : yLow(ax);
        const p = surfaceAlong((x, yy, z) => torsoBase(x, yy, z) + 0.0045, [side * ax, y, -0.1], [0, 0, 1], 0, 0.3);
        pts.push({ p, s: i / (N - 1) });
      }
      seams.push({ name: `${kind}${side > 0 ? 'R' : 'L'}`, radius: 0.0012, pts });
    }
  }
  return seams;
}
