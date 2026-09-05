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
