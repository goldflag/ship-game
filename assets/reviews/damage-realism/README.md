# Agreed damage realism roadmap — 2026-09-05

Codex and Claude Fable reviewed the game and agreed on the sequence below after an independent review and a second discussion round. This is a development plan, not an implemented feature or historical accuracy approval.

## Review scope and evidence

- Tested checkout: `94e0facaf44b1762bd7c40cd426a5e1cf1e9ac27` in `basslet`.
- Codex installed the locked dependencies, then ran the full configured test scope: **101 passed, 0 failed**. `bun run build` passed all four ship asset checks, TypeScript, and the production bundle. Fable separately ran the simulation/blueprint subset: **47 passed**.
- Local master advanced during the review. The reviewed master changes include configurable bot fleet battles (`50d9106`) and ship labels; master was `35ad307` at the final source comparison. Implementation should start from the current integrated master and record its exact commit and definition hashes. Do not recreate the old trial's missing target AI.
- The core damage implementation, protection tracing, gun catalog, and Bismarck blueprint were unchanged between the tested checkout and the master revisions inspected. The damage findings therefore remain relevant to the newer battle loop. The 101-test/build result applies to the tested checkout, not an independently tested master snapshot.
- Fable attempted a dedicated browser review at port 5179. The port loaded, but entering the trial repeatedly showed preparation at 72–82%; a screenshot also failed. The temporary server and review tab were closed. Combat feedback findings are based on source and CPU probes; a successful live combat playtest is still required for implementation acceptance.

The existing [pipeline contract](../../../docs/ship-pipeline.md) remains authoritative: versioned blueprints and original component recipes, stable IDs, shared inspection geometry, and renderer-free CPU simulation.

## Findings that determined the order

1. **Damage can remove propulsion incorrectly.** In compiled Bismarck, setting all three turbine modules to zero HP leaves `systemHealth('engine')` at 0.75, because boilers, turbines, and shafts are averaged. The handling calculation consequently still permits approximately 86.6% of its healthy maximum speed. See [system health](../../../src/simulation/damage.ts) and [handling](../../../src/simulation/ship.ts).
2. **Flooded machinery remains available.** Filling `turbine-port` to its authored 771.12 m³ capacity leaves the turbine at 140 HP and propulsion availability at 1. Floodwater currently changes flotation without changing equipment availability.
3. **Armor bounds are incorrectly used as the hull interior.** The sea-contact test in [combat](../../../src/simulation/combat.ts) uses the union of armor bounding boxes. Bismarck points `[0, 0, -21]`, `[0, -0.1, -21]`, and `[0, -1, -21]` are inside the hull but fail this test. A shell can therefore be treated as splashing when it crosses sea level inside the ship. Use a hull-envelope query derived from the blueprint, independent of armor surfaces.
4. **The default trial hides most damage mechanics.** Fable's CPU probe, repeatedly firing the main battery at the default waterline target, reached sinking at approximately 201 seconds with zero floodwater and no internal module destruction. Belt penetrations followed by turtleback stops still reduced the universal integrity counter. This is one observed scenario, not a claim about every engagement angle or range.
5. **Flooding geometry needs authoring work.** Breaches are assigned to the nearest compartment center and aggregated into one area/height; Bismarck has no inter-compartment connections. Fable sampled exterior plate vertices below 3 m and found nearest compartments totaling approximately 2,667 m³, against a 10,000 m³ reserve-buoyancy setting. That sample is a warning about coverage, not an exhaustive upper bound on reachable flooding.

## Agreed sequence

| Step | Deliverable | Scope and dependency | Main risk |
| --- | --- | --- | --- |
| 0 | Pin the integrated battle baseline | Use master's existing fleet actors and bots; retain reproducible scenarios and record ship hashes. | Changes elsewhere in the game can invalidate an unpinned review. |
| 1 | Correct hit/flood accounting and explain outcomes | Fix hull-versus-sea contact and breach position/height semantics. Record a structured per-shell history and explicit defeat cause. Preserve current defeat behavior initially. | Boundary cases across physical plates and older box-armor presets. |
| 2 | Make flooding cause a believable loss of capability | Author hull-adjacent flood spaces, explicit open/closed/damaged connections, equipment immersion behavior, and minimal boiler/turbine/shaft groups. Show the cause of lost capability in the existing inspection and instruments. Bismarck first; preserve other presets, then migrate them. | Compartment coverage, historical uncertainty, and authoring cost across the fleet. |
| 3 | Improve gunfire across engagement distances | Address thin-plate ricochets first within this step; add reproducible dispersion, drag shared by aiming and flight, impact-velocity/material-aware penetration, AP fuze arming/delay, turret/interior continuation, and bounded blast/fragment effects blocked by intervening protection. Deliver these as separate changes. | Aiming/flight consistency, calibration, and fleet simulation cost. |
| 4 | Add damage control and useful ammunition choices | Fires and HE, pump/isolation/repair priorities, magazine ignition/protection, and limited restoration. Start with simple teams or timers. | Making recovery decisions understandable and avoiding unsupported historical detail. |
| 5 | Derive stability and refine defeat conditions | Derive flotation/list/trim from hull and loading data, assess capsizing, and distinguish afloat-but-disabled from sunk. Replace universal HP sinking only after the alternatives work across supported presets. | Physical calibration and preventing ships from becoming impossible to defeat. |

Steps 2–5 are milestones, not promises of one small patch each. Effort for migrating the other ship layouts cannot be established until Bismarck's authoring pattern is tested.

## First bounded patch

Implement only the first part of step 1:

1. Add reproducible regression scenarios for sea contact outside a hull, sea-level crossing inside a hull, and breaches wholly above or below the waterline.
2. Correct the hull-interior query and preserve actual local breach positions/heights for submersion calculations. Detailed compartment remapping and new flood-space authoring belong to step 2.
3. Add structured per-shell diagnostics: shell/ship/plate IDs, thickness and material, impact angle, resistance, remaining penetration, damage or breach assignment, and the stopping outcome. Record defeat attribution, including the temporary structural fallback, flooding, and magazine-triggered losses.

The first patch does not change defeat rules, add random dispersion or an overmatch formula, redesign the HUD, or introduce a general machinery/electrical network. The scenario harness is a test utility. A later step-1 change can expose the recorded explanations in the existing gunnery controls.

First-patch acceptance: an external water impact splashes; an interior sea-level crossing continues to be resolved against the ship; a fully above-water opening admits no seawater until submerged; below-water inflow uses the opening's actual position; the outcome is inspectable through structured diagnostics. Existing protected-hit behavior must remain covered.

## Acceptance for the first complete consequence milestone

- A healthy propulsion group produces power; a failed turbine or shaft disables its connected capacity. Losing all turbines produces zero propulsion.
- Flooding a machinery space changes equipment availability. Pumping water out never restores HP to already-destroyed equipment.
- Fully above-water breaches remain dry until submerged. Shells crossing sea level inside the hull are distinguished from shells entering open sea.
- Inter-compartment transfer conserves water when external leaks and pumps are disabled, and closed boundaries prevent transfer.
- A controlled reachable internal hit has an inspectable effect; a shot correctly stopped by protection remains stopped. Keep the existing protected engine-port fixture and add a complementary reachable-module scenario.
- Every loss records its cause. Evaluate sinking against the ship's stated physical/calibrated data; do not force an arbitrary duel duration, list angle, or water-volume threshold to make a demonstration pass.
- Other presets remain compatible and are explicitly marked provisional until migrated. Changes remain in the shared versioned format, not ship-name branches.
- Relevant simulation tests and the production build pass. Definition/model changes follow required ship build/check/review and in-game inspection procedures. A live browser acceptance pass demonstrates the visible consequences.

## Decisions resolved in discussion

- **Keep the current sinking fallback temporarily.** Removing it before validating flooding and structural alternatives could make some battles impossible to finish. Measure and label its role now; retire it with a tested replacement.
- **Do not charge structural damage only after the last armor plate.** A shell stopped by an inner plate can still damage an outboard space. First record what actually happened; calibrate local damage against that evidence.
- **Keep meaningful armor-protection tests.** An engine surviving a legitimately stopped shot is expected behavior, not a defective test. Add the missing penetrating-hit counterpart.
- **Include bounded burst consequences with fuzes.** Detailed spall and fragment metallurgy can wait; an armed AP burst needs an actual damage consequence.
- **Treat thin-plate rules as calibrated approximations.** A proposed caliber/thickness cutoff is not a universal historical law.
- **Preserve validation history.** Add dated superseding evidence for old observations rather than rewriting prior reports as if they described the current model.
- **Use scenario evidence honestly.** The vertex-sampling capacity estimate and tested penetration paths do not prove every possible flooding or armor outcome. Unsourced historical hit counts and universal ricochet claims from the initial review were withdrawn.

Full electrical distribution, individual crew simulation, detailed hydrostatics beyond the selected stability milestone, hull fracture, networking, and the player ship editor remain outside the immediate work. The current lack of dispersion and temporary HP-based battle pacing should remain explicit in validation notes until their respective steps are complete.

## Agreement record

Orca run: `run_3b3c8ccd059f`.

- Independent Fable review: task `task_ec8d9c2c0f0f`, completed dispatch `ctx_68877c41d74b`.
- Discussion and explicit agreement: task `task_77f95e5f94eb`, completed dispatch `ctx_7854b34d03d2`.
- Fable accepted the sequence and first bounded patch, requested explicit defeat-cause attribution from the start, and suggested prioritizing thin-plate behavior within step 3. Codex accepts those amendments. No unresolved disagreement blocks this plan.

Only this review record was added to the repository; no gameplay implementation was changed during the review.
