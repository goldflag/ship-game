# Fleet command speed

Measure achieved simulation speed as well as FPS: selecting 4× requests 240
fixed combat ticks per wall-clock second. Smooth rendering alone does not show
whether the battle keeps up.

## Reproduce

After `bun run build`, serve `bun run preview` and open
`/scripts/diagnostics/pve-speed.html?scenario=surface&speed=4&seconds=120`.
The diagnostic drives the actual fleet-command UI and local worker. It records
10-second windows in `window.review.result`, then pauses. Compare 1, 2 and 4;
use `scenario=carrier` for the carrier case. Both scenarios use a fixed seed and
15 friendly ships within the normal budget; the planner generates the opposing
fleet. Surface means the selected fleet has no carriers, not a restriction on
the hidden opponent. Graphics default to High at full resolution. Record the
viewport, framebuffer, browser and hardware with results.

`profile=1` adds worker step/serialization/decoding/delta timings in
`review.worker`. Profile separately from throughput measurements. Production
bundles avoid development hot reloads interrupting comparisons. Keep other
benchmarks and builds idle during measurements. Save temporary outputs under
ignored `.build/fleet-speed/`.

The worker-only diagnostic runs the same WASM, snapshot decoder and sparse-delta
preparation without rendering or real browser scheduling:

```sh
bun scripts/diagnostics/pve-speed.ts --scenario surface --seconds 600 --batch 12 --output .build/fleet-speed/after.json
```

It prints per-minute processing times and maximum throughput. This is a capacity
ceiling, not achieved in-game speed. `--batch 4` approximates the former 60 Hz
publication at 4×; `--batch 12` approximates routine fleet command's 20 Hz at 4×.
Use `--wasm .build/fleet-speed/baseline.wasm` to compare a saved compatible build
with identical content. Compare parsed final snapshots as well as timings.

## Changes

Routine fleet-command snapshots publish at 20 Hz of wall time, while queued
orders and manual helm retain the existing 60 Hz dispatch opportunity. Combat,
spotting and aircraft retain their simulated-time cadence. Owned hulls stream
through the shared presentation filter rather than allocating an intermediate
JSON tree; other team-filtered fields and the debrief retain their existing
projection.

Spotting computes a target's neighboring-aircraft count once per acquisition,
shared by every observer. Pilot range queries use squared distances away from
the boundary, retaining the old hypot calculation in a conservative rounding
band and for extreme inputs. These changes retain the existing range decisions
and avoid changing movement, weapons, visibility rules or aircraft population.

## September 10, 2026 measurements

Apple M5 Pro, 18 logical CPUs, macOS 26.6.2, Bun 1.3.3. The worker-only comparison
uses the same seed/content for 600 simulated seconds, with the baseline WASM from
`5b5eebd2` publishing every four ticks and the candidate every twelve. This task ran samples sequentially,
without overlapping its builds or other measurements. Each pair's complete final JSON
state was equal after parsing, including combat events and damage.

| Selected fleet | Before: worker seconds | After: worker seconds | Work saved | Slowest minute's throughput, before → after |
| --- | ---: | ---: | ---: | ---: |
| Surface: 2 battleships, 4 cruisers, 9 destroyers | 143.13 | 83.41 | 41.7% | 3.45× → 5.15× |
| Carrier: 2 carriers, 1 battleship, 12 destroyers | 198.71 | 114.44 | 42.4% | 2.47× → 4.03× |

These are processing ceilings without rendering or worker scheduling. The
carrier sample has little spare capacity at its busiest point; these results
do not establish 4× on every machine or throughout arbitrary longer battles.
The original surface selection with three battleships and twelve destroyers
already held roughly 4× during a two-minute browser check on this machine;
that easier case did not reproduce the reported surface slowdown.

The production surface run used Chrome 152.0.7977.83, WebGPU, High quality and a
1280 × 800 framebuffer. It advanced 719.67 simulated seconds in 180.002 wall
seconds: **3.998×**. Ten-second windows stayed at 3.973–4.013× and approximately
60 FPS; the longest frame was 50 ms. This covers twelve simulated minutes,
including damaged and lost ships. The fleet-command capture was inspected.


The production carrier run used the same settings and advanced 718.25 simulated
seconds in 180.008 wall seconds: **3.990×**. Ten-second windows ranged from
3.905–4.020× at 59.8–60.0 FPS, with a 33.4 ms maximum frame. After that sample,
clicking the speed controls in the continuing battle measured **1.000×** and
**1.997×** over twenty seconds each. The late carrier capture was inspected.
These fixed scenarios retain the default owned-aircraft orders; they do not
measure every possible fully airborne carrier engagement.

Validation includes the normal production build, 30 real-WASM session/transport
checks and 37 targeted native checks for projections, spotting, range boundaries,
PvE generation and observed targeting/reconnaissance. The broader aircraft-AI
suite also passed. A separate existing carrier-loss test,
`a_homeless_strike_releases_its_bombs_then_withdraws_without_fabricated_kills`,
reports zero releases rather than four with both the changed and original
sensor/aircraft implementations; that unrelated failure is not fixed here.
