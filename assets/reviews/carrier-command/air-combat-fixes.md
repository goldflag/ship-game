# Aircraft visibility, accuracy and Bismarck AA

Implemented September 6, 2026.

## Causes and changes

- Aircraft LODs continued drawing at 120 and 400 m, but wingspan-based contact fading started too late for thin silhouettes. The contact now overlaps the model across 48–14 projected pixels and remains nine pixels wide. The actual model and CPU aircraft size are unchanged.
- Fighter firing eligibility previously guaranteed damage; strike pilots used the exact target center. Fighter bursts now sample seeded angular error and test miss distance. Bomb and torpedo pilots hold a seeded aim error for each sortie/pass, while payloads retain physical ballistic/straight-running trajectories. A successful fighter burst is stronger to retain useful combat effectiveness with missed bursts. Aircraft identity, battle seed and sortie isolate these samples from other launches and render frames.
- Bismarck's AA fittings were visual-only and the earlier abstract light-gun envelope produced no gunfire. Twenty-eight existing fittings now use shared catalog/blueprint mount contracts: eight twin 105 mm, eight twin 37 mm and twelve single 20 mm. Guns acquire airborne enemies, train/elevate, consume ammunition, respect equipment and friendly-lane checks, and emit traveling tracers. The two upper quad 20 mm fittings remain decorative. Gameplay and supply approximations are recorded in the ship discrepancy register.

## Validation

- 49 focused tests pass across aircraft, aircraft accuracy, AA, fleet battle behavior and aircraft rendering.
- 50 tests pass across blueprint validation, camera input, aircraft follow, game frames and carrier UI.
- 13 exported-ship renderer tests pass, including Bismarck's new muzzle chains through train, elevation and recoil.
- The initial broad run passed 541 tests and exposed three failures: the former no-player-AA assumption, the former guaranteed-kill timing, and the not-yet-rebuilt model. The affected tests pass after updating expected AA behavior, tuning fighter effectiveness and rebuilding the model. No later full-suite pass is claimed.
- `bun run build` passes all ten ship checks, aircraft checks, TypeScript and Vite. Its existing large-bundle notice remains.
- Local Blender 5.2 LTS rebuilt Bismarck and its thumbnail/comparison pack; all five fixed review images were inspected. The other four historical comparison packs were refreshed because their input hashes include the shared gun catalog. No Blender MCP was available.
- Bismarck export: `b96b0d3f14325b349978f229ddc2ba5474843ed29ea9045589c6d17d40982f6c`, 38 mounts, 64 barrel chains, 368,428 triangles, 142 meshes. Export success establishes pipeline consistency, not historical accuracy.

The actual WebGPU game scene fired 196 AA rounds in the ten-second stationary-target fixture, debited 196 rounds, rendered six aircraft, and measured a maximum visual/CPU muzzle error of 0.00217 m. See [AA screenshot](bismarck-aa-in-game.png) and [measurements](bismarck-aa-in-game.json). The fixture refreshes target positions and health to isolate mount operation; this is not a kill-rate benchmark.

The follow camera at 800 m retains all six aircraft visibly in the ocean scene: [capture](follow-zoom-800m.png), [render counts](follow-zoom-800m.json). For inspection only, the diagnostic follows the opposing carrier's aircraft by setting the tracked ID; normal player controls still follow the player's own aircraft. Rear and side raster probes also preserve visible pixels at 400 and 800 m. [Visibility measurements](aircraft-visibility.json) include the earlier baseline and corrected overlap; at 800 m the same rear-view fixture's summed contrast increased from 915 to 3100. The diagnostic scene is retained at `scripts/diagnostics/carrier-air-combat.html`.

## Fleet AA coverage audit

All 120 registered AA-capable mounts across the ten presets fired in the four-direction stationary-target probe: Bismarck 28, Baltimore 6, Enterprise 42, Type VIIC 1, Liberty Cargo 10, Liberty Collier 8, Victory Cargo 10, Flower 3 and Fletcher 12. Yamato has no registered AA-capable mounts; its AA remains decorative. Baltimore’s six twin 5-inch mounts work, but its modeled light AA remains decorative. These authoring gaps are outside this Bismarck connection change. See [probe results](fleet-aa-audit.json).
