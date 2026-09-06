# Firing and impact performance

2026-09-05, baseline `b6e61a6`. The earlier large-fleet work measured firing in the CPU simulation, but its rendered fleet benchmark was frozen without gunfire. It did not validate firing effects or the subsequently added surface impact marks.

The current 24-versus-24 Bismarck battle reproduces long stalls while projecting damage marks. Every impact searched whole receiver meshes in both normal directions, then scanned every triangle of the selected mesh for decal clipping. Simultaneous salvos performed all that work in one frame.

## Change

- Cache small triangle-range bounds once per shared GLTF geometry during loading. Ray queries and decal projection reject distant ranges before inspecting triangles. Query proxies share source attributes and never enter the rendered scene.
- Keep Three's original ray/face/material/UV intersection behavior. Surviving triangles retain their original order for decal projection.
- Queue cosmetic impacts and share a 2 ms work allowance across the entire fleet each rendered frame, rotating the first hull. The allowance is cooperative: a single projection and batch rebuild can finish beyond it. Damage, HP, flooding, projectiles, scoring and feedback still apply immediately in the CPU simulation.
- Retain pending events independently of the simulation's bounded event ring. The queue keeps the latest 96 per hull under overload, matching the existing mark retention limit. Reset/disposal clears pending work. Pre-generate the shared texture atlas while loading rather than during the first impact.

## Measured reproduction

[Raw measurements](measurements.json), on the user's busy computer, 3,600 simulation ticks with real exported meshes, 24 ships per side, the player holding fire, 1,440 impact events and 1,438 successfully placed marks. The benchmark excludes GPU work and texture decoding; it measures only the fleet's cosmetic impact update.

| Impact-update cost | Before | After |
| --- | ---: | ---: |
| Median | 0.128 ms | 0.076 ms |
| 99th percentile | 63.61 ms | 2.99 ms |
| Worst frame | 4,231.34 ms | 9.17 ms |

The same 1,438 marks were produced, with no queued work remaining at the end. Indexing alone, before the frame allowance, reduced the worst frame to 339 ms but still left a visible hitch. Absolute timings vary with background load; these are not overall FPS measurements or a strict 2 ms upper bound.

A separate [rendered run](live-run.json) advanced 900 consecutive rendered frames after an initial 900-tick warmup: 414 shots, 336 impacts, 192 peak smoke volumes and 616 peak spray particles. Impact-mark work peaked at 4.4 ms, with 508 marks retained across the fleet and no queued work remaining. [Final fleet view](live-fleet.png). This probe submits a rendered frame per simulation tick; it verifies effects and marks together, rather than measuring real-time gameplay FPS.

Smoke was also investigated in a CPU-fired WebGPU scene. Dense smoke can be GPU-expensive, but experimental lower-resolution and adaptive-sampling variants were discarded because their normal-view improvements were inconsistent. This change leaves smoke shaders, resolution, effect recipes and visual quality intact.

## Verification and repeat

- 239 tests pass (`bun run test --timeout 30000`), including dense indexed/non-indexed mesh intersection equivalence under rotation and nonuniform scale, surface-conforming marks, mount articulation, shared budget use in the real frame loop, queue retention/limits and reset.
- `bun run build` passes, including the current ship/aircraft checks, TypeScript and Vite.
- Run `bun scripts/diagnostics/firing-cpu-performance.ts` for the fixed CPU reproduction.
- Open `/scripts/diagnostics/firing-performance.html` on the development server, wait for Ready, then call `await review.advance(15)` to prepare a fired scene, followed by `await review.advance(15, true)` to render every simulation tick with fleet firing, effects, wake foam and budgeted impact marks. `await review.measure()` alternates effect visibility on the frozen fired scene. Keep the page visible; GPU timings remain sensitive to other workloads. The regular RAF loop is stopped between probes. Close the page afterward.

The 2 ms allowance spreads new scars across subsequent frames during large salvos. It does not delay authoritative damage or the immediate hit cues. Model complexity, volumetric smoke and ocean shading remain independent frame costs.
