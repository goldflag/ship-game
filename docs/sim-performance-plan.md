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
  [--dump PATH] [--no-snapshot] [--full-snapshot]
```

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

Surface guns make aim, traverse and fire decisions every six battle ticks (100 ms).
The traverse solver sweeps the entire requested move, including intermediate collision
checks; it does not test just the destination. Active AA and surface weapons with a reload
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

These are simulation choices shared by the native server and WASM worker, independent of
rendering quality. Compare equal requested simulation durations and report battle outcomes
alongside timings; faster destruction of a ship is not proof of a cheaper combat tick.
