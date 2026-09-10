# Test runtime measurement

## Running the suite

`bun run test` prepares multiplayer content/WASM and discovers every test under
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

## Current measurements

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
