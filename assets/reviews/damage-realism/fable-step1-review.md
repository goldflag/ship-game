# Step 1 review — hit/flood accounting and explanation (basslet, base 45392d0)

Reviewer: Claude Fable, read-only. Reviewed `git diff` (combat.ts, damage.ts, GunneryPanel.tsx, styles.css) plus untracked `src/simulation/hull.ts`, `src/simulation/damage-realism.test.ts`, `assets/reviews/damage-realism/README.md`. Evidence: `/tmp/basslet-step1-tests.log` (129 pass, 0 fail), `/tmp/basslet-step1-build.log` (build green), plus my probes `scratchpad/probe2.ts` and `probe3.ts`.

## Verdict
**Step 1 is acceptable.** No blocking correctness defect. The agreed first-patch acceptance is met: outside water impact splashes, interior sea-level crossing continues, above-water openings stay dry until submerged, below-water inflow uses the actual opening position, and every loss carries a cause. Existing protected engine-port fixture is retained. Four items below should be fixed before or alongside step 2 (two medium, rest low); none of them makes prior behaviour worse.

## Verified correct
- **Hull query** (`hull.ts`): 35 k-point scans on all four presets return only booleans; bow/stern/beam/keel/deck exclusions match the section data (Bismarck raked stem and counter stern exclude waterline points 2–3 m from the tips, which is the data, not a bug; Enterprise waterline half-breadth 12.42 m < 14.02 m deck beam, also data). Enterprise's 11 adjacent section pairs with differing point counts produce no NaN in the mixed-count branch. Station convention `station = L/2 − z` matches the blueprint comment and the compiler's span rule, so `findIndex` cannot run off the end.
- **Sea-contact fix** (`combat.ts` insideHull): vertical 38 cm shell at [0,20,−21] now goes Upper Deck → Battery Deck → Armor Deck → boiler module → exits keel → splash; previously it splashed at y = 0 inside the hull. Open-sea crossing still splashes (test covers x = 40).
- **Breach semantics** (`damage.ts` addBreach/updateFlooding): actual local position, per-opening wetted fraction and head from the immersed centre or the internal free surface, whichever is higher; list-aware (test). Cap of 4 m² per compartment preserved. Magazine breach at magazine centre floods as before.
- **Defeat cause**: `structural-fallback` / `flooding` / `magazine`, set once, stable across ticks (test), surfaced in the `sunk` event and gunnery panel. Sinking rules unchanged (integrity ≤ 0 or water ≥ reserve buoyancy).
- **Impact ledger**: ordered per-hit records with thickness, material, obliquity, resistance, before/after budget, damage, compartment and terminal flag; per-target filter in telemetry; determinism test still passes with records in the event stream.
- **UI**: rendered inside the already-scrolling `.gunnery-details` (max-height + overflow auto), so 8 × N impact lines cannot overflow the viewport. Existing panel reused, no redesign.

## Findings

### M1 · Unbounded breach object count for small calibers — medium (perf/serialization)
`addBreach` (`damage.ts`) pushes one `Breach` per penetrating hit until the 4 m² area cap. Area per hit is caliber², so 5-inch = 0.016 m² → up to 250 objects per compartment; 1.1-inch/20 mm = 0.0008/0.0004 m² → up to 5 000–10 000 if they ever penetrate. Observed: Baltimore twin 5-inch vs Baltimore, 10 min → **249 breach objects in `aft-machinery`**. `updateFlooding` walks every breach every tick for every actor, and `DamageState` (serialized by the fps-determinism test and any future snapshot) grows accordingly.
Repro: `probe2.ts` scenario "Baltimore sec vs Baltimore". Suggest merging a new breach into an existing one within ~1 m (sum area, keep centroid) or a per-compartment count cap.

### M2 · Shell history ring is shared by every actor's shells — medium (UX in fleet battles)
`CombatSimulation.history()` keeps the 64 most recent shells regardless of owner. Enterprise secondaries alone emit 38 shells per 0.45 s (probe: 20 574 shots in 5 min), so in a mixed fleet the player's shells are evicted from the ring before they land and "Recent shell impacts" shows nothing or stale entries. Suggest keying the ring to player-owned shells (or per-owner rings) since the panel only ever shows the player's target.

### L1 · Teak now emits an effect-bearing `penetration` event — low (VFX/perf, semantics)
`damage.ts`: teak backing now reports kind `penetration` ("Passed …", outcome `backing`) with a surface normal. `CombatEffects.impact` (`CombatEffects.ts:210`) fires a flash, 22 sparks, 9 smoke puffs and a light for any event with a normal, so every belt penetration now spawns three bursts within 0.1 m (belt, teak, support) instead of two. Audio dedupes per shell, so no extra sound. Event count per belt hit rose from 2 to 3 (probe: 216 vs 144 penetration events), churning the 128-event ring faster. Suggest recording the backing crossing in the ledger without emitting a normal-bearing event, or having effects skip `impact.outcome === 'backing'`.

### L2 · Pass-through shells are labelled "splash", and the exit splash lands under the hull — low (UX)
A shell that penetrates decks, damages a module and exits the keel gets history outcome `splash` with 4 impacts, and the `splash` event is placed at [x, 0, z] inside the hull footprint (water-column VFX and wake foam under the ship). Previously the same shell splashed at entry inside the hull, so this is relocated, not new. Suggest an explicit `passed-through` outcome when impacts > 0, and suppressing splash effects when the end point is inside a hull envelope (the query now exists).

### L3 · Mounted-plate hit produces two ledger rows — low
For turret plates `report('penetration')` then `report('module')` push two `ImpactRecord`s for one crossing (`penetrated`, then `damaged/destroyed`). Harmless; consider a single terminal row.

### L4 · Defeat cause after a non-fatal detonation — low (product)
`structuralDamage(…, 450, 'magazine')` only labels the loss `magazine` if that blow zeroes integrity. Detonation at 600 → 150, then belt hits → `structural-fallback`. Acceptable under "fallback is honest", but consider recording contributing detonation in telemetry so the panel does not read "magazine detonation … loss cause: structural fallback".

### L5 · Records and docs — low
No dated validation entry for step 1 yet (`docs/ship-validation.md`); the roadmap README lives under `assets/reviews/` while the older plan is in `docs/`. `ImpactRecord.position` is ship-local while `CombatEvent.position` is world; worth a comment for diagnostics consumers.

## Observation to record, not a defect of this patch
Gunfire still yields **0.0 m³** water in every probed scenario (Bismarck main at waterline/engine/steering, Yamato vs Bismarck, Baltimore vs Baltimore, Enterprise vs Enterprise). With honest opening positions, waterline-aimed hits land at y ≈ 0.3–0.96 m and a 38 cm opening (radius 0.21 m) never dips below the sea; the ship never settles because nothing floods, so nothing ever submerges. The previous "flooding" was an artifact of the old height clamp. This is exactly the step-2 flood-space/geometry work and should be stated in the validation record so "Flooding 0.0 m³" is not filed as a regression. Sinking cause in all these runs is `structural-fallback`, as agreed for now.

## Scenarios (all from `probe2.ts`, base 45392d0 + patch)
| Scenario | Result |
|---|---|
| Bismarck main @ waterline, 850 m, 10 min | sunk 201 s, cause structural-fallback, water 0.0, 44 breach objs (turbine-port 4 m², void-port-120 2.3 m²) |
| Bismarck main @ steering | steering disabled after 2 hits; breaches at y 0.29–0.37, dry |
| Baltimore 5-inch vs Baltimore | sunk 214 s, 249 breach objects in one compartment, dry |
| Enterprise 5-inch vs Enterprise | 1184 stopped / 4 penetrations in 10 min, 2 breaches at y 1.98, dry |
| Vertical 38 cm through deck at [0,20,−21] | 3 deck penetrations → boiler damaged → keel exit → splash; history outcome "splash" |
