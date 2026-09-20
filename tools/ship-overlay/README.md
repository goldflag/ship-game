# Model library and comparison viewer

```sh
bun install
bun run model:viewer
```

Open **http://127.0.0.1:5180/**. This is a separate local app; it is not part of the game deployment.

**Shipbuilder comparisons:** open **http://127.0.0.1:5180/component-comparison.html** (also linked from the model library). This page includes only published Shipbuilder guns, torpedo launchers, masts and funnels. Search or filter the catalog, then compare both models with one orthographic camera and metric scale. Side by side, overlay, fixed views, wireframe, image export, dimensions and triangle counts are available. Deep links use `?part=<catalog-id>`.

Our side loads the exact published catalog GLB. The reference side uses full-detail, geometry-only GameModels3D resources; it never fetches reference textures or changes production assets. Source identity is labeled **Same variant**, **Related variant**, **Family reference**, or **No equivalent**. These labels are not similarity scores. Some AA reference barrels are baked at elevation, embedded hull extractions may omit adjoining supports or fittings, and generic components have no exact historical equivalent. Read the selected source notes before judging a mismatch.

The source register is `component-references.json`. Gun/torpedo resources are cached in ignored `.build/component-comparison/raw/`; prefetch them with `bun scripts/parts/prepare-comparisons.ts` (optional stable part IDs limit the selection). Raw WoWS source units convert at 15 metres per unit, with +Z reflected to runtime −Z. Extracted GLBs are already in metres and runtime axes. The page centers horizontal bounds and aligns minimum Y for shape inspection; it does not rescale models to hide size differences or claim a common mounting datum. New catalog entries without a register match remain visible as unavailable.

Rebuild mast/funnel extractions with `python3 scripts/parts/extract-comparison-equipment.py` (optional `--part <catalog-id>`; requires Blender, configurable with `BLENDER_BIN`). The script reads `catalog-reference-extractions.json`, downloads the named public hull sections, preserves selected source triangles and writes geometry-only GLBs plus inspection renders under ignored `.build/component-comparison/research/masts-funnels/`. These are viewing references, not original reusable assets. Optional `schemeComponents` pins the inspected A/AB fit so later upgrades do not overwrite it. A changed source mesh can invalidate the recorded island selections; inspect regenerated outputs and revise the selections before using them for fidelity judgments.

The launch script runs Vite under Bun because the server reads local ship definitions with Bun's file API.

**Inspect** opens a ship with its original materials and no reference required. The bottom carousel switches between **Ships**, **Planes** and **Components** and selects the inspected model. Ships filter by class and nation with the same pill filters as the game port; planes filter by role, nation and name/year/ID; components filter by nation, exact caliber (mm) and a search over family, name and stable part ID. **Clear** restores the full collection; filters leave the inspected model in place until another card is selected. Cards show model thumbnails (aircraft and component previews render lazily as they enter the strip); use the arrows, horizontal scrolling, or arrow keys between focused cards. Camera views, comparison mode, fit, zoom and **Save image** sit on the 3D viewer itself; drag to orbit, right-drag to pan, scroll to zoom, arrows pan, +/− zoom and Home fits the view. The side panel names the model and, for components, distinguishes reusable original builders from installed previews awaiting source extraction, with review status, limitations, mounting radius and barrel count.

Build standalone components with `bun run part:build all` (or a specific part ID), then reload the viewer. A component's **Preview source** selects its standalone recipe output or a named installation isolated from a published ship. Use traverse, elevation and recoil controls to inspect its moving parts. The component grid is 1 m, with the mount yaw datum at the origin; ship inspection uses a 10 m grid. Deep links use `?ship=<preset-id>`, `?aircraft=<aircraft-id>` or `?part=<part-id>`. See the [shared component workflow](../../docs/shared-components.md) for building and reusing original models.

Choose **Overlay** or **Side by side** to open reference controls. These modes default to cyan/amber geometry inspection; **Original materials** restores local GLB materials and, for GameModels3D references, loads the source's own phong materials and textures (diffuse, specular, normal and occlusion maps) through the local `/api/texture` cache. A **Paint scheme** select offers the vehicle's plain finish and its permanent camouflages; parts without a texture set stay tinted. Existing saved ship/reference alignments remain compatible.

Choose **Planes** to inspect the published aircraft catalog (`public/models/aircraft/catalog.json`). Aircraft use a 1 m grid with the engine-shaft datum at Y = 0, length/wingspan bounds, and manual LOD0/1/2 selection. They open in the neutral exported pose; the dedicated `/aircraft-review.html` inspector in the game dev server remains available for articulation review.

Aircraft support the same **Overlay**, **Side by side**, original materials, local GLB, alignment and image export controls. Choose a plane, switch comparison mode, then **Load from GameModels3D** using its suggested WoWS aircraft ID. To compare another source aircraft, enter its model ID from the [WoWS aircraft library](https://gamemodels3d.com/en/games/worldofwarships/misc/fighter). The downloader reads that library's public model index and preserves its source transform and materials. Aircraft references start at the same 15 m per viewer unit as WoWS ships; **Center X/Z** aligns horizontal bounds without changing scale or height. Verify origin, gear pose and variant before drawing conclusions. Suggestions are discovery aids: SBD-4 versus our SBD-3 and D4Y3 versus our D4Y2 are explicitly labeled, and unspecified source subvariants require checking. Aircraft alignment saves use their own aircraft/reference pair keys, preserving existing ship and component saves.

Before modeling a new ship, show source previews and get approval of the [brief and reference set](../../docs/ship-pipeline.md#start-a-new-ship-collaboratively). Comparison modes can tint both models for geometry inspection; use the original source viewer to approve paint and markings.

1. Select our ship. The list comes from the game's preset roster; build and register a new ship before trying to inspect it here.
2. The GameModels3D **vehicle ID** is prefilled for every roster ship with a World of Warships counterpart (see `suggestedVehicles` in `reference.ts`; the Liberty presets share the WoWS Liberty auxiliary, while Victory Cargo and Flower Corvette have none). Check the dated fit yourself, or paste any other **vehicle page URL or ID**, then choose **Load from GameModels3D**.
3. Choose the reference hull/equipment configuration. Default equipment selects one A/AB configuration per equipment category. Inspect variants; stock game equipment is not necessarily the historical fit we target.
4. Choose **Overlay** or **Side by side**. Both panels share an orthographic camera, zoom, scale and alignment, so size differences remain visible. Port and starboard comparisons use two rows, with our ship above the reference. Other views use two columns on desktop; narrow screens stack all views. Use **Front**, **Rear**, **Port side**, **Starboard side**, **Top**, **Bottom** or **3D**; drag either panel to orbit both. **Fit both** frames the combined bounds. Toggle models individually, adjust opacity, wireframe or X-ray, and zoom into details.
5. Adjust reference translation, yaw/pitch/roll and **uniform** scale. Center X/Z preserves vertical position. The WoWS starting conversion is 15 metres per viewer unit, with source +Z mapped to runtime -Z; source waterline/loading is unverified. Local GLBs start at unit scale in runtime coordinates. Bounds include all model fittings and change with orientation.
6. Save alignment for a GameModels3D/ship pair in browser storage. **Save image** downloads the current canvas to your browser's download location.

A self-contained local `.glb` can be opened instead, including an independently obtained War Thunder reference export. Native War Thunder formats and GameModels3D's non-WoWS game formats are not supported by the direct downloader. Access-restricted or changed source formats produce an error; the app does not bypass access controls.

Raw reference geometry and materials are used only by this viewer. Downloads are cached under ignored `.build/ship-overlay/<vehicle-id>/` (textures, shared across vehicles, under `.build/ship-overlay/textures/`); remove those local folders to fetch a fresh source version. Nothing is copied into `assets/`, `public/models`, ship recipes or version control. Do not restore report/reference archives for this app.

This tool compares model geometry, not historical truth. Different configurations, game simplifications, unverified loading datums and imperfect registration can explain differences. There is no automatic historical-accuracy score.

Validation: `bun run model:viewer:check`. Optional frontend bundle check: `bun --bun vite build --config vite.overlay.config.ts` (output stays in ignored `.build/`; the local API requires the dev command above).

The gun comparison's **Our model** selector switches between the current published
component and its retained baseline model. For guns of at least 12 inches,
the baseline is the merged PR #376 model at `7e8e4e7d`, captured before the
capital-gun shape pass. Type C, both Hipper 203 mm twins and Cleveland use the merged
PR #389 publication at `08f1cd107` for their follow-up iteration; other smaller guns
retain their earlier baselines. `component-before.json` records
only immutable URLs and measured triangle counts for our original assets. Both
revisions use the same geometry-only GameModels3D reference and metric scale.
The reduction shown beside the measurements is calculated from the loaded mesh.
