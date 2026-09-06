# Step 1 re-review — fixes to Fable findings (basslet, base 45392d0)

Scope: only the changes since dispatch ctx_de6a56a04892. Read-only. Evidence: diff of `combat.ts`/`damage.ts`/`GunneryPanel.tsx`, the three new regressions in `damage-realism.test.ts`, `/tmp/basslet-step1-tests.log` (132 pass, 0 fail), `/tmp/basslet-step1-build.log` (green), and re-run of `scratchpad/probe2.ts` with an added 2-minute mixed-fleet scenario.

## Verdict: no blockers. All six findings are fixed as described.

| Finding | Fix verified | Evidence |
|---|---|---|
| M1 unbounded breach objects | `addBreach` merges within 0.1 m (height ×4 weighted) or into the nearest cluster once a space holds 64; area conserved; radius = max original opening | Baltimore 5-inch scenario: 249 → **8** objects; 1000-hit regression ≤ 64 and area 0.4 m² exact; fleet scenario max 32 per compartment, `sum(breach.area) == breachAreaM2` in every compartment; a cluster of small high holes still admits 0 m³ |
| M2 shared 64-shell ring | Per-owner: all in-flight plus 16 completed per owner; pruned each tick | Regression: 100 enemy shells cannot evict an in-flight player history; fleet scenario max 100 entries with 4 owners; Enterprise secondaries 66 in flight + 16 completed |
| L1 teak effect-bearing event | Backing records carry no normal → `CombatEffects.impact` not triggered; audio already deduped per shell | Fleet scenario: 8 backing records, 0 with a normal; regression asserts `normal` undefined |
| L2 pass-through labelled splash, keel-exit splash under hull | `passed-through` outcome when a shell with impacts leaves; splash suppressed when the surface point is inside a hull | Vertical 38 cm shell: 3 decks → boiler → exit, history `passed-through`, **no splash event**; side exits outside the hull still splash (steering scenario: 8 passed-through, 48 splashes) |
| L3 duplicate mounted-plate rows | Single terminal `penetration` row with combined message | Diff: one `report` call in the mountId branch; audio skips `module`, so the impact sound still plays |
| L5 docs | `implementation.md` records pinned commit and four definition hashes, dated evidence, limitations; ImpactRecord position documented as ship-local | File read |

Existing behaviour unchanged where expected: default trial still sinks at 201 s by `structural-fallback` with 0 m³ water (step-2 territory, already recorded); protected engine-port path still stops at the turtleback.

## Residual notes (non-blocking, no action required for step 1)
- `pruneHistory` keeps the 16 most recently *fired* completed shells per owner (insertion order), not the 16 most recently completed. Immaterial for the panel.
- `history()` resolves owner by scanning `this.shells` for non-shot events; O(≤256) per event, fine.
- Cluster merging moves the centroid by area weighting; the ×4 height weight keeps waterline behaviour, but a saturated space will eventually blend hits from different stations. Acceptable until step 2 replaces nearest-room assignment.
- L4 (non-fatal detonation then fallback exhaustion reads `structural-fallback`) was not in the fix list and remains a product choice; fine as "fallback is honest".
- Live browser acceptance is still pending on the coordinator's side; nothing in these fixes touches rendering except removing the teak spark burst.
