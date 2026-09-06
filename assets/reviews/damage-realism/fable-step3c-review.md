# Step 3c review — impact-speed penetration, materials, speed dispersion, aim caches (basslet, base 55e13ad + working tree)

Reviewer: Claude Fable, read-only CPU review. Diff from 55e13ad: `ballistics.ts`, `protection.ts`, `damage.ts`, `weapons.ts`, `bots.ts`, `combat.ts`, `blueprint.ts`, `guns.json`, `GunneryPanel.tsx`, tests. Log: `/tmp/basslet-step3c-tests.log` 155 pass / 0 fail. Probes: `scratchpad/probe11.ts` … `probe13.ts`.

## Verdict: **implementation accepted; one data blocker before this slice can be called done.**
The code is correct and consistent, but the catalog `penetrationMm` values were not re-referenced when their meaning changed to "at muzzle speed", so effective penetration at range dropped 15–60 %. Bismarck can no longer penetrate her own belt beyond ~12 km or her armour deck at any range under 28 km; a Bismarck-vs-Bismarck duel at 15 or 22 km now runs 25 minutes with 160 hits and **zero** structural damage, flooding or module loss, where 3b (accepted) produced 21 m³ / 3 modules and 928 m³ / 8 modules. Fix is data-only (B1). Everything else is accepted; nits below.

## Verified
- **Residual budget follows speed exactly and is path-independent.** Per-tick scaling telescopes to 550 × (v/820)^1.4 with 2e-12 mm error along a 20 km arc; the budget dips at apogee and regrows on descent, so impact budget depends only on impact speed. 38 cm budget: 536 mm at 850 m, 468 at 5 km, 391 at 10 km, 318 at 15 km, 251 at 20 km, 192 at 25 km.
- **Material and grazing table** is monotonic with no gap between the ricochet cutoff and the resistance floor: thin sheets cap at 10× thickness (11× KC), ratio ≥ 0.2 plates ricochet before the floor matters, KC 1.1 / Ww 0.9 applied after the cap. Trace and `hitShip` agree (tests).
- **Aim caches under change**: with dispersion and speed σ disabled, barrel-0 closest approach to the aim-at-launch is 0.02–0.48 m for a hard turn at full speed (yaw 0.019 rad/s), full ahead at 15 km, a 15 m/s crossing target at 10 km, and 2 km aim jumps every 10 s (cold path reacquires within the interval). Barrel 1 sits at its 3.75 m spacing as before.
- **Bot lead/skip logic**: out-of-range, disabled or empty bot mounts receive no aim and hold their train (`aimCache` cleared); in-range mounts converge from the `leadCache` in one solve. 
- **RNG**: speed fraction mean −3e-5, σ 0.00299 (target 0.003), max |Δ| 0.0090 (3σ cap), correlation with angular error −0.006; fixed-input state identical at 30/60/144 fps; seeds 7 ≠ 8; reset replays byte-identical physics with ids masked (monotonic ids intentional).
- **Stock outcomes (seed 11)**: 850 m 201 s / 0.8 m³ (3b 1.5); 5 km 346 s / 105 m³ / 1.0° list (3b 306 s / 3 m³); Baltimore stern 5 km 313 s / 75 m³; Yamato vs Bismarck 12 km 798 s / 376 m³ / 3.6° list. Defeat still `structural-fallback` (step 5).
- **Cost**: 5v5 fleet 60 s 1.35 ms/tick on my host (3b 1.98–2.07; base 0.90), matching your 1.42–1.45.

## Blocker

### B1 · Catalog penetration not re-referenced to the new muzzle semantics — data, fix before merge
Before 3c `penetrationMm` was range-independent (an effective ~850 m number). Now the same 550 is scaled by (v/820)^1.4, so the 38 cm carries 318 mm at 15 km against a 352 mm KC belt (320 × 1.1) and 226 mm at 22 km against the 80 mm Wh deck at 22.5° (210 mm). Probed immune band, 38 cm vs Bismarck:

| Reference | Turtleback stops belt path | Belt itself stops | Armour deck |
|---|---|---|---|
| 550 (now) | ≤ 11 km | from 13 km | ricochet ≤ 9 km; stops 18–28 km; never defeated |
| **646** (preserves 850 m and 5 km outcomes exactly) | ≤ 15 km | from 18 km | stops 18–25 km; defeated at 28 km (48°) |
| 750 | citadel reachable at 850 m–5 km (breaks the protected engine-port fixture) | from 20 km | defeated at 28 km |

Recommended: set each part's `penetrationMm` to `old / (v_5km / v_muzzle)^1.4` (38 cm: 646; per gun from its own k) and state "referenced to muzzle speed" in `basis`. This keeps every accepted 850 m / 5 km behaviour and the protected fixture (630 < 638 at 850 m), makes the belt penetrable out to ~15 km (historically plausible), and keeps the deck immune to ~25 km (defensible; 3b's 928 m³ at 22 km was an artefact of the range-independent 550). The "420 mm KC penetrated at 1 km / stopped at 20 km" test still holds (627 > 462; 295 < 462). If instead you choose to keep 550 and accept the stalemate band, document it as a game rule and reduce `botGunRange` so bots do not open fire in a zone where they cannot hurt each other.

## Findings (non-blocking)

### N1 · Armour consumes budget without slowing the shell — examine before fuzes (as you asked)
Consistent with the 1.4 exponent, exit speed after paying resistance R from budget B at speed v should be `v × ((B − R)/B)^(1/1.4)`. 5 km belt hit: 731 m/s, budget 468, belt 352 → residual 116 → consistent exit 270 m/s (now 731). A 0.035 s fuze then travels 9.5 m instead of 25.6 m, which decides whether AP bursts in the citadel or in the far wing. Later plates see the same residual either way, so this only matters for fuze distance, exit splash velocity and the HUD impact speed of the second plate. One line in `hitShip` after each penetration keeps speed and budget on the same curve; do it in 3d together with the fuze.

### N2 · Budget regrowth on descent — note in the basis text
Expected from "budget follows speed" and path-independent, but a reader of the ledger may see `penetrationBeforeMm` rise between apogee and impact. Worth one sentence in the catalog basis.

### N3 · Out-of-range bot guns stop tracking — nit
They hold train, so on entering range they need up to a full traverse before `aligned`. Acceptable and cheaper; mention in the bot notes.

### N4 · Cache validity keys on aim point only — nit
Heading and inherited-velocity changes are absorbed by the one-iteration warm start (verified sub-metre in a hard turn), so no fix needed; a comment saying why the 10 m test is sufficient would help the next reader.

## Scope check
Optional `muzzleSpeedSigmaFraction` validated (≤ 0.05); omitted parts keep 3b behaviour; `MountState` caches serialize deterministically and reset with the actor; HUD adds impact speed only. Nothing pre-empts 3d (fuzes, turret continuation, bursts).
