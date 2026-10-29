// The portrait's glasses, redrawn as a red laser frame.
//
// The outline was traced from the photo (pipeline/portrait/prep-portrait.py),
// which also removed the original thin rims and nose pads. Here the frame is
// rebuilt in two parts:
//   - solid parts, painted into the face layer so they take the same light
//     and shading as the face: a graphite browline over the clear one, the
//     bridge, a light red tint in the lenses and the red light the lasers
//     throw on the skin;
//   - light, drawn on top every frame: the halo, the laser lines around each
//     lens and along the bridge, and a scan line that crosses the lenses.
// All geometry stays in the photo's pixels; the portrait's fit (rotation,
// uniform scale, shift) carries it onto the helmet.
import type { Pt } from './face';

export interface EyewearGeo {
  size: [number, number];
  lenses: Pt[][];
  brow: Pt[][];
  bridge: Pt[];
}
export interface Fit {
  a: number;
  b: number;
  e: number;
  f: number;
  scale: number;
}
export interface Eyewear {
  /** halo and lens glow, in face-layer pixels; drawn with 'lighter' */
  glow: HTMLCanvasElement;
  /** laser lines and lens outlines, in photo pixels (apply `fit`) */
  lines: Path2D;
  lenses: Path2D;
  /** the outermost point of each lens, photo pixels (where the readouts are projected from) */
  outer: [Pt, Pt];
  /** vertical extent of the lenses, photo pixels */
  lensTop: number;
  lensBottom: number;
  lensLeft: number;
  lensRight: number;
  fit: Fit;
  color: string;
}

const path = (pts: Pt[], closed: boolean, p = new Path2D()) => {
  pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
  if (closed) p.closePath();
  return p;
};

/** The part of a lens outline above `frac` of its height, left to right. */
function topArc(lens: Pt[], frac: number): Pt[] {
  const ys = lens.map((p) => p[1]);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const thr = y0 + (y1 - y0) * frac;
  // start the walk at the lowest point, so the top run is in one piece
  const start = ys.indexOf(y1);
  const ring = lens.slice(start).concat(lens.slice(0, start));
  const run = ring.filter((p) => p[1] < thr);
  return run[0][0] < run[run.length - 1][0] ? run : run.reverse();
}

function rgba(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function buildEyewear(
  geo: EyewearGeo,
  fit: Fit,
  face: HTMLCanvasElement,
  mask: CanvasImageSource,
  color = '#ff2a36',
): Eyewear {
  const w = face.width, h = face.height;
  const k = 1 / fit.scale; // one face-layer pixel, in photo pixels
  const lenses = new Path2D();
  for (const l of geo.lenses) path(l, true, lenses);
  const all = geo.lenses.flat();
  const lensTop = Math.min(...all.map((p) => p[1]));
  const lensBottom = Math.max(...all.map((p) => p[1]));
  const lensLeft = Math.min(...all.map((p) => p[0]));
  const lensRight = Math.max(...all.map((p) => p[0]));

  // browline: from the top edge of the old clear browline down to just under each
  // lens' upper rim (the clear frame held the lens from in front)
  const bands = geo.brow.map((brow, i) => {
    const arc = topArc(geo.lenses[i], 0.16).map(([x, y]) => [x, y + 6] as Pt);
    return path(brow.concat(arc.reverse()), true);
  });

  const ctx = face.getContext('2d')!;
  const toPhoto = () => ctx.setTransform(fit.a, fit.b, -fit.b, fit.a, fit.e, fit.f);

  // 1. lens tint: a little darker and redder behind the glass
  ctx.save();
  toPhoto();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = 'rgb(232, 196, 200)';
  ctx.fill(lenses);
  ctx.restore();

  // 2. red light on the skin around the frame (kept inside the face)
  const spill = document.createElement('canvas');
  spill.width = w;
  spill.height = h;
  const sc = spill.getContext('2d')!;
  sc.setTransform(fit.a, fit.b, -fit.b, fit.a, fit.e, fit.f);
  sc.strokeStyle = rgba(color, 0.55);
  sc.lineJoin = 'round';
  sc.shadowColor = color;
  sc.shadowBlur = 16; // shadowBlur ignores the transform: face-layer pixels
  sc.lineWidth = 8 * k;
  for (const l of geo.lenses) sc.stroke(path(l, true));
  sc.stroke(path(geo.bridge, false));
  sc.setTransform(1, 0, 0, 1, 0, 0);
  sc.globalCompositeOperation = 'destination-in';
  sc.drawImage(mask, 0, 0, w, h);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.5;
  ctx.drawImage(spill, 0, 0);
  ctx.restore();

  // 3. the solid frame: graphite browline and bridge, lit from the brow light above
  ctx.save();
  toPhoto();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 2;
  for (const band of bands) {
    const g = ctx.createLinearGradient(0, lensTop - 22, 0, lensTop + 14);
    g.addColorStop(0, '#4a4e55');
    g.addColorStop(0.35, '#24272b');
    g.addColorStop(1, '#0d0e10');
    ctx.fillStyle = g;
    ctx.fill(band);
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#111214';
  ctx.lineWidth = 9;
  ctx.stroke(path(geo.bridge, false));
  ctx.shadowColor = 'transparent';
  // a thin highlight along the top edges, where the brow light catches them
  ctx.strokeStyle = 'rgba(235, 240, 245, 0.45)';
  ctx.lineWidth = 1.4 * k;
  for (const b of geo.brow) ctx.stroke(path(b, false));
  ctx.strokeStyle = 'rgba(235, 240, 245, 0.3)';
  ctx.lineWidth = 1 * k;
  ctx.stroke(path(geo.bridge.map(([x, y]) => [x, y - 3] as Pt), false));
  ctx.restore();

  // 4. the glow: a halo around the laser lines and a red band across the top of each lens
  const glow = document.createElement('canvas');
  glow.width = w;
  glow.height = h;
  const gc = glow.getContext('2d')!;
  gc.setTransform(fit.a, fit.b, -fit.b, fit.a, fit.e, fit.f);
  gc.save();
  gc.clip(lenses);
  const band = gc.createLinearGradient(0, lensTop, 0, lensTop + (lensBottom - lensTop) * 0.42);
  band.addColorStop(0, rgba(color, 0.3));
  band.addColorStop(0.35, rgba(color, 0.08));
  band.addColorStop(1, rgba(color, 0));
  gc.fillStyle = band;
  gc.fillRect(lensLeft, lensTop, lensRight - lensLeft, lensBottom - lensTop);
  gc.restore();
  gc.lineJoin = 'round';
  gc.lineCap = 'round';
  const lines = new Path2D();
  for (const l of geo.lenses) path(l, true, lines);
  path(geo.bridge, false, lines);
  for (const [width, alpha, blur] of [
    [7, 0.14, 18],
    [3, 0.38, 6],
  ]) {
    gc.strokeStyle = rgba(color, alpha);
    gc.shadowColor = rgba(color, Math.min(1, alpha * 2));
    gc.shadowBlur = blur;
    gc.lineWidth = width * k;
    gc.stroke(lines);
  }

  const byX = (l: Pt[], dir: number) => l.reduce((m, p) => ((p[0] - m[0]) * dir > 0 ? p : m), l[0]);
  const outer: [Pt, Pt] = [byX(geo.lenses[0], -1), byX(geo.lenses[geo.lenses.length - 1], 1)];
  return { glow, lines, lenses, outer, lensTop, lensBottom, lensLeft, lensRight, fit, color };
}

/**
 * Draws the light of the frame onto `ctx` (canvas pixels = face-layer pixels × sx).
 * `power` 0..1 scales everything; `scanT` 0..1 places the scan line (or < 0 for none).
 */
export function drawEyewearLight(ctx: CanvasRenderingContext2D, ew: Eyewear, sx: number, power: number, scanT: number) {
  if (power <= 0.001) return;
  const { a, b, e, f, scale } = ew.fit;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = power;
  ctx.drawImage(ew.glow, 0, 0, ew.glow.width * sx, ew.glow.height * sx);
  ctx.setTransform(sx * a, sx * b, -sx * b, sx * a, sx * e, sx * f);
  const px = 1 / (scale * sx); // one canvas pixel, in photo pixels
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = ew.color;
  ctx.lineWidth = Math.max(1.4 * px, 1.8);
  ctx.stroke(ew.lines);
  ctx.strokeStyle = 'rgba(255, 222, 222, 0.95)'; // the hot core of the beam
  ctx.lineWidth = Math.max(0.6 * px, 0.7);
  ctx.stroke(ew.lines);
  if (scanT >= 0) {
    // a faint sweep down the lenses, like a readout refreshing
    const y = ew.lensTop + (ew.lensBottom - ew.lensTop) * scanT;
    const hh = 22;
    const fade = Math.sin(Math.PI * scanT);
    ctx.clip(ew.lenses);
    const g = ctx.createLinearGradient(0, y - hh, 0, y + 1.5);
    g.addColorStop(0, rgba(ew.color, 0));
    g.addColorStop(0.9, rgba(ew.color, 0.16 * fade));
    g.addColorStop(1, `rgba(255, 210, 210, ${0.32 * fade})`);
    ctx.fillStyle = g;
    ctx.fillRect(ew.lensLeft, y - hh, ew.lensRight - ew.lensLeft, hh + 1.5);
  }
  ctx.restore();
}
