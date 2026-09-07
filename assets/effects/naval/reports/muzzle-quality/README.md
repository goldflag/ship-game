# Cannon smoke quality and cost — 2026-09-07

Muzzle smoke starts as an elongated jet along the barrel, then opens into uneven rolling billows. Restrained fine erosion softens the previous granular surface. The lighting has a broad forward-scattering lobe and follows the live sun, weather, ambient fill and moon. A zero-delta sky update also refreshes smoke lighting while paused; the water's fixed-step lighting callback cannot do that reliably.

The fast, progressive density fade from PR #81 remains. At 2.5 seconds the overlapping 380 mm and 460 mm replays retain 6.1% and 8.3% of peak integrated screen opacity. All three caliber cases fall below the 8-bit readback threshold by 3.5 seconds, before storage expires. No 0.1-second drop after the initial blast exceeds 12% of peak. These are screen-opacity measurements, not physical smoke mass.

The shader intersects an oriented ellipsoid inside the existing billboard bound. Shadow taps reuse coarse octaves, reducing occupied-step texture fetches from five to four. Smoke uses 8–16 samples according to projected size and thinning, including binocular magnification; a fractional last step makes transitions continuous. The pool stays at 192 volumes and one draw, with eight vertex buffers. No textures, extra particle batches or simulation work were added.

## Review evidence

All pictures are lossless encodings of the actual Game renderer. The ship uses the latest Bismarck model from the PR #82 integration; this change does not modify ship assets. [Source/model hashes and validation](review.json) identify the reviewed inputs, and [frame metadata](frames.json) retains camera and lighting values.

- [Before at 1 second](before-1.webp) and [after at 1 second](after-1.webp), with identical camera, model and shot events.
- [Late wisps at 2.5 seconds](after-2.5.webp), [binocular view](binocular-1.webp), and [overcast](overcast-1.webp).
- [Cooled smoke at night](night-1.webp) and [night ignition](night-ignition.webp). Direct illumination is about 4.6% of the daylight value; ambient fill is 22%. Hot gas retains its own emission.
- [Firing-to-dissipation video](after.webm), 144 actual renderer frames at 30 fps with a half-second lead-in. [Capture metadata](after.capture.json) and [decoded seek check](video-check.json) are retained. Each encoded frame invalidates the scene-pass cache, so background-tab throttling cannot reuse an earlier scene.

Conditions previews explicitly synchronize the frozen sky and water lighting before capture. Normal gameplay continues to use its usual frame loop. The original [New Jersey reference frames](../../references/sources.json) guide the blast-to-billow transition; smoke scale and timing remain gameplay approximations.

## Performance

WebGPU on an Apple GPU / Metal 3, Medium quality, 1920 × 1080. The browser does not expose the GPU model. Each comparison alternates complete old/new recipes on the same renderer after eight warm-up pairs, then records 40 samples per revision. [Raw timings, p95 values, cameras and particle counts](performance.json) are retained.

| Frozen smoke scene | Before median GPU ms | After median GPU ms |
| --- | ---: | ---: |
| Close broadside | 1.049 | 0.918 |
| Binocular broadside | 0.852 | 0.393 |
| Inside plume | 4.456 | 2.949 |
| 64 overlapping guns | 6.029 | 3.604 |
| Late wisps | 0.852 | 0.786 |

Smoke medians improve by 8–54%. The full frozen Game frame is 34.93 → 34.08 ms median, with 247 draw calls and 1.2 ms median CPU submission for both revisions. Full-frame p95 was 42.66 → 45.81 ms in this run; tail timings vary, so the small whole-frame difference is not a reliable FPS claim. The stronger result is lower isolated smoke cost, including the saturated pool. This is one-device evidence, not a cross-hardware frame-rate guarantee.

## Validation and reproduction

50 relevant simulation, effects, wind, lighting and render-order tests pass, as does `bun run build`. [GPU volume checks](volume-checks.json) cover smoke and water with standard/reversed depth: outside, inside, opaque occlusion, distant transparent water, elevated/rotated ellipsoids, reset and reuse as spherical damage smoke. The [actual muzzle fade replay](fade.json) passes for 127, 380 and 460 mm guns. The real 5 km horizon check passes all 38 rows at 2.5 seconds.

Open `/scripts/diagnostics/combat-effects.html` in Orca and wait for `window.reviewReady`. The browser checks live in `/scripts/tests/combat-effects-browser.ts`. Use `compareSmokeRevisions` and `compareSmokeGameFrames` from `/scripts/diagnostics/smoke-performance.ts` with a retained baseline `CombatEffects` constructor. The baseline must retain its own `EffectParticles` and `EffectVolume` modules because its instance attribute layout differs. The baseline source commit and hashes are in `review.json`; imports outside those three files can point to the current `/src/` tree.
