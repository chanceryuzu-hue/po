// The helmet release mechanism and the shot cameras, shared by the model
// builder (Node) and the renderer (browser). Pure math, no dependencies.
//
// Coordinates: metres, world space. y up, z towards the default camera.
// A rig pose is a rigid 3x4 matrix per moving part, row-major
// [r00 r01 r02 tx, r10 r11 r12 ty, r20 r21 r22 tz].

export const HC = [0, 0.222, 0.004]; // helmet centre

/* ----------------------------------------------------------- matrices --- */
const I = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
const T = (x, y, z) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z];
function mul(a, b) {
  const o = new Array(12);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      let v = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c];
      if (c === 3) v += a[r * 4 + 3];
      o[r * 4 + c] = v;
    }
  }
  return o;
}
/** Rotation by angle about a unit axis through point p. */
function rotAbout(axis, angle, p) {
  const [x, y, z] = axis;
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  const R = [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y, 0,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x, 0,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c, 0,
  ];
  return mul(T(p[0], p[1], p[2]), mul(R, T(-p[0], -p[1], -p[2])));
}
export function apply(m, p) {
  return [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
    m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
    m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
  ];
}
/** Inverse of a rigid transform. */
export function invert(m) {
  const r = [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]]; // transpose
  const t = [m[3], m[7], m[11]];
  return [
    r[0], r[1], r[2], -(r[0] * t[0] + r[1] * t[1] + r[2] * t[2]),
    r[3], r[4], r[5], -(r[3] * t[0] + r[4] * t[1] + r[5] * t[2]),
    r[6], r[7], r[8], -(r[6] * t[0] + r[7] * t[1] + r[8] * t[2]),
  ];
}
const norm = (v) => {
  const l = Math.hypot(...v);
  return v.map((c) => c / l);
};

/* ---------------------------------------------------------- the rig ---- */

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const seg = (a, b, x) => clamp((x - a) / (b - a), 0, 1);
const inOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const outQuad = (t) => 1 - (1 - t) * (1 - t);

// Mechanism geometry (helmet-local values are offset by HC below).
export const PIN = {
  theta: 1.12, // radians around the helmet from the front
  y: 0.0161, // helmet-local height of the pins
  radius: 0.0024,
  stroke: 0.0025, // how far the pins sink when unlocking
};
export const VISOR = { slide: 0.02, lift: (50 * Math.PI) / 180 };
export const FACEPLATE = { unseat: 0.012, swing: (98 * Math.PI) / 180, dock: 0.018 };

/**
 * Release progress p (0 sealed → 1 open) to the stage values of each move.
 * Everything is a pure function of p, so any pose can be rendered alone.
 */
export function stages(p) {
  return {
    pins: inOut(seg(0.0, 0.12, p)),
    slide: inOut(seg(0.08, 0.32, p)),
    lift: inOut(seg(0.26, 0.74, p)),
    unseat: inOut(seg(0.16, 0.38, p)),
    swing: inOut(seg(0.34, 0.95, p)),
    dock: outQuad(seg(0.6, 1.0, p)),
  };
}

/**
 * Rig matrices for release progress p. `pinBase` and `pinNormal` (per side)
 * and the faceplate centroid directions come from the model build so the
 * renderer and the baker agree exactly.
 */
export function rigPose(p, geo) {
  const st = stages(p);
  const out = {};
  // latch pins sink along their own axis
  for (const side of ['R', 'L']) {
    const n = geo.pinNormal[side];
    const d = -PIN.stroke * st.pins;
    out[`pin${side}`] = T(n[0] * d, n[1] * d, n[2] * d);
  }
  // visor: slide out of its recess, then pivot up about the pin axis
  const nV = geo.visorNormal;
  const s = VISOR.slide * st.slide;
  const slide = T(nV[0] * s, nV[1] * s, nV[2] * s);
  const pivot = [geo.pivot[0] + nV[0] * s, geo.pivot[1] + nV[1] * s, geo.pivot[2] + nV[2] * s];
  out.visor = mul(rotAbout([1, 0, 0], -VISOR.lift * st.lift, pivot), slide);
  // faceplate halves: unseat along their normal, swing back around the
  // helmet's vertical axis, then draw in to dock against the cheek plates
  for (const side of ['R', 'L']) {
    const sg = side === 'R' ? 1 : -1;
    const nF = geo.faceNormal[side];
    const u = FACEPLATE.unseat * st.unseat;
    const unseat = T(nF[0] * u, nF[1] * u, nF[2] * u);
    const swing = rotAbout([0, 1, 0], sg * FACEPLATE.swing * st.swing, HC);
    // radial pull-in, along the half's final horizontal direction
    const c = geo.faceCentroid[side];
    const cs = apply(mul(swing, unseat), c);
    const dir = norm([cs[0] - HC[0], 0, cs[2] - HC[2]]);
    const k = -FACEPLATE.dock * st.dock;
    out[`face${side}`] = mul(T(dir[0] * k, 0, dir[2] * k), mul(swing, unseat));
  }
  return out;
}

export const RIGS = ['pinR', 'pinL', 'visor', 'faceR', 'faceL'];
export const identity = I;

/* ------------------------------------------------------------ cameras --- */
// Every page view is a window onto one virtual image plane per camera, so
// the desktop frame, the portrait frame and the helmet crops line up pixel
// for pixel (lens shift, not re-framing).
export const CAMERAS = {
  helmet: {
    pos: [0, 0.205, 1.18],
    target: [0, 0.172, 0],
    fov: 25, // vertical, over `fullH` pixels
    fullH: 1440,
  },
  core: {
    pos: [0.16, -0.035, 0.52],
    target: [0.0, -0.1, 0.09],
    fov: 25,
    fullH: 1440,
  },
  final: {
    pos: [-0.4, -0.34, 1.42],
    target: [0.03, 0.13, 0],
    fov: 25,
    fullH: 1440,
  },
};
/** Camera positions used to cull surfaces nobody ever sees. */
export const CULL_CAMERAS = [
  [0, 0.035, 2.95],
  [0, 0.158, 2.02],
  CAMERAS.helmet.pos,
  CAMERAS.core.pos,
  CAMERAS.final.pos,
];
