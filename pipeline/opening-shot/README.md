# Sentinel: opening shot

A 12-second, 1920×1080, 24 fps opening shot of an original armoured hero. The figure emerges from black under a crimson rim light. Then the cool-white light seams switch on: brow first, then collar, then sternum. Light comes up softly on the armour while the camera makes one slow push-in. The shot ends on a centred, stable frame for the cut.

Everything is generated from code: the model is a signed-distance sculpture meshed offline, and the frames are rendered with Three.js (WebGL) in headless Chromium.

## Files

| Path | What it is |
|---|---|
| `model/sdf.mjs` | The hero as signed-distance functions: helmet plates, visor, gorget rings, chest, collar, arm and shoulder plates, plus the seam light paths |
| `model/build.mjs` | Meshes each part (surface nets), culls hidden surfaces, bakes AO, light visibility and edge curvature per vertex → `render/assets/model.bin/json` |
| `render/timeline.js` | The whole shot as a function of time: camera push-in, light ramps, seam ignition and flicker |
| `render/shaders.js` | Armour shading (anisotropic GGX, area lights, seam line lights), seam emission, background haze, dust with depth-of-field, final film pass (ACES, grade, vignette, grain) |
| `render/scene.js` | Scene assembly, bloom and post chain; exposes `renderAt(t)` and `grab()` |
| `scripts/render.mjs` | Headless renderer for stills and frame ranges (resumable) |

## Re-rendering

```bash
node model/build.mjs                                  # ~2 min; add --quick for a fast preview mesh
node scripts/render.mjs stills out 4.6,11.5           # look-dev stills (query string optional)
node scripts/render.mjs frames frames 0 287           # full sequence (PNG)
ffmpeg -framerate 24 -i frames/frame_%04d.png -c:v libx264 -preset veryfast -crf 14 \
  -pix_fmt yuv420p -movflags +faststart sentinel_opening.mp4
```

Look parameters can be overridden per render with a query string, e.g. `"rim=9&key=6&seam=0.12&glow=5&exp=1.1"`.

`scripts/render.mjs` loads Playwright and sharp from this machine's preinstalled paths. Elsewhere, `npm i playwright sharp` and change the two `require` paths.

## Timeline

| Time | Beat |
|---|---|
| 0.0–1.2 s | Black; a few motes catch the light |
| 1.1–5.3 s | Crimson rim lights rise and the silhouette emerges |
| 4.44–4.75 s | Brow light flickers on at the centre |
| 4.6–5.4 s | Brow light draws out to both temples |
| 5.45–6.0 s | Collar seam lights |
| 5.85–6.75 s | Sternum seam draws downward; light spills onto the chest plates |
| 7.0–9.8 s | Soft overhead key and frontal fill reveal the surfaces |
| 0–10.8 s | Continuous push-in, eased in and out |
| 10.8–12.0 s | Stable hold for the transition |
