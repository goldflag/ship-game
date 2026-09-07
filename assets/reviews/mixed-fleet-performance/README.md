# Mixed-fleet performance review — 2026-09-06

This replay deploys 30 ships per side: three of each registered ship type on each team. Bismarck, Yamato, Baltimore, Enterprise CV-6, Type VIIC, Fletcher, Flower Corvette, Liberty Cargo, Liberty Collier and Victory Cargo all participate. The fixed seed is `0x6e617661`, the deployment gap is 5 km, and the player holds half throttle without firing. Bots, shells, torpedoes, aircraft, collisions, module damage and flooding run normally.

The baseline is commit `d25a435c5a001655588570c913c1747b938c3cef`. Both browser builds used the same original ship/aircraft assets, dependency installation, browser window, medium quality, Fair sea and 1920 × 1080 framebuffer. The machine is an Apple M5 Pro with 48 GiB memory; backend and browser details are in [environment.json](environment.json).

## Measurements

The CPU replay runs 120 warmup ticks plus 7,200 measured ticks, representing 122 seconds of combat. These unprofiled runs produced the same actor, shell and event hash, `8425691121548118407`. There were 2,824 gun shots, 127 torpedo launches, 54 aircraft launches, 1,024 penetrations and 1,087 ship contact events. Full per-ship damage/flooding results are retained in the JSON files.

| CPU simulation | Before | After | Change |
| --- | ---: | ---: | ---: |
| Mean tick | 8.47 ms | 5.83 ms | 31% less time |
| Median tick | 8.16 ms | 5.63 ms | 31% less time |
| p99 tick | 16.44 ms | 11.04 ms | 33% less time |

Sources: [CPU before](cpu-60-before.json), [CPU after](cpu-60-after.json).

The browser replay first advances to tick 3,600, then renders 30 warmup frames and 120 measured frames while combat advances at a fixed 1/60 second. Each measurement includes completed GPU work using `queue.onSubmittedWorkDone()`; it does not merely time command submission. Three's frame counter advances explicitly so render-to-texture passes run even when the embedded browser's animation callbacks are throttled. These are elapsed completed-frame measurements, **not observed display FPS**. The timings come from development builds on this machine.

The normal battle camera is offset `(190, 100, 230)` from the player at tick 3,600 and looks at the player. The separate wide-frustum stress camera is `(0, 9000, 12000)`, looking at `(0, 0, -2500)`. The stress camera includes the whole formation in the frustum; its altitude is above the cloud layer, so it is useful for submission pressure but is not a representative visual battle view.

| Normal battle camera | Before | After | Change |
| --- | ---: | ---: | ---: |
| Median completed frame | 156.0 ms | 70.6 ms | 2.2× faster; 55% less time |
| p95 completed frame | 168.7 ms | 77.8 ms | 54% less time |
| Median draw calls | 7,887 | 2,748 | 65% fewer |
| Median rendered triangles | 8,593,068 | 2,538,148 | 70% fewer |

Sources: [battle before](battle-60-before.json), [battle after](battle-60-after.json). Both ended at tick 3,750 with 118 live shells. The expanded hash includes actors, shells, torpedoes, aircraft and combat events: both produced `a7fc65a456859bf6b9d277a2a5b2f892ea273ade1324f2cf7eea977f75ad127a`.

| Wide-frustum stress frame | Before | After | Change |
| --- | ---: | ---: | ---: |
| Median completed frame | 360.6 ms | 70.6 ms | 5.1× faster; 80% less time |
| p95 completed frame | 380.6 ms | 76.8 ms | 80% less time |
| Median draw calls | 29,411 | 5,193 | 82% fewer |

Sources: [stress before](gpu-60-before.json), [stress after](gpu-60-after.json). These earlier measurements hash actors, shells and events: both ended at tick 3,750 with 118 live shells and hash `6d21de756687f7a003b07c7e42a0942829826bc65ef029462e4a58df7659d700`. [The intermediate batching-only run](gpu-60-batched.json) measured 73.1 ms, showing that shared submission and removal of the wave-readback wait account for most of the frame improvement; distant detail mainly reduces draw/geometry pressure further.

The large fleet remains demanding: the final measured frame takes roughly 71 ms here, above a 60 FPS frame budget. These results establish a substantial improvement, not a universal frame-rate guarantee. WebGPU was inspected in the browser; WebGL rendering was not separately exercised.

## What changed

- Gun obstruction checks now return a boolean without allocating contact geometry. Gunhouse boxes are cached by immutable ship definition.
- Hydrostatics integrates the clipped polygon edge stream directly, avoiding temporary polygons during repeated flotation solves.
- Torpedoes reject impossible hull candidates with a conservative world-space swept-segment test before doing local transforms. The exact existing collision solver still decides every candidate hit.
- Rigid opaque surfaces with the same material are merged only within retained authored joint/assembly boundaries. At 20 ships this reduced mesh count from 4,764 to 2,544 without changing the 3,647,312 triangles. [Scene measurements](scene.json).
- Fleet surfaces share `BatchedMesh` material submissions while retaining separate ship poses, per-surface culling and original damage-mark receivers. Inspection restores each hull's own materials; binoculars still hide the player hull.
- Derived runtime detail buffers retain existing vertex positions, normals and UVs. Distance, camera zoom and actual framebuffer height determine detail, with a subpixel error budget and hysteresis. Components below half a pixel can be skipped. The most distant buffers contain over 75% fewer triangles in each of the ten presets; close views recover finer detail and inspection uses the full original surface.
- A presentation-only ocean sampler keeps at most one GPU readback pending and reuses its latest completed result. Rendering does not await it. CPU combat poses and waterline calculations are independent of this visual sampler; disposal drains its pending work.

No blueprint, source recipe, original GLB, moving-part ID or socket was edited. These changes concern simulation work and derived renderer buffers. They make no new historical-accuracy claim.

## Visual and regression checks

At tick 3,750, the real 60-ship browser fleet retained a maximum gun muzzle error of 2.75 mm and torpedo muzzle error of 0.003 mm. Inspection restored the player's own transparent hull and modules. Binocular visibility hid and restored that hull. No game error was reported. [Browser checks](visual-check.json).

- [Normal close view after optimization](close-after.png)
- [Same camera/state with runtime detail reduction disabled](close-full-detail.png)
- [Inspectable damage/module view](inspection.png)

The screenshots are native renderer canvas captures. Close-view comparisons retain the hull silhouette, guns, masts, sea, other ships and gunfire; minor texture/triangle differences remain within the runtime detail policy. The existing automated articulation review plus new tests compare all ten actual GLBs, retained IDs, transformed bounds and muzzle positions, verify detail/zoom/visibility restoration and exercise delayed GPU readback, cleanup and errors.

## Reproduce

```sh
bun scripts/diagnostics/mixed-fleet-performance.ts 30 7200
bun scripts/diagnostics/mixed-fleet-scene.ts 10
bun run dev
```

Open `/scripts/diagnostics/fleet-performance.html?team=30&mixed`. Wait for `Ready`, then run in its browser console:

```js
await review.measureFrames();                 // normal battle camera
// Reload the page before another replay.
await review.measureFrames({ view: 'overview' }); // wide-frustum stress
```

For a baseline comparison, use a checkout of the baseline commit with the same diagnostic files copied into `scripts/diagnostics/`, the same dependencies and unchanged assets. Use identical window/framebuffer dimensions, quality and seed. Do not run tests, builds, CPU profiles or another active game during a measured replay. The older `review.measure()` helper times frozen submissions and optional renderer timestamps; it is not the completed-frame benchmark used here.

```sh
bun test --timeout 30000
bun run build
```

Final validation: **541 tests passed, 0 failed**, across 69 files (277,224 assertions). `bun run build` passed all ten ship checks, all aircraft checks, TypeScript and Vite production compilation. The existing large game-bundle warning remains. The longer test timeout accommodates the existing heavy flooding/stability fixtures when running the complete suite.
