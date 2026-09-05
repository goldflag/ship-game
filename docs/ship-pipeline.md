# Ship asset pipeline

The editable blueprint and original component recipes are the source of each playable ship. Blender produces a visual model; TypeScript compiles the same blueprint into simulation data. The runtime applies joint state to that exported model. Keep the Blender source, gameplay geometry, references, and build evidence together.

## Commands

```sh
bun install
bun run ship:new my-ship          # Create an original starter; refuses existing directories
bun run ship:compile my-ship      # Validate JSON and compile into .build/ships/my-ship
bun run ship:build my-ship        # Build Blender source, export, validate, then publish locally
bun run ship:check my-ship        # Detect stale definitions/models and verify the exported GLB
bun run ship:review my-ship       # Render five repeatable orthographic review views
bun run ship:reference bismarck  # Refresh isolated game-model raster reference pack
bun run ship:compare bismarck    # Rebuild measurements, matched sheets, local page and ZIP
bun run ship:independence bismarck # Full build with raw reference cache unavailable
bun run ship:thumbnail my-ship    # Bake the port card image from the validated runtime GLB
bun test
bun run build                    # Checks published presets, types and production bundle
```

`BLENDER_BIN` overrides the executable. The default uses the standard macOS application if present, otherwise `blender` on PATH. The tested environment uses Blender 5.2, Bun 1.3.3, and the versions in `bun.lock`. No MCP connection is required for batch builds.

Port thumbnails are checked-in transparent 600 × 180 PNGs at `public/models/<ship-id>-thumbnail.png`. The carousel loads these images directly, including while the harbor is preparing. `ship:build` refreshes the thumbnail after publishing the validated model; `ship:thumbnail` refreshes it independently without rebuilding geometry. The original shared rendering recipe is `assets/ships/thumbnail.py`; camera settings and model, recipe and image hashes are recorded under `assets/ships/<ship-id>/generated/thumbnail/render.json`. `ship:check` rejects missing or stale thumbnails. After changing the presentation recipe, run `ship:thumbnail` for all affected presets. It has a separate hash so lighting or framing changes do not invalidate ship geometry. Blender renders the exported materials using Cycles; this is a studio model view rather than a capture of the ocean scene.

`ship:build` stages its output under `.build/ships/<id>/`. It publishes only after the geometry and articulation checks pass. Each destination is replaced with a complete temporary sibling; the GLB/JSON pair is guarded by a shared hash at runtime. A crash between replacements fails visibly rather than silently mixing versions. Run the build again to recover. Build logs stay in the staging directory.

Commands that write the same staging directory use a lock with process information. If a process is forcibly interrupted, confirm it has stopped before removing `.build/ships/<id>.lock`. Builds also reject authoring inputs that change while Blender is running. `ship:review` reads the retained generated Blender source and saves camera settings alongside its five images, so review works after a clean checkout.

## Repository layout

```text
assets/
  parts/guns.json                  Reusable original gun specifications
  ships/<ship-id>/
    blueprint.json                Editable placement, hull parameters and gameplay volumes
    build.py                      Per-ship original Blender recipe
    README.md                     Configuration, evidence and modeling limitations
    modeling-spec.json            Optional reviewed dimensions, evidence and comparison parameters
    references/sources.json       Source provenance and what each reference supports
    references/                   Reference-only images; never shipped as game textures
    reports/                      Export validation and unresolved accuracy discrepancies
    generated/source.blend        Current generated, editable Blender source
    generated/review/              Fixed-camera review images
    generated/comparison/          Matched views, historical overlays, sections, page and ZIP
    baseline/                     Preserved original files when migrating an existing ship
scripts/ships/
  pipeline.ts                     Compilation, hashing, staging and GLB validation
  blender_components.py           Shared original gun geometry and articulation
  starter.py                      Minimal original hull recipe for new ships
  export.py                       Common batching, material bake and coordinate conversion
  review.py                       Repeatable inspection cameras
scripts/reference/                Isolated acquisition/capture and raster-only review stages
public/ship-reference/<ship-id>/   Portable comparison page and standalone download pack
public/models/<ship-id>.glb        Runtime visual model
public/models/<ship-id>.json       Compiled ship definition and content hash
src/ships/blueprint.ts             Versioned source/compiled types and input validation
src/simulation/                    Renderer-free weapons, movement and damage
```

Our generated/source and runtime files are deliberately retained with their recipes. `.build/`, Blender backups and caches are ignored. The Bismarck baseline is preserved in this repository, so the build no longer relies on `/Users/bill/models`. Large future fleets may need a separate versioned binary store; the high-resolution reference packs are larger than runtime models and include standalone review copies.

## Author a ship with an assistant and Blender MCP

1. Read `AGENTS.md`, this document, the component library, and the ship's source register. Inspect existing work before changing it. State the chosen configuration and which measurements are known, interpreted, or unknown.
2. Create the ship with `ship:new`, or open the existing ship's `generated/source.blend` using the connected Blender MCP tools. Do not overwrite `baseline/`. MCP tool names vary by installed server; discover its scene inspection, code execution, and screenshot tools instead of assuming a fixed tool name.
3. Add source records and a discrepancy log. Capture matching side, top, bow, stern, and quarter views when reference access permits. Use actual dimensions and an explicit waterline/origin. Match projection and scale before measuring silhouette differences. An unmatched perspective screenshot is qualitative evidence.
4. Edit `blueprint.json` for hull parameters, mounts, armor, modules, compartments, and connections. Reuse entries from `assets/parts/guns.json` for repeated equipment. Add a new part definition when the hardware differs; do not encode behavior by ship name.
5. Edit the ship recipe or the shared original component recipe for geometry changes. Use MCP to execute small scripts and inspect the scene as needed. Record every durable change in a recipe or an explicitly versioned component asset. A manual edit in the generated scene alone will be lost on rebuild.
6. Run `ship:build` from the project terminal. This starts an isolated Blender process, leaving the interactive scene available for inspection. When the result passes, reopen the generated source through MCP to examine pivots, gun clearances, and hidden simulation volumes.
7. Run `ship:review`; inspect the five orthographic images. Reconcile measured discrepancies before decorative work. Update the discrepancy log with evidence; leave unresolved geometry or historical questions marked open.
8. Run `ship:check`, simulation tests, and the game. Exercise full traverse/elevation, both batteries, free aim, hits, damage, flooding, inspection, and target reset. Record the build hash and checks. Ship compilation and geometric validation do not constitute historical accuracy approval.

The checked-in commands are also the fallback when Blender MCP is unavailable. Do not describe a headless build as an MCP operation. This initial migration was executed with local Blender; no Blender MCP tools were exposed in the implementation session.

## Reference policy

Prefer dated plans and documented dimensions for historical features. Record refit, equipment variant, game version, and loading condition separately. Other games' models can expose discrepancies, including shapes that are difficult to see in photographs. They may also differ from the intended historical configuration or share an inaccurate source.

For GameModels3D browser access, retain permitted comparison views and camera/configuration notes. For reference files available for this use, inspect them in a separate reference scene with documented scale and alignment. Do not trace their topology, retopologize/shrinkwrap from them, bake their textures, or include their meshes in our runtime assets. Reference art remains credited reference material. Resolve discrepancies against the source register; two matching game models are not automatically independent confirmation.

Bismarck now uses WoWS Bismarck ’41 `pgsb708`, with source/version recorded in `references/gamemodels3d/manifest.json`. `ship:reference` is the only stage that reads the raw game geometry under ignored `.build/reference-cache/`. It creates a disposable Blender scene, neutral captures, a contact sheet and a browsable index. Its single global registration preserves game-model proportions and leaves its load datum unverified. No game vertices, UVs, textures, offsets or attachment transforms enter the production recipe.

For ships with `modeling-spec.json`, `ship:build` also runs `ship:compare`: independently measure the actual exported GLB, render it through the same camera plan, register preserved historical rasters with one uniform scale, and generate sheets, overlays, sections, JSON measurements, a local HTML page and ZIP. The page is served at `/ship-reference/<ship-id>/` and works directly from an extracted review ZIP. The ZIP includes an authoring snapshot; rebuilding still uses this repository's shared pipeline. `ship:check` hashes the model, definition, source, specification, reference images and review recipes, then checks every retained and published output. This makes stale comparisons a build failure.

`ship:independence` runs the full asset build with the raw cache moved away, restores it afterward and records the model hash. A Python audit hook additionally rejects raw model/cache paths, the preserved Bismarck baseline and authoring network connections; it records local authoring reads. The production recipe uses the blueprint, original component catalog and original geometry code only. This is an input-boundary check, not a general native-code sandbox. See [reference-stage setup and reuse](../scripts/reference/README.md) for Python/Pillow prerequisites and per-vessel parameters.

## Coordinate and component contract

Blueprint and runtime data use meters, +Y up, -Z bow, +X starboard, with the reference waterline at Y=0. Heading is clockwise from north; the rendered root uses Euler YXZ with yaw `-heading`, pitch `pitch`, roll `roll`.

Blender recipes author in the existing Bismarck frame: +X bow, +Y port, +Z up. The common exporter changes basis for mesh vertices and every local object frame, then uses glTF's Y-up export. The final mapping is `(runtimeX, runtimeY, runtimeZ) = (-blenderY, blenderZ, -blenderX)`. The runtime must not add another model rotation.

Each gun mount exports stable `nodeId` custom properties:

```text
<mount-id>.yaw
  <mount-id>.left.elevation
    <mount-id>.left.recoil
      <mount-id>.left.muzzle
  <mount-id>.right.elevation
    <mount-id>.right.recoil
      <mount-id>.right.muzzle
```

`barrelCount` in the component catalog selects one, two, three or four independently articulated barrels. Omitting it retains the original twin layout. Triples add the `center` chain between `left` and `right`; singles use `center`; quadruples use `left-outer`, `left`, `right`, `right-outer`. `barrelSpacing` is the distance between adjacent bore axes. Simulation, renderer bindings and export checks use the same ordered IDs, so adding a preset does not require ship-name branches in combat code.

Optional `gunhouseShape`, `gunhouseBaseHeight`, `rollerRadius`, `rangefinderWidth` and barrel dimensions let components retain distinct original geometry while sharing joints. A mounting's yaw origin may be a documented roller datum below the gunhouse floor; keep this distinction explicit when authoring its vertical placement.

Runtime yaw rotates around +Y with a negative clockwise angle; elevation rotates around +X; visual recoil translates along +Z. Fixed barbettes remain outside the yaw joint. The `hull.surface` node identifies the actual hull envelope for measurement. `assemblyId` records logical ownership of mesh pieces. Non-rendering simulation objects use `exportRole = simulation` and are excluded from the GLB.

Batching preserves parent and assembly boundaries. Empty joints and sockets survive export. Gameplay identifies components by stable IDs, never GLB node indices or human-readable names. Export checks verify the actual GLB hull bounds, pivot positions, hierarchy, and every muzzle position at three angular configurations per mount. The initial performance guardrails are 500,000 triangles and 30 MiB per model; they are regression guardrails, not a validated fleet-performance promise.

Yamato additionally has `bun assets/ships/yamato/check-dimensions.ts`. It intersects the published hull triangles at the waterline and midship to measure waterline length/beam and hull depth as well as the outer envelope. Its report records individual source references and conflicts. Such checks verify selected dimensions; they cannot certify every hull section, dated fitting or historical proportion.

All per-ship materials that need special handling must have an export path. The existing procedural teak shader is baked; the original starter uses basic supported materials. Add material handling deliberately rather than silently accepting unsupported Blender shaders.

## Blueprint and simulation contract

`ShipBlueprint` is editable, versioned JSON. `compileShip` accepts unknown input, validates it and creates a separate `ShipDefinition` containing resolved part definitions. Compilation checks schema versions, IDs, known parts, finite numbers, bounded lists, station ordering, envelope bounds, module containment, capacity, and compartment/magazine links. These are authoring checks; additional economic, structural, and placement rules will be required before accepting competitive player designs.

`ShipState`, mount state, modules, compartments, shells, and events contain serializable numeric/string data. The simulation has no browser, React, Three.js, Blender, or GPU dependency. `CombatSimulation.step` is the fixed-tick host entry point. The browser currently runs it locally; the server and network command protocol are future work.

Moving main and secondary mounts share the same implementation. Their armor, traverse/elevation rates and limits, reload, ammunition, muzzle velocity, penetration budget, damage, and recoil come from the part catalog. Magazine connections can disable a mount. Aiming uses the same gravity as shell flight, includes ship velocity, checks the actual muzzle and mount limits, and tests obstruction against the modeled superstructure and other gunhouses. Firing readiness is independent of reticle alignment or reachability: loaded, functional guns fire along their current barrel poses while traversing or at their aiming limits, provided the actual firing path is clear. Obstruction proxies are coarse and need refinement against the visual ship for narrow clearances.

Armor supports optional convex planar `plate` surfaces within the version 1 blueprint, with thickness, material, exterior-breach flag and optional mount ID. Plate vertices use ship coordinates for fixed protection and yaw-local coordinates for moving turret protection. The compiler validates planarity, convexity, bounds and mount links. Legacy box armor remains supported for other presets.

Bismarck uses spatially separated belt/backing/support, upper belt, decks, turtleback, bulkheads, barbettes and gunhouse plates. CPU collisions, sight picking, probes and inspection all use the same plate surfaces; mounted plates follow CPU yaw. A plate consumes resistance once per crossing, including coplanar seams and tick boundaries. Teak contributes no invented steel-equivalent resistance. KC, Wh, Ww and structural steel are identified but do not yet have distinct empirical penetration curves. Ricochet, AP budgets, module health, magazine events and flooding remain game approximations; AP fuzes, HE blast/spall, crew and mesh fracture are absent. Other presets retain their earlier uniform gunhouse protection.

Compartments contain water volume, breaches and pumps. Connections conserve transferred water. Added water changes a simplified draft/list/trim model; integrity loss or exhausted reserve buoyancy initiates sinking. Hull mass, waterplane area, reserve buoyancy and handling are explicitly calibrated values. They are not yet derived from arbitrary edited geometry or component weights. Internal boxes are inspectable envelopes, not certified historical watertight subdivisions. Bismarck’s 39 spaces follow researched machinery order and ammunition stacking; exact boundaries and their capacities remain estimated. No arbitrary open inter-room flooding connections are asserted.

The sea used for gameplay is a flat Y=0 surface. GPU waves render the sea and animate buoys, while combat ship poses remain authoritative CPU values. For smooth motion at arbitrary display rates, the browser interpolates hull and joint transforms between the last two fixed ticks, presenting ships one tick (16.7 ms) behind simulation time. The camera, wake and inspection geometry follow those same sampled ship poses; firing and hit resolution continue to use the current authoritative tick. Pause holds the interpolation fraction, and resets/port teleports clear pose history. GPU wave samples never alter these poses. A future shared CPU wave model can add synchronized heave and wave-driven roll/pitch. Custom battles use renderer-free bot helm and fire commands, team-aware targeting, per-mount ballistic leading and shared damage/flooding for every selected ship. Formation lines start at the configured separation (1–20 km, 5 km by default), with both teams facing the opposing line. The simulation retains that distance across resets. Bot engagement ranges and avoidance are provisional gameplay heuristics. Aircraft operations, networking, and a shipbuilding UI are not implemented here.

Ship contacts resolve at 60 Hz after all hulls move and before weapon solutions and hits. `collisions.ts` derives a convex horizontal footprint from each definition's `hull.halfBreadths` in the documented stern-station frame. Hull mass plus floodwater weights separation and inelastic impulses; a rectangular waterplane approximation supplies yaw inertia. Impacts change forward speed, starboard `swaySpeed` and yaw rate, with water resistance settling sideways motion. Ballistic inheritance and target leading include this drift. Contacts apply equally to all teams and controllers. A conservative deck-to-keel vertical envelope, expanded for list/trim, allows sufficiently submerged wrecks to clear other ships. This is a discrete, planar gameplay model with convex envelopes, not mesh contact or detailed hydrostatics. It uses no GPU waves and applies no ramming damage. Normal sailing distances per tick are small compared with the registered hull widths; arbitrary teleports or extreme externally injected speeds are not swept collision queries.

Target inspection draws armor, modules, compartments and floodwater as an X-ray overlay, including spaces below the visible sea. Development builds expose the read-only `window.shipTrialDiagnostics()` check for the loaded muzzle positions and recent combat events. Muzzle errors compare the exported joints with the CPU poses sampled for the displayed frame. Regression tests load the exported joint hierarchy and check it against simulation poses, including rear-facing turrets, recoil and interpolated turns through north. Frame-loop tests verify smooth sailing across fixed and irregular display intervals without changing combat state.

Diagnostics also identify the loaded ship/hash, renderer backend and camera matrices for reproducible browser review. In the development port, `window.shipTrialArticulation({trainFraction: 1, elevationFraction: 1, recoilFraction: 1})` previews the catalog limits on the actual loaded model. Train spans -1 to 1; elevation and recoil span 0 to 1. Passing `null` restores the original mount state. Launching restores it automatically. This review hook is unavailable in production and cannot change joints during combat.

An optional blueprint `viewpoints.bridge` places a ship's bridge camera in runtime coordinates. Its position follows the authoritative ship pose. Use it for offset islands and bridges instead of adding ship-name conditions to the camera or simulation.

Port inspection uses the same renderer through `ShipInspection` and the same data through `inspectionEntries`. Armor includes hull protection and moving gunhouses; Internals includes machinery, magazines, steering and compartments. The UI reads thickness, health and capacity from the compiled definition, with stable prefixed IDs for selection. Add new inspection properties to this shared adapter rather than maintaining a second port-only layout. Verify each new preset in both port views, isolate a volume, return to Exterior, launch and return to port. Combat stays frozen in port; entering port resets every fleet actor, ammunition, shells and flooding while preserving renderer bindings. Fleet launches load each distinct preset once and clone independent views for all actors; every hull uses its own definition, armor, modules, mounts and joints. Without a fleet, the simulation constructor retains an idle two-actor fixture for port inspection and isolated asset/combat regression tests; the playable launch always supplies a custom fleet.

Port armor uses `ArmorOverlay` to render opaque plates into a separate depth buffer, then composites them over the faded actual ship and sea before FXAA. Plates occlude deeper armor and show an outline only while hovered. `ArmorHover` raycasts the visible inspection meshes, including physical thickness and current mount poses, and supplies the tooltip without changing selection or simulation. Isolating a list row makes that inner layer available for inspection and hover. Internals and combat inspection keep their translucent presentation.

## What is editable now, and what comes next

Hull station tables, component placements, polygonal superstructure tiers, equipment, physical armor plates and internal layout can be changed in JSON and rebuilt. The Bismarck recipe still has ship-specific superstructure, fittings and underwater details; it is not a generic in-game hull editor. Large hull changes require adjusting those structures and validating module/compartment placement.

The schema gives future editor code a durable authoring boundary. Full construction still requires a hull editor, derived mass/displacement and compartment generation, attachment/clearance rules, undo/redo, persistence migrations and competitive validation. Render-only Blender refinements will not automatically become meaningful construction parameters. Preserve the versioned blueprint rather than trying to reconstruct design intent from the GLB.
