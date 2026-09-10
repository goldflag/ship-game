# Documentation map

Start with [AGENTS.md](../AGENTS.md) for repository rules. Read the task's current guide, then follow its links to the relevant reference sections. The main [README](../README.md) covers setup, player behavior, controls and architecture.

## Current task guides

| Task | Guide | Source of truth |
| --- | --- | --- |
| Agree a new ship and its references | [Collaborative brief](ship-pipeline.md#start-a-new-ship-collaboratively) | User-approved vessel, fit, paint and reference policy in the ship README |
| Create or modify a ship | [Ship pipeline](ship-pipeline.md) | Per-ship blueprint, original recipes and component catalog |
| Iterate on ship geometry with Blender MCP | [MCP authoring loop](ship-build-reference.md#blender-mcp-authoring-loop) | Live scene inspection, durable recipe edits and clean rebuild verification |
| Compare ships, aircraft and reference models | [Model library and comparison app](../tools/ship-overlay/README.md) | Our runtime GLB plus ignored local reference geometry |
| Review model quality | [Ship model review](ship-model-review.md) | Four required visual checks on the exact published model |
| Paint ships consistently | [Ship appearance](ship-appearance.md) | Shared finishes, named paints and approved ship-specific schemes |
| Reuse equipment or browse standalone models | [Shared components](shared-components.md), [model viewer](../tools/ship-overlay/README.md) | Component catalog, original builders and published ship assemblies |
| Change ship components or combat | [Runtime/component reference](ship-runtime-contract.md) | Validated definitions and renderer-free simulation |
| Build, export or compare ships | [Build/reference details](ship-build-reference.md) | Build scripts, input hashes and published model/thumbnail validation |
| Merge or rebase | [Integration workflow](integration-workflow.md) | Resolved authoring inputs and runtime preset roster |
| Author aircraft | [Aircraft pipeline](aircraft-pipeline.md) | Original aircraft assets, recipes and export checks |
| Change carrier operations | [Air operations](air-operations.md) | Versioned air-wing data and CPU aircraft state |
| Change bot behavior | [Bot behavior](bot-behavior.md) | Seeded, renderer-free crew decisions |
| Change ocean rendering | [Ocean configuration](ocean-configuration.md) | Visual ocean settings; CPU combat poses stay authoritative |
| Work on port or HUD UI | [Garage design](garage-mockups/README.md), [HUD design](hud-mockups/README.md), [shared controls](../src/ui/components/README.md) | Existing naval instrument styling and current runtime UI |
| Add or change graphics settings | [Graphics settings study](graphics-settings/README.md) | Renderer knobs, their apply timing and the proposed live-apply Graphics tab |
| Develop Rust multiplayer | [Implementation status](rust-multiplayer-implementation.md), [reviewed proposal](rust-multiplayer-plan.md), [Fable critique](rust-multiplayer-critique-fable.md), [review response](rust-multiplayer-review-response.md) | Shared Rust authority for online/custom battles, local validation and measured deployment limits |
| Develop PvE fleet command | [Agreed plan](pve-fleet-command-plan.md), [implementation status](pve-implementation-status.md), [selected UI D](pve-ui-studies/README.md) | Rust orders, observation, mission and air rules; approved selection/follow/helm workflows |
| Investigate test execution | [Test performance](test-performance.md) | Repository test runner and measured execution notes |
| Profile custom battles | [Custom battle performance](custom-battle-performance.md) | Actual application, Rust worker, frame intervals and graphics warmup |

## Asset inputs and review

- Ship configuration, inspected primary-model links and lasting limitations: `assets/ships/<id>/README.md`.
- Ship authoring: canonical blueprint, original recipes and registered shared components.
- Current fixed model views: `assets/ships/<id>/generated/review/`.
- Temporary ship research, downloads, logs and additional review output: ignored `.build/`.
- Ship `reports/` and `references/` archives are removed; do not recreate them or rename them into another tracked archive.
- Original asset collections: [asset index](../assets/README.md), [aircraft index](../assets/aircraft/README.md), [map review](../assets/maps/review/README.md).
- Playable ship roster: [src/ships/presets.ts](../src/ships/presets.ts).

## Historical context

| Record | How to use it |
| --- | --- |
| [Original ship systems plan](ship-systems-plan.md) | Design rationale and proposed roadmap from the pre-pipeline baseline; implementation-status statements are historical |
| [Ship validation log](ship-validation.md) | Dated tests, model hashes and limitations; a past pass does not validate today's build |
| [Fleet fidelity integration](fleet-fidelity-integration.md) | Integration evidence for its recorded commits and assets |
| `assets/reviews/` | Historical task evidence; ship report/reference archives are available only in Git history |

## Maintaining these docs

- Keep repository invariants and task routing in `AGENTS.md`; keep the production sequence in `ship-pipeline.md`.
- Put detailed contracts in their linked reference guide. Link to the canonical rule instead of copying long instructions into multiple files.
- Keep vessel-specific measurements and modeling decisions under that vessel's `assets/` directory. Keep research downloads and diagnostic output local under `.build/`.
- Document current commands from `package.json` and scripts. Distinguish automated checks from required visual review and historical-accuracy evidence.
- Keep historical status claims visibly dated. Avoid fixed fleet counts or a second preset roster in shared prose.
