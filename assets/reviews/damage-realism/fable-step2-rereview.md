# Step 2 re-review — fixes to M1/M2 and records (basslet, base 92cb1c9 + working tree)

Reviewer: Claude Fable, read-only. Scope: `author-flood-spaces.ts` (strip extension + end pockets), `bismarck/author-end-plating.ts` (466 estimated 20 mm end triangles, `surfaceId: 'end-shell'`), `surfaceId` seam handling in `protection.ts`/`damage.ts`, bow/stern faces in `exteriorBreaches`, the four regenerated blueprints (summarized by script), updated discrepancy/implementation records, the two new regressions. Logs: 142 tests pass; all four `ship:build` logs report `passed` (Yamato finished during this review). Probes: `scratchpad/probe5.ts`.

## Verdict: **accepted for step 2.** M1 and M2 are fixed as described; no blocker remains. Two non-blocking findings (perf, Armor-list UX) and the agreed coarse-coverage items carry to step 5.

## Fix verification

| Item | Verified | Evidence |
|---|---|---|
| M1 Yamato interior reachable | Yes | Strips now extend to the nearest retained room edge (Yamato strip width 2.0–14.6 m; 118 room↔strip boundaries, was 0). Through-shot at y = −2: `engine-port-space` 151 m³, `engine-starboard-space` 151 m³ (was 0; regression added). Bismarck through-shot unchanged (442 m³, two boilers flooded, power 0.67). No room is unconnected on any preset; every end pocket has a boundary. |
| M2 end-on hits breach | Yes | Bow-on and stern shots at y = −1 create a local opening on all four presets (Bismarck 0.144 m² into `flood-end-bow-3`; Baltimore 0.041 m² into `flood-end-bow-3`, previously `→[]`). y = +1.5 splits across two pockets. Bismarck no longer admits a bow-on shell without a hull hit. |
| Centreline seam charged once | Yes | Exact stem line at y = −4…+2.5: one end-closure hit, structural 14 (one exterior charge), 0.144 m². `protectionTrace` reports a single `end-closure-406 (edge)`. Oblique 30° bow shot: two distinct crossings (entry port, exit starboard) → two charges, which is correct. |
| Existing belt/bow/stern IDs untouched | Yes | Armor 277 → 743 with 466 `end-closure-*` additions; original names/thicknesses unchanged. |
| L2 basis strings / counts | Yes | Per-preset basis text; discrepancy entries carry rooms/regions/boundaries/linked counts (Bismarck 4 linked, others 0). |
| C1 stock outcomes preserved | Yes | Bismarck at 850 m and 5 km: 0.0 m³, structural-fallback 201/186 s, unchanged. |

## Findings

### P1 · Per-tick cost doubled with the end triangles — medium (performance, not a blocker)
5v5 mixed fleet, 60 s at 5 km: **2.0–2.2 ms/tick** now vs 1.00 ms before the closures and 0.90 ms at 92cb1c9. `hitShip` on a Bismarck broadside segment costs ~270 µs because every call runs the full polygon test on all 743 plates plus 360 boundary boxes. Still inside the 16.7 ms budget, but step 3 (dispersion → more near-hull segments) and closures for other presets will multiply it. Cheap fix: pre-test each plate with `segmentBox(from, to, a)` against the bounding box the compiler already validates (`center/size`) before `plateHit`, or bucket plates by station. Sight picking uses the same trace per frame and benefits equally.

### U1 · 466 identical "End closure · estimated" rows in the port Armor list — low/medium (UX)
`inspectionEntries('armor')` now returns 927 rows for Bismarck, 466 of them the same name; hover/select on tiny triangles is impractical and the list is unusable without filtering. Group by `surfaceId` into one "End closure (estimated, 466 surfaces)" entry, or hide surfaces flagged estimated behind a toggle. Same idea as the strip rows noted last time.

### N1 · Fallback interaction with 20 mm closures — low (informational, retires in step 5)
Every 20 mm closure penetration charges the same 14 integrity as a 320 mm belt. Steering-aim at 850 m now sinks in 141 s (was 201 s) because stern shells hit closure triangles before the stern plating. Expected under "fallback is honest", but worth a line in the record so a faster stern kill is not read as a regression.

### Coarse-coverage items confirmed as documented, step-5 prerequisites (not blockers)
- End pockets are tiny (Bismarck 12 pockets, 87 m³ total; Yamato 97 m³). A bow-on underwater shot floods 8.5 m³ then stops because the pocket→next-space gap exceeds the 2 m partition rule (Baltimore reaches 185 m³ only because a legacy `bow` room exists). Consistent with "coarse projection to nearby pockets; does not claim all end volume".
- Upper-deck and midship-bottom closure, deep-bottom and upper coverage remain open.
- Strips are now very large where no rooms exist (Bismarck up to 11.5 m wide, Yamato 14.6 m; strip capacity Bismarck 9 560 m³, Yamato 18 620 m³ > its 14 500 m³ reserve). Fine as provisional volumes, but free-surface/stability effects of such wide undivided spaces belong to step 5.

## Residual notes
- Side and end regions overlap for z within 35 m of each end; `exteriorBreaches` takes the first containing region (side first), so an angled bow-shell hit with |normal.x| > 0.5 maps to the side strip rather than the pocket. Both are local; acceptable.
- Blueprint sizes: Bismarck 743 armor entries, 161 rooms, 360 boundaries; the review-ZIP/PNG churn noted last time recurs with each regeneration.
- Live browser acceptance remains pending on the coordinator's side, to be run as a scripted CPU replay per the record.
