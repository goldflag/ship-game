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

Relevant tests and TypeScript checks pass. The full build gate currently stops at
the pre-existing `tbd-1-devastator` stale retained export report; ship checks pass.
Production rendering was measured using `vite build` separately, without bypassing
or modifying the asset validator.

Forced WebGL on this machine fails during harbor warmup with shader validation
errors and device loss in both the baseline and changed versions. WebGL could not
be visually validated; the measurements above apply to WebGPU.
