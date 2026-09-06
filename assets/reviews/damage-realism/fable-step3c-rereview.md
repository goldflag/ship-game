# Step 3c re-review — penetration reference calibration (basslet, base 55e13ad + working tree)

Reviewer: Claude Fable, read-only. Scope: `assets/parts/calibrate-penetration.ts`, `penetrationReferenceSpeedMps` in the schema/compiler/launch path, catalog values and basis text, the new schema and launch-budget tests. Log: `/tmp/basslet-step3c-calibration-tests.log` 35 pass / 0 fail. Probe: `scratchpad/probe14.ts` (no catalog writes).

## Verdict: **B1 resolved. Step 3c accepted.**

## Verified
- **Recipe semantics**: reference = impact speed of a nominal shot from 10 m to a sea-level target at 5 km (naval, caliber ≥ 0.1 m) or 1 km (small AA) under the gun's own linear drag; launch budget = `penetrationMm × (|v_launch| / reference)^1.4`; omitted reference falls back to muzzle speed. Inputs are `muzzleSpeed` and `dragPerSecond` only, so the recipe is idempotent by construction (6-decimal rounding).
- **Numbers reproduced independently** (600 Hz integration): all nine reference speeds within 4e-7 m/s of the catalog; nominal muzzle budgets 645.79 / 262.80 / 738.32 / 258.35 / 129.11 / 18.59 / 12.01 / 359.28 / 129.11 mm as stated; budget at the reference condition equals the legacy value exactly (550, 160, 650, …).
- **Accepted outcomes preserved bit-for-bit** (seed 11): Bismarck vs Bismarck 850 m → 201 s / 0.8 m³; 5 km → 346 s / 104.8 m³ / 1.0° list; Baltimore stern 5 km → 313 s / 75 m³. Protected engine-port fixture at 850 m: hp 140, turtleback stops (budget 629 < 638).
- **Immune band now** (38 cm vs Bismarck, nominal launch): turtleback stops the belt path to 15 km; the belt itself stops from 18 km; armour deck ricochets to 13 km, stops 18–25 km, is defeated at 28 km (48°). This is the "646" column of my B1 table. At 15 km the belt is penetrable again (373 vs 352) and the 25-minute duel produces 154 m³, 1.5° list and 22 module events (no sink); 22 km remains a no-damage band by the accepted 5 km calibration and the immune-band statement.
- **Determinism** unchanged (30/60/144 fps identical with fixed inputs). Fleet cost 1.58 ms/tick on my host (host variance; the change touches launch only).
- **Records**: basis text states legacy game calibration, reference condition, descent recovery and the recipe path; no historical claim. Cached-aim comment and bot note (out-of-range mounts hold train) present.

## Nits (no action required for 3c)
- The basis string is long and repeated per part; a shared catalog-level note plus per-part reference would read better, cosmetic only.
- The 22 km stalemate stays until deck defeat becomes reachable through fuzed plunging fire or a calibration choice in a later slice; it is documented, so fine.
- N1 from my previous review (exit speed after penetration) still stands for 3d.
