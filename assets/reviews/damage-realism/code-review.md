# Combat code review — 2026-09-05

Reviewed the recent AP/HE, damage-control and stability implementation through `35e6f85`, including its flooding, machinery, projectile and battle integration. Fixed eight reproducible failures. The first eight regression cases failed before the fixes; twelve new cases now cover the failures and related invariants.

| Finding | Reproduction and correction |
| --- | --- |
| Inspection changed simulation state | Asking for a water level after the first inflow replaced the hydrostatic cache. Inspection now reads a volume/height curve without changing the actor. Repeated inspection reads and restored caches produce identical flooding replays. |
| Pressure extrapolated across changing compartment widths | A narrow sump below a broad space used one area derivative for every later water volume. A drained room could retain a fictitious water level. Queries now invert the complete sampled fill curve, including empty and full endpoints. |
| Empty compound rooms included nonexistent volume | At 45° heel, an empty two-cell space used its bounding-box corner at −7.07 m instead of its actual sampled cells. Empty and wet rooms now use the same cell layout. |
| Portal flow passed equal pressure | Two connected sumps holding 3 and 1 m³ transferred all 3 m³ to the receiving room in one tick. Transfer now stops at 2 and 2 m³, using the same pressure queries as exterior openings. |
| Idle teams stole ongoing work | An idle team claimed another team's repair and replaced its remaining 1 second of setup with a fresh 6 seconds. Valid assignments are reserved before dispatch; new emergencies can still preempt less urgent jobs. |
| Setup completion granted a full tick of work | A 6.5-second update with 6 seconds of setup repaired 2.6 HP instead of 0.2 HP. Repairs, patches, portable pumps and suppression now use only the time remaining after setup. |
| The last fire tick exceeded its fuel | A fire with 0.001 seconds of fuel inflicted a full second of damage. Average exposure now limits damage, heat spread and magazine heating to the available fuel. |
| HE selection disabled AP-only guns | A battery-wide HE order selected an unsupported round on AP-only mounts, making their available stock zero. Those mounts now retain AP and avoid an unnecessary reload. |

The water solver separates sampled geometry, the fill curve and the current water body. Derived caches are weakly held and rebuildable from serializable state. Upright layouts are reused across hydrostatic updates. Crew assignment is isolated from job execution so scheduling and elapsed work can be verified separately.

## Validation

- `bun run test`: **210 passed, 0 failed**, including the twelve added regressions and the existing four-preset stability, machinery, projectile, replay, inspection and articulation checks.
- `bun run build`: passed all four ship asset checks, TypeScript and the production build. Vite still reports the existing large application chunk warning.
- No blueprint, calibration, Blender recipe or model output changed. This pass did not include a new browser playtest.
- Fleet timing is recorded below using `code-review-benchmark.ts`. It prints fresh evidence without overwriting accepted milestone reports.

## Fleet timing

The same benchmark was bundled against the five changed simulation modules from `35e6f85`, then against the current sources. All other sources and ship definitions were identical. Separate processes ran in before/after/after/before order after the test and build processes finished.

| Run | Mean tick (ms) | p95 (ms) | p99 (ms) | Worst tick (ms) |
| --- | ---: | ---: | ---: | ---: |
| Before 1 | 1.946 | 2.808 | 3.641 | 47.130 |
| After 1 | 1.905 | 2.836 | 3.714 | 46.004 |
| After 2 | 1.919 | 2.845 | 3.628 | 55.845 |
| Before 2 | 1.979 | 3.021 | 3.917 | 49.649 |

The paired runs show comparable CPU cost; the small mean difference is not a general speedup claim. Individual spikes exceed a 60 Hz frame budget in both versions. This seeded 70-second battle remained mostly dry, so it does not establish worst-case flooding performance or browser frame rate. Renderer time is excluded. Initial unpaired timings varied more; an instrumented run identified gun aiming as the largest sampled subsystem, while water-body construction was a small part of this fixture.

## Limits retained

The free surface remains a sampled-column approximation. Orientation and water centroids refresh at 2 Hz; motion and water volume advance at 60 Hz. This work corrects state ownership and volume/pressure bookkeeping, rather than establishing historical stability, crew performance or armor calibration. Trapped air, detailed downflooding, crew routing and structural fracture remain outside the model.
