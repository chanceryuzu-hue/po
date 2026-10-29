// The renderer's film grade (pipeline/render/shaders.js, finalFrag) in
// JavaScript, so a live layer such as the portrait gets exactly the same
// tone curve and colour as the rendered frames around it. Vignette and grain
// are not here: the page applies them to everything at once.

/** sRGB (0..1) to linear. */
export function toLinear(c: number) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
/** Linear to sRGB (0..1). */
export function toSRGB(c: number) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}

// ACES fitted (Stephen Hill), same matrices as the shader (column-major there)
function rrt(v: number) {
  const a = v * (v + 0.0245786) - 0.000090537;
  const b = v * (0.983729 * v + 0.432951) + 0.238081;
  return a / b;
}
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/**
 * Grades one linear RGB value and returns sRGB 0..255. `out` is reused to
 * avoid allocating in the per-pixel loop.
 */
export function grade(r: number, g: number, b: number, exposure: number, out: Uint8ClampedArray, o: number) {
  r *= exposure;
  g *= exposure;
  b *= exposure;
  // input matrix
  let x = 0.59719 * r + 0.35458 * g + 0.04823 * b;
  let y = 0.076 * r + 0.90834 * g + 0.01566 * b;
  let z = 0.0284 * r + 0.13383 * g + 0.83777 * b;
  x = rrt(x);
  y = rrt(y);
  z = rrt(z);
  // output matrix
  let R = clamp01(1.60475 * x - 0.53108 * y - 0.07367 * z);
  let G = clamp01(-0.10208 * x + 1.10813 * y - 0.00605 * z);
  let B = clamp01(-0.00327 * x - 0.07276 * y + 1.07602 * z);
  // grade: slight desaturation, warm highlights / neutral-cool shadows, lifted toe
  const l = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  R = l + (R - l) * 0.96;
  G = l + (G - l) * 0.96;
  B = l + (B - l) * 0.96;
  const t = smooth(0.05, 0.6, l);
  R *= 0.985 + (1.03 - 0.985) * t;
  G *= 0.995 + (1.0 - 0.995) * t;
  B *= 1.02 + (0.965 - 1.02) * t;
  R = R * 0.988 + 0.004;
  G = G * 0.988 + 0.004;
  B = B * 0.988 + 0.004;
  out[o] = toSRGB(clamp01(R)) * 255 + 0.5;
  out[o + 1] = toSRGB(clamp01(G)) * 255 + 0.5;
  out[o + 2] = toSRGB(clamp01(B)) * 255 + 0.5;
}
