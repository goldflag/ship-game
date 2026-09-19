# Working on the Rust simulation

- `naval-sim` is the only simulation. `naval-protocol` adds wire types, `naval-wasm` is the browser worker
  build and `naval-server` the multiplayer server; dependencies run in that order.
- In `naval-sim/src`: `battle/` and `battle.rs` are the tick; `vessel.rs`, `hull.rs`, `motion.rs`,
  `maneuvering.rs` and `mobility.rs` move ships; `weapons.rs`, `gunnery.rs`, `shell.rs`, `impact.rs`,
  `damage.rs`, `flooding.rs` and `floodwater.rs` are combat; `aviation/` is carrier operations; `bots.rs`,
  `captain.rs`, `admiral.rs` and `pve.rs` are AI; `construction*.rs` compile player designs;
  `frame_delta.rs`, `snapshot.rs` and `team_view.rs` are what clients see.
- cargo is not on PATH. `bun run rust:test -- <test-file-stem> [filter]` runs one integration test on the fast
  profile (seconds, not minutes); with no arguments it runs the workspace. `cargo fmt` is safe to run; the
  workspace is format-clean and CI checks it. More in [README.md](README.md).
- `definition.rs` is generated from `src/ships/blueprint.ts` by `bun run multiplayer:definitions`. Frame and
  command types are exported to `src/multiplayer/generated` by `bun run multiplayer:types`; a new root type
  also needs a line in `naval-protocol/src/bin/export.rs`. `tests/frame_types.rs` and
  `src/game/session/frameDelta.test.ts` gate the frame shapes.
- After a Rust change the client needs `bun run multiplayer:prepare:dev` (warm: a few seconds); `bun run check`
  does this and then runs every TypeScript test, because they run the simulation as WASM.
- The simulation stays renderer-free and deterministic: seeded randomness only, no wall-clock time.
- Performance work uses the native profiling harness and equality gate in
  [docs/sim-performance-plan.md](../docs/sim-performance-plan.md); prove behaviour-neutral changes by equality,
  not by eye.
