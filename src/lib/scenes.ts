// Scroll-linked scenes, the scene rail, reveal-on-enter, navigation.
// Native scrolling only: one passive scroll listener reads positions and
// writes transforms on the next frame, so every effect reverses when the
// visitor scrolls back up.

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (t: number) => {
  t = clamp01(t);
  return t * t * (3 - 2 * t);
};

type Pt = [number, number];

/** Where a point of an object-fit: cover image lands inside its box. */
function coverPoint(box: HTMLElement, natural: Pt, frac: Pt): Pt {
  const W = box.clientWidth, H = box.clientHeight;
  const s = Math.max(W / natural[0], H / natural[1]);
  return [(W - natural[0] * s) / 2 + frac[0] * natural[0] * s, (H - natural[1] * s) / 2 + frac[1] * natural[1] * s];
}

export function initScenes(opts: { visor: () => { desktop: Pt; portrait: Pt } }) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const portraitMQ = matchMedia('(max-aspect-ratio: 4/5)');

  const heroTrack = document.querySelector<HTMLElement>('.hero__track')!;
  const heroFrame = document.querySelector<HTMLElement>('.hero__frame')!;
  const heroCopy = document.querySelector<HTMLElement>('.hero__copy')!;
  const heroVeil = document.querySelector<HTMLElement>('.hero__veil')!;
  const cue = document.querySelector<HTMLElement>('.scroll-cue');
  const armor = document.querySelector<HTMLElement>('.armor')!;
  const coreTrack = document.querySelector<HTMLElement>('.core__track')!;
  const coreFrame = document.querySelector<HTMLElement>('.core__frame')!;
  const coreGlow = document.querySelector<HTMLElement>('.core__glow')!;
  const coreFade = document.querySelector<HTMLElement>('.core__fade')!;
  const coreIntro = document.querySelector<HTMLElement>('.core__intro')!;
  const contactFrame = document.querySelector<HTMLElement>('.contact__frame')!;
  const contact = document.querySelector<HTMLElement>('.contact')!;

  let queued = false;
  function frame() {
    queued = false;
    const vh = innerHeight;
    const still = !reduced.matches;

    // 01–02 → 03: dive towards the visor and go to black
    {
      const r = heroTrack.getBoundingClientRect();
      const p = clamp01(-r.top / Math.max(1, r.height - vh));
      const v = opts.visor();
      const frac = portraitMQ.matches ? v.portrait : v.desktop;
      const natural: Pt = portraitMQ.matches ? [1080, 1920] : [2560, 1440];
      const [ox, oy] = coverPoint(heroFrame, natural, frac);
      heroFrame.style.transformOrigin = `${ox}px ${oy}px`;
      heroFrame.style.transform = still ? `scale(${1 + 2.2 * smooth(p) ** 1.6})` : '';
      heroCopy.style.opacity = String(1 - smooth(p / 0.28));
      heroCopy.style.transform = still ? `translateY(${-40 * smooth(p / 0.28)}px)` : '';
      heroVeil.style.opacity = String(smooth((p - 0.42) / 0.5));
      if (cue) cue.style.opacity = String(1 - smooth(p / 0.08));
    }
    // 03 enters out of the black
    {
      const r = armor.getBoundingClientRect();
      armor.style.setProperty('--enter', String(clamp01(1 - r.top / vh)));
    }
    // 04: into the light on the sternum
    {
      const r = coreTrack.getBoundingClientRect();
      const p = clamp01(-r.top / Math.max(1, r.height - vh));
      coreFrame.style.transform = still ? `scale(${1 + 1.9 * smooth(p) ** 1.4})` : '';
      coreGlow.style.opacity = String(smooth((p - 0.3) / 0.4));
      coreFade.style.opacity = String(smooth((p - 0.78) / 0.22));
      coreIntro.style.opacity = String(1 - smooth((p - 0.15) / 0.3));
    }
    // 06: the final pose settles as it arrives
    {
      const r = contact.getBoundingClientRect();
      const p = clamp01(1 - r.top / vh);
      contactFrame.style.transform = still ? `scale(${1.1 - 0.1 * smooth(p)}) translateY(${(1 - smooth(p)) * 4}%)` : '';
    }
  }
  const onScroll = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(frame);
    }
  };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  reduced.addEventListener('change', onScroll);
  frame();

  /* -------------------------------------------------------- scene rail --- */
  const rail = new Map<string, HTMLElement>();
  document.querySelectorAll<HTMLElement>('[data-rail]').forEach((a) => rail.set(a.dataset.rail!, a));
  const sectionToRail: Record<string, string> = {
    hero: 'hero',
    armor: 'armor',
    about: 'armor',
    core: 'core',
    work: 'work',
    process: 'work',
    contact: 'contact',
  };
  const visible = new Map<string, number>();
  const setActive = () => {
    let best = '', bestV = 0;
    visible.forEach((v, k) => {
      if (v > bestV) {
        best = k;
        bestV = v;
      }
    });
    let key = sectionToRail[best] ?? '';
    if (key === 'hero' && document.querySelector('.hero.is-settled')) key = 'arrival';
    rail.forEach((a, k) => {
      if (k === key) a.setAttribute('aria-current', 'step');
      else a.removeAttribute('aria-current');
    });
  };
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) visible.set(e.target.id, e.intersectionRect.height);
      setActive();
    },
    { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
  );
  Object.keys(sectionToRail).forEach((id) => {
    const el = document.getElementById(id);
    if (el) io.observe(el);
  });

  /* ---------------------------------------------------- reveal on enter --- */
  const targets = document.querySelectorAll<HTMLElement>(
    '.about__grid > *, .facts > div, .cap, .core__list .note, .work__head, .project, .process .label, .process .section__title, .step',
  );
  if (!reduced.matches && 'IntersectionObserver' in window) {
    targets.forEach((el, i) => {
      el.setAttribute('data-reveal', '');
      el.style.setProperty('--d', `${(i % 5) * 70}ms`);
    });
    const ro = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('is-in');
            ro.unobserve(e.target);
          }
        }
      },
      { rootMargin: '0px 0px -12% 0px' },
    );
    targets.forEach((el) => ro.observe(el));
  }

  return { setActive, refresh: onScroll };
}

export function initNav() {
  const toggle = document.querySelector<HTMLButtonElement>('.nav__toggle')!;
  const panel = document.querySelector<HTMLElement>('.nav__panel')!;
  const setOpen = (open: boolean) => {
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? 'Close' : 'Menu';
    panel.hidden = !open;
    document.documentElement.classList.toggle('menu-open', open);
    if (open) panel.querySelector<HTMLAnchorElement>('a')?.focus();
  };
  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
  panel.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('a')) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) {
      setOpen(false);
      toggle.focus();
    }
  });
}

export function initCopy() {
  const out = document.querySelector<HTMLElement>('.contact__copied');
  document.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(b.dataset.copy!);
        if (out) out.textContent = 'Address copied.';
      } catch {
        if (out) out.textContent = `Copy this address: ${b.dataset.copy}`;
      }
    }),
  );
}
