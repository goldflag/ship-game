# Step 3a review — thin-plate response and plate broad phase (basslet, base 3bdd9d0 + working tree)

Reviewer: Claude Fable, read-only. Reviewed the diff from 3bdd9d0 (`protection.ts`, `damage.ts`, `geometry.ts`, `ShipInspection.ts`, `PortInspection.tsx`, `Garage.css`, `GunneryPanel.tsx`), new `gunfire-realism.test.ts`, and the step-2 `scripts/tests/damage-realism-browser.ts` fixture. Logs: `/tmp/basslet-step3a-tests.log` 143 pass / 1 timeout (see T1). Probes: `scratchpad/probe6.ts`.

## Verdict: **no blockers; step 3a is acceptable.** One calibration note worth a decision (C1), one flaky-test risk (T1), and two nits.

## Verified
- **plateResponse** is shared by `hitShip` and `protectionTrace(…, caliberM)`; no-caliber callers keep the heavy-plate cutoff (cos < 0.2, 78.5°). The only non-test caller without caliber is `scripts/reference/measure.ts`, which is a reference artifact and correctly conservative.
- **Thin plates no longer deflect large shells**: 30-min underway census at 850 m now logs 80 ricochets, all off the 80 mm Armor Deck; the 12 mm Battery Deck ricochets from my first review are gone. Heavy paths are unchanged: broadside and plunging traces at 5°/10°/20°/30° reproduce the first-review results exactly (belt 320 + turtleback stop; armor deck 80 mm ricochet at ≤10° stays, by design until 3b adds velocity/drag).
- **Broad phase is exact**: 3 000 random segments × all 743 Bismarck plates (2.23 M pairs, 7 358 reference hits, random trains on mounted plates) → 0 mismatches against direct `segmentPlate` (t within 1e-12, points within 1e-9). The 1e-5 tolerance matches the compiler's plate-bounds check.
- **Performance**: `hitShip` broadside segment 272 → 96 µs; 5v5 mixed fleet 60 s at 5 km 2.0–2.2 → 1.27–1.34 ms/tick on my (loaded) run, consistent in direction with your 0.85–0.95.
- **Stock outcomes preserved**: Bismarck at 850 m / 5 km sinks at 201 s / 186 s by fallback with 0.0 m³, as agreed for C1 of step 2.
- **UI**: port Armor list groups the 466 end-closure surfaces under one native `<details>` keyed by `surfaceId`, individual rows still selectable ("Surface n"), group auto-opens when its plate is selected; CSS switched from child to descendant button selectors so nested rows keep styling. Combat X-ray hides dry compartments only in mode `all`, and `update()` reassigns `group.visible` every frame before the dry check, so a space that floods later reappears (no stuck-hidden bug). Port Internals unchanged. Explanatory text updated.
- **Browser fixture** (`damage-realism-browser.ts`, step 2): controlled through-shot on the mounted game's real simulation, pumps off, documented as not stock gunnery; appropriate for the scripted CPU replay acceptance.

## Findings

### C1 · Grazing thin plates now read as "stopped" with very large resistance — calibration note (decide, not block)
Resistance floor moved from cos ≥ 0.2 to cos ≥ 0.04, so a thin plate at extreme obliquity returns up to 25× its thickness. Examples from `plateResponse` at 85°: 12 mm → 138 mm, 20 mm → 229 mm, 45 mm → 516 mm; at 88° a 12 mm plate returns 300 mm. A 15 cm shell (160 mm budget) hitting the 12 mm battery deck between its 86.8° cutoff and ~88° is therefore **"Stopped by Battery Deck 2 (12 mm, 300 mm resistance)"** in the hit ledger rather than deflected or torn. The physical outcome (no penetration) is defensible; the ledger wording and the magnitude are not, and thin-plate stops of secondary calibers will be common once 3b adds dispersion. Options: cap thin-plate resistance at k × thickness (e.g. 8–10×) and let very shallow hits ricochet, or label non-penetrations above ~80° on plates with ratio < 0.05 as `deflected`. Either is a one-line change; I'd fold it into 3b with the velocity model.

### T1 · Bot battle test near its 5 s timeout — low (flakiness)
"every bot maneuvers, fires both applicable batteries…" runs 90 s of a mixed fleet; it timed out at 6.47 s under host load in the full run and the whole file takes 2.7 s isolated. With the 743-plate Bismarck and step-3b dispersion it will get slower. Raise that test's timeout (bun `test(name, fn, timeout)`) or cut the simulated duration; not a code defect.

### N1 · Reference probes and combat now disagree on thin plates — nit
`measure.ts` probes report `ricochet: true` for thin plates above 78.5° because they pass no caliber; combat with a caliber will penetrate the same plate. Fine for a conservative reference, but note it in the reference README so a probe "ricochet" is not read as a combat prediction.

### N2 · Armor list heading — nit
The heading still says "927 volumes"; with grouping the visible list has 462 entries. Consider counting groups, or "927 surfaces in 462 entries".

## Scope check
No blueprint, catalog or model changes; `protectionTrace` signature is backward compatible (optional trailing caliber); events/ledger unchanged apart from the new resistance values; determinism unaffected (no RNG yet). Nothing here pre-empts 3b (drag/aiming/dispersion) or 3c (fuzes/bursts).
