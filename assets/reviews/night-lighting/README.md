# Night and sunrise lighting review

Reviewed September 7, 2026 in Orca's embedded Chromium using the real WebGPU
`Game.frame` pipeline, High quality, a 1600 × 900 canvas and fixed camera/ocean.
[review.json](review.json) records the base commit and exact reviewed source hashes.
No ship models or CPU combat rules changed.

## What caused the poor rendering

- The time slider changed solar elevation but retained daytime fog colors.
- The moon override reached the ship's directional light but left the water
  shader with a below-horizon sun and zero intensity. Paused frames could keep
  the previous port/day light entirely.
- Cloud ambient was dimmed a second time at dawn. At night its diffuse baker,
  aerial haze and far-distance blend omitted the moon, fading distant clouds to
  black against the sky. Night opacity was increased without matching the
  premultiplied RGB, amplifying the black edges.
- Custom water pigment and foam retained their daytime radiance. The low sun
  lit hulls with strong, nearly white light even at the horizon.

The fixes synchronize scene/water/effect lighting, retain lunar diffuse fill in
clouds and haze, preserve premultiplied color, and use time-dependent fog, water
and fill settings. The [ocean guide](../../../docs/ocean-configuration.md#night-and-sunrise-lighting)
records the artistic settings; the [vendor patch record](../../../vendor/threejs-sky-pro/PATCHES.md)
explains the changes that must survive a library upgrade.

## Captures

| View | Before | After |
| --- | --- | --- |
| Midnight, wide camera | [Original](night-wide-before.png) | [Corrected](night-wide-after.png) |
| Sunrise, 06:00 | [Original](dawn-before.png) | [Corrected](dawn-after.png) |
| Midnight, closer camera | — | [Corrected](night-after.png) |
| Morning, 07:00 | — | [Corrected](morning-after.png) |
| Noon | — | [Daylight check](noon-after.png) |
| Midnight, overcast | — | [Cloud/horizon check](night-overcast-after.png) |
| Return to port | — | [Restoration check](port-after.png) |

The two comparison pairs use matching camera poses. Wide: position (550, 200,
700), target (−650, 75, −1000). Closer: position (300, 95, 350), target (0, 20, 0).
FOV 60°. Before captures explicitly synchronized the old water lighting once
to separate the night shader defect from stale paused lighting. Time remained
paused; both use the same map palette, ocean seed and 40% cloud coverage.

Final views retain dark seas and readable hulls; the opaque black cloud blocks
and overcast horizon band are gone. [Pixel checks](pixel-checks.json) measure
the top 35% of each canvas: midnight's mean display RGB changes from (8.76,
9.75, 12.66) to (34.05, 42.06, 57.10), and pixels with all channels below 6 drop
from 0.92% to zero. The dawn sky remains close to its original brightness;
the corrections primarily affect the hull, sea and cloud-edge contrast.

## Validation and replay

Run `bun run dev`, open `/scripts/diagnostics/night-lighting.html`, and wait for
`window.ready`. `await reviewLighting(hours, options)` renders a fixed view and
returns its checks; `captureLighting()` returns the actual GPU canvas PNG.
Options include `weather`, `cloudCover`, `wide` and `port`.

- All seven captured configurations pass [live uniform checks](runtime.json).
  Night has nonzero lunar cloud fill and identical scene/water direct intensity.
- [Restoration checks](runtime-restoration.json) verify the water's provider-sync
  callback, live lunar ambient changes, no cumulative fill, and restoration.
- Both added regression tests failed on the original implementation and pass
  after the fix. Tests also cover all map/time/weather combinations, palette
  restoration after repeated night/day changes, and frozen scene lighting.
- Relevant game, battle, combat and sea tests: 63 exercised. On the final run,
  60 passed and three simulation tests exceeded Bun's five-second limit while
  GPU capture/build work ran. All three passed when rerun separately with
  `--timeout 30000` (2.21, 3.02 and 1.84 seconds); no assertions were changed.
- `bun run build` passed, including all ship/aircraft freshness checks,
  TypeScript and production bundling. Vite retains its existing large-chunk warning.
- Browser console review contained Vite connection messages only; no renderer
  errors were observed. `git diff --check` passed. The design detector reported
  only the existing red/green buoy colors, outside this rendering change.

These are gameplay lighting settings. Cloud march resolution and quality budgets
remain unchanged; this review does not claim astronomical calibration.
