# Model library and comparison viewer

```sh
bun install
bun run model:viewer
```

Open **http://127.0.0.1:5180/**. This is a separate local app; it is not part of the game deployment.

**Inspect** opens a ship with its original materials and no reference required. Choose **Ships** or **Components** in Browse library. Components are selected from the bottom thumbnail carousel. Search matches family, name and stable part ID; nation and caliber range (50 mm bands) filters combine with search. Clear filters restores the full collection. Filters leave the inspected model in place until another card is selected. Cards show real model thumbnails, rendered lazily as they enter the scroll strip; use Previous/Next, horizontal scrolling, or arrow keys between focused cards. The component panel distinguishes reusable original builders from installed previews awaiting source extraction; it shows review status, limitations, mounting radius and barrel count.

Build standalone components with `bun run part:build all` (or a specific part ID), then reload the viewer. A component's **Preview source** selects its standalone recipe output or a named installation isolated from a published ship. Use traverse, elevation and recoil controls to inspect its moving parts. The component grid is 1 m, with the mount yaw datum at the origin; ship inspection uses a 10 m grid. Deep links use `?ship=<preset-id>` or `?part=<part-id>`. See the [shared component workflow](../../docs/shared-components.md) for building and reusing original models.

Choose **Overlay** or **Side by side** to open reference controls. These modes default to cyan/amber geometry inspection; **Original materials** restores available local GLB materials. Direct GameModels3D downloads contain geometry only, so use the source viewer for reference paint. Existing saved ship/reference alignments and `ship:overlay` commands remain compatible.

Before modeling a new ship, show source previews and get approval of the [brief and reference set](../../docs/ship-pipeline.md#start-a-new-ship-collaboratively). Comparison modes can tint both models for geometry inspection; use the original source viewer to approve paint and markings.

1. Select our ship. The list comes from the game's preset roster; build and register a new ship before trying to inspect it here.
2. Paste a GameModels3D **World of Warships vehicle page URL or vehicle ID**, then choose **Load from GameModels3D**. Bismarck (`pgsb708`), King George V (`pbsb107`) and Fletcher (`pasd021`) have starter suggestions from earlier authoring work; check the dated fit yourself. Other ships accept any suitable WoWS vehicle page.
3. Choose the reference hull/equipment configuration. Default equipment selects one A/AB configuration per equipment category. Inspect variants; stock game equipment is not necessarily the historical fit we target.
4. Choose **Overlay** or **Side by side**. Both panels share an orthographic camera, zoom, scale and alignment, so size differences remain visible. Port and starboard comparisons use two rows, with our ship above the reference. Other views use two columns on desktop; narrow screens stack all views. Use **Front**, **Rear**, **Port side**, **Starboard side**, **Top**, **Bottom** or **3D**; drag either panel to orbit both. **Fit both** frames the combined bounds. Toggle models individually, adjust opacity, wireframe or X-ray, and zoom into details.
5. Adjust reference translation, yaw/pitch/roll and **uniform** scale. Center X/Z preserves vertical position. The WoWS starting conversion is 15 metres per viewer unit, with source +Z mapped to runtime -Z; source waterline/loading is unverified. Local GLBs start at unit scale in runtime coordinates. Bounds include all model fittings and change with orientation.
6. Save alignment for a GameModels3D/ship pair in browser storage. **Save image** downloads the current canvas to your browser's download location.

A self-contained local `.glb` can be opened instead, including an independently obtained War Thunder reference export. Native War Thunder formats and GameModels3D's other game formats are not supported by the direct downloader. Access-restricted or changed source formats produce an error; the app does not bypass access controls.

Raw reference geometry is used only by this viewer. Downloads are cached under ignored `.build/ship-overlay/<vehicle-id>/`; remove that local folder to fetch a fresh source version. Nothing is copied into `assets/`, `public/models`, ship recipes or version control. Do not restore report/reference archives for this app.

This tool compares model geometry, not historical truth. Different configurations, game simplifications, unverified loading datums and imperfect registration can explain differences. There is no automatic historical-accuracy score.

Validation: `bun run model:viewer:check`. Optional frontend bundle check: `bunx vite build --config vite.overlay.config.ts` (output stays in ignored `.build/`; the local API requires the dev command above).

Component cards list the ships mounting that exact variant in the current runtime fleet, deduplicated across mounts. Caliber ranges use 50 mm bands (0–50, 50–100, and so on); lower bounds are included and upper bounds excluded, so 50 mm belongs to 50–100 mm.
