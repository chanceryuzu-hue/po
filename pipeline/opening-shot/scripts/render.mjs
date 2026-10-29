// Headless renderer for the Sentinel shot.
//   node scripts/render.mjs stills <outDir> <t1,t2,...> [query]
//   node scripts/render.mjs frames <outDir> <startFrame> <endFrame> [query]
// Frames are written as PNG (frame_0000.png ...). Existing frames are skipped,
// so an interrupted render can be resumed.
import http from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const sharp = require('/opt/npm-tools/node_modules/sharp');

const [mode, outDir, a, b, queryArg] = process.argv.slice(2);
const query = (mode === 'stills' ? b : queryArg) || '';
mkdirSync(outDir, { recursive: true });
const root = new URL('../render/', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.bin': 'application/octet-stream' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const f = join(root, p.endsWith('/') ? p + 'index.html' : p);
  if (!existsSync(f) || !statSync(f).isFile()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { 'Content-Type': types[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const params = new URLSearchParams(query);
const W = Number(params.get('w') || 1920);
const H = Number(params.get('h') || 1080);

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-watchdog'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('console', (m) => {
  if (['error', 'warning'].includes(m.type())) console.log('[page]', m.text().slice(0, 600));
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.setDefaultTimeout(600000);
await page.goto(`http://127.0.0.1:${server.address().port}/?${query}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000 });

async function shoot(t, frame, file) {
  const t0 = Date.now();
  await page.evaluate(([tt, ff]) => window.renderAt(tt, ff), [t, frame]);
  const t1 = Date.now();
  const b64 = await page.evaluate(() => window.grab());
  const raw = Buffer.from(b64, 'base64');
  await sharp(raw, { raw: { width: W, height: H, channels: 4 } })
    .flip()
    .removeAlpha()
    .png({ compressionLevel: 3 })
    .toFile(file);
  console.log(`${file}  render ${((t1 - t0) / 1000).toFixed(1)}s  total ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

if (mode === 'stills') {
  for (const ts of a.split(',')) {
    const t = Number(ts);
    await shoot(t, Math.round(t * 24), join(outDir, `t${t.toFixed(2)}.png`));
  }
} else {
  const s = Number(a), e = Number(b);
  for (let f = s; f <= e; f++) {
    const file = join(outDir, `frame_${String(f).padStart(4, '0')}.png`);
    if (existsSync(file)) continue;
    await shoot(f / 24, f, file);
  }
}
await browser.close();
server.close();
