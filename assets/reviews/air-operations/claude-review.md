# Claude review · Enterprise air operations

Independent review of the uncommitted airWing implementation (2026-09-06). Read-only: no source, asset or generated file was modified. Reviewed against HEAD (`21123c5`): `src/simulation/aircraft.ts`, `combat.ts`, `stability.ts`, `damage.ts`, `src/ships/blueprint.ts`, `src/game/AircraftView.ts`, `Game.ts`, `src/ui/FlightControl.*`, `FleetHud.tsx`, `NavigationChart.tsx`, the Enterprise blueprint/discrepancy register, docs, tests, and the evidence pack in this directory. I also compared the combat renderer's articulation against `src/aircraft-review/main.ts` and the node extras in the published aircraft GLBs, and checked the three.js WebGPU backend's handling of zero-count instanced draws.

Passing tests were treated as evidence of the tested paths only; nothing here asserts historical accuracy.

## Summary

The architecture is sound and follows AGENTS.md: the air wing is a versioned blueprint extension validated by the shared compiler, the fixed tick owns every aircraft/weapon outcome, the renderer only reads state, and reset/pause/load-failure/inventory paths are handled correctly (verified below). Bombs and air torpedoes reuse the existing HE, torpedo, attribution and scoring paths rather than forking them, which is the right call.

Three items should be fixed before merge: the combat renderer folds the main landing gear about the wrong axis relative to the authored extras and the accepted inspector; three of the five presets have no anti-aircraft envelope at all, which the docs do not state; and bot strike launches stall while the bot's target is a wreck. Everything else is P2/P3 tuning, robustness or UI finish.

## Findings

### P1 · fix before merge

**1. Main landing gear animates about the wrong axis in combat.** `src/game/AircraftView.ts:65` rotates every `gear.*` joint about X. The published GLB extras mark `gear.port`/`gear.starboard` as `axis: "forward"` on all three models, and the accepted inspector (`src/aircraft-review/main.ts:310-312`) rotates gear about Z with the tail wheel at half angle. Consequence: for the entire cruise (gear=1 in every phase except takeoff/landing) the main legs are swung fore/aft by 77° instead of folded as authored, visible at LOD0 within 120 m, e.g. the fly-over on launch and every landing. The `userData.fixed` check is also effectively dead code: the extras carry `fixed: false`, and the inspector additionally honors `userData.articulation === 'fixed'`. Suggested fix: read the `axis` extra (`forward` → Z, `spanwise` → X) and the `fixed`/`articulation` extras, or share the inspector's per-kind axis table so the two consumers cannot diverge. The doc claim "animates stable … gear … IDs" is only true for IDs, not poses.

**2. No AA on Bismarck, Yamato or Baltimore.** `src/simulation/aircraft.ts:104` counts only mounts with `caliberM <= .04`. Registered mounts per preset: Enterprise 30 × 20 mm + 4 × 28 mm (34), Type VIIC 1 × 20 mm, Bismarck/Yamato/Baltimore 0. Against three of five presets strike aircraft therefore take no damage except from enemy fighters, so a player Enterprise versus a battleship fleet is a risk-free bombing loop limited only by rearm time. `docs/air-operations.md` and the README say "surviving light ship guns provide an AA envelope" without stating that most presets have none. Suggested fix: either register the light batteries as mounts for those ships (pipeline work), or derive a provisional per-definition AA rating in the compiler (e.g. dual-purpose 127 mm mounts at reduced weight, recorded in each discrepancy register), and state the current gap in the docs either way.

**3. Bot strike launches stall on a wrecked target.** `src/simulation/aircraft.ts:76`: the fallback `?? ctx.actors.find(hostile alive)` only fires when `actor.targetId` is unknown. If the id resolves to a sunk or combat-lost ship, `launchSquadron` rejects every tick (line 38) and bombers stay on deck until the bot retargets. Fix: apply the same alive/team filter to the resolved target before falling back.

### P2 · should fix

**4. Symmetric dogfight ties always favor the earlier actor.** Bursts apply damage immediately inside the loop (`aircraft.ts:136-138`), and a plane marked lost is skipped before it fires (`:81`). Actors iterate player → friendly bots → enemies, so in a head-on duel where both fighters enter 650 m on the same tick, the player-side fighter lands the killing burst on the tick its opponent would have. Deterministic, but biased. Fix: collect bursts for the tick, apply after the loop.

**5. Close torpedo releases arm after passing the hull.** Release allowed at `distance > 400` from the ship *center* (`aircraft.ts:171`). From ≤35 m altitude with −3 m/s initial descent the torpedo falls ~2.4 s and travels ~178 m, entering the water ~222 m from center. Beam attacks leave ~187 m of run (just over the 180 m arming distance); bow/quarter attacks against a 246 m hull leave ~100 m and are duds. Fix: measure release distance to the hull's near face (use `hull.length/2` as `clearTorpedoLane` already does) or raise the floor to ~650 m.

**6. Falling payloads ignore hulls.** `aircraft.ts:180-190` only converts a release at `y <= 0`. A torpedo dropped over a deck becomes a 2 m-deep runner inside the hull and immediately emits `torpedo-dud`; bombs are fine because shells use swept hits. Low impact; a swept check against the target's envelope during the fall would fix it.

**7. Capability rules count fighters as armament.** `src/simulation/stability.ts:71-74`: `usable` and `recoverable` share `airRecoverable`, so (a) a carrier with a flooded (not destroyed) service magazine and no guns reports "operational" rather than "disarmed", unlike the gun rule that uses `availability`, and (b) a carrier reduced to stowed or airborne fighters, which cannot damage ships, never becomes combat-lost while its service magazine has HP. That can leave a battle unfinishable against an enemy that cannot be hurt (e.g. the player's own Enterprise out of strike aircraft). Suggest: `usable` uses the service module's availability; only strike squadrons (or any airborne armed aircraft) count toward "can still fight".

**8. Speed and phase discontinuities.** Speed is a function of phase, not integrated (`fly`, `aircraft.ts:110,124,134,145,158,169`). Recall during takeoff jumps a plane from 25 to 85 m/s and turns it at deck height; attack→return goes 110→85 instantly. Cosmetic, but visible near the carrier. A per-plane speed with a bounded acceleration would remove it.

**9. Endurance is tight at 20 km spawn.** Devastators fly 75 m/s, return at 470 s and are lost at 650 s (`aircraft.ts:96-97`); a 20 km leg is ~270 s each way before maneuvering. The closing fleets usually rescue this, but a stationary carrier and a retreating target can lose an entire torpedo group to fuel. Worth one test at `MAX_BATTLE_SPAWN_DISTANCE`, or scale endurance with spawn distance.

**10. AA loop cost.** For every airborne plane and every enemy within 1.1 km, `aircraft.ts:104` filters all mounts and calls `equipmentCondition` (compartment lookups) per mount, per tick. With 144 airborne over a mixed fleet that is on the order of 10⁵ lookups per tick. Cache the surviving-supplied-AA count per actor once per tick.

**11. Launch button does not reflect a combat-lost target.** `src/ui/FlightControl.tsx:14` disables on sunk/deep targets, but `launchSquadron` also rejects `combatLost` (`aircraft.ts:38`), so the click silently does nothing. Add `combat.targetStatus` to the disabled condition and show the reason in the panel, as the warning line already does for service loss.

### P3 · nice to have

**12. Hidden buffer coupling.** `AircraftView.ts:24,103`: the trace buffer holds 128 segments; `Float32Array.set` throws `RangeError` if `lines` exceeds it. It cannot today only because `combat.ts:180` caps events at exactly 128. Clamp `lines` to the buffer length or size it from a shared constant.

**13. Empty instanced batches stay in the render list.** 105 primitives × 3 LODs = 315 `InstancedMesh` objects are added to `root` at load (`AircraftView.ts:38-40`) with `frustumCulled = false` and are never hidden; the WebGPU backend skips zero-instance draws (`RenderObject.getDrawParameters` returns null) but each is still projected and sorted every frame, in every later battle. Set `batch.visible = model.count > 0` after the count pass. Also per-plane `new Vector3`/`new Euler` allocations at lines 55, 59, 84-85, 90 can use the existing scratch objects.

**14. Bomb identification by magic number.** Renderer (`AircraftView.ts:81`) and test (`aircraft.test.ts:92`) identify bombs by `caliberM === .35 && ammunition === 'he'`. Add a discriminator on `Shell` (e.g. `source: 'aircraft'`).

**15. UI role check by model name.** `FlightControl.tsx:19` uses `modelId.includes('wildcat')`; add `role` to the flights telemetry.

**16. Flight inspector collapses.** `<details>` unmounts when the last aircraft lands (`FlightControl.tsx:19`), so it reopens closed on the next launch. Keep it mounted with an empty state.

**17. Aircraft assets are retained for the app lifetime** after the first carrier battle (`AircraftView.load` caches; nothing unloads on return to port). Acceptable, but worth a note in the docs alongside the ship-model lifecycle.

**18. Rebuild churn.** The four non-carrier ships changed only `contentHash` in their compiled JSON (GLB byte sizes identical), yet every sheet PNG, review zip and GLB is rewritten. Required by AGENTS.md for a shared compiler change, but reviewers cannot diff it; `ship:check` on those four should be cited in the README as evidence that geometry is unchanged.

### Verified correct (no action)

- **Launch/recall/rearm/inventory:** three per click, `launchIntervalSeconds` spacing, global 144 cap matched by the renderer's `CAPACITY`, queued launches wait, recall returns queued to ready and airborne (not landing) to returning, rearm counts down only while service is available and restores HP/ammo/payload, lost aircraft never respawn, compiler caps 3 squadrons × 6.
- **Defeat/sinking:** stowed and queued aircraft are lost when the carrier sinks; airborne survivors continue their attack, then orbit above the wreck until endurance expires (documented); service availability gates on sunk/combat-lost/roll/pitch/immersion and the service module.
- **Attribution/scoring:** bomb histories resolve `ownerId` from the shell list because the shell is pushed before `bomb-release` is emitted (`combat.ts:182`), so carrier credit, `lastDamager` and frags work; air torpedoes carry the carrier's id through `stepTorpedoes`. Shell and torpedo ids share `shellSequence`, so no id collisions with tube torpedoes or effects.
- **Ballistics/weapons:** bomb fall-time solution is correct; HE contact path reuses `advanceProjectile` with drag 0; torpedoes enter at running depth with `distance: 0`, arm after 180 m, expire at 4.5 km; `clearTorpedoLane` excludes the carrier and checks friendly hulls.
- **Determinism:** no randomness; all timing derives from tick time; fighter target sort is stable.
- **Reset/pause:** `reset()` recreates actors and therefore air wings; `airReleases` cleared in `clearCombat`; orders are blocked while paused and in port; propeller/tracer/trail animation keys on `sim.tick`, so pause freezes articulation; interpolation uses `previousPosition` set every tick, so launches do not pop.
- **Load failure:** partial aircraft loads are disposed and the promise reset for retry; `replaceFleet` fails before touching the scene; `dispose()` awaits an in-flight load. Test covers it.
- **Compiler/model:** `airWing` passes through `ShipDefinition` via the `Omit` spread; datums are bounds-checked against beam/length/40 m; role↔model pairs are whitelisted; published Enterprise JSON contains the wing and the GLB hash matches. Joint IDs used by the renderer all exist in every LOD of all three GLBs (`propeller.spin`, `gear.*`, `control.aileron/elevator.*`, `diveBrake.*`, `socket.payload`). Euler `YXZ` with `yaw = -heading` matches the ship convention; pitch/bank signs are correct for a −Z nose, +X starboard model.

## UI finish

**Thesis · clear carrier deployment.** Yes. One instrument, one verb per squadron ("Launch 3"), role subtitles ("Intercept aircraft", "Dive bomb", "Torpedo attack"), and a live count line. The header's "7 deployed" gives the state at a glance. The "Launch 0" disabled state reads oddly; "None ready" or the rearm countdown in the button would be clearer.

**Own world · existing naval instruments.** Yes. Same field colour (`#10252eeb`), line, radius, Barlow/Barlow Condensed, tabular numerals and the same button fill as the Depth instrument (`#233e4a` / `#315365`); the warning colour `#ffb5a6` is the one already used by the battle panel and depth warnings. The six detector advisories are extensions of values already in `DepthControl.css` and `FleetHud.css`, not drift, but DESIGN.md should record the 12/13 px steps and those three colours if they are now intended. Chart crosses use the fleet-active mint and a salmon that is close to, but not identical with, the ship-contact salmon (`#ff9c8d` vs `#ee9b86`); use one token.

**Story · launch / inspect / recall / rearm.** Launch and rearm read well on desktop (count line, "rearming 35s"). Inspect is a collapsed `details` at the bottom; recall is a footer button. Both are below the fold on the narrow layout with no scroll affordance, so the "safety" control is the hardest to find where it matters most. Two redundancies dilute the story: "Strike target: …" repeats the Target selector directly above it, and "Hold Ctrl to command" repeats "Hold Ctrl to select a target" one line above. Dropping one of each would tighten the panel by two lines.

**First viewport · ship, sea, sight visible.** Desktop: yes. The panel sits under the Target selector with roughly a 20 px gap, leaves the centre band, the carrier deck and the sight untouched, and nothing overlaps at 2000 px wide. Narrow (390 × 844 fixture): not really. The panel occupies x 200–380 of 390 px and y 260–569, i.e. 46% of the width across the horizon band where the target ship and sight live. The sight centre is at x = 195 and the panel edge at x = 200, so "the sight is clear" is true of the centre pixel only; the reticle's right half, the gun-aim labels and the pointer-capture hint ("Click sea to aim") are covered. The Target dropdown is truncated to "…· op" beside it. Recommendation for ≤ 600 px: collapse to a one-row strip (three launch buttons + Recall) above the chart, or make it a toggle like Gunnery, and keep the centre third of the viewport clear.

**Form · compact edge instrument.** Desktop: yes, 252 px, edge-anchored, scrolls internally. Short viewports (`max-height: 620px`) move it to `top: 100px`, where it will overlap the Target selector that stays at `top: 24px` (~220 px tall at that breakpoint); that combination was not captured and should be checked. Narrow: the form is right, the placement is not (see above).

## Disposition

**Approve with required fixes.** Merge after P1 items 1–3; items 1 and 3 are small, item 2 needs at minimum a documented statement of which presets have AA and ideally a provisional rating. P2 items 4, 5, 7 and 11 are worth doing in the same change; the rest can follow.

## Validation limits

- Static review plus the supplied screenshots, logs and tests. I did not run the game or the test suite myself, and did not profile a 30-carrier battle; the performance notes are reasoned, not measured.
- `enterprise-articulation.png` shows the port at rest; it does not demonstrate the claimed maximum mount articulation. The 0.000031 m muzzle figure comes from the README, not from anything I reproduced.
- `runtime-flight.json` is a sampled diagnostic from one battle and supports the attack/return/loss sequence but not balance.
- The narrow capture is a DOM fixture in an iframe, not a device; touch, mobile GPU and pointer-lock behaviour remain unverified.
- No claim in this review concerns historical accuracy of aircraft counts, speeds, payloads, AA or torpedo behaviour; those remain the approximations recorded in the Enterprise discrepancy register.
