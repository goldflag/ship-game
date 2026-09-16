# Experimental combat runtime profiles

The editable construction blueprint and shared component catalog remain the only
ship source. The published definition and detailed GLB remain exact by default.
This experiment derives ordinary versioned `ShipDefinition` fixtures from that
compiled output; it does not introduce another ship-authoring format or roster.
See [runtime encoding and loading](ship-runtime-performance.md) for the retained
NSD encoding, immutable sharing and on-demand loading work in PR #216.

## Decisions

- Keep the exact geometry implementation as the reference. Neither compartment
  coalescing nor a coarse gameplay profile is enabled by the construction compiler.
- Adopt only the independently checked exact optimizations: reuse full-cell
  moments during water-level bisection; defer world-space hull pieces until ships
  are close enough to contact; use sorted spatial candidates before the unchanged
  convex collision narrow phase. Legacy collision transforms retain their original
  timing to preserve mixed-pair floating-point behavior.
- Separate displaced volume from conservative collision coverage. Filling empty
  space in a collision enclosure must not create reserve buoyancy. The optional
  `Hull.buoyancy` v1 field contains weighted boxes, with the existing hull volume
  retained for collision. Absence retains the original implementation.
- `Compartment.cells[].volumeM3` optionally weights a water cell independently of
  its box size. Existing unweighted cells retain their previous porosity path.
  Coarse cells use source volume and volume-weighted centers; flooding capacity
  remains authoritative. This is an approximation to partial immersion and water
  distribution, not exact polyhedral equivalence.
- Weighted profiles update aggregate mass, center of gravity and approximate
  inertia from the same water columns, including their intrinsic box inertia and
  parallel-axis offsets. Dry loading/equipment aggregates are retained exactly;
  equipment edits still recompile the source. Exact profiles retain existing
  inertia calibration and dynamics.
- Preserve all weapon/machinery/assembly identities and their source definitions.
  Fourteen rooms contain 99.9902% of this Hipper's capacity; smaller disconnected
  voids merge to the nearest substantial room, preferring the same boundary
  signature. Macro-room IDs survive. The mapping is diagnostic output in `.build/`.
- Conservative enclosing **surfaces** are insufficient for the current weapon
  clearance algorithm: a barrel inside an enclosure may be far from its surface.
  The coarse-shell clearance experiment is rejected. Guarded profiles keep the
  exact bodies within the existing mount sweep-radius bounds; nested installations
  keep every body. No approximate clearance geometry becomes a default.
- CPU fixtures have a distinct derived content hash and the ordinary NSD payload
  integrity hash. They are not published, registered or substituted for a GLB with
  the source hash. Renderer-free trials run through the real native catalog/core.
  Browser presentation and an interactive combat-profile selector are not added.

## Candidates and acceptance criteria

`combat_profile_probe` supports three useful ablations: unweighted `coarse`
(omit the fourth argument), `weighted`, and `guarded`. Weighted candidates keep
exact clearance bodies but approximate exterior armor and aggregate portals.
Guarded candidates retain exact armor and individual boundary damage patches.
`hybrid` also tests original source solids as collision pieces, retaining any
compiled fragment not enclosed by one source solid; overlap is allowed only
because a separate buoyancy profile supplies displacement. It did not offer a
small enough representation to recommend.

These are engineering tolerances selected during exploration, not preregistered
criteria or user-approved gameplay changes:

| Quantity | Exploratory gate |
| --- | --- |
| Dry mass, CG, inertia, machinery, weapon/source identities | Exact |
| Total flood capacity | Relative error below 1e-9 |
| Displacement near operational immersion, heel through 35° | Within 1% |
| Buoyancy center near operational immersion | Within 0.25 m |
| Partial-flood water level (10%, 50%, 90%), including inversion | Within 0.5 m |
| Single-room contribution to total loaded-ship CG | Within 0.02 m |
| Full/dry water level | Report separately; never hide extent errors |
| Reference-blocked firing pose accepted by candidate | Zero |
| Collision enclosure vertex/edge samples lost | Zero; samples supplement geometry reasoning |
| Guarded armor contact position/thickness and AP outcome | Exact or 1e-7 m position tolerance |
| Timed flooding/capsize and boundary assignments | Explicit deltas; material changes need approval |

The fidelity grid covers upright, 15°/3°, −35°/−7°, 90°/0° and 170°/10° heel/trim,
five immersion levels and five fill fractions. Water-center errors are reported
both locally and mass-weighted against the whole ship. Passing a finite sample
does not certify every collision, damage ray or weapon path. Satisfying combat
also needs interactive playtesting before any candidate becomes a default.

## Measurements

Measured September 16, 2026 on Apple M5 Pro, 51.54 GB RAM, macOS arm64, shared
machine. MB means decimal MB. Native results use release builds with a counting
allocator. Each matrix case runs 600 ticks (10 simulated seconds), seed 12345,
North Atlantic, overcast, hard bots initially 5 km apart. Each result is one run,
not a confidence interval. OS file caches are uncontrolled. The reference is the
published Hipper represented by the previous PR's 17.383 MB lossless NSD, with
the additional exact water/collision optimizations in this change.

### Size, loading and memory

| Representation | Runtime NSD MB | gzip MB | Native catalog load ms | Live heap MB, two ships | Peak allocated MB | Resident / peak RSS MB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Exact | 17.383 | 9.597 | 325 | 134.6 | 173.1 | 243.0 / 257.5 |
| Guarded 6 m | 5.016 | 2.556 | 179 | 61.7 | 80.8 | 106.4 / 119.4 |
| Guarded 3 m | 5.941 | 3.086 | 185 | 67.6 | 87.3 | 116.9 / 128.5 |
| Weighted 6 m, approximate armor/portals | 2.581 | 1.248 | 140 | 49.2 | 57.6 | 86.9 / 87.7 |

Native catalog load includes the same full roster in every row, replacing only
Hipper. Heap and peak RSS come from the two-ship matrix. Resident RSS is a
separate fresh-process 1,200-tick run, median of the final five 100 ms samples
after the first second. These are different measurement scopes; do not subtract
resident from peak to infer allocation lifetimes. The visual GLB stays 5.400 MB.

Guarded 6 m contains 14 rooms with 630 weighted water cells, 466 buoyancy/collision
cells, all 16,059 armor patches and 6,924 boundary connections, and 11,767 of the
13,840 original clearance bodies. Its exclusive NSD bytes are 1.893 MB armor,
1.534 MB clearance, 0.996 MB connections, 0.267 MB hull, 0.047 MB compartments,
0.223 MB shared nodes, and 0.055 MB other data/overhead. Nodes shared across
subsystems are counted once. This explains why it remains above the 2–5 MB
threshold: exact damage boundaries and clearance now dominate, not flooding
volume geometry. Guarded 3 m has 2,986 water cells and 2,630 hull cells.

Additional instances share definitions and compiled geometry. From two to eight
Hippers, live allocation rises by 0.802 MB per instance exact, 0.770 MB guarded
6 m, and 0.062 MB weighted 6 m. Guarded still pays for individual boundary
damage/connection state. A separate one-versus-four-design catalog test adds
Bismarck, Fletcher and Enterprise: 2.783 MB additional loaded definitions and
8.391 MB including compiled data, for both exact and guarded catalogs. This is
the measured cost of those three designs, not an extrapolated cost per Hipper.

Fresh Chromium 153.0.8010.12 processes also decoded the actual NSD and ran the
existing local worker/WASM for 120 ticks with two Hippers:

| Representation | Main-page decode ms | Retained page heap MB | Worker initialization ms | WASM memory MB | Browser resident / sampled peak RSS MB |
| --- | ---: | ---: | ---: | ---: | ---: |
| Exact | 181.8 | 77.3 | 2,727 | 142.9 | 762.5 / 838.1 |
| Guarded 6 m | 63.3 | 18.7 | 1,260 | 61.5 | 562.1 / 568.3 |
| Guarded 3 m | 76.5 | 23.4 | 1,374 | 67.1 | 577.2 / 602.2 |

The page retains its decoded definition and a real worker; no GLB is rendered.
Page heap is post-GC and excludes worker heap. RSS sums the browser process tree
(about 264 MB empty), may double-count shared pages, and samples every 100 ms.
Fixture fetch and worker initialization include Playwright route fulfillment
and dev-server overhead; they are not production download measurements or cold
disk timings. The worker still parses its own definition into WASM. This work
reduces that representation; it does not claim zero-copy JS-to-WASM sharing.

### Whole-tick latency

Each cell is **median / p95 / p99 milliseconds**. Four matches means the summed
cost of stepping all four resident matches serially, not per-match latency.

| Battle | Exact | Guarded 6 m | Guarded 3 m | Weighted 6 m, rejected armor |
| --- | ---: | ---: | ---: | ---: |
| 2 ships | 1.83 / 2.38 / 33.25 | 1.71 / 2.89 / 4.52 | 1.81 / 2.33 / 10.70 | 1.43 / 1.81 / 4.26 |
| 8 ships | 7.25 / 9.66 / 132.44 | 7.17 / 8.85 / 17.56 | 7.11 / 9.28 / 42.79 | 5.71 / 8.17 / 15.94 |
| 16 ships | 14.63 / 18.87 / 269.86 | 14.34 / 17.76 / 35.29 | 14.36 / 17.01 / 85.25 | 11.40 / 15.37 / 32.86 |
| 4 × 8 ships | 29.33 / 40.75 / 553.38 | 28.61 / 36.85 / 71.36 | 28.76 / 35.52 / 174.07 | 23.45 / 30.12 / 69.29 |
| 8 ships, 4 designs | 2.43 / 3.18 / 35.66 | 2.33 / 2.76 / 5.18 | 2.31 / 3.00 / 11.23 | 1.78 / 2.42 / 4.67 |
| Wet 2 ships | 0.051 / 0.080 / 55.78 | 0.046 / 0.066 / 2.47 | 0.046 / 0.075 / 9.77 | 0.020 / 0.042 / 2.47 |
| Wet 8 ships | 0.218 / 0.344 / 224.40 | 0.197 / 0.262 / 12.08 | 0.193 / 0.282 / 45.62 | 0.081 / 0.105 / 9.60 |
| Wet 4 × 8 ships | 0.911 / 1.187 / 884.68 | 0.821 / 1.275 / 40.35 | 0.851 / 1.291 / 160.26 | 0.330 / 0.510 / 44.54 |

Wet cases start with the three largest rooms 30% flooded; machinery is disabled,
so their very low median is not representative of fighting ships. Periodic
water/hydro solves dominate tails. Wet four-match maximum was 19,685 ms exact,
53.9 ms guarded 6 m and 201.1 ms guarded 3 m. First-tick work is included.
Dry four-match maxima were 571.3, 77.6 and 197.4 ms respectively. No candidate
demonstrates a 60 Hz budget for every tick at these fleet sizes.

The exact optimizations themselves reduced the preceding PR run's two/eight/
four-by-eight dry medians from 5.64/22.60/90.30 ms to 1.83/7.25/29.33 ms.
All five dry matrix snapshot hashes match that earlier implementation. Guarded
simplification mainly improves tail latency and memory beyond this exact
baseline; it does not provide a sixfold whole-tick median improvement.

### Gameplay comparison

| Measurement | Guarded 6 m | Guarded 3 m |
| --- | ---: | ---: |
| Maximum displacement error, operational immersion and heel ≤35° | 0.270% | 0.043% |
| Maximum buoyancy-center error in that operating range | 0.188 m | 0.036 m |
| Maximum displacement error across full grid, including near-emergence | 9.38% | 5.22% |
| Maximum partial-flood level error, normal / extreme heel | 0.191 / 0.413 m | 0.104 / 0.203 m |
| Maximum local partial-water-center error, normal / extreme heel | 3.762 / 1.404 m | 1.394 / 0.333 m |
| Maximum single-room error in whole loaded-ship CG | 0.0121 m | 0.0034 m |
| Maximum full/dry level error | 1.156 m | 1.156 m |
| Unsafe accepted / extra blocked firing samples | 0 / 0 | 0 / 0 |

The clearance check covers 2,652 valid train/elevation/neighbor combinations,
including 506 reference-blocked poses. Existing native clearance regressions
exercise continuous sweep handling; this grid is not an exhaustive trajectory
proof. All 503,894 sampled original collision vertices/edge midpoints are inside
the candidate hulls. All 228 sampled armor first-hit positions and thicknesses
match. Across 27 scripted AP contacts, penetration/outcome/contact positions
match, but **three breach assignments change from a microvoid to its merged
room**. Original local-damage region IDs remain intact.

Ten-second propulsion/steering trials have identical speed, heading and planar
position; guarded 6 m dry heave differs by 0.0084 m. Machinery loss under partial
flooding remains functional. A 2 m² breach admits 100.350 m³ exact versus
100.340 m³ guarded 6 m and 100.350 m³ guarded 3 m. A damaged internal portal
progressively wets a second room while retaining total water to numerical
precision. This verifies transfer, not identical per-room flow curves.

Starting at 90° heel with one flooded room, final heel is 10.22° exact, 9.66°
guarded 6 m and 9.49° guarded 3 m. Starting at 170° with every room half full,
the ship rights to 27.97°, 36.09° and 35.32° respectively after ten seconds.
These inertia/righting differences are material. A separate deliberately
unstable fixture (CG raised to 20 m) reaches capsized loss at the ten-second
sample in all profiles; unmodified Hipper's self-righting is not misreported as
a capsizing test. At 95% flooding all profiles enter sinking, with identical
vertical position at ten seconds. Fresh-instance reset matches each profile's
initial state in all eight scenarios.

Conservative collision also changes behavior. At 21 m lateral separation, both
guarded hulls generate two damage events where exact generates none, with
0.904 m position difference. A bow contact differs by 1.064 m at 6 m pitch but
only 0.0035 m at 3 m pitch. A heeled contact produces four versus two damage
events at 6 m pitch; 3 m retains two. These are explicit extra contacts, not
evidence of equivalent ramming behavior.

The sub-megabyte unweighted enclosure (0.792 MB) fails: up to 38.53%
displacement error, 32 unsafe-clear poses and 1,345 extra blocked poses. Weighted
6 m at 2.581 MB fixes buoyancy and retains exact clearance but its broad armor
misses four reference hits, adds four hits and changes 28 thickness results in
228 rays (up to 6.344 m contact displacement). Neither is recommended.

### Recommendation and remaining limits

Keep the exact model as the default. Retain the validated exact optimizations
and use **guarded 6 m as the next opt-in playtest candidate**, subject to approval
of the measured collision, compartment assignment and righting tradeoffs before
default adoption. It cuts runtime bytes by 71%, measured native resident memory
by 56%, and eight-ship p99 by 87%, while retaining detailed appearance and exact
sampled penetration/clearance. Guarded 3 m costs another 0.925 MB and has much
higher tails; it improves hydro accuracy and some contact positions but does
not remove the extra lateral contact or changed flooding assignments.

The 0.5–2 MB goal is **not achieved with an acceptable candidate**. Reaching it
requires a further damage-boundary and solid-clearance redesign, not just more
aggressive box sizing. Broad armor and aggregated portals were tested and
rejected in their current form. Named machinery modules and individual weapons
remain; fewer rooms alone do not remove thousands of per-instance portal states.
Equipment changes still rebuild dry mass properties from the editable source;
dynamic equipment removal and a new damage-module model are not implemented.

This is an offline prototype, not an accepted combat balance change. The
ten-second two-ship battles fire 14 shells but have no impacts at their initial
range; separate scripted AP probes cover first contacts. Long projectile-heavy
battles, network saturation, interactive combat feel and full client rendering
memory remain unmeasured. Concurrent-match figures measure the CPU scheduler,
not end-to-end multiplayer capacity. No result certifies historical accuracy.

### Validation

The rebuilt published definition is semantically identical to the reference
apart from its pipeline hash. GLB mesh/material data and binary payload are
identical; only definition-hash extras change. The five exact exported fixed
views were inspected. The native articulation audit checked 150 samples with
maximum muzzle error 4.18e-7 m. No simplified model was published.

Passed: 29 targeted native tests (including 3,525 bit-identical water queries),
53 runtime/session TS tests after integration with master, construction authoring
checks, Hipper `ship:build`,
`ship:check all`, `ship:runtime:check`, and `bun run build`. The preceding full
native run has three documented baseline failures in carrier loss, damage
migration and a dry-water-level expectation; this follow-up does not claim a
new clean full-suite run. Raw profiles, measurements and captures stay in
`.build/combat-profile/` and `.build/compartment-runtime/`.

## Reproduce

Keep all generated data under `.build/`. Run commands from the repository root;
substitute the installed Cargo executable if it is not on `PATH`.

```sh
cargo build -p naval-sim --release --example combat_profile_probe \
  --example combat_profile_fidelity --example combat_profile_trial --example runtime_bench
bun run multiplayer:prepare
mkdir -p .build/combat-profile
cp public/models/admiral-hipper-construction.json .build/combat-profile/reference.json
cp .build/naval-content/manifest.json .build/combat-profile/reference.manifest.json
cp public/models/runtime/admiral-hipper-construction.nsd .build/combat-profile/reference.nsd
# No default publication: output is an isolated derived definition.
target/release/examples/combat_profile_probe .build/combat-profile/reference.json \
  .build/combat-profile/guarded-6.json 6 guarded > .build/combat-profile/guarded-6.report.json
bun scripts/diagnostics/combat-profile-content.ts .build/combat-profile/guarded-6.json \
  .build/combat-profile/guarded-6 .build/combat-profile/reference.manifest.json
target/release/examples/combat_profile_fidelity .build/combat-profile/reference.json \
  .build/combat-profile/guarded-6.json > .build/combat-profile/guarded-6.fidelity.json
target/release/examples/combat_profile_trial .build/combat-profile/guarded-6.json \
  > .build/combat-profile/guarded-6.trial.json
bun scripts/diagnostics/combat-profile-matrix.ts .build/combat-profile/reference.manifest.json exact
bun scripts/diagnostics/combat-profile-matrix.ts .build/combat-profile/guarded-6.manifest.json guarded-6
/usr/bin/time -l bun scripts/diagnostics/combat-profile-load.ts .build/combat-profile/guarded-6.nsd
bun scripts/diagnostics/ship-runtime-sections.ts .build/combat-profile/guarded-6.nsd \
  .build/combat-profile/guarded-6.sections.json
bun scripts/diagnostics/combat-profile-resident.ts \
  .build/combat-profile/reference .build/combat-profile/guarded-6
bun scripts/diagnostics/combat-profile-browser.ts \
  .build/combat-profile/reference .build/combat-profile/guarded-6
bun scripts/diagnostics/ship-runtime-designs.ts target/release/examples/runtime_bench \
  .build/combat-profile/guarded-6.manifest.json combat-guarded
```

Repeat with pitch `3`, and with `weighted` to measure the armor/portal tradeoff.
The matrix increases instances, distinct compiled designs, resident matches and
partial flooding. It records median/p95/p99/max tick latency, admission/compile
cost, tracked live/peak allocations, process peak RSS and deterministic snapshots.
Concurrent matches are resident together and stepped serially, matching the
scheduler measurement; this is not a network saturation or multi-core throughput
test. Isolated Bun admission is a JS-memory proxy, not a browser/worker/WASM peak.
The OS file cache is uncontrolled; report cold process admission, not cold disk.
To check deterministic generation, repeat the probe to a second `.build/` path
with the same reference, pitch and mode, then `cmp` the two definitions. The
guarded 6 m repeat was byte-identical. Rebuilding a reference with a new pipeline
hash changes derived integrity metadata, even when its gameplay fields match.

## Earlier compartment-only experiments

The original 2 m columns reduced 17.383 MB to approximately 8.142 MB and used
roughly one sixth of the water-query time in that run. Reproduction with the
bit-identical bisection cache improves the reference too: 3,525 paired queries
used 1,369 ms versus 284 ms (4.82×), on a shared machine. This is a water-query
measurement, **not a whole-tick speedup**. Maximum water-level error remains
2.632 m, and 98/224 sampled nearest-room assignments change. The candidate is
not equivalent and is not enabled.

Convex fragment coalescing reduced 28,687 cells to 21,669, with tiny volume and
water-level differences. A full 6,924-portal contact audit nevertheless found
seven different nearest-room tie selections and one distance change of 0.01 m.
It remains an experiment. Boundary-only extraction failed closure/volume checks;
cap-free signed integration was numerically unstable and slower. Neither is in
the runtime path. Diagnostic artifacts and rejected implementations stay in
`.build/`.
