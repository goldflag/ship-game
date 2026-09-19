# Rust workspace

Four crates; arrows point at the dependency.

```
naval-sim  <--  naval-protocol  <--  naval-server   (native hub, accounts, persistence)
    ^                 ^
    +-----------------+------------  naval-wasm     (browser build of the same simulation)
```

- `naval-sim`: the whole renderer-free simulation and the ship construction compiler.
- `naval-protocol`: commands, sessions and the wire frame (`frame.rs`, `session.rs`);
  `src/bin/export.rs` writes the ts-rs types into `src/multiplayer/generated/`.
- `naval-server`: `hub.rs`, `worker.rs`, `accounts.rs`, `persistence.rs`, `encoding.rs`.
- `naval-wasm`: one `lib.rs` of wasm-bindgen entry points; built by `bun run multiplayer:prepare:dev`.

## naval-sim module index (`crates/naval-sim/src`)

| Area | Modules |
| --- | --- |
| Battle and tick | `battle`, `mission`, `rules`, `records`, `environment`, `land`, `vessel`, `catalog` |
| Frames to the client | `snapshot`, `presentation` (filter), `team_view`, `frame_delta`, `frame_vocabulary`, `runtime_encoding` |
| Aviation | `aviation/` (`step`, `air_operations`, `aircraft_*`, `deck_*`, `air_search*`, `pve_air`), `anti_aircraft` |
| Construction compiler | `construction` (entry, diagnostics), `construction_*` (custom hull, freeform, geometry, mesh, paths, wall fittings, propellers, propulsion, services, overlap, cache), `definition` (generated), `compartment_geometry`, `installation_clearance`, `mount_clearance`, `mount_frames` |
| PvE and bots | `pve`, `admiral`, `captain`, `bots`, `recon`, `sensors`, `contacts` |
| Navigation and motion | `navigation`, `formations`, `fleet_evasion`, `maneuvering`, `mobility`, `motion`, `machinery`, `collisions`, `hull_contact` |
| Weapons | `weapons`, `gunnery`, `ballistics`, `shell`, `projectile`, `torpedoes`, `depth_charges`, `submarine`, `capability` |
| Impact and damage | `impact`, `burst`, `protection`, `structure`, `damage`, `damage_control`, `breaches`, `flooding`, `floodwater` |
| Hydrostatics | `hull`, `hydrostatics`, `hydro_table`, `stability`, `geometry` |

Integration tests live in `crates/<crate>/tests/<stem>.rs`, one binary per file.

## Test loop

```
bun run rust:test -- construction_deck_fittings            # one naval-sim test binary
bun run rust:test -- construction_deck_fittings railing    # plus a name filter
bun run rust:test -- -p naval-protocol control             # another crate
bun run rust:test                                          # whole workspace, --no-fail-fast
```

This uses the `test-fast` profile (release semantics, no LTO, 16 codegen units, incremental):
an edit-and-rerun of one binary takes seconds, not minutes. CI and `bun run multiplayer:check`
still test `--release`. `build.rs` hashes every `.rs` file into `NAVAL_SIMULATION_BUILD`, so any
source edit recompiles `naval-sim`; the profile keeps that recompile incremental.

`cargo fmt --all` is safe: the workspace is rustfmt-clean with default settings, the check
runs `cargo fmt --all --check`, and the one-time format commit is in `.git-blame-ignore-revs`
(`git config blame.ignoreRevsFile .git-blame-ignore-revs`). `cargo clippy --workspace
--all-targets --locked -- -D warnings` must stay clean. cargo may be off PATH; scripts find
it through `scripts/multiplayer/toolchain.ts` (`~/.cargo/bin`).

## Checklist: add one ship-definition field

1. Declare it in `src/ships/blueprint.ts` (the only schema).
2. If it is a new optional field on a type that saved designs already contain, list it in
   `SERDE_DEFAULT_FIELDS` in `scripts/multiplayer/generate-rust-definitions.ts`.
3. `bun run multiplayer:definitions`; commit the regenerated `crates/naval-sim/src/definition.rs`.
   Never edit it by hand: `generate-rust-definitions.test.ts` fails on any difference.
4. Consume it in the matching `crates/naval-sim/src/construction_*.rs`, with a test under
   `crates/naval-sim/tests/construction_*.rs`.
5. TypeScript editing: add the key to the allow-list in `src/ships/constructionPatches.ts`,
   then `src/ships/constructionCommands.ts` and `constructionEditor.ts` (mirroring, defaults,
   validation), their `*.test.ts`, and `src/game/constructionModel.ts` if it changes the model.
6. `bun run ship:check all`. Changing `constructionModel.ts` or compiler output makes
   `assets/ships/{valiant,resolute}/generated/build.json` stale; rebuild what it names with
   `bun run ship:build <id>`. Never hand-edit hashes.

## Checklist: add one frame-snapshot field

1. Add the field to the Rust struct that travels (`vessel::Vessel`, `aviation::*`, `shell::Shell`,
   ...), with `#[ts(...)]` attributes matching what `presentation.rs` publishes
   (`#[ts(skip)]` for dropped fields, `#[ts(optional)]`, `#[ts(as = ..)]` for projections).
2. `bun run multiplayer:types`; commit `src/multiplayer/generated/`. The check runs
   `scripts/multiplayer/check-generated-types.ts`, which fails when that directory is stale.
3. A new root type needs an `export_all` line in `crates/naval-protocol/src/bin/export.rs`;
   a new nested type needs `d.add::<T>()` in `crates/naval-sim/tests/frame_types.rs`.
4. Gates: `bun run rust:test -- frame_types` (real frames against the declarations) and
   `bun test src/game/session/frameDelta.test.ts` (Rust-encoded updates rebuild the frame;
   needs `bun run multiplayer:prepare:dev` first).
