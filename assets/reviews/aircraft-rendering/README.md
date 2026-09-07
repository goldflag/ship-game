# Aircraft instance growth regression

Verified September 7, 2026 with Three.js 0.185.0 through Orca's embedded browser.

Aircraft batches changed `InstancedMesh.count` as aircraft launched, disappeared or switched LOD. Three's instancing shader sizes its matrix array from that count on the first draw, and retains the compiled shader as the count grows. A flight growing from one Devastator to six rendered **one airframe and six payloads**, even though the CPU reported six aircraft. Distant contact silhouettes had the same changing-capacity problem.

Airframes now retain their allocated shader capacity. Each batch has an `InstancedBufferGeometry` shell sharing the original vertex buffers, with an independent live `instanceCount`. This draws only active airframes and avoids recompilation as flights grow. Contact silhouettes keep their existing fixed pool capacity and clear unused matrices through `ExpandableInstances.publish`.

## Validation

- [GPU pixel checks](gpu.json): 72 flight snapshots per backend, both WebGPU and WebGL2. All three combat aircraft, all three LODs, return to the near LOD, and population changes `0 → 1 → 6 → 2 → 0 → 9`. Airframe, payload and contact pixels are measured independently, so payloads or contact markers cannot conceal missing models. Triangle counts verify that unused airframes are not submitted. Very distant payloads can fall below one pixel; payload count assertions apply to the near view.
- [In-game capture](in-game.png) and [counts](in-game.json): the actual Game/sky/ocean pipeline, paused fixture growing from three aircraft (one per model) to eighteen. All eighteen airframes are visible. The capture is from the game canvas at 1800 × 1200, with 4× camera zoom.
- AircraftView and ExpandableInstances tests: seven passed, 396 assertions. Coverage includes growing into additional GPU batches, shrinking, LOD changes, contacts, payloads and articulation.
- `bun run build`: passed, including ship/aircraft asset checks and TypeScript. No model assets or simulation rules changed.
- Full suite: 114 files; failures in `AirOperations.test.tsx` (one map-projection test) and `GameFrame.test.ts` (22 tests using a sky mock without `timeOfDay.skyDarkness`). All 23 failures were reproduced against the unmodified base commit. These are separate existing failures.

[Validation record](validation.json) retains the base commit and hashes of the runtime changes, browser regression and loaded aircraft GLBs. This is rendering evidence, not historical model certification.

Run the development server, open an application page, then run in its browser console:

```js
const { checkAircraftRendering } = await import('/scripts/tests/aircraft-rendering-browser.ts');
await checkAircraftRendering();     // WebGPU
await checkAircraftRendering(true); // WebGL2
```
