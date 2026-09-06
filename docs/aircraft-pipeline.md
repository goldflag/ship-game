# Aircraft asset pipeline

The aircraft collection is a versioned **visual asset** catalog used by the carrier air-combat runtime. It uses the ship pipeline's coordinate basis and asset layout; aircraft are not ship blueprints or combat actors. Ships continue to use `ship:new`, `ship:compile`, `ship:build`, `ship:check`, and `ship:review`.

The second authoring pass replaces the earlier shared silhouette construction with individually measured shape specifications for all thirteen aircraft. This is a visual revision; the catalog and shape formats currently retain `schemaVersion: 1`. The superseded recipe, catalog and overview images are preserved in [baseline-v1](../assets/aircraft/baseline-v1/).

## Durable inputs

| Input | Responsibility |
| --- | --- |
| [catalog.json](../assets/aircraft/catalog.json) | Roster, nominal dimensions, variant, period finish and feature selection |
| [shapes/](../assets/aircraft/shapes/)`<id>.json` | Per-aircraft fuselage, wing, tail, canopy, cowling, propeller and gear measurements; source attribution, pixel registration and limitations |
| [build.py](../assets/aircraft/build.py) | Original Blender surface construction, materials, cockpit interiors, joints, textures, review renders and LOD exports |
| [detail_bombers.py](../assets/aircraft/detail_bombers.py) | Bomber-specific intakes, sights, defensive guns, cannon and perforated split dive brakes |
| [references/schematics/](../assets/aircraft/references/schematics/) | Preserved drawing rasters, original source files where acquired, attribution and measurement evidence |

Shape station `u` runs from the complete aircraft's nose at 0 to tail at 1; source longitudinal position is `X = length × (0.5 − u)`. Fuselage stations record half-width, bottom and top independently. Main-wing stations record span fraction, leading and trailing `u`, and height. Tailplanes have their own measured span. Fin outlines and canopy sections are aircraft-specific. Retain source pixel datums and separate inferred sections from measured silhouettes; do not replace these inputs with edits made only in generated Blender files.

The shared content hash covers the complete catalog, both recipe files and every aircraft shape JSON in sorted ID order. **Rebuild all thirteen aircraft after changing any of those files.** The pipeline also hashes each referenced raster separately in `sourceFiles` and checks those hashes before publication and during verification. A changed reference can invalidate reports even when the geometric content hash is unchanged.

## Products and commands

Each `<id>/generated/` contains an editable `source.blend`, three GLBs, retained texture PNGs, authoring provenance, and six review views with camera records. The original deterministic paint atlas is 2048 × 2048; the roughness map is 512 × 512. UV-mapped paint, markings and surface detail are embedded in the GLBs. Canopy glazing uses alpha blending over modeled cockpit wells, seats, panels and framing. Those interiors and finishes remain exterior-view approximations.

| Detail level | Retained file | Published file | Construction |
| --- | --- | --- | --- |
| LOD0 | `model.glb` | `public/models/aircraft/<id>.glb` | Full authored mesh |
| LOD1 | `model-lod1.glb` | `public/models/aircraft/LOD1/<id>-lod1.glb` | Decimation target 45% of base triangles |
| LOD2 | `model-lod2.glb` | `public/models/aircraft/LOD2/<id>-lod2.glb` | Decimation target 20% of base triangles |

LOD1 embeds a 1024 × 1024 color atlas and 256 × 256 roughness map; LOD2 uses 512 × 512 and 128 × 128. Opaque surfaces use back-face culling; glazing remains two-sided. Base and evaluated reduced meshes are triangulated, welded and checked for zero-area faces before export. Each LOD retains its independently moving owners and joint hierarchy. The runtime catalog includes URLs and suggested 120 m / 400 m switch distances. The inspector offers manual LOD0/1/2 selection. The switch distances remain preparation for automatic renderer selection and fleet profiling; the combat renderer now uses them; see [air operations](air-operations.md).

```sh
bun run aircraft:inputs all       # Validate catalog, shapes and retained references
bun run aircraft:build all        # Isolated local Blender build, check and publication
bun run aircraft:check all        # Independently inspect retained and published products
bun run aircraft:review all       # Rebuild and refresh the six fixed views
python3 scripts/aircraft/compare.py all
python3 assets/aircraft/review_sheets.py
bun test
bun run build
```

`BLENDER_BIN` overrides the local Blender executable. `aircraft:publish <id|all>` checks and publishes existing retained outputs authored through Blender MCP without rerunning Blender. Add `--validate` to `mcp_author.py` to perform that check immediately after each MCP export and stop the batch on failure. The checker reads actual GLB buffers, composed transforms, UVs, embedded textures and joint descendants at every LOD. It rejects degenerate binary triangles and non-unit/nonfinite normals, and checks dimensions, coordinates, geometry budgets, strict triangle reduction, retained/runtime agreement, provenance, textures and fixed-view hashes. These are export and consistency checks; they do not approve historical accuracy or fleet performance.

The pipeline locks its writer, rechecks inputs before publication, and replaces individual files atomically. Publication of multiple aircraft is not one transaction. If interrupted, complete `aircraft:build all`, or finish MCP authoring and `aircraft:publish all`; partial rebuilds of changed shared inputs leave checks visibly stale.

## Blender MCP

[assets/aircraft/mcp_author.py](../assets/aircraft/mcp_author.py) uses a Python environment with the `mcp` package and the installed `blender-mcp` executable. Set `BLENDER_MCP_BIN` if needed. Blender must be open with its MCP add-on running. The client discovers `execute_blender_code`, `get_scene_info` and `get_viewport_screenshot`, then executes this repository's recipe through MCP. It preserves other scenes and retains only the authored scene and its dependencies in each source file. `generated/authoring.json` records `blender-mcp` or `local-blender`; a local batch build must not be described as an MCP operation.

```sh
BLENDER_MCP_BIN=/path/to/blender-mcp /path/to/python assets/aircraft/mcp_author.py all
bun run aircraft:publish all
/path/to/python assets/aircraft/mcp_author.py --inspect
/path/to/python assets/aircraft/mcp_author.py --screenshot assets/aircraft/reports/blender-mcp-viewport.png
```

Use `--code-file /path/to/review.py` for a repeatable inspection script. For example, after opening a retained SBD or Helldiver source in Blender, this previews the separate split-brake joints in the authoring frame:

```python
import bpy, math
for obj in bpy.context.scene.objects:
    if obj.get('nodeId', '').startswith('diveBrake.'):
        obj.rotation_euler.y = math.radians(35) * obj.get('rotationMultiplier', 1)
bpy.context.view_layer.update()
```

Set the angle to zero to restore the neutral pose. Durable changes belong in the shape or recipe, not in this inspection script.

## Coordinates and joints

Authoring uses meters, **+X nose, +Y port, +Z up**, with the engine shaft at Z=0 and the nominal aircraft length centered around X=0. The shared basis conversion is `(runtimeX, runtimeY, runtimeZ) = (-blenderY, blenderZ, -blenderX)`. Exports are already **+X starboard, +Y up, −Z nose**; do not apply another renderer rotation. This origin is not a center-of-mass estimate or a ground-contact datum.

Every model retains `aircraft.root` and stable `nodeId` custom properties. Identify components by those IDs, not display names or GLB indices. Mesh batching stays within each rigid owner; separate joints and sockets survive at every LOD.

| Stable ID | Purpose / approximate runtime rotation axis |
| --- | --- |
| `propeller.spin` | Propeller and spinner; forward (−Z) |
| `control.rudder` | Rudder; up (+Y) |
| `control.elevator.port`, `.starboard` | Elevators; span (+X) |
| `control.aileron.port`, `.starboard` | Ailerons; span (+X), opposite signs |
| `gear.port`, `gear.starboard`, `gear.tail` | Gear assemblies; simplified inspection rotation |
| `arrestor.hook` | Independent hook; span (+X) |
| `turret.yaw` | Avenger dorsal turret; up (+Y) |
| `defensiveGun.yaw` | SBD, TBD and Helldiver rear flexible gun mount; up (+Y) |
| `diveBrake.port`, `.starboard` | SBD/Helldiver upper perforated plates; span (+X) |
| `diveBrake.lower.port`, `.starboard` | Separate lower plates; span (+X), opposite deployment sign |
| `socket.payload` | Under-fuselage loadout attachment datum |
| `socket.deck` | Main tyre lower tangent in the level inspection pose |

Each brake joint carries `pairedNode` and `rotationMultiplier`. The plates have thin skins, physical apertures and inner-face material; hidden wing skin is removed behind them. Hole counts are reduced for the mesh budget and are not a manufacturing reconstruction. D3A gear carries `fixed: true`; viewers must respect it. Joint limits and preview angles remain authoring hints, with approximate gear retraction and linkage paths. Wings remain extended; no wing-fold joints are supplied. SBD wings are fixed by design.

## Drawing comparison and review

Open `/aircraft-review.html` for the standalone Three.js inspector. It loads the published model with manual LOD0/1/2 selection, supports orbit and fixed views, previews propeller/control/gear and split-brake movement, and provides a one-meter grid. It does not instantiate combat. `window.aircraftReviewDiagnostics()` reports the loaded model, camera, bounds, render statistics and recognized joints; `window.aircraftReview.select(id, lod)`, `.view(view)` and `.pose({propellerAngle, controlsAngle, gearFraction, diveBrakeAngle})` provide repeatable review hooks. The diagnostics include the selected LOD, and `diveBrakeAngle` drives the upper/lower plates with their recorded opposite signs. Inspect the additional gun and turret joints through Blender MCP and the retained articulated views.

[scripts/aircraft/compare.py](../scripts/aircraft/compare.py) independently decodes the exported GLB's vertices, indices and scene transforms, then projects them over the retained side and top drawings using their fixed pixel datums. It does not fit the model silhouette to the drawing or read Blender geometry. NumPy and Pillow are required. Run it separately after building or publishing:

```sh
python3 scripts/aircraft/compare.py all
# During diagnosis only: permit old outputs and label their overlays as stale.
python3 scripts/aircraft/compare.py sbd-3-dauntless --allow-stale
```

Per-aircraft `generated/comparison/` contains side/top overlays, reference crops, silhouettes and `comparison.json`. Reports include GLB, shape, reference and comparator hashes, measured bounds, wing-station residuals and wing-section heights. The fleet index is [schematic-comparisons.json](../assets/aircraft/reports/schematic-comparisons.json). A current hash means **ready for visual review**, not historical approval. Residuals assess how the export follows sampled landmarks; they cannot validate the original drawing, inferred cross-sections or a different variant.

Review top, side, front, rear, quarter and articulation views, registered overlays, cockpit visibility, surface finish and mechanism clearance. [review_sheets.py](../assets/aircraft/review_sheets.py) arranges the actual renders into overview sheets. Record observations and remaining discrepancies in the [validation record](../assets/aircraft/reports/validation.md) and [discrepancy register](../assets/aircraft/reports/discrepancies.md). The retained references include primary Navy sheets and credited technical drawings of varying resolution; source-specific variant extrapolations, generic paint, empty payload sockets and approximate deck operations remain explicit limitations.
