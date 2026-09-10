# Test runtime measurement

## Running the suite

`bun run test` prepares the multiplayer content/WASM and discovers every test under
`src/` and `scripts/`. It uses up to 16 workers, bounded by available CPU
parallelism, with Bun's smaller-heap mode for each worker. Expensive files start
first. Several long independent scenarios run in separate processes; disjoint
name filters and a complementary group ensure every test still runs, including
new and renamed tests. Scheduling hints do not control discovery.

Files remain isolated. Both output streams are drained while each worker runs,
failures propagate to the command exit status, and interruption terminates child
processes. Native options still delegate to Bun's runner, including filtering,
watch mode and coverage. `bun run test:serial` uses the same preparation and test
roots. Every invocation executes the tests; there is no persistent result cache.

## Measurement method

Measured September 9, 2026 on an Apple M5 Pro Mac with 18 logical CPUs, Bun 1.3.3,
and dependencies installed with `bun install --frozen-lockfile`. Wall times include
multiplayer preparation, process startup, and captured stdout/stderr:

```sh
/usr/bin/time -p bun run test > .build/test-performance/test.log 2>&1
```

The comparison used source at `201f7da300e1dab391249d36fcb1ee24a8ac433b` with its
original eight-worker runner and simulation. Both versions used the same installed
dependencies, generated WASM/content and published assets. Preparation ran from
the working checkout before each runner; its warm build was included on both
sides. Before/after runs alternated, with no other validation work launched by
this task concurrently.

Five pre-existing failing test fixtures were corrected on both sides: the mock
renderer's backend, rounded HP displays, transform formatting, the documented
torpedo speed multiplier, and an explicit successful seed for a positive AA-hit
fixture. These corrections preserve the assertions' behavioral intent. The new
flotation reference regression was also included on both sides. The passing
baseline contains 1,062 tests in 148 files; the updated suite adds five more tests
and contains 1,067 tests in 150 files.

| Pair | Before | After | Speedup | Result |
| --- | ---: | ---: | ---: | --- |
| 1 | 35.27 s | 16.42 s | 2.15× | Both passed |
| 2 | 36.06 s | 16.64 s | 2.17× | Both passed |
| 3 | 38.34 s | 23.98 s | 1.60× | Both passed |
| Median | 36.06 s | 16.64 s | 2.17× | Zero failures |

The requested **3× whole-suite speedup has not been reached**. Median user CPU
time decreased from 246.47 to 162.14 seconds (1.52×); concurrency and scheduling
supply the rest of the observed wall-time improvement. All three updated runs
executed all 1,067 tests.

The shared host was under substantial external load and had roughly 50 GB of swap
allocated. Earlier intermediate paired runs measured 65.60 → 34.67 s,
41.39 → 17.52 s, and 45.71 → 20.16 s. Timings are local observations, not a guarantee
for other machines. Failed baselines, cold dependency/WASM builds, and isolated
microbenchmarks are excluded from the whole-suite speedup calculation.

## Changes and preserved coverage

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

The complete suite passes in both default and serial modes. The build passes,
including ship/aircraft freshness checks, TypeScript and Vite. Generated model
assets, the runtime roster, dependencies and the Rust/WASM implementation are
unchanged by these optimizations.

Durable regressions compare flotation exactly against the original 27-step
bisection across fleet hulls, orientations and immersion levels; check ordered
hull contacts and distinct geometric inputs; ensure later water queries cannot
mutate retained or restored curves; and verify test-filter partitioning and
invalid concurrency. Temporary runner fixtures also verified assertion and
module-load failure propagation.

Additional differential checks against the original implementation passed for
fleet hull rays, dry and wet compartment bodies, retained/restored fill curves,
and complete damaged battleship, carrier and submarine simulations through 1,800
fixed ticks, including projectiles, aircraft and events. Temporary profiles,
comparison snapshots and logs remain in ignored `.build/test-performance/`.
