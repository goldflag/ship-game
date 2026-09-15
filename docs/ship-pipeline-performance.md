# Ship pipeline performance

See [build details](ship-build-reference.md#incremental-builds-and-fingerprints) for rebuild triggers.
The runtime roster in `src/ships/presets.ts` supplies every fleet command.

## What changed

- Stage identities use compiled definition data and explicit/transitive recipe dependencies. Python comments, UI and TypeScript-only schema edits no longer invalidate models.
- Geometry, exported model and thumbnail reuse require matching stage inputs and actual SHA-256-verified output bytes. Deleting staging restores retained products; missing or corrupt retained products rebuild their own stage. Validation still runs on cache hits.
- Export collection membership is computed once. Ordinary meshes concatenate vertex, polygon, edge, material and UV buffers. Warped polygons, custom normals, vertex colors, object-linked materials and reflected transforms retain Blender's native join. Names are assigned in original bucket order.
- Convoy primitives use the same Blender BMesh operators without repeatedly updating the entire scene. Iowa deletes grouped objects in batches. Equipment attachment evaluates authored parent frames without updating the dependency graph for every fitting.
- Fleet work uses a bounded queue. Each Blender process remains isolated; no long-lived shared scene or persistent texture/component cache was introduced.

## Measurement protocol

Measured on Apple M5 Pro, 18 logical CPUs, 48 GiB RAM, macOS 26.6.2 arm64,
Blender 5.2.0 LTS and Bun 1.2.18. Measurements include compilation/fingerprinting,
source generation and saving, export preparation, texture work, serialization,
model validation, publication and thumbnails. Five fixed review views are a
separate command, outside the ordinary fleet rebuild.

The original pipeline took **1,303.54 seconds (21m43.54s)** with two concurrent
ships. Every original geometry/export/thumbnail stage ran with Python profiling.
Other work on the machine overlapped part of that baseline, so the ratio is not
a controlled CPU-only speedup. The baseline has no incremental stage reuse:
requesting another build executes its model stages again.

Final measurements are recorded below. `--force` bypasses every ship stage cache,
including retained source/model/thumbnail reuse. These are warm filesystem runs,
not cold-boot benchmarks. Shared texture generation runs inside fresh geometry
processes; no generated texture cache is reused across ships.

| Run | Seconds | Jobs | Executed work |
| --- | ---: | ---: | --- |
| Original full rebuild, profiled | 1303.54 | 2 | All geometry, export, validation and thumbnails |
| Final full rebuild, unprofiled | **59.76** | 18 | All geometry, export, validation and thumbnails; forced, no stage reuse |
| No-op fleet | **0.80** | 18 | Fingerprints, byte checks and validation; all model stages reused |
| Forced Admiral Hipper | **17.74** | 1 | Geometry, export, validation and thumbnail |
| Shared convoy dependency edit | **8.36** | 18 | Four consumers rebuilt all model stages; other ships reused them |
| Restore the convoy dependency | 8.70 | 18 | The same consumers rebuilt against the restored source |
| Delete Admiral Hipper staging (earlier diagnostic) | 0.28 | 1 | Restore verified retained outputs and validate |

The shared-dependency probe added an executable constant to `convoy/geometry-v2.py`,
then restored the exact source bytes. Only Flower, Victory Cargo, Liberty Cargo
and Liberty Collier rebuilt. A runtime-only handling probe reused geometry and
thumbnail while actually re-exporting the updated definition identity.

The under-60-second goal was met **narrowly in one measured final run**, not as a
latency guarantee. Earlier runs of the corrected batching algorithms took 68.88s
unprofiled and 75.36s with profiling (before the final name-order correction).
Machine load and scheduling materially affect this margin. Iowa remains the
critical path: 55.20s geometry/appearance, 1.63s export, 0.09s validation and
2.27s thumbnail, 59.68s total. Further headroom needs faster original geometry
generation, especially Iowa, rather than another glTF serializer change.

### Stage evidence

Baseline aggregate process time was 1,445.03s geometry/appearance, 1,059.29s export
and 53.19s thumbnails; overlapping process durations are not fleet wall time.
For Admiral Hipper, the old exporter spent 19.46s in collection membership scans;
its complete export process took 141.30s, while final glTF serialization took
under one second. Repeated Blender scene operations, not binary serialization,
were the primary problem.

Final full-run aggregate process time:

| Stage | Seconds across ships |
| --- | ---: |
| Geometry, appearance and source save (including startup) | 512.02 |
| Export process (including startup) | 148.89 |
| ↳ Scene load/import | 15.97 |
| ↳ Visibility/preparation | 15.93 |
| ↳ Mesh conversion | 7.80 |
| ↳ Mesh batching | 78.93 |
| ↳ Legacy export texture bake | 0.52 |
| ↳ Coordinate conversion | 0.23 |
| ↳ glTF serialization | 10.94 |
| Validation | 0.64 |
| Thumbnails (including startup) | 49.58 |

Startup alone summed to 24.42s geometry, 14.73s export and 13.35s thumbnails;
it is already included in those process totals. Process shutdown and wrapper
overhead explain the remaining export time. Most textures are generated during
geometry: the separate profiled diagnostic measured 98.19s in shared appearance,
decking, paint and UV functions across the fleet. Do not add that to geometry time.
The fixed review-render command took 82.64s at two jobs, outside `ship:build`.

Baseline and final GLBs passed rendering-data comparison for every runtime
preset, including stable node identities, metadata, materials and texture bytes.
Fixed views and baseline/final thumbnail pairs were inspected; small path-tracing
shading differences remain, with unchanged visible forms and metric textures.

## Reproduce

```sh
SHIP_JOBS=18 SHIP_TIMINGS_DIR=.build/bench/full bun run ship:build all --force
SHIP_JOBS=18 SHIP_TIMINGS_DIR=.build/bench/noop bun run ship:build all
SHIP_PROFILE=1 SHIP_JOBS=18 SHIP_TIMINGS_DIR=.build/bench/profile bun run ship:build all --force
bun run ship:check all
bun run build
bun test scripts/ships
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python scripts/ships/primitives.test.py
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python scripts/ships/batching.test.py
```

Use a different `SHIP_TIMINGS_DIR` for each run. Its fleet summary records hardware,
concurrency, force mode, failures and wall time. Per-ship records identify cached
versus executed stages, process startup, validation, and export substages.
`SHIP_PROFILE=1` adds Python profiles and shared texture-function timings (a subset
of geometry time, not additional time). Profiling changes runtime.

`compare-exports.py BEFORE.glb AFTER.glb` checks node identities, hierarchy,
articulation metadata, triangle surfaces, materials, embedded texture bytes,
metric UVs, normals and morph data independently of binary packing. It requires
NumPy, SciPy and Rtree; install these in a task-local virtual environment. Its
float tolerances are 0.1 mm positions, 0.003 normals and 0.00001 UV coordinates.
It does not replace fixed-view and in-game visual inspection. Keep its output and
all profiling evidence in ignored `.build/`, never in ship report directories.

A Blender/toolchain upgrade requires an explicit forced rebuild and review;
these source identities do not certify identical output across toolchain versions.

## Validation and integration

Integrated the completed vertex-editor changes through `a4f7b592`. Its schema-only
changes preserved every geometry/model identity: all source scenes and GLBs were
reused and validated. Conflicting thumbnail metadata was repaired by real renders.
Shared equipment was rebuilt through `part:publish`, and its retained models also
passed comparison against the original published component versions.

`ship:check all`, `part:published:check`, TypeScript checking and `bun run build`
passed. Pipeline/component regression tests: 32 passed. Both Blender primitive
and batching fixtures passed. Final tests used the repository-pinned Bun 1.3.3;
the machine's Bun 1.2.18 stalls on the existing corrupt-gzip test.

The full suite completed with 209 of 214 files passing. The five failing files
reproduce their failures against baseline sources: `simulation/sea.test.ts`
(intact Hipper settling), `simulation/mechanics.test.ts` (missing Hipper stability),
`game/ShipFunnelSmoke.test.ts` (missing Hipper count), `game/AirOperations.test.tsx`
(merged-flight notice) and `game/Game.test.ts` (saved construction fixture).
These unrelated simulation/UI fixtures were not changed by this work.

In-game acceptance ran in Chrome against the exact published fleet: five train
fractions per ship, with independent elevation/recoil and neighboring mount
overrides. All 95 pose cases passed; maximum gun muzzle alignment error was
2.76 mm and torpedo muzzle error was below 0.004 mm, inside the existing 25 mm
check. Inspected in-game views included Bismarck, Hipper, Iowa, Gleaves and Flower.
The Orca browser's repeated closed-target failures were bypassed with this
separate Chrome session; no unrelated Blender scene or editor work was changed.
