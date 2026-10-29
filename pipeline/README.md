# Asset pipeline

Renders every image and the film used by the page. Three.js runs in headless Chromium with software WebGL, so a GPU is not required (just time). Nothing here ships to the site.

```
model/sdf.mjs          the armour, the helmet mechanism parts, the padding and the placeholder head as signed-distance functions
model/build.mjs        meshes every part (surface nets), culls hidden surfaces, bakes occlusion and light visibility
                       (static parts with the helmet sealed, the head and padding with it open) → render/assets/model.*
render/rig.js          the release mechanism (latch pins, visor slide and pivot, faceplate unseat/swing/dock) and the cameras
render/scene.js        page renderer: passes (beauty with the head held out, matte, cleared visor, clay head, light on the head)
render/shaders.js      armour shading, area and line lights, quilted padding, background haze, dust, film grade
scripts/plan-helmet.mjs    picks the 40 release poses (spaced by on-screen motion), the crop and the landmarks
scripts/render-assets.mjs  renders Scene 03 (crop poses, sealed frames), Scene 04 and Scene 06 stills
scripts/pack-helmet.mjs    trims, makes the head transparent, feathers the crop, writes WebP and helmet.json
scripts/pack-stills.mjs    encodes the opening film (H.264 + VP9, landscape + phone crop) and the stills
scripts/shoot.mjs          renders any list of passes from one page load (look-dev and the scripts above)
```

The opening film itself comes from the opening-shot renderer in `opening-shot/` (its own README explains it): the same armour, with the film's timeline. Render its 288 frames without grain, plus one 3413×1920 frame at t = 287/24 for the hero still, then pass both to `pack-stills.mjs`:

```bash
cd opening-shot
node model/build.mjs
node scripts/render.mjs frames <film-frames-dir> 0 287 "grain=0"
node scripts/render.mjs stills <hero-dir> 11.958333 "w=3413&h=1920&grain=0"
```

## Re-render

```bash
cd pipeline
node model/build.mjs                           # ~3 min (add --quick for a fast, unbaked preview mesh)
node scripts/plan-helmet.mjs out/helmet/plan.json
node scripts/render-assets.mjs out             # ~45 min on 2 CPU cores
node scripts/pack-helmet.mjs out/helmet ../public/assets
node scripts/pack-stills.mjs out ../public/assets <film-frames-dir> <hero-3413x1920.png>
```

Look-dev: `node scripts/shoot.mjs <dir> "cam=helmet&win=413,0,2560,1440&scale=0.5" '[{"name":"a","p":0.5,"pass":"clay"}]'`.
`p` is the release progress (0 sealed, 1 open). `debugCam=x,y,z,tx,ty,tz` gives a free camera.

The scripts load Playwright and sharp from this machine's preinstalled paths. Elsewhere, run `npm i playwright sharp` and change the `require` lines.

Changing the mechanism or the cameras changes the landmarks in `helmet.json`. A portrait aligned with `/align.html` stays valid, because alignment is stored in the photo's own pixels.

The opening in the padding (`faceOval` in `model/sdf.mjs`) narrows below the cheekbones to follow the face, like fitted cheek pads. Keep it inside the part of the face that still looks towards the camera: where the opening ran past the turning jaw, the padding met the face edge-on and its meshed edge broke into visible steps.

## Not included

- A loader for a scanned face mesh: the placeholder head is an SDF sculpture.
- A full-body, rigged character: Scene 02 is a camera move toward a bust, not a walk.
