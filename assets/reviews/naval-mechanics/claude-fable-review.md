## Naval mechanics review — branch `goldflag/plausible-naval-mechanics` vs `20f20649`

Scope reviewed: all simulation diffs plus new `contactDamage.ts`, `sea.ts`, `ExpandableInstances.ts`, renderer diffs, catalog/authoring changes, docs, and the new tests. I ran scratch probes from `/tmp` against the worktree sources (submarine heave, end-to-end ricochet, HE/AP near misses, diving shells, T-bone ramming, grounding, wavy-surface skims, carrier ops in weather, post-maneuver settling for every preset). The background run of the simulation suite was stopped before completing, so the pass claim in the README is not independently confirmed here. Your later sea.ts sign fix and the master merge are outside these findings.

### Blocking bugs

**1. Surfaced submarines flip to "submerged" on every wave trough.** `stepSubmarine` now adds `waveHeave` into `motion.y` (`submarine.ts:65`), but every submerged classification still reads raw `motion.y`: `submarine.ts:33` (handling switch), `machinery.ts:45` (engine module selection), `weapons.ts:88` (mount status `submerged`), `sea.ts:42` (resistance/leeway), `combat.ts:483,503,506` (depth and Diesel/Electric telemetry), `Game.ts:701` (binocular path), and `antiAircraft.ts:35` at −1 m is borderline. Probe: surfaced Type VIIC, north-atlantic, storm-clouds, full throttle, 60 s.

| metric | calm | storm |
|---|---|---|
| ticks flagged submerged | 0 | 978 / 3600 |
| propulsion readout flips | 1 | 16 |
| deck gun `submerged` ticks | 0 | 977 |
| speed band (last 30 s) | 7.10 | 5.34–5.92 |
| depth readout with targetDepth 0 | 0.00 | 0.76 m |

Fix: expose one ballast-depth helper, `-(motion.y - (submarine.waveHeave ?? 0))`, which `stepSubmarine` already computes at line 45, and use it at every site above. Default map weather (0.72 m envelope) stays under the threshold, so this only appears in overcast/storm, which is exactly when players will notice.

**2. Fletcher and Flower corvette no longer float at their authored waterline in battle.** `resolveBattleFleet` now always supplies weather (`battle.ts:60`, default `map`), so `sea` is always defined and the calm-water shortcut at `stability.ts:37` is bypassed from tick 0 in every battle; the turning-heel term bypasses it after any turn even with no weather. That exposes trimmed equilibria in two hull profiles. Probe, straight sailing, default map weather, 60 s mean:

| ship | mean y | stability.targetY | pitch |
|---|---|---|---|
| fletcher (new profile, this branch) | +0.42 m | +0.66 m | −0.06° (calm-turn case: −1.4°) |
| flower-corvette (pre-existing profile) | +0.82 m | +1.27 m | −0.30° |
| bismarck, yamato, kgv, baltimore, enterprise, viic, liberty, victory | 0.00 | 0.00 | 0 |

Upright flotation solves to y = 0 with zero pitch arm for both hulls, so the drift comes from the finite-angle integrator settling at a nonzero trim where CB and CG align at a different draft. A destroyer riding half a meter high with a visible trim changes the underwater hit envelope, torpedo geometry, breach heights, and the hull pose in every battle. Suggested fix: add a settle test that steps each preset 60 s with `sea` defined and asserts `|y| < 0.05` and `|pitch| < 0.005`, then chase the pitch equilibrium in `hydrostatics`/`rightingArms` for these two hulls. As a stopgap, keep the shortcut when the sea contribution is exactly zero.

### Plausibility and tuning observations (not blocking)

- **CPU sea vs rendered sea are different waves.** `sea.ts:14` uses 4× the FFT amplitude and 4× the peak wavelength. Storm gives a 1.92 m, 144 m swell while the GPU peak is 36 m and its amplitude is documented as not a height in meters (`docs/ocean-configuration.md:9`). Hulls will heave and roll to a swell nobody sees. Consider tying the envelope wavelength to the GPU peak and letting the water shader add the same CPU long wave as displacement.
- **HE misses now fire the ship-burst fireball and explosion cue.** Water-entry bursts carry `detonation: true`, so `CombatEffects.ts:295` runs `shellBurst` and `audio.ts:63` plays the magazine-explosion cue for every HE splash; armed AP bursts draw a fireball 5–11 m underwater. Route bursts with `targetName === 'Burst outside ship'` at or below the surface to a water-column effect and splash cue.
- **Ricochet outcome label.** A deflected shell that then falls into the sea reports `passed-through` in the gunnery panel (`combat.ts:367`). Set `ricochet` when the last impact was a ricochet.
- **Ramming is mild and symmetric.** T-bone probe: Bismarck into a Fletcher broadside at 12 m/s costs the Fletcher 68 of 600 HP and the Bismarck 114 of 1450; a 4-knot BB-on-BB nudge costs 53 HP each plus a 0.19 m² breach. Region caps saturate above ~8 m/s. The 50/50 energy split ignores bow versus struck side. Constants in `contactDamage.ts:14,21` are documented as provisional; flagging for intent.
- **Grazing shore contact stops the ship dead.** `land.ts:32` zeroes forward speed whenever `inward > 0`. Project out only the inward component, as the collision solver does.
- **Draft readouts now show wave heave.** `playerDraftChange = -y` and the submarine Depth readout oscillate with the envelope (`combat.ts:488-489,503`). Subtract heave or label it.
- **Penetration semantics changed for previously unprofiled guns.** New `penetrationReferenceSpeedMps` values make the catalog `penetrationMm` an at-range figure: 5"/38 muzzle budget 65 → 129 mm, 40 mm Bofors 18 → 33 mm, 20 mm 20 → 41 mm. Consistent with the calibrated guns' convention, but confirm it is intended.
- **Mechanics ram test is a degenerate geometry.** Bow-tip on bow-tip lets the SAT pick a bow-edge normal, so the test exercises a glancing contact. A T-bone fixture would test the intended case.
- **No visual for ramming or grounding.** The `contact` event has no shell and no normal, so effects fall through (`CombatEffects.ts:296-297`); audio plays `armor-hit`. Harmless, but a spray burst at the contact point would match the "inspectable damage feedback" rule.
- **Minor:** `seaResponse` is evaluated twice per actor per tick (`combat.ts:379,381`); `ExpandableInstances.publish` marks every page dirty each frame and never releases pages; `stepShip` decelerates at the fixed braking rate for any throttle reduction, so "coasting" is just braking.

### Verified as working

Ricochet continues the same tick with the correct reflected path and armed fuze, and does not re-hit the visited plate. Exact air/water splitting is deterministic across tick subdivisions. Underwater AP strikes penetrate Bismarck lower plating and open breaches; steep AP entries burst about 11 m along the path; shallow entries retire without arming. Two hundred shallow impacts on a storm surface produced no silent `expired` ends. Grounding damages once, depends on draft, and ships back off in reverse. Carrier launch and recovery completed six of six in calm, default, and storm seas. Collision attribution, frag credit, and reset determinism of the sea state are correct. All global launch caps are gone and instance paging inherits visibility correctly.
