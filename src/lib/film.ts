// Scenes 01–02: the opening shot plays once, then hands over to a still of
// its final frame (the same image, sharper), where the hero copy lives.
// Scrolling, the Skip button, reduced motion, Save-Data, a missing codec or
// a stalled download all end the film early on that same still.

interface HeroInfo {
  /** Where the visor sits in each still, as fractions of the image. */
  visor: { desktop: [number, number]; portrait: [number, number] };
  settleAt: number; // seconds into the film when the copy appears
}

export function initFilm(section: HTMLElement, onSettled: () => void) {
  const root = document.documentElement;
  const video = section.querySelector<HTMLVideoElement>('.hero__film')!;
  const skip = section.querySelector<HTMLButtonElement>('.hero__skip')!;
  const label = section.querySelector<HTMLElement>('[data-scene-label]')!;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const portrait = matchMedia('(max-aspect-ratio: 4/5)').matches;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  let settled = false;
  let info: HeroInfo = { visor: { desktop: [0.5, 0.37], portrait: [0.5, 0.37] }, settleAt: 9.3 };

  const ready = fetch('assets/hero/hero.json')
    .then((r) => r.json())
    .then((j: HeroInfo) => (info = j))
    .catch(() => info);

  function settle() {
    if (settled) return;
    settled = true;
    root.classList.remove('is-intro');
    section.classList.add('is-settled');
    label.textContent = 'Scene 02 · The Arrival';
    skip.hidden = true;
    // keep the last frame up while the still fades in over it, then let the video go
    setTimeout(() => {
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.hidden = true;
    }, 900);
    window.removeEventListener('scroll', onScroll);
    onSettled();
  }

  const onScroll = () => {
    if (scrollY > 60) settle();
  };

  const mp4 = video.canPlayType('video/mp4; codecs="avc1.640028"');
  const webm = video.canPlayType('video/webm; codecs="vp9"');
  const canPlay = mp4 === 'probably' || mp4 === 'maybe' || webm === 'probably' || webm === 'maybe';
  const skipIntro = reduced || conn?.saveData || scrollY > 60 || location.hash.length > 1 || !canPlay;

  if (skipIntro) {
    video.hidden = true;
    settled = true;
    section.classList.add('is-settled');
    label.textContent = 'Scene 02 · The Arrival';
    queueMicrotask(onSettled);
    return { ready, info: () => info };
  }

  root.classList.add('is-intro');
  skip.hidden = false;
  const base = portrait ? 'assets/intro/intro-portrait' : 'assets/intro/intro-1080';
  video.src = mp4 === 'probably' || (mp4 === 'maybe' && webm !== 'probably') ? `${base}.mp4` : `${base}.webm`;
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;

  // if nothing is playing after a few seconds, show the still instead of a black screen
  const failsafe = setTimeout(settle, 6000);
  video.addEventListener('playing', () => clearTimeout(failsafe), { once: true });
  video.addEventListener('error', settle, { once: true });
  video.addEventListener('ended', settle, { once: true });
  video.addEventListener('timeupdate', () => {
    if (video.currentTime >= info.settleAt) section.classList.add('is-arriving');
  });
  video.addEventListener(
    'canplay',
    () => {
      video.play().catch(settle);
    },
    { once: true },
  );
  video.load();
  skip.addEventListener('click', () => {
    settle();
    section.querySelector<HTMLElement>('.hero__actions a')?.focus();
  });
  window.addEventListener('scroll', onScroll, { passive: true });
  return { ready, info: () => info };
}
