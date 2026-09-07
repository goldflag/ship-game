# Documentation map

Start with [AGENTS.md](../AGENTS.md) for repository rules. Read the task's current guide, then follow its links to the relevant reference sections. The main [README](../README.md) covers setup, player behavior, controls and architecture.

## Current task guides

| Task | Guide | Source of truth |
| --- | --- | --- |
| Create or modify a ship | [Ship pipeline](ship-pipeline.md) | Per-ship blueprint, original recipes and component catalog |
| Review model quality | [Ship model review](ship-model-review.md) | Four required visual checks and evidence for the exact model hash |
| Change ship components or combat | [Runtime/component reference](ship-runtime-contract.md) | Validated definitions and renderer-free simulation |
| Build, export or compare ships | [Build/reference details](ship-build-reference.md) | Build scripts, input hashes and artifact manifests |
| Merge or rebase | [Integration workflow](integration-workflow.md) | Resolved authoring inputs and runtime preset roster |
| Author aircraft | [Aircraft pipeline](aircraft-pipeline.md) | Original aircraft assets, recipes and export checks |
| Change carrier operations | [Air operations](air-operations.md) | Versioned air-wing data and CPU aircraft state |
| Change bot behavior | [Bot behavior](bot-behavior.md) | Seeded, renderer-free crew decisions |
| Change ocean rendering | [Ocean configuration](ocean-configuration.md) | Visual ocean settings; CPU combat poses stay authoritative |
| Work on port or HUD UI | [Garage design](garage-mockups/README.md), [HUD design](hud-mockups/README.md) | Existing naval instrument styling and current runtime UI |
| Investigate test execution | [Test performance](test-performance.md) | Repository test runner and measured execution notes |

## Per-asset evidence

- Ship configuration and limitations: `assets/ships/<id>/README.md`.
- Historical sources: `assets/ships/<id>/references/sources.json` and retained reference images.
- Accuracy gaps and validation: `assets/ships/<id>/reports/`, especially `discrepancies.md`.
- Model review: `assets/ships/<id>/generated/review/` and optional comparison packs.
- Original asset collections: [asset index](../assets/README.md), [aircraft index](../assets/aircraft/README.md), [map review](../assets/maps/review/README.md).
- Playable ship roster: [src/ships/presets.ts](../src/ships/presets.ts). Derive fleet membership from it.

## Historical context

| Record | How to use it |
| --- | --- |
| [Original ship systems plan](ship-systems-plan.md) | Design rationale and proposed roadmap from the pre-pipeline baseline; implementation-status statements are historical |
| [Ship validation log](ship-validation.md) | Dated tests, model hashes and limitations; a past pass does not validate today's build |
| [Fleet fidelity integration](fleet-fidelity-integration.md) | Integration evidence for its recorded commits and assets |
| `assets/reviews/` and per-ship reports | Evidence for the recorded task/configuration/hash, including unresolved findings |

## Maintaining these docs

- Keep repository invariants and task routing in `AGENTS.md`; keep the production sequence in `ship-pipeline.md`.
- Put detailed contracts in their linked reference guide. Link to the canonical rule instead of copying long instructions into multiple files.
- Keep vessel-specific measurements and modeling decisions under that vessel's `assets/` directory. Preserve dated evidence and its original hashes.
- Document current commands from `package.json` and scripts. Distinguish automated checks from required visual review and historical-accuracy evidence.
- Keep historical status claims visibly dated. Avoid fixed fleet counts or a second preset roster in shared prose.
