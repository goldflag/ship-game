# Working on ships, parts and aircraft assets

These rules apply to anything under `assets/` and to model or combat changes that flow from it. Repository-wide
rules are in the [root guide](../AGENTS.md). Links below are relative to this directory.

## Invariants

- Before modeling ship equipment, search `bun run part:list` and inspect matching variants in `bun run model:viewer`. Reuse registered original builders through `assets/parts/library.py`; isolate published assemblies only for viewing. Preserve exact variants and declare dependencies with `part:inputs`. See [shared components](../docs/shared-components.md).
- Prefer one adjustable `custom-hull` for the main hull of each new ship (one per hull for multihulls). Start with `ship:new --template fletcher-hull` or another adjustable preset and edit its sections. Use freeform pieces for superstructure, appendages, and shapes the adjustable hull cannot represent; document any main-hull exception.
- Author new ship construction through versioned blueprints and the custom editor/Rust compiler; use Blender indefinitely for original reusable component recipes under `assets/`. Blender may also shape a construction ship through `ship:blender-import`/`ship:blender-export`, whose only output is a revision-guarded batch; builds never run Blender for it and `blueprint.json` stays the only durable source ([Blender front end](../docs/construction-authoring.md#blender-front-end)). Existing Blender-backed ship recipes remain supported. Preserve `assets/ships/bismarck/baseline/`.
- Do not create or commit ship `reports/` or `references/` directories. Downloads, exploratory captures, logs and diagnostic output belong in ignored `.build/`. Keep only concise configuration, source links and known limitations in the ship README; do not replace the deleted archive with another tracked folder.
- Generated Blender/GLB files are build outputs. Record durable changes in a recipe or versioned original component asset.
- Paint and deck changes follow [shared appearance rules](../docs/ship-appearance.md): shared surface quality and metric texture scale, named paints, approved ship-specific schemes and restrained wear.
- Use `ship:new`, `ship:compile`, `ship:build`, `ship:check` and `ship:review`. For construction-backed ships, follow [agent construction authoring](../docs/construction-authoring.md) and inspect the exact exported model through its fixed views and native articulation checks. For reusable component geometry and legacy Blender-backed ships, use Blender MCP for interactive scene inspection, small modeling changes and visual correction; follow the [MCP authoring loop](../docs/ship-build-reference.md#blender-mcp-authoring-loop). Verify the connection with a read-only scene query, inspect screenshots before and after meaningful changes, and preserve accepted edits in durable inputs before a clean `ship:build`. If MCP is unavailable or a call fails, report the specific limitation and continue the same visual loop with local Blender and inspected renders. A successful Python command is not visual review.
- Preserve stable assembly/joint/socket IDs and the documented coordinate conversion. Keep independent moving parts and pivot empties.
- For a new ship, follow the [collaborative brief and reference approval](../docs/ship-pipeline.md#start-a-new-ship-collaboratively): resolve the exact vessel, year/refit, paint and reference policy, then present inspected source previews for user approval before ship-specific geometry or paint work. Reuse existing answers/approvals. Recommend GameModels3D-only for the experiment; when selected, do not add historical photos/plans or other models without approval. Use the approved GameModels3D or War Thunder model as the primary visual reference and keep a concise approved brief in the ship README. Author geometry/textures independently. Model fidelity and export checks do not certify historical accuracy.

## Model acceptance

Complete [all four visual checks](../docs/ship-model-review.md):

1. Every fitted part has a modeled physical attachment; no floating geometry.
2. Turret shapes, bridge proportions and the bow's side profile match the approved model/configuration at a common scale. Unaccepted mismatches block completion. GameModels3D-only work targets fidelity to that model; historical claims require supporting evidence under the approved source policy. Keep accepted approximations explicit.
3. Exposed guns have intricate, variant-specific mechanisms and fittings.
4. Turrets, barrels and fittings clear the ship throughout traverse, elevation and recoil, including intermediate poses and independently moving neighbors.

Review the exact published model. Fix failures in durable inputs and repeat affected reviews. Use `.build/` for temporary evidence; do not commit review reports or reference downloads.
