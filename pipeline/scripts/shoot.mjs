// Renders one or more passes from the page renderer in a single page load.
//   node scripts/shoot.mjs <outDir> "<query>" '<jobs json>'
// jobs: [{ "name": "beauty_000", "p": 0, "pass": "beauty", "clear": false, "preset": "lit" }, ...]
// Each job is written as <outDir>/<name>.png (RGB). Existing files are skipped.
import http from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const sharp = require('/opt/npm-tools/node_modules/sharp');

const [outDir, query, jobsArg] = process.argv.slice(2);
const jobs = JSON.parse(jobsArg);
mkdirSync(outDir, { recursive: true });
const todo = jobs.filter((j) => !existsSync(join(outDir, `${j.name}.png`)));
if (!todo.length) process.exit(0);

const root = new URL('../render/', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.bin': 'application/octet-stream' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const f = join(root, p.endsWith('/') ? p + 'index.html' : p);
  if (!existsSync(f) || !statSync(f).isFile()) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': types[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const params = new URLSearchParams(query);
const SCALE = Number(params.get('scale') || 1);
const [, , W, H] = (params.get('win') || '0,0,2560,1440').split(',').map((v) => Math.round(Number(v) * SCALE));

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-watchdog'],
});
const page = await browser.newPage({ viewport: { width: Math.min(W, 4096), height: Math.min(H, 4096) } });
page.on('console', (m) => {
  if (['error', 'warning'].includes(m.type()) && !/GPU stall|GL Driver/.test(m.text())) console.log('[page]', m.text().slice(0, 600));
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.setDefaultTimeout(900000);
await page.goto(`http://127.0.0.1:${server.address().port}/?${query}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 900000 });

for (const job of todo) {
  const t0 = Date.now();
  await page.evaluate((j) => window.renderPass(j), job);
  const b64 = await page.evaluate(() => window.grab());
  const raw = Buffer.from(b64, 'base64');
  const file = join(outDir, `${job.name}.png`);
  await sharp(raw, { raw: { width: W, height: H, channels: 4 } }).flip().removeAlpha().png({ compressionLevel: 3 }).toFile(file);
  console.log(`${file}  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
if (process.env.PROJECT) {
  const pts = JSON.parse(process.env.PROJECT);
  console.log('PROJECT', JSON.stringify(await page.evaluate((p) => window.project(p), pts)));
}
await browser.close();
server.close();
