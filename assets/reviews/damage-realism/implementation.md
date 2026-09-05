# Damage realism implementation — 2026-09-05

This supersedes the roadmap's implementation status, while preserving its original review evidence. Codex owns implementation; Claude Fable reviews each milestone through Orca run `run_b120611182e2`.

## Integrated baseline

Pinned commit: `45392d0ed5faa622add1c239b938ef110c90b1de`. Existing fleet actors and bots are retained.

| Preset | Definition hash at baseline |
| --- | --- |
| Bismarck | `6884ac0c339ca9e88662880a7886c66fa5bcc64c47d7f8b8bdf70c8a9b1c0039` |
| Yamato | `d65cc64623f2b39c9650b6f9b70efab060c4c26c9d25173e8bbe8d842021774d` |
| Baltimore | `34a57ea9f679db7f195a25977437119f88e6bb1a5c7e98671d347b7d079bc522` |
| Enterprise | `7464c938c085c91cd728ec79b053711de01e3cfee3549fc9e91175fec1b80472` |

## Step 1 — hit accounting and explanations (Fable accepted)

- Hull interior queries use the authored section loft, or the breadth/deck/keel envelope for station-only definitions. The latter remains a coarse approximation, including Yamato's interpreted forebody.
- Separate openings retain local positions and areas. Dense repeated hits merge into spatial clusters, capped at 64 per compartment; overflow uses the nearest cluster with height weighted strongly. Clusters preserve total area and an area-weighted position, so saturated spaces approximate the exact distribution. Inflow uses each opening's submersion and the compartment's water surface. The wetted aperture calculation is a uniform strip approximation, not a circular-orifice solver. The existing 4 m² area cap remains.
- A bounded history records shell IDs, hit targets, thickness, material, obliquity, resistance, remaining penetration, damage, breach assignment and terminal outcomes. Recent target hits can be expanded in Gunnery.
- Losses retain the current rules and record `structural-fallback`, `flooding`, or a magazine-triggered structural loss. This is cause attribution, not a new defeat model.
- Nearest-room assignment and the simplified list/trim model remain pending steps 2 and 5 respectively.

Initial validation: **129 tests passed**, production build and all four `ship:check` passes. The interior sea-crossing regression failed before the fix. Focused tests cover separate high/low openings, actual breach locations under list, above/below water inflow, protected armor paths, ordered evidence and stable defeat attribution.

Fable accepted the initial patch, then verified the fixes with **no blockers**: review task `task_6c4d4c2ff9f2` / dispatch `ctx_de6a56a04892`; re-review task `task_1738eb272afb` / dispatch `ctx_608d17b5d7e2`. [Initial findings](fable-step1-review.md), [fix verification](fable-step1-rereview.md). Final checks: **132 tests passed**, production build and all four ship checks passed. Fable's Baltimore 5-inch probe fell from 249 breach objects to 8, conserving area. Histories retain active shells plus 16 completed shells per owner (ordered by firing, not completion). Teak crossings no longer generate sparks; turret crossings have one terminal record; underwater keel exits report pass-through without a splash through the hull.

Live browser at `http://127.0.0.1:5196` loaded this checkout's WebGPU game, entered a Bismarck-versus-Bismarck battle, opened Gunnery, selected waterline aim and fired an eight-shell salvo (960 → 952 main rounds). The new history empty state rendered correctly. The background page initially repeatedly reloaded until the workspace was activated; simulation is throttled when hidden. Screenshot capture fails because the tab/window cannot retain visible focus, so a successful visual inspection of populated history is **still outstanding**, to be completed with the later consequence milestone. Earlier port 5187 results are excluded: that loopback port belonged to another worktree. No authoring definitions or visual ship geometry changed in this step.

Recorded limitation: Fable's tested waterline scenarios still produce no flooding because the openings are above the flat CPU sea and do not submerge; the old height clamp created artificial inflow. This is an honest consequence, not evidence of working flooding-driven defeats. Steps 2–5 must establish reachable underwater/internal damage and validate alternative losses before removing the structural fallback. Final-blow attribution remains distinct from contributing damage, including earlier nonfatal magazine detonations.

## Remaining milestones

2. Flood spaces, connections, immersion and propulsion dependencies.
3. Thin plate behavior, repeatable dispersion, consistent drag/aiming, impact penetration and AP bursts.
4. Damage control, fires, HE and magazine protection.
5. Hull-derived flotation/stability and disabled/sunk defeat rules across presets.

## Step 2 — complete, Fable accepted

Machinery now has explicit drive groups and immersion tolerances. Bismarck's three drive/shaft groups share a provisional boiler pool; Enterprise retains an aggregated four-shaft plant; Yamato and Baltimore retain their aggregated machinery envelopes. Dependencies and immersion tolerances are validated additive v1 data. Flooding removes availability without healing or destroying HP, and submerged magazines disable ammunition supply. Exact immersion thresholds, power shares and steam routing remain game calibration.

The original [flood-space authoring recipe](../../ships/author-flood-spaces.ts) preserves existing room IDs and authors conservative wing and end spaces inside each hull, excluding existing boxes. Final populations: Bismarck 161 rooms / 360 closed boundaries, Yamato 164 / 365, Baltimore 70 / 164, Enterprise 89 / 202. These estimated subdivisions are explicitly **not historical watertight plans**. Exterior regions map shell strikes to local spaces, splitting openings across room heights. Side coverage spans Y=max(-6,-draft+0.2) to min(3,deck-0.2). End pockets are small hull-inscribed volumes with coarse end-shell projection; they do not represent complete end capacity. Full end, upper-deck and deep-bottom coverage must be addressed before step 5 retires the fallback. Unmapped exterior hits do not silently flood a remote room.

Boundaries start closed. A shell crossing a linked armor plate or an estimated 5 mm standalone watertight partition opens a damage aperture. Connections use portal height, hydraulic head and conservative volume transfer. The authoring recipe rejects routes through a third room; exact partition locations and the 5 mm fallback are approximations. New compartments retain an estimated 72% floodable volume and a small independent pump rate until the damage-control milestone.

Ten focused machinery/layout tests pass, including an underwater through-shot that leaves boiler HP almost intact but disables availability by flooding, dry adjacent spaces, closed/open/damaged conservation, dependency validation, every new room's hull containment/non-overlap, Yamato turbine-room water reachability and bow/stern openings across all presets. A stock Baltimore 8-inch steering-aim scenario at 5 km produces measurable flooding through an opening split across rooms. This does not establish a flooding-driven defeat.

Fable requested two data fixes and then explicitly accepted step 2 with no blockers: [initial review](fable-step2-review.md), [fix verification](fable-step2-rereview.md), task `task_b85e11b5e7d0` / dispatch `ctx_1b4a869caf6f`. Extending wing spaces inward gives Yamato 118 room-to-strip boundaries, where it previously had none. The original [end-plating recipe](../../ships/bismarck/author-end-plating.ts) adds 466 estimated 20 mm end triangles; shared surface IDs prevent duplicate charges along joined chines. The original belt and end-armor IDs/thicknesses remain intact. Legacy exterior boxes now create both entry and exit openings; explicitly interior belt/deck boxes do not create sea breaches.

Validation: **142 tests passed**, production build and all four rebuilt ship checks passed. Local Blender produced the assets and fixed review views. Fable's 5v5 probe rose from 0.90 ms/tick at step 1 to 1.00 ms before end closures and 2.0–2.2 ms afterward. Add a bounds pre-test before the step-3 ballistic work. The port Armor list also needs grouping for the 466 joined end surfaces. Both findings are non-blocking and retained for the next slice.

Fable's stock Bismarck waterline scenarios remain at **0.0 m³** flooding, sinking by structural fallback at 201 s (850 m) / 186 s (5 km). All openings remain above the flat sea without dispersion; the controlled flooding acceptance fixture is explicitly a submerged high-penetration shot with pumps off. Steering-aim hits can trigger the fallback sooner (141 s in his probe) because thin end closures still take the same exterior integrity charge as a belt. This behavior will retire with the validated step-5 defeat model. No historical sink-time claim is made.

Live acceptance completed through Orca at port 5196. A development-only [replay utility](../../../scripts/tests/damage-realism-browser.ts) runs the real mounted CPU simulation, inspection renderer and React telemetry callback. Its controlled 600 s pumps-off through-shot gives **441.9 m³**, **66.55% propulsion**, two flooded forward boilers still at 139/140 HP, and a populated 15-entry shell history. [Recorded state](browser/flooding-replay.json), [HUD text](browser/flooding-hud.json), [inspection canvas](browser/flooding-inspection.png). The camera was snapped to the target and one frozen frame refreshed the ocean before capture. Full-window screenshots remain unavailable on the hidden desktop; the canvas was captured directly, and rendered DOM content/layout was checked separately. The existing dense X-ray outlines obscure some detail; reduce dry-space clutter in the next UI slice.

The expanded HUD fit at 1137×906 (290×763 panel) and 390×844 (366×702 panel), with no horizontal document/panel overflow, scrollable content, 15 impact rows and both offline labels. All five fixed review views were inspected for each preset. In-game joint limits/recoil agreed with CPU muzzles: Bismarck ≤2.17 mm, Yamato ≤2.75 mm, Baltimore ≤1.32 mm, Enterprise ≤0.033 mm. Articulation canvas captures are in `browser/`. This completes the populated-history check left outstanding in step 1.

| Preset | Step-2 definition hash |
| --- | --- |
| Bismarck | `26da869b9a40a31e59fba9c4abbe7f2d235bc3b3a3b81202094aa9066fc4917b` |
| Yamato | `4492aa7150c51fd433345ad66d50267393cd3424ab2672cdd1489039e41d3104` |
| Baltimore | `89ea6e7c084dfcfeb416157d98abdc4c8f343251c7777565168140c8b9ddaf78` |
| Enterprise | `2a0001f3871bb338fdaae8103e458f03f7a23624ceaf79a6ee43842f5be32c1a` |

## Step 3a — complete, Fable accepted

Thin-plate response now varies the grazing deflection threshold with thickness/caliber ratio. It is a calibrated game approximation; thin plates still consume an oblique penetration budget, and heavy protection remains effective. A shared response function serves combat and caliber-aware probes. A conservative bounds pre-test avoids full polygon work for irrelevant plates; mount transforms and compiler bounds tolerance are retained. Per-hit train values are sampled once.

The port inspector groups 466 joined end surfaces under one expandable entry, retaining individual selection. Combat inspection draws wet compartments and equipment; the complete dry layout remains available in port. Live checks verified the collapsed group, selection of armor:end-closure-0, no horizontal overflow, and a controlled flooding replay with eight visible wet rooms out of 161. The updated [inspection canvas](browser/step3a-flooding-inspection.png) was captured after a frozen frame and GPU completion.

Fable accepted with no blockers ([review](fable-step3a-review.md), task task_7def53d4fb98 / dispatch ctx_72ceee6160ed). His 2.23 million random segment/plate comparisons, including articulated plates, found no differences from direct polygon intersection. Fleet cost fell from 2.0–2.2 ms/tick to 1.27–1.34 on his loaded host; the coordinator measured 0.85–0.95. Stock Bismarck outcomes remained unchanged. Final validation: **144 tests passed**, all four ship checks and production build passed; comparison evidence was regenerated because the pipeline hashes protection and geometry source. The 90-second functional fleet test now has a 20-second host timeout after isolated runs passed at 2.7 seconds but loaded full runs crossed five seconds; this is separate from the recorded performance probes.

Next-slice decisions: calibrate grazing thin-plate resistance alongside velocity effects; identify the shell caliber explicitly in reference probes; clarify surface versus group counts. The reviewer’s examples are calibration prompts, not historical penetration evidence. Drag, dispersion, velocity/material effects and fuzes remain pending.
