# Mac performance branch review on Windows

Reviewed `origin/goldflag/simulation-diagnostics-updates` at `5cfcb5fd`
against Windows master `f720a505` on 2026-09-07. Adopt the diagnostic
improvements; defer the additional runtime optimizations until a repeatable
benefit is demonstrated on the integrated code.

## Changes adopted

- Optional current runtime roster for CPU and browser fleet diagnostics. The
  historical fixture remains the default so earlier measurements can be replayed.
- Reset the seeded simulation after stopping ordinary startup frames, before
  advancing the browser diagnostic to its battle tick.
- Manual browser mode and access to the existing completed-frame measurement
  helper. The Run button exits manual mode through a fresh page load.
- Maximum tick time, budget-overrun counts, slow tick/frame records, and p99/max
  completed-frame statistics. The expanded CPU state hash also covers torpedoes,
  depth charges, aircraft, and air releases.

Existing Windows carrier options and live-frame instrumentation are retained.
The completed-frame helper waits for submitted GPU work; its measurements are
work duration, not displayed FPS. This review does not establish a browser FPS
improvement or change rendering quality.

## Runtime assessment

The Mac branch's anti-aircraft candidate indexing and immutable module lookups
overlap optimizations already in Windows master. Its reported 40–43% CPU gain
was measured before the latest integration and cannot be added to the Windows
gain. Its own browser evidence did not establish a live FPS improvement.

The evaluated complementary port contained:

- Volume-only flotation trials, cached vertex projections, and dry/wet
  shortcuts, retaining the existing 27 bisection iterations and final moments.
- Scalar ballistic fallback when the coefficient cache is full, retaining the
  Windows Newton solver.
- Per-ship reuse of target distance and inherited firing velocity.
- Existing module-ID lookups used directly by stability capability checks.

The exact evaluated production diff is retained in
[evaluated-runtime.patch](evaluated-runtime.patch), but is not applied to the
runtime. Apply it to `f720a505` in a separate checkout for another experiment.
The candidate hydrostatics, ballistics, and drag-arc tests passed: 11 tests and
54,164 assertions. The hydrostatics test checked every preset at six attitudes
and six displacement fractions. The ballistic reference assertion used
1e-7-second / 1e-9-direction tolerances to accommodate the existing Newton path.

## Windows CPU replay

Windows, Intel Core i7-12700K, Bun 1.3.14 and Node 24.19.0 (V8), no renderer.
Each run used 60 ships, split evenly between teams and cycling the current
runtime roster, seed `0x6e617661`, and a 5,000 m spawn distance. The player used
half throttle, no rudder, fixed aim, and no manual firing. After 120 warmup
ticks, 3,600 ticks were measured. Each final state had 104 active aircraft.

| Engine | Version | Mean tick ms | Median ms | p95 ms | p99 ms | Max ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Bun | Before | 16.507 | 8.772 | 29.436 | 177.706 | 889.904 |
| Bun | Candidate | 16.706 | 8.869 | 26.016 | 229.936 | 382.214 |
| Node/V8 | Before | 24.034 | 10.912 | 23.858 | 485.891 | 859.063 |
| Node/V8 | Candidate | 24.603 | 12.817 | 22.536 | 362.221 | 642.472 |

Neither engine showed a mean improvement; some tail timings improved. These
are single, serial before/candidate pairs on an ordinary Windows desktop, not
a statistical finding that the candidate is slower. Builds and tests were not
run alongside these samples. Node is a useful second JavaScript engine check,
but this renderer-free workload does not measure Chrome frame delivery.

The final SHA-256 state hashes match exactly within each engine. They cover
actors, shells, torpedoes, depth charges, aircraft, air releases, and events.
Cross-engine hashes differ, so comparisons must stay within the same engine.
Each JSON also records the four evaluated runtime source hashes.

- Bun: [before](windows-before.json), [candidate](windows-candidate.json).
- Node/V8: [before](v8-windows-before.json), [candidate](v8-windows-candidate.json).
- Exact replay source: [cpu-replay.ts](cpu-replay.ts).
- Node bundle generator used for this machine: [bundle-node-replays.ts](bundle-node-replays.ts).

The replay accepts a checkout root and output JSON path:

```powershell
bun assets/reviews/mac-performance-port/cpu-replay.ts <checkout-root> <output.json>
```

For Node, copy both helper scripts into `.build/`, adjust the two checkout
roots in `bundle-node-replays.ts`, and run it with Bun. Run the resulting
`node-before.mjs` and `node-after.mjs` with Node, passing the corresponding root
and destination. Generate the candidate bundle while the saved patch is
applied. Run samples serially without concurrent validation work.

## Diagnostic usage and validation

```powershell
# Current roster, 30 ships per team, 3,600 measured ticks.
bun scripts/diagnostics/mixed-fleet-performance.ts 30 3600 current
# Omit "current" to use the historical fixture.
```

Open `/scripts/diagnostics/live-performance.html?team=30&roster=current&manual`
on the development or preview server. Wait for `window.review.ready`, then
call `await window.review.measureFrames({ warmup: 30, frames: 120 })` in the
console. Reload before repeating a replay. Use the Run button for the live
sample. Existing `carriers`, `quality`, and camera options remain available.

The final diagnostic CLI smoke check passed for both rosters; repeated current
roster runs produced identical expanded hashes, and the new output fields were
present. `bun run build` passed via WSL, including all ship and aircraft checks,
TypeScript, and Vite. WSL uses the canonical source paths expected by existing
comparison hashes; no authoring hashes or model outputs were changed.

A production-preview Chrome smoke check also passed with six ships: manual
startup stopped at tick 3,600, the completed-frame helper returned the new
statistics and restored pause, reload reproduced the exact battle-state hash,
and the Run button left manual mode. No page errors were observed. These brief
browser checks validate the harness, not performance.

Final integration includes the later HUD commit `e24753a7`. Its four
`HitFeedback` tests and the full build passed together with these diagnostics.
The CPU comparison above remains tied to its original `f720a505` baseline.
