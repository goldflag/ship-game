# WWII carrier aircraft

Thirteen independently authored aircraft models for future air combat. Inspect them at **`/aircraft-review.html`** with the development server running. They remain standalone visual assets; they are not placed aboard Enterprise or registered as combat actors.

| Navy | Fighters | Dive bombers | Torpedo bombers |
| --- | --- | --- | --- |
| Japan | A6M2 and A6M5 Zero | D3A1 Val, D4Y2 Judy | B5N2 Kate, B6N2 Jill |
| United States | F4F-4 Wildcat, F6F-5 Hellcat, F4U-1D Corsair (fighter-bomber) | SBD-3 Dauntless, SB2C-4 Helldiver | TBD-1 Devastator, TBF-1C Avenger |

The second authoring pass replaces the initial shared silhouettes with thirteen individually measured [shape specifications](shapes/), backed by inspected drawings retained in [references/schematics/](references/schematics/). Each specification records its source, variant, pixel registration, sampled fuselage and lifting-surface contours, canopy, fin, cowling, propeller and gear. Sparse silhouette measurements guide independently constructed surfaces; hidden sections and many small fittings remain inferred. The earlier recipe, catalog and overview sheets are preserved in [baseline-v1](baseline-v1/).

The [catalog](catalog.json) supplies the roster, nominal dimensions and finish selection. [build.py](build.py) builds the measured surfaces, open radial cowls, transparent canopy glazing, cockpit interiors, separate control surfaces and original UV-mapped paint. [detail_bombers.py](detail_bombers.py) adds the SBD-3 intake, SBD/TBD telescopic sights, rear defensive guns, Helldiver wing cannons and separate perforated upper/lower dive-brake plates. Brake apertures are physical holes, with inner faces and hinges; their counts are reduced for the game mesh.

All authored geometry, packed materials and textures remain editable in `<id>/generated/source.blend`. Each aircraft exports three LODs: `model.glb`, `model-lod1.glb` and `model-lod2.glb`, with decimation targets of 100%, 45% and 20%. The 2048 px base-color atlas and 512 px roughness map are retained as PNGs and embedded in the GLBs. Runtime files and their URLs are published under `public/models/aircraft/`; catalog switch distances are suggestions for future renderer integration. The inspector supports manual LOD0/1/2 selection and split-brake deployment; automatic distance-based selection remains future renderer work.

The common content hash covers the complete catalog, both recipe files and all thirteen shape JSONs. Referenced rasters have separate hashes in export reports. **Rebuild all models after changing any shared authoring input or shape specification.** Generated Blender and GLB files are outputs, not durable substitutes for the recipe.

## Build and inspect

```sh
bun run aircraft:inputs all
bun run aircraft:build all              # Reproducible isolated local Blender build
bun run aircraft:check all
bun run aircraft:review all             # Rebuild and refresh six fixed review views
python3 scripts/aircraft/compare.py all  # Actual GLB over registered source drawings
python3 assets/aircraft/review_sheets.py # Overview sheets from actual renders
```

The models can be authored through **Blender MCP** using [mcp_author.py](mcp_author.py). Blender must be open with its MCP add-on enabled; the Python environment needs the `mcp` package. The client discovers the code-execution, scene-inspection and screenshot tools, then runs the retained recipe through MCP. `generated/authoring.json` records the actual authoring method and Blender version; the local build command above remains a separate fallback.

```sh
BLENDER_MCP_BIN=/path/to/blender-mcp /path/to/python assets/aircraft/mcp_author.py all
bun run aircraft:publish all
/path/to/python assets/aircraft/mcp_author.py --inspect
/path/to/python assets/aircraft/mcp_author.py --code-file /path/to/inspection.py
```

The [pipeline contract](../../docs/aircraft-pipeline.md) documents setup, coordinates, stable joints, LOD checks, MCP brake inspection and browser review hooks. Upper brake IDs are `diveBrake.port` / `diveBrake.starboard`; lower plates use `diveBrake.lower.port` / `diveBrake.lower.starboard`. Their `rotationMultiplier` metadata gives opposite deployment signs. The Avenger turret and the other bombers' defensive guns also retain separate pivots.

The [independent comparator](../../scripts/aircraft/compare.py) reads actual exported GLB triangles and composed transforms, then projects them onto the original side/top rasters without fitting the model to the drawing. NumPy and Pillow are required. Per-aircraft `generated/comparison/` retains overlays, silhouettes, source crops and hashed measurements; [schematic-comparisons.json](reports/schematic-comparisons.json) indexes the collection. `--allow-stale` produces explicitly labeled diagnostic overlays during rebuilding. Fresh comparisons still require visual review.

Consult the [source register](references/sources.json), individual shape/reference notes, [discrepancy register](reports/discrepancies.md), and [validation record](reports/validation.md) for evidence and current review status. The [quarter-view sheet](reports/quarter-sheet.jpg) and per-aircraft six-view sets are generated evidence, not historical approval. Documentation describes the implemented authoring workflow; completion of final validation is recorded separately in those reports.

## Scope and remaining approximations

Wings stay extended; wing-fold mechanisms are absent. The SBD has fixed wings. Gear travel and linkage clearance are approximate, and the neutral model combines a level engine-shaft attitude with extended landing gear rather than a supported tail-down deck stance. Payload sockets are empty; no carried bombs, torpedoes, crews, flight dynamics, damage model, takeoff or landing behavior are implemented.

Cockpit interiors, canopy curvature, cross-sections between measured stations, surface details and generic period finishes are reconstructed. Reference quality and variant coverage differ: the Avenger Navy sheet explicitly covers TBF-1/1C, while the SBD and Helldiver use documented cross-variant interpretations; the TBD reference is a credited modern technical drawing. Other aircraft preserve their own drawing and variant limitations in their shape files. The fleet spans early and late WWII and does not represent one carrier air group or a single historical date.
