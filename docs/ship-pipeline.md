# Ship asset pipeline

**Source of truth:** versioned `blueprint.json` + original component catalog + original geometry recipes. These produce a compiled simulation definition and an articulated visual model. Historical presets and future player-built ships use this same contract.

## Read for your task

| Task | Required detail |
| --- | --- |
| New ship or geometry change | This workflow, [model review](ship-model-review.md), [coordinate/component contract](ship-runtime-contract.md#coordinate-and-component-contract), and the ship's README/source/discrepancy registers |
| Combat, internals or equipment behavior | This workflow and the relevant [runtime contract sections](ship-runtime-contract.md) |
| Build, references or stale artifacts | [Build/reference details](ship-build-reference.md) and [reference setup](../scripts/reference/README.md) |
| Merge or rebase | [Integration workflow](integration-workflow.md) |

Per-ship inputs and evidence live under `assets/ships/<id>/`; reusable equipment lives in `assets/parts/guns.json`. The [asset layout](ship-build-reference.md#repository-layout) lists generated outputs and shared tools. The [original systems plan](ship-systems-plan.md) and [validation log](ship-validation.md) are historical context, not current completion checklists.

## Author and publish a ship

Run commands from the repository root. Replace `my-ship` with the lowercase ship ID. Before inspecting archival references or rebuilding comparisons, fetch the required [LFS source content](ship-build-reference.md#source-archive-and-lfs); a passing check with LFS pointers does not mean those originals are available locally.

1. **Choose the configuration and establish evidence.** Read existing ship work before editing. State the date/refit, equipment variant, loading condition, waterline and known/interpreted/unknown measurements. Add sources and unresolved questions to `references/sources.json` and `reports/discrepancies.md`. Prioritize turret shapes, bridge proportions and the bow's side profile. Use dated plans and documented dimensions; GameModels3D supplies comparison evidence only.
2. **Scaffold only when new:** `bun run ship:new my-ship`. It refuses existing directories and creates a minimal starter, not a finished historical ship. For existing ships, inspect `generated/source.blend`. Discover available Blender MCP scene/code/screenshot tools; use local Blender when MCP is unavailable and describe the tool actually used.
3. **Author durable inputs.** Edit the blueprint for hull, mounts, protection, machinery, compartments and connections; reuse or extend catalog parts for distinct equipment. Edit `build.py` or a versioned original component asset for geometry. Generated-scene edits alone are lost on rebuild. Shared text recipes must be declared in [`recipe-inputs.json`](ship-build-reference.md#shared-recipe-inputs). Preserve stable IDs, joints and sockets. Use runtime meters, +Y up, -Z bow, +X starboard, waterline Y=0; apply the documented Blender conversion exactly once.
4. **Complete gameplay data.** Update internals and compartment containment after hull changes. Author applicable [local damage/fire profiles](ship-runtime-contract.md#local-damage-fires-and-combat-loss) and equipment extensions; inspect authoring-helper scope before running them. Combat behavior must come from definitions/components, with no ship-name branches.
5. **Compile and build:**
   ```sh
   bun run ship:compile my-ship
   bun run ship:build my-ship
   ```
   Compile validates inputs and writes staging data. Build runs isolated local Blender, validates the exported hull/joints/muzzles, and publishes matching `public/models/<id>.glb` and `.json`, retained Blender source, export report and thumbnail. Ships with `modeling-spec.json` also rebuild their comparison evidence. Read [build details](ship-build-reference.md) for hashes, locks and recovery.
6. **Review the built geometry:** `bun run ship:review my-ship`. Inspect all five fixed views plus close-ups and matched historical overlays. Complete every [visual acceptance check](ship-model-review.md): physical attachment, priority proportions, detailed exposed guns and clearance through articulation. Resolve known failures in authoring inputs, rebuild and repeat the affected checks.
7. **Register a new playable preset.** Import the compiled JSON and add one entry per line to [`src/ships/presets.ts`](../src/ships/presets.ts). `ship:new` does not register it. This is the authoritative runtime/fleet-check roster; do not duplicate it in package scripts or shared prose.
8. **Verify in-game and finish.** Load the exact published ship/hash. Check full traverse/elevation/recoil, independently positioned neighboring mounts, fitted weapons, free aim, firing, hits, damage, flooding and reset. In port, inspect Armor and Internals, isolate a volume, return to Statistics, launch and return to port. Use the shared inspection/statistics adapters for new properties. Run the checks below and retain evidence of both successes and unresolved items.

## Required visual acceptance checks

All four checks in [ship model review](ship-model-review.md) are required for new models and affected geometry: **no floating parts; historically supported turret/bridge/bow proportions targeting 100% accuracy; intricate exposed guns; no turret clipping.** Known defects block visual acceptance. Successful export checks do not certify any of these visual requirements or historical accuracy.

## Validation by change

| Change | Required verification |
| --- | --- |
| Blueprint, simulation or equipment behavior | Relevant simulation tests, `bun run build`; rebuild affected models when definitions/hashes change; exercise changed behavior in-game |
| Model geometry or articulation | `ship:build <id>`, `ship:review <id>`, `ship:check <id>`, all affected visual checks and in-game articulation; relevant simulation tests and `bun run build` |
| Shared catalog, compiler or geometry recipe | `ship:check all`; rebuild every affected/stale asset, then repeat relevant model/runtime checks |
| Thumbnail presentation only | `ship:thumbnail <id>` for affected presets, inspect thumbnails, `ship:check all` and `bun run build` |
| Reference/comparison inputs only | `ship:compare <id>`, inspect regenerated evidence, `ship:check <id>` and `bun run build` |

`bun run test` is the repository test runner; use focused tests while iterating. `bun run build` runs ship/aircraft asset checks, TypeScript and the production bundle. Do not run model-loading tests while a build publishes those same assets. After integration, use `bun run ship:check all` and apply the [narrow repair it requests](integration-workflow.md#during-conflict-resolution).

Record the model hash, changed assemblies, command results, fixed/close-up views, tested articulation poses and remaining evidence gaps under the ship's `reports/` and `generated/review/`. Preserve old evidence under its original hash. Keep approximations explicit; missing historical evidence is unresolved, never an accuracy pass.
