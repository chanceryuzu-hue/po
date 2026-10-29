// Builds the face layer that sits behind the helmet panels in Scene 03.
//
// With a portrait: the photo is fitted to the helmet's landmarks with a
// rotation and uniform scale only (proportions are never stretched). Its own
// large-scale lighting is divided out and replaced with the scene's: a render
// of the light falling on the head inside the open helmet (key, fill, the
// brow light and the padding's shadow). Fine detail comes from the photo.
// The result goes through the renderer's film grade.
//
// Without one: the rendered placeholder head is used as is.
import { grade, toLinear } from './grade';

export type Pt = [number, number];

export interface FaceTargets {
  /** Landmarks in the layer's pixel space (the Scene 03 crop at full scale). */
  eyeR: Pt;
  eyeL: Pt;
  chin: Pt;
  width: number;
  height: number;
}

/** Least-squares similarity transform (rotation, uniform scale, shift) taking `from` onto `to`. */
export function similarity(from: Pt[], to: Pt[]) {
  const n = from.length;
  let fx = 0, fy = 0, tx = 0, ty = 0;
  for (let i = 0; i < n; i++) {
    fx += from[i][0]; fy += from[i][1];
    tx += to[i][0]; ty += to[i][1];
  }
  fx /= n; fy /= n; tx /= n; ty /= n;
  // a = sum(conj(f) * t) / sum(|f|^2), complex numbers
  let re = 0, im = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const ax = from[i][0] - fx, ay = from[i][1] - fy;
    const bx = to[i][0] - tx, by = to[i][1] - ty;
    re += ax * bx + ay * by;
    im += ax * by - ay * bx;
    den += ax * ax + ay * ay;
  }
  const a = re / den, b = im / den;
  // x' = a x - b y + e ; y' = b x + a y + f
  const e = tx - (a * fx - b * fy);
  const f = ty - (b * fx + a * fy);
  return { a, b, e, f, scale: Math.hypot(a, b), angle: Math.atan2(b, a) };
}

/** Three passes of a box blur approximate a Gaussian; in place, one channel. */
export function blur(src: Float32Array, w: number, h: number, radius: number) {
  const tmp = new Float32Array(src.length);
  const r = Math.max(1, Math.round(radius));
  const pass = (a: Float32Array, b: Float32Array, horizontal: boolean) => {
    const len = horizontal ? w : h;
    const lines = horizontal ? h : w;
    const stride = horizontal ? 1 : w;
    const step = horizontal ? w : 1;
    const inv = 1 / (2 * r + 1);
    for (let l = 0; l < lines; l++) {
      const base = l * step;
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += a[base + Math.min(len - 1, Math.max(0, i)) * stride];
      for (let i = 0; i < len; i++) {
        b[base + i * stride] = acc * inv;
        const add = Math.min(len - 1, i + r + 1);
        const sub = Math.max(0, i - r);
        acc += a[base + add * stride] - a[base + sub * stride];
      }
    }
  };
  for (let k = 0; k < 3; k++) {
    pass(src, tmp, true);
    pass(tmp, src, false);
  }
  return src;
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function pixels(img: CanvasImageSource, w: number, h: number) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

/**
 * Where the face meets the padding the padding shades it: a soft inset
 * shadow along the mask's edge, so the face sits in the helmet rather than
 * on it. Works in place on RGBA pixels (sRGB), using the mask's alpha.
 */
export function contactShadow(px: Uint8ClampedArray, mask: Uint8ClampedArray, w: number, h: number) {
  const N = w * h;
  const a = new Float32Array(N);
  for (let i = 0; i < N; i++) a[i] = mask[4 * i + 3] / 255;
  const b = blur(a, w, h, Math.max(4, Math.round(w / 70)));
  for (let i = 0; i < N; i++) {
    const t = Math.min(1, Math.max(0, (b[i] - 0.3) / 0.62));
    const k = 0.42 + 0.58 * t * t * (3 - 2 * t);
    px[4 * i] *= k;
    px[4 * i + 1] *= k;
    px[4 * i + 2] *= k;
  }
}

/** The placeholder: the rendered clay head, cut to the visible face region. */
export function placeholderLayer(clay: CanvasImageSource, mask: CanvasImageSource, w: number, h: number) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(clay, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const mk = pixels(mask, w, h);
  contactShadow(img.data, mk, w, h);
  for (let i = 0; i < w * h; i++) img.data[4 * i + 3] = mk[4 * i + 3];
  ctx.putImageData(img, 0, 0);
  return c;
}

export interface PortraitInput {
  image: HTMLImageElement | ImageBitmap;
  eyeR: Pt;
  eyeL: Pt;
  chin: Pt;
  exposure?: number;
  warmth?: number;
}

/**
 * Fits and relights a portrait. `shading` is the renderer's irradiance pass,
 * stored as sqrt(E * shadingScale); `mask` holds the visible face region in
 * its alpha channel.
 */
export function portraitLayer(
  p: PortraitInput,
  t: FaceTargets,
  shading: CanvasImageSource,
  shadingScale: number,
  mask: CanvasImageSource,
) {
  const { width: w, height: h } = t;
  const fit = similarity([p.eyeR, p.eyeL, p.chin], [t.eyeR, t.eyeL, t.chin]);

  // 1. the photo, fitted
  const warped = canvas(w, h);
  const wctx = warped.getContext('2d', { willReadFrequently: true })!;
  wctx.imageSmoothingQuality = 'high';
  wctx.setTransform(fit.a, fit.b, -fit.b, fit.a, fit.e, fit.f);
  wctx.drawImage(p.image, 0, 0);
  wctx.setTransform(1, 0, 0, 1, 0, 0);
  const photo = wctx.getImageData(0, 0, w, h).data;

  const sh = pixels(shading, w, h);
  const mk = pixels(mask, w, h);
  const N = w * h;

  // 2. linear light, the photo's own large-scale lighting, the scene's lighting
  const lin = new Float32Array(N * 3);
  const lum = new Float32Array(N);
  const irr = new Float32Array(N * 3);
  let skin = 0, count = 0;
  for (let i = 0; i < N; i++) {
    const r = toLinear(photo[4 * i] / 255), g = toLinear(photo[4 * i + 1] / 255), b = toLinear(photo[4 * i + 2] / 255);
    lin[3 * i] = r; lin[3 * i + 1] = g; lin[3 * i + 2] = b;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    lum[i] = photo[4 * i + 3] > 0 ? l : 0;
    for (let k = 0; k < 3; k++) {
      const s = sh[4 * i + k] / 255;
      irr[3 * i + k] = (s * s) / shadingScale;
    }
    if (mk[4 * i + 3] > 200 && photo[4 * i + 3] > 200) {
      skin += l;
      count++;
    }
  }
  skin = count ? skin / count : 0.2;
  // the photo's exposure decides how light the skin reads, within sensible bounds
  const albedo = Math.min(0.5, Math.max(0.05, skin));
  const radius = Math.hypot(t.chin[0] - (t.eyeR[0] + t.eyeL[0]) / 2, t.chin[1] - (t.eyeR[1] + t.eyeL[1]) / 2) * 0.1;
  const lumB = blur(lum, w, h, radius);
  // Only the broad light of the scene is wanted here (the brow light from above,
  // the falloff towards the chin, the cool fill), not the placeholder's own
  // features, so the light is blurred widely, inside the face region only.
  const wt = new Float32Array(N);
  for (let i = 0; i < N; i++) wt[i] = mk[4 * i + 3] / 255;
  const wtB = blur(Float32Array.from(wt), w, h, radius * 1.5);
  const irrB = [0, 1, 2].map((k) => {
    const ch = new Float32Array(N);
    for (let i = 0; i < N; i++) ch[i] = irr[3 * i + k] * wt[i];
    const b = blur(ch, w, h, radius * 1.5);
    for (let i = 0; i < N; i++) b[i] = wtB[i] > 0.02 ? b[i] / wtB[i] : 0;
    return b;
  });

  // 3. relight and grade
  const out = new ImageData(w, h);
  const o = out.data;
  const exposure = p.exposure ?? 1;
  const warm = p.warmth ?? 1;
  for (let i = 0; i < N; i++) {
    const a = Math.min(mk[4 * i + 3], photo[4 * i + 3]);
    if (a === 0) continue;
    const k = albedo / Math.max(lumB[i], 1e-4);
    grade(lin[3 * i] * k * irrB[0][i] * warm, lin[3 * i + 1] * k * irrB[1][i], (lin[3 * i + 2] * k * irrB[2][i]) / warm, exposure, o, 4 * i);
    o[4 * i + 3] = a;
  }
  contactShadow(o, mk, w, h);
  const c = canvas(w, h);
  c.getContext('2d')!.putImageData(out, 0, 0);
  return { layer: c, fit };
}
