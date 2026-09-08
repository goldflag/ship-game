# Working on this game

Use one versioned blueprint/definition format for historical presets and future player-built ships.

## Read by task

Read the relevant [README](README.md) sections for product behavior and architecture, then follow the task guide. The [documentation index](docs/README.md) separates current guidance from historical records.

| Task | Start here |
| --- | --- |
| New ship, ship model or combat change | [Ship pipeline](docs/ship-pipeline.md), then its required task-specific references |
| Aircraft assets | [Aircraft pipeline](docs/aircraft-pipeline.md) |
| Carrier operations or bots | [Air operations](docs/air-operations.md) or [bot behavior](docs/bot-behavior.md), plus the ship pipeline for combat changes |
| Ocean or UI | [Ocean guide](docs/ocean-configuration.md), [README architecture](README.md#architecture), and the relevant guide in the documentation index |
| Merge, rebase or independent worktree | [Integration workflow](docs/integration-workflow.md) before starting |

## Invariants

- Author ships through blueprints, the component catalog and original recipes under `assets/`; preserve `assets/ships/bismarck/baseline/`.
- Do not create or commit ship `reports/` or `references/` directories. Downloads, exploratory captures, logs and diagnostic output belong in ignored `.build/`. Keep only concise configuration, source links and known limitations in the ship README; do not replace the deleted archive with another tracked folder.
- Generated Blender/GLB files are build outputs. Record durable changes in a recipe or versioned original component asset.
- Use `ship:new`, `ship:compile`, `ship:build`, `ship:check` and `ship:review`. For ship geometry tasks, use Blender MCP for interactive scene inspection, small modeling changes and visual correction; follow the [MCP authoring loop](docs/ship-build-reference.md#blender-mcp-authoring-loop). Verify the connection with a read-only scene query, inspect screenshots before and after meaningful changes, and preserve accepted edits in durable inputs before a clean `ship:build`. If MCP is unavailable or a call fails, report the specific limitation and continue the same visual loop with local Blender and inspected renders. A successful Python command is not visual review.
- Preserve stable assembly/joint/socket IDs and the documented coordinate conversion. Keep independent moving parts and pivot empties.
- Keep simulation renderer-free. CPU simulation owns combat poses, firing, hits, modules and flooding; GPU ocean samples are visual-only.
- For a new ship, follow the [collaborative brief and reference approval](docs/ship-pipeline.md#start-a-new-ship-collaboratively): resolve the exact vessel, year/refit, paint and reference policy, then present inspected source previews for user approval before ship-specific geometry or paint work. Reuse existing answers/approvals. Recommend GameModels3D-only for the experiment; when selected, do not add historical photos/plans or other models without approval. Use the approved GameModels3D or War Thunder model as the primary visual reference and keep a concise approved brief in the ship README. Author geometry/textures independently. Model fidelity and export checks do not certify historical accuracy.
- Extend the existing naval instrument styling. Keep the ship and sea visible and damage feedback inspectable.

## Model acceptance

Complete [all four visual checks](docs/ship-model-review.md):

1. Every fitted part has a modeled physical attachment; no floating geometry.
2. Turret shapes, bridge proportions and the bow's side profile match the approved model/configuration at a common scale. Unaccepted mismatches block completion. GameModels3D-only work targets fidelity to that model; historical claims require supporting evidence under the approved source policy. Keep accepted approximations explicit.
3. Exposed guns have intricate, variant-specific mechanisms and fittings.
4. Turrets, barrels and fittings clear the ship throughout traverse, elevation and recoil, including intermediate poses and independently moving neighbors.

Review the exact published model. Fix failures in durable inputs and repeat affected reviews. Use `.build/` for temporary evidence; do not commit review reports or reference downloads.

## Validation and integration

- Run relevant simulation tests and `bun run build`. Model changes also require `ship:build`, fixed review views and articulation in-game. Rebuild affected assets after shared recipe changes; follow the pipeline's validation matrix.
- Start independent tasks from current remote master in separate worktrees. Only one integrator may mutate the main checkout; check for already-integrated patches before replaying commits.
- Run `bun run git:setup` from the durable main checkout once per clone for ID-aware catalog merging and remembered resolutions with manual staging.
- Resolve authoring inputs first, run `bun run ship:check all`, and rebuild only stale outputs it identifies. Never automatically choose a binary side or rewrite hashes to bypass checks.
- Keep the runtime roster in `src/ships/presets.ts`, one entry per line. Do not duplicate the roster in `package.json` or hard-code preset counts in shared prose.
