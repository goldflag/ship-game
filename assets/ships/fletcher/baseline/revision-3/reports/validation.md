# Fletcher revision 3 validation

Validated 2026-09-06 after correcting the hull and superstructure proportions. Export content hash: `09030d3f59d3503c8d7540106b1f9c1107b0d6527d5d9cd691641a5136df542b`.

## Model and shape checks

- Shared `ship:compile`, `ship:build`, `ship:check` and `ship:review` passed. Local Blender 5.2 authored/exported the original recipe; no Blender MCP tools were available.
- Export: **257,888 triangles**, **11,533,516-byte GLB**, 81 meshes, 12 gun mounts / 13 muzzles, two trainable torpedo assemblies / ten muzzles, and eight depth-charge release sockets. Stable joint/socket IDs survive. See [export.json](export.json).
- Visually inspected all five final fixed views: profile, plan, bow, stern and quarter, under [generated/review](../generated/review/). Also inspected matching exported-GLB side, top, bridge and end views against the preserved GameModels3D rasters. The bow, transom, deckhouse fronts and core/wing relationship were corrected through successive comparisons.
- `check-shape.py` verifies the rendered model hash, identical camera plans and image hashes before measuring selected opaque silhouette rows/columns. On the sampled probes, RMS differences improve from 8.36 to 0.29 m at the bow stem, 2.01 to 0.40 m on the forward lower profile, 0.49 to 0.09 m in foredeck half-breadth, and 3.82 to 0.28 m in bridge solid width.
- These are sparse screen-space checks, not a full-model similarity score or historical certification. See [shape-correction.md](shape-correction.md), the [raw probes](../generated/comparison/shape-measurements.json), and [discrepancies.md](discrepancies.md). The reference load datum and later outfit remain unverified.
- Original authoring reads are retained in [authoring-reads.json](authoring-reads.json). No reference game geometry, topology, UVs, attachment transforms or texture is an authoring input. This revision changes only Fletcher's original authoring sources and blueprint; no shared component recipe changes required rebuilding other models.

## Simulation and build

- `bun test --timeout 15000`: **297 passed, zero failed**, across 40 files with 34,336 assertions, in 40.09 seconds. Output: [tests.txt](tests.txt).
- The tests exercise hull collisions and damage, gun obstructions, both torpedo broadsides and exact rotated origins, depth-charge entry and timestep behavior, three-dimensional blast distance, flooding, magazines, scoring, reset, and exported-model articulation.
- `bun run build`: all six ship checks, aircraft checks, TypeScript and Vite pass. The existing large-chunk advisory remains. Output: [production-build.txt](production-build.txt).

The revised hull and major structures are shared by rendering and CPU combat. The steering/after-magazine envelopes were adjusted to the new afterbody, including a 58 m³ steering-space flood capacity. All published weapon stocks and settings remain as before.

## In-game verification

- Loaded this exact hash in the normal Orca production port with WebGPU. All **18 train/elevation/recoil poses** passed there. The loaded-model record and complete poses are in [port-diagnostics.json](runtime-review/port-diagnostics.json) and [port-articulation.json](runtime-review/port-articulation.json).
- Orca then returned `browser_tab_closed` while capturing the exterior. Final screenshot and weapon checks used fresh, isolated headless Chromium with WebGPU/Metal. This did not attach to or alter the Orca browser.
- The development [weapon fixture](../../../../scripts/diagnostics/fletcher.html) loads the production Game, CPU simulation, actual GLB, ocean, effects and Fleet HUD. Its deterministic starting positions, camera and time controls make the checks repeatable.
- **18 articulation poses** passed in the fixture, with gun muzzle error below 0.00060 m and torpedo muzzle error below 0.000003 m. [Full poses](runtime-review/articulation.json).
- Close-up screenshots verify actual mesh rotation at **−15° and 85°**, with recoil, against CPU elevation. [Port / low](runtime-review/articulation-close-port-low.png), [starboard / high](runtime-review/articulation-close-starboard-high.png), [rotation and world muzzle evidence](runtime-review/pose-closeups.json).
- Visually inspected the final textured [exterior](runtime-review/exterior-quarter.png), [bridge](runtime-review/bridge-closeup.png), and [afterdeck](runtime-review/afterdeck-closeup.png) in the production harbour scene. Workbench fixed views use material colour; these runtime views show the packed original camouflage.
- All **ten torpedoes** trained, launched and hit a surfaced Type VIIC. Score capped at its 450 HP with one frag. [Launch](runtime-review/torpedo-launch.png), [result](runtime-review/torpedo-result.json).
- **Eight depth charges** launched, entered the water, sank and produced eight blasts; stocks fell from 28 to 20. The close-pass blast damaged the target and caused continuing flooding; all projectiles expired. [Blast](runtime-review/depth-charge-blast.png), [result](runtime-review/depth-charge-result.json).
- Reset cleared torpedoes/charges and restored stocks. No browser page errors occurred. [Reset](runtime-review/reset.json), [compact summary](runtime-review/summary.json).

The refreshed [comparison page](../generated/comparison/index.html) is served at `/ship-reference/fletcher/index.html`. It includes revision 2 / corrected revision 3 / reference views at identical cameras, measurements, runtime captures, credited sources and output hashes. Earlier source and validation records remain archived under [baseline/revision-2](../baseline/revision-2/) and [baseline/initial-prototype](../baseline/initial-prototype/).
