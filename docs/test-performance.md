# Test runtime measurement

## Running the suite

`bun run test` prepares multiplayer content/WASM and discovers every test under
`src/` and `scripts/`. It uses up to 16 workers, bounded by available CPU
parallelism, with Bun's smaller-heap mode for each worker. Expensive files start
first. The runner also supports splitting independent scenarios with disjoint
name filters and a complementary group, so new and renamed tests still run.
Scheduling hints do not control discovery.

Files remain isolated. Both output streams are drained while each worker runs,
failures propagate to the command exit status, and interruption terminates child
processes. Native options still delegate to Bun's runner, including filtering,
watch mode and coverage. `bun run test:serial` uses the same preparation and test
roots. Every invocation executes the tests; there is no persistent result cache.

Construction's browser helpers run separately with `bun run ship:browser:check`
(or append `--headless` for CI). This command automates repository editing,
IndexedDB, design deletion and shipbuilder editing in isolated browser contexts.
It is not discovered by the test/spec filename glob above.

## September 2026 follow-up

The runner's weights now reflect the warm suite at `3eba5acfe`: game lifecycle,
native construction authoring, equipment publication, and construction geometry
checks start early instead of inheriting a one-second estimate. Discovery,
file isolation, worker count, heap mode, assertions, and failure handling stay
the same. The machinery-services optimization returns zero before evaluating
shared exhaust when no eligible engine supplies the requested room. It retains
the original arithmetic for supplied rooms and whole-ship queries. A test-local
counter verifies that empty/unknown rooms, engine-free ships and sunk ships
skip the expensive calculation; the existing damaged/flooded-state differential
assertions are retained.

Carrier wing recovery now has one test per carrier, both calling the original
scenario and every original assertion. Rust's test threads can overlap the two
independent aviation states; the simulation horizon and success conditions are
unchanged.

Measured against `3eba5acfe` on September 21, 2026 (Apple M5 Pro, 18 logical
CPUs, Bun 1.3.3). Rust numbers below are execution time reported by the test
binaries, excluding compilation. The shared host had other workloads; these
are local measurements rather than performance guarantees.

| Rust workload (`test-fast`) | Before | After |
| --- | ---: | ---: |
| Simulation unit tests, dominated by service equivalence | 73.17 s | 32.75 s |
| Carrier deck operations | 73.77 s | 43.62 s |
| Whole workspace, sum of binary execution times | 208.19 s | 137.45 s |

The scheduling-only comparison alternated the original and updated runners
in before/after/after/before order against the same updated simulation and warm
assets. These times exclude content/WASM preparation:

| Pair | Original scheduling | Updated scheduling |
| --- | ---: | ---: |
| 1 | 19.24 s | 18.29 s |
| 2 (reverse order) | 19.77 s | 20.19 s |
| Median | 19.51 s | 19.24 s |

The small difference is within observed variation; the earlier exploratory
24-to-18.5-second result was not reproduced as a dependable scheduling gain.
Every run executes the same multiset of 1,661 test names and results: 1,656 pass
and five fail. The updated hints reflect the expensive files without changing
coverage or asserting a repeatable TypeScript speedup.

The full workspace passes 572 tests with five ignored. The count grew by two:
one exhaust-evaluation regression and one extra test entry from splitting the
existing two-carrier scenario. The changed Rust files pass formatting checks.
Final authority-state dumps are byte-identical before/after in the native
profiling harness: 120 simulated seconds each for surface/carrier PvE, 60 each
for custom/server battles, plus a 60-second Valiant-versus-Valiant constructed
ship battle. The existing unit comparison additionally exercises flooded and
damaged machinery in both shared and legacy exhaust configurations.

`bun run check` passes the source typecheck and runs all 254 TypeScript test
files. The suite retains four failures in its known-red ledger and the existing
line-width failure in `AfterActionReport.css:17` and `AfterActionReport.tsx:145`;
this change does not alter that ledger or those files.

## Fixture scope reduction

The next pass reduces two fixtures without deleting test cases:

- Equipment catalog retention publishes four real parts (a gun, a path fitting
  and two fixed magazines), then removes one. It still checks unchanged model
  URLs and exact historical catalog bytes. The separate full-production-catalog
  validation remains. The runner's publication weight is updated accordingly.
- Machinery equivalence compiles a box hull with separate rooms, two differently
  rated engines, two shafts, linked funnels and an armed mount with a magazine.
  It retains both exhaust configurations, all five damage/flooding/sinking states,
  room/global/unknown queries, bitwise health comparisons and whole-actor
  capability comparisons. Assertions verify that damaged, destroyed and flooded
  equipment states are reached. A separate published-Valiant smoke test retains
  dry and wet/damaged comparisons against the scan implementation. Empty-room,
  engine-free and sunk exhaust-skip regression coverage remains unchanged.

Isolated before/after runs on the same host, following the preceding optimizations:

| Workload | Before | After |
| --- | ---: | ---: |
| Equipment publication file (8 tests) | 6.71 s | 1.92 s |
| Catalog retention test within that file | 4.82 s | 0.13 s |
| Machinery services unit group (2 → 3 tests, excluding compilation) | 32.11 s | 7.19 s |

These measure the affected workloads, not an equivalent reduction in parallel
whole-suite wall time. Runtime simulation code and published assets are unchanged
by this fixture pass.

Validation: all 199 simulation unit tests pass, as do both applicable TypeScript
typechecks and the publication file's eight tests. `bun run check` executes all
254 TypeScript files and retains the same four ledger failures plus the existing
after-action-report line-width failure. Formatting and whitespace checks pass.

## Presentation, geometry and carrier follow-up

The next pass addresses four remaining sources of work:

- `Game.test.ts` captures initial port/battle frames from the real WASM authority
  once, then gives presentation-only tests independent copies through the real
  `SnapshotSession`. A fixture-isolation regression checks mutations do not leak.
  These sessions reject simulation stepping and authority commands; loading,
  helm-transfer and gameplay integration cases still create fresh WASM sessions.
- Primitive geometry checks compile all 30 recipes once. Four representative
  asymmetric solid, curved, hollow and panel recipes retain all quarter turns,
  reducing that matrix from 120 native compilations to 42. Every recipe keeps
  the exhaustive inexpensive mirroring checks; hull-preset, placement and edited
  vertex checks remain.
- Sampling full-wing carrier recovery found repeated polygon checks against
  distant deck structures. A conservative bounding-box rejection now skips those
  scans, keeping the original predicate for overlapping or nearly touching
  bounds. The regression compares concave/rectangular, rotated and touching
  cases against the original predicate and verifies distant pairs skip the scan.
  No route samples, search budgets, aircraft counts or recovery deadlines change.
- Retired TypeScript AA, gunnery calibration and damage-log tests are removed
  with their unused implementations and the obsolete equipment-rollout diagnostic.
  The two octuple tests that stepped the retired AA implementation are removed;
  its shared muzzle geometry and exported-model checks remain. Runtime Rust AA
  and scoring are untouched. Twelve obsolete tests are removed in total.

In isolated file runs, Game tests decreased from 12.74 s to 9.12 s and primitive
geometry from 7.86 s to 5.10 s. The later fixture-isolation assertion adds one Game
test. Runner weights reflect the reduced work. These are local workload timings,
not a whole-suite speedup claim.

Temporary instrumentation hashed every serialized wing state during full recovery.
Before/after traces are identical over 15,903 Enterprise steps and 22,087 Shokaku
steps, including the completion tick. The instrumented pair fell from 48.31 s to
25.74 s; the full uninstrumented deck-operations binary fell from 44.46 s to
33.85 s. Instrumentation and profiling output remain only in ignored `.build/`.

The source-width check also skips tracked files deleted from the working tree,
so retiring code does not turn an unstaged deletion into an unrelated read error.

The full Rust workspace passes 574 tests with five ignored. Final authority states
are byte-identical in all four native gate scenarios (surface/carrier: 7,200 ticks;
custom/server: 3,600 ticks), in addition to the complete wing-recovery traces.
The gate is a correctness comparison; its short-run timings vary with host load
and do not establish a general battle-runtime speedup.

Final `bun run check`: both applicable typechecks pass; all 251 remaining test
files execute, with the same four ledger failures and the pre-existing report
line-width failure. The parallel test phase took 33 s on this run, so the isolated
workload improvements above are not presented as a measured whole-suite gain.
Changed Rust files pass formatting checks, and `git diff --check` is clean.

## September 9 measurements

Measured September 9, 2026 on an Apple M5 Pro Mac with 18 logical CPUs, Bun 1.3.3,
and dependencies installed with `bun install --frozen-lockfile`. Wall times include
multiplayer preparation, process startup, and captured stdout/stderr:

```sh
/usr/bin/time -p bun run test > .build/test-performance/test.log 2>&1
```

The baseline is master at `7832be3f`, including its PvE and carrier changes, using
its original eight-worker runner and simulation. It passes 1,138 tests in 165
files without fixture repairs. The updated branch passes 1,143 tests in 168 files:
six regression tests were added, one duplicate was removed, and five timing tests
were replaced or refocused. A comparison of executed test names confirmed these
were the only additions/removals/renames.

Both versions used the same installed dependencies, generated WASM/content and
published assets. Preparation ran from the working checkout before each runner;
its warm build was included on both sides. Before/after runs alternated, with no
other validation work launched by this task concurrently.

| Pair | Before | After | Speedup | Result |
| --- | ---: | ---: | ---: | --- |
| 1 | 83.31 s | 51.57 s | 1.62× | Both passed |
| 2 | 58.90 s | 19.75 s | 2.98× | Both passed |
| 3 | 35.86 s | 28.69 s | 1.25× | Both passed |
| Median | 58.90 s | 28.69 s | 2.05× | Zero failures |

The requested **3× whole-suite speedup has not been reached**. Median user CPU
time decreased from 362.54 to 182.45 seconds (1.99×). The shared host was under
substantial external load, and wall times varied widely. These are local
observations, not a guarantee for other machines. Failed baselines, cold
installation/WASM builds and isolated microbenchmarks are excluded.

Before coverage consolidation and master integration, the earlier suite measured
36.06 → 16.64 seconds (2.17× medians) against `201f7da3`. That comparison included
five fixture repairs on both sides and a flotation regression. Its different
source, content and test inventory make it unsuitable as the final PR benchmark.

## Coverage consolidation

- Replace repeated FPS runs in combat, AI, collision, diving and damage-control
  tests with one focused `advance()` contract test and the retained 40-second
  bot battle replay at 30, 60 and 144 FPS. The contract covers fractional time,
  invalid deltas, bounded stalls, input callback ordering and reset. Keep each
  subsystem's behavior and reset assertions in a single simulation.
- Remove the short shell-view/death camera test; the retained complete
  binoculars → shell follow → death → return scenario checks both optics
  restoration and re-entry prevention through the real game controls.
- Replace the 256-seed kill-counter sweep with explicit hit (96) and miss (0)
  cases, asserting shots, ammunition, HP, kill attribution and friendly safety.
  The separate 1,024-seed accuracy-distribution test remains.
- Reuse the first seed-11 attack result when checking variation and replay, so
  each squadron flies two reproducibility runs instead of three.

## Runtime and fixture optimizations

- Model geometry fixtures retain the GLB binary chunk instead of converting it
  through base64 and fetch. Frame tests load the exported joint hierarchy once
  per model and receive independent scene clones. Geometry tests continue to
  inspect full mesh data.
- Vertex-attribute checks scan the original mesh once for the same sampled
  output tuples, instead of allocating string signatures for every vertex.
- Mount-coverage tests wait for an actual validated shot from every registered
  AA mount. Aircraft and bot tests stop waiting once their required flight,
  payload, hit or firing condition has occurred, retaining failure deadlines.
  Explicit endurance, recovery and sustained-combat scenarios keep their full
  simulation horizons.
- The retained TypeScript simulation reuses immutable geometry and topology,
  reduces transient vectors and aircraft pose allocations, and avoids flood,
  machinery and collision work when live state proves it cannot affect results.
  Zero-amplitude seas retain turning heel without computing zero-valued samples.
- Flotation uses safeguarded guesses on the original bisection grid, projects
  vertices once per orientation, and computes full moments at the final
  immersion. Trial volumes preserve the original arithmetic order. Floodwater
  geometry reuses column topology and searches conservative dry-room bounds;
  each returned water body retains its own immutable fill curve.

## Validation

The integrated branch passes the complete default suite and build, including
ship/aircraft freshness checks, TypeScript and Vite. The changed test files also
pass together in serial mode. Before consolidation and master integration, the
complete 1,067-test suite passed serially. Generated model assets, the runtime
roster, dependencies and the Rust/WASM implementation are unchanged by this PR.

Durable regressions compare flotation exactly against the original 27-step
bisection across fleet hulls, orientations and immersion levels; check ordered
hull contacts and distinct geometric inputs; ensure later water queries cannot
mutate retained or restored curves; and verify test-filter partitioning and
invalid concurrency. Temporary runner fixtures also verified assertion and
module-load failure propagation.

Additional differential checks against master passed for fleet hull rays, dry
and wet compartment bodies, retained/restored fill curves, and complete damaged
battleship, carrier and submarine simulations through 1,800 fixed ticks, including
projectiles, aircraft and events. Temporary profiles, comparison snapshots and
logs remain in ignored `.build/test-performance/`.
