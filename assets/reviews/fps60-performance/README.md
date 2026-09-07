# 60 FPS performance work — 2026-09-06

The best completed live gameplay sample is **55.3 FPS over 30 seconds**, up from the first valid live sample of **41.3 FPS** (34% faster). The newer production build delivered **67.0 FPS for one five-second interval**, but browser occlusion interrupted the full-minute test. **Sustained 60 FPS remains unverified.**

These measurements were collected during the optimization work ending at commit `3a13ba0`, using the gameplay baseline `d25a435`. The PR subsequently integrates `master` at `6e66518`, including newer carrier and sinking behavior. Performance has not been remeasured after that integration.

## Workload and measurements

The deterministic battle contains 60 ships, 30 per team, spanning all ten registered ship types. Medium quality, Fair sea, the normal battle camera and a 1920 × 1080 framebuffer remain fixed. Bots fire and launch aircraft normally; the player holds half throttle without firing. The live harness uses the real App, HUD, audio, animation callbacks and elapsed-time simulation stepping. It does not advance Three’s clock manually or fence the GPU between live frames.

| Measurement | Earlier | Latest measured | Change |
| --- | ---: | ---: | ---: |
| Complete 30-second live sample | 41.3 FPS | 55.3 FPS | 34% faster |
| Median completed CPU+GPU frame, original baseline | 156.0 ms | 24.9 ms | 6.3× faster; 84% less time |
| Median completed CPU+GPU frame, start of this phase | 70.3 ms | 24.9 ms | 2.8× faster |
| Draw calls, original normal battle benchmark | 7,887 | 780 | 90% fewer |
| CPU simulation mean tick | 8.47 ms | 4.88 ms | About 42% less time |

Completed-frame timings use an explicit diagnostic clock and wait for GPU completion. They measure serialized frame work, **not displayed FPS**; live rendering can overlap CPU and GPU work. The 24.9 ms capture includes the rendering changes and predates the final ballistic coefficient cache. CPU timing varies with other work running on this machine.

Sources: [original review](../mixed-fleet-performance/README.md), [this phase’s completed-frame baseline](fenced-before.json), [completed-frame result](fenced-after.json), [first live sample](live-first-development.json), [completed 55.3 FPS sample](live-55-development.json), [latest CPU replay](cpu-after.json), [environment](environment.json).

The live runs reached 48 airborne aircraft and 198 simultaneous shells with audio running. Older live harness event totals include the ten-second warmup; the current harness resets event counting at the measurement boundary. The 122-second CPU replay records 2,824 shots, 127 torpedo launches, 54 aircraft launches, 118 aircraft attacks and 10 aircraft losses.

Two production attempts were interrupted by one-second animation callbacks despite `document.visibilityState` reporting visible. Their simulation advanced only 20.1 and 16.3 seconds during roughly 60 seconds of wall time. Those results are invalid as sustained gameplay benchmarks: [first interruption](live-interrupted-production.json), [67 FPS interval followed by interruption](live-67-interrupted-production.json). Other workspaces and browser renderers were also active. The current harness stops and marks an occlusion-interrupted sample invalid instead of presenting its average as game performance.

## Implementation and validation

- Cache the completed scene pose across water captures and the main draw. Compile fixed assembly transforms while retaining the full authoring hierarchy for explicit queries.
- Encode constant paint, roughness and metalness in derived vertex attributes. Ships and aircraft share compatible materials while preserving textures and surface values.
- Combine fixed ship surfaces into derived render assemblies bounded by actual moving joints. Original surfaces remain available for damage projection, inspection and partial component visibility.
- Reuse consecutive camera culling results, retaining independent shadow-camera culling.
- Publish particle instance buffers once per frame and avoid unchanged label writes.
- Reject impossible sight-ray candidates with conservative bounds before exact CPU intersection tests.
- Skip underwater-only passes only when the camera and entire near plane are above a conservative FFT-plus-wake envelope. Unknown or changing spectra retain those passes. GPU samples never determine combat behavior.
- Reuse immutable machinery layout lookups and invariant ballistic calculations, including a bounded coefficient cache that preserves the original search operations.

No blueprint, original GLB, recipe, joint ID or socket was changed. The CPU replay retains the exact original state hash `8425691121548118407`. The expanded browser replay retains `a7fc65a456859bf6b9d277a2a5b2f892ea273ade1324f2cf7eea977f75ad127a` at tick 3,750.

All **553 tests pass** across 75 files (276,689 assertions), using a 20-second timeout for the existing heavy flooding fixtures. `bun run build` passes ship checks, aircraft checks, TypeScript and production compilation. Tests cover every ship preset’s combined surface positions, paint attributes, articulation, visibility fallback, inspection, camera culling and asynchronous spectrum invalidation. Browser muzzle error remains below 2.75 mm; torpedo muzzle error remains below 0.003 mm. [Browser checks](visual-check.json), [exterior view](exterior.png), [damage inspection](inspection.png).

After integrating `master` at `6e66518`, **577 tests pass** across 79 files (279,230 assertions) with `bun test --timeout 30000 src/simulation src/ships src/game src/schematic scripts/aircraft`. The combined branch also passes `bun run build`, including ship and aircraft checks, TypeScript and production compilation. These are integration checks; the performance measurements and browser captures above remain from before the merge.

## Reproduce

```sh
bun test --timeout 20000 src/simulation src/ships src/game src/schematic scripts/aircraft
bun run build
bunx vite preview --host 127.0.0.1 --port 5291 --strictPort
```

Open `/scripts/diagnostics/live-performance.html?ship=bismarck&seconds=60`. The diagnostic page loads the real production application, prepares the seeded battle and starts after normal animation callbacks resume. Keep the tab visible through loading, ten seconds of warmup and the measured minute. Avoid concurrent builds or other rendering benchmarks. The result is available as `window.review.result`, including five-second windows, frame-time percentiles, simulation elapsed time, combat activity and a validity flag. Clicking Run reloads the original deterministic setup. Add `&camera=chase` to check the normal follow camera.
