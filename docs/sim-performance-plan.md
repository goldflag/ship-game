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
- Yamato's swept `mountClearance` profile is gone from her blueprint; tests keep it as
  `src/simulation/fixtures/yamato-swept-clearance.json`.

## Remaining

- Constructed ships are still mesh-bound. Compiler-level options, all changing compiled output:
  a hydrostatic table, exterior-only clearance bodies and armor, one portal per room pair.
- Every ship solves stability on the same tick; staggering it would change premade results.

Measurements, per-phase tables and rationale: [archived log](archive/sim-performance-plan-log.md).
