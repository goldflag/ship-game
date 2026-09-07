# Second performance pass — 2026-09-07

This pass reduces repeated simulation work in large battles with aircraft. Two 60-ship Bun replay pairs measured **40–43% less mean simulation time**, exceeding the 25% target for that workload. **A 25% displayed-FPS improvement and elimination of all frame spikes are not established.** The machine was running other workloads; full browser frame timings were inconsistent.

Measurement baseline: `54b0be10d3eb707c2dee9f3b0042cf879280a94e`, the remote master checked at the start of this task. [Environment and exact measured runtime-source hashes](environment.json). These timings and replay hashes predate integration with master `167773c5`; the newer AA, sea handling and combat behavior changes the workload. Performance has not been remeasured after that integration.

## Changes

- Collect airborne opponents once per fleet tick, then conservatively reject aircraft outside each ship’s possible AA reach. Each gun retains the original exact muzzle distance, target order, live HP check and firing behavior.
- Reuse immutable magazine definitions and calculate target distance and inherited ship velocity once per ship’s gun phase.
- During flotation’s unchanged 27 trial iterations, calculate only displaced volume. Cache vertex projections for that solve and skip clipping wholly wet/dry sections. The final equilibrium still computes the full center of buoyancy.
- After the bounded ballistic coefficient cache fills, calculate missing coefficients in scalar locals rather than allocating one temporary bracket per search level.
- Extend diagnostics with the current runtime roster, p99/max latency, budget overruns, slow-tick/frame records and an expanded deterministic state hash. Reset the browser fixture after loading so startup timing cannot change its initial combat state.

The initial V8 profile identified gun training, AA scanning, ballistic solving and garbage collection as the largest CPU costs. This pass keeps simulation cadence, targeting, numerical search operations and rendering quality unchanged. No model authoring inputs or generated assets changed.

## CPU replay

The seeded battle contains 30 ships per team, cycling through `src/ships/presets.ts`. Bots fire and launch aircraft; the player holds half throttle. Each run has 120 warmup ticks followed by 7,200 measured ticks (122 seconds of simulated battle total). These are simulation CPU timings, not whole-frame timings or FPS.

| Pair | Mean before → after | p99 before → after | Ticks over 33.33 ms before → after | Maximum before → after |
| --- | --- | --- | --- | --- |
| First | 10.59 → 6.04 ms | 30.27 → 18.81 ms | 48 → 0 | 81.86 → 32.93 ms |
| Reverse-order repeat | 13.57 → 8.17 ms | 54.90 → 26.21 ms | 320 → 28 | 393.71 → 68.01 ms |

Sources: [first baseline](current-cpu-first-before.json), [first result](current-cpu-first-after.json), [repeat baseline](current-cpu-repeat-before.json), [repeat result](current-cpu-repeat-after.json). The first baseline overlapped browser startup; the reverse-order repeat ran with the game paused, but other applications remained active. A briefly launched profiling comparison also overlapped several seconds of that repeat baseline before being stopped. Timing variation and remaining outliers prevent a zero-spike claim.

A separate Node 22 / V8 pair corroborated the CPU result: mean **12.93 → 7.46 ms** (42% less), p99 **47.39 → 27.25 ms**, ticks over 33.33 ms **191 → 42**, ticks over 50 ms **61 → 1**, and maximum **173.73 → 67.69 ms**. [V8 baseline](v8-cpu-before.json), [V8 result](v8-cpu-after.json). These runs used the same bundled fixture and a SHA-256 replacement for the diagnostic-only `Bun.hash`; both full-state hashes are `e1d7aa0c420bee6a6fdbdb774dc53b6e19e83ebbc4d0b8453861ad8297e7beaf`. This checks the browser engine family, not browser rendering or browser scheduling.

All four Bun runs retain the exact expanded Bun state hash `3867719059215755088`, covering actors, shells, torpedoes, depth charges, aircraft and events. The older fixed-roster [baseline](historical-cpu-before.json) and [intermediate result](historical-cpu-intermediate.json) are exploratory measurements from before the final AA bound and ballistic fallback changes; they are not the final workload comparison.

## Browser evidence

Both production builds ran the same current-roster replay, normal battle camera, Medium/Fair settings and 1920 × 1080 framebuffer. After reaching tick 6,000, the diagnostic ran 60 warmup frames and 600 measured frames at an explicit 1/60-second simulation interval, ending at tick 6,660. It waits for GPU completion after each frame, so this measures serialized completed work rather than displayed FPS.

The [baseline](frames-before.json) and [result](frames-after.json) have the exact same combat state hash `6cccfc89282332eacd70d9ee4d30ff5ff67e532e93c80fed90b3137e6edca711`, median 1,681 draw calls and median 4,655,734 triangles. Completed-frame means were 39.52 ms before and 114.73 ms after; simulation phase means were 7.93 and 8.53 ms. The second run therefore does **not** demonstrate a whole-frame improvement. Most added time was outside the measured simulation, water-update and main-render phases; GPU execution and external scheduling were not isolated in those captures. Live rAF attempts were also interrupted by browser throttling. These results are retained as inconclusive evidence, not discarded or converted into an FPS claim.

A later [frozen-scene timestamp probe](gpu-probe.json) at tick 3,600 used 20 warmup and 60 measured frames ([probe source](gpu-probe.js)). Its mean submission work was 8.77 ms and completion/readback wait 17.05 ms. Three reported 77.53 ms of accumulated render-pass timestamps, which is not interchangeable with the measured elapsed frame time. There was no paired baseline timestamp capture, and the tab lacked focus. This probe therefore supplies no additional before/after performance claim. Screenshot capture also timed out because the browser was not reliably visible. A stable foreground browser run remains necessary to establish displayed-frame gains and remaining GPU stalls.

## Validation before integration

`bun run test --timeout 30000` passes **718 tests across 101 files, 350,549 assertions**. The final default eight-worker run hit five-second timeouts in two existing long simulation tests (opening bot acquisition and Yamato flooding); the full serial run above passes them. No assertion failed in the parallel run. The Game frame test harness also needed its stale battlefield-camera stub updated for the already-merged transition/listener API. During integration, master’s newer real `BattlefieldCamera` harness superseded that local stub repair.

Regression coverage compares indexed and exhaustive AA behavior, immediate aircraft losses and ties; conservative AA range bounds through hull/gun rotations; every preset’s flotation against full moment trials at varied attitudes and loads; and ballistic trajectories after coefficient-cache saturation.

`bun run build` passes ship and aircraft freshness checks, TypeScript and production compilation. `git diff --check` passes. The [production render check](render-check.json) at tick 6,660 records maximum gun muzzle error below 2.75 mm and torpedo muzzle error below 0.003 mm. Runtime source hashes still match the measured build.

## Validation after integration

Rebased onto master `167773c530f12be221f6738ac253ae2a48ad3c76`, preserving the newer AA caliber envelope, mean hull-depth checks, sea handling, contact damage and projectile behavior. Master’s real camera test harness replaces the earlier local stub repair; a duplicate AA test import from the automatic merge was removed.

The integrated branch passes **778 tests across 109 files, 378,031 assertions** with `bun run test --timeout 30000`, plus `bun run ship:check all`, `bun run build` and `git diff --check`. No authoring or generated model changes were needed. [Integrated source hashes and validation](integration-validation.json). The performance and visual measurements above remain from before integration; they do not establish the integrated branch’s FPS or percentage speedup.

## Reproduce

```sh
bun run test --timeout 30000
bun run build
bun scripts/diagnostics/mixed-fleet-performance.ts 30 7200 current
bunx vite preview --host 127.0.0.1 --port 5296 --strictPort
```

For live gameplay open `/scripts/diagnostics/live-performance.html?ship=bismarck&roster=current&seconds=60`. Keep the tab visible through loading and the full sample; inspect `window.review.result.valid`, simulation elapsed time and five-second windows before interpreting FPS. For completed-frame diagnostics add `&manual`, wait for `window.review.ready`, then call `await window.review.measureFrames({battleTick:6000,warmup:60,frames:600})`. Reload between replays. Use an otherwise quiet machine and compare the same harness against the baseline source.
