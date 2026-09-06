# Claude review · visible carrier deck cycle

Follow-up to `claude-review.md`. Read-only review of the uncommitted deck-visibility and landing changes against `0a567e0` (2026-09-06). Files: `src/simulation/aircraft.ts`, `combat.ts`, `src/game/AircraftView.ts`, `AircraftView.test.ts`, `Game.ts`, `aircraft.test.ts`, the Enterprise blueprint datums, discrepancy register, docs, `scripts/diagnostics/carrier-deck.html`, and the `deck/` evidence (parked/launch/landing captures, runtime.json, test logs). I also ran the focused test files and a short measurement script against the real simulation to get deck-cycle timings, landing continuity on a moving turning carrier, and wing clearances from the blueprint's flight-deck and island footprints. No implementation or generated asset was modified.

Scope note: the docs and register state there is no deck collision solver, wing folding, arresting cable or elevator simulation. Findings below are not requests for those; they are about what the chosen kinematic model does with the authored geometry and inventory.

## Summary

The design is right: parking, taxi, takeoff run, rollout and parking are ship-local (`deckPosition`) phases re-posed every tick, so aircraft follow a moving, rolling, turning carrier without drift; the renderer draws deck aircraft through the displayed hull matrix, so port and battle look consistent; the same 18 objects cycle with no respawn; the earlier gear-axis and empty-batch findings are fixed. Carrier movement is handled correctly (verified below).

Three things need attention before merge: the extended integration test exceeds bun's default timeout and fails under the project's `test` script; the launch lane at X = +4 puts every aircraft type's starboard wing through the modeled island on every takeoff run and most parking taxis, and the register text says the opposite; and the single-lane scheduler reduces sortie cadence from 3 s to roughly 16–22 s per launch and 27–32 s per recovery, which the README's "at least three seconds between takeoffs" does not convey.

## Measurements (real simulation, stationary unless stated)

| Case | Result |
| --- | --- |
| 9 aircraft ordered at t = 0 (3 squadrons) | Launch events at 15.7, 38.4, 60.2, 78.4, 95.7, 112.0, 124.7, 136.4, 147.3 s |
| 9 aircraft recovering from the approach, 0 kn | All parked (rearming) at 240 s |
| 9 aircraft recovering, 25 kn | All parked at 286 s, none lost, lane X stays 4.0 / −6.8 |
| One aircraft landing on a 25 kn carrier turning ~0.1 rad/s | Landed, rolled out, parked at 45 s; largest per-tick step 0.83 m (rollout, 48 m/s world); lowest altitude 18.3 m vs deck + tyre 18.25 m |
| Taxi aircraft reaching the datum with roll 0.30 rad | Still `taxi` at the datum after 30 s; lane reported busy |
| Wing tips at lane X = 4 (F4F / SBD / TBD) | Starboard tips at 9.8 / 10.3 / 11.6 m; island footprint starts at X = 8.53 m, Z −32…15, 4.4 m tall |
| Wing tips parked at X = −7 | Port tips at −12.8 / −13.3 / −14.6 m; port deck edge −11.58 m (−14.63 only between Z −38…18) |

## Findings

### P1 · fix before merge

**1. Integration test fails under the default timeout.** `src/simulation/aircraft.test.ts` "aircraft weapons resolve actual ship hits…" was extended from 110 s to 200 s of full combat (12,000 ticks) and took 7.67 s here, over bun's 5 s default. `package.json`'s `test` script (`bun test src/simulation …`) passes no `--timeout`, so `bun run test` fails on this machine; the earlier evidence runs used an explicit `--timeout 30000`. Fix: pass a per-test timeout as the third argument of `test()`, or shorten the run (hits occur well before 200 s).

**2. The lane runs the starboard wing through the island.** `aircraft.ts:126,157` taxi and accelerate along `launchPosition.x = 4`. The island base (`island-base` footprint X 8.53…13.56, Z −32.3…15.2, 4.4 m high above the deck) intersects the starboard wing of all three types for the length of that band (tips at 9.8 / 10.3 / 11.6 m). Every takeoff run (Z 70 → −72) and every parking taxi to spots 0–11 (Z < 15) passes through it. The discrepancy register says the lane was placed "to avoid the modeled island"; only the parking row avoids it. Separately, parked port wingtips overhang the port deck edge by 1.2–3.0 m outside the Z −38…18 sponson. Suggested fix: move the lane to the centreline (X = 0 puts the TBD tip at 7.6 m, inside the island's 8.53 m) and keep spots so that `|x| + span/2` stays inside the flight-deck footprint; or author an explicit spot table in the blueprint. Whatever is chosen, correct the register wording.

**3. Sortie cadence dropped ~7× and the docs understate it.** `aircraft.ts:114-115,169-170` make taxi, takeoff (including the 3.5 s airborne climb-out), landing, rollout and parking mutually exclusive per carrier. Measured: 16–22 s per launch and 27–32 s per recovery; a 9-plane order occupies the deck for 2.5 min during which nothing can land, and a 9-plane recovery blocks launches for 4–5 min. Bots order all three squadrons at t = 5 s, so a bot carrier's fighters (160 s endurance rule) come home while its bombers are still launching. README says "at least three seconds between takeoffs", which is literally true but not the operative limit. Suggested fix: make only the deck run (`takeoff` with timer ≤ 4.5 s), `landing` final and `rollout` exclusive; let `taxi` and `parking` proceed concurrently with a hold-short point at the datum; give returning aircraft priority over queued launches so fuel-limited flights are not starved. At minimum, document the measured cadence.

### P2 · should fix

**4. A stationary lane holder can block recovery.** A taxiing plane that reaches the datum while `airServiceAvailable` is false (roll ≥ 0.22, pitch, flooded service magazine) or while `flying >= MAX_AIRBORNE` stays in `taxi` on the datum indefinitely (`aircraft.ts:134`, verified 30 s at roll 0.30). Landings also require service, so the usual case only delays; at the airborne cap it is a real deadlock for that carrier until a loss elsewhere or a manual recall. Fix: return the holder to `parking` after a timeout, or exclude a stationary holder from the landing `busy` set.

**5. Landing entry snaps the velocity.** `aircraft.ts:175-177` set velocity straight at the datum while the heading slews at 1 rad/s. A plane that enters `landing` while circling away from the carrier flies sideways or backwards for up to ~3 s. Keep `fly()` (turn-limited) until aligned within ~10°, then switch to the guided final.

**6. Render hitch at liftoff and un-interpolated deck motion.** On deck the view uses the current tick's `deckPosition` on the displayed (interpolated, one tick behind) hull (`AircraftView.ts:59-65`); airborne it lerps `previousPosition → position`. At the 4.5 s switch the drawn position steps back by up to one tick of ground speed (~1 m at 63 m/s). Deck motion is also not interpolated, so taxi/run/rollout stutter at display rates above 60 Hz. Keep a `previousDeckPosition` and lerp local positions.

**7. Deck aircraft vanish the instant the carrier is flagged sunk** (`aircraft.ts:107`) while the hull is still visibly afloat. Keep them parked (and drawn through the hull matrix) until the deck datum is below the waterline or the hull view hides.

**8. Full instance-buffer uploads every frame.** `CAPACITY` is now 504 (×64 B = 32 KB per batch, 315 batches ≈ 10 MB of instance buffers, up from 2.9 MB). `AircraftView.ts:100` sets `instanceMatrix.needsUpdate` on every batch every frame; three r185's WebGPU backend uploads the whole buffer when `updateRanges` is empty, so ~105 visible batches at one LOD upload ~3.4 MB per frame for a handful of aircraft. Use `clearUpdateRanges()` + `addUpdateRange(0, count * 16)` and flag only batches whose count is non-zero. Capacity itself is fine: per model ≤ 60 carriers × 6 = 360 instances across LODs; payloads ≤ 144 + 256 + 128 = 528 ≤ 768.

**9. `Game.init` now hard-fails the port on an aircraft asset error.** `Game.ts:181` awaits `aircraftView.load()` before the scene is assembled; a missing or corrupt aircraft GLB aborts Enterprise's port entirely (before this change it only aborted battle preparation, which the loading test covers). Catch, log, continue without deck aircraft, and report progress for the ~6.5 MB of aircraft GLBs.

**10. Per-frame lookups and allocations.** `AircraftView.ts:56` does `sim.actors.find` per plane (up to 1080 × 60), `aircraftDeckSpot` does `indexOf` per plane, and lines 65/68/71/72/104-105/110 allocate `Quaternion`/`Vector3`/`Euler` per plane. `Game.ts:426` runs `updateMatrixWorld(true)` on every hull each frame although only carrier roots are needed and the renderer traverses again. Build an actor map once per frame and update only carrier roots.

### P3 · nice to have

**11. Derived spot layout is not validated.** `aircraftDeckSpot` assumes `launch.x − 11` and `min(0.76 L, 187 m)` fit the deck; another blueprint could place spots off the deck or with a pitch below aircraft length. Validate spot bounds against `hull.beam` / the flight-deck footprint in `compileShip`, or author the row in the blueprint.

**12. Payload pop-in.** Weapons appear when a plane starts taxiing and disappear at rollout (`AircraftView.ts:92`). Reasonable abstraction; showing them from `queued` would read as arming on the spot rather than materialising on the lane.

**13. Taxi heading snaps** 90° for lateral moves (`aircraft.ts:42`); a turn-rate limit like `fly()` would remove the pivot.

**14. Evidence.** `launch.png` is indistinguishable from `parked.png` at capture resolution; the takeoff run is evidenced only by `runtime.json`'s recovered count and by tests. A mid-run capture (plane at Z ≈ 0 on the lane) would show both the run and the island clearance issue.

### Verified correct (no action)

- **Inventory:** 18 stable spots per carrier, fixed by index; lost aircraft leave gaps; the same objects cycle ready → queued → taxi → takeoff → … → rollout → parking → rearming → ready; no respawn; reset recreates wings; telemetry buckets updated (queued includes taxi, rearming includes rollout/parking).
- **Carrier movement:** deck phases are local and re-posed each tick; landing velocity includes the carrier's velocity; recovery on a 25 kn turning carrier is continuous (table above); rollout and taxi stay on the lane in local coordinates; 9-plane recovery underway loses nothing.
- **Recall:** queued → ready, taxi and deck-run → parking, airborne → returning, landing untouched; the recalled-group regression test passes.
- **Sunk carrier:** deck and deck-run aircraft are lost; airborne survivors continue and then hold (documented).
- **Renderer:** only the player's deck is drawn in port; inspection modes hide aircraft; empty batches and payload batches are hidden (closes the earlier P3); gear now honours the `axis`, `fixed` and `articulation` extras with the tail wheel at half angle (closes the earlier P1); props stop while parked; traces are clamped to the buffer; the view test checks the transformed spot matrix against the carrier matrix.
- **Asset consistency:** the datum change is part of the content hash, so the Enterprise GLB/JSON rebuild is required and the published hash matches the `runtime.json` review hash.
- **Tests I ran:** `AircraftView.test.ts` and 14 of 15 `aircraft.test.ts` pass; the one failure is the timeout in finding 1, not a logic failure.

## Disposition

**Approve with required fixes.** Finding 1 is a one-line change. Finding 2 is a blueprint datum change (X = 0 or an authored spot row) plus a register correction and an Enterprise rebuild. Finding 3 needs at least a documentation correction; the scheduler change (exclusive deck run/final/rollout only, landings prioritised) is recommended because it also resolves finding 4.

## Validation limits

- I did not open the diagnostic page or the game in a browser; visual conclusions come from the supplied captures and from blueprint footprints, not from rendered geometry. The island clearance numbers use the `island-base` footprint; superstructure above it is wider in places, so real clearance is no better than stated.
- The measurement script drove `stepAircraft` directly with a scripted carrier motion; it did not exercise `CombatSimulation.step` ordering, AA or enemy aircraft.
- No historical claim is made about spotting, deck cycles or timings; the register's approximations stand.
