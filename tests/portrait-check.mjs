// Checks the portrait path without a real photo: a stand-in portrait is made
// from the rendered placeholder head (rotated, scaled and placed on a plain
// background), aligned with /align.html, and also built into a copy of the
// page with `portrait` set. Nothing from this check ships.
//   node tests/portrait-check.mjs <outDir>
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { existsSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const require = createRequire(import.meta.url);
const sharp = require('/opt/npm-tools/node_modules/sharp');
let pw;
try {
  pw = require('playwright');
} catch {
  pw = require('/opt/node-tools/node_modules/playwright');
}
const out = process.argv[2] || 'test-results/portrait';
mkdirSync(out, { recursive: true });

// 1. a stand-in portrait: the clay head, rotated 7°, scaled 1.6x, on grey
const m = JSON.parse(readFileSync('public/assets/helmet/helmet.json'));
const c = m.crop;
const L = m.landmarks;
const angle = (7 * Math.PI) / 180, scale = 1.6, W = 1800, H = 1700;
const head = await sharp('public/assets/helmet/face-clay.webp')
  .composite([{ input: await sharp('public/assets/helmet/face-mask.webp').toBuffer(), blend: 'dest-in' }])
  .png()
  .toBuffer();
const rotated = await sharp(head).resize(Math.round(c.w * scale)).rotate(7, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
const rm = await sharp(rotated).metadata();
const ox = Math.round((W - rm.width) / 2), oy = Math.round((H - rm.height) / 2);
await sharp({ create: { width: W, height: H, channels: 3, background: '#8a8580' } })
  .composite([{ input: rotated, left: ox, top: oy }])
  .png()
  .toFile(join(out, 'stand-in.png'));
// where the landmarks went: scale about the origin, rotate about the scaled image centre, then offset
const cw = c.w * scale, ch = c.h * scale;
const map = ([x, y]) => {
  const px = (x - c.x) * scale - cw / 2, py = (y - c.y) * scale - ch / 2;
  const rx = px * Math.cos(angle) - py * Math.sin(angle), ry = px * Math.sin(angle) + py * Math.cos(angle);
  return [rx + rm.width / 2 + ox, ry + rm.height / 2 + oy];
};
const pts = { eyeR: map(L.eyeR), eyeL: map(L.eyeL), chin: map(L.chin) };
console.log('stand-in landmarks', JSON.stringify(pts));

// 2. a copy of the site with the portrait set
const tmp = join(out, 'site');
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
for (const f of ['src', 'public', 'build.mjs', 'package.json', 'node_modules']) cpSync(f, join(tmp, f), { recursive: true });
cpSync(join(out, 'stand-in.png'), join(tmp, 'public/assets/stand-in.png'));
const contentFile = join(tmp, 'src/content.ts');
const r = (p) => `[${Math.round(p[0])}, ${Math.round(p[1])}]`;
writeFileSync(
  contentFile,
  readFileSync(contentFile, 'utf8').replace(
    /portrait: (null|\{[\s\S]*?\}) as Portrait \| null,/,
    `portrait: { src: 'assets/stand-in.png', eyeR: ${r(pts.eyeR)}, eyeL: ${r(pts.eyeL)}, chin: ${r(pts.chin)} } as Portrait | null,`,
  ),
);
execFileSync('node', ['build.mjs'], { cwd: tmp, stdio: 'inherit' });

// 3. open it, open the helmet, and screenshot the face
const root = join(tmp, 'dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.woff': 'font/woff', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = join(root, p);
  if (!existsSync(f) || !statSync(f).isFile()) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': types[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await pw.chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
await page.goto(url + '#armor');
await page.waitForFunction(() => document.querySelector('.armor').classList.contains('is-ready'), null, { timeout: 30000 });
await page.click('.armor__hit');
await page.waitForFunction(() => document.getElementById('armor').dataset.helmet === 'open', null, { timeout: 5000 });
await page.waitForTimeout(800);
const box = await page.locator('.armor__canvas').boundingBox();
await page.screenshot({ path: join(out, 'page-open.png'), clip: box });

// 4. the alignment tool with the same stand-in
await page.goto(url + 'align.html');
await page.setInputFiles('#align-file', join(out, 'stand-in.png'));
await page.waitForTimeout(800);
const pc = await page.locator('.align__photo').boundingBox();
const k = pc.width / W;
for (const p of [pts.eyeR, pts.eyeL, pts.chin]) await page.mouse.click(pc.x + p[0] * k, pc.y + p[1] * k);
await page.waitForTimeout(1500);
const block = await page.textContent('.align__out code');
await page.screenshot({ path: join(out, 'align.png'), fullPage: true });
console.log(block);
console.log(errors.length ? `ERRORS: ${errors.join(' | ')}` : 'no page errors');
await browser.close();
server.close();
