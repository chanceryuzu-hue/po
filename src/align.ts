// /align.html: line a portrait up with the helmet opening and preview the
// result with the same code the page uses. Nothing is uploaded anywhere: the
// photo stays in the browser.
import './styles/main.css';
import { portraitLayer, type Pt } from './lib/face';
import { loadImage } from './lib/load';

const ROOT = 'assets/helmet/';
const photoCanvas = document.querySelector<HTMLCanvasElement>('.align__photo')!;
const preview = document.querySelector<HTMLCanvasElement>('.align__preview')!;
const status = document.querySelector<HTMLElement>('.align__status')!;
const out = document.querySelector<HTMLElement>('.align__out code')!;
const fileInput = document.querySelector<HTMLInputElement>('#align-file')!;
const srcInput = document.querySelector<HTMLInputElement>('#align-src')!;
const exposure = document.querySelector<HTMLInputElement>('[data-align="exposure"]')!;
const warmth = document.querySelector<HTMLInputElement>('[data-align="warmth"]')!;

const NAMES = ['the centre of your right eye (on the left of the photo)', 'the centre of your left eye', 'the bottom of your chin'];
let photo: HTMLImageElement | null = null;
let pts: Pt[] = [];
let scale = 1;

const manifest = fetch(`${ROOT}helmet.json`).then((r) => r.json());
const assets = manifest.then(async (m) => ({
  m,
  open: await loadImage(ROOT + m.open),
  mask: await loadImage(ROOT + m.face.mask),
  shading: await loadImage(ROOT + m.face.shading),
}));

function drawPhoto() {
  const ctx = photoCanvas.getContext('2d')!;
  if (!photo) return;
  const maxW = photoCanvas.parentElement!.clientWidth;
  scale = Math.min(1, maxW / photo.naturalWidth);
  photoCanvas.width = Math.round(photo.naturalWidth * scale);
  photoCanvas.height = Math.round(photo.naturalHeight * scale);
  ctx.drawImage(photo, 0, 0, photoCanvas.width, photoCanvas.height);
  pts.forEach(([x, y], i) => {
    ctx.beginPath();
    ctx.arc(x * scale, y * scale, 7, 0, Math.PI * 2);
    ctx.strokeStyle = '#7debff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#7debff';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillText(String(i + 1), x * scale + 10, y * scale - 10);
  });
}

async function render() {
  drawPhoto();
  if (!photo) return;
  if (pts.length < 3) {
    status.textContent = `Click ${NAMES[pts.length]}.`;
    return;
  }
  status.textContent = 'Aligned. Check the preview, then copy the block below.';
  const { m, open, mask, shading } = await assets;
  const c = m.crop;
  const toCrop = (p: Pt): Pt => [p[0] - c.x, p[1] - c.y];
  const { layer, fit } = portraitLayer(
    { image: photo, eyeR: pts[0], eyeL: pts[1], chin: pts[2], exposure: Number(exposure.value), warmth: Number(warmth.value) },
    { eyeR: toCrop(m.landmarks.eyeR), eyeL: toCrop(m.landmarks.eyeL), chin: toCrop(m.landmarks.chin), width: c.w, height: c.h },
    shading,
    m.face.shadingScale,
    mask,
  );
  preview.width = c.w;
  preview.height = c.h;
  const ctx = preview.getContext('2d')!;
  ctx.fillStyle = '#080808';
  ctx.fillRect(0, 0, c.w, c.h);
  ctx.drawImage(layer, 0, 0);
  ctx.drawImage(open, 0, 0, c.w, c.h);
  if (Math.abs(fit.angle) > 0.2) status.textContent += ' The photo is tilted quite a lot; a level photo will look better.';
  const r = (p: Pt) => `[${Math.round(p[0])}, ${Math.round(p[1])}]`;
  out.textContent = `portrait: {
  src: '${srcInput.value.replace(/'/g, '')}',
  eyeR: ${r(pts[0])},
  eyeL: ${r(pts[1])},
  chin: ${r(pts[2])},
  exposure: ${Number(exposure.value)},
  warmth: ${Number(warmth.value)},
},`;
}

fileInput.addEventListener('change', async () => {
  const f = fileInput.files?.[0];
  if (!f) return;
  photo = await loadImage(URL.createObjectURL(f));
  pts = [];
  srcInput.value = `assets/${f.name}`;
  render();
});
photoCanvas.addEventListener('click', (e) => {
  if (!photo || pts.length >= 3) return;
  const r = photoCanvas.getBoundingClientRect();
  pts.push([((e.clientX - r.left) / r.width) * photoCanvas.width / scale, ((e.clientY - r.top) / r.height) * photoCanvas.height / scale]);
  render();
});
document.querySelector('[data-align="reset"]')!.addEventListener('click', () => {
  pts = [];
  render();
});
[exposure, warmth, srcInput].forEach((el) => el.addEventListener('input', () => render()));
document.querySelector('[data-align="copy"]')!.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(out.textContent || '');
    status.textContent = 'Copied. Paste it over the portrait line in src/content.ts and rebuild.';
  } catch {
    status.textContent = 'Select the block and copy it by hand.';
  }
});
addEventListener('resize', drawPhoto);
