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

## Step 3b — complete, Fable accepted

Shared linear drag now drives flight, player aiming and per-gun bot lead, including drag on inherited ship velocity. Catalog coefficients are provisional reference-speed estimates, with their formula and limitations stored alongside each gun. This is a constant-drag point-mass approximation, not a Mach-dependent historical firing table. Per-shot seeded angular dispersion uses a bounded Gaussian radius; battles choose and expose an unsigned 32-bit seed, while CPU construction accepts a specific seed and reset repeats its physical pattern. Omitted optional v1 calibration fields retain vacuum/no-spread compatibility. The existing 30 km targeting guard remains a gameplay limit.

An underwater shell already outside a hull cannot re-enter submerged equipment on its next segment. Stock Baltimore 5 km stern-aim fire still causes flooding. Exact room-boundary split coverage is now a controlled conservation test, because a dispersed salvo should not be required to hit that exact seam. Reference probes explicitly identify their caliber and explain that they measure geometric resistance without velocity or fuze outcomes. The Armor heading counts surfaces.

Fable accepted with no blockers ([review](fable-step3b-review.md), task `task_262725872c08` / dispatch `ctx_ceb37965de0d`). He verified analytic target agreement, moving-shooter aim, frame-rate determinism, seed differences and reset physics. His stock Bismarck seed-11 scenarios now flood at 5 km (3 m³), 15 km (21 m³ plus module losses) and 22 km (928 m³ / 6.7° list); all still lose through the temporary fallback. These are game scenario outcomes, not historical calibration.

Validation: **150 tests passed**, then the additional schema/compatibility test passed in the focused five-test ballistic suite (**151 covered tests**). Typecheck, production build and all four local Blender ship builds/checks passed. All 20 regenerated fixed review images are pixel-identical to the previously inspected images. Live articulation remains within 2.75 mm. A mounted-browser replay using the normal Game.fire() entry point launched eight rounds, recorded distinct copied launch/first-tick states (820 → 819.75 m/s on the first round), and populated five target-hit histories. [Recorded replay](browser/step3b-firing.json), [canvas](browser/step3b-firing.png), [articulation](browser/step3b-articulation.json), [fixed-view comparison](browser/step3b-fixed-view-comparison.json). The browser replay advances CPU ticks explicitly; it is not a frame-rate benchmark.

Fleet cost was 1.69–1.70 ms/tick here and 1.98–2.07 on Fable's loaded host, up from 3a. Before adding burst work, reduce repeated solves using per-mount cached flight times and skip aiming for out-of-range bot guns. Preserve per-caliber and per-muzzle lead; one shared lead point for an entire ship would compromise that. Add muzzle-speed dispersion with the velocity slice. Shell/event IDs intentionally remain monotonic across resets for renderer event consumption; compare physical state separately for replay. A browser seed override is a useful later diagnostic convenience; the CPU constructor already accepts a seed. Grazing-resistance/material calibration and AP fuzes/bursts remain pending.

| Preset | Step-3b definition hash |
| --- | --- |
| bismarck | `0af135349f720b7987f9d3a98372d69add111d4e801204ce367e056d7bfacc6e` |
| yamato | `4f1595f8929bf82e7e60bfd60eea54c78d1f1ba31293274fb7d6ac362fdda78b` |
| baltimore | `685fc33dc77b69981f713161b24ecce69ae386102615d9ec14036d344c942d1a` |
| enterprise-cv6 | `5c71a931dae3ac15fc7b4e90c457e7ab683bf2f6578cbe792a7aa2c128da90cc` |

## Step 3c — complete, Fable accepted after calibration fix

Penetration now follows impact speed through a calibrated exponent of 1.4. KC, Wh, Ww and generic steel have explicit relative resistance factors (1.1, 1, 0.9 and 1); thin-sheet grazing resistance caps at ten times thickness before the material factor. The impact history displays speed. Independent seeded muzzle-speed variation adds range spread (estimated sigma 0.3% naval / 0.5% small AA, capped at three sigma). These are game approximations, not historical penetration/dispersion data. Armor still consumes budget without slowing flight; consistent deceleration is required in 3d before fuze distance is evaluated.

Per-mount caches retain the previous desired muzzle and flight time as an initial guess. Continuous tracking takes one iteration; acquisition and jumps take three. Current heading/velocity are recomputed every tick. Bot lead stays separate by gun and muzzle; out-of-range/empty/disabled guns stop solving and hold train. Tests and Fable's turn, moving-target and jump probes preserve sub-meter aim accuracy. Fleet cost fell from approximately 1.7–2.0 ms/tick in 3b to 1.35–1.58 in Fable's runs (1.42–1.45 here); host load varies.

Fable initially accepted the implementation but requested an explicit penetration reference ([review](fable-step3c-review.md)). The new [original recipe](../../parts/calibrate-penetration.ts) anchors the legacy penetration budgets to nominal impact speed at 5 km for naval guns or 1 km for small AA, from a 10 m launch height to sea level. Optional validated `penetrationReferenceSpeedMps` falls back to muzzle speed when absent. Bismarck's retained 550 mm at 731.151256 m/s corresponds to 645.79 mm at nominal muzzle speed. The catalog records the reference and its limits; residual budget follows any speed recovery on descent. Fable reproduced every reference with independent 600 Hz integration, confirmed the protected engine fixture and accepted the fix ([re-review](fable-step3c-rereview.md), task `task_14fccf64c04b` / dispatch `ctx_ccfad7bca5f9`).

A 22 km Bismarck-versus-Bismarck fixed-position AP duel remains in a calibrated immunity band. We accepted that result rather than raising penetration to recreate 3b's range-independent damage. The 15 km probe now produces flooding/module effects. These are scenario observations, not historical immunity-zone claims. Real bots maneuver and close; HE and other damage consequences remain in later milestones.

Final validation: **156 tests passed**, production build and all four local Blender builds/checks passed. Twenty regenerated fixed views remain pixel-identical to the previously inspected geometry; live articulation error is at most 2.746 mm. Final browser seed 4158702779 launched eight stock rounds (816.03–824.98 m/s), populated five target-hit histories and rendered 20 speed labels. [Replay](browser/step3c-firing.json), [canvas](browser/step3c-firing.png), [articulation](browser/step3c-articulation.json), [fixed views](browser/step3c-fixed-view-comparison.json), [mobile layout](browser/step3c-mobile.json). The 390×844 HUD has no horizontal overflow and remains scrollable. The replay explicitly advances CPU ticks; screenshots capture the canvas, with HUD DOM recorded separately. Twelve frozen render frames settle temporal sky history before the final image.

| Preset | Step-3c definition hash |
| --- | --- |
| bismarck | `79099ec05da3940d69b2eb2d96cc3ce029c2340dea984e418f16cb008ccdb8be` |
| yamato | `dff1e0d3f106968fcfa56c6e904d20cc3069e34c75e346cc9a24704eb155431a` |
| baltimore | `85a29101d9c0055a63125b7c292259f580a0ddb6f2c1381948a695a9cef7ad18` |
| enterprise-cv6 | `db8ead3c82e60455f0620a81df7ae2ea796bc0ec41e7d1ff1f8b41faa7b2cd85` |

## Step 3d — complete, Fable accepted after burst-work fix

Projectile flight now resolves the nearest contact, advances to its elapsed time, pays resistance through the same speed/budget relationship, then recomputes the remaining tick. AP profiles in the [original catalog recipe](../../parts/author-ap.ts) specify an arming threshold, delay, filler and fragment budget. A non-ricochet contact can arm a shell; an armed stop remains attached to the hull or articulated mount until it bursts. Turret entry and exit protection both resist continuation, with one contact-damage charge per mount. Omitted profiles retain inert contact-only behavior, including the small AA AP rounds.

AP contact damage is one quarter of the catalog damage. A burst distributes the remaining calibrated damage through bounded target rays: pressure is blocked by steel, and fragments consume each intervening layer, including protection on neighboring ships. Targets are nearby equipment and standalone watertight portals; radius is clamped to 0.5–15 m and work to 128 rays. Candidate volumes and train angles are sampled once per burst; targets are culled before sorting. Damaged machinery still provides the provisional 50 mm resistance. Existing magazine HP consequences are shared by contact and burst damage until step 4 introduces ignition and protection. AP burst visuals stay at the actual world position and use a smaller effect than magazine explosions; the ledger shows impact/exit speed and fuze timing.

Fable accepted the behavior and requested a performance fix ([initial review](fable-step3d-review.md)). The implementation initially repeated a complete ship query per ray and sorted distant targets. The fix restricts rays to sphere-intersecting bounds and sorts only nearby targets. A 200-burst comparison across all four presets, under heel, trim and turret train, preserves damage/events exactly; the regression also compares filtered and full contact lists for 320 rays across those poses. Fable's initial timing included concurrent Blender work and simulation construction in the microbenchmark; absolute timing is host-dependent. Final isolated burst timing excludes construction.

Retained approximations: fixed-tick swept chords; terminating ricochets (already-armed ones lodge); one nearest-volume ray or mount-center ray without partial-occlusion sampling; no detailed spall/metallurgy; a defensive 64-contact/tick limit ends a projectile as expired. Sea entry and underwater hull exits terminate shells without an underwater burst. Flash down ammunition hoists remains step 4. Universal integrity and the current magazine/flooding defeat rules remain pending the validated step-5 replacement. No fuze, filler, damage or penetration value here is a historical certification.

Fable verified the fix and accepted step 3d ([re-review](fable-step3d-rereview.md), task `task_1a9672ab1f35` / dispatch `ctx_caaa62598fe8`). His independent 6,000-ray comparison found zero differences, with the candidate list averaging 2.6% of the complete geometry. Isolated burst means are 0.05–0.17 ms here; final mixed-fleet probes are approximately 1.5–1.7 ms/tick, with host contention recorded. The [performance evidence](step3d-performance.json) separates setup from burst timing and records exact before/after equivalence.

Final validation: **167 tests passed**, production build and all four local Blender ship builds/checks passed. All 20 fixed review images retain the previously inspected RGB pixels. Live articulation stays within 2.746 mm. The stock mounted Game.fire() replay launched eight player rounds, populated seven target-hit histories, and displayed 32 fuze labels and 25 exit-speed labels. A lodged shell's history shows its stop and subsequent timed burst; protected machinery remains operational. The target admitted 0.3 m³ during this replay. The 390×844 panel fits at 366×702 with scrolling and no horizontal document overflow. [Replay](browser/step3d-firing.json), [canvas](browser/step3d-firing.png), [articulation](browser/step3d-articulation.json), [fixed views](browser/step3d-fixed-view-comparison.json), [mobile](browser/step3d-mobile.json). As before, browser CPU replay is explicit and the canvas/DOM were checked separately; this is not a rendered frame-rate benchmark.

| Preset | Step-3d definition hash |
| --- | --- |
| bismarck | `3f9d3af5e736f374952d7021cd61d20bbdcd351d0af8fbcc5ea090be75fc7624` |
| yamato | `940200f4357be4b88ad6051ebd6556a1aa989be0c307e33a7a9cd8c014ab5607` |
| baltimore | `081812bbadd1b773c3aee8e848410e55923f22018754637c09ed2c92907bfd9d` |
| enterprise-cv6 | `080eb386e89b02a29e3372ab71e36e821117ccbc8c19f0859527903fb00a5694` |

## Step 4a — ammunition choices (2026-09-05)

AP/HE now have finite separate stocks within existing total capacity. Switching ammunition takes a complete load interval; firing consumes only the selected stock. Bots choose ammunition and equipment aim points through the same rules. HE bursts on first contact, uses the bounded protected burst queries, and can open penetrated thin exterior plating. Exact-face gunhouse and zero-distance portal contacts pay their protection. The gunnery instrument exposes shell type, stocks, load state and damaged gun mounts.

Validation: 175 tests pass, production build passes (existing bundle-size warning). All four presets rebuilt and checked with local Blender; all 20 fixed views have unchanged decoded pixels, and live articulation errors remain at most 2.746 mm. The controlled live HE replay recorded an eight-round salvo after a full loading interval, unchanged AP stock, eight HE rounds consumed, and four damaged Enterprise gun mounts. Evidence is under `assets/reviews/damage-realism/browser/step4a-*.json`. The settled canvas PNG shows the subsequent port view, not the firing replay.

HE fill, fragment resistance budget and stock split are explicitly provisional in the authoring recipe. AP and HE share the nominal gun flight envelope. No historical accuracy is inferred. User waived further reviews; this checkpoint has local test/build/browser validation and no Fable review verdict.

## Step 4b — fires and damage control (2026-09-05)

Versioned ship profiles now author abstract crew count, setup time, finite fuel, repair supplies, suppression, pumping, shoring and flash protection. Burst-delivered heat starts local compartment/gunhouse fires. Closed intact boundaries contain spread; water suppresses fire. Magazine ignition is thermal, with wet ammunition and feed-path attenuation, instead of an HP-zero explosion. An ignition consumes connected ammunition, disables the local mount and opens the hull and connected boundaries.

Player and bot crews share timed jobs. Priority and focus controls direct suppression, small-hole shoring, isolation, portable pumps and repairs. Repairs consume supplies, stop at 60%, preserve zero-HP destruction, and never restore ammunition. Mount fires emit bounded visual flame/smoke; internal fires remain inspectable through telemetry.

183 tests pass; production build passes with the existing bundle-size warning. All four presets rebuilt/reviewed with local Blender; all 20 fixed-view images have unchanged decoded RGB pixels. Live priority control and a 47-second fixed-tick replay extinguished the seeded fire and consumed repair supplies while the battle continued. Evidence: `browser/step4b-control.json`. Fire/crew units, accessibility thresholds, flash attenuation and pump performance are provisional game calibration, not historical specifications. No individual crew, ventilation or electrical network is claimed. Reviews waived by user.
