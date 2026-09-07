# Windows carrier performance — 2026-09-07

The final integrated eight-carrier replay runs at 21.99 FPS, compared with
13.88 FPS in the original checkout, with 120 airborne aircraft. The isolated
performance patch, before newer master changes were integrated, measured 34.88 FPS.
These are real animation-loop samples, including the HUD, audio, simulation and
rendering, in production builds on this Windows computer.

## Configuration and results

- Intel Core i7-12700K, NVIDIA RTX 5070 Ti, Chrome 151, native Windows WebGPU.
- Medium quality, Fair sea, 1280 × 720 CSS viewport at device scale 1.5
  (1920 × 1080 framebuffer), isolated headless Chrome profile, audio running.
- Four Enterprise carriers per team; seven bot carriers, player at half throttle.
  Seed `0x6e617661`, 5 km starting separation, 3,600 fixed ticks before replay,
  then ten seconds of real-time warmup and a complete thirty-second sample.
- No profiler during these paired samples. Both report zero hidden frames.

| Sample | FPS | Median interval | 95th percentile | Simulation time in 30 s |
| --- | ---: | ---: | ---: | ---: |
| `carriers-before.json` | 13.88 | 62.5 ms | 76.5 ms | 26.37 s |
| `carriers-after.json` | 34.88 | 21.1 ms | 34.7 ms | 26.22 s |
| `carriers-integrated.json` | 21.99 | 38.1 ms | 48.7 ms | 25.70 s |

The baseline bundle is commit `abc78972dc3ef44a080e029b49bddee523b997d3`.
The first after bundle contains the performance patch before integration of newer
master changes (equivalent to `dbec8178`, apart from its final conservative sphere
bound cleanup and combined import). Both use the original baseline ship assets.
The final integrated bundle is `3eb931c8ff3379eb9f10eb474019cb3a3c074933`,
including remote master `d840e0c6`, with new ship rig assets, radar/flag rendering,
horizon changes and spectator controls. Later source commits only update the
diagnostic runner and tests. `carriers-integrated.json` records that build revision
and the runtime model hashes. Its result includes those upstream changes and
ordinary run-to-run variation; the cost difference between the two after samples
has not been isolated to any one upstream feature.

The isolated patch produces a 2.51× FPS improvement and a 66% reduction in median
frame interval. The final integrated build delivers 58% higher FPS and a 39%
reduction in median frame interval compared with the original checkout.
It does **not** establish locked 60 FPS: occasional approximately one-second
stalls remain in both runs, and neither advances a full thirty seconds of
simulation during the sample. The simulation's existing real-delta clamp is
unchanged. Recorded elapsed wall time includes the stalls; no slow frames are
dropped from the reported FPS. Results describe this battle and machine, rather
than every fleet, camera or graphics setting.

## Changes and visual limits

AA guns reuse one conservative candidate list per ship/tick, preserving original
aircraft order and same-tick death checks. Fighter reassessment counts assigned
attackers once. Magazine lookup reuses the immutable definition index. Gun
clearance uses a static spatial tree with exact leaf intersections and reuses
results when local traverse/elevation have not changed. A Newton fast path solves
the same drag trajectory, retaining the bracketed solver for difficult shots.
CPU simulation continues at 60 Hz; launch capacities and combat ranges are intact.

Aircraft outside the camera frustum skip model work. Distant airborne aircraft
under nine CSS pixels of wingspan use the existing depth-tested contact silhouette.
Projected size controls model LOD, so binoculars and close following restore
detail. Authored moving joints remain independent. Distant wake coverage refreshes
at 5 Hz, retaining every trail sample; nearby/zoomed wakes retain 20 Hz updates.
The paired screenshots retain the sea, ships, visible aircraft and combat feedback.
The final distant/zoom/near captures also retain the same selected airborne
aircraft. The distant view uses contacts; 24× zoom restores twelve model instances,
and the close view shows the detailed airframe, propeller and attached payload.
There are no JavaScript exceptions in the browser captures. Two resource-404
console messages also occur in the baseline; the final response listener did not
identify their URLs. All thirteen audio resources and the fleet/aircraft models
load successfully.
No ship or aircraft authoring assets were changed by this patch.

## Validation and evidence

New regression checks compare AA candidate selection with the full scan, compare
clearance against all obstructions at intermediate gun poses across the preset
roster, and compare ballistic time/impact with an independent reference (time
error below 1e-7 s and impact error below 0.1 mm). Aircraft tests cover frustum
culling, distant contacts, zoom restoration and independent folding joints; wake
tests retain the full curved trail across changes in refresh cadence.

The production build, including `ship:check all`, `aircraft:check all` and
TypeScript, passes under WSL; see `build-integrated.log`. Native Windows historical
comparison checks expose an existing platform-dependent path separator in their
input hashes. Existing comparison hashes and Bismarck baseline assets were
preserved. `.gitattributes` now keeps source line endings LF across platforms,
preventing Git's CRLF conversion from making geometry inputs appear stale.

The first parallel test run (`tests-after.log`) records five-second timeouts under
load and stale fixtures. Aircraft/map fixtures were brought up to date with the
integrated spectator state, the sea aim assertion now permits floating-point
roundoff, and the loading-progress test accepts concurrent completion ordering.
The serial run uses `bun run test --timeout 60000`; its output is retained in
`tests-serial.log`: 752 passed, two exceeded their own explicit timeouts. The
full carrier rotation and ten-minute compartment-network cases now allow sixty
seconds. Both affected files pass on rerun (14 tests, 82,575 assertions), recorded
in `tests-timeouts-fixed.log`. All 754 discovered tests are covered by these runs;
no behavior assertions were removed to address the timeouts.

Earlier `cpu-*`, `live-before`, `production-before` and
`production-after-profile` files are exploratory captures. Some overlap tooling
startup or use V8 profiling, and the older live harness can incorrectly label
long frames as occlusion. They are retained for diagnosis, **not** additional
controlled FPS comparisons. The AA-only CPU replay retains the original exact
state hash. The final numerical solver is validated by precision and behavior
tests rather than a claim of bit-identical floating-point battle state.

## Reproduction

Build each revision into a separate output directory and serve each using Vite
preview. Use Node on Windows for the runner; set `PLAYWRIGHT_MODULE` to an installed
`playwright-core/index.mjs` when it is outside this repository. The runner uses an
isolated installed Chrome profile and records adapter information, errors, the
full game diagnostics (including model hashes), JSON timing data and a screenshot.

```powershell
$env:PLAYWRIGHT_MODULE = 'C:/path/to/playwright-core/index.mjs'
$env:PERFORMANCE_URL = 'http://localhost:5301/scripts/diagnostics/live-performance.html?ship=enterprise-cv6&seconds=0.1'
$env:CARRIERS = '4'
$env:VISUAL_REVIEW = '1'
$env:BUILD_REVISION = '<revision used to produce the served bundle>'
node scripts/diagnostics/windows-performance.mjs carriers-integrated
```

The runner first lets the historical mixed-fleet harness initialize, then replaces
the fleet with the identical carrier fixture in either revision. The second
measurement uses `measure-windows-live.mjs`, which captures the complete requested
interval even when the game cannot keep real time. Avoid simultaneous builds,
tests or CPU profiles during performance measurements. `VISUAL_REVIEW` captures
distant, zoomed and nearby aircraft **after** the timed sample.
