# Model library and comparison viewer

```sh
bun install
bun run model:viewer
```

Open **http://127.0.0.1:5180/**. This is a separate local app; it is not part of the game deployment.

**Inspect** opens a ship with its original materials and no reference required. The bottom carousel switches between **Ships** and **Components** and selects the inspected model. Ships filter by class and nation with the same pill filters as the game port; components filter by nation, exact caliber (mm) and a search over family, name and stable part ID. **Clear** restores the full collection; filters leave the inspected model in place until another card is selected. Cards show model thumbnails (component previews render lazily as they enter the strip); use the arrows, horizontal scrolling, or arrow keys between focused cards. Camera views, comparison mode, fit, zoom and **Save image** sit on the 3D viewer itself; drag to orbit, right-drag to pan, scroll to zoom, arrows pan, +/− zoom and Home fits the view. The side panel names the model and, for components, distinguishes reusable original builders from installed previews awaiting source extraction, with review status, limitations, mounting radius and barrel count.

Build standalone components with `bun run part:build all` (or a specific part ID), then reload the viewer. A component's **Preview source** selects its standalone recipe output or a named installation isolated from a published ship. Use traverse, elevation and recoil controls to inspect its moving parts. The component grid is 1 m, with the mount yaw datum at the origin; ship inspection uses a 10 m grid. Deep links use `?ship=<preset-id>` or `?part=<part-id>`. See the [shared component workflow](../../docs/shared-components.md) for building and reusing original models.

Choose **Overlay** or **Side by side** to open reference controls. These modes default to cyan/amber geometry inspection; **Original materials** restores local GLB materials and, for GameModels3D references, loads the source's own phong materials and textures (diffuse, specular, normal and occlusion maps) through the local `/api/texture` cache. A **Paint scheme** select offers the vehicle's plain finish and its permanent camouflages; parts without a texture set stay tinted. Existing saved ship/reference alignments and `ship:overlay` commands remain compatible.

Before modeling a new ship, show source previews and get approval of the [brief and reference set](../../docs/ship-pipeline.md#start-a-new-ship-collaboratively). Comparison modes can tint both models for geometry inspection; use the original source viewer to approve paint and markings.

1. Select our ship. The list comes from the game's preset roster; build and register a new ship before trying to inspect it here.
2. The GameModels3D **vehicle ID** is prefilled for every roster ship with a World of Warships counterpart (see `suggestedVehicles` in `reference.ts`; the Liberty presets share the WoWS Liberty auxiliary, while Victory Cargo and Flower Corvette have none). Check the dated fit yourself, or paste any other **vehicle page URL or ID**, then choose **Load from GameModels3D**.
3. Choose the reference hull/equipment configuration. Default equipment selects one A/AB configuration per equipment category. Inspect variants; stock game equipment is not necessarily the historical fit we target.
4. Choose **Overlay** or **Side by side**. Both panels share an orthographic camera, zoom, scale and alignment, so size differences remain visible. Port and starboard comparisons use two rows, with our ship above the reference. Other views use two columns on desktop; narrow screens stack all views. Use **Front**, **Rear**, **Port side**, **Starboard side**, **Top**, **Bottom** or **3D**; drag either panel to orbit both. **Fit both** frames the combined bounds. Toggle models individually, adjust opacity, wireframe or X-ray, and zoom into details.
5. Adjust reference translation, yaw/pitch/roll and **uniform** scale. Center X/Z preserves vertical position. The WoWS starting conversion is 15 metres per viewer unit, with source +Z mapped to runtime -Z; source waterline/loading is unverified. Local GLBs start at unit scale in runtime coordinates. Bounds include all model fittings and change with orientation.
6. Save alignment for a GameModels3D/ship pair in browser storage. **Save image** downloads the current canvas to your browser's download location.

A self-contained local `.glb` can be opened instead, including an independently obtained War Thunder reference export. Native War Thunder formats and GameModels3D's other game formats are not supported by the direct downloader. Access-restricted or changed source formats produce an error; the app does not bypass access controls.

Raw reference geometry and materials are used only by this viewer. Downloads are cached under ignored `.build/ship-overlay/<vehicle-id>/` (textures, shared across vehicles, under `.build/ship-overlay/textures/`); remove those local folders to fetch a fresh source version. Nothing is copied into `assets/`, `public/models`, ship recipes or version control. Do not restore report/reference archives for this app.

This tool compares model geometry, not historical truth. Different configurations, game simplifications, unverified loading datums and imperfect registration can explain differences. There is no automatic historical-accuracy score.

Validation: `bun run model:viewer:check`. Optional frontend bundle check: `bunx vite build --config vite.overlay.config.ts` (output stays in ignored `.build/`; the local API requires the dev command above).
