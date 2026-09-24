# Simulation performance: harness and equality gate

Rust in `crates/naval-sim` is the only simulation. Every mode runs the same `Battle::step`
(phases in `crates/naval-sim/src/battle/tick.rs`: observe, decide, manoeuvre, fight, strike,
suffer, settle). `src/simulation/` is a retired test fixture; nothing in the game steps it.

| Consumer | Where it runs | What limits it |
| --- | --- | --- |
| PvE fleet command | WASM worker, `LocalRuntime`, batched ticks | worker step time |
| Custom battle and port | WASM worker, `LocalBattleSession` (the port is `LocalBattleSession.port`, idle) | worker step, then per-tick publication |
| Multiplayer | native `naval-server`, `FrameDelta` update against the match baseline (`encoding.rs`) | step time per match |

Cadences key off `Battle::tick`, never wall time. The server never sets `mission_rules`
(`crates/naval-server/src/hub.rs`), so `mission_rules.is_some()` is the PvE-only switch.

## Native profiling harness

`crates/naval-wasm/examples/pve_speed.rs` runs the worker's own `PvePlanner`/`LocalRuntime`
natively, without WASM or rendering.

```sh
cargo run --release -p naval-wasm --example pve_speed -- [scenario] [seconds] [batch] \
  [--dump PATH] [--no-snapshot] [--full-snapshot] [--map ID]
```

`--map` picks the battle's map: `iron-bottom-sound` (the default) and the other real charts carry
terrain, `north-atlantic` is open sea.

Scenarios: `surface` and `carrier` (fleet command, 12-tick batches), `custom` (the 15-ship-per-side
roster in [custom battle performance](custom-battle-performance.md), publication every tick) and
`server` (same battle, update against the baseline every 3 ticks, gzip excluded). Stderr prints
step ms, snapshot ms and bytes per simulated minute; stdout prints one JSON summary (`stepMs`,
`snapshotMs`, `bytes`, `ticks`). Compare early and late minutes separately: cost grows through a
battle. For a symbolized profile, build with `CARGO_PROFILE_RELEASE_DEBUG=true` and `samply record`.

Constructed (editor-built) ships: ms per tick per ten-second window beside each hull's flooding.

```sh
cargo run --release -p naval-wasm --example custom_cost -- valiant valiant 600 --aftermath 120
```

Teams are comma-separated preset ids. Options: `--sources FILE --catalog FILE` (editor designs),
`--spawn M`, `--seed N`, `--aftermath S` (same on both sides of a byte comparison), `--dump PATH`.
For WASM worker and in-browser numbers, see [fleet command speed](pve-speed-performance.md).

## Equality gate

```sh
scripts/diagnostics/sim-step-gate.sh capture <label> [seconds]
scripts/diagnostics/sim-step-gate.sh compare <label-a> <label-b>
```

`capture` builds `pve_speed`, runs all four scenarios (600 s by default; `custom` and `server` run
a quarter of that) and stores final state, summary and log under ignored `.build/sim-gate/<label>/`.
`compare` prints the timing change and `identical` or `DIFFERENT` per scenario (bytes of the dumped
final state) and exits non-zero on any difference. Capture master from a temporary worktree first.
Bit-exact PRs must show `identical` everywhere; behaviour PRs must say which scenarios differ and
why. Also run the `naval-sim` tests. The step is deterministic run to run; timings are not, so
interleave A/B runs on a quiet machine.

## Done

- Bit-exact step fixes: flooding fast paths, per-tick `PlaneView`, enums for aircraft and status
  strings, index maps, `vessel::Fleet::split` borrows, `VecDeque` events, `geometry::Basis`.
- Transport: pipelined dispatch, snapshot narrowing, Rust-emitted patches
  (`crates/naval-sim/src/frame_delta.rs`), also used by the server.
- Content: published hydrostatic table (`bun run ship:hydrostatics` writes
  `assets/gameplay/hydrostatics.v1.json`) and coarser flood spaces. Both changed results.
- PvE-only cadence in `assets/gameplay/pve-cadence.v1.json` (stability 1 s, capability 6 ticks,
  damage control 30 ticks); battles without mission rules use `SimulationCadence::PER_TICK`.
- Behaviour: 0.65 s pilot think timer, AA target selection every `AA_SELECT_TICKS` (6); see
  [air operations](air-operations.md#decision-cadence). Unchanged render proxies are skipped.
- Constructed ships: flood `LevelTable`, `ClearBound`, `flotation_near`, `exterior_protection_mm`.
- Constructed flood spaces cache immutable cell moments and use volume-only clipping during
  water-level searches. Exact convex coalescing removes compatible subdivision seams after
  openings and flooding footprints are derived.
- Constructed hull flotation caches tetrahedral displacement and evaluates exact piecewise
  cubic volumes and first moments at each attitude. This covers arbitrary heel/trim,
  with clipping fallback for invalid caches; no sampled attitude table.
- Fixed armor plates use a conservative spatial index, with authored contact order restored
  before penetration is evaluated. Moving turret plates retain their live transforms.
- Deck routing rejects disjoint aircraft-layer/structure polygon bounds before
  running the original overlap predicate. Touching and near-touching bounds keep
  the exact check; route sampling, search budgets and handling cadence are unchanged.
- Runtime construction barrels use enclosing tapered capsules. Short turret sweeps reuse
  certified clearance distances, and fixed hull stops survive unrelated turret movement.
  Authoring checks retain the fine barrel envelope.
- Constructed armor merges compatible coplanar patches; hull clearance discards internal cell
  faces. Closed protection-linked flooding fragments share topology while retaining every
  footprint's damage cap, position and original sequential transfer order.
- Yamato's swept `mountClearance` profile is gone from her blueprint; tests keep it as
  `src/simulation/fixtures/yamato-swept-clearance.json`.

## Remaining

- Remaining interior pieces often surround machinery or nonconvex hull sections. Further
  reduction needs a different exact partition or a measured approximation; merging across
  a cavity or replacing different breach heights with one centroid changes physical behavior.
- Every ship solves stability on the same tick; staggering it would change premade results.

Measurements, per-phase tables and rationale: [archived log](archive/sim-performance-plan-log.md).

## Runtime approximations

Surface guns make aim and fire decisions every six battle ticks (100 ms). Each decision
lays the gun on a line of fire held in world space; on the ticks between, the mount keeps
training and elevating toward it at its own rate through the same clearance, so the
barrels hold their aim while the hull rolls and turns instead of riding the deck for
100 ms and snapping back. Gunnery runs before the hull's attitude settles in a tick, so
the lay trails the roll by one tick. The traverse solver sweeps the entire requested
move, including intermediate collision checks; it does not test just the destination.
Active AA and surface weapons with a reload
shorter than 100 ms retain their per-tick controls. Reload, recoil, damage, ship motion,
aircraft and projectiles still advance every tick. Time spent controlling a mount as AA
is excluded from its next surface slew. A changed fire order takes effect at the next
surface control tick. Shot timing and therefore seeded battle outcomes can change.

Constructed compartment water geometry uses at most 64 weighted boxes per room, compiled
once and shared between instances of the same design. The proxy preserves total capacity,
full-water centroid and diagonal second moments. Partly filled water levels, centroids
and free surfaces are approximations. Flood connections, localized breaches, armor and
rendered compartment boundaries retain the authored geometry. Invalid proxy moments fall
back to the original cells. The exact clipping path remains available for comparison.

Flood inflow, pumping and inter-room transfers run every six ticks (100 ms), using
one pressure sample for that window. Sequential transfers still conserve water and clamp
to the available water, receiving capacity and pressure equilibrium. The first tick
integrates only one tick of water. Stability, sinking motion and published water levels
continue updating every tick with the current water volumes. This changes intermediate
water levels and can shift combat outcomes; the per-tick transfer function remains the
reference path for accuracy tests.

These are simulation choices shared by the native server and WASM worker, independent of
rendering quality. Compare equal requested simulation durations and report battle outcomes
alongside timings; faster destruction of a ship is not proof of a cheaper combat tick.

Generated gun installation supports use a separate runtime shell-contact representation:
one analytic circular wall and one annular top replace 64 wall and 64 top polygon tests.
The bore stays open; no inner wall or bottom plate is added. Contacts retain the original
sector's plate ID, material and thickness, including independently armored sectors. The
common top/wall rim is one crossing, with both plate identities marked visited. The fixed
armor index excludes the replaced polygons. This applies to custom ships and construction
presets; legacy barbettes retain their authored collision geometry.

The proxy recognizes complete, fixed, horizontal 64-sided supports and falls back to literal
plates for incomplete, edited or protection-linked flooding geometry. Circular walls differ
from the inscribed visual polygon by at most `radius × (1 − cos(π/64))`, about 0.121% of radius;
wall normals can differ by up to 2.8125°. The top's inner and outer edges use the corresponding
circles. Grazing contacts and penetration/ricochet outcomes can therefore change. Visuals,
authoring clearance, structural solids, mass, buoyancy, flood openings and compartment geometry
keep their existing meshes. `ContactGeometry::armor_shape_count` reports collision shapes;
the serialized definition still reports all authored armor plates.

Hull and superstructure shell contacts also group touching, equally armored fixed
panels across authored surface IDs. Each group fits one plane, with a maximum 2 cm
distance from every original vertex and a maximum 2° difference between original
normals. Every merge checks the original geometry, so repeated merges cannot accumulate
drift. A convex envelope provides the broad phase; original panel footprints retain holes
and concave corners and select the hit's original damage identity. Overlapping armor layers,
different thicknesses/materials, moving plates and flooding-protection-linked plates stay
separate. This changes shell contacts, not gun-clearance or ship-ramming geometry.

Runtime buoyancy additionally merges connected hull cells into convex envelopes. Added
space must remain within 2 cm of the original union, including a centroid correction of at
most 5 mm; a convex-piece containment check prevents filling a cavity between nearby walls.
Each cluster adds at most 0.05% geometric volume before weighting restores its exact full
displacement and center. A ship-level acceptance grid checks 168 immersion/heel/trim cases,
including inversion, for at most 0.1% of full displacement error and 5 cm of buoyancy-center
error when at least 1% submerged. A failed model keeps the original cells. Authoring and
published loading calculations still use the original hull through `HullHydrostatics::new`.

Flooding chooses smaller moment-preserving models per room, trying 16/32-box partitions
and then bounded local merges of the established 64-box model. Each candidate is compared
with that original runtime model over 1,344 combinations of heel, trim and fill, including
0.1% and full rooms. The acceptance limits are 2.5 cm of water level and a first-moment error
equivalent to moving full-room water by 2 mm. Capacity, full-water center and diagonal
inertia are preserved by the box construction. Deterministic geometric ordering prevents
equivalent CSG subdivisions from choosing different merges. Watertight topology, breaches,
doors and compartment definitions are unchanged; difficult rooms keep the existing model.
These sampled hydraulic limits are acceptance checks, not universal error guarantees, and
flooding errors are additional to the earlier 64-box approximation described above.

## Scharnhorst performance pass (September 2026)

The saved custom Scharnhorst was measured against `a8a392267`, including the earlier exact
geometry compaction and faster heavy-gun traverse. The integrated candidate is `e32e420f`. On an Apple M5 Pro, the shared simulation ran the same seed (17001),
5 km deployment and requested duration on both builds. Compilation, loading, snapshots
and rendering are excluded from these step timings. Native cases alternate baseline and
candidate order; the browser worker alternates six-tick batches within one process.

| Workload | Baseline ms/tick | Updated ms/tick | Speedup |
| --- | ---: | ---: | ---: |
| Chrome worker, Scharnhorst vs Bismarck, 230 s | 1.424 | 0.139 | 10.25× |
| Same browser run, opening 160 s of combat | 1.691 | 0.153 | 11.08× |
| Native, Scharnhorst vs Bismarck, 230 s | 0.407 | 0.063 | 6.49× |
| Native, Scharnhorst vs three Bismarcks, 140 s | 0.442 | 0.098 | 4.51× |
| Native, four Scharnhorsts vs four Bismarcks, 180 s | 1.827 | 0.415 | 4.40× |
| Native, surface PvE, 600 s | 0.561 | 0.259 | 2.17× |
| Native, carrier PvE, 600 s | 0.876 | 0.508 | 1.73× |
| Native, 30-ship custom battle, 180 s | 1.186 | 0.527 | 2.25× |
| Native, 30-ship server battle, 180 s | 1.373 | 0.535 | 2.57× |

Chrome 153 uses `wasm-dev` (optimization level 1) for both modules; native uses release
with symbols (optimization level 3). The browser result demonstrates a roughly tenfold
development-worker improvement for this custom ship, not a production-WASM, FPS or
fleet-wide tenfold guarantee. Host scheduling and engine optimization affect timings;
these are paired measurements on one machine, not universal performance bounds.

The 230 s case deliberately continues after combat ends. Bismarck sinks between 160 and 170 s
in the baseline and between 190 and 200 s with the new controls; Scharnhorst survives with
5,391 and 4,257 HP respectively. Both ships are still fighting during the opening 160 s comparison. Changed
shot timing, AA acquisition and hydraulic approximations mean this is a behavior-changing
pass, not an equality claim. Equal-duration aftermath remains part of the full-run result.

Accuracy checks separate the exact changes from these approximations:

- Fixed armor contacts match the original query on 2,000 saved-Scharnhorst rays (3,625 hits),
  with additional moving-plate and grazing-contact tests. Exact tetrahedral hull integration
  differs from clipping by at most `4.3e-14` m in buoyancy center over 72 sampled attitudes.
- Across 864 room/fill/attitude samples, the bounded water model's largest error in ship
  center of gravity induced by one room is 2.38 cm. Room water-level error reaches 1.15 m
  for samples at 1–95% fill, and 4.33 m when the 0.1% and fully filled samples are included.
  These local level errors can affect flooding pressure; full-room moments alone do not
  guarantee accurate partial flooding.
- The 100 ms transfer test conserves closed-system water to `1e-9` m³ and stays within
  0.1% of room capacity at aligned update boundaries. Sixty-second, three-breach tests on
  Valiant and Resolute stay within 1 m³ of total water and 2 cm of draft versus per-tick
  transfers. These are tested cases, not universal error bounds.
- Gun-control tests cover short trigger presses, reload/recoil clocks, immediate damage,
  bounded aiming delay and per-tick projectile motion. Swept-clearance differential tests
  retain intermediate poses, moving neighbors and carried mounts.

The standard browser harness also ran the actual Scharnhorst battle, observed 1,080 ticks
over 18 seconds, checked authoritative and rendered gun articulation, and reported no
browser errors. Valiant and Resolute were regenerated through `ship:build`: loading values
changed only by floating-point rounding (under `3e-13` m), while exported geometry payloads
and all fixed-view images remained byte-identical. Their reloaded exports passed articulation.
