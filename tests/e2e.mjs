// End-to-end checks in headless Chromium.
//   node tests/e2e.mjs [distDir] [screenshotDir]
// Needs Playwright: npm i -D playwright && npx playwright install chromium
import http from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const require = createRequire(import.meta.url);
let pw;
try {
  pw = require('playwright');
} catch {
  pw = require('/opt/node-tools/node_modules/playwright');
}
const { chromium } = pw;

const root = process.argv[2] || 'dist';
const shots = process.argv[3] || 'test-results';
mkdirSync(shots, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.mp4': 'video/mp4', '.webm': 'video/webm' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = join(root, p);
  if (!existsSync(f) || !statSync(f).isFile()) return res.writeHead(404).end();
  const size = statSync(f).size;
  const type = types[extname(f)] || 'application/octet-stream';
  const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
  if (range) {
    const s = range[1] ? Number(range[1]) : 0, e = range[2] ? Number(range[2]) : size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${s}-${e}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': e - s + 1 });
    return res.end(readFileSync(f).subarray(s, e + 1));
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

async function newPage(opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errors = [];
  const bytes = { total: 0, byPath: {} };
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('requestfailed', (r) => {
    // media requests are cancelled on purpose when the film is skipped
    if (!/\.(mp4|webm)$/.test(r.url())) errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`);
  });
  // bytes: each file counted once, as a host with normal HTTP caching would serve it
  // (byte-range responses for the film are added up)
  const seen = new Set();
  page.on('response', async (r) => {
    if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`);
    if (r.status() === 200 && seen.has(r.url())) return;
    seen.add(r.url());
    const len = Number(r.headers()['content-length'] || 0);
    bytes.total += len;
    const k = new URL(r.url()).pathname.split('/').slice(0, 4).join('/');
    bytes.byPath[k] = (bytes.byPath[k] || 0) + len;
  });
  return { ctx, page, errors, bytes };
}
const state = (page) => page.evaluate(() => document.getElementById('armor').dataset.helmet || 'closed');
const waitState = (page, s, timeout = 8000) =>
  page.waitForFunction((s) => (document.getElementById('armor').dataset.helmet || 'closed') === s, s, { timeout }).then(() => true, () => false);
const canvasInk = (page) =>
  page.evaluate(() => {
    const c = document.querySelector('.armor__canvas');
    if (!c.width) return 0;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 16) if (d[i] > 8) n++;
    return n / (d.length / 16);
  });
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const scrollToEl = (page, sel, offset = 0) =>
  page.evaluate(
    ([s, o]) => {
      const el = document.querySelector(s);
      window.scrollTo({ top: el.getBoundingClientRect().top + scrollY + o * innerHeight, behavior: 'instant' });
    },
    [sel, offset],
  );

/* ------------------------------------------------------------- desktop --- */
{
  const { ctx, page, errors, bytes } = await newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(url);
  const intro = await page.evaluate(() => document.documentElement.classList.contains('is-intro'));
  check('desktop: the opening shot starts', intro);
  await page.waitForTimeout(2500);
  const t = await page.evaluate(() => document.querySelector('.hero__film').currentTime);
  check('desktop: the opening shot plays', t > 0.5, `t=${t.toFixed(2)} s, src=${await page.evaluate(() => document.querySelector('.hero__film').currentSrc.split('/').pop())}`);
  await page.screenshot({ path: join(shots, 'desktop-01-intro.png') });
  await page.waitForTimeout(8000);
  await page.screenshot({ path: join(shots, 'desktop-02-arriving.png') });
  const settledNaturally = await page.waitForFunction(() => document.querySelector('.hero').classList.contains('is-settled'), null, { timeout: 6000 }).then(() => true, () => false);
  check('desktop: the film hands over to the hero still', settledNaturally);
  await page.waitForTimeout(1200);
  const heroOpacity = await page.evaluate(() => getComputedStyle(document.querySelector('.hero__title')).opacity);
  check('desktop: hero headline visible', heroOpacity === '1', `opacity ${heroOpacity}`);
  await page.screenshot({ path: join(shots, 'desktop-03-hero.png') });

  // dive and reverse
  await scrollToEl(page, '.hero__track', 0.65);
  await page.waitForTimeout(400);
  const scaleMid = await page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('.hero__frame')).transform).a);
  await page.screenshot({ path: join(shots, 'desktop-04-dive.png') });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(400);
  const scaleTop = await page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('.hero__frame')).transform).a);
  check('desktop: scrolling dives towards the visor and reverses', scaleMid > 1.3 && Math.abs(scaleTop - 1) < 0.01, `scale ${scaleMid.toFixed(2)} → ${scaleTop.toFixed(2)}`);

  // Scene 03
  await scrollToEl(page, '#armor');
  await page.waitForFunction(() => document.querySelector('.armor').classList.contains('is-ready'), null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(shots, 'desktop-05-armor.png') });
  const hit = await page.locator('.armor__hit').boundingBox();
  await page.mouse.move(hit.x + hit.width * 0.42, hit.y + hit.height * 0.33);
  await page.waitForTimeout(250);
  await page.mouse.move(hit.x + hit.width * 0.5, hit.y + hit.height * 0.34, { steps: 6 });
  await page.waitForTimeout(500);
  check('desktop: hovering the visor starts the scan', (await state(page)) === 'scanning');
  const ink = await canvasInk(page);
  check('desktop: the scan draws the face behind the visor', ink > 0.002, `${(ink * 100).toFixed(2)}% of the layer`);
  await page.screenshot({ path: join(shots, 'desktop-06-scan.png') });
  await page.mouse.move(10, 10);
  check('desktop: leaving the visor ends the scan', await waitState(page, 'closed', 3000));

  // poses must be loaded before measuring the release
  await page.waitForFunction(() => performance.getEntriesByType('resource').filter((e) => e.name.includes('/poses/')).length >= 40, null, { timeout: 30000 }).catch(() => {});
  await page.evaluate(() => {
    window.__frames = [];
    const loop = (t) => {
      window.__frames.push(t);
      if (window.__frames.length < 400) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  await page.mouse.click(hit.x + hit.width * 0.5, hit.y + hit.height * 0.4);
  check('desktop: click starts the release', (await state(page)) === 'opening');
  await page.waitForTimeout(1100);
  await page.screenshot({ path: join(shots, 'desktop-07-releasing.png') });
  // rapid clicks during the release are ignored
  for (let i = 0; i < 6; i++) await page.mouse.click(hit.x + hit.width * 0.5, hit.y + hit.height * 0.4, { delay: 20 });
  check('desktop: the helmet opens', await waitState(page, 'open', 6000));
  const frames = await page.evaluate(() => {
    const f = window.__frames;
    const d = f.slice(1).map((t, i) => t - f[i]).sort((a, b) => a - b);
    return { n: d.length, median: d[Math.floor(d.length / 2)], p95: d[Math.floor(d.length * 0.95)] };
  });
  check('desktop: release frame times measured (software renderer)', frames.n > 10, `median ${frames.median?.toFixed(1)} ms, p95 ${frames.p95?.toFixed(1)} ms`);
  await page.waitForTimeout(1200);
  const quote = await page.evaluate(() => getComputedStyle(document.querySelector('.armor__reveal')).opacity);
  check('desktop: the reveal copy appears', quote === '1');
  await page.screenshot({ path: join(shots, 'desktop-08-open.png') });

  // the laser frame (when the portrait has one): it glows, its scan keeps moving, and it rests off screen
  if (await page.evaluate(() => document.getElementById('armor').dataset.eyewear === 'laser')) {
    const red = await page.evaluate(() => {
      const c = document.querySelector('.armor__canvas');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 140 && d[i + 2] < 150) n++;
      return n / (c.width * c.height);
    });
    check('desktop: the laser frame glows', red > 0.0005, `${(red * 100).toFixed(2)}% of the layer is laser red`);
    const hudInfo = await page.evaluate(() => {
      const copy = document.querySelector('.armor__copy').getBoundingClientRect();
      const panels = [...document.querySelectorAll('.hud__panel')].map((p) => {
        const r = p.getBoundingClientRect();
        const overlap = r.left < copy.right && r.right > copy.left && r.top < copy.bottom && r.bottom > copy.top;
        return { shown: !p.classList.contains('is-hidden') && getComputedStyle(p).opacity === '1', overlap, inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight };
      });
      return { on: document.querySelector('.hud').classList.contains('is-on'), panels, railHidden: getComputedStyle(document.querySelector('.rail')).opacity === '0' };
    });
    check('desktop: the laser HUD projects both readouts', hudInfo.on && hudInfo.panels.every((p) => p.shown && p.inView), JSON.stringify(hudInfo.panels));
    check('desktop: the HUD never covers the words', hudInfo.panels.every((p) => !p.overlap));
    check('desktop: the scene rail steps aside for the HUD', hudInfo.railHidden);
    await page.evaluate(() => {
      window.__draws = 0;
      const orig = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function (...args) {
        if (this.canvas.classList.contains('armor__canvas')) window.__draws++;
        return orig.apply(this, args);
      };
      window.__idle = [];
      const t0 = performance.now();
      const loop = (t) => {
        window.__idle.push(t);
        if (t - t0 < 2000) requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
    await page.waitForTimeout(2200);
    const idle = await page.evaluate(() => {
      const f = window.__idle;
      const d = f.slice(1).map((t, i) => t - f[i]).sort((a, b) => a - b);
      return { draws: window.__draws, median: d[Math.floor(d.length / 2)], p95: d[Math.floor(d.length * 0.95)] };
    });
    check('desktop: the laser scan animates while open', idle.draws > 20, `${idle.draws} redraws in 2 s; frames median ${idle.median.toFixed(1)} ms, p95 ${idle.p95.toFixed(1)} ms`);
    await scrollToEl(page, '#contact');
    await page.waitForTimeout(400);
    const before = await page.evaluate(() => window.__draws);
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => window.__draws);
    check('desktop: the laser scan stops off screen', after - before === 0, `${after - before} redraws in 1.5 s off screen`);
    await scrollToEl(page, '#armor');
    await page.waitForTimeout(500);
  }

  // replay
  await page.click('[data-armor="replay"]');
  const closing = await waitState(page, 'closing', 2000);
  const reclosed = await waitState(page, 'closed', 5000);
  const reopened = await waitState(page, 'open', 8000);
  check('desktop: Replay seals the helmet and opens it again', closing && reclosed && reopened);
  // seal
  await page.waitForTimeout(600);
  await page.click('[data-armor="seal"]');
  check('desktop: Seal helmet closes it', await waitState(page, 'closed', 5000));

  // scroll away mid-release, come back (the buttons above may have scrolled the page: measure again)
  await scrollToEl(page, '#armor');
  await page.waitForTimeout(200);
  const hit2 = await page.locator('.armor__hit').boundingBox();
  await page.mouse.click(hit2.x + hit2.width * 0.5, hit2.y + hit2.height * 0.4);
  await page.waitForTimeout(300);
  check('desktop: a second click opens again', (await state(page)) === 'opening');
  await scrollToEl(page, '#contact');
  await page.waitForTimeout(3500);
  await scrollToEl(page, '#armor');
  await page.waitForTimeout(300);
  check('desktop: scrolling away mid-release still ends open', (await state(page)) === 'open');
  await page.keyboard.press('Escape');
  check('desktop: Escape seals the helmet', await waitState(page, 'closed', 5000));

  // keyboard
  await page.evaluate(() => document.querySelector('[data-armor="seal"]').blur());
  await page.evaluate(() => {
    const links = document.querySelectorAll('.armor__copy a, .armor__copy button');
    document.querySelector('.armor__stage').setAttribute('tabindex', '-1');
    document.querySelector('.armor__stage').focus();
  });
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => document.activeElement?.className);
  check('desktop: the helmet is reachable with Tab', focused === 'armor__hit', `focus on ${focused}`);
  await page.waitForTimeout(700);
  check('desktop: keyboard focus scans the visor', (await state(page)) === 'scanning');
  await page.keyboard.press('Enter');
  check('desktop: Enter opens the helmet', await waitState(page, 'open', 6000));
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  check('desktop: focus is visible', outline !== 'none', outline);

  // core and other scenes
  await scrollToEl(page, '.core__track', 0.6);
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(shots, 'desktop-09-core.png') });
  await scrollToEl(page, '.core__list', -0.05);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(shots, 'desktop-10-capabilities.png') });
  await scrollToEl(page, '#about', -0.02);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(shots, 'desktop-11-about.png') });
  await scrollToEl(page, '#work', 0);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(shots, 'desktop-12-work.png') });
  await scrollToEl(page, '#process', 0);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(shots, 'desktop-13-process.png') });
  await scrollToEl(page, '#contact', 0);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(shots, 'desktop-14-contact.png') });

  // nav and links
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.click('.nav__links a[href="#work"]');
  await page.waitForTimeout(1500);
  const workTop = await page.evaluate(() => document.getElementById('work').getBoundingClientRect().top);
  check('desktop: navigation scrolls to Work', Math.abs(workTop) < 120, `top ${Math.round(workTop)}`);
  const ext = await page.evaluate(() =>
    [...document.querySelectorAll('a[href^="http"]')].map((a) => ({ href: a.href, ok: a.target === '_blank' && /noopener/.test(a.rel) })),
  );
  check('desktop: external links open safely in a new tab', ext.length > 0 && ext.every((e) => e.ok), ext.map((e) => e.href).join(', '));
  const anchors = await page.evaluate(() =>
    [...document.querySelectorAll('a[href^="#"]')].filter((a) => a.getAttribute('href').length > 1 && !document.querySelector(a.getAttribute('href'))).map((a) => a.getAttribute('href')),
  );
  check('desktop: every in-page link has a target', anchors.length === 0, anchors.join(', '));
  check('desktop: no horizontal overflow', (await overflow(page)) === 0);
  check('desktop: no console errors or failed requests', errors.length === 0, errors.slice(0, 4).join(' | '));
  const mb = (n) => `${(n / 1e6).toFixed(2)} MB`;
  check('desktop: bytes transferred (whole visit)', true, `${mb(bytes.total)}; ${Object.entries(bytes.byPath).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${mb(v)}`).join(', ')}`);
  await ctx.close();
}

/* ------------------------------------------------------------- mobile --- */
{
  const { ctx, page, errors, bytes } = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  await page.goto(url);
  await page.waitForTimeout(2500);
  const src = await page.evaluate(() => document.querySelector('.hero__film').currentSrc);
  check('mobile: the portrait cut of the film is used', /intro-portrait/.test(src), src.split('/').pop());
  await page.screenshot({ path: join(shots, 'mobile-01-intro.png') });
  await page.click('.hero__skip');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(shots, 'mobile-02-hero.png') });
  check('mobile: Skip intro settles on the hero', await page.evaluate(() => document.querySelector('.hero').classList.contains('is-settled')));
  const firstBytes = bytes.total;
  await scrollToEl(page, '#armor');
  await page.waitForFunction(() => document.querySelector('.armor').classList.contains('is-ready'), null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(shots, 'mobile-03-armor.png') });
  const hit = await page.locator('.armor__hit').boundingBox();
  await page.touchscreen.tap(hit.x + hit.width / 2, hit.y + hit.height * 0.35);
  await page.waitForTimeout(900);
  check('mobile: first tap scans', (await state(page)) === 'scanning');
  await page.screenshot({ path: join(shots, 'mobile-04-scan.png') });
  await page.waitForFunction(() => performance.getEntriesByType('resource').filter((e) => e.name.includes('/poses/m/')).length >= 40, null, { timeout: 30000 }).catch(() => {});
  await page.touchscreen.tap(hit.x + hit.width / 2, hit.y + hit.height * 0.35);
  check('mobile: second tap opens', (await state(page)) === 'opening' || (await waitState(page, 'opening', 1500)));
  check('mobile: the helmet opens', await waitState(page, 'open', 6000));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(shots, 'mobile-05-open.png') });
  const replayVisible = await page.locator('[data-armor="replay"]').isVisible();
  check('mobile: Replay is visible', replayVisible);
  if (await page.evaluate(() => document.getElementById('armor').dataset.eyewear === 'laser')) {
    const hudM = await page.evaluate(() => {
      const eyes = document.querySelector('.armor__hit').getBoundingClientRect();
      return [...document.querySelectorAll('.hud__panel')].map((p) => {
        const r = p.getBoundingClientRect();
        return { shown: !p.classList.contains('is-hidden'), inside: r.left >= 0 && r.right <= innerWidth, bottom: Math.round(r.bottom), eyesAt: Math.round(eyes.top + eyes.height * 0.42) };
      });
    });
    check('mobile: the HUD readouts sit above the face', hudM.every((p) => p.shown && p.inside && p.bottom < p.eyesAt), JSON.stringify(hudM));
  }
  const usedPhoneFrames = await page.evaluate(() => performance.getEntriesByType('resource').some((e) => e.name.includes('/poses/m/')));
  check('mobile: half-size release frames are used', usedPhoneFrames);
  await page.locator('[data-armor="replay"]').tap();
  check('mobile: Replay works by touch', (await waitState(page, 'closed', 5000)) && (await waitState(page, 'open', 8000)));
  // menu
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.tap('.nav__toggle');
  check('mobile: menu opens', await page.isVisible('#menu'));
  await page.tap('#menu a[href="#contact"]');
  await page.waitForTimeout(1500);
  check('mobile: menu link closes the menu', !(await page.isVisible('#menu')));
  await page.screenshot({ path: join(shots, 'mobile-06-contact.png') });
  for (const [sel, name] of [['#about', '07-about'], ['.core__list', '08-capabilities'], ['#work', '09-work'], ['#process', '10-process']]) {
    await scrollToEl(page, sel, 0);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: join(shots, `mobile-${name}.png`) });
  }
  check('mobile: no horizontal overflow', (await overflow(page)) === 0);
  check('mobile: no console errors or failed requests', errors.length === 0, errors.slice(0, 4).join(' | '));
  check('mobile: bytes before Scene 03', true, `${(firstBytes / 1e6).toFixed(2)} MB; whole visit ${(bytes.total / 1e6).toFixed(2)} MB`);
  await ctx.close();
}

/* -------------------------------------------------------- reduced motion --- */
{
  const { ctx, page, errors } = await newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  await page.goto(url);
  await page.waitForTimeout(800);
  const intro = await page.evaluate(() => document.documentElement.classList.contains('is-intro'));
  check('reduced motion: no opening film', !intro);
  check('reduced motion: hero copy visible at once', (await page.evaluate(() => getComputedStyle(document.querySelector('.hero__title')).opacity)) === '1');
  await scrollToEl(page, '#armor');
  await page.waitForFunction(() => document.querySelector('.armor').classList.contains('is-ready'), null, { timeout: 20000 });
  await page.click('.armor__hit');
  check('reduced motion: the helmet cross-fades open', await waitState(page, 'open', 2000));
  await page.waitForTimeout(150);
  check('reduced motion: the reveal copy shows at once', (await page.evaluate(() => getComputedStyle(document.querySelector('.armor__reveal')).opacity)) === '1');
  const poses = await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => e.name.includes('/poses/')).length);
  check('reduced motion: release frames are never downloaded', poses === 0, `${poses} requests`);
  check('reduced motion: no errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await page.screenshot({ path: join(shots, 'reduced-01-open.png') });
  await ctx.close();
}

/* ------------------------------------------------------------ no script --- */
{
  const { ctx, page } = await newPage({ viewport: { width: 1280, height: 800 }, javaScriptEnabled: false });
  await page.goto(url);
  const text = await page.evaluate(() => document.body.innerText);
  check('no JavaScript: headline in the page', /I turn ideas into reality/i.test(text));
  check('no JavaScript: reveal quote in the page', /The armor is the technology/.test(text));
  check('no JavaScript: capabilities, work, process and contact present', /Creative development/.test(text) && /Selected work/.test(text) && /Discover/.test(text) && /Have a mission in mind/i.test(text));
  const imgs = await page.evaluate(() => [...document.images].filter((i) => i.loading !== 'lazy').map((i) => i.complete && i.naturalWidth > 0));
  check('no JavaScript: hero image loads', imgs.length > 0 && imgs.every(Boolean));
  await page.screenshot({ path: join(shots, 'nojs-01.png'), fullPage: false });
  await ctx.close();
}

await browser.close();
server.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
