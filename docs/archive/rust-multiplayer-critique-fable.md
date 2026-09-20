# Critique of the Rust multiplayer plan (1v1 fleet battles)

Status: independent review of `docs/rust-multiplayer-plan.md`. Review only; no game code, plan text or repository state was changed.

| Item | Value |
| --- | --- |
| Reviewed file | `docs/rust-multiplayer-plan.md` (uncommitted in the working tree at review time) |
| SHA-256 of the exact reviewed plan | `0ed1f96485eeddbfb64246e6baadbdd033424805081285422abe35ea1c9498c4` |
| Repository baseline | `4acb25de788d367ba3c5ac87150cbb321b60ed54` (matches the plan's stated baseline) |
| Review date | 2026-09-07 |
| Reviewer model | `claude-fable-5-1` as reported by the session environment; not independently verifiable from inside the session |
| Method | Read the plan, `AGENTS.md`, `README.md`, the docs it cites, and the simulation/game/UI code it references. Ran the existing TypeScript engine headless with two maximum legal fleets to measure tick cost and snapshot size. Scripts and raw results are in the appendix. |

Coordinator instruction applied: custom battles retain their existing map, weather and time controls. Where the plan says a clarification is pending, this review treats it as an open user decision.

## Executive summary

1. **The Rust port is on the critical path of multiplayer, and the evidence does not require that.** The current TypeScript engine, unchanged, ran a maximum legal 8-vessel, 2-carrier fleet against an identical fleet at about 5x real time single-threaded on this machine. Every hard part of the user's product (fleet selection and validation, ownership, fleet orders, protocol, reconnect, scoring, HUD) is engine-agnostic. Recommend building the authoritative server on the existing engine first, behind the same session and protocol seam the plan already describes, and treating the Rust port as a later, measured optimization. The user chose Rust; this is flagged as a user decision, not overridden.
2. **The afloat-tonnage rule collides with the current AI, not just with the result predicate.** Enemy bots, aircraft and damage credit all skip ships flagged `combatLost`. Under the new rule a disarmed 70,000-tonne hull still counts, but no AI will ever try to sink it. Since seven of eight ships per side are AI-driven, this is a rules blocker that needs a targeting decision, and it changes single-player behavior too.
3. **The destruction end condition is unreachable against a submerged submarine.** Type VIIC dives to 150 m, aircraft cannot attack below 8 m, and only Fletcher carries depth charges. One 769-tonne submarine forces every battle to the 30-minute timer. There is also no battle boundary, so a side with a tonnage lead can sail away indefinitely. Both need user decisions.
4. **The proposed 20 Hz JSON snapshot cannot carry carrier battles.** A rough public snapshot with 71 airborne aircraft measured 41 KB, about 6.6 Mbit/s per client at 20 Hz before compression. Up to 192 aircraft are legal. The wire design needs an aircraft-specific transport before any schema freeze.
5. **The capacity target ignores a synchronized hydrostatics burst.** Every ship runs its expensive 2 Hz flotation solve on the same tick. That tick averaged 37 ms for 16 ships versus under 3 ms otherwise. Language choice does not fix the shape; staggering does. The plan's p99 target of 8 ms is unreachable without it.
6. **Ship switching and disconnect takeover need a per-actor controller model.** Bot memory exists only for bot-controlled actors, and ammunition selection, fire queue, damage-control priority, air commands and damage log are single-player singletons in the engine.
7. The remaining findings are medium or low: content hash coupling to Blender recipes, dual terrain and sea implementations, an event ring buffer that cannot serve as a wire queue, under-scoped fleet orders, brittle overload policy, and night being a human-only handicap.

## What the plan gets right

- Physical loss and weapon capability are correctly identified as different predicates, and `combatLost` is correctly described as not an afloat predicate (`src/simulation/stability.ts:105-137`).
- Tonnage quantization is explicit and matches the catalog: King George V is 38,641,279.9885728 kg and Baltimore is 17,476,006.83136 kg in `public/models/*.json`; every other preset is an integer kilogram value.
- The seeded randomness claim holds. There is no `Math.random` anywhere under `src/simulation`, `src/ships` or `src/maps`. Every random draw is an integer hash of a seed plus a sequence (`src/simulation/ballistics.ts:89-116`, `src/simulation/bots.ts:69-86`, `src/simulation/airGunnery.ts:17-26`). These port exactly to Rust with wrapping 32-bit arithmetic; only transcendental functions differ by ulps.
- The 30-minute limit as 108,000 ticks is correct (`FIXED_DT = 1 / 60` in `src/simulation/ship.ts:3`).
- Not claiming cross-platform lockstep, keeping f64, and refusing to relax tolerances to hide gameplay changes are all sound.
- Excluding the `map` sentinel and the custom defaults (noon, 38% cloud, 9 m/s wind in `src/ui/App.tsx:63`) from the online roll is necessary and the plan catches it.

## Findings ranked by severity

Tags: **[User decision]** needs the product owner. **[Architecture]** must be resolved before the stage that depends on it. **[Optional]** improves the plan but does not block it.

### F1. Blocker. The Rust port is sequenced ahead of multiplayer without evidence that it is needed for v1 [User decision] [Architecture]

**Claim.** Stages 3 to 6 commit to a full engine port before two humans can play. The stated reason for Rust is "many simulated bots and concurrent battles". The engine already hosts headless.

**Evidence.**
- `README.md`, Architecture: "The shared simulation is ready to host outside the browser, but multiplayer transport and server command validation are not implemented." `CombatSimulation.step` is documented as the host entry point (`docs/ship-runtime-contract.md`, Blueprint and simulation contract; `src/simulation/combat.ts:278-279`).
- Headless measurement on this machine (Apple M5 Pro, Bun 1.3.3), two identical maximum legal fleets of 190,226 t with two Enterprises each, hard AI, 5 km, overcast:

| Run | Mean ms per tick | p50 | p95 | p99 | Max | Real-time factor |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 60 simulated seconds | 4.43 | 3.05 | 5.78 | 42.3 | 81.2 | 3.8x |
| 600 simulated seconds | 3.26 | 2.12 | 4.96 | 38.6 | 75.4 | 5.1x |

  Peak in-flight shells 119, peak airborne aircraft 72, resident memory 321 MB after 60 s and 530 MB after 600 s for one Bun process. The p99 figures come from a single periodic burst discussed in F6, not from general slowness.
- Port scope: 5,226 non-test lines under `src/simulation` plus 1,190 under `src/ships` and 257 under `src/maps`, written in a very dense style, with 6,471 lines of simulation tests and 126 test files overall (689 tests, 336,660 assertions per `docs/test-performance.md`). The Rust crate needs equivalent behavioral coverage before it can be the authority; those tests do not carry over.
- The seam work is identical either way: `src/game/Game.ts` has about 120 direct reads or mutations of simulation objects, and 42 non-test files in `src/game` and `src/ui` import from `src/simulation`.

**Consequence.** Multiplayer ships only after a parity-verified port of guns, penetration, flooding, hydrostatics, bots, submarines, torpedoes, depth charges, carriers, strikes, fighters and AA. Every gameplay tuning change during that window must land twice. The first real network test (stage 4) happens on a partial Rust slice with carriers excluded, so the hardest transport problem (F5) is discovered last.

**Remedy.**
1. Keep stages 1 and 2 as written, but make stage 2 the seam experiment on the existing engine: `BattleSession`, read-only presentation snapshots, neutral team and controller IDs, per-actor input.
2. Build the authoritative server in TypeScript on Bun (the repo's runtime), one match per worker thread, with the protocol, admission, reconnect and persistence exactly as the plan describes. Measured capacity on this machine suggests several concurrent 1v1 matches per core with the current engine; a 16-core host would carry tens of matches. Confirm on the intended hardware.
3. Port to Rust behind the frozen protocol only when the concurrency sweep shows the need, or when WASM offline execution is separately justified. Because the wire contract does not change, the port becomes a swap with recorded-fixture parity, not a rewrite of the product.
4. If the user reaffirms Rust-first, at minimum move real networking with carriers ahead of stage 5 by running stage 4 against the TypeScript engine, so F5 is measured before the schema freezes.

### F2. Blocker. Enemy AI, aircraft and damage credit ignore `combatLost` ships, so afloat tonnage is unreachable once a ship is disarmed [Architecture] [User decision]

**Evidence.**
- Bot target selection excludes them: `src/simulation/bots.ts:183`.
- Strike targeting and bot carrier launch exclude them: `src/simulation/aircraft.ts:113`, `:268`, `:467`.
- The engine freezes their helm and disables every mount: `src/simulation/combat.ts:288-292` (throttle and rudder forced to zero) and `:322`.
- Hits, ramming, torpedoes and depth charges against them earn no credit and do not update the last damager: `src/simulation/combat.ts:219`, `:234`, `:445`, `:470`.
- The flag is sticky until reset: `s.combatLost ||= !recoverable` at `src/simulation/stability.ts:133`.
- Spectator candidates and the HUD roster treat them as lost: `src/game/Game.ts:831`, `src/ui/BattleStatus.tsx:9-10`.

**Consequence.** Under the plan's rule a disarmed Yamato keeps 69,935 t on the board, cannot move (unless F2 is fixed), and is invisible to every AI weapon on the other side. With seven of eight ships per side AI-driven, tonnage stops changing hands exactly when one side has won the gunnery duel. The result at 30 minutes is then decided by which side disarmed more ships without sinking them, which is the opposite of the intended incentive.

**Remedy.** The plan's "audit" must become a behavior specification: after the predicate change, bots and strike aircraft must be allowed to target afloat disarmed ships, and a priority rule is required (finish a disarmed hull versus engage an armed threat). This changes single-player custom battles as well and needs an explicit user decision and new bot tests. Keep weapon-availability restrictions on the disarmed ship itself; restore its helm so "movable" is true.

### F3. High. Destruction is unreachable against a submerged submarine and there is no battle boundary [User decision]

**Evidence.**
- Type VIIC: `maxDepthM` 150, `periscopeDepthM` 7, 769 t (`public/models/type-viic.json`). Bots dive within 1.6x torpedo range and hold periscope depth (`docs/bot-behavior.md`, Helm and targeting), but a human can order 150 m via `orderDepth` (`src/simulation/submarine.ts:23-27`).
- Aircraft refuse targets below 8 m (`src/simulation/aircraft.ts:113`, `:268`, `:467`). Bots ignore hulls below 20 m for lane and avoidance checks (`src/simulation/bots.ts:227`, `:273`).
- Only Fletcher has depth-charge launchers in the roster (eight; no other preset declares any).
- Positions are not hidden: every actor appears in `contacts` (`src/simulation/combat.ts:518-519`), so "hiding" means unreachable, not unseen.
- No world boundary exists during battle. The only 40 km check is spawn validation (`src/simulation/battle.ts:100`). Yamato at full speed covers well over 20 km in 30 minutes.

**Consequence.** Any fleet containing a submarine cannot be destroyed by a fleet without Fletchers, so the timer becomes the only end. A leading side can also disengage indefinitely. The plan names these as strategies to playtest; they are structural, not emergent.

**Remedy.** Decisions for the user, in order of least rules change: (a) add a battle area with a penalty or forced loss outside it (does not touch scoring); (b) treat a side with no vessel able to attack surface ships as destroyed for the destruction condition only, keeping tonnage scoring untouched; (c) accept 30-minute stalls as a feature. Whatever is chosen must be in the rules fixtures of stage 1.

### F4. High. The 20 Hz JSON snapshot cannot carry carrier battles [Architecture]

**Evidence.** A rough public snapshot built from the live engine (16 ships with mount train, elevation and status, airborne aircraft with position and attitude, shells and torpedoes) measured 41,179 bytes with 71 aircraft airborne and 4 shells, and 30,913 bytes with 43 aircraft airborne. At 20 Hz that is roughly 6.6 Mbit/s per client uncompressed. Legal fleets allow four Enterprises in one match (192 aircraft, 48 each per `docs/air-operations.md`) and peak shell counts reached 119. Aircraft rendering also animates wing fold, propeller, gear, hook and control surfaces from CPU state (`docs/air-operations.md`, Deck and flight simulation), so the aircraft record is larger than position and attitude.

**Consequence.** The plan defers encoding changes until "a demonstrated payload need". The need is demonstrable now; discovering it in stage 5 after the schema is frozen in stage 4 forces a protocol version bump before launch.

**Remedy.** Before the stage 4 schema: send ships at 20 Hz, aircraft at a lower rate with client-side flight interpolation from authoritative attitude and controls, shells as launch state plus terminal events (already planned), deltas against an acknowledged baseline, and a compact binary encoding or at least permessage-deflate with measured CPU cost. Budget per-client bandwidth in the stage 4 gate.

### F5. High. The capacity target ignores a synchronized 2 Hz hydrostatics burst [Architecture]

**Evidence.** `createStability` starts every ship at `elapsed: .5` and the flotation solve runs when `elapsed >= .5` (`src/simulation/stability.ts:16`, `:30-55`). All actors are created in the same constructor, so all 16 ships solve on the same tick. Measured per tick-phase over 1,800 ticks: ticks where `tick % 30 == 0` averaged 37.3 ms (max 68.4 ms); every other phase averaged 2.6 to 2.9 ms.

**Consequence.** The plan's p99 gate of 8 ms is dominated by this one tick in thirty regardless of language. A Rust port might shrink the burst several times, but a 10 ms burst every half second still misses the gate and, more importantly, the overload policy in the plan would classify a healthy match as lagging if the budget is set naively.

**Remedy.** Stagger the solve phase per actor or amortize it across ticks. This is a tiny behavior change to seeded outcomes and must be re-baselined in the stage 1 fixtures, not slipped in during the port. Express the lag budget in accumulated backlog seconds, not per-tick time.

### F6. High. Ship switching, disconnect takeover and two humans need a per-actor controller model [Architecture]

**Evidence.**
- `player` is `readonly` and created with controller `'player'`; bot state exists only when `controller === 'bot'` (`src/simulation/combat.ts:72`, `:133`, `:169`).
- Single-player singletons: `ammunitionSelection` and `fireQueued` (`:99-110`, `:216`), air commands only for `this.player` (`:87-90`), damage control priority only for the player (`:399`), damage log only for player-involved hits (`:249`), `target` and `aimAt` are one selection (`:73`, `:195-215`).
- `Team` is the string union `'friendly' | 'enemy'` and is compared literally across bots, aircraft and the HUD (`src/simulation/battle.ts:13`, `src/ui/BattleStatus.tsx`).
- `Game.ts` mutates simulation state directly for depth orders and port articulation previews (`src/game/Game.ts:892`, `:1020-1036`).

**Consequence.** "Switch direct-control ship" is not a pointer swap. A ship the player leaves needs bot memory that did not exist, a ship the player takes must keep its crew memory for later, ammunition orders and fire state must be per actor, and a disconnected player's ship must be taken over by AI on the same path. The plan mentions the refactor but sizes it as plumbing.

**Remedy.** Create bot state for every actor at match start regardless of controller, make controller a per-actor field that can change, move all input state into a per-actor command struct, and specify what happens to queued ammunition, torpedo trains and air orders on handoff. Do this in the seam stage on the existing engine; it is required before any port.

### F7. Medium. Fleet orders are under-scoped for a game where seven of eight ships per side are AI [User decision] [Architecture]

**Evidence.** Bots have no order concept ("Bots do not have fleet coordination, threat scoring or a visibility/spotting system", `docs/bot-behavior.md`). `botHelm` derives throttle and rudder solely from its own chosen target (`src/simulation/bots.ts:191-220`). Bot carriers launch every squadron at the first valid target as soon as the crew reaction delay elapses (`src/simulation/aircraft.ts:267-270`), and squadron commands exist only for the directly controlled ship (`src/simulation/combat.ts:87-90`).

**Consequence.** With two carriers per player and one directly controlled ship, the second carrier's air wing is fully automatic with no way to hold, retask or recall it. Move, focus, hold and resume do not cover speed, formation or follow, weapon release permission, or the tonnage-aware priority that F2 requires.

**Remedy.** Decide the v1 order set explicitly, including air orders for any owned carrier, and define the precedence inside `botHelm` and `botTarget` with tests. This is a new behavior layer and should be estimated as such.

### F8. Medium. Content hash couples server content to Blender recipes and must not be recomputed in Rust [Architecture]

**Evidence.** `contentHash = sha256(JSON.stringify([definition, ...recipe]))` (`scripts/ships/pipeline.ts:35`); the GLB carries `definitionHash` and the game refuses mismatches (`src/game/Game.ts:262`, `:477-478`). Retired alias JSON files (`liberty-deck-cargo`, `liberty-troopship`) remain in `public/models` while the roster in `src/ships/presets.ts` excludes them.

**Consequence.** A purely visual model rebuild changes the hash, which under the plan's handshake means a server manifest change, a drain and a redeploy, and rejection of older clients. Recomputing the hash in Rust would also require reproducing JavaScript object key order and number formatting.

**Remedy.** Hash the raw compiled JSON bytes for the manifest at build time and treat `contentHash` as an opaque identifier. Consider a second, simulation-relevant hash over the fields the engine reads so visual-only updates do not force server deploys. Generate the manifest from `presets.ts`, never from the directory.

### F9. Medium. Two implementations of terrain and sea will coexist [Architecture]

**Evidence.** Land contact uses `islandRadius` and `landHeight` (`src/simulation/land.ts:17-18`), which depend on `Math.sin` in `islandRim` and on an erosion pass over a `Float32Array` computed with double arithmetic then stored as float32 (`src/maps/terrain.ts`). The renderer draws the same TypeScript terrain (`src/game/BattleLandscape.ts`). `seaHeight` uses `Math.sin` and `Math.sqrt` (`src/simulation/sea.ts:17-24`).

**Consequence.** With Rust authoritative, the client's drawn coastline and the server's collision coastline come from different code; differences are ulps in the online case but the WASM offline case would carry a second CPU implementation forever unless the renderer reads heights from the authoritative side.

**Remedy.** Export heightfields and sea parameters from the authoritative engine to the renderer, or document a tolerance test comparing both implementations over all registered islands.

### F10. Medium. Stage 6 (custom battles through WASM) is the largest UI refactor and becomes unnecessary if the server stays TypeScript [User decision]

**Evidence.** Per-frame presentation reads previous and current poses for every ship and mount, aircraft positions and mechanisms, shells for follow cameras, damage state for inspection, and shell histories for the HUD (`src/game/Game.ts:555-620`, `src/game/ShipView.ts`, `src/game/AircraftView.ts`). Roughly 200 mounts and over 100 aircraft are legal in one match. All of this crosses a worker or WASM boundary every frame under stage 6.

**Consequence.** Stage 6 exists to avoid two engines. If F1's sequencing is adopted there is one engine already. If Rust-first is reaffirmed, stage 6 should be deferred until online play is proven, and the cost of a structured-buffer presentation transfer must be measured in stage 2 as the plan says.

### F11. Medium. Overload policy aborts where catch-up would do [User decision]

**Evidence.** The plan aborts a match as infrastructure failure once a "short documented lag budget" is exceeded. Measured headroom is 4x to 5x real time on one core for the maximum fleet (F1), and the periodic burst in F5 is normal behavior.

**Remedy.** Define the budget as backlog seconds with bounded catch-up (both clients see the same stall, so competitive fairness holds), and abort only beyond a generous limit such as tens of seconds. Keep the rule of never stretching physics dt.

### F12. Medium. The engine's event buffer cannot serve as the wire event queue [Architecture]

**Evidence.** `events` is capped at 128 entries and shifted (`src/simulation/combat.ts:245-246`). AA-heavy ticks emit a shot event per barrel, and a 20 Hz snapshot cadence spans three ticks.

**Remedy.** The plan's sequenced, acknowledged per-connection event stream is right; size it from measured AA event rates and never read the engine's ring buffer as the source of truth for a client that missed a tick.

### F13. Medium. Test coverage does not transfer to a Rust authority [Architecture]

**Evidence.** 126 test files, many asserting exact values (`src/simulation/score.test.ts:41-48`, `src/simulation/weapon-capability.test.ts`). They run against the TypeScript engine in about 17 s (`docs/test-performance.md`).

**Consequence.** After a port, the authority path is exercised only by whatever fixtures and Rust tests exist. Recorded-fixture comparison covers pointwise state, not the behavioral intent those tests encode. This is the hidden bulk of stages 3 and 5.

### F14. Low. Night and fog are human-only handicaps [User decision] [Optional]

**Evidence.** Time of day and fog change only sky, fog and lighting (`src/maps/conditions.ts:39-88`); the CPU sea takes only the weather's wave parameters (`src/simulation/sea.ts:11-16`). Bots have no visibility model.

**Consequence.** In a battle where seven of eight ships per side are AI, a night roll handicaps only the two directly controlled ships. The rarity weights are reasonable, but the user should know night changes little at the fleet level unless bot engagement range becomes light-dependent, which is a separate behavior change.

### F15. Low. Mirror-fleet draws are plausible under cautious play [User decision]

**Evidence.** Equal integer tonnage at timeout is a draw. The 600 s hard-AI run ended by destruction (13 of 16 ships sunk) with the directly controlled ship driven by a fixed helm and aim, so the engine does sink ships quickly at 5 km. Human players who keep range or disengage (F3) will not.

**Remedy.** Decide now whether a draw is acceptable for identical surviving tonnage or whether a tie-breaker exists. If a tie-breaker is wanted, hull integrity or damage dealt applied only on exact ties would not change the primary rule.

### F16. Low. Tonnage rests on provisional loading calibrations [Optional]

**Evidence.** `hull.massKg` is physical mass used by collisions and hydrostatics (`src/simulation/collisions.ts:50`, `src/simulation/stability.ts:33`), and the README describes the loading calibration as provisional. Enterprise is 25,910 t against Bismarck's 43,978 t.

**Remedy.** Freeze tonnage per rules version as the plan says, and note that any recalibration changes the legality of saved fleets.

### F17. Low. Map fairness inputs [Optional]

Island layouts are asymmetric along the lane (`along` offsets in `assets/maps/environments.v1.json`) and the lane width depends on the larger team size (`src/maps/catalog.ts:19-24`), so a 1-vessel fleet against 8 plays on the 8-ship layout. Randomized sides plus playtesting, as the plan says, is adequate. Record the resolved layout in the match record.

## User decisions register

| # | Decision | Default in plan | Recommendation |
| --- | --- | --- | --- |
| D1 | Rust-first port versus TypeScript authoritative server first (F1) | Rust-first | TypeScript server first behind the same protocol; port later on measured need |
| D2 | AI targeting of afloat disarmed ships (F2) | Not decided | Allow, with an explicit priority rule; accept the single-player behavior change |
| D3 | Submarine stall and disengagement (F3) | Playtest | Add a battle area; decide whether a side with no surface-capable weapon counts as destroyed |
| D4 | Fleet order set including air orders for uncontrolled carriers (F7) | Four orders | Add air orders, speed and follow at minimum |
| D5 | One engine as a hard requirement, and whether custom battles must move to WASM (F10) | Yes, stage 6 | Unnecessary under D1; defer otherwise |
| D6 | Overload policy: abort threshold (F11) | Short budget, abort | Backlog seconds with catch-up; abort late |
| D7 | Tie-breaker on exact tonnage tie (F15) | Draw | Decide explicitly |
| D8 | Night as gameplay versus cosmetic (F14) | Cosmetic | Keep cosmetic for v1; state it |
| D9 | Custom battle conditions | Pending in plan | Per coordinator: retain existing controls |

## Architecture blockers by stage

- Before stage 2: per-actor controller and input model (F6); neutral team IDs; presentation seam measured on the existing engine.
- Before stage 4 schema freeze: aircraft and shell transport with bandwidth budget (F4); event queue design (F12); staggered hydrostatics with re-baselined fixtures (F5); manifest hashing rule (F8).
- Before the scoring rule ships anywhere, including custom battles: AI behavior toward disarmed ships (F2); destruction condition versus submarines and disengagement (F3).

## Optional scope

- Persist the command log with the seed; the engine is deterministic given both, which gives replays and dispute evidence for free.
- Simulation-relevant content hash separate from the model hash (F8).
- Heightfield export to the renderer (F9).
- Per-match memory measurement: one Bun process grew from 321 MB to 530 MB over ten simulated minutes in the appendix run; this was not separated into engine versus runtime and should be before admission limits are set.

## Not verified

- No Rust, WASM or network code exists in the repository (no matches for worker, wasm or WebSocket under `src`, `scripts` or `vite.config.ts`), so nothing about the proposed crates could be tested.
- The benchmark uses a fixed helm and aim for the directly controlled ship and is a tick-cost probe, not a balance or fairness result.
- Browser frame cost, WASM transfer cost and per-client CPU for compression were not measured.

## Appendix A. Headless measurements

Machine: Apple M5 Pro, 18 logical CPUs, Bun 1.3.3, single thread, macOS (Darwin 25.6.0). Fleet per side: Enterprise, Enterprise, Yamato, Bismarck, Baltimore, Fletcher, Fletcher, Flower Corvette (190,226 t, 8 vessels, 2 carriers). Hard AI, 5 km separation, Pacific Islands, overcast, seed `0x1234abcd`. The directly controlled Yamato used throttle 1, rudder 0, fire held, aim fixed 5 km ahead.

Raw 60 s result:

```json
{"fleetTonnesPerSide":190226,"vesselsPerSide":8,"aiLevel":"hard","simSeconds":60,"ticks":3600,"wallSeconds":15.96,"realtimeFactor":3.76,"msPerTick":{"mean":4.434,"p50":3.054,"p95":5.783,"p99":42.252,"max":81.185},"peakShells":119,"peakAirborne":72,"result":"active","afloat":{"friendly":8,"enemy":8},"snapshotJsonBytesNow":41179,"shellsNow":4,"airborneNow":71,"telemetryMsPerCall":0.296,"rssMB":321}
```

Raw 600 s result:

```json
{"fleetTonnesPerSide":190226,"vesselsPerSide":8,"aiLevel":"hard","simSeconds":600,"ticks":36000,"wallSeconds":117.46,"realtimeFactor":5.11,"msPerTick":{"mean":3.263,"p50":2.115,"p95":4.963,"p99":38.606,"max":75.373},"peakShells":119,"peakAirborne":72,"result":"victory","afloat":{"friendly":3,"enemy":0},"snapshotJsonBytesNow":30913,"shellsNow":0,"airborneNow":43,"telemetryMsPerCall":0.252,"rssMB":530}
```

Tick-phase analysis over 1,800 ticks (mean and max ms by `tick % 30`, top entries):

```json
[{"phase":0,"mean":37.32,"max":68.37},{"phase":1,"mean":2.91,"max":11.46},{"phase":4,"mean":2.7,"max":15.85},{"phase":3,"mean":2.62,"max":7.63},{"phase":27,"mean":2.6,"max":22.11},{"phase":2,"mean":2.58,"max":5.46}]
```

## Appendix B. Reproduction scripts

Both scripts import the repository engine read-only and were run from the repository root with `bun <script> <seconds> <aiLevel>`. Replace the absolute import prefix with the checkout path.

```ts
// bench.ts
import { CombatSimulation } from '<repo>/src/simulation/combat';
import { shipPreset } from '<repo>/src/ships/presets';
import { airborne } from '<repo>/src/simulation/aircraft';

const seconds = Number(process.argv[2] ?? 60);
const level = (process.argv[3] ?? 'hard') as 'easy' | 'normal' | 'hard';
const roster = ['enterprise-cv6', 'enterprise-cv6', 'yamato', 'bismarck', 'baltimore', 'fletcher', 'fletcher', 'flower-corvette'];
const tonnes = roster.reduce((n, id) => n + shipPreset(id).hull.massKg / 1000, 0);
const bot = (id: string) => ({ definition: shipPreset(id), aiLevel: level });
const sim = new CombatSimulation(shipPreset(roster[2]), {
  friendlyBots: roster.filter((_, i) => i !== 2).map(bot), enemies: roster.map(bot),
  spawnDistance: 5000, seed: 0x1234abcd, mapId: 'pacific-islands', weather: 'overcast',
});
const helm = { throttle: 1, rudder: 0 };
const intent = { aim: [0, 0, -5000] as [number, number, number], fire: true, battery: 'main' as const };
const ticks = Math.round(seconds * 60);
const samples = new Float64Array(ticks);
let maxShells = 0, maxAir = 0;
const t0 = performance.now();
for (let i = 0; i < ticks; i++) {
  const a = performance.now();
  sim.step(helm, intent);
  samples[i] = performance.now() - a;
  if (i % 60 === 0) { maxShells = Math.max(maxShells, sim.shells.length); maxAir = Math.max(maxAir, sim.aircraft.filter(airborne).length); }
}
const total = performance.now() - t0;
const sorted = Float64Array.from(samples).sort();
const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
const snapshot = {
  tick: sim.tick,
  ships: sim.actors.map(a => ({ id: a.motion.id, x: a.motion.x, y: a.motion.y, z: a.motion.z, h: a.motion.heading, r: a.motion.roll, p: a.motion.pitch, s: a.motion.speed, sunk: a.damage.sunk, st: a.damage.stability.status, hp: a.damage.integrity, mounts: a.mounts.map(m => [m.train, m.elevation, m.status]) })),
  aircraft: sim.aircraft.filter(airborne).map(p => ({ id: p.id, pos: p.position, h: p.heading, pitch: p.pitch, bank: p.bank, phase: p.phase })),
  shells: sim.shells.map(s => ({ id: s.id, pos: s.position, vel: s.velocity })),
  torpedoes: sim.torpedoes.map(t => ({ id: t.id, pos: t.position, vel: t.velocity })),
};
const bytes = Buffer.byteLength(JSON.stringify(snapshot));
const telemetryStart = performance.now();
for (let i = 0; i < 100; i++) sim.telemetry('main', intent.aim);
const telemetryMs = (performance.now() - telemetryStart) / 100;
const alive = (team: string) => sim.actors.filter(a => a.team === team && !a.damage.sunk).length;
console.log(JSON.stringify({
  fleetTonnesPerSide: Math.round(tonnes), vesselsPerSide: roster.length, aiLevel: level, simSeconds: seconds, ticks,
  wallSeconds: +(total / 1000).toFixed(2), realtimeFactor: +((seconds * 1000) / total).toFixed(2),
  msPerTick: { mean: +(total / ticks).toFixed(3), p50: +q(.5).toFixed(3), p95: +q(.95).toFixed(3), p99: +q(.99).toFixed(3), max: +sorted[sorted.length - 1].toFixed(3) },
  peakShells: maxShells, peakAirborne: maxAir, result: sim.result, afloat: { friendly: alive('friendly'), enemy: alive('enemy') },
  snapshotJsonBytesNow: bytes, shellsNow: sim.shells.length, airborneNow: sim.aircraft.filter(airborne).length,
  telemetryMsPerCall: +telemetryMs.toFixed(3), rssMB: Math.round(process.memoryUsage().rss / 1048576),
}, null, 1));
```

```ts
// spikes.ts
import { CombatSimulation } from '<repo>/src/simulation/combat';
import { shipPreset } from '<repo>/src/ships/presets';
const roster = ['enterprise-cv6', 'enterprise-cv6', 'yamato', 'bismarck', 'baltimore', 'fletcher', 'fletcher', 'flower-corvette'];
const bot = (id: string) => ({ definition: shipPreset(id), aiLevel: 'hard' as const });
const sim = new CombatSimulation(shipPreset('yamato'), { friendlyBots: roster.filter((_, i) => i !== 2).map(bot), enemies: roster.map(bot), spawnDistance: 5000, seed: 0x1234abcd, mapId: 'pacific-islands', weather: 'overcast' });
const helm = { throttle: 1, rudder: 0 }, intent = { aim: [0, 0, -5000] as [number, number, number], fire: true, battery: 'main' as const };
const byPhase = new Map<number, number[]>();
for (let i = 0; i < 1800; i++) { const a = performance.now(); sim.step(helm, intent); const ms = performance.now() - a; const k = i % 30; byPhase.set(k, [...(byPhase.get(k) ?? []), ms]); }
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const rows = [...byPhase.entries()].map(([k, v]) => ({ phase: k, mean: +mean(v).toFixed(2), max: +Math.max(...v).toFixed(2) })).sort((a, b) => b.mean - a.mean).slice(0, 6);
console.log(JSON.stringify(rows));
```

## Appendix C. Repository facts used

- Roster: 11 presets in `src/ships/presets.ts`; one carrier (Enterprise, 48 aircraft); one submarine (Type VIIC). Tonnages in metric tonnes from `hull.massKg / 1000`: Yamato 69,935; Bismarck 43,978; King George V 38,641.28; Enterprise 25,909.68; Baltimore 17,476.01; Victory Cargo 15,500; Liberty Collier 14,967; Liberty Cargo 14,478; Fletcher 2,924; Flower Corvette 1,170; Type VIIC 769.
- The 200,000 t cap binds on battleship-heavy fleets: two Yamato plus Bismarck plus King George V is 222,489 t; two Yamato, Bismarck, three Fletcher and two Flower is 194,960 t with eight vessels.
- Custom battle limits: 30 ships per team (`MAX_TEAM_SHIPS` in `src/simulation/battle.ts:12`); conditions are continuous sliders for time of day, cloud cover and wind speed plus map, spawn distance, formation and a spawn planner (`src/ui/BattleSetupDialog.tsx:130-167`). Time and weather presets exist in `assets/maps/battle-conditions.v1.json` but the custom UI does not expose them.
- Weather changes CPU sea state (wave amplitude times four, wind) and therefore gunnery motion; time of day is visual only.
- Existing termination: both teams evaluated once per tick with `sunk || combatLost` (`src/simulation/combat.ts:413-417`); result type is player-relative (`src/simulation/battle.ts:14`).
