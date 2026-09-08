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

## Author and publish a ship

Run commands from the repository root. Replace `my-ship` with the lowercase ship ID.

1. **Choose the configuration and inspect the primary visual reference.** Read the ship README before editing. Inspect the corresponding GameModels3D or War Thunder model for shape, proportions, equipment placement and visible fittings before authoring geometry. Keep a concise note in the ship README with the inspected model URL/identifier, configuration, date/refit, loading condition and unresolved limitations. Corroborate details with dated plans and photographs; use them to resolve source disagreements. If the primary model is unavailable, report that explicitly instead of silently substituting historical-only research. Any downloads or comparison captures stay local under `.build/`. Use the [local overlay app](../tools/ship-overlay/README.md) for direct model comparison.
2. **Scaffold only when new:** `bun run ship:new my-ship`. It refuses existing directories and creates a minimal starter, not a finished historical ship. Establish the live Blender MCP connection and inspect the existing scene using the [MCP authoring loop](ship-build-reference.md#blender-mcp-authoring-loop). For existing ships, inspect this worktree's `generated/source.blend`; for new ships, build the starter to get an inspectable scene. Report actual MCP failures or unavailable tools and use inspected local renders as the fallback.
3. **Iterate visually and author durable inputs.** Use MCP for focused edits, object/pivot inspection and fresh screenshots after meaningful changes. Compare against the primary reference and correct visible mismatches before adding detail. Persist accepted interactive changes in source, then rebuild to verify they survive. Edit the blueprint for hull, mounts, protection, machinery, compartments and connections; reuse or extend catalog parts for distinct equipment. Edit `build.py` or a versioned original component asset for geometry. Generated-scene edits alone are lost on rebuild. Shared text recipes must be declared in [`recipe-inputs.json`](ship-build-reference.md#shared-recipe-inputs). Preserve stable IDs, joints and sockets. Use runtime meters, +Y up, -Z bow, +X starboard, waterline Y=0; apply the documented Blender conversion exactly once.
4. **Complete gameplay data.** Update internals and compartment containment after hull changes. Author applicable [local damage/fire profiles](ship-runtime-contract.md#local-damage-fires-and-combat-loss) and equipment extensions; inspect authoring-helper scope before running them. Combat behavior must come from definitions/components, with no ship-name branches.
5. **Compile and build:**
   ```sh
   bun run ship:compile my-ship
   bun run ship:build my-ship
   ```
   Compile validates inputs and writes staging data. Build runs isolated local Blender, validates the exported hull/joints/muzzles, and publishes matching `public/models/<id>.glb` and `.json`, retained Blender source and thumbnail. Export diagnostics stay in `.build/ships/<id>/export.json`. No reference archive or report folder is required. Read [build details](ship-build-reference.md) for hashes, locks and recovery.
6. **Review the built geometry:** `bun run ship:review my-ship`. Reopen the rebuilt scene through MCP and verify accepted edits survived the clean build. Inspect all five fixed views plus close-ups, primary-model comparisons and matched historical overlays; also inspect the actual exported GLB with the local comparison app. Complete every [visual acceptance check](ship-model-review.md): physical attachment, priority proportions, detailed exposed guns and clearance through articulation. Resolve known failures in authoring inputs, rebuild and repeat the affected checks.
7. **Register a new playable preset.** Import the compiled JSON and add one entry per line to [`src/ships/presets.ts`](../src/ships/presets.ts). `ship:new` does not register it. This is the authoritative runtime/fleet-check roster; do not duplicate it in package scripts or shared prose.
8. **Verify in-game and finish.** Load the exact published ship/hash. Check full traverse/elevation/recoil, independently positioned neighboring mounts, fitted weapons, free aim, firing, hits, damage, flooding and reset. In port, inspect Armor and Internals, isolate a volume, return to Statistics, launch and return to port. Use the shared inspection/statistics adapters for new properties. Run the checks below and summarize results to the user. Update the ship README only for lasting configuration or limitation changes; leave raw results in `.build/`.

For national cloth ensigns and articulated sensors, see [ensigns and radar rigs](ship-runtime-contract.md#ensigns-and-radar-rigs).

## Required visual acceptance checks

All four checks in [ship model review](ship-model-review.md) are required for new models and affected geometry: **no floating parts; historically supported turret/bridge/bow proportions targeting 100% accuracy; intricate exposed guns; no turret clipping.** Known defects block visual acceptance. Successful export checks do not certify any of these visual requirements or historical accuracy.

## Validation by change

| Change | Required verification |
| --- | --- |
| Blueprint, simulation or equipment behavior | Relevant simulation tests, `bun run build`; rebuild affected models when definitions/hashes change; exercise changed behavior in-game |
| Model geometry or articulation | `ship:build <id>`, `ship:review <id>`, `ship:check <id>`, all affected visual checks and in-game articulation; relevant simulation tests and `bun run build` |
| Shared catalog, compiler or geometry recipe | `ship:check all`; rebuild every affected/stale asset, then repeat relevant model/runtime checks |
| Thumbnail presentation only | `ship:thumbnail <id>` for affected presets, inspect thumbnails, `ship:check all` and `bun run build` |
| Reference research only | Inspect the source; update concise source links and lasting limitations in the ship README. Keep downloads and captures local. |

`bun run test` is the repository test runner; use focused tests while iterating. `bun run build` runs ship/aircraft asset checks, TypeScript and the production bundle. Do not run model-loading tests while a build publishes those same assets. After integration, use `bun run ship:check all` and apply the [narrow repair it requests](integration-workflow.md#during-conflict-resolution).

Keep the single current fixed-camera set in `generated/review/`. Additional close-ups, overlays, command output and articulation diagnostics belong in `.build/`; do not copy blueprints, compiled definitions or old model versions into tracked review folders. Keep approximations explicit in the ship README; missing historical evidence is unresolved, never an accuracy pass.
