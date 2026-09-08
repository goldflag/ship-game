# Local ship overlay

```sh
bun install
bun run ship:overlay
```

Open **http://127.0.0.1:5180/**. This is a separate local app; it is not part of the game deployment.

Before modeling a new ship, show source previews and get approval of the [brief and reference set](../../docs/ship-pipeline.md#start-a-new-ship-collaboratively). This app tints both models for geometry inspection; use the original source viewer to approve paint and markings.

1. Select our ship. The list comes from the game's preset roster; build and register a new ship before trying to inspect it here.
2. Paste a GameModels3D **World of Warships vehicle page URL or vehicle ID**, then choose **Load from GameModels3D**. Bismarck (`pgsb708`), King George V (`pbsb107`) and Fletcher (`pasd021`) have starter suggestions from earlier authoring work; check the dated fit yourself. Other ships accept any suitable WoWS vehicle page.
3. Choose the reference hull/equipment configuration. Default equipment selects one A/AB configuration per equipment category. Inspect variants; stock game equipment is not necessarily the historical fit we target.
4. Choose **Overlay** or **Side by side**. Both panels share an orthographic camera, zoom, scale and alignment, so size differences remain visible. Port and starboard comparisons use two rows, with our ship above the reference. Other views use two columns on desktop; narrow screens stack all views. Use **Front**, **Rear**, **Port side**, **Starboard side**, **Top**, **Bottom** or **3D**; drag either panel to orbit both. **Fit both** frames the combined bounds. Toggle models individually, adjust opacity, wireframe or X-ray, and zoom into details.
5. Adjust reference translation, yaw/pitch/roll and **uniform** scale. Center X/Z preserves vertical position. The WoWS starting conversion is 15 metres per viewer unit, with source +Z mapped to runtime -Z; source waterline/loading is unverified. Local GLBs start at unit scale in runtime coordinates. Bounds include all model fittings and change with orientation.
6. Save alignment for a GameModels3D/ship pair in browser storage. **Save image** downloads the current canvas to your browser's download location.

A self-contained local `.glb` can be opened instead, including an independently obtained War Thunder reference export. Native War Thunder formats and GameModels3D's other game formats are not supported by the direct downloader. Access-restricted or changed source formats produce an error; the app does not bypass access controls.

Raw reference geometry is used only by this viewer. Downloads are cached under ignored `.build/ship-overlay/<vehicle-id>/`; remove that local folder to fetch a fresh source version. Nothing is copied into `assets/`, `public/models`, ship recipes or version control. Do not restore report/reference archives for this app.

This tool compares model geometry, not historical truth. Different configurations, game simplifications, unverified loading datums and imperfect registration can explain differences. There is no automatic historical-accuracy score.

Validation: `bun run ship:overlay:check`. Optional frontend bundle check: `bunx vite build --config vite.overlay.config.ts` (output stays in ignored `.build/`; the local API requires the dev command above).
