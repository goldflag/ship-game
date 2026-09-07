# Torpedo trail correction

The wake plane used a clockwise rotation after flattening its local XY plane onto
the water. That reverses the required sign: a 45° torpedo produced a perpendicular
trail. Depth scaling shortened the plane without moving its center, also pulling
the leading end away from the torpedo. The stretched splash-ring texture appeared
as two long rails.

`CombatEffects` now aligns the wake's local +Y with the horizontal course and uses
the displayed length to keep its leading end at the round. Airborne, deeply
submerged and zero-distance rounds have no surface trail. A separate original
procedural texture gives the trail a filled, tapered foam center.

- [Before](before.png) / [after](after.png): same 45° fixture, camera, Fair sea and
  Medium quality in the actual WebGPU game renderer.
- [CPU launch](launch.png): Fletcher's trainable launcher fires one round at 45°
  starboard; captured five seconds later at 116 m travelled and 2 m running depth.
- [Runtime checks](runtime.json): pause, partial-depth visibility, airborne/deep
  suppression and return-to-port cleanup all passed.

Open `/scripts/diagnostics/torpedo-trail.html` through Vite to reproduce. The
development-only `trailFixture(headingDegrees, depthM, distanceM)` controls the
fixture, `launchTrail()` exercises the real launcher, and `captureTrail()` returns
a PNG from the renderer. The page holds the game clock for repeatable inspection.

Validation: the new regression failed on the original transform and passes after
the correction. It checks 24 headings, three depths, three run lengths, vertical
velocity, clearing/reset, immutable simulation inputs, and foam-center coverage.
`bun test src/simulation src/game` ran 494 tests: 492 passed; two unchanged Yamato
flooding tests exceeded Bun's default five-second timeout. Both passed individually
with `--timeout 20000` (4.2 s and 13.2 s). `bun run build` and typechecking passed;
Vite retained its existing large-chunk warning.

This is a visual correction. Combat, ship assets and torpedo performance are
unchanged. The wake remains a short horizontal surface effect; it does not model
a wave-conforming or persistent physical bubble field.
