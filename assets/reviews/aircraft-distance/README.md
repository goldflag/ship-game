# Distant aircraft scale and contrast

September 7, 2026 follow-up to the aircraft instance growth fix in PR #89.

The visibility overlay used a fixed nine-pixel aircraft icon at up to 90% opacity, starting while the real model still spanned 48 pixels. At long range it became wider than the projected airframe. Its dark, camera-facing shape also covered the model's paint and orientation.

The contact is now a soft point capped at three logical pixels and 28% opacity. It appears only below 12 pixels of projected wingspan, shrinks below three pixels with the airframe, and leaves resolved models untouched. The soft texture retains a faint trace when thin geometry misses the pixel samples. The actual airframes, their LODs and instancing capacity are unchanged.

The [browser regression](../../../scripts/tests/aircraft-distance-browser.ts) independently renders the complete presentation and the lit airframe alone. It measures their pixel differences, maximum added opacity and width. It also requires a visible trace while the airframe spans at least two pixels. The original code failed both the unit bounds check and the GPU check for darkening a resolved airframe.

WebGPU results for the Wildcat at 512 × 512:

| Distance | Actual projected wingspan | Previous visible width | Revised visible width |
| --- | ---: | ---: | ---: |
| 150 m | 40.52 px | 40 px, overlay changes paint | 40 px, matches lit model exactly |
| 800 m | 7.60 px | 8 px | 2 px, faint contact |
| 1,600 m | 3.80 px | 8 px | 2 px, faint contact |
| 3,200 m | 1.90 px | 8 px | 2 px, maximum added alpha 9/255 |
| 6,400 m | 0.95 px | 8 px | Below pixel coverage in this view |

The two-pixel footprint at a 1.9-pixel wingspan straddles adjacent pixels; the billboard's continuous width remains within the wingspan. Aircraft can naturally fall below visible pixel coverage at very long range. At 3,200 m with 16× zoom, the revised presentation matches the resolved lit model exactly.

All 21 snapshots passed across Wildcat, Dauntless and Devastator, including six distances and binocular magnification. See [before](before.json), [after](after.json) and [validation hashes](validation.json). Seven AircraftView/ExpandableInstances tests passed (298 assertions with Bun 1.2.18), and `bun run build` passed, including asset checks and TypeScript. Additional WebGL2 checks could not complete because Orca's browser calls repeatedly returned `runtime_unavailable`; those are not reported as passed. The earlier PR's broader GPU evidence remains attributed to its original hashes.

[In-game before](in-game-before.png) and [after](in-game-after.png) show the same eighteen aircraft and camera: bottom row at 600 m, middle row at 1,800 m, top row at 5,400 m. All eighteen airframes remain instantiated; distant aircraft now shrink to subtle traces. The sky continues its visual cloud animation between captures.

Run the dev server and execute from an application page's browser console:

```js
const { checkAircraftDistanceRendering } = await import('/scripts/tests/aircraft-distance-browser.ts');
await checkAircraftDistanceRendering();
await checkAircraftDistanceRendering(true); // WebGL2 fallback
```

After rebasing onto master `ff1baadd` (including the AA effects update), AircraftView, AircraftGunfire, ExpandableInstances and antiAircraft simulation tests passed: 31 tests, 17,222 assertions. The build passed again. The contact implementation and distance-regression hashes still match the GPU captures above.
