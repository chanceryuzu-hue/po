// Encodes the opening shot and the stills for the page.
//   node scripts/pack-stills.mjs <outDir> <publicAssetsDir> <introFramesDir> <heroHiresPng>
//
//  - intro/intro-1080.{mp4,webm}: the opening shot, 1920x1080, 24 fps, no grain
//    (the page adds grain to everything at once)
//  - intro/intro-portrait.{mp4,webm}: the centre 608x1080 of the same frames, for phones
//  - hero/hero-{desktop,portrait}.webp: the last frame rendered at 3413x1920; desktop is
//    it downscaled to 2560x1440, portrait its centre 1080x1920 (the same image the
//    phone video shows, sharper)
//  - core/ and final/: Scene 04 and 06 stills; og.jpg for link previews
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const sharp = require('/opt/npm-tools/node_modules/sharp');
const [outDir = 'out', assets = '../public/assets', frames, heroPng] = process.argv.slice(2);
for (const d of ['intro', 'hero', 'core', 'final', 'projects']) mkdirSync(join(assets, d), { recursive: true });

const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });

if (frames && existsSync(frames)) {
  const input = ['-framerate', '24', '-i', join(frames, 'frame_%04d.png')];
  const color = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
  const vf = (crop) => `${crop ? 'crop=608:1080:656:0,' : ''}scale=out_color_matrix=bt709:out_range=tv,format=yuv420p`;
  for (const [name, crop] of [['intro-1080', false], ['intro-portrait', true]]) {
    ff([...input, '-vf', vf(crop), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-x264-params', 'aq-mode=3', '-profile:v', 'high', ...color, '-movflags', '+faststart', '-an', join(assets, `intro/${name}.mp4`)]);
    ff([...input, '-vf', vf(crop), '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '33', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', ...color, '-an', join(assets, `intro/${name}.webm`)]);
    console.log('encoded', name);
  }
}

if (heroPng && existsSync(heroPng)) {
  await sharp(heroPng).resize(2560, 1440, { kernel: 'lanczos3' }).webp({ quality: 84, effort: 5 }).toFile(join(assets, 'hero/hero-desktop.webp'));
  const meta = await sharp(heroPng).metadata();
  const left = Math.round((meta.width - meta.height * (9 / 16)) / 2);
  await sharp(heroPng).extract({ left, top: 0, width: Math.round(meta.height * (9 / 16)), height: meta.height }).resize(1080, 1920).webp({ quality: 84, effort: 5 }).toFile(join(assets, 'hero/hero-portrait.webp'));
  await sharp(heroPng).resize(1200, 675).extract({ left: 0, top: 22, width: 1200, height: 630 }).jpeg({ quality: 84, mozjpeg: true }).toFile(join(assets, 'og.jpg'));
  // the visor in the hero frame (the opening shot's final camera; see pipeline README)
  const visor = { desktop: [0.5, 0.371], portrait: [0.5, 0.371] }; // (0, 0.244, 0.144) seen from (0, 0.158, 2.02)
  writeFileSync(join(assets, 'hero/hero.json'), JSON.stringify({ visor, settleAt: 9.3 }));
  console.log('hero stills written');
}

for (const scene of ['core', 'final']) {
  for (const v of ['desktop', 'portrait']) {
    const src = join(outDir, scene, `${v}.png`);
    if (existsSync(src)) await sharp(src).webp({ quality: 84, effort: 5 }).toFile(join(assets, scene, `${scene}-${v}.webp`));
  }
}
console.log('stills written');
