// Renders every page asset this pipeline owns, in one resumable queue.
//   node scripts/render-assets.mjs <outDir>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] || 'out';
const plan = JSON.parse(readFileSync(join(out, 'helmet/plan.json')));
const shoot = (dir, query, jobs) =>
  execFileSync('node', [new URL('./shoot.mjs', import.meta.url).pathname, dir, query, JSON.stringify(jobs)], { stdio: 'inherit' });
const win = (w) => `${w.x},${w.y},${w.w},${w.h}`;

// Scene 03: every release pose (beauty + matte), the cleared visor, the clay head, the shading on the head
const { crop, pad } = plan;
const padded = { x: crop.x - pad, y: crop.y - pad, w: crop.w + 2 * pad, h: crop.h + 2 * pad };
const jobs = [];
plan.poses.forEach((p, k) => {
  const n = String(k).padStart(2, '0');
  jobs.push({ name: `beauty_${n}`, p, pass: 'beauty' }, { name: `matte_${n}`, p, pass: 'matte' });
});
jobs.push(
  { name: 'clear', p: 0, pass: 'beauty', clear: true },
  { name: 'clear_matte', p: 0, pass: 'matte', clear: true },
  { name: 'clay', p: 1, pass: 'clay' },
  { name: 'shading', p: 1, pass: 'shading' },
);
shoot(join(out, 'helmet/crop'), `cam=helmet&win=${win(padded)}&msaa=4`, jobs);
shoot(join(out, 'helmet'), `cam=helmet&win=${win(plan.windows.desktop)}&msaa=4`, [{ name: 'desktop', p: 0, pass: 'beauty' }]);
shoot(join(out, 'helmet'), `cam=helmet&win=${win(plan.windows.portrait)}&msaa=4`, [{ name: 'portrait', p: 0, pass: 'beauty' }]);

// Scene 04 and Scene 06 stills
shoot(join(out, 'core'), 'cam=core&win=720,0,2560,1440&msaa=4&focus=0,-0.1,0.1', [{ name: 'desktop', pass: 'beauty' }]);
shoot(join(out, 'core'), 'cam=core&win=1460,-240,1080,1920&msaa=4&focus=0,-0.1,0.1', [{ name: 'portrait', pass: 'beauty' }]);
shoot(join(out, 'final'), 'cam=final&win=413,0,2560,1440&msaa=4', [{ name: 'desktop', pass: 'beauty', preset: 'final' }]);
shoot(join(out, 'final'), 'cam=final&win=1460,-150,1080,1920&msaa=4', [{ name: 'portrait', pass: 'beauty', preset: 'final' }]);
console.log('ALL DONE');
