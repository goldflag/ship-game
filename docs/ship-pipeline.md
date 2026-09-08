# Ship asset pipeline

**Source of truth:** versioned `blueprint.json` + original component catalog + original geometry recipes. These produce a compiled simulation definition and an articulated visual model. Historical presets and future player-built ships use this same contract.

## Read for your task

| Task | Required detail |
| --- | --- |
| New ship or geometry change | This workflow, [model review](ship-model-review.md), [coordinate/component contract](ship-runtime-contract.md#coordinate-and-component-contract), the [MCP authoring loop](ship-build-reference.md#blender-mcp-authoring-loop), and the ship's README |
| Combat, internals or equipment behavior | This workflow and the relevant [runtime contract sections](ship-runtime-contract.md) |
| Build or stale artifacts | [Build details](ship-build-reference.md) |
| Merge or rebase | [Integration workflow](integration-workflow.md) |

Per-ship authoring inputs live under `assets/ships/<id>/`; reusable equipment lives in `assets/parts/guns.json`. The [asset layout](ship-build-reference.md#repository-layout) lists retained outputs and shared tools. Ship reports and reference archives have been removed. Research downloads and diagnostics stay in ignored `.build/`; do not recreate them in another tracked folder. Historical documentation may name removed files; it is not a current completion checklist.

## Start a new ship collaboratively

A prompt such as “create Iowa” starts a short briefing and reference-selection conversation. It does not authorize the agent to invent a sister ship, year, refit or camouflage. Reuse answers and approvals already present in the conversation or an existing approved ship README; ask only for missing decisions, normally in one batch of at most three questions:

| Decision | What to resolve |
| --- | --- |
| Vessel | Exact named ship/hull number, or which member of a requested class. If the user has no preference, propose one concrete candidate. |
| Appearance | Year/refit and paint/camouflage, markings and flags. Offer the source model's fit and visible paint as a concrete option when available; do not assume a requested year exists in that model. |
| Reference policy | Recommend **GameModels3D-only** for the initial experiment, or let the user choose **primary model plus selected supporting sources**. War Thunder is an alternative primary model when selected by the user. |

Research available model/configuration options while answers are pending so the choices are concrete. Do not start ship-specific geometry or paint authoring until the missing choices and reference proposal are approved. Continue tool checks, code inspection and other work that does not depend on those decisions.

### Reference proposal and approval

Inspect the candidate before asking the user to approve it. Present a compact proposal in the conversation with the exact source URL/vehicle ID, hull/equipment variant, intended vessel/year, clear previews and unresolved differences. Show side, top and front views plus only the close-ups needed to judge important fittings; use the original source viewer for paint/texture previews because the local comparison app replaces materials with cyan/amber. Do not ask the user to approve an unseen link list or a folder of downloads. A screenshot is useful only when the relevant shape, fitting or marking is legible at the intended inspection scale; reject grainy, tiny, obscured or mismatched material regardless of age or color. Do not collect historical photos simply to satisfy an evidence quota.

Offer these three items for the user to accept or correct:

- [ ] Vessel and fit: the exact ship, year/refit and reference hull/equipment variant, including any explicitly accepted mismatch.
- [ ] Paint: the shown scheme and markings, or the user's specified treatment; identify anything the source does not show.
- [ ] Reference coverage: the proposed model and any individually listed supplements are clear enough for the requested work; listed gaps or approximations are accepted or left unresolved.

Wait for explicit approval of the proposal (a reply such as “approved” is sufficient when unambiguous). Silence, a proposed default, or elapsed time is not approval. If a source is unavailable or fails the user's quality check, prepare a better candidate and return to this checkpoint. Do not silently substitute a sister ship, another game's model or a different fit. Ask again only for a material change to the approved vessel, appearance, source policy or reference set; routine corrections against the approved reference do not need repeated approval.

### Apply the approved reference policy

- **GameModels3D-only:** use the approved GameModels3D model/configuration as the sole external visual reference for geometry, equipment placement and any appearance it actually shows. Do not search for or download archival photos, plans or other models unless the user subsequently approves expanding the reference set. Acceptance measures fidelity to that approved model, with explicit agreed approximations; do not claim independently verified historical accuracy. This also applies to a user-selected War Thunder-only experiment.
- **Primary model plus selected support:** retain the approved GameModels3D or War Thunder model as the primary visual reference. Add only user-approved, legible plans, photographs or other sources that answer a specific missing detail. Explain any conflict with the primary model instead of silently mixing configurations. Historical-accuracy claims are limited to what the accepted evidence supports.
- **Unspecified or invisible details:** do not invent facts or treat a source's missing texture as permission to invent camouflage. Propose a concrete simplification, user-designed paint or additional source for approval. Keep unresolved details qualified. The source policy governs external reference research; existing original recipes/catalog components may still be reused where they match the approved fit. Gameplay values absent from the visual model use existing game conventions as explicitly provisional balancing assumptions, not claimed historical measurements; ask before expanding historical research for them.

Keep the approved decisions in the conversation until scaffolding, then add a short **Approved brief** section to the ship README: vessel/year/fit, paint, reference policy, accepted source links/configuration, and accepted approximations or unresolved limits. This is the durable handoff for a fresh session. Do not create a separate approval manifest, report, source register or tracked image archive. Approval previews and downloads stay in ignored `.build/`; keep only concise lasting decisions in the README.

## Author and publish a ship

Run commands from the repository root. Replace `my-ship` with the lowercase ship ID.

1. **Agree the brief and approve references.** Complete the [collaborative briefing and reference checkpoint](#start-a-new-ship-collaboratively) before historical geometry or appearance work. Inspect the accepted primary model/configuration, record known scale/waterline limitations, and follow the selected source policy throughout the task. Use the source viewer for reference approval and the [local comparison app](../tools/ship-overlay/README.md) once our model is built and registered.
2. **Scaffold only when new:** `bun run ship:new my-ship`. It refuses existing directories and creates a minimal starter, not a finished historical ship. Add the approved brief to its README after scaffolding; do not precreate the ship directory just to store the brief. Establish the live Blender MCP connection and inspect the existing scene using the [MCP authoring loop](ship-build-reference.md#blender-mcp-authoring-loop). For existing ships, inspect this worktree's `generated/source.blend`; for new ships, build the starter to get an inspectable scene. Report actual MCP failures or unavailable tools and use inspected local renders as the fallback.
3. **Iterate visually and author durable inputs.** Use MCP for focused edits, object/pivot inspection and fresh screenshots after meaningful changes. Compare against the primary reference and correct visible mismatches before adding detail. Persist accepted interactive changes in source, then rebuild to verify they survive. Edit the blueprint for hull, mounts, protection, machinery, compartments and connections; reuse or extend catalog parts for distinct equipment. Edit `build.py` or a versioned original component asset for geometry. Generated-scene edits alone are lost on rebuild. Shared text recipes must be declared in [`recipe-inputs.json`](ship-build-reference.md#shared-recipe-inputs). Preserve stable IDs, joints and sockets. Use runtime meters, +Y up, -Z bow, +X starboard, waterline Y=0; apply the documented Blender conversion exactly once.
4. **Complete gameplay data.** Update internals and compartment containment after hull changes. Author applicable [local damage/fire profiles](ship-runtime-contract.md#local-damage-fires-and-combat-loss) and equipment extensions; inspect authoring-helper scope before running them. Combat behavior must come from definitions/components, with no ship-name branches.
5. **Compile and build:**
   ```sh
   bun run ship:compile my-ship
   bun run ship:build my-ship
   ```
   Compile validates inputs and writes staging data. Build runs isolated local Blender, validates the exported hull/joints/muzzles, and publishes matching `public/models/<id>.glb` and `.json`, retained Blender source and thumbnail. Export diagnostics stay in `.build/ships/<id>/export.json`. No reference archive or report folder is required. Read [build details](ship-build-reference.md) for hashes, locks and recovery.
6. **Register a new playable preset.** Import the compiled JSON and add one entry per line to [`src/ships/presets.ts`](../src/ships/presets.ts). `ship:new` does not register it. Register after the first successful build and before comparison-app or in-game inspection: both discover ships through this roster. Registration makes the candidate inspectable; it is not visual acceptance. This is the authoritative runtime/fleet-check roster; do not duplicate it in package scripts or shared prose.
7. **Review the built geometry:** `bun run ship:review my-ship`. Reopen the rebuilt scene through MCP and verify accepted edits survived the clean build. Inspect all five fixed views plus close-ups, approved primary-model comparisons, with historical overlays only when the selected reference policy includes them; also inspect the actual exported GLB with the local comparison app. Complete every [visual acceptance check](ship-model-review.md): physical attachment, priority proportions, detailed exposed guns and clearance through articulation. Resolve known failures in authoring inputs, rebuild and repeat the affected checks.
8. **Verify in-game and finish.** Load the exact published ship/hash. Check full traverse/elevation/recoil, independently positioned neighboring mounts, fitted weapons, free aim, firing, hits, damage, flooding and reset. In port, inspect Armor and Internals, isolate a volume, return to Statistics, launch and return to port. Use the shared inspection/statistics adapters for new properties. Run the checks below and summarize results to the user. Update the ship README only for lasting configuration or limitation changes; leave raw results in `.build/`.

For national cloth ensigns and articulated sensors, see [ensigns and radar rigs](ship-runtime-contract.md#ensigns-and-radar-rigs).

## Required visual acceptance checks

All four checks in [ship model review](ship-model-review.md) are required for new models and affected geometry: **no floating parts; turret/bridge/bow proportions faithful to the approved reference and configuration; intricate exposed guns; no turret clipping.** Known defects block visual acceptance. Successful export checks do not certify any of these visual requirements or historical accuracy.

## Validation by change

| Change | Required verification |
| --- | --- |
| Blueprint, simulation or equipment behavior | Relevant simulation tests, `bun run build`; rebuild affected models when definitions/hashes change; exercise changed behavior in-game |
| Model geometry or articulation | `ship:build <id>`, `ship:review <id>`, `ship:check <id>`, all affected visual checks and in-game articulation; relevant simulation tests and `bun run build` |
| Shared catalog, compiler or geometry recipe | `ship:check all`; rebuild every affected/stale asset, then repeat relevant model/runtime checks |
| Thumbnail presentation only | `ship:thumbnail <id>` for affected presets, inspect thumbnails, `ship:check all` and `bun run build` |
| Reference research only | Present a new or materially changed reference set for approval; update concise accepted source links and lasting limitations in the ship README. Keep downloads and captures local. |

`bun run test` is the repository test runner; use focused tests while iterating. `bun run build` runs ship/aircraft asset checks, TypeScript and the production bundle. Do not run model-loading tests while a build publishes those same assets. After integration, use `bun run ship:check all` and apply the [narrow repair it requests](integration-workflow.md#during-conflict-resolution).

Keep the single current fixed-camera set in `generated/review/`. Additional close-ups, overlays, command output and articulation diagnostics belong in `.build/`; do not copy blueprints, compiled definitions or old model versions into tracked review folders. Keep approximations explicit in the ship README; GameModels3D-only comparisons do not establish historical accuracy; unsupported details remain qualified.
