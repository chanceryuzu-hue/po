// Renders the page to static HTML at build time from src/content.ts, so
// every word, link and image is in the document before any script runs.
import { content, type Project } from './content';

interface Built {
  js: string;
  css: string | null;
  font: string;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const isExternal = (href: string) => /^https?:\/\//.test(href);
const linkAttrs = (href: string) => (isExternal(href) ? ' target="_blank" rel="noopener noreferrer"' : '');
const tag = (label = 'Placeholder') => `<span class="tag tag--placeholder">${esc(label)}</span>`;
const pad2 = (n: number) => String(n).padStart(2, '0');

const SCENES = [
  { id: 'hero', label: 'The Awakening' },
  { id: 'hero', label: 'The Arrival', key: 'arrival' },
  { id: 'armor', label: 'Behind the Armor' },
  { id: 'core', label: 'The Core' },
  { id: 'work', label: 'The Lab' },
  { id: 'contact', label: 'The Next Mission' },
];

function head(b: Built, title: string, description: string, extra = '') {
  const url = content.siteUrl;
  return `<!doctype html>
<html lang="en" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<meta name="theme-color" content="#080808">
<meta name="color-scheme" content="dark">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(new URL('assets/og.jpg', url).href)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="An armoured figure in graphite and platinum, lit red from behind, with a thin white light across the brow.">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
<link rel="preload" href="${b.font}" as="font" type="font/woff" crossorigin>
${b.css ? `<link rel="stylesheet" href="${b.css}">` : ''}
<script>document.documentElement.classList.add('js');document.documentElement.classList.remove('no-js')</script>
${extra}
</head>`;
}

function picture(base: string, alt: string, cls: string, opts: { eager?: boolean; w?: number; h?: number } = {}) {
  // desktop and portrait renders of the same shot; the portrait one is a window of the same image plane
  const load = opts.eager ? 'eager" fetchpriority="high' : 'lazy';
  return `<picture class="${cls}">
  <source media="(max-aspect-ratio: 4/5)" srcset="${base}-portrait.webp">
  <img src="${base}-desktop.webp" alt="${esc(alt)}" loading="${load}" decoding="async" width="${opts.w ?? 2560}" height="${opts.h ?? 1440}">
</picture>`;
}

function nav() {
  const links = [
    ['Work', '#work'],
    ['About', '#about'],
    ['Capabilities', '#core'],
    ['Process', '#process'],
    ['Contact', '#contact'],
  ];
  const items = links.map(([l, h]) => `<a href="${h}">${l}</a>`).join('');
  return `<header class="nav">
  <a class="nav__brand" href="#hero">${esc(content.name)}<span class="nav__role">${esc(content.role)}</span></a>
  <nav class="nav__links" aria-label="Primary">${items}</nav>
  <button type="button" class="nav__toggle" aria-expanded="false" aria-controls="menu">Menu</button>
  <div class="nav__panel" id="menu" hidden>
    <nav aria-label="Menu">${items}</nav>
  </div>
</header>`;
}

function rail() {
  const items = SCENES.map(
    (s, i) =>
      `<li><a href="#${s.id}" data-rail="${s.key ?? s.id}"><span class="rail__n">${pad2(i + 1)}</span><span class="rail__label">${esc(s.label)}</span></a></li>`,
  ).join('');
  return `<nav class="rail" aria-label="Scenes"><ol>${items}</ol></nav>`;
}

function hero() {
  const h = content.hero;
  return `<section id="hero" class="scene hero" aria-labelledby="hero-title" data-scene="hero">
  <div class="hero__track">
    <div class="hero__stage">
      <div class="hero__frame" data-dive>
        ${picture('assets/hero/hero', 'An armoured figure in graphite and platinum stands in the dark, lit red from behind, a thin white light across the brow of the helmet and down the chest.', 'hero__still', { eager: true, w: 2560, h: 1440 })}
        <video class="hero__film" muted playsinline preload="none" aria-hidden="true" tabindex="-1"></video>
      </div>
      <div class="hero__veil" aria-hidden="true"></div>
      <div class="hero__copy">
        <p class="label hero__label"><span data-scene-label>Scene 01 · The Awakening</span></p>
        <h1 id="hero-title" class="hero__title">${esc(h.headline)}</h1>
        <p class="hero__support">${esc(h.support)}</p>
        <p class="hero__actions">
          <a class="button button--primary" href="${h.primary.href}">${esc(h.primary.label)}</a>
          <a class="button" href="${h.secondary.href}">${esc(h.secondary.label)}</a>
        </p>
      </div>
      <button type="button" class="hero__skip" hidden>Skip intro</button>
      <p class="scroll-cue" aria-hidden="true"><span>Scroll</span></p>
    </div>
  </div>
</section>`;
}

/** Holographic readouts the laser glasses project beside the head once the helmet is open. Decorative: the same words are in the page. */
function hud() {
  if (!content.portrait?.eyewear) return '';
  const caps = content.capabilities.map((c, i) => `<li style="--i:${i}"><span>${esc(c.title)}</span><b>Online</b></li>`).join('');
  const flow = content.process.map((p) => esc(p.title)).join(' <i>›</i> ');
  return `<div class="hud" aria-hidden="true" hidden>
      <svg class="hud__beams" width="100%" height="100%"><defs><linearGradient id="hud-beam-l" x1="1" x2="0" y1="0" y2="0"><stop offset="0" stop-color="#ff2a36" stop-opacity=".5"/><stop offset="1" stop-color="#ff2a36" stop-opacity=".06"/></linearGradient><linearGradient id="hud-beam-r" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#ff2a36" stop-opacity=".5"/><stop offset="1" stop-color="#ff2a36" stop-opacity=".06"/></linearGradient></defs><polygon class="hud__beam" data-side="l" fill="url(#hud-beam-l)"/><polygon class="hud__beam" data-side="r" fill="url(#hud-beam-r)"/></svg>
      <div class="hud__panel hud__panel--l" data-side="l">
        <p class="hud__head"><span>Operator</span><span>Link L</span></p>
        <div class="hud__body">
          <div class="hud__reticle"><i></i></div>
          <dl class="hud__rows">
            <div style="--i:0"><dt>Name</dt><dd>${esc(content.name)}</dd></div>
            <div style="--i:1"><dt>Role</dt><dd>${esc(content.role)}</dd></div>
            <div style="--i:2"><dt>Armor</dt><dd>Technology</dd></div>
            <div style="--i:3"><dt>Mind</dt><dd>Human</dd></div>
          </dl>
        </div>
      </div>
      <div class="hud__panel hud__panel--r" data-side="r">
        <p class="hud__head"><span>Systems</span><span>Link R</span></p>
        <ul class="hud__list">${caps}</ul>
        <p class="hud__flow">${flow}</p>
      </div>
    </div>`;
}

function armor() {
  const r = content.reveal;
  const placeholderHead = !content.portrait;
  return `<section id="armor" class="scene armor" aria-labelledby="armor-title" data-scene="armor">
  <div class="armor__stage">
    ${picture('assets/helmet/base', 'The armoured figure up close, helmet sealed, the dark visor lit by a thin white line.', 'armor__base', { w: 2560, h: 1440 })}
    <canvas class="armor__canvas" aria-hidden="true"></canvas>
    ${hud()}
    <button type="button" class="armor__hit" aria-label="Open the helmet" aria-describedby="armor-hint"></button>
    ${placeholderHead ? `<p class="armor__placeholder" hidden>${tag('Placeholder head')} Your portrait goes here</p>` : ''}
    <div class="armor__copy">
      <div class="armor__intro">
        <p class="label">Scene 03 · Behind the Armor</p>
        <h2 id="armor-title" class="armor__title">Behind the armor</h2>
        <p class="armor__hint" id="armor-hint">
          <span class="hint--pointer">Move over the visor to scan it. Click to open the helmet.</span>
          <span class="hint--touch">Tap the visor to scan it. Tap again to open the helmet.</span>
        </p>
        <p class="armor__status" role="status" aria-live="polite"></p>
      </div>
      <div class="armor__reveal">
        <blockquote class="armor__quote"><p>${esc(r.quote)}</p></blockquote>
        <p class="armor__name">${esc(content.name)}</p>
        <p class="armor__role label">${esc(content.role)}</p>
        ${placeholderHead ? `<p class="armor__placeholder-inline">${tag('Placeholder head')} Your portrait goes here</p>` : ''}
        <p class="armor__text">${esc(r.intro)}${r.introIsPlaceholder ? ' ' + tag() : ''}</p>
        <p class="armor__actions">
          <a class="button button--primary" href="${r.cta.href}">${esc(r.cta.label)}</a>
          <button type="button" class="button" data-armor="replay">Replay</button>
          <button type="button" class="button button--quiet" data-armor="seal">Seal helmet</button>
        </p>
      </div>
    </div>
  </div>
</section>`;
}

function about() {
  const a = content.about;
  const facts = a.facts
    .map(
      (f) =>
        `<div><dt>${esc(f.label)}</dt><dd>${f.value ? esc(f.value) : `<span class="muted">Not added yet</span> ${tag()}`}</dd></div>`,
    )
    .join('');
  return `<section id="about" class="section about" aria-labelledby="about-title">
  <div class="wrap about__grid">
    <p class="label about__label">About</p>
    <h2 id="about-title" class="section__title">${esc(a.heading)}</h2>
    <div class="about__body">
      ${a.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('\n      ')}
      ${a.paragraphsArePlaceholder ? `<p>${tag('Placeholder text')}</p>` : ''}
    </div>
    <dl class="facts">${facts}</dl>
  </div>
</section>`;
}

function core() {
  const items = content.capabilities
    .map(
      (c, i) => `<li class="cap">
        <span class="cap__n">${pad2(i + 1)}</span>
        <h3 class="cap__title">${esc(c.title)}</h3>
        <p class="cap__text">${esc(c.text)}</p>
      </li>`,
    )
    .join('');
  return `<section id="core" class="scene core" aria-labelledby="core-title" data-scene="core">
  <div class="core__track">
    <div class="core__stage">
      <div class="core__frame" data-core-zoom>
        ${picture('assets/core/core', 'A close view down the chest plates of the armour to the white light running along the sternum.', 'core__still', { w: 2560, h: 1440 })}
      </div>
      <div class="core__glow" aria-hidden="true"></div>
      <div class="core__fade" aria-hidden="true"></div>
      <div class="core__intro">
        <p class="label">Scene 04 · The Core</p>
        <h2 id="core-title" class="section__title">What powers the work</h2>
      </div>
    </div>
  </div>
  <div class="wrap core__list">
    <ol class="caps">${items}</ol>
    ${content.capabilitiesNote ? `<p class="note">${tag('Check')} ${esc(content.capabilitiesNote)}</p>` : ''}
  </div>
</section>`;
}

function projectCard(p: Project, i: number) {
  const img = p.image
    ? `<img src="${p.image}" alt="${esc(p.imageAlt ?? '')}" loading="lazy" decoding="async" width="1600" height="840">`
    : '';
  const link = p.url
    ? `<a class="button" href="${esc(p.url)}"${linkAttrs(p.url)}>${esc(p.linkLabel ?? 'View project')}<span class="visually-hidden"> (opens in a new tab)</span></a>`
    : '';
  return `<article class="project" aria-labelledby="project-${i}">
    <div class="project__media">${img}</div>
    <div class="project__body">
      <p class="label project__n">Project ${pad2(i + 1)} ${p.draft ? tag('Draft: confirm before publishing') : ''}</p>
      <h3 id="project-${i}" class="project__title">${esc(p.title)}</h3>
      <p class="project__text">${esc(p.description)}</p>
      <dl class="project__meta">
        <div><dt>Problem</dt><dd>${esc(p.problem)}</dd></div>
        <div><dt>My role</dt><dd>${p.role ? esc(p.role) : `<span class="muted">Add your role</span> ${tag()}`}</dd></div>
        <div><dt>Built with</dt><dd><ul class="chips">${p.tech.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></dd></div>
      </dl>
      ${link}
    </div>
  </article>`;
}

function work() {
  const cards = content.projects.map(projectCard).join('\n');
  const slots = Array.from(
    { length: content.projectSlots },
    (_, i) => `<article class="project project--slot" aria-label="Empty project slot">
    <p class="label">Project ${pad2(content.projects.length + i + 1)} ${tag('Empty slot')}</p>
    <p class="project__slot-text">A case study goes here: title, the problem, your role, the tools, real images and a working link. Add it in <code>src/content.ts</code>.</p>
  </article>`,
  ).join('\n');
  return `<section id="work" class="scene section work" aria-labelledby="work-title" data-scene="work">
  <div class="wrap">
    <div class="work__head">
      <p class="label">Scene 05 · The Lab</p>
      <h2 id="work-title" class="section__title">Selected work</h2>
    </div>
    <div class="projects">${cards}${slots}</div>
  </div>
</section>`;
}

function process() {
  const steps = content.process
    .map(
      (s, i) => `<li class="step">
      <span class="step__n">${pad2(i + 1)}</span>
      <h3 class="step__title">${esc(s.title)}</h3>
      <p class="step__text">${esc(s.text)}</p>
    </li>`,
    )
    .join('');
  return `<section id="process" class="section process" aria-labelledby="process-title">
  <div class="wrap">
    <p class="label">Process</p>
    <h2 id="process-title" class="section__title">${content.process.map((s) => esc(s.title)).join('<span class="arrow" aria-hidden="true"> → </span>')}</h2>
    <ol class="steps">${steps}</ol>
  </div>
</section>`;
}

function contact() {
  const c = content.contact;
  const email = c.email
    ? `<a class="button button--primary" href="mailto:${esc(c.email)}">Email ${esc(c.email)}</a>
       <button type="button" class="button button--quiet" data-copy="${esc(c.email)}">Copy address</button>`
    : `<span class="button button--primary is-disabled" aria-disabled="true">Email address not added yet</span> ${tag()}`;
  const phone = c.phone ? `<a class="button" href="tel:${esc(c.phone.replace(/\s+/g, ''))}">Call ${esc(c.phone)}</a>` : '';
  const links = c.links
    .map((l) => `<a class="button" href="${esc(l.href)}"${linkAttrs(l.href)}>${esc(l.label)}<span class="visually-hidden"> (opens in a new tab)</span></a>`)
    .join('');
  return `<section id="contact" class="scene contact" aria-labelledby="contact-title" data-scene="contact">
  <div class="contact__stage">
    <div class="contact__frame" data-parallax>
      ${picture('assets/final/final', 'The armoured figure seen from below, helmet sealed, lit by its own white lines and a red glow behind.', 'contact__still', { w: 2560, h: 1440 })}
    </div>
    <div class="contact__copy wrap">
      <p class="label">Scene 06 · The Next Mission</p>
      <h2 id="contact-title" class="contact__title">${esc(c.heading)}</h2>
      <p class="contact__support">${esc(c.support)}</p>
      <p class="contact__actions">${email}${phone}${links}</p>
      <p class="contact__copied" role="status" aria-live="polite"></p>
    </div>
  </div>
</section>`;
}

function footer() {
  const year = new Date().getFullYear();
  return `<footer class="footer">
  <div class="wrap footer__grid">
    <p class="footer__name">${esc(content.name)}</p>
    <p class="muted">${esc(content.role)}</p>
    <p class="muted footer__note">The armour, its light and every frame on this page are rendered from code. No real armour was harmed.</p>
    <p class="muted">© ${year} ${esc(content.name)}</p>
  </div>
</footer>`;
}

export function html(b: Built) {
  const title = `${content.name} · ${content.role}`;
  const description = content.hero.support;
  return `${head(b, title, description)}
<body>
<a class="skip-link" href="#armor">Skip to the helmet reveal</a>
${nav()}
${rail()}
<main>
${hero()}
${armor()}
${about()}
${core()}
${work()}
${process()}
${contact()}
</main>
${footer()}
<div class="grain" aria-hidden="true"></div>
<script type="module" src="${b.js}"></script>
</body>
</html>
`;
}

export function alignHtml(b: Built) {
  return `${head(b, 'Align your portrait', 'Line up a portrait with the helmet opening.', '<meta name="robots" content="noindex">')}
<body class="align-page">
<main class="wrap align">
  <h1 class="section__title">Align your portrait</h1>
  <ol class="align__steps">
    <li>Choose a front-facing photo: eyes open, looking at the camera, even light, no glasses.</li>
    <li>Click the centre of your <strong>right</strong> eye (on the left of the photo), then your <strong>left</strong> eye, then the bottom of your chin.</li>
    <li>Check the preview, then copy the block into <code>src/content.ts</code> and rebuild.</li>
  </ol>
  <p><label class="button" for="align-file">Choose a photo</label> <input id="align-file" type="file" accept="image/*" class="visually-hidden"> <button type="button" class="button button--quiet" data-align="reset">Start the points again</button></p>
  <p class="align__status" role="status" aria-live="polite">No photo chosen yet.</p>
  <div class="align__panes">
    <div class="align__pane"><canvas class="align__photo" aria-label="Your photo. Click the eyes and chin."></canvas></div>
    <div class="align__pane"><canvas class="align__preview" aria-label="Preview of your face inside the open helmet."></canvas></div>
  </div>
  <label class="align__label" for="align-src">Path to the photo, relative to <code>public/</code></label>
  <input id="align-src" class="align__input" value="assets/my-face.png">
  <div class="align__tune">
    <label>Exposure <input type="range" min="0.6" max="1.6" step="0.02" value="1" data-align="exposure"></label>
    <label>Warmth <input type="range" min="0.85" max="1.15" step="0.01" value="1" data-align="warmth"></label>
  </div>
  <pre class="align__out" aria-label="Portrait settings to copy"><code>portrait: null,</code></pre>
  <p><button type="button" class="button button--primary" data-align="copy">Copy the block</button></p>
</main>
<script type="module" src="${b.js}"></script>
</body>
</html>
`;
}
