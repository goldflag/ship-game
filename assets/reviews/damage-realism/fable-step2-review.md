# Step 2 review — flooding-to-loss-of-capability (basslet, base 92cb1c9 + working tree)

Reviewer: Claude Fable, read-only. Reviewed the source diff (`blueprint.ts`, `damage.ts`, `combat.ts`, `GunneryPanel.tsx`, `ShipInspection.ts`), new `machinery.ts` + tests, `author-flood-spaces.ts`, the four source blueprints (topology summarized by script, not dumped), discrepancy/implementation records. Logs: 140 tests pass; all four `ship:build` logs report `passed`. Probes: `scratchpad/probe4.ts`, `perfbase.ts` (step 1 tree extracted from 92cb1c9 via `git archive` for a like-for-like timing).

## Verdict
**Mechanically sound; acceptable as step 2 with two data fixes I consider part of this step (M1, M2) and one explicit caveat that must be written into the record (C1).** No correctness blocker in the simulation code. The remaining items are deferred to steps 3–5 as agreed.

## What I verified as correct
- **Propulsion groups** (`machinery.ts`): per-group `share × min(mean boilers, min drives, min shafts)`; Bismarck port turbine → 2/3, plus starboard shaft → 1/3, plus centre turbine → 0 (test). All turbines or all boilers dead → 0. Validation rejects unknown equipment, shares ≠ 1, over-height immersion tolerance.
- **Immersion availability separate from HP**: flooded room disables equipment; draining restores availability; destroyed HP never heals (test). Magazine flooded → mount `disabled` via `equipmentCondition` in `combat.ts`.
- **Closed boundaries** start closed; open/damaged conserve water; closed blocks (test). Damaged aperture = min(areaM2, Σ caliber²). Standalone 5 mm slabs are real collision candidates (`kind: 'boundary'`), armor-linked ones open on plate penetration within bounds.
- **Hydraulic-head transfer**: portal-height heads on both sides, equalization cap prevents overshoot/oscillation, capacity-limited, conserved.
- **Side-region breach mapping** replaces nearest-centre for exterior hits and splits an aperture across room heights (Baltimore stock 8-inch at 5 km, steering aim: 51 m³ in stern + strips, 2 damaged boundaries, 0.38° list — the only stock-gunnery scenario that floods anything).
- **Synthetic underwater through-shot** at y = −2 m, Bismarck: 442 m³ across strips, voids, fuel bunkers and both forward boiler rooms; both forward boilers `flooded`; power 0.67; aft boiler rooms dry. This is the step-2 acceptance chain working end to end.
- **Authored spaces**: every strip's 8 corners inside the hull and no overlap with retained rooms on all four presets (test). Bismarck exterior plates are fully covered by side regions (0 of 110 sampled belt/bow/stern points unmapped; 2 of 60 lower-plating points unmapped).
- **Performance**: 5v5 mixed fleet, 60 s at 5 km: 0.90 ms/tick at 92cb1c9 → 1.00 ms/tick now (+11 %); telemetry 0.04 ms/call. Determinism test still passes with connection state in the serialized damage state.
- **Compiler**: additive optional v1 fields; old definitions without `propulsion`/`floodRegions` fall back to the previous averages and a box-distance nearest room (an improvement over centre distance).

## Findings

### M1 · Yamato's interior is unreachable by water — medium (data; fix in this step)
`author-flood-spaces.ts` caps strip width at 2 m (`inner = max(.05, outer − 2, edge + .06)`) and only authors a partition when the gap between boxes is ≤ 2 m. Yamato's retained rooms are narrow (engine rooms x ± 6.5 m against a ~19 m half-breadth), so the gap from room edge to strip is 2.5–18 m and **0 room↔strip boundaries** exist (187 connections: 180 strip↔strip, 7 legacy room↔room). Consequence: an underwater through-shot at y = −2 damages both turbines but floods only two strips (83 m³); no path can ever wet Yamato machinery or magazines. The same rule leaves Bismarck's four handling spaces unconnected (gap 3.7–7.4 m; harmless, above the strip band). Suggested fix: extend the strip inboard to the nearest retained room edge when a room overlaps in y/z (or author an intermediate wing space), then regenerate and rebuild Yamato. Baltimore (62 room↔strip) and Enterprise (78) are fine.

### M2 · End-on hits never breach on any preset — medium (data/coverage; acknowledged, but quantify it)
`exteriorBreaches` only accepts faced regions when |normal.x| > 0.5, and no end regions exist. Baltimore bow-on at y = −1: `Outer plating: penetrated → []` (no breach, no water). Bismarck has no stem/stern closure plates at all, so a bow-on shell enters with **no hull hit, no structural charge and no breach** (`Forward Transverse 1: penetrated` is the first event; stern: steering room damaged directly). Bots close at 60° angles, so many early-battle hits are end-on. The record already lists end/deck/deep-bottom coverage as incomplete; keep it a hard prerequisite to step 5 and add the bow/stern closure plates to the Bismarck armor set when end regions are authored.

### C1 · Stock gunnery still produces zero flooding on Bismarck — caveat for the record (not a step-2 defect)
Bismarck vs Bismarck at 850 m and 5 km, Baltimore vs Baltimore at 5 km, Yamato vs Bismarck at 5 km: **0.0 m³**, sinking by `structural-fallback` at 186–245 s, 0 damaged boundaries. Aim points at y = 0.5–0.8 m with no dispersion and flat trajectories put every opening above the sea, exactly as in step 1. The step-2 chain is reachable only by underwater or stern-aim geometry until step 3 adds dispersion/drag. The live browser acceptance must therefore use a scripted scenario (or a below-waterline aim) and the implementation record should say so, or the visible result will be misread as a regression.

### L1 · Armor linking is almost unused on Bismarck — low (informational)
2 of 219 boundaries link to a plate (both torpedo bulkheads at frame 120); 217 are 5 mm slabs, including boiler-room walls where the 45 mm torpedo bulkhead sits. Behaviour is still right because a shell stopped by the bulkhead never reaches the slab, and one that passes pays both. The count should be stated in the Bismarck discrepancy entry rather than the generic "existing physical protection is reused" sentence.

### L2 · Data hygiene — low
- `propulsion.basis` is the same Bismarck-specific sentence in all four presets ("Bismarck uses three linked turbine/shaft groups…") — Yamato/Baltimore/Enterprise should state their own basis.
- Enterprise module `engine-port` is named "Boilers Forward" with role `boiler`; the id is misleading.
- The four discrepancy entries are identical boilerplate; per-ship figures (rooms, boundaries, linked count, unreachable rooms) would make them useful.
- Strips have pump 0.001 vs rooms 0.03 m³/s and a 72 % fill factor; fine as stated estimates.

### L3 · Inspection UX — low
110 (Bismarck) to 144 (Yamato) new "Port outer space 3.2 · estimated" rows appear in Internals and 150 pale outlines in the X-ray. The filter works, but consider grouping strips under one entry per side or drawing them only when wet/selected. `ShipInspection` blue for flooded equipment and the panel's "Flooded · offline / Destroyed / n % available" wording are good.

### L4 · Repository churn — low (process)
A data-only blueprint change re-rendered the comparison sheets, review images and two copies of the ~98 MB review ZIP (assets + public), plus `.blend`/GLB rewrites, because the build hash covers the blueprint. Expect this on every step; consider excluding gameplay-only sections from the comparison hash or moving large generated packs out of git, as the pipeline doc already anticipates.

### Deferred (agreed later steps, listed so they are not lost)
- A flooded magazine can still detonate when hit (`hitShip` ignores immersion) — step 4 magazine protection.
- `updateFlooding` levels are transformed at room centre while the portal uses its own x/z; under large list the head between a wing strip and a centre room can be wrong by roll × offset — step 5 with free-surface/stability.
- Open stem/stern of the Bismarck plate model (pre-existing) — with M2.
- Sinking is still the HP fallback in every stock scenario — step 5.

## Scenario table (probe4.ts)
| Scenario | Water | Cause / time | Notes |
|---|---|---|---|
| Bismarck main @ waterline, 850 m, 10 min | 0.0 m³ | structural-fallback 201 s | 0 damaged boundaries |
| Bismarck main @ waterline, 5 km, 15 min | 0.0 m³ | structural-fallback 186 s | |
| Baltimore main @ steering, 5 km, 15 min | 51 m³ | structural-fallback 177 s | stern + 3 strips wet, list 0.38° |
| Yamato main @ waterline, 5 km | 445 m³ | structural-fallback 126 s | region maps hull hits straight into the forward secondary magazine space where no strip fits |
| Synthetic through-shot y = −2, pumps off, 10 min | Bis 442 / Yam 83 / Balt 315 / Ent 314 m³ | — | Bismarck: two boilers flooded, power 0.67; Yamato: strips only |
| 5v5 fleet, 60 s | 0 m³ on all 10 ships | — | 1.00 ms/tick vs 0.90 at step 1 |
