// Scene 03: the helmet release.
//
// Layers, bottom to top:
//   1. the sealed frame (a plain <img>, also the no-JavaScript view)
//   2. a canvas over the helmet only, holding
//      a. the face layer (the portrait, relit, or the placeholder head)
//      b. the current release pose: rendered RGBA frames whose transparency
//         is exactly where the head can be seen, cross-faded between the
//         rendered poses; while scanning, the cleared visor instead.
//
// The interaction is a small state machine. Progress is time-based, so
// scrolling away or switching tabs mid-animation always ends in a whole state.
import { content } from '../content';
import { buildEyewear, drawEyewearLight, type Eyewear, type EyewearGeo } from './eyewear';
import { placeholderLayer, portraitLayer, type Pt } from './face';
import { loadAll, loadBitmap, loadImage, release, type Bitmap } from './load';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Manifest {
  windows: { desktop: Rect; portrait: Rect };
  crop: Rect;
  landmarks: { eyeR: Pt; eyeL: Pt; chin: Pt };
  slit: { x0: number; x1: number; y: number; h: number };
  poses: { p: number[]; d: string[]; m: string[] };
  open: string;
  clear: string;
  face: { clay: string; mask: string; shading: string; shadingScale: number };
}

type State = 'closed' | 'scanning' | 'opening' | 'open' | 'closing';

const OPEN_MS = 2300;
const CLOSE_MS = 1600;
const FADE_MS = 450; // reduced motion: a cross-fade instead of the mechanism
const ASSET_ROOT = 'assets/helmet/';

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export function initHelmet(section: HTMLElement) {
  const stage = section.querySelector<HTMLElement>('.armor__stage')!;
  const canvas = section.querySelector<HTMLCanvasElement>('.armor__canvas')!;
  const hit = section.querySelector<HTMLButtonElement>('.armor__hit')!;
  const status = section.querySelector<HTMLElement>('.armor__status')!;
  const note = section.querySelector<HTMLElement>('.armor__placeholder');
  const replayBtn = section.querySelector<HTMLButtonElement>('[data-armor="replay"]')!;
  const sealBtn = section.querySelector<HTMLButtonElement>('[data-armor="seal"]')!;
  const hud = section.querySelector<HTMLElement>('.hud');
  const copy = section.querySelector<HTMLElement>('.armor__copy');
  const ctx = canvas.getContext('2d')!;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const portraitMQ = matchMedia('(max-aspect-ratio: 4/5)');

  let m: Manifest | null = null;
  let face: HTMLCanvasElement | null = null;
  let eyewear: Eyewear | null = null;
  let inView = false;
  let lastDraw = 0;
  let openImg: Bitmap | null = null;
  let clearImg: Bitmap | null = null;
  let poses: Bitmap[] | null = null;
  let posesLoading: Promise<void> | null = null;
  let ready: Promise<void> | null = null;

  let state: State = 'closed';
  let t0 = 0;
  let pending: 'open' | null = null; // an open asked for before the poses arrived
  let replayAfterClose = false;
  let fadeMode = false; // fixed for the length of a transition
  let scan = 0; // 0..1 how much of the scan is showing
  let scanTarget = 0;
  let scanMode: 'pointer' | 'sweep' = 'pointer';
  let sweepStart = 0;
  let pointer: Pt = [0, 0]; // crop pixels
  let lastPointer = 'mouse';
  let raf = 0;
  let lastFrame = 0;

  // layout: the crop rectangle on screen, following the <img>'s object-fit: cover
  let view = { s: 1, cx: 0, cy: 0, cw: 0, ch: 0, bw: 0, bh: 0 };
  const off = document.createElement('canvas');
  const offCtx = off.getContext('2d')!;

  function layout() {
    if (!m) return;
    const win = portraitMQ.matches ? m.windows.portrait : m.windows.desktop;
    const W = stage.clientWidth, H = stage.clientHeight;
    const s = Math.max(W / win.w, H / win.h);
    const ox = (W - win.w * s) / 2, oy = (H - win.h * s) / 2;
    const c = m.crop;
    const cx = (c.x - win.x) * s + ox, cy = (c.y - win.y) * s + oy;
    const cw = c.w * s, ch = c.h * s;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const bw = Math.round(Math.min(c.w, cw * dpr)), bh = Math.round(Math.min(c.h, ch * dpr));
    view = { s, cx, cy, cw, ch, bw, bh };
    Object.assign(canvas.style, { left: `${cx}px`, top: `${cy}px`, width: `${cw}px`, height: `${ch}px` });
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
      off.width = bw;
      off.height = bh;
    }
    // the clickable helmet: from above the crown to under the chin
    const L = m.landmarks;
    const eyeMid: Pt = [(L.eyeR[0] + L.eyeL[0]) / 2, (L.eyeR[1] + L.eyeL[1]) / 2];
    const span = L.chin[1] - eyeMid[1];
    const hx0 = eyeMid[0] - span * 0.95, hx1 = eyeMid[0] + span * 0.95;
    const hy0 = eyeMid[1] - span * 1.25, hy1 = L.chin[1] + span * 0.3;
    Object.assign(hit.style, {
      left: `${(hx0 - win.x) * s + ox}px`,
      top: `${(hy0 - win.y) * s + oy}px`,
      width: `${(hx1 - hx0) * s}px`,
      height: `${(hy1 - hy0) * s}px`,
    });
    if (note) {
      Object.assign(note.style, {
        left: `${(eyeMid[0] - win.x) * s + ox}px`,
        top: `${(hy1 - win.y) * s + oy + 8}px`,
      });
    }
    if (hud && eyewear) placeHud(W, H, (x) => (x - win.x) * s + ox, (y) => (y - win.y) * s + oy, eyeMid, span * s);
    draw(performance.now());
  }

  /**
   * The laser HUD: two readouts beside the head, each joined to the outer edge of
   * its lens by a faint beam. Stage pixels; `X`/`Y` map virtual-frame pixels.
   */
  function placeHud(W: number, H: number, X: (x: number) => number, Y: (y: number) => number, eyeMid: Pt, span: number) {
    const ew = eyewear!, c = m!.crop, f = ew.fit;
    const lensPt = (p: Pt): Pt => [X(c.x + f.a * p[0] - f.b * p[1] + f.e), Y(c.y + f.b * p[0] + f.a * p[1] + f.f)];
    const cx = X(eyeMid[0]), cy = Y(eyeMid[1]);
    const tall = portraitMQ.matches;
    // wide screens: either side of the head, clear of the words; tall screens with room
    // (tablets): flanking the face; phones: side by side above the helmet
    const flankRoom = cx - span * 0.56 - 21;
    const mode = !tall ? 'side' : flankRoom >= 150 ? 'flank' : 'top';
    const w = mode === 'side' ? Math.max(170, Math.min(240, W * 0.16)) : mode === 'flank' ? Math.min(220, flankRoom) : Math.min(200, (W - 32 - 10) / 2);
    hud!.style.setProperty('--fs', tall ? '9px' : `${Math.max(9, Math.min(11, w / 21))}px`);
    const stageBox = stage.getBoundingClientRect();
    const copyBox = copy && !tall ? copy.getBoundingClientRect() : null;
    const overlapsCopy = (left: number, top: number, ph: number) => {
      if (!copyBox) return false;
      const l = stageBox.left + left, t = stageBox.top + top;
      return l < copyBox.right && l + w > copyBox.left && t < copyBox.bottom && t + ph > copyBox.top;
    };
    const helmTop = cy - span * 1.25;
    for (const [i, side] of (['l', 'r'] as const).entries()) {
      const panel = hud!.querySelector<HTMLElement>(`.hud__panel--${side}`)!;
      const beam = hud!.querySelector<SVGPolygonElement>(`.hud__beam[data-side="${side}"]`)!;
      panel.style.setProperty('--w', `${w}px`);
      const ph = panel.offsetHeight;
      let left: number, top: number, ok = true;
      if (mode === 'top') {
        left = Math.max(16, Math.min(W - 16 - w, side === 'l' ? cx - 5 - w : cx + 5));
        top = Math.max(80, helmTop - ph - 8);
        ok = top + ph < cy - span * 0.25; // never over the eyes
      } else if (mode === 'flank') {
        left = side === 'l' ? cx - span * 0.56 - 5 - w : cx + span * 0.56 + 5;
        top = Math.max(80, cy - ph * 0.5);
      } else {
        const gap = span * 1.02;
        left = Math.max(8, Math.min(W - w - 8, side === 'l' ? cx - gap - w : cx + gap));
        top = Math.max(80, Math.min(H - ph - 8, cy - ph * 0.55));
        if (overlapsCopy(left, top, ph) && copyBox) {
          // lift it clear of the words, up beside the crown
          top = copyBox.top - stageBox.top - ph - 14;
          ok = top >= 80 && !overlapsCopy(left, top, ph);
        }
      }
      Object.assign(panel.style, { left: `${left}px`, top: `${top}px` });
      panel.classList.toggle('is-hidden', !ok);
      const [lx, ly] = lensPt(ew.outer[i]);
      let pts: string;
      if (mode === 'top') pts = `${lx},${ly} ${left + w * 0.42},${top + ph} ${left + w * 0.58},${top + ph}`;
      else {
        const edge = side === 'l' ? left + w : left;
        pts = `${lx},${ly} ${edge},${top + 6} ${edge},${top + ph - 6}`;
      }
      beam.setAttribute('points', ok ? pts : '');
    }
  }
  function hudUp() {
    if (!hud || !eyewear) return;
    const on = state === 'open';
    hud.classList.toggle('is-on', on);
    hud.classList.toggle('is-live', on && inView);
    document.documentElement.classList.toggle('hud-up', on && inView);
  }

  /* ---------------------------------------------------------- loading --- */

  async function load() {
    const res = await fetch(`${ASSET_ROOT}helmet.json`);
    m = (await res.json()) as Manifest;
    const [mask, open, clear, base] = await Promise.all([
      loadImage(ASSET_ROOT + m.face.mask),
      loadBitmap(ASSET_ROOT + m.open),
      loadBitmap(ASSET_ROOT + m.clear),
      content.portrait ? loadImage(ASSET_ROOT + m.face.shading) : loadImage(ASSET_ROOT + m.face.clay),
    ]);
    openImg = open;
    clearImg = clear;
    const c = m.crop;
    if (content.portrait) {
      try {
        const photo = await loadImage(content.portrait.src);
        const toCrop = (p: Pt): Pt => [p[0] - c.x, p[1] - c.y];
        const fitted = portraitLayer(
          { image: photo, ...content.portrait },
          { eyeR: toCrop(m.landmarks.eyeR), eyeL: toCrop(m.landmarks.eyeL), chin: toCrop(m.landmarks.chin), width: c.w, height: c.h },
          base,
          m.face.shadingScale,
          mask,
        );
        face = fitted.layer;
        const ew = content.portrait.eyewear;
        if (ew) {
          try {
            const geo = (await (await fetch(ew.src)).json()) as EyewearGeo;
            eyewear = buildEyewear(geo, fitted.fit, face, mask, ew.color);
            section.dataset.eyewear = 'laser';
            if (hud) hud.hidden = false;
          } catch (err) {
            console.warn('The laser frame could not be drawn.', err);
          }
        }
      } catch (err) {
        console.warn('Portrait could not be loaded; showing the placeholder head.', err);
      }
    }
    if (!face) {
      const clay = content.portrait ? await loadImage(ASSET_ROOT + m.face.clay) : base;
      face = placeholderLayer(clay, mask, c.w, c.h);
    }
    section.classList.add('is-ready');
    layout();
  }

  function loadPoses() {
    if (posesLoading || !m) return posesLoading;
    // phones and small screens get half-size release frames; the held poses are always full size
    const small = Math.min(innerWidth, innerHeight) < 700 || (window.devicePixelRatio || 1) * innerWidth < 1400;
    const list = small ? m.poses.m : m.poses.d;
    posesLoading = loadAll(list.map((f) => ASSET_ROOT + f), 6).then((b) => {
      poses = b;
    });
    return posesLoading;
  }

  /* ------------------------------------------------------------ state --- */

  function setState(next: State, now = performance.now()) {
    state = next;
    t0 = now;
    if (next === 'opening' || next === 'closing') fadeMode = reduced.matches || !poses;
    section.dataset.helmet = next;
    const busy = next === 'opening' || next === 'closing';
    hit.setAttribute('aria-disabled', String(busy));
    replayBtn.disabled = busy;
    sealBtn.disabled = busy;
    hit.setAttribute('aria-label', next === 'open' ? 'Seal the helmet' : 'Open the helmet');
    section.classList.toggle('is-open', next === 'open');
    if (note) note.hidden = !(next === 'open' || next === 'opening');
    if (next === 'opening') status.textContent = 'Releasing the helmet.';
    if (next === 'open') status.textContent = `Helmet open. ${content.reveal.quote}`;
    if (next === 'closed') status.textContent = 'Helmet sealed.';
    hudUp();
    kick();
  }

  async function open() {
    if (state === 'opening' || state === 'closing' || state === 'open' || pending === 'open') return;
    scanTarget = 0;
    if (!m || !face || !openImg) {
      pending = 'open';
      status.textContent = 'Loading the helmet.';
      if (!ready) startLoading();
      await ready;
      if (pending !== 'open') return;
    }
    if (!reduced.matches && !poses) {
      pending = 'open';
      status.textContent = 'Loading the release.';
      // never keep anyone waiting long: after 2.5 s fall back to a cross-fade
      await Promise.race([loadPoses(), new Promise((r) => setTimeout(r, 2500))]);
      if (pending !== 'open') return;
    }
    pending = null;
    setState('opening');
  }

  function close(thenReplay = false) {
    if (state !== 'open') return;
    replayAfterClose = thenReplay;
    setState('closing');
  }

  function scanStart(mode: 'pointer' | 'sweep') {
    if (state !== 'closed' && state !== 'scanning') return;
    scanMode = mode;
    sweepStart = performance.now();
    scanTarget = 1;
    if (state === 'closed') setState('scanning');
    else kick();
  }
  function scanStop() {
    if (state !== 'scanning') return;
    scanTarget = 0;
    kick();
  }

  /* ----------------------------------------------------------- drawing --- */

  // the laser frame: dim behind the closed visor, powering up as the helmet opens
  const SCAN_CYCLE = 5200, SCAN_RUN = 2200;
  function laserPower(now: number) {
    if (state === 'open' || reduced.matches) return 1;
    if (state === 'opening' || state === 'closing') {
      const dur = fadeMode ? FADE_MS : state === 'opening' ? OPEN_MS : CLOSE_MS;
      let p = clamp01((now - t0) / dur);
      if (state === 'closing') p = 1 - p;
      if (fadeMode) return 0.55 + 0.45 * p;
      if (p < 0.6) return 0.55;
      if (p > 0.86) return 1;
      // a few quick stutters, as if the emitters were coming up to power
      const q = (p - 0.6) / 0.26;
      return 0.35 + 0.65 * q * (Math.sin(q * 41) > -0.2 ? 1 : 0.3);
    }
    return 0.55;
  }
  function scanPhase(now: number) {
    if (state !== 'open' || reduced.matches) return -1;
    const t = (now - t0) % SCAN_CYCLE;
    return t < SCAN_RUN ? smooth(t / SCAN_RUN) : -1;
  }
  function drawFace(c: CanvasRenderingContext2D, now: number, bw: number, bh: number, sx: number, dim = 0) {
    c.drawImage(face!, 0, 0, bw, bh);
    if (dim > 0) {
      c.globalCompositeOperation = 'source-atop';
      c.fillStyle = `rgba(0,0,0,${dim})`;
      c.fillRect(0, 0, bw, bh);
      c.globalCompositeOperation = 'source-over';
    }
    if (eyewear) drawEyewearLight(c, eyewear, sx, laserPower(now) * (1 - dim * 0.4), scanPhase(now));
  }

  function kick() {
    if (!raf) {
      lastFrame = performance.now();
      raf = requestAnimationFrame(tick);
    }
  }
  function tick(now: number) {
    raf = 0;
    const dt = Math.min(64, now - lastFrame);
    lastFrame = now;
    // scan easing
    const k = 1 - Math.exp(-dt / (scanTarget > scan ? 140 : 220));
    scan += (scanTarget - scan) * k;
    if (Math.abs(scanTarget - scan) < 0.004) scan = scanTarget;
    if (state === 'scanning' && scan === 0 && scanTarget === 0) setState('closed', now);

    // timed transitions
    const dur = fadeMode ? FADE_MS : state === 'opening' ? OPEN_MS : CLOSE_MS;
    if ((state === 'opening' || state === 'closing') && now - t0 >= dur) {
      if (state === 'opening') setState('open', now);
      else {
        setState('closed', now);
        if (replayAfterClose) {
          replayAfterClose = false;
          setTimeout(open, 260);
        }
      }
    }
    const animating =
      state === 'opening' || state === 'closing' || scan !== scanTarget || (state === 'scanning' && scanMode === 'sweep' && now - sweepStart < 1200);
    // the laser's scan line keeps moving while the open helmet is on screen (about 30 fps is plenty)
    const idle = !!eyewear && state === 'open' && !reduced.matches && inView && !document.hidden;
    if (animating || !idle || now - lastDraw > 30) {
      draw(now);
      lastDraw = now;
    }
    if (animating || idle) raf = requestAnimationFrame(tick);
  }

  function draw(now: number) {
    if (!m || !face) return;
    const { bw, bh } = view;
    const sx = bw / m.crop.w; // layer pixels to canvas pixels
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, bw, bh);

    if (state === 'open') {
      drawFace(ctx, now, bw, bh, sx);
      ctx.drawImage(openImg!, 0, 0, bw, bh);
      return;
    }
    if (state === 'opening' || state === 'closing') {
      const fade = fadeMode || !poses;
      const dur = fadeMode ? FADE_MS : state === 'opening' ? OPEN_MS : CLOSE_MS;
      let p = clamp01((now - t0) / dur);
      if (state === 'closing') p = 1 - p;
      if (fade) {
        // the sealed frame is underneath; fade the open composite in or out
        offCtx.setTransform(1, 0, 0, 1, 0, 0);
        offCtx.globalAlpha = 1;
        offCtx.globalCompositeOperation = 'source-over';
        offCtx.clearRect(0, 0, bw, bh);
        drawFace(offCtx, now, bw, bh, sx);
        offCtx.drawImage(openImg!, 0, 0, bw, bh);
        ctx.globalAlpha = smooth(p);
        ctx.drawImage(off, 0, 0);
        ctx.globalAlpha = 1;
        return;
      }
      // face, dimmed while the panels still shade it
      const light = smooth(clamp01((p - 0.25) / 0.6));
      drawFace(ctx, now, bw, bh, sx, (1 - light) * 0.55);
      // pose: premultiplied blend of the two rendered poses either side of p
      const ps = m.poses.p;
      let i = 0;
      while (i < ps.length - 2 && ps[i + 1] <= p) i++;
      const f = clamp01((p - ps[i]) / (ps[i + 1] - ps[i]));
      offCtx.setTransform(1, 0, 0, 1, 0, 0);
      offCtx.globalCompositeOperation = 'source-over';
      offCtx.clearRect(0, 0, bw, bh);
      offCtx.globalAlpha = 1 - f;
      offCtx.drawImage(poses![i], 0, 0, bw, bh);
      offCtx.globalCompositeOperation = 'lighter';
      offCtx.globalAlpha = f;
      offCtx.drawImage(poses![i + 1], 0, 0, bw, bh);
      offCtx.globalAlpha = 1;
      offCtx.globalCompositeOperation = 'source-over';
      ctx.drawImage(off, 0, 0);
      return;
    }
    if (scan > 0.001) {
      // the cleared visor, revealed around the pointer or behind a sweeping line
      const sl = m.slit;
      const slitY = (sl.y - m.crop.y) * sx;
      const x0 = (sl.x0 - m.crop.x) * sx, x1 = (sl.x1 - m.crop.x) * sx;
      offCtx.setTransform(1, 0, 0, 1, 0, 0);
      offCtx.globalAlpha = 1;
      offCtx.globalCompositeOperation = 'source-over';
      offCtx.clearRect(0, 0, bw, bh);
      drawFace(offCtx, now, bw, bh, sx);
      offCtx.drawImage(clearImg!, 0, 0, bw, bh);
      offCtx.globalCompositeOperation = 'destination-in';
      // destination-in keeps only what the mask covers (it clears everything else)
      let lineX: number;
      if (scanMode === 'pointer') {
        lineX = Math.min(x1, Math.max(x0, pointer[0] * sx));
        const r = (x1 - x0) * 0.32 * (0.35 + 0.65 * scan);
        const g = offCtx.createRadialGradient(lineX, slitY, r * 0.25, lineX, slitY, r);
        g.addColorStop(0, `rgba(0,0,0,${scan})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        offCtx.fillStyle = g;
        offCtx.fillRect(0, 0, bw, bh);
      } else {
        const t = smooth(clamp01((now - sweepStart) / 1100));
        lineX = x0 + (x1 - x0) * t;
        const g = offCtx.createLinearGradient(lineX - 60 * sx, 0, lineX, 0);
        g.addColorStop(0, `rgba(0,0,0,${scan})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        offCtx.fillStyle = g;
        offCtx.fillRect(0, 0, Math.max(1, lineX), bh);
      }
      offCtx.globalCompositeOperation = 'source-over';
      ctx.drawImage(off, 0, 0);
      // the scan line itself: a thin cyan stroke across the slit
      const lh = sl.h * sx * 1.6;
      const lg = ctx.createLinearGradient(0, slitY - lh, 0, slitY + lh);
      lg.addColorStop(0, 'rgba(125,235,255,0)');
      lg.addColorStop(0.5, `rgba(125,235,255,${0.85 * scan})`);
      lg.addColorStop(1, 'rgba(125,235,255,0)');
      ctx.fillStyle = lg;
      ctx.shadowColor = 'rgba(125,235,255,0.8)';
      ctx.shadowBlur = 10 * sx;
      ctx.fillRect(lineX - Math.max(1, 1.5 * sx), slitY - lh, Math.max(1.5, 3 * sx), lh * 2);
      ctx.shadowBlur = 0;
    }
  }

  /* ------------------------------------------------------------- input --- */

  const toCrop = (e: PointerEvent): Pt => {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * (m?.crop.w ?? 1), ((e.clientY - r.top) / r.height) * (m?.crop.h ?? 1)];
  };
  hit.addEventListener('pointerdown', (e) => {
    lastPointer = e.pointerType;
  });
  hit.addEventListener('pointerenter', (e) => {
    lastPointer = e.pointerType;
    if (e.pointerType === 'touch') return;
    pointer = toCrop(e);
    scanStart('pointer');
  });
  hit.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    pointer = toCrop(e);
    if (state === 'closed') scanStart('pointer');
    kick();
  });
  hit.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'touch') scanStop();
  });
  hit.addEventListener('focus', () => {
    if (hit.matches(':focus-visible')) scanStart('sweep');
  });
  hit.addEventListener('blur', () => scanStop());
  hit.addEventListener('click', (e) => {
    if (hit.getAttribute('aria-disabled') === 'true') return;
    const touch = lastPointer === 'touch' && e.detail > 0;
    lastPointer = 'mouse';
    if (state === 'open') return close();
    if (touch && state === 'closed') return scanStart('sweep'); // first tap: scan
    open(); // second tap, a click, Enter or Space
  });
  replayBtn.addEventListener('click', () => close(true));
  sealBtn.addEventListener('click', () => {
    close();
    hit.focus({ preventScroll: true });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || state !== 'open') return;
    const r = section.getBoundingClientRect();
    if (r.bottom > 0 && r.top < innerHeight) close();
  });

  /* ------------------------------------------------------------- setup --- */

  const ro = new ResizeObserver(() => layout());
  ro.observe(stage);
  portraitMQ.addEventListener('change', layout);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) kick();
  });

  // start loading when the section is a screen away; release frames when far away
  function startLoading() {
    if (ready) return;
    ready = load().catch((err) => {
      console.warn('Helmet assets could not be loaded.', err);
      section.classList.add('is-static');
    });
    ready.then(() => {
      if (!reduced.matches && m) loadPoses();
    });
  }
  const io = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting) startLoading();
    },
    { rootMargin: '120% 0px 120% 0px' },
  );
  io.observe(section);
  // on screen: the open helmet's laser scan runs only while it can be seen
  new IntersectionObserver(
    ([entry]) => {
      inView = entry.isIntersecting;
      hudUp();
      if (inView) kick();
    },
    { threshold: 0.35 },
  ).observe(stage);

  // free decoded release frames when the section is far off screen (memory on phones)
  const far = new IntersectionObserver(
    ([entry]) => {
      if (!entry.isIntersecting && poses && state !== 'opening' && state !== 'closing') {
        release(poses);
        poses = null;
        posesLoading = null;
      } else if (entry.isIntersecting && !poses && m && !reduced.matches) {
        loadPoses();
      }
    },
    { rootMargin: '300% 0px 300% 0px' },
  );
  far.observe(section);

  return {
    get state() {
      return state;
    },
    open,
    close,
  };
}
