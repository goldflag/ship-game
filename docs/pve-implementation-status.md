# PvE fleet command: current contracts

The desktop PvE loop (port → fleet setup → deployment → battle → results → restart or new battle)
is delivered on the shared Rust simulation. This page lists the contracts to preserve; dated
records are in the [changelog](archive/pve-implementation-status-log.md). See also
[air operations](air-operations.md) and [bot behavior](bot-behavior.md).

## Mission and air rules (trusted content, hashed into the manifest)

- `assets/gameplay/pve-mission.v1.json` (`pve-fleet-v1`): 200,000 t, 15 ships and 100 aircraft
  per fleet; 25 km circular area with a 1.5 km warning margin; elimination by permanent
  incapacity; no deadline; binds air profile `pve-air-v1`.
- `assets/gameplay/pve-air.v1.json`: unlimited active flights; timed endurance with a 30-minute
  order limit, 32-minute recall for every role and 40-minute exhaustion; legacy (compatibility)
  deck cycle. The managed physical deck cycle is implemented and tested in Rust but not selected.
- Carriers author 48 aircraft split 16/16/16. Identities and losses persist through a mission;
  service never recreates a lost aircraft. Custom/online battles keep `legacy-air.v1.json`.

## Rust authority (`crates/naval-sim/src`)

- `pve.rs`: `PveRequest` → `PveBriefing` (friendly and public data only) and the private frozen
  `PvePlan`. The opponent generator tries 256 mutations and accepts 85–115 % of the selected
  displacement and 80–120 % of the capability estimate. `restart_setup` reuses the accepted
  placements, seed and definitions. The WASM side is `PvePlanner` and `restart_pve` in
  `crates/naval-wasm/src/lib.rs`.
- `sensors.rs` and `team_view.rs`: bots and the client act only on permitted observations. The
  team frame carries owned state, whitelisted reports and the owning team's score sheet. Enemy
  health, inventory, orders and true IDs are never serialized before the debrief. Aircraft tracks
  classify as fighter, dive bomber or torpedo bomber only, never owner or state.
- `recon.rs`: coverage in 1 km cells (`CELL_SIZE_M`) with last-observed ages.
- `aviation/pve_air.rs`: enemy air doctrine (patrols, strike budgets, waves, reserve, escorts).
- Speed 1×/2×/4× (`src/ui/SimulationSpeed.tsx`) batches unchanged authoritative ticks, local only.

## Command screen (`src/ui`)

- `FleetCommand.tsx` owns the chart, selection and hotkeys. Orders open on `OrderWheel.tsx` beside
  the selection; ships and air groups share it.
- `fleetFormations.ts` derives formations from escort orders; keys 1–9 select them (air groups
  while the flight line is up).
- `OwnFleet.tsx`, `EnemyFleet.tsx` and `FleetCards.css` are the corner cards. Our column is exact;
  the enemy column is built only from reports.
- `FlightLine.tsx` (Aircraft view): a chip per carrier, a box per group, verbs above, deck popover.
- Glyphs: `shipGlyphs.ts`, `planeGlyphs.ts`, `aircraftNames.ts`; reports cluster through
  `airClusters` in `fleetStats.ts`. Markers fade once the model is legible (`data-map-fade`).
- Hotkeys: G Move, H Hold, E Escort, F Focus fire, C cycle formation, V follow, T take helm;
  air orders L A D I E R S (`SQUADRON_ACTIONS` in `airCommands.ts`). M toggles the chart, which is
  why Move is G. Esc closes the innermost open thing first and the battle menu last.
- Following a ship never takes its helm. Take helm restores the normal helm HUD, sight and minimap.
- Battle setup: `src/ui/battle/` (`PveMode.tsx`, `DeployScreen.tsx`, `DeploymentChart.tsx`). Rust
  validates the whole deployment atomically; a rejected placement keeps the draft.

## Deferred

Attack/torpedo task planning, rally/Execute, managed four-plane deck profile activation, elevator
and hangar visuals, mobile acceptance, maximum-scale performance and matchup balance. Known UI
limits: dense flight labels overlap at whole-map zoom, and groups loitering at one station stack
their labels. The original roadmap is the
[PvE fleet-command plan](archive/pve-fleet-command-plan.md); the selected UI study is
[variation D](pve-ui-studies/README.md) with the
[At the cursor redesign](fleet-command-redesign/README.md).
