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
