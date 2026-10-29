# Behind the Armor

A cinematic personal portfolio for a Creative Technologist. The page plays as one continuous scene. An armoured figure wakes in the dark and settles into the hero shot. Then, in Scene 03, its helmet opens to show the person inside.

Everything on screen comes from code in this repository: the armour model, the light, the opening shot and every pose of the helmet release. All text, links, projects, contact details and the portrait live in one file, `src/content.ts`, separate from the rendered assets.

## Quick start

Requires Node 20 or newer.

```bash
npm install          # esbuild and TypeScript only; the site has no runtime dependencies
npm run dev          # build, serve dist/ at http://localhost:4173, rebuild on change
npm run build        # production build in dist/ (static files: upload the folder anywhere)
npm run typecheck
npm test             # end-to-end checks in headless Chromium (needs: npm i -D playwright && npx playwright install chromium)
```

`dist/` is a plain static site. It works from any static host or a sub-folder, because every path is relative. Serve it with byte-range support (every static host does) so the opening film can stream.

### Deploying

Use a new hosting target of its own; nothing here touches any existing site.

- **Firebase Hosting** (a new site in your project): `firebase hosting:sites:create <new-site-id>`, then set `"public": "dist"` for that site in `firebase.json`. Run `npm run build`, then `firebase deploy --only hosting:<new-site-id>`.
- **Netlify, Cloudflare Pages, Vercel**: build command `npm run build`, output directory `dist`.
- **Caching**: serve `assets/*.js`, `assets/*.css` and `assets/*.woff` (hashed names) with a long cache. Serve `index.html` and `assets/**/*.json` with a short one.
- **Rollback**: every build is a self-contained folder. Keep the previous `dist/` (or use your host's release history) and redeploy it.

## Make it yours

Edit `src/content.ts`, then rebuild. Each field is commented. Items still to fill in show on the page with a visible gold **Placeholder** tag:

| Field | What it controls | Status |
|---|---|---|
| `name` | Header, reveal, footer, page title | **Placeholder: "Your Name"** |
| `siteUrl` | Canonical link and sharing previews | **Placeholder: example.com** |
| `reveal.intro` | The short introduction under the revealed face | **Placeholder text** |
| `about.paragraphs`, `about.facts` | About section | **Placeholder text**, facts empty |
| `capabilities` | The five areas from the brief, with neutral descriptions | Tagged "Check": keep only what you offer |
| `projects` | Selected work | One draft entry (Gyre, linked to its repository; tagged "Draft" until you confirm it and add your role), plus two empty case-study slots |
| `contact.email`, `contact.phone` | Contact buttons | **Not set.** The email button reads "Email address not added yet"; nothing is invented |
| `contact.links` | External profiles | GitHub: `https://github.com/chanceryuzu-hue` (check it is yours) |
| `portrait` | The face behind the visor | **Set:** your photo, relit for the scene, with your glasses redrawn as a red laser frame |

### Your portrait

Your photo is in `public/assets/portrait/my-face.webp`. When the helmet opens, your face is behind it, lit by the scene. Your glasses are rebuilt as a red laser frame:
- a graphite browline in place of the clear one;
- red laser lines around both lenses and across the bridge;
- a faint red tint in the lenses, and the red light the lasers throw onto your skin.

The frame powers up with a short flicker as the helmet opens. While the helmet stays open and on screen, a slow scan line crosses the lenses. With reduced motion there is no flicker and no scan: the frame simply glows.

Once the helmet is open, the glasses also project two red holographic readouts, each joined to its lens by a faint beam. **Operator** shows your name, your role, "Armor: technology" and "Mind: human". **Systems** lists your capabilities and the process steps. The readouts only repeat words from `src/content.ts`: no invented numbers, levels or claims. They are hidden from screen readers, because the same words are already in the page.

Where the readouts go depends on the screen:
- **Wide screens:** either side of the head. The scene rail steps aside while they show. If the left one would cover the words, it moves up beside the crown; if there is no room there either (narrow laptops, about 1024–1280 px wide), only the right one shows.
- **Tablets held upright:** beside the face.
- **Phones:** side by side above the helmet, shortened to the first lines.

How it was made, and how to redo it:

1. `pipeline/portrait/prep-portrait.py` (Python 3 with OpenCV and NumPy) takes the original photo. It traces the glasses from hand-placed points, then removes the thin parts of the old frame (metal rims, bridge, nose pads) by filling in from the skin around them. Finally it crops to the head, halves the size and writes `my-face.webp` and `eyewear.json` (the frame's outline):
   ```bash
   python3 pipeline/portrait/prep-portrait.py <original-photo.png> public/assets/portrait
   ```
2. The eye and chin positions in `src/content.ts` come from the same script. You can also find them with the alignment tool: run `npm run dev`, open `http://localhost:4173/align.html`, choose the photo, and click your right eye (on the left of the image), your left eye, then the bottom of your chin.
3. The laser colour is `eyewear.color` in `src/content.ts`.

**Changing the photo.** The traced outline belongs to this photo only. For a new photo with the same glasses, place new points at the top of the prep script. For a photo without glasses, set `eyewear: null`.

No re-rendering is needed:
- **Fit.** The face is fitted with rotation and uniform scale only, so your proportions are never stretched.
- **Lighting.** Your photo's own broad lighting is divided out and the scene's broad light is applied in colour: the white brow light from above, the falloff towards the chin and the cool fill. The padding also shades the face where it meets the helmet.
- **Grade.** The result goes through the same film grade as the rendered frames.
- **Detail.** Skin texture and the shape of your features come from your photo.

What a replacement photo needs:
- **Front-on and level.** The helmet camera looks straight at the face. A three-quarter photo cannot be turned to face forward; it will look wrong rather than slightly off.
- **Eyes open, looking at the camera.**
- **Even, soft light.** Strong side light or hard shadows survive the relighting at fine scale.
- Hair over the forehead is fine: the helmet's crown covers from about the eyebrows up. Ears, the jaw line and hair at the sides don't matter either: fitted cheek pads cover them, and only the face from brow to chin shows.

A photo is still flat: it cannot turn with the camera. The next step up is a phone 3D face scan (OBJ or GLB with texture) rendered in place of the placeholder head. That needs a small addition to `pipeline/` (a mesh loader for the head part) and is not included.

## How the page is put together

```
src/
  content.ts        all editable content (text, links, projects, contact, portrait)
  render-html.ts    renders the full page to static HTML at build time (works without JavaScript)
  main.ts           wires the scenes together
  lib/film.ts       Scenes 01–02: opening film, hand-over to the hero still
  lib/helmet.ts     Scene 03: loading, interaction state machine, canvas compositing
  lib/face.ts       portrait fitting, de-lighting, relighting
  lib/eyewear.ts    the red laser frame on the portrait's glasses (the HUD readouts are placed in lib/helmet.ts)
  lib/grade.ts      the renderer's film grade in JavaScript (ACES, split tone)
  lib/scenes.ts     scroll-linked effects, scene rail, reveal on enter, menu
  lib/load.ts       image loading, progressive frame sequences
  align.ts          the portrait alignment tool (align.html)
  styles/main.css   all styles
public/assets/      rendered and encoded assets (intro, hero, helmet, core, final, projects, portrait)
pipeline/           the renderer that produced those assets (see pipeline/README.md)
pipeline/portrait/  prep-portrait.py: crops your photo and traces and removes the old frame
tests/e2e.mjs       end-to-end checks
```

**Rendering approach.** The brief compared three options: (A) a real-time 3D character, (B) layered transparent images, (C) an image sequence rendered from one consistent 3D scene. This uses **C, with a live composite on top**. The armour's look depends on effects too heavy for phones in real time: anisotropic brushed metal, soft area lights, light lines that light the plates around them, baked occlusion and soft shadows, and a film grade. So the scene is rendered offline, once per helmet pose. The page then composites the face into those frames on a plain 2D canvas, so no WebGL is needed. Three.js is used only inside the offline renderer; the site ships no 3D library.

**Scene 03 layers**, bottom to top:
1. The sealed frame, a plain `<img>`, which is also the no-JavaScript view.
2. A canvas over the helmet only, holding:
   - the face layer: your relit portrait with the laser frame's solid parts (or the placeholder head);
   - the laser light: halo, laser lines and scan line, drawn over the face and kept bright while the panels still shade it;
   - the current release pose, an RGBA frame whose transparency is exactly where the head can be seen. 40 poses are rendered, spaced by how far things move on screen, and cross-faded in premultiplied colour.
   - While scanning, the cleared visor is revealed instead, around the pointer or behind a sweeping cyan line.

**The release.** Each panel follows a rigid path with a mechanical reason:
- The brass latch pins at the temples sink 2.5 mm, and the brow light flares as they let go.
- The visor slides 20 mm out of its recess, then pivots 50° up about the pin axis to rest above the brow.
- The faceplate splits along its centre ridge. The halves unseat 12 mm along their own normals, then swing back around the helmet's vertical axis and dock behind the cheek plates.

The face sits in quilted padding that follows the head, so the face and neck stay connected and the body armour never moves.

**Interaction rules.**
- Hover (or keyboard focus) scans the visor. Click, Enter or Space opens the helmet.
- On touch, the first tap scans and the second tap opens.
- Once open, **Replay** seals the helmet and runs the release again. **Seal helmet**, Escape or clicking the face closes it.
- Input is ignored while a transition is running. Progress is time-based, so scrolling away or switching tabs mid-animation never leaves the helmet half-open.

**Scroll.** Native scrolling throughout, with no wheel or touch interception. Scroll-linked effects read positions on one passive listener, so they reverse when you scroll up: the dive into the visor, Scene 03's entrance out of black, the push into the core light, the Scene 06 settle, and the scene rail.

**Fallbacks.**
- **Reduced motion:** no film and no scroll-linked motion. The helmet cross-fades between sealed and open, and its release frames are never downloaded.
- **Save-Data, a link to a section, or a browser that cannot play the film:** the intro is skipped, and the page settles on the hero still.
- **No JavaScript:** every word is in the HTML, shown over the hero still and the sealed helmet.
- No WebGL is needed anywhere.

## Tests and measurements

`npm test` builds nothing itself: run `npm run build` first. It serves `dist/` locally, drives headless Chromium through four visits and saves screenshots to `test-results/`. The last run passed **57 of 57** checks:

- **Desktop (1440×900):** the film starts, plays and hands over to the hero still; the scroll dive scales towards the visor and reverses; hover scans the visor and leaving ends the scan; click opens; the laser frame glows; both HUD readouts show, inside the screen and clear of the words, and the scene rail steps aside; the laser scan keeps moving while the helmet is open and stops completely when the section is off screen; Replay, Seal helmet, a second click and Escape all work; scrolling away mid-release still ends in a whole state; Tab reaches the helmet, keyboard focus scans, Enter opens and focus is visible; menu links land on their sections; external links open in a new tab with `rel="noopener"`; no horizontal overflow; no console errors or failed requests.
- **Phone (390×844, touch, 3× density):** the portrait cut of the film is used; Skip intro works; first tap scans, second tap opens; Replay is visible and works by touch; the HUD readouts sit above the face; the half-size release frames are used; the menu opens and closes; no overflow or errors.
- **Reduced motion:** no film, the hero copy shows at once, the helmet cross-fades, the reveal copy shows at once, and no release frames are downloaded.
- **No JavaScript:** the headline, the reveal quote, capabilities, work, process and contact are all in the HTML, and the hero image loads.

`node tests/portrait-check.mjs test-results/portrait` checks the alignment path with a known answer. It makes a stand-in portrait (the placeholder head rotated 7° and scaled 1.6×), aligns it with the alignment tool and builds a copy of the site with it. Last run: the tool recovered the three points to within 3 px, the face came back upright inside the helmet, and there were no page errors.

Measured on the last run:

| What | Result |
|---|---|
| Code shipped (JS, CSS, font) | JS 9.2 KB + 2.1 KB gzipped, CSS 6.2 KB gzipped, font 39 KB |
| Release animation, desktop | median 16.7 ms per frame, 95th percentile 16.8 ms (headless Chromium with software rendering, capped at 60 Hz) |
| Laser scan while open | redrawn at about 33 frames a second, page frames still median 16.7 ms; no redraws off screen |
| Whole desktop visit | 2.41 MB (film 0.99 MB, release frames 0.80 MB, portrait 0.14 MB) |
| Phone, before Scene 03 | 0.97 MB (whole visit 1.77 MB) |
| Reduced motion | no film, no release frames |

Byte counts treat each file once, as a host with normal HTTP caching serves them.

## Limitations

- **Tested in headless Chromium only.** No real phones, no Safari and no Firefox were available. Run the page on a real iPhone and Android phone before launch, especially the film autoplay, the tap-to-scan flow and memory use with the release frames loaded.
- **The frame times above come from a software renderer** on a server, not a phone. The release is plain 2D canvas drawing of 40 pre-rendered frames, so it should hold up on mid-range phones, but this was not measured.
- **Your face is a photo, relit.** It sits in the scene's light and grade, but it cannot turn with the camera or catch light like the armour. A scanned 3D face would go further (see "Your portrait").
- **The old frame was removed by filling in from the skin around it.** Beside the nose, where the nose pads were, the skin is slightly softer than elsewhere. The laser lines run next to it, so it doesn't show at page size.
- **Screen sizes checked by eye** with the helmet open: 1920×1080, 1440×900, 1280×800, 1024×768, 768×1024, 430×932, 390×844 and 360×640. On short phones (under about 760 px tall) Scene 03 is taller than the screen, so the words sit under the face instead of over it.
- **Scene 02 is a slow camera move toward a bust**, not a walking figure. A full-body walk needs a rigged character and was out of scope.
- **The character is an original design** (graphite and platinum armour, crimson rim light, white light seams). It does not use the red-and-gold colours or the face-light details of any existing film character.
- **Lighthouse and screen-reader passes were not run.** The page uses semantic landmarks, labelled controls, a live region for the helmet state and visible focus, but has not been checked with VoiceOver or NVDA.

## Still needed from you

- **Your name, site address, short introduction and About text** in `src/content.ts`.
- **Contact details.** No email address or phone number was invented: the buttons say so until you add them.
- **Your projects.** Gyre is in as a draft (confirm it is yours and add your role), and there are two empty slots. No clients, testimonials, metrics or achievements were made up.
- **Check the GitHub link** (`https://github.com/chanceryuzu-hue`) points to your profile.

## Re-rendering the assets (optional)

Only needed if you change the armour, the lighting or the mechanism. See `pipeline/README.md`.
