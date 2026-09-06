# Ocean map guide

Open [the illustrated guide](index.html) for full-size screenshots and settings. In the game, use **Custom battle → Battle waters**.

## North Atlantic

Cool open water and broken cloud, with the accepted smaller-wave tuning.

![North Atlantic](north-atlantic.png)

## Pacific Islands

Turquoise water, a high sun, sand shores, and green island ridges.

![Pacific Islands](pacific-islands.png)

## Arctic Passage

Cold teal water, a low sun, heavier cloud, and snowy headlands.

![Arctic Passage](arctic-passage.png)

## Volcanic Coast — Indian Ocean

Indigo water, afternoon haze, and dark coastal ridges with recessed summits.

![Volcanic Coast](indian-volcanic-coast.png)

## Capture setup

September 6, 2026. Actual Game renderer, Orca embedded browser, WebGPU, High quality, Moderate sea, Bismarck versus Bismarck at 5 km, fixed wave seed 1 and ocean tick 3600. Canvas: 1600 × 900. Camera position: (550, 200, 700), looking at (-650, 75, -1000), vertical field of view 60°. Ship pose and animation are paused; every scene settles for 40 frames after the map transition. The images are unedited canvas PNGs, without diagnostic text or game instruments. Small cloud differences may reflect temporal reconstruction.

Original shader and island recipes: `assets/maps/environments.v1.json`. The CPU terrain and renderer share `src/maps/catalog.ts`; the render mesh samples that surface at finite resolution. The terrain renderer uses eroded heightfields, triplanar materials, exposed rock and slope-dependent snow, and clustered tree impostors. See [terrain generation notes](../terrain-notes.md) and [interactive before/after comparisons](landforms.html). No external regional geography or model source was copied. These are fictional region-inspired battle waters.

Reproduce with `bun run dev --port 5183`, open `/scripts/diagnostics/ocean-maps.html` in the current Orca tab, wait for Ready, and run `python3 assets/maps/capture.py` from the repository root. This captures all maps and produces compressed 640 × 360 WebP previews under `public/maps/`. Run `python3 assets/maps/build-review.py` to regenerate this guide's HTML from the map definitions. The diagnostic is excluded from the production entry point.

Coastal maps automatically widen the central fleet deployment lane for larger teams. Ships use conservative hull clearance and can reverse away from land. Bot avoidance is reactive, not global pathfinding. Shell and torpedo contacts use the CPU height surface; a low shell stops at terrain while a high one can clear it. Grounding damage, tides, complete bathymetry, and terrain occlusion of blast propagation are not modeled.

## Validation

- 347 simulation/game tests passed, including map selection through fleet loading, clear 30-ship deployments at 1–20 km, coast contact and reverse escape, projectile terrain contact/overflight, and rendered terrain agreement with the CPU surface.
- `bun run build` passed (existing large-bundle advisory remains).
- All four maps rendered in WebGPU without runtime errors. Live UI launch carried Pacific Islands + Fair conditions into combat and drew all three coastlines on the chart. Returning to port restored water color `#224659`, amplitude 0.12, peak wavelength 14 m, cloud altitude 1700 m and coverage 0.38, with battle land hidden.
- Desktop and 388px map-picker layouts were inspected using the actual React component at `/scripts/diagnostics/map-picker.html` and `?mobile=1`; these layout fixtures omit the live harbor background. Map choices remained readable without horizontal overflow. A separate finish review found no material visual issues.
- [PDF edition](ocean-map-guide.pdf): six pages, verified to contain all four rendered map images.
- Landform review passed at gameplay scale across all nine islands. The [before/after document](landforms.html) includes three regional comparisons, close views, and nine aerial survey views; its [PDF edition](landforms-before-after.pdf) contains all nine comparison and close-view images across five pages. See the [final visual review](landform-review.md) for finding dispositions and capture limitations.

The saved picker screenshots are review evidence for the UI; the four region screenshots are captures of the real game, not the layout fixture.
