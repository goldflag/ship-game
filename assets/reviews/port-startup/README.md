# Port startup rendering — 2026-09-07

The port used to signal ready after compiling the scene against the default target and submitting a single simplified render. Normal frames then introduced ship batch poses, ocean visibility changes, offscreen scenery and additional render-target variants after the player started dragging.

`Game.warmupRendering` now runs the actual frame path under the loading screen. It temporarily disables object frustum culling to include scenery behind the camera, covers twelve frames for periodic sky reflections and ping-pong targets, restores culling, renders the normal view and awaits a one-pixel final-target readback. Combat, audio updates and the normal animation loop remain inactive during preparation. Rendering failures reach the existing startup error/retry path.

## Observations

Installed headless Chrome with WebGPU, 1280 × 720, default High quality, Bismarck. Each run launches a fresh browser. The diagnostic starts a continuous synthetic pointer drag as soon as the garage appears and records browser animation-frame intervals for fifteen seconds, plus GPU pipeline creation calls. These intervals measure main-thread responsiveness, not GPU execution time or game FPS. Local machine load and driver caches can vary between runs; these are individual observations, not averaged benchmarks.

| Development run | Original | With warmup |
| --- | ---: | ---: |
| Garage appears | 21.23 s | 32.34 s |
| Longest animation-frame gap during first drag | 7,652.6 ms | 298.6 ms |
| Pipelines created after garage appears | 158 | 4 |
| Gaps over 100 ms after the first five seconds | 10 | 0 |

Raw measurements: [original](before.json), [with warmup](after.json).

The separate [production bundle check](production.json) opened the garage at 25.19 s. Its first-five-second animation-frame interval was 15.6 ms on average, 21.0 ms at the 95th percentile and 90.2 ms maximum. There were no gaps over 100 ms in the full fifteen-second drag and no browser exceptions. Four shadow-material pipelines were still created about three seconds into the orbit. This change moves setup into loading; it does not promise faster total startup or eliminate every possible first-use shader on other ships, settings or camera positions. The WebGL fallback was not browser-tested.

## Validation

- 37 targeted tests passed across startup lifecycle, game frames, fleet loading/batching and underwater visibility. Warmup coverage checks restored culling, GPU completion, disposal, error propagation, no combat advancement and no extra animation loop.
- TypeScript and direct Vite production bundling passed.
- `bun run build` stopped at existing stale comparison records for Bismarck, Yamato, King George V, Baltimore, Enterprise and Type VIIC. No authoring files, models or comparison hashes were changed for this fix.
- Inspected the rendered port capture; ship, harbor and ocean remain visible.

## Reproduce

Run the development server or a production preview. Set `PLAYWRIGHT_MODULE` to an installed `playwright-core/index.mjs` if the package is outside the repository, and `STARTUP_URL` to that server. Run `node scripts/diagnostics/measure-port-startup.mjs sample`. Raw measurements and a screenshot are written under `.build/port-startup/`.
