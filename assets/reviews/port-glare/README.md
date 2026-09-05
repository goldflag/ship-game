# Port sun glare correction

The port's forward sun haze washed out the sun-facing sky and its water reflections. Reducing only `mieScatteringStrength` from 1.2 to 0.25 restored cloud contrast and water color. Exposure stays at 1, sun intensity at 5, and the sea's Mie strength at 0.5.

| View | Before | After |
| --- | --- | --- |
| Toward the sun | [Before](sunward-before.png) | [After](sunward-after.png) |
| Default port orbit | [Before](default-before.png) | [After](default-after.png) |

Captured September 5, 2026 in Orca's embedded browser using `/scripts/diagnostics/harbor.html` and the actual `Game` frame loop. Baseline revision: `94e0facaf44b1762bd7c40cd426a5e1cf1e9ac27`. Bismarck, WebGPU, High quality, Atlantic sea, 1600 × 900 canvas, one rendered pixel per image pixel, ACES tone mapping. These PNGs are unedited canvas captures without the diagnostic overlay or game instruments.

The game was paused after initialization. All four captures share the same frozen animation time; only the Mie strength and camera view changed. Each capture waited for 24 complete frames for sky and reflection updates, then captured at the end of a complete Game frame. Temporal rendering can still vary slightly between captures.

The sun-facing orbit uses azimuth -2.129301687433082 rad, elevation 0.08 rad and distance 325 m. The default port orbit uses azimuth 1.08 rad, elevation 0.23 rad and distance 325 m. The ship is at x=240 m. Camera transforms were snapped after setting each orbit. The sun stays at elevation 36° and azimuth 58°; the low port camera faces its azimuth with the sun above the frame.

To repeat: load the diagnostic, wait for `window.ready`, call `game.setPaused(true)`, set `view(azimuth, elevation, distance)`, and snap with `game.rig.update(game.playerView.motion, game.playerView.motion.y, 0, true)`. Change `game.sky.atmosphere.mieScatteringStrength.value` between 1.2 and 0.25, allow the sky/reflections to settle, then await `captureHarbor()`. Set the scene host to 1600 × 900 and the renderer pixel ratio to 1 after resizing for matching image dimensions.

This is artistic tuning, not a calibrated atmosphere. The fixed-camera renderer comparison covers the reported visual failure; a unit assertion of the parameter alone would not verify glare or visibility.

Validation: `bun test` passed all 101 tests; `bun run build` passed asset checks for all four presets, type checking and the production bundle. Reloading the saved source in WebGPU confirmed port → sea → port Mie strengths of 0.25 → 0.5 → 0.25 with no diagnostic errors, followed by another sun-facing visual check.

## Camera sky access

The follow-up camera change allows continued upward input to reveal the sun disk. Port and inspection keep the previous minimum orbit elevation (0.08 rad) for camera position, then tilt the viewing direction upward. Upward tilt is limited to 30° in every mode, reduced from the initial 1.35 rad (77°) after review. Every mode enforces a 12 m camera floor above sea level; port also retains 12 m clearance above terrain. Both the intended orbit position and the smoothed camera position are constrained, so interpolation and sinking cannot pull the camera below the floor.

The [port sun](camera-port-sun.png) and [sailing sun](camera-sea-sun.png) are unedited 1705 × 1359 canvas captures from the same diagnostic in WebGPU, High quality, Atlantic sea. The paused port camera uses azimuth -2.129301687433082 rad, elevation control -0.67 rad and distance 325 m, with camera y=40.972 m. The paused sailing camera faces the sun's azimuth and elevation directly, with camera y=121.6 m. The sun disk is visible in both; no sky or sunlight parameters changed for this follow-up.

Validation: all 111 tests and `bun run build` passed. The new input-driven camera tests failed before the change, then passed for sun visibility, returning to the normal orbit, mouse aiming, binocular aim preservation, and clearance through extreme input, zoom, narrow/wide aspect ratios and sinking across all six camera modes.
