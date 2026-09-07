# Damageable equipment rollout

Baseline: `cb01ec2dc1799e1f2f314c1b3925d36ccc45410a`, 7 September 2026. Exact compiled and model hashes are in [validation.json](validation.json). This record covers the implementation of the reduced scope following Claude Fable's plan review.

## Implemented

- Explicit, repeatable local-damage authoring preserves authored directors/generators and unrelated ship files. Equipment registration preserves existing structural budgets and room fire calibration.
- Fixed exposed directors have protection, direct/burst hits, CPU sea immersion, finite repairs, reset, inspection and explicit gun coverage. Room containment remains required for legacy internal equipment. Surface fire and automatic AA use the same coverage and power inputs, with the existing 1.5 mrad local-control fallback.
- KGV, Bismarck, Yamato, Baltimore, Enterprise and Fletcher replace internal director proxies with boxes covering their original recipe's fixed central housings. Dimensions, protection, HP and coverage are game estimates. Other presets retain an explicitly covered internal proxy pending a fitting audit.
- Fletcher's rotating torpedo banks and depth-charge racks/throwers, and Type VIIC's fixed tubes, have launcher damage owners. Collision, bursts, inspection and lodged shells follow the bank's CPU yaw. Readiness and both usable/recoverable capability checks use launcher condition; magazines and ammunition remain separate.
- The original octuple component supports two rows of four barrels with stable IDs, a common elevation axis and independent recoil. CPU/exported muzzle agreement, eight-round AA firing, finite stock, destroyed-mount freeze, neighboring fire, director loss and power fallback are tested.

## Explicitly gated or deferred

**KGV pom-poms remain decorative in the live preset.** [The equipment review](../../ships/king-george-v/reports/equipment-review.md) records the KGV-007 source gate and the failed/unresolved visual checks. The experimental definition and GLB in [octuple-prototype](octuple-prototype/) are outside the runtime roster. Uniform-length mechanism details and high-elevation boom/rigging interference prevent promotion. Existing KGV priority shape discrepancies are also unresolved.

Flower's visually different depth-charge arrangement was not assigned Fletcher's box dimensions. Other decorative fittings require individual evidence audits. Pumps, command stations, carrier-service splits, batteries/ballast equipment, radar/radio, fuel, exhaust and extra ammunition-feed modules remain outside this rollout. Magazine-based reload degradation was not added as a side effect.

## Validation

Local Blender **5.2.0 LTS** ran the normal build/export/check pipeline. Every stale ship was rebuilt after the shared compiler/recipe changes. `bun run build` passes ship and aircraft asset checks, TypeScript and Vite; the existing large-chunk advisory remains. The Bismarck baseline was untouched.

Using the package-pinned **Bun 1.3.3**, the isolated test runner reports **821 passed, 23 failed across 118 files**. All **479 simulation tests** and **32 ship tests** pass. The same 23 failing test names reproduce from an untouched source snapshot of the starting commit: `GameFrame.test.ts` has an outdated lighting fixture, and `AirOperations.test.tsx` fails its camera/water-coordinate test. Full results are retained in [tests.txt](tests.txt), [baseline-failures.txt](baseline-failures.txt) and [build.txt](build.txt). The machine's default Bun 1.2.18 also lacks the decompression behavior expected by the existing model-loading tests; it was not used for the final suite.

[balance.jsonl](balance.jsonl) compares old/new definitions in the same runtime with seed 93. Healthy AA shot counts match for all six migrated ships. Unserved light guns retain local control and show the expected accuracy reduction; these stationary-target samples do not certify overall aircraft balance. Gun-loop median/p95 timings stayed within the declared 25% investigation threshold. Normal 5 km turret-aim duels match the baseline duration, ammunition use and hull-failure outcome for Bismarck (381.37 s/152 shots), Baltimore (241.38 s/96 shots) and Yamato (281.38 s/112 shots). No hull HP tuning was used. The probe caught and led to removal of unintended legacy gun-region additions; a regression test now preserves those omissions.

KGV's five standard fixed views are regenerated under its `generated/review/` directory. Prototype fixed views and 0/40/80-degree mechanism closeups are retained under `octuple-prototype/views/`; `render-prototype.py` is the durable closeup recipe. Automated exported-joint checks cover intermediate traverse/elevation/recoil and heel/trim, but do not certify collision clearance or historical form.

Browser review remains incomplete: Orca's page repeatedly restarted during harbor loading and an awaited command ended with `target closed while handling command`. The loaded KGV diagnostic did identify the current hash and a maximum muzzle discrepancy of 0.001736 m, but that is not a passed visual review. Equipment/Flooding separation, narrow-screen layout, live damage/recovery, launch/return/reset and in-game launcher articulation still need a stable browser session. Keep the PR draft until those checks are recorded.
