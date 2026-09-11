# Review of the PvE fleet-command draft

| Item | Value |
| --- | --- |
| Reviewed draft | `docs/pve-fleet-command-plan.md`, unchanged in this worktree |
| Draft SHA-256 (supplied by the coordinator; not recomputed here, no shell was available) | `6107017a38d171905def9071fe01c81d54aacac2a2277049ae0fdede6c6fd9fe` |
| Source baseline | `origin/master` at `5d1453396f9be3a810c8c7abc46f0c10958655ae` |
| Reviewer | Claude Fable 5.1 (`claude-fable-5-1`), read-only session on 2026-09-08 |
| Method | Read the draft, `AGENTS.md`, `README.md`, `docs/README.md`, `docs/air-operations.md`, `docs/bot-behavior.md`, `docs/rust-multiplayer-implementation.md`, the earlier Rust multiplayer reviews, and the current Rust crates, session layer, UI and blueprints cited below. No tests, builds, benchmarks or browser sessions were run. |

Tags used below: **[Verified]** read in source at the baseline. **[Inference]** reasoning from verified facts, not measured. **[Decision]** needs the user's call.

## Verdict

The draft's product direction, order semantics, information-boundary requirements and deck-logistics intent are sound and worth keeping. Its technical half is written against the retired TypeScript engine. Active custom and online combat now runs in Rust (`crates/naval-sim`, `naval-protocol`, `naval-wasm`), the browser only sends addressed commands and consumes snapshots, and the TypeScript simulation is a frozen migration reference (`README.md:158-160`, `src/game/session/README.md`). Every "likely file" the draft names for orders, observation, AI, air logistics and mission rules is therefore wrong, and implementing the plan as written would recreate the second simulation the repository rules forbid.

Beyond file names, five things must be re-planned before any slice starts: a versioned per-battle mission/air ruleset (rules are currently a single global default), a team-scoped snapshot (the current one is omniscient), an observation layer that the bots and aircraft actually consume (all AI targeting is omniscient and range-unlimited today), a place to put mode-specific air-wing parameters that does not force carrier model rebuilds, and an aircraft count in the fleet validator (it counts tonnage and carriers only). The draft also sequences the sensor layer after the mission and generator, which leaves an enemy that converges on the player from tick zero and a carrier AI that is literally scripted to launch everything five seconds after start.

On the user's main gameplay worry: the proposed systems slow a full-wing alpha strike from roughly ten seconds to roughly five minutes; they do not change the incentive. With no airborne cost and no active-flight cap, "launch everything, then find them" is a free option, and current fighter and AA tuning is too weak to punish it. That needs a deliberate intervention (section 4), not a hope that fog of war and lift timers suffice.

Recommendation: revise the draft along the lines below and keep most of its design content. The smallest playable milestone should be a surface-only PvE elimination battle with fog of war and reliable escorts, before any carrier logistics work.

## 1. Findings

Ordered by severity within each group. Line numbers refer to the baseline commit.

### 1.1 Blockers and outdated source assumptions

**B1. The draft targets the retired TypeScript engine.** [Verified]
Evidence: the draft's "What exists" section and its boundary table cite `src/simulation/battle.ts`, `combat.ts`, `bots.ts`, `aircraft.ts` as the runtime and propose `fleetOrders.ts`, `sensors.ts`, `contacts.ts`, `battleView.ts`, `fleetCommander.ts`. Current custom battles go `Game.prepareBattle` → `LocalBattleSession.create` (`src/game/Game.ts:441`) → `local.worker.ts` → `LocalRuntime` (`crates/naval-wasm/src/lib.rs:175-228`) → `naval_protocol::session::Session` (`crates/naval-protocol/src/session.rs`) → `naval_sim::battle::Battle::step` (`crates/naval-sim/src/battle.rs:285-589`). The session README states the main thread never resolves combat.
Consequence: orders, sensors, contacts, AI, deck logistics and mission rules must be Rust modules in `naval-sim`, exposed through `naval-protocol` commands and `naval-wasm`; TypeScript owns setup UI, HUD and presentation only. A `contacts` module already exists in Rust and means shell-to-hull contact geometry (`crates/naval-sim/src/contacts.rs`), so the draft's `contacts.ts` name collides; use `sensors`/`tracks`.
Correction: replace the "Technical boundaries and likely files" section (see section 6). Also correct the draft's "CombatSimulation has one permanent `player` actor": the Rust session already has per-player `selected_ship_id`, per-ship ownership, `Select`, standing `Move`/`Hold`/`Autonomous`/`Focus` orders and dormant bot memory on every ship (`crates/naval-protocol/src/lib.rs:91-112, 204-308`; `battle.rs:139-145`).

**B2. The snapshot is omniscient and there is no team-scoped view anywhere.** [Verified]
Evidence: `presentation_value` strips only bot tracking caches, RNG and shell ledgers (`crates/naval-sim/src/snapshot.rs:53-98`) and sends every actor with full damage state, every wing and plane, all shells, torpedoes, events and per-ship records. The client rebuilds all actors (`src/game/session/SnapshotSession.ts:104-133`); telemetry lists every actor as a contact including what each enemy is targeting (`src/simulation/presentation.ts:87-88`); the HUD roster shows enemy hull percentages (`src/ui/BattleStatus.tsx:24-28`); the chart draws all ships and all aircraft (`src/ui/NavigationChart.tsx:24-30`). The online worker publishes one frame shared by both players (`crates/naval-server/src/worker.rs:382-419`).
Consequence: fog of war cannot be a UI filter. It has to be `presentation_value(viewer: TeamId)` in Rust, applied inside the WASM worker before JSON leaves it, and per-player frames online. Online cost doubles update encoding, which already averages about 13 ms per update in carrier battles (`docs/rust-multiplayer-implementation.md:76-78`); PvE is unaffected but the API should be designed once.
Correction: make the team-filtered snapshot an explicit prerequisite slice. Extend the draft's leak audit with: `events` (all damage events with positions drive effects for unobserved ships), `records.scores`/damage logs for enemy ships, each enemy's `targetId`, `shellHistory`, and `SnapshotSession.target ??= first enemy` plus `presentationTelemetry`'s unconditional `view.target` dereferences (`presentation.ts:80-98`), which the draft's "focus target may be absent" rule already requires.

**B3. All AI target acquisition is omniscient and range-unlimited; there is no search behaviour to build on.** [Verified]
Evidence: `bots::target` picks the nearest surviving enemy at any distance (`crates/naval-sim/src/bots.rs:382-403`) and `bots::helm` steers toward it at 0.5–0.8 throttle (`bots.rs:428-532`); mounts fire whenever within `gun_range` (18 km for 200 mm and above, `bots.rs:278-289`, `gunnery.rs:167-168`); bot-controlled carriers launch every squadron at the first valid enemy once `time >= 5 s × reaction scale` (`crates/naval-sim/src/aviation_step.rs:404-429`); strike aircraft re-find their target actor by ID every tick (`aviation_step.rs:994-999`); fighters engage any enemy plane within 6.5 km of themselves and 7.5 km of their anchor (`aircraft_tactics.rs:7-75`); AA engages the nearest airborne enemy within its range (`anti_aircraft.rs:82-93`); damage-aware aim points read the target's internal damage (`bots.rs:317-365`).
Consequence: hidden deployment and enemy generation achieve nothing while the enemy sails straight at the nearest player hull from tick zero and its carrier alpha-strikes at t≈5 s. The draft places the contact boundary at slice 4, after the mission (slice 3). That order produces a "PvE mode" that plays exactly like Custom battle with a randomized roster.
Correction: move sensors/tracks and AI consumption ahead of the mission slice (section 5). The minimal invasive shape is a per-team track table in `Battle`, a `visible(&Vessel) -> bool` predicate passed to `bots::target`, the bot carrier launch path and `Aviation::valid_order`, and a strike order that carries a track ID with last-known position and a "searching" state instead of homing by actor ID. In Custom mode the predicate is always true, so fixtures and online behaviour are unchanged.

**B4. Mission rules are one global default; the draft's elimination rules cannot be expressed, and its "consistent with existing treatment of disabled hulls" claim is outdated.** [Verified]
Evidence: `Rules::default()` loads `assets/gameplay/battle-rules.v1.json` (`crates/naval-sim/src/rules.rs:31-35`); `Battle::new` stores `Rules::default()` (`battle.rs:210`); `evaluate_outcome` declares destruction only when one side's afloat tonnage is zero and otherwise awards the tonnage leader at the deadline (`rules.rs:186-206`); `BattleSetup` has no mode or rules field and rejects unknown fields (`battle.rs:41-50`); `remaining_seconds` in every snapshot comes from the global default (`snapshot.rs:44-46`); the catalog rejects manifests whose `rulesVersion` differs (`catalog.rs:69-74`). Disarmed or immobile hulls count as afloat (`README.md:52`, `rules.rs:178-184`) and bots keep targeting them (`bots.rs:389`).
Consequence: draw-on-timeout, "permanently unable to participate" and any boundary rule need a per-battle `MissionRules` value carried in `BattleSetup`, defaulted to today's custom/online behaviour so existing fixtures, the server and the rules-version handshake are untouched.
Correction: add `mission: Option<MissionRules>` (versioned) to `BattleSetup`, regenerate ts-rs types, and define `Elimination { deadline_ticks, deadline_result: Draw, eliminated: PhysicalLoss | PhysicalLossOrCombatLost, bounds: Option<Area> }`. The sticky `combat_lost` flag already encodes the draft's carrier caveat: a carrier with armed airborne aircraft or reserves plus a working service module is not `combat_lost` (`crates/naval-sim/src/capability.rs:35-50, 90`). Whether `combat_lost` should count as eliminated is a **[Decision]** (section 7).

**B5. The enemy roster and its size leak through the setup object and the map geometry.** [Verified]
Evidence: `runtimeSetup` builds one `BattleSetup` containing every ship of both teams and hands it to the worker and to `SnapshotSession.setup` (`src/game/session/LocalBattleSession.ts:9-15, 24`); `SnapshotSession.apply` throws unless every snapshot actor matches that setup (`SnapshotSession.ts:105-107`); island positions are a function of the larger team's size on both the Rust and TypeScript sides (`crates/naval-sim/src/environment.rs:322, 340`; `src/maps/catalog.ts:19-24`); `Game.replaceFleet` loads every actor's model and prints "Spotting the air wing" whenever any ship on either team carries aircraft (`src/game/Game.ts:519`); the spawn planner requires and displays enemy slots (`src/ui/SpawnPlanner.tsx:14-19`; `src/simulation/battle.ts:95-97`).
Consequence: a wider deployment lane on the chart tells the player the enemy has more ships; the loading text tells them there is an enemy carrier. The draft already forbids both leaks but does not identify that the map recipe and the loading path are the sources.
Correction: PvE map geometry must be authored independent of team sizes (the draft says this; add that `resolve_environment` and `mapIslands` need a mode-independent lane parameter); load models by preset set without naming roles; keep enemy IDs opaque in the setup the UI sees. Because PvE is local, the roster is necessarily on the client; the draft's "not anti-cheat" statement covers that, but the chart and loading text are gameplay leaks, not cheating.

**B6. Air commands reach only the selected ship, the map opens only for a selected carrier, and unselected bot carriers launch everything automatically.** [Verified]
Evidence: `SnapshotSession.commandSquadron` and `recallAircraft` always send `this.ship.id` (`SnapshotSession.ts:179-181`); `Game.setAirOperationsOpen` returns unless the selected ship has an air wing (`Game.ts:804`); flight selection and launch use `squadronFlights(this.simulation.player)` (`Game.ts:753-766`). The protocol itself accepts air orders for any owned ship (`crates/naval-protocol/src/lib.rs:255-260`; `session.rs:49-53`). Any owned ship whose controller resolves to `Bot` runs the automatic launch path (`aviation_step.rs:408-429`; controller resolution at `session.rs:95-102`).
Consequence: the draft's "aircraft groups from all friendly carriers are commandable" and "issuing orders to one air group must not cause hidden launches of the others" both require a Rust-side per-ship air policy (`Manual | Automatic`) in addition to the client refactor. The earlier multiplayer review flagged the same limitation and it was deferred (`docs/reviews/rust-multiplayer-review-disposition.md:33`).
Correction: add `AirPolicy` to `ShipControl`/`Orders`; default `Automatic` for bots so Custom and online are unchanged; PvE friendly ships default `Manual`.

**B7. "Remove maxActiveFlights and endurance" touches at least eight hard-coded rules, several shared with Custom and online, and the frozen fixtures.** [Verified]
Evidence: endurance loss at 1050 s and forced return at 470 s (`crates/naval-sim/src/aircraft.rs:120`; `aviation_step.rs:631-636`); fighters return at 260 s regardless (`aviation_step.rs:1245`); orders rejected for planes past 470 s (`aviation.rs:150`); recovery priority by endurance (`aviation_step.rs:204-216`); active-flight cap defaulting to 4 (`aviation.rs:215-228`); a flight may launch only when every member is `ready` or `lost`, so a partially rearming group cannot go (`aviation.rs:236-241`); deck slots are assigned only when spotting for launch or landing, and a ready plane is evicted to the hangar to make room (`aviation_step.rs:169-194`), so "24 on deck at start" has no representation; launch cadence is derived from a fixed ten-second whole-flight target (`aviation_step.rs:556-558`); depleted groups auto-merge after landing (`aviation_step.rs:225-313`). Blueprint validation caps `flightSize` at 6, `deckCapacity` at 24 and `maxActiveFlights` at 4 (`src/ships/blueprint.ts:719-724`). Aviation and flight behaviour are frozen in `assets/gameplay/migration/aviation.v1.json` and `flights.v1.json` and compared by `multiplayer:check`.
Consequence: slice 5 is a new versioned `AirRules` value (group size, startup deck/hangar split, deck capacity, lift and launch timings, service ceilings, endurance thresholds, merge policy, active cap) selected per battle, not a deletion of one field. If the values are changed globally, Custom and online change too and the fixtures must be deliberately refreshed.
Correction: specify `AirRules` in `MissionRules` with today's values as the default; PvE supplies its own. Do not delete the endurance counters: set the PvE thresholds to mission length (section 4.1).

**B8. Changing a carrier's authored complement or flight size forces a model rebuild and a content-hash change.** [Verified]
Evidence: the air wing lives in the blueprint (`assets/ships/enterprise-cv6/blueprint.json:93675-93715`, `assets/ships/shokaku/blueprint.json:32557-32597`); the published `contentHash` is a digest of the compiled definition plus recipes (`scripts/ships/pipeline.ts:35`); the GLB embeds that hash and the game refuses mismatches (`pipeline.ts:77`); the server manifest and the join handshake pin it (`scripts/multiplayer/content.ts:12`; `crates/naval-server/src/hub.rs:132-134`).
Consequence: the user's 16/16/16 Enterprise is not a tuning edit. It is a `ship:compile`, `ship:build`, review-views and manifest change for Enterprise, and any Shokaku regrouping is the same. The draft acknowledges "definition changes may require rebuilt GLBs" but then proposes exactly such changes as routine.
Correction: keep the blueprint as the physical inventory and put mode-tunable operating parameters (group size, startup split, timings) in a gameplay asset keyed by preset ID, alongside `battle-rules`. Whether the authored 18/18/12 inventory itself changes is a **[Decision]**.

**B9. The fleet validator counts tonnage and carriers only; Shokaku's 72 aircraft dominate the 100-aircraft budget.** [Verified]
Evidence: `validate_fleet` and `FleetEntry` (`rules.rs:66-72, 107-144`); Enterprise 48 and Shokaku 72 aircraft (blueprints above; `docs/air-operations.md:3-5`); a single blueprint may carry up to 96 (`blueprint.ts:734`); tonnage from `public/models/*.json`: Enterprise 25,910 t, Shokaku 32,105 t.
Consequence: Enterprise + Shokaku is 120 aircraft and illegal; two Shokakus is 144. Under the user's cap Shokaku is always a team's only carrier, with 28 aircraft of headroom that no current preset can fill. The draft discusses only "two revised Enterprises use 96".
Correction: add an aircraft count to `FleetEntry` derived from `air_wing.squadrons`, validate it in `validate_fleet`, show it in the fleet UI, and state the Shokaku consequence in the budget section. The Shokaku complement itself is a **[Decision]** (section 7).

### 1.2 High: design or sequencing gaps

**H1. Movement orders are too primitive to build escorts on, and the draft underestimates that.** [Verified]
Evidence: `Move` is proportional steering toward one point with throttle clamped to 0.2–0.8 (never full speed), an 80 m arrival radius, land avoidance only and no friendly-ship avoidance (`battle.rs:334-357`); `Hold` is a zero helm, so the ship coasts and drifts with wind (`battle.rs:336`; `environment.rs:88-95`); `Autonomous` charges the nearest enemy. There is no speed, heading, waypoint list, formation or leader concept. The one good news: movement and fire priority are already independent fields (`ShipControl.movement`, `target_id`; regression at `crates/naval-protocol/tests/control.rs:30-93`), which is the draft's key escort property.
Correction: extend the Rust `Movement` enum with `Route { points, speed }`, `HoldArea { center, radius }`, `Escort { leader, slot }`, `Attack { track }`, and add `weapons: Free | Hold { aa: bool }`. Formation slots, leader speed capping and `avoid_ships` belong in Rust next to `bots::helm`, not in a TypeScript `fleetNavigation.ts`.

**H2. Elimination without a battle boundary is unwinnable against a kiting carrier.** [Verified, consequence Inference]
Evidence: the only spatial limits are the 40 km spawn and command bounds (`battle.rs:166-174`; `naval-protocol/src/lib.rs:146`); no turn-back or out-of-bounds rule exists. Authored top speeds from `public/models`: Fletcher 18.5 m/s, Shokaku 17.5, Enterprise 16.7, Bismarck 15.4, King George V 14.4, Yamato 13.9.
Consequence: a Shokaku fleeing at full speed covers about 30 km in the 30-minute window and no battleship catches it. The draft names captain turn-back as the mechanism but leaves the area undefined and does not say what happens to a player-piloted hull that ignores warnings.
Correction: put `bounds` in `MissionRules`; AI captains turn back through the existing `avoid_land` pattern; player-controlled hulls get a warning and a visible grace timer after which the hull counts as withdrawn for elimination. This constrains player movement and is a **[Decision]**.

**H3. Sortie arithmetic leaves room for one to two full-wing cycles in 30 minutes, not "repeated sorties".** [Inference from verified constants]
Constants: cruise and strike speeds 75–85 m/s (`aviation_step.rs:1076, 1104, 1194`); draft timings of 15–20 s per launched group, 20–30 s per lift, 30–45 s deck rearm; recovery serialises on one runway with 60 m final spacing and 1.2 s rollout (`aviation_step.rs:849-858, 590`).
Estimate for a 48-plane wing at 12 km: bring up and launch 12 groups ≈ 5–6 min, transit ≈ 2.5 min, attack ≈ 1–2 min, return ≈ 2.5 min, recover 48 aircraft one at a time ≈ 4–8 min, rearm ≈ 1–2 min. Roughly 17–25 min per full cycle.
Consequence: "repeated aircraft sorties should all affect the result" is only true for small groups cycling continuously, which is exactly the play pattern the alpha-strike incentive discourages. Measure this; do not assume the 30-minute target and the deck timings are compatible until first playtests report sortie counts.

**H4. Recovery deadlock and group semantics need explicit states that the draft only names.** [Verified]
Evidence: aircraft under 25 HP return automatically (`aviation_step.rs:635`); recovery is refused while the service module is unavailable and returning aircraft marshal indefinitely (`aviation_step.rs:764-781`); on a sunk carrier airborne aircraft climb to 180 m over the wreck forever (`aviation_step.rs:731-740`); deck and hangar aircraft are destroyed with the carrier (`aviation_step.rs:514-519`); auto-merge happens only after every survivor is in the hangar and the merged group leaves the roster (`aviation_step.rs:225-313`; `docs/air-operations.md:13`).
Consequence: with 24 deck slots, a 48-plane wave returning together parks 24 in the marshal orbit while 24 rearm, and none of the second half can land until the first half launches or goes below. Without a default "send below when deck above N%" policy the player is forced into deck micromanagement at the worst moment, which contradicts the draft's workload goals.
Correction: specify the default deck policy as a visible setting; keep the current merge rule (it already matches "hangar-only, preserve the earlier ID") but surface it in the UI rather than promising no merges.

**H5. Tactical pause and queued orders are only possible for local WASM battles.** [Verified]
Evidence: the online worker advances on server time and aborts on lag (`worker.rs:293-307`); locally, `Game.setPaused` stops `advance` calls and commands accumulate in `LocalBattleSession.commands` until the next advance (`LocalBattleSession.ts:44-53`), but `Game.commandSquadron`/`orderFlight` refuse while paused (`Game.ts:767-768`) and `SnapshotSession.input` skips outside `running` (`SnapshotSession.ts:154`).
Consequence: choosing pause fixes PvE to the local worker or to a future dedicated PvE server mode without pause. The draft should state this dependency; it currently lists multiplayer authority as merely "deferred".

**H6. Restart cannot repeat a battle today.** [Verified]
Evidence: `LocalBattleSession.create` draws a fresh random seed (`LocalBattleSession.ts:24`); `SnapshotSession.reset` is a no-op (`SnapshotSession.ts:92`); returning to port replaces the session.
Correction: carry `seed`, generation version and the resolved roster in the PvE setup record and expose Restart (same seed) and New battle (reroll) as the draft describes. Cheap, but it is new plumbing, not existing behaviour.

**H7. Performance headroom is unmeasured for the draft's stress case and the local scheduler dilates time rather than catching up.** [Verified, consequence Inference]
Evidence: native measurements are 8 ships per side with 72 airborne aircraft at mean 1.3 ms and p99 11 ms per tick, and 60 ships with 288 aircraft at p99 54 ms (`docs/rust-multiplayer-implementation.md:76-80`); no WASM-in-worker figures exist; the local session caps its accumulator at 0.1 s and sends at most six ticks per message (`LocalBattleSession.ts:48-52`; `naval-wasm/src/lib.rs:206-213`).
Consequence: if a sensor pass plus 30 ships and 200 aircraft exceeds real time in WASM, simulation time silently runs slower than wall time. That is fair in PvE but it corrupts "30-minute" pacing measurements and the 108,000-tick deadline. Add a visible simulation-rate indicator to the diagnostics and measure in the browser worker, not only natively.

### 1.3 Medium and low

**M1. Roster reality.** [Verified] `src/ships/presets.ts` registers 12 presets: 8 combatants (Bismarck, Yamato, King George V, Baltimore, Enterprise, Shōkaku, Fletcher, Flower corvette), 3 merchants and Type VIIC. With one destroyer and one corvette, any 15-ship fleet is Fletcher-heavy by construction, and enemy archetypes can be enumerated rather than sampled. The draft's "controlled duplication" must permit many identical escorts.

**M2. Submarine exclusion is correct and the evidence is current.** [Verified] Aircraft refuse targets below 8 m (`aviation.rs:164`; `aviation_step.rs:998`), bots ignore hulls below 20 m for avoidance and lanes (`bots.rs:414, 626`), and only Fletcher carries depth charges. Keep the exclusion.

**M3. Per-carrier service modules differ.** [Verified] Enterprise's service module is `magazine-forward`; Shōkaku's is `aviation-service` (blueprints above; `aviation.rs:34-47`). A forward magazine hit suspends Enterprise flight operations. Worth stating in the "what varies by carrier" list.

**M4. Draft timing claims are not historical.** The draft says so; keep the disclaimer. The 8–12 km opening distances are inside bot gun range (18 km gating) and roughly at the range where 200 mm and larger guns are engaged by current bots, so "surface action within 3–6 minutes" is plausible only after B3 makes bots wait for a contact.

**M5. Attribution already behaves as the draft requires.** [Verified] Weapon sources record `owner_id` per shell/torpedo/charge (`battle.rs:439-476`) and credit persists across control changes (`crates/naval-sim/src/records.rs:157-219`). Aircraft strikes credit the carrier. No work needed; cite it.

**M6. Manual takeover already preserves standing orders and bot memory.** [Verified] `Select` clears the previous ship's held input only (`naval-protocol/src/lib.rs:278-287`); `manual_helm: false` keeps a standing movement order while guns are manual (`session.rs:136-143`); every ship keeps dormant bot state (`battle.rs:139-145`). The draft's slice 1 goals are partly met; what is missing is the UI separation of selection, follow and control (`Game.ts` binds the view, rig, trail and HUD to `simulation.player`; spectating exists only after the player's ship sinks, `Game.ts:876-914`).

## 2. What the draft gets right

- Fleet command as the default with optional direct control is the right call given the existing per-ship ownership model; the sim already supports it and the cost is UI, not authority.
- Separating movement orders from fire priority, and refusing to let a focus target pull an escort away, matches the existing `movement`/`target_id` split.
- Treating the 100-aircraft cap as a construction limit rather than an airborne cap, and refusing to hide performance problems behind a cap.
- The information-boundary audit list, the contact lifecycle states, and the rule that the CPU world may see truth for collisions while decisions use observations.
- Freezing the enemy before friendly placement, separate RNG streams, and recording the seed and resolved definitions.
- Deferring capture/convoy, submarines, cross-carrier diversion and fuel management, while keeping the seams for them.
- Insisting the first milestone is the escort scenario, not the generator.

## 3. Recommended gameplay and control design

Keep the draft's control model with one framing change: make the map (the existing M view) the primary PvE surface for every fleet, and treat the ship view as "Follow" plus "Take helm". Both already exist in pieces: the battlefield camera and squadron box selection (`docs/air-operations.md:11-13`), the spectator path, and `Select` with held input. Build the fleet-command MVP as "spectate any owned ship at any time" plus "orders from the map", and direct control falls out of the existing input path. A command-only mode is then a UI toggle, not a separate build. Do not build a second camera or input model.

Initial order set (Rust `Movement` and `Weapons` fields; all orders are per ship, applied to a selection by the client):

| Order | Semantics | Notes |
| --- | --- | --- |
| Move (route, speed) | Follow waypoints, fire at legal targets in range, never leave the route | Replaces the draft's separate Withdraw |
| Hold area (center, radius) | Station-keep with `avoid_ships`, manoeuvre inside the radius | Replaces zero-helm Hold for PvE |
| Escort (leader, slot) | Keep a heading-relative slot; speed capped to the leader; engage inside a bounded radius; leader lost → Hold area at last slot | The milestone order |
| Attack (track) | Manoeuvre against a contact within a shown pursuit radius; lost track → search last known area | Uses tracks, not actor IDs |
| Focus (track) | Sets `target_id` only | Exists today as `Focus` |
| Weapons free / hold (AA separate) | Suppresses discretionary fire | New field |

Defer: Patrol/search for ships (a looped Route covers it), Advance-and-engage (Move with a wider engagement radius), rally/execute (needs task groups first).

Air orders: keep the six existing kinds (`crates/naval-sim/src/aircraft.rs:6-27`) and change `Attack` to carry a track ID plus last-known position. Add `Search { area }` for any role as the draft proposes. Add the per-ship `AirPolicy`.

Enemy AI: two layers only in the first version. Per-ship captains are the existing bots fed by tracks. A per-team commander that owns a small set of task groups and chooses among three doctrines (surface action group advances on the best surface track; carrier group holds behind escorts and repositions when a hostile track closes; search pattern until any track exists). Do not attempt the draft's full three-layer architecture before that works.

## 4. Balance assessment

### 4.1 First strike, loiter and scout spam

The draft's launch throttling changes the timing of a full-wing strike from about 10 seconds (today: `max_active_flights` 4 × 6 planes, 10 s per flight, `aviation_step.rs:556-558`) to about five minutes (24 on deck at 15–20 s per group, then 24 more through 20–30 s lifts). It does not change the decision. With no airborne cost and no active cap, a player who launches everything, orders a search, and holds the wave in a loiter loses nothing and gains the earliest possible full strike when the first contact appears. The enemy AI as written today does exactly that at t≈5 s. So the answer to the user's question is: no, the proposed systems do not address the concern; they add a five-minute delay and then reward the same behaviour.

Current attrition tuning makes interception a weak deterrent [Verified numbers, consequence Inference]: fighter bursts hit about 3.1% at 400 m with 16 bursts per sortie and 15–80 HP per hit; ship AA hits about 0.15–0.8% per barrel check (`docs/air-operations.md:54-56`). A defended target will not shoot down enough of a 32-bomber wave to make the attacker regret committing it.

Interventions that change the incentive without an arbitrary cap, in the order I would try them:

1. **Parameterise endurance instead of deleting it.** Keep `flight_time` and the return/loss thresholds; set PvE values to mission length (for example return at 20 minutes, no exhaustion loss). This honours "no fuel constraints initially" with zero gameplay difference on day one, and gives playtests a single knob if loiter proves free. Deleting the counters and re-adding them later is the expensive path.
2. **Make recovery the real throttle and show it.** Serial recovery already exists. Keep the runway single and the deck finite, so a 48-plane wave costs 4–8 minutes of vulnerable deck time on return. The counterstrike arriving during recovery is the natural punishment for an all-in opening. Playtest whether AI counterstrikes actually arrive in that window.
3. **Raise interception lethality against unescorted bombers specifically** (a CAP bonus on aligned tail chases against bomber formations), rather than raising all fighter accuracy. Measure strike survivability before and after.
4. **Give surface manoeuvre real leverage**: strike aim error is fixed per pass (`docs/air-operations.md:50`) and dive release requires a predicted error under 22 m (`aviation_step.rs:1136`). Adding a target-turn-rate term to release abort would make escorts and manoeuvre matter more than AA numbers.
5. Only if 1–4 fail: a per-carrier "ready groups" concept where groups beyond a deck-derived limit take longer to bring up, which is a logistics curve and not an airborne cap.

Scout spam: aircraft are finite and never respawn, so scouts are only cheap if CAP cannot reach them. Tracks must decay (the draft's Lost state) and a scout's report must stop when it dies (`docs` intent matches). With no endurance, a single high scout orbiting the enemy carrier forever is the degenerate case; interception range and the altitude/visibility trade the draft describes are the counters. Measure "time an enemy carrier spends under continuous observation" per battle.

### 4.2 Elimination, kiting and cleanup

See H2 for the boundary. For cleanup: adopt `PhysicalLossOrCombatLost` as the elimination predicate (**Decision**), because a disarmed hulk that still counts forces a long hunt with no tactical content. Keep bots targeting `combat_lost` hulls anyway so they get finished. Track the cleanup phase explicitly: time from "last enemy hull with weapons lost" to battle end.

### 4.3 Surface relevance on a compressed map

With B3 fixed, surface groups starting 8–12 km apart close in 4–6 minutes at combined 25–30 m/s, and first strikes at 16–22 km arrive in 3–5 minutes plus launch time. The two arrive together, which is what the draft wants. Torpedo relevance depends on escorts receiving `Attack` orders; under `Escort` they will not close to 5.5 km. That is correct behaviour and the briefing should teach it.

### 4.4 Deck congestion, attrition semantics, carrier loss

Covered in H4 and B7. Add one rule the draft lacks: a group that cannot launch because members are rearming should be reported, not silently blocked, since the current code refuses the launch outright (`aviation.rs:236-241`).

### 4.5 Up to 100 aircraft per team and 15 ships

Twenty-five groups of four across two carriers exceed the current ten numbered shortcuts. Task groups and carrier/role filters are necessary, not optional. Performance: see H7.

### 4.6 Thirty-minute pacing

See H3. The single most useful early measurement is sorties per carrier per battle across seeds. If it is below two, either the timings or the deadline is wrong.

## 5. Revised implementation sequence

Prerequisite changes (small, non-behavioural by default, all in Rust with regenerated ts-rs types):

- P1. `MissionRules` and `AirRules` in `BattleSetup`, defaulting to current behaviour; fixtures unchanged.
- P2. `presentation_value(viewer)` and a per-team frame in the WASM adapter; Custom battle passes `None`.
- P3. `AirPolicy` per ship; air commands from the client addressed to any owned carrier.
- P4. Aircraft count in `FleetEntry`/`validate_fleet`; seed and restart plumbing in the PvE setup record.
- P5. Gameplay asset for mode-specific carrier operating parameters keyed by preset ID (or the explicit decision to rebuild both carriers).

Slices:

1. **Reliable escorts on the map (milestone 1).** Extend `Movement` with Route, HoldArea, Escort, Attack, weapons hold; add `avoid_ships` to ordered movement; map selection and orders for ships in the existing M view for any fleet; Follow any owned ship; Take helm unchanged. Evidence: three Fletchers escort a turning Enterprise through the Pacific Islands passage for ten minutes without collisions or drifting off station; Focus on an enemy does not break station; taking and releasing the helm resumes the escort slot.
2. **Sensors, tracks and AI consumption.** Per-team track table with visual detection (observer height, target size, distance, terrain occlusion, daylight), deterministic cadence, hysteresis; bots, carrier auto-launch, strike validation and fighter search consume tracks; strike orders carry track IDs and can search; team-filtered snapshot; chart and HUD show contacts with age. Evidence: an unobserved enemy's movement and damage change nothing in the friendly frame or in friendly AI decisions; bots do not steer toward a ship they have never observed; a strike whose target turned away searches the last-known area.
3. **Surface-only PvE elimination (milestone 2, smallest playable mission).** Budget validator with aircraft counts, seeded enemy generation with archetypes over the eight combatants, friendly placement in legal regions, fixed-size map lane, elimination rules with boundary and draw deadline, Restart/New battle. Evidence: a 5-ship player fleet against a generated opponent can be found, fought and finished inside 30 minutes on all four maps from ten seeds; no chart or loading leak; same seed reproduces.
4. **Air rules v2.** Groups of four with a per-carrier configuration, startup deck/hangar split, deck occupancy and reservations, lifts, slower launches, group rearm and repair, parameterised endurance, no active cap, merge policy surfaced. Evidence: full 48-aircraft launch, strike, recovery and re-launch with no inventory duplication or deadlock; a forced full-deck return with arrivals resolves through the default deck policy without player input.
5. **Enemy commander and carrier doctrine.** Task groups, three doctrines, counterstrike timing, search patterns. Evidence: an all-in player opening is punished during recovery in at least some seeds; a defended opening leaves a counterattack.
6. **Control and UX completion, then balance.** As the draft's slices 7–8, with the acceptance metrics in section 8.

This moves the draft's slice 4 ahead of its slice 3, splits its slice 5 so the surface mission ships first, and folds its slice 6 enemy AI into two smaller steps.

## 6. Suggested amendments to the draft

1. Rewrite "What exists and what must change" against the Rust runtime: name `Battle::step`, `FleetControl`, `Session`, `LocalRuntime`, `presentation_value`, `bots::target`, `Aviation`, and the existing Fleet orders panel (`src/ui/FleetOrders.tsx`). Delete the `player` actor and `CombatSimulation` statements or label them as the frozen TypeScript reference.
2. Replace the boundary table: rules and generation in `naval-sim` (`rules.rs`, new `mission.rs`, `scenario.rs`), orders in `naval-protocol` plus `battle.rs` `Movement`, sensors in a new `sensors.rs`/`tracks.rs`, team view in `snapshot.rs`, deck logistics in `aviation*.rs`, commander in a new `commander.rs`; TypeScript for `BattleSetupDialog`, a PvE planner, `AirOperations`, `FleetHud`, `NavigationChart`, `SnapshotSession`. Rename the proposed `contacts` module.
3. Add the prerequisite list P1–P5 as a slice zero, and re-order slices as in section 5.
4. In "Mission": replace "consistent with the existing game's treatment of disabled hulls" with the actual rule (physical loss only; disarmed hulls count) and present `PhysicalLossOrCombatLost` as a proposal. Define the boundary area and the out-of-bounds consequence.
5. In "Fleet budgets": add the aircraft-count validator, Shōkaku's 72-aircraft consequence, tonnage figures for all eight combatants, and the note that only eight combatant presets exist.
6. In "Carrier operations": say what varies by carrier (inventory, service module, flight-deck datums, group size and deck capacity); note that Shōkaku's 18/27/27 does not divide into fours; move operating parameters to a gameplay asset or state the rebuild cost; replace "remove endurance" with "parameterise endurance"; keep the auto-merge rule and surface it.
7. In "Spotting": state that no sensor model exists today and that all AI acquisition is omniscient with references; add the map-lane and loading-text leaks; add `events`, `records`, `targetId` and `shellHistory` to the audit.
8. In "Fleet command": note what already exists (ownership, `Select`, `manual_helm`, standing orders, bot memory, attribution) and what does not (formations, `avoid_ships` on ordered movement, weapons hold, follow-any-ship, map for non-carriers). State that Move never exceeds 0.8 throttle today.
9. In "Decisions": add the items in section 7.
10. In "Validation": add the section 8 metrics, and note that changing shared air constants requires `bun run multiplayer:fixtures` deliberately and a Rust/WASM check.

## 7. Decisions that need the user

1. Elimination predicate: physical loss only, or physical loss plus sticky `combat_lost`. Recommendation: include `combat_lost`.
2. A bounded battle area with turn-back and an out-of-bounds consequence for player-piloted hulls. Recommendation: yes, sized from map playtests.
3. Shōkaku under the 100-aircraft cap: keep 72 as a lone-carrier option, or author a PvE complement. Recommendation: keep 72 for the first version and revisit after light carriers exist.
4. Where mode-specific carrier parameters live: gameplay asset versus blueprint edits with rebuilds. Recommendation: gameplay asset; keep authored inventories.
5. Endurance: parameterise rather than delete. Recommendation: parameterise.
6. Control model: hybrid built as follow-any-ship plus existing Take helm, map as the primary PvE surface. Recommendation: yes.
7. Whether PvE track-based AI may also be enabled in Custom battle later, or must stay mode-gated. Recommendation: mode-gated at first, one code path with a predicate.
8. Pause implies local-only PvE. Confirm no server-hosted PvE is required for the first version.
9. The 15-ship cap and the 8-combatant roster: accept Fletcher-heavy generated fleets, or defer the cap until more small hulls exist.

## 8. Acceptance and playtest criteria

Implementation validation (automated where possible):

- Custom battle and online fixtures unchanged after P1–P5: `multiplayer:check` passes without fixture refresh.
- Team-filtered snapshot: a test moves and damages an unobserved enemy for 60 s and asserts the friendly frame, chart contacts, HUD roster, effects events and friendly bot helm/target are byte-identical to a control run.
- Escort: leader turns 180° at full rudder; escorts remain within slot tolerance after settling and never close within the collision clearance of each other or the leader; Focus does not change the escort's helm.
- Manual override: take helm, steer away for 30 s, release; the ship resumes its slot within a bounded time and its bot track state is the one it had before takeover.
- Budgets: 200,000 t, 15 ships, 100 aircraft exact and each overage; Enterprise plus Shōkaku rejected on aircraft; reserve aircraft counted.
- Generation: 200 seeds legal and navigable on each map; same seed reproduces; friendly redeployment does not change the enemy; the eligible-pool-of-one case fails with a message.
- Air rules v2: inventory conservation across hangar, lift, deck, air and lost; no duplicate IDs; a full-deck return plus arrivals resolves without a stalled queue; endurance thresholds at mission length produce no exhaustion losses.
- Elimination: surface-only, one-sided carrier, both carriers, simultaneous loss, `combat_lost` hull, out-of-bounds hull, and deadline draw each end with the specified result.

Playtest measurements (record per seed and archetype):

| Metric | Failure signal |
| --- | --- |
| Time to first contact, first surface hit, first air strike | First strike lands before any friendly ship has a contact in most seeds |
| Sorties per carrier per battle | Below 2 |
| Losses by cause (guns, torpedoes, bombs, air torpedoes, AA, fighters) | Surface weapons account for under a quarter of hull loss in mixed fleets |
| Strike survivability against a defended group | Above 90% of bombers return from a CAP-and-AA-defended target |
| Deck wait time and marshal-orbit time | Median returning aircraft waits longer than its transit time |
| Time enemy carrier is under continuous friendly observation | Above half the battle from a single scout |
| Cleanup duration after the last armed enemy hull is lost | Above five minutes |
| Draws by deadline | Above a fifth of battles with both fleets intact |
| Simulation rate in the browser worker | Below 0.95 real time at 30 ships and 200 aircraft |
| Order failures per battle and time in pause | New players spend more time re-issuing orders than choosing targets |

Two named playtests before tuning: the all-in opening (player launches everything at first contact) and the defended opening (half the wing held, CAP up, escorts in Escort). If the all-in opening wins in most seeds against the section 5 slice-5 AI, apply the section 4.1 interventions in order and re-measure; do not add an airborne cap.

## Not verified

No tests, builds, benchmarks or browser sessions were run. The draft hash is the coordinator's value. Sortie and closing-time arithmetic in sections 1.2 and 4 is derived from source constants, not measured. Historical figures for the carriers were not researched; the review uses authored gameplay values only.
