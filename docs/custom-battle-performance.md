# Custom battle performance

Use `scripts/diagnostics/custom-battle-performance.html` for the actual application
and `LocalBattleSession` Rust worker. The older fleet harnesses use the TypeScript
simulation fixture and cannot measure local worker snapshot costs.

The harness starts a symmetric mixed fleet with a carrier on each team, normal
bots, High graphics and full resolution. It records the first minute after battle
graphics are ready, including startup stalls, with ten-second windows. The player
does not move or fire; bots run normally. Query parameters: `seconds`, `quality`,
comma-separated `roster` (first ship is the player), and optional `profile` for
instrumented phase/render-pass timings. The setup dialog is automated; the actual
roster is substituted at `prepareBattle`.

## Reproduce on Windows

Build with `bun run build`, then run `bun run preview --port 5318`. Install
`playwright-core` in a temporary tools directory, or provide an existing module.
The runner uses installed Chrome with an isolated profile, a 1280 × 720 viewport,
device scale 1.5 (1920 × 1080 framebuffer), and a fixed Rust seed.

```powershell
$env:PLAYWRIGHT_MODULE = 'C:/path/to/tools/node_modules/playwright-core/index.mjs'
$env:PERFORMANCE_URL = 'http://localhost:5318/scripts/diagnostics/custom-battle-performance.html?seconds=60'
node scripts/diagnostics/measure-custom-battle.mjs sample
```

JSON frame samples and a final screenshot go to ignored `.build/custom-battle/`.
Results also record the installed Chrome version, reported CPU concurrency and
the WebGPU adapter used to create the game's device, where exposed by Chrome.
`CPU_PROFILE=1` adds a Chrome CPU profile; `VISUAL_REVIEW=1` captures ship, airborne
aircraft, distant and magnified views after measurement. `FORCE_WEBGL=1` exercises
the fallback renderer. Keep profiling and other CPU/GPU jobs off during paired FPS
measurements; instrumented development runs are not comparable to production.

Prefer `CPU_PROFILE_AFTER=1` when diagnosing main-thread work: it profiles eight
additional seconds after the FPS sample, because Chrome's CPU profiler can
substantially slow the WASM worker. `GPU_PROFILE_AFTER=1` samples render/compute
timestamps after the FPS sample when the device supports timestamp queries.
These GPU timings exclude CPU submission and presentation overhead.
The `profile` URL parameter also records worker tick execution, JSON serialization,
decoding/normalization and delta generation separately. Compare simulation time
advanced with wall time as well as FPS; a battle falling behind is not a valid
way to reach the target frame rate.

For the larger performance target, use this roster on each side (15 ships and
two carriers per team) with the same High quality and full resolution:

```text
bismarck,yamato,king-george-v,baltimore,fletcher,flower-corvette,bismarck,yamato,king-george-v,baltimore,fletcher,baltimore,fletcher,enterprise-cv6,shokaku
```

## September 8, 2026 measurement

Windows, NVIDIA RTX 5070 Ti, Chrome WebGPU, High, 1920 × 1080, default diagnostic
roster and seed. Baseline source: `5d145339`. Both runs used production Vite bundles
without CPU or phase profiling, over the first 60 seconds of the same setup.

| Metric | Before | After |
| --- | ---: | ---: |
| Average FPS | 35.4 | 50.2 |
| 95th-percentile frame interval | 34.9 ms | 27.9 ms |
| 99th-percentile frame interval | 55.4 ms | 34.7 ms |
| Longest frame interval | 944.4 ms | 90.1 ms |
| Frames over 100 ms | 8 | 0 |
| Simulation time advanced | 57.12 s | 59.92 s |

This is a 42% average FPS improvement, not a doubling or sustained 60 FPS: the
final ten-second window improved from 32.4 to 41.3 FPS. Other hardware, camera
positions, fleets and longer battles need their own measurements. Zero stalls
over 100 ms in this run does not guarantee that every future run is hitch-free.

The changes warm actual battle render passes, aircraft/effect variants and the
impact material under the loading screen while combat is held. Instance draws
use the live population while shader matrix capacity remains fixed. Local
snapshot parsing and sparse transfer move work off the render thread; offscreen
cloth skips integration, subpixel scars skip draws until resolved, and unchanged
damage labels retain their content and measured dimensions. Combat tick rate,
aircraft population, particle capacity, ocean quality and ship assets are retained.

Relevant tests and TypeScript checks passed. At this measurement, the full build
stopped at a pre-existing `tbd-1-devastator` retained export report mismatch;
production rendering was measured using `vite build` separately. That comparison
has since been corrected as described below.

Forced WebGL on this machine fails during harbor warmup with shader validation
errors and device loss in both the baseline and changed versions. WebGL could not
be visually validated; the measurements above apply to WebGPU.

## Larger carrier battle

The larger diagnostic uses 15 ships per side, including Enterprise and Shokaku
on each side: 30 ships and four carriers in total. Graphics remain High at
1920 × 1080. CPU combat, aircraft populations and simulation tick rate are retained.

Opaque fleet surfaces coalesce identical geometry into native instanced draws on
the pinned Three r185 WebGPU backend. Render bundles retain those commands while
the renderer updates live pose textures, uniforms and camera/shadow culling.
Changed geometry ranges, pipelines or GPU resources rebuild the bundle. Sorted
and transparent materials retain their original submission path. `bundles=0`
disables command caching for comparison while retaining native instancing.

Whole-ship bounds include articulation, recoil and the sun's shadow volume.
Offscreen hull motion continues; visible joints use the current interpolated
snapshot on re-entry. Funnel smoke and aircraft gunfire retain their trajectories
while skipping offscreen instance preparation. Sight selection uses a conservative
armor index followed by the existing exact intersection test. Local WASM snapshots
stream the existing presentation projection without allocating an intermediate
JSON tree; a same-battle native test compares every field against the prior path.

Two consecutive unprofiled, 60-second production runs on the machine above:

| Metric | Command cache disabled | Command cache enabled |
| --- | ---: | ---: |
| Average FPS | 61.1 | 63.8 |
| Final ten-second FPS | 53.0 | 55.5 |
| 95th-percentile frame interval | 21.0 ms | 20.9 ms |
| Longest frame interval | 62.5 ms | 55.6 ms |
| Frames over 100 ms | 0 | 0 |
| Simulation time advanced | 59.25 s | 59.48 s |

The enabled run came first. Busy windows still fall below 60 FPS, so these
measurements establish an average over 60, not sustained 60 throughout combat.
Earlier runs varied considerably with machine load; do not attribute the full
difference from those runs to a single optimization. Ship, close aircraft,
distant and 24× views were inspected after the enabled run; maximum muzzle
alignment error was 2.75 mm. No new JavaScript or WebGPU errors were observed.

A subsequent 120-second run with the same fleet averaged 50.7 FPS, with late
windows at 35.9–50.3 FPS, one frame over 100 ms, and 117.9 seconds of simulation
progress. This longer run contradicts sustained 60 FPS and is the next profiling
case. `profile=1&profileAfter=60` starts main-thread phase instrumentation after
the first minute; worker timing remains enabled throughout that diagnostic run.

The full build's aircraft-report failure was traced to one-bit differences in
`Math.hypot` results for measured joint travel (for example, 4.183700613547448
versus 4.1837006135474475 metres). Report comparison now allows four relative
machine epsilons only for `joints[].maximumVertexTravel`, including each LOD.
Model/source hashes, geometry counts, bounds and all other fields remain exact;
retained assets and hashes were not rewritten. The normal `bun run build` passes
with every ship and aircraft validator enabled.

### GPU wake experiment

The late-combat phase profile measured about 2.3 ms/frame in wake foam. The
experimental WebGPU path retains the same CPU trail/impact samples and 20 Hz /
5 Hz refresh rates, but paints max-coverage ellipses into an R8 render target.
Footprint and vertex storage are retained and prepared for each fleet during
loading. Other backends retain the CPU rasterizer.

The dev-only `/scripts/diagnostics/wake-foam-gpu.html` compares GPU pixels against
the CPU rasterizer and exposes `window.result.passed`. It covers aging turns,
splash rings, buffer growth, a 30-ship atlas, distant refresh, zoom, pause,
teleport, tile removal/reordering and reset. Maximum observed difference is one
8-bit level; reset is exactly empty. Ship and distant in-game views were inspected.

The first two-minute GPU-wake run averaged 53.1 FPS versus the earlier 50.7 FPS;
late windows remained 38.6–51.5 FPS. Three frames exceeded 100 ms, with a 306 ms
maximum, so stall behavior needs further verification. That run predates the
retained footprint buffers. These results do not establish sustained 60 FPS.

With retained footprint buffers, a subsequent 120-second run averaged 55.0 FPS,
with late windows at 40.4–44.8 FPS, 118.3 seconds of simulation progress, and
one frame over 100 ms (106.9 ms maximum). Six render pipelines were created
around 78.5 seconds; the harness now records material IDs and scene object names
to identify first-use compilation. `UPLOAD_PROFILE_AFTER=1` measures GPU buffer
upload calls and bytes over 60 additional frames after the uninstrumented FPS
sample. Those additional frames are diagnostic, not part of the FPS result.

The flag solver now reuses each column's flutter value across all cloth rows,
hoists shared wind calculations and prepares fixed link weights once. It retains
the 120 Hz step, mesh resolution and six constraint iterations. A temporary
old/new comparison produced exactly equal particle arrays over 12,000 frames
covering calm, reversed, storm and changing winds/gravity. Six alternating V8
microbenchmark pairs reduced solver time by about 14%; this is an isolated
solver measurement, not an overall FPS gain. Cloth and rig behavior tests pass.

The subsequent cloth run still averaged 55.0 FPS with a 111.1 ms maximum frame.
Its material catalog identified the late pipelines as aircraft tracer tips,
envelopes and cores. A GPU reproduction found that the first overflow page's
WGSL differed only in process-wide `NodeBuffer_<id>` names. The pinned r185
adapter retains NodeBuilder's shader-local names for instanced draws, allowing
identical pages to reuse shader programs and pipelines with their own bindings.
It leaves explicit names and other backends alone.

Late upload instrumentation measured 7.13 MB/frame in matrix uniform buffers,
plus 1.47 MB/frame in attributes. Native WebGPU aircraft now use versioned
storage matrices and upload only live instances; the fallback keeps uniform
matrices. The dev-only `/scripts/diagnostics/instance-matrices-gpu.html` compares
both paths using real aircraft models, LOD changes, empty/repopulated batches,
and 801 aircraft. `?stable=1` additionally enables stable buffer names. Pixel
hashes matched exactly with and without the adapter, including 606 aircraft
tracers. Tracer pipeline creation fell from six to one, with no new pipelines
on crossing the 512-instance page boundary. Fleet growth and independent joint
pose tests exercise both matrix representations.

The final versioned-storage run averaged **57.3 FPS** over 120 seconds, with
the final 50 seconds at **46.7–49.1 FPS**. Simulation advanced 118.05 seconds.
There were no frames over 100 ms and the maximum was 55.6 ms. No render
pipelines were created after the first second; total render/compute pipeline
creation fell from 1,149 in the preceding cloth run to 404. Ship, close aircraft,
distant and 24× views were inspected, and the final normal view remained intact.

Storage matrices use explicit version updates rather than Three's unconditional
dynamic-usage uploads. The GPU diagnostic verifies that a second render needs
zero additional matrix uploads and still matches the reference pixels. Late
instrumentation measured 12.2 KB/frame for aircraft matrices and 2.43 MB/frame
for all buffer uploads, versus 8.63 MB/frame before these matrix changes.
These runs still contradict sustained 60 FPS in busy combat. Full builds and
the relevant cloth, aircraft, wake and instance behavior checks pass.

### Particle preparation and measurement variability

Particle and aircraft-tracer poses now compose matrices directly from retained
vectors and quaternions. They avoid temporary scene-object Euler synchronization
and world-matrix updates. Perspective smoke volumes prepare their final facing
pose immediately; other particle alignment, sorting, fade and motion rules remain
unchanged. Aircraft gunfire also reuses event-origin and attitude scratch values.

An old/new comparison matched every particle instance matrix, color and custom
attribute across 180 moving-camera frames for both ordinary and volume particles,
including orthographic and inside-volume views. Aircraft/tracer GPU pixel results
matched the preceding build exactly through 606 tracers. The 39 relevant effect
behavior tests pass. An isolated V8 test of 1,800 ordinary particles reduced
preparation time from 150–158 ms to 108–113 ms over 300 publications, about 28%.
This is a component measurement, not a 28% gain in game FPS.

Later unrestricted production measurements slowed substantially even on the
unchanged main build. The particle candidate averaged 37.8 FPS over 120 seconds,
with two frames over 100 ms and only 62.55 seconds of simulation progress. These
were followed by an unchanged-main control at 36.7 FPS, also with two frames over
100 ms and 63.12 seconds of simulation progress. The candidate was about 3% faster
in this pair, with average frame work falling from 23.71 to 22.96 ms. These
results cannot establish sustained 60 FPS or be compared directly with the earlier
57.3 FPS result. The measured device remains NVIDIA Blackwell, using Chrome
151.0.7922.170 and a 1920 × 1080 framebuffer at High quality.

CPU counters during the slow run showed the four efficiency-core threads at
80–88% utilization while most performance-core threads were lightly used; GPU
utilization was about 12% at that sample. A separate cloth microbenchmark recovered
its earlier speed when its own temporary Node process was restricted to the
performance cores (644–672 ms versus the recent unrestricted 955–1,097 ms).
This supports a scheduling contribution but does not prove the cause of every
frame stall. No system power settings or user processes were changed. Battle FPS
results above use ordinary scheduling; a proposed affinity-controlled battle
diagnostic was rejected by automatic approval review and was not run.
