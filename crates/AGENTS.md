# Working on the Rust simulation

- `naval-sim` is the only simulation. `naval-protocol` adds wire types, `naval-wasm` is the browser worker
  build and `naval-server` the multiplayer server; dependencies run in that order.
- In `naval-sim/src`: `battle/` and `battle.rs` are the tick; `vessel.rs`, `hull.rs`, `motion.rs`,
  `maneuvering.rs` and `mobility.rs` move ships; `weapons.rs`, `gunnery.rs`, `shell.rs`, `impact.rs`,
  `damage.rs`, `flooding.rs` and `floodwater.rs` are combat; `aviation/` is carrier operations; `bots.rs`,
  `captain.rs`, `admiral.rs` and `pve.rs` are AI; `construction*.rs` compile player designs;
  `frame_delta.rs`, `snapshot.rs` and `team_view.rs` are what clients see.
- Bots take one of two paths, chosen in `captain.rs` by `w.reports.is_some()`, which is true only in a PvE
  mission. Custom and online bots are omniscient (`BotState::update`, `bots::helm`, `bots::target`,
  `bots::ammunition`); PvE bots see reported contacts only (`BotState::update_contact`, `bots::helm_contact`,
  `Sensors::battery_target`, the ammunition rule in `gunnery.rs`), and only they evade torpedoes and aircraft.
  Bot decisions also live in `sensors.rs`, `gunnery.rs`, `battle.rs` (`operate_underwater`: the torpedo and
  depth-charge gates), `fleet_evasion.rs`, `depth_charges.rs`, `anti_aircraft.rs`, `navigation.rs` and
  `aviation/`: see [where bot decisions live](../docs/bot-behavior.md#where-bot-decisions-live).
- cargo may not be on the agent shell's PATH: call `$HOME/.cargo/bin/cargo`, or use the bun scripts, which
  find it (`scripts/multiplayer/toolchain.ts`). `bun run rust:test -- <test-file-stem> [filter]` runs one
  integration test on the fast profile (seconds, not minutes); with no arguments it runs the workspace. More
  in [README.md](README.md).
- Run `cargo fmt --all` before committing Rust changes; `bun run multiplayer:check` (and CI) runs
  `cargo fmt --all --check` and rejects unformatted code. Plain `rustfmt <file>` defaults to edition 2015,
  not the workspace's 2024, and fails on let-chains: pass `--edition 2024` or use `cargo fmt`.
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

## Native test prerequisites

- 36 of the 64 `naval-sim` integration test files, several unit tests (`catalog.rs`, `impact.rs`, `aviation/`,
  ...) and some `naval-protocol`, `naval-server` and `naval-wasm` tests read
  `.build/naval-content/manifest.json` (ships, maps, rules, hydrostatics) and panic without it.
  `bun run bootstrap` writes it, and so does `bun run multiplayer:content` on its own (about a second, no
  `node_modules` needed). Rerun it after a ship, map or rules change.
- A cold `cargo test --release -p naval-sim` builds every test binary with thin LTO and one codegen unit, so
  it takes minutes (one session measured about eleven): run it in the background, or iterate with
  `bun run rust:test`, which uses the `test-fast` profile.

## Run a construction design in a native test

`crates/naval-wasm/examples/custom_cost.rs` runs saved designs through the worker's own path
(`LocalRuntime::with_construction`, which calls `Catalog::with_construction_catalogs`). The test
`trainable_torpedoes_use_one_absolute_rotation_for_sockets_damage_and_launch` in
`tests/construction_acceptance.rs` builds a `Battle` directly, as below.

- A repository ship's `assets/ships/<id>/blueprint.json` deserializes directly as a `ConstructionSource`;
  the parts catalog is `public/models/components/catalog.json`, a `ConstructionCatalog`.
- `Catalog::load(&manifest)?.with_constructions(&[source], &parts)?` compiles the design into a copy of the
  content catalog. Then `catalog.compile(&id)` gives the `CompiledShip` that `Battle::new` needs.
- The battle's `preset_id` is the compiled definition's id, not the source id: the compiler names it
  `local-<source id, up to 32 characters>-<first 16 hex digits of the content hash>`. Read it from
  `construction::compile(&source, &parts).definition` or find it in `catalog.definitions`.
