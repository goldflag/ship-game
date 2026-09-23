# Bot behavior

Friendly and enemy bots share the same controller and physical weapon/damage rules as the player. Their crew model is provisional gameplay tuning. It adds imperfect information and deliberate variation without changing projectile physics, player aiming, armor or ship assets.

## Which bot path runs

Every hull's decision goes through one captain, `BotCaptain::conn` in `crates/naval-sim/src/captain.rs` (see [the captain seam](#the-captain-seam)), and it takes one of two paths. The switch is `w.reports.is_some()`. `Battle::decide` fills `Watch.reports` only when the battle has `mission_rules`, and only PvE fleet-command missions have them. Custom battles (the local WASM worker) and online matches (`naval-server`) have none, so their bots take the omniscient path.

| | Custom and online (omniscient) | PvE mission (reports only) |
| --- | --- | --- |
| What the crew sees | Every hull in `Watch.fleet`, including its true motion and damage state | Its team's sensor reports (`Sensors`, sampled every 6 ticks, 10 Hz) and its own team's hulls |
| Crew update | `BotState::update` | `BotState::update_contact` |
| Helm | `bots::helm` | `bots::helm_contact` |
| Main-battery target | The standing focus target, else `bots::target` (nearest, 25% hysteresis) | `Sensors::battery_target` for the strongest working battery; `surface_target` when no surface gun works |
| Secondary battery | Follows the main battery's target and crew | Its own crew and target (`Captain::secondary_battery`) |
| Gun aim | `bots::aim` at the hull, with damage-aware aim points | `bots::aim_contact` at the report, with the report's uncertainty |
| Ammunition | `bots::ammunition`, from the class's authored exterior armor | `gunnery.rs`: HE unless the report is classified "Large warship" |
| Torpedo and aircraft evasion | None; only the damage reaction turns away | `fleet_evasion` for reported aircraft and visible torpedo wakes |
| Depth charges | `depth_charges::bot_should_drop` | Never: the target is a contact id, not a hull |
| Carriers | A bot carrier launches every squadron with nothing aloft (`aviation/step.rs`) | Launch on orders only: the player's through fleet command, the enemy's from `PvePlan::enemy_air_directives` |
| Submarine depth | `bots::helm` dives and surfaces | No depth order: a boat keeps its current depth |
| Guide speed with escorts | 85% of the slowest escort's top speed | `navigation::formation_report`: swing reserve and stragglers |

## Where bot decisions live

The AI is not only `bots.rs`, `captain.rs`, `admiral.rs` and `pve.rs`. All paths are in `crates/naval-sim/src`.

| Decision | Code |
| --- | --- |
| Which path runs; standing orders versus the crew; the PvE threat response | `captain.rs`: `BotCaptain::conn` |
| Crew model: skill levels, observation, opening and reacquisition delays, focus areas, aim errors, reload pauses, damage reaction | `bots.rs`: `skill`, `BotState::update` and `update_contact`, `did_fire`, `aim_solution` |
| Custom/online target, helm, ammunition and aim points | `bots.rs`: `target`, `helm`, `ammunition`, `damage_aware_aim_points` |
| PvE target scoring | `sensors.rs`: `Sensors::battery_target`, `Sensors::surface_target` |
| PvE helm | `bots.rs`: `helm_contact` |
| PvE ammunition | `gunnery.rs`: the `Controller::Bot` contact branch of `operate_cadenced` |
| Gun fire gate: range, friendly lane, crew readiness, weapons policy | `gunnery.rs`: `operate_cadenced`; `bots.rs`: `gun_range`, `clear_firing_lane`, `clear_lane_to`, `BotState::ready` |
| Torpedo launch gate | `battle.rs`: `operate_underwater`, with `bots::torpedo_aim` and `torpedoes::clear_torpedo_lane` |
| Depth-charge drop | `depth_charges.rs`: `bot_should_drop`, called from `operate_underwater` |
| Aircraft and torpedo-wake evasion (PvE) | `fleet_evasion.rs`: `visible_wakes`, `command`; then `navigation::safe_correction` |
| Automatic AA target | `anti_aircraft.rs`: `update_observed_at`, through `observable_air` in PvE |
| Routes, stations, escorts, formation speed | `navigation.rs`: `command_observed`, `formation_report`; `formations.rs` |
| PvE group movement and focus targets | `admiral.rs`: `PvePlan::initial_directives`, `PvePlan::enemy_directives` |
| PvE enemy air doctrine | `aviation/pve_air.rs`: `PvePlan::enemy_air_directives` |
| Custom/online bot carrier launches | `aviation/step.rs`: the `Controller::Bot` launch block |
| Mission generation and crew levels | `pve.rs` (your fleet sails at Normal, the enemy at the mission difficulty) |

## The crew model (both paths)

Each bot hull carries a `BotState` with its own seeded generator. The numbers below are for the Normal level; `skill` in `bots.rs` scales them:

| Level | Observation interval × | Opening delay | Reacquire | Tracking settles | Aim error × | Reload pause × | Course held | Damage turn-away above |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Easy | 2.5 | 16–24 s | 7–11 s | 80 s | 2 | 3 | 35–50 s | 35 × `HULL_HP_SCALE` |
| Normal | 1 | 8–14 s | 3–6 s | 45 s | 1 | 1 | 22–38 s | 15 × `HULL_HP_SCALE` |
| Hard | 0.4 | 4–7 s | 1–2 s | 22 s | 0.5 | 0.35 | 14–24 s | 7 × `HULL_HP_SCALE` |

Static and Moving target ships are passive: they never engage. Static holds still; Moving steams at 0.55 throttle on a heading 90° off the one it spawned with.

### Fire control

Guns of 80 mm or less only engage aircraft when a larger gun is fitted, matching the player's manual-fire restriction. Ships fitted only with light guns can still use them against ships. Damage and ammunition loss do not change this fitting-based rule.

- The first target requires 8–14 seconds to acquire, plus 0–2 seconds per mount before it can fire. Changing targets requires a new 3–6 second solution and mount delays. Turret traversal, obstruction, ammunition and reload still gate every shot.
- A bot gun fires only inside its engagement range (`gun_range`: 18 km from 200 mm, 8 km from 100 mm, 3.5 km from 30 mm, 1.8 km below), with a clear friendly firing lane, while its guns policy allows it.
- Tracking quality settles over about 45 seconds on a steady target, and an observed velocity change costs up to 0.35 of it. This approximates a crew establishing a solution; it does not analyze splash locations or implement historical ranging doctrine.
- Crews choose forward, middle or aft hull areas (0.23 of the hull length either side of amidships) and change areas every 18–30 seconds. Each mount has its own longitudinal offset (±4.5% of the hull) and aim height (0.8–3 m). Secondary guns aim 2 m higher. The custom/online path can replace the three areas with damage-aware aim points, below.
- Each mount retains a range/bearing error between shots and revises it after firing. Error scales with range and decreases as tracking settles, retaining residual error. At 5 km the maximum range error falls from roughly 76 m to 19 m; maximum cross-range error is 60% of that. These are aim-solution errors, not random per-shell dispersion.
- A loaded main mount pauses an additional 0.8–3.5 seconds after its physical reload; secondary mounts add 0.2–1.4 seconds.
- Fitted torpedoes obey the same opening/reacquisition delay and lead the delayed observed track. They then use their own tube reload, launch interval, bearing arc, arming/range limits and predicted friendly-lane check. Torpedoes do not use the gun crews' per-mount aim errors or additional gun-reload pauses.

### Helm

Ships with guns of at least 300 mm choose a preferred distance of 4.2–5.8 km; others choose 3.2–4.6 km. Bots approach beyond that distance, bring a broadside to bear nearby, and open the range when too close. Each crew chooses a side and small course offset, holds course/speed decisions for 22–38 seconds, and occasionally (18%) changes broadside.

A drop in hull integrity of more than 15 × `HULL_HP_SCALE` (525 points; Bismarck has 50,750) prompts an 8–14 second turn away at 85% throttle. Below 35% hull integrity, the preferred engagement distance increases by 35%. These reactions are tactical heuristics, not incoming-shell prediction or coordinated retreat.

## Custom and online (omniscient)

These bots read the true fleet. They are what a custom battle or an online match puts on the other side.

- **Targeting.** A standing focus target on an afloat enemy comes first; otherwise the nearest opponent, keeping the previous one unless the nearest is more than 25% closer. Damaged or disarmed ships remain targets while physically afloat. Weapon or ammunition loss does not retire a hull from movement, targeting or tonnage scoring in these battles.
- **Observation.** The crew samples the target's true pose every 0.9–1.8 seconds (× the level's observation interval) and blends its velocity estimate (55% new at Normal). The controller does not read the player's helm or predict future course changes. The damage turn-away is checked at each of these samples.
- **Damage-aware aim points.** `damage_aware_aim_points` reads the target's hidden damage model. Once any of its damage regions is below half strength, the crew scores eight stations along the side facing it: the region's remaining strength plus the best nearby module's remaining strength, weighted 0.9 for magazines and 0.6 for other modules. It also scores each surviving fire-control director at 0.9 × its remaining strength. The three best points replace the forward/middle/aft areas. Bots in this path therefore favour intact sections over magazines, and aim at live fire-control directors.
- **Ammunition.** HE when the gun has it and is under 200 mm, or when the target class's thickest exterior plate is under 80 mm; AP otherwise. If the preferred type cannot fill a salvo, the crew loads the other.
- **Helm.** Evasive turns steer 133° off the target bearing (0.74 π) and turns to open the range 126°; the approach steers 60° off it and the broadside 90°. A ship with fixed torpedo tubes and ammunition (and an intact tube magazine) brings the nearest bow or stern tube bearing toward the observed intercept; ships with trainable launchers do not steer for them. Evasive turns and hull avoidance take precedence; hull avoidance keeps clear of every ship, friend or enemy, within half the two hull lengths plus 180 m.
- **Submarines.** Combat submarines start diving within 1.6 times the range of their usable torpedoes (8 km for Type VIIC). They hold the authored periscope attack depth, capped by the torpedo-launch depth limit, through reloads and turns. They surface beyond 1.8 times weapon range (9 km for Type VIIC) or when no usable torpedoes remain. The different entry and exit distances prevent repeated dive/surface orders near the boundary. Shore avoidance changes course and speed while preserving depth orders. Static and moving target modes stay surfaced. These distances are gameplay heuristics, with no sonar or visibility model.
- **Depth charges.** A ready bot drops when the target is within both hull lengths plus the blast radius, the predicted charge lands within 75% of the blast radius of the target's predicted position, and neither the dropping ship nor an ally will be inside the blast.
- **Carriers.** Five seconds (× the level's observation interval) into the battle, a bot carrier launches every squadron that has nothing aloft, at its target or else the first afloat enemy.
- **No threat evasion.** These bots never turn away from torpedoes or aircraft; that code runs only in the PvE branch of `BotCaptain::conn`.

## PvE (reports only)

Mission captains read their team's reports, never the enemy's hulls. No private enemy equipment, damage or unobserved movement enters any of these choices.

- **Spotting.** Sensors sample every 6 ticks. Surface spotting uses the versioned visual rules: 9–11 km interpolated across hull lengths of 100–260 m. Actual gunfire (including AA) adds 1 km for 20 simulation seconds after the latest shot; terrain, weather and horizon limits still apply. The firing bonus is an observation input, not an automatic contact reveal. These values are gameplay tuning.
- **Targeting.** Captains score their team's permitted reports for their strongest working battery: report classification against calibre (from 200 mm, large warships 1.6, small 0.75, others 1.15; below it, small 1.6, large 0.65, others 1.0), ×1.5 within 4 km and ×1.2 when closing, ×0.35 for a lost report and ×0.25 beyond gun range, all over the distance. A crew keeps its target unless another scores over 25% better. Main and secondary batteries keep independent targets, acquisition delays and firing solutions; secondaries consider only reports within their own range. Explicit focus fire takes priority for both batteries; secondaries can choose another contact when the priority is outside their engagement range.
- **Observation.** The crew takes each new measurement as reported, without blending. A lost report loses tracking quality at a tenth a second, and the report's uncertainty widens the aim error. Reports carry no damage model, so there are no damage-aware aim points. The damage turn-away is checked every tick, so only a drop within one tick counts.
- **Ammunition.** HE when the gun has it and a full salvo of it, unless the report is classified "Large warship"; AP otherwise.
- **Helm.** Evasive turns and turns to open the range both steer 126° off the report's bearing (0.7 π); the approach and broadside angles are as above. Hull avoidance considers only own-team hulls. There is no torpedo-bearing steering and no depth order.
- **Weapons policy.** Guns, automatic AA and discretionary torpedoes have separate addressed permissions. Missions start every ship with torpedoes held (`WeaponsPolicy::fleet_default`); the same flag gates bot depth charges. Other battles allow all three. Bounded attack/torpedo tasks remain tracked in the [PvE implementation status](pve-implementation-status.md).

### Threat response and coordination

Fresh hostile aircraft reports with converging measured motion can trigger an eight-second evasive turn. Torpedo response holds its turn for twelve seconds to develop clearance under inertial movement, and first requires a locally visible wake within 1.5 km, capped by weather visibility and blocked by CPU terrain. These distances and timings are gameplay tuning. Captains do not consult hidden aircraft payloads, attack intentions or unobserved torpedo positions. Stale/receding aircraft reports do not trigger evasion. Temporary turns preserve the route, current waypoint and escort order; local collision/land safety remains prior to the threat correction, and manual helm remains under the player’s control.

Every enemy task group sails in a formation the mission seed chose for it and deploys already on those stations, guide at the group centre. A carrier force keeps a screen around its flight deck; the surface force forms a column when it is a pair, a column or a double column as a division of three or four, and a double or triple column — occasionally a line abreast — once it musters five or more hulls. Re-issued group directives carry the same formation and the follower's slot, so a refresh never quietly flattens a screen into a column or reshuffles guide succession. The enemy commander uses a shared reported threat for group movement and carrier strikes, while surface captains select their own battery targets. Rear carriers withdraw from close reported surface threats; when more than half the original front-line tonnage is physically lost or permanently incapable, surviving front leaders and rear carriers reposition away from the reported threat. Escorts retain or replace their owned leader through the normal group directives. Active CAP can retask to the owned ship nearest a fresh air threat, while strikes retain fighter escort support. Own losses/capabilities may influence these decisions; private opponent damage and unobserved movement may not. This remains a bounded tactical policy, not a full attack/torpedo planner. The enemy admiral re-issues directives every 10 seconds on Easy, 5 on Normal and 3 on Hard.

## Standing orders, navigation and formations

These apply on both paths wherever a ship has a standing order.

Rust fleet orders override autonomous movement with persistent routes, local station areas or an escort leader, formation and slot. Focus fire changes weapon priority without replacing movement. Navigation plans around authored island ellipses, makes local collision corrections, reserves escort catch-up speed and forms a column where an assigned slot is obstructed. These policies live in `crates/naval-sim/src/navigation.rs`; temporary corrections retain the standing order.

Every actor leaves a breadcrumb trail: its own track, recorded outside its navigation state so manual helm, bots and standing orders all leave the same wake. A point is kept each 20 m of travel and about 8 km of track is retained. Each ship also carries a formation axis that turns toward its own course the short way round at three degrees a second.

**Column**, **double column** and **triple column** slots steer for the point on the guide's trail at the ordered distance astern, with their lateral offset applied at the heading the guide held there, so every column of the body turns in succession and holds the guide's track through a turn instead of cutting the corner. The slot slides along that track at the guide's current speed, so a follower keeps pace without sprinting sideways and drops back as soon as the guide slows; it also leaves itself room to shed catch-up speed rather than running past a guide that is stopping. A slot ahead of the guide, abeam of it, or further astern than the recorded track reaches, keeps the heading-relative station instead, so a side column's lead ship swings with the guide's bow. **Screen** and **line abreast** slots are fixed to the formation axis rather than the guide's instantaneous heading, so the body turns together and reorients as the axis catches the new course. Reorienting a screen is a real manoeuvre: the outer slot has to run most of a quarter circle of its own radius relative to the guide, and that takes a few minutes.

Outer slots reserve extra guide speed in proportion to how fast their station is actually swinging: a column slot riding the guide's track never swings and reserves nothing, an axis station reserves only what the bounded axis rate demands, and a heading-relative station reserves as before. The straight-line 85% reserve is unchanged. A screen changes to column when the connecting slot or its short forward path crosses land, and keeps that column for ten seconds to avoid repeated switching. Damage-aware formation reports identify escorts whose available propulsion cannot sustain the requested pace, measured against the same station the captain steers for. The owner explicitly chooses **Slow for stragglers** or **Leave stragglers**; the default awaits that decision without silently slowing or deleting escort orders. A healthy ship deployed far from its slot does not trigger a damage warning. The real-hull checks cover the narrow passage/turn, a multi-ship column through a 90-degree turn, a carrier screen turning together and a ten-minute damaged-escort comparison in which the accepted slowdown restores formation. This reserve and the straggler check come from `navigation::formation_report`, which the captain computes only in missions; elsewhere a guide keeps to 85% of its slowest escort's top speed.

Both fleets take their stations from one table, `crates/naval-sim/src/formations.rs`, mirrored in `src/ui/formationStations.ts` and pinned to the same numbers by tests on each side, so the shape the deployment chart draws is the shape the escort orders sail. Followers are ordered by role — heavies first, then cruisers, auxiliaries, destroyers and boats, ties keeping the caller's order — and that order is also the slot order. The interval `d` between ships is 450 m behind a heavy guide, 400 m behind an auxiliary and 360 m otherwise: close order, so a group reads as one body and the guide's escorts stay inside gun and lookout range. A column puts each follower another `d` astern; a line abreast alternates them `d` to starboard and port; a double column adds a second column `d` to starboard with the guide leading the port one; a triple column puts a column `d` to either side of the guide's own centre column, each rank filling before the next begins. A screen rings the guide at 700 m with the destroyers and submarines pushed out to 1300 m, the first ship of each ring dead ahead and the rest alternating to either quarter. No station the table produces is closer than the 350 m the protocol accepts or further out than 5000 m.

When a guide is physically lost, the surviving escort with the lowest slot takes over its standing order and the rest of the formation re-forms on that ship. This happens in the authoritative order store, so it survives for both the player's fleet and the opposing admiral, and the owner is told with a fleet notice reading "<ship> has the guide". A leader that simply vanishes from the actor list still produces a local hold. PvE task groups sail in the cruising formation chosen for them at deployment.

A captain caught inside the extra 150 m shoreline planning buffer can plan an outward departure while preserving the conservative coastline and full hull clearance. Only the first leg may leave an already-entered buffer; it cannot move closer to the island or cross another obstacle. Later legs and destinations keep the full planning margin. This prevents a clear-water ship from remaining blocked solely because every outgoing graph edge included its starting point inside the buffer.

## The captain seam

Every hull's decisions cross one interface, `crates/naval-sim/src/captain.rs`. Standing orders reach `Battle::step` as one stream of `Orders` whether the player relay wrote them (protocol commands through the session) or the PvE admiral did (`crates/naval-sim/src/admiral.rs` emits per-ship movement and focus directives that the local runtime copies into the same standing-order store). `step` then hands each afloat vessel's view of the world (`Watch`: the fleet, the team's permitted reports in a mission, islands, trails, wakes), its crew memory (`Crew`: the seeded crew model and the navigation state, lifted off the hull for the decision and restored afterwards) and its standing orders to the captain, which returns one `Decision` — the helm and what the batteries engage — applied in one place. The seeded crew is the `BotCaptain` adapter; `Battle::set_captain` swaps in another, and `tests/captain.rs` scripts one. The extraction is bit-identical: the crew consumes its generator in the same order the inline loop did, which the simulation equality gate checks.

## Reproduction and validation

`BattleSetup.seed` is an unsigned 32-bit integer. The browser picks a fresh random seed for each prepared custom battle (`LocalBattleSession`), a mission uses its mission seed, and the port's idle session uses `0x6e617661`. Crew memory (`Vessel.bot`, plus `secondary_bot` in missions) serialises with the hull and carries its own generator, seeded from the battle seed and the hull id. Aim queries do not advance randomness. Simulation ticks alone advance observation and decision timers, so pausing and display frame rate do not change the outcome. Ballistic lead includes drag and inherited ship velocity.

A development build exposes the seed as `window.shipTrialDiagnostics().battleSeed`.

Tests: `crates/naval-sim/tests/captain.rs` (decisions as values, standing orders taking the conn, scripted captains), `observed_targeting.rs` (unobserved opponents create no targets; unseen course and damage cannot change a mission captain or gun solution; batteries choose suitable contacts and respect focus orders), `navigation.rs` (torpedo-wake acquisition and dodges), `pve_generation.rs` (admiral directives) and `crates/naval-protocol/tests/pve_air_doctrine.rs`. The simulation equality gate in [simulation performance](sim-performance-plan.md) keeps the crew's random draws bit-identical across refactors.
