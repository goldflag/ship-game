# Scenarios

Scenarios are hand-authored historical actions: the forces that fought, where they were, the hour and the
weather, against an opponent that follows its own plan. Victory points decide the result, so a side can win
without sinking everything. The first is **Savo Island** (9 August 1942): the player's screen guards the
transports off Lunga Point through the night while a Japanese cruiser raid comes down the Slot.

A scenario runs on the fleet-command mission path. It is a `PvePlan` with a fixed setup and a scripted raid,
so the chart, orders, the helm, 1×/2×/4× speed, restart and the debrief are the fleet-command ones. The
battle board's **Scenarios** tab (`src/ui/battle/ScenarioMode.tsx`) replaces the catalog and lanes with the
action's briefing and a read-only chart of the owner's dispositions.

## Where things live

| Piece | Code or content |
| --- | --- |
| Order of battle, positions, opening orders, the raid's forces and plans, mission rules | `assets/gameplay/scenarios/<id>.v1.json`, loaded into the manifest by `scripts/multiplayer/content.ts` |
| Loading, generation, the raid script, the briefing and the debrief | `crates/naval-sim/src/scenario.rs` (`PvePlan::scenario`, `RaidScript`) |
| Victory points and the withdrawal outcome | `crates/naval-sim/src/mission.rs` (`MissionObjective`, `score`, `evaluate`), `Battle::withdrawn` |
| Night spotting | `crates/naval-sim/src/sensors.rs` (`VisualConditions::resolve_at`, `night_lookout`, `NIGHT_FLASH_RANGE_M`) |
| Worker entry | `PvePlanner::scenario` in `crates/naval-wasm/src/lib.rs`; `PveDraft.scenario` and the worker's `scenario` message |
| Briefing words, the raid's plans in words, scoring text | `src/ui/battle/scenarios.ts` |
| Clock and protected-ship readout | `src/ui/ObjectiveReadout.tsx`, from `CombatTelemetry.objective` |
| Result: points, why the raid left, its plan | `ScenarioPoints` in `src/ui/report/SeaRail.tsx`, from `BattleDebrief.scenario` |

## The content file

- `groups`: the owner's task groups. Each names its `guide` spawn (chart metres, heading in radians
  clockwise from chart up), a `formation` the followers are laid out on, its `ships` and its opening
  `orders`: `patrol` (a looped route at a physical speed) or `hold` (station keeping). The heaviest ship
  guides, as in fleet command. Battle admission checks every spawn against land, the area and spacing.
- `mission`: trusted mission rules under their own id. `timeout: "victory-points"` requires an `objective`:
  `protectedShipIds` score `protectedPoints` each to the other side when sunk, any other ship scores
  `pointsPerKilotonne`, and `exposedAtDeadline` scores the named side's ships still afloat and not
  withdrawn when the clock runs out. `nightLookout` scales each team's lookout reach short of daylight.
- `raid`: the opponent's one task group. `forces` per difficulty (which also sets its crews), an `entry`
  spawn, the `exits` it may leave by, the column's `speedFraction`, `plans` drawn by `weight` from the seed,
  a `breakFraction` range and a `dawnMarginSeconds`. Each plan has a `route`, `holdSeconds` at the end of
  it and whether it `pressesPastDawn`. Lay routes to pass the owner's groups abeam, not through them: the
  raid's torpedo tubes bear on the beam, and a column met head-on fights with its guns alone.
- `weather`: presets, one drawn per battle. `timeOfDay` names a `times` preset in
  `assets/maps/battle-conditions.v1.json`.

The UI reads the owner's side of the same file for the briefing. The raid's forces and plans are in the
client bundle and the worker's manifest; they are hidden by not showing them, as every mission's are.

## The raid script

`RaidScript::directives` decides every two seconds and never reads hidden state it could not have seen:

1. **Silent approach.** Torpedoes are free from the start; guns stay tight until a raider's torpedoes are
   in the water, a raider is hit, or 90 seconds have passed since the raid first sighted the enemy. The
   script changes the raid's weapons policy (`PvePlan::enemy_weapons`).
2. **Advance** along the plan's route in column. Waypoints passed are dropped, so a new guide after a loss
   picks the route up where the raid is. The raid fires on whatever it sees as it passes.
3. **Strike.** A plan with `holdSeconds` holds at the end of its route, near the objective.
4. **Withdraw** to the nearest exit when its losses pass the drawn break fraction, when the plan is
   complete, or, unless it presses past dawn, when the time left is less than its straight run home plus
   the margin. A withdrawing raider inside `exitRadiusM` of that exit leaves the battle (`Battle::withdrawn`): it stops
   fighting without counting as lost. When no raider is left fighting, the battle ends as a withdrawal.

The owner's ships keep the fleet-command default: torpedoes held until ordered.

## Night

`BattleSetup.timeOfDay` carries the scenario's hour into the simulation. Its `lightScale` (0.22 at night)
shortens every lookout by its square root: a cruiser is seen at about 5 km. A gun flash or a fire aboard
shows a ship out to 14 km (`NIGHT_FLASH_RANGE_M`), bounded by weather and the horizon. Custom and online
battles name no time of day and keep full daylight spotting.

## Checking a scenario

```sh
cargo run --profile test-fast -p naval-wasm --example scenario_soak -- savo-island --seeds 8 --levels easy,normal,hard
```

`scenario_soak` plays seeds headless through the worker's own path with nobody at the helm: each side's
crews and opening orders only. It prints first sightings, losses, torpedoes launched, the plan, why the raid
withdrew and the points. Use it for timing (does contact come early enough, is the battle decided before
dawn) and as a floor for balance: an unled Allied fleet should lose or trade often, so a player's decisions
matter. `crates/naval-sim/tests/scenario.rs` checks legality on every difficulty, the hidden briefing,
the fixed deployment, seed determinism and the points.

## Adding a scenario

Write `assets/gameplay/scenarios/<id>.v1.json`, rebuild content (`bun scripts/multiplayer/content.ts`),
add its words to `SCENARIOS` in `src/ui/battle/scenarios.ts` (a plan without words fails a test), and soak
it. A new objective kind or a raid behaviour the script lacks belongs in `mission.rs` or `scenario.rs`,
driven by what the scenario needs.
