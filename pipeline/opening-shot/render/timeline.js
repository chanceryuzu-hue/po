// The shot, as a pure function of time (seconds). Everything that moves or
// changes intensity is defined here so any frame can be rendered on its own.

export const DURATION = 12;
export const FPS = 24;

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lin = (a, b, x) => clamp((x - a) / (b - a), 0, 1);
const smooth = (a, b, x) => {
  const t = lin(a, b, x);
  return t * t * (3 - 2 * t);
};
const smoother = (a, b, x) => {
  const t = lin(a, b, x);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const easeOut = (a, b, x) => 1 - (1 - lin(a, b, x)) ** 3;
const mix = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => a.map((v, i) => mix(v, b[i], t));

/** Power-on flicker for the first light: one value per frame-sized step. */
function browFlicker(t) {
  const keys = [
    [4.44, 0],
    [4.46, 0.55],
    [4.5, 0.04],
    [4.54, 0.9],
    [4.585, 0.22],
    [4.625, 0.75],
  ];
  if (t < keys[0][0]) return 0;
  let v = 0;
  for (const [kt, kv] of keys) if (t >= kt) v = kv;
  if (t >= 4.625) v = mix(0.75, 1, smooth(4.625, 4.75, t));
  return v;
}

export function shotState(t) {
  // Camera: one continuous push-in that settles before the hold.
  const k = smoother(0, 10.8, t);
  const camPos = mix3([0, 0.035, 2.95], [0, 0.158, 2.02], k);
  const target = mix3([0, 0.1, 0], [0, 0.135, 0], k);

  // Crimson rim lights rise out of black.
  const rimR = smooth(1.1, 4.9, t) ** 1.7;
  const rimL = smooth(1.5, 5.3, t) ** 1.7 * 0.62;

  // Seams: [s0, s1 (lit extent), intensity, ignition-front glow]
  const settle = mix(0.72, 1, smooth(6.0, 9.2, t));
  const breathe = 1 + 0.022 * Math.sin(2 * Math.PI * 0.21 * Math.max(0, t - 8.5)) * smooth(8.5, 9.5, t);
  const seam = (start, dur, base = 1) => {
    if (t < start) return [0, 0, 0, 0];
    const s1 = easeOut(start, start + dur, t);
    const on = smooth(start, start + 0.12, t);
    const front = 1 - smooth(start + dur * 0.7, start + dur + 0.25, t);
    return [0, Math.max(0.02, s1) * 1.04, base * on * settle * breathe, front];
  };
  const brow = (() => {
    const f = browFlicker(t);
    if (f <= 0) return [0, 0, 0, 0];
    const s1 = t < 4.625 ? 0.06 : mix(0.06, 1.04, easeOut(4.625, 5.4, t));
    const front = t < 4.625 ? 0.6 : 1 - smooth(5.0, 5.7, t);
    return [0, s1, f * settle * breathe, front];
  })();
  const seams = {
    brow,
    neck: seam(5.45, 0.55, 0.8),
    sternum: seam(5.85, 0.9, 1),
  };
  const seamTotal = Object.values(seams).reduce((s, v) => s + v[2] * Math.min(1, v[1]), 0) / 3;

  // Soft overhead key reveals the surfaces last.
  const key = smooth(7.0, 9.8, t);
  const ambient = 0.12 + 0.88 * smooth(6.2, 9.6, t);

  return { t, camPos, target, rimR, rimL, seams, seamTotal, key, ambient, fovDeg: 25 };
}
