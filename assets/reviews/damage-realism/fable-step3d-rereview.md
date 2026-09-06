# Step 3d re-review — P1 burst-work fix (basslet, base 51892e9 + working tree)

Reviewer: Claude Fable, read-only. Scope: `damage.nearbyContacts` / `ContactCandidates`, the optional `candidates` filter in `shipContacts`, `burst.ts` target culling and per-ray candidate reuse, the 320-ray filtered-vs-full regression, coordinator evidence (`/tmp/basslet-bursts-before.json` vs `after.json`, `step3d-burst-cost.json`, `step3d-final-perf.log`). Logs: `/tmp/basslet-step3d-final-tests.log` 167 pass / 0 fail; `final-build.log` built. Probes: `scratchpad/probe17.ts`, `probe18.ts`. Note: a Blender `ship:review` from another worktree (sixgill) and three Vite servers were running on this host during my timings.

## Verdict: **P1 resolved. Step 3d ACCEPTED** (CPU implementation; asset/browser acceptance remains yours per the step3d-* evidence).

## Verified
- **Filter is conservative and exact.** `nearbyContacts` keeps every plate, module, closed/damaged boundary and legacy mount whose bounding box lies within `radius + 1e-5` of the burst origin (mount-local origins for mounted plates and gunhouse boxes, rotation preserving distance); any ray to a target inside the sphere is contained in that ball, so nothing intersectable can be excluded. Randomized check across the four presets with random pose, roll, pitch, trains and boundary states: **6 000 rays, 1 241 with contacts, 0 mismatches** between filtered and unfiltered `shipContacts`; mean candidate set 2.6 % of plates+boundaries. Your 200-burst before/after snapshots are byte-identical (`cmp`), and the 320-ray regression is in the suite.
- **Semantics unchanged otherwise**: still 128 rays max, same distance/exposure formulas, same `checkMagazine` sharing; targets are culled by distance before sorting and distances cached. Rays now also pay intervening layers of *other* nearby ships (cross-ship shielding), which is an improvement over the single-actor shielding I reviewed and cannot reduce protection.
- **Cost**: burst excluding construction, 50 warm-up + 200 samples — boiler room 92 µs (p99 715), port wing 172 µs (p99 560), turret 62 µs, outside 43 µs; previously 2 200 / 3 900 / 875 / 620 µs. ≈ 20× reduction, matching your `step3d-burst-cost.json`.
- **Tick spikes no longer burst-driven**: 5v5 mixed fleet 60 s, per-tick attribution — ticks with bursts (138): mean 2.25 ms, max 5.3 ms; ticks without bursts: mean 1.59 ms, max 9.6 ms (tick 0 warm-up) with 23 of the 27 ticks over 4 ms carrying zero bursts and zero events, i.e. host/GC jitter under the concurrent Blender job. Mean 1.48–1.63 ms/tick against 1.2–1.4 before 3d.
- Tests 167/167, production build green.

## Nits (no action needed for 3d)
- The `shields` array is rebuilt per burst even when a single actor is near; fine at current cost.
- The remaining >4 ms ticks are environmental here; if they persist on a quiet host, the next candidates are event-array churn and `pruneHistory`, not bursts.
- All earlier 3d nits stand as documented in `implementation.md` (no underwater bursts, turret bursts not reaching magazines until step 4, silent 'expired' at the 64-iteration cap, burst-against-armour wording).
