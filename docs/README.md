# Documentation map

Start with [AGENTS.md](../AGENTS.md) for repository rules. Read the task's current guide, then follow its links to the relevant reference sections. The main [README](../README.md) covers setup and architecture; the [player guide](player-guide.md) covers how the game plays.

## Current task guides

| Task | Guide | Source of truth |
| --- | --- | --- |
| Agree a new ship and its references | [Collaborative brief](ship-pipeline.md#start-a-new-ship-collaboratively) | User-approved vessel, fit, paint and reference policy in the ship README |
| Create or modify a ship | [Ship pipeline](ship-pipeline.md) | Per-ship blueprint, original recipes and component catalog |
| Author a repository ship with agents | [Construction authoring](construction-authoring.md) | File-backed source, shared commands, visual review, trials and publication without per-ship Blender |
| Build a local player ship | [Shipbuilding](shipbuilding.md) | Versioned source, native construction compiler, retained equipment catalog and IndexedDB revisions |
| Iterate on ship geometry with Blender MCP | [MCP authoring loop](ship-build-reference.md#blender-mcp-authoring-loop) | Live scene inspection, durable recipe edits and clean rebuild verification |
| Compare ships, aircraft and reference models | [Model library and comparison app](../tools/ship-overlay/README.md) | Our runtime GLB plus ignored local reference geometry |
| Verify a UI or battle change in a browser | [Browser verification](browser-verification.md) | Account-free harness page, Playwright driver, saved-design cache and known-red ledgers |
| Review model quality | [Ship model review](ship-model-review.md) | Four required visual checks on the exact published model |
| Paint ships consistently | [Ship appearance](ship-appearance.md) | Shared finishes, named paints and approved ship-specific schemes |
| Reuse equipment or browse standalone models | [Shared components](shared-components.md), [model viewer](../tools/ship-overlay/README.md) | Component catalog, original builders and published ship assemblies |
| Ship handling, propulsion or resistance | [Maneuvering physics](maneuvering.md) | Native per-fitting forces, cached hull coefficients and loaded mass/inertia |
| Change ship components or combat | [Runtime/component reference](ship-runtime-contract.md) | Validated definitions and renderer-free simulation |
| Profile or optimize ship builds | [Pipeline performance](ship-pipeline-performance.md) | Measured stage timings and rebuild rules |
| Build, export or compare ships | [Build/reference details](ship-build-reference.md) | Build scripts, input hashes and published model/thumbnail validation |
| Merge or rebase | [Integration workflow](integration-workflow.md) | Resolved authoring inputs and runtime preset roster |
| Author aircraft | [Aircraft pipeline](aircraft-pipeline.md) | Original aircraft assets, recipes and export checks |
| Change carrier operations | [Air operations](air-operations.md) | Versioned air-wing data and CPU aircraft state |
| Change bot behavior | [Bot behavior](bot-behavior.md) | Seeded, renderer-free crew decisions |
| Change ocean rendering | [Ocean configuration](ocean-configuration.md) | Visual ocean settings; CPU combat poses stay authoritative |
| Work on port or HUD UI | [Garage design](garage-mockups/README.md), [HUD design](hud-mockups/README.md), [shared controls](../src/ui/components/README.md) | Existing naval instrument styling and current runtime UI |
| Add or change graphics settings | [Graphics settings study](graphics-settings/README.md) | Renderer knobs, their apply timing and the proposed live-apply Graphics tab |
| Develop Rust multiplayer | [Setup, architecture and validation](rust-multiplayer-implementation.md), [crates guide](../crates/AGENTS.md) | Authoritative Rust simulation, generated wire types and server settings |
| Deploy and operate the public game | [Hermes deployment](deployment.md) | Separate Docker Compose stack, HTTPS routing, persistent results, deploy and rollback commands |
| Develop PvE fleet command | [Current contracts](pve-implementation-status.md), [selected UI D](pve-ui-studies/README.md) | Rust orders, observation, mission and air rules |
| Investigate test execution | [Test performance](test-performance.md) | Repository test runner and measured execution notes |
| Measure fleet-command speed | [Fleet command speed](pve-speed-performance.md) | Actual 1×/2×/4× progress, fixed fleet scenarios and worker throughput |
| Profile custom battles | [Custom battle performance](custom-battle-performance.md) | Actual application, Rust worker, frame intervals and graphics warmup |
| Reduce ship runtime size and load cost | [Runtime performance](ship-runtime-performance.md) | Indexed definitions, lazy admission, deterministic benchmarks and measured limits |
| Evaluate simplified combat mechanics | [Combat runtime experiments](compartment-runtime.md) | Opt-in weighted buoyancy/flooding, exact optimizations and measured gameplay tradeoffs |
| Speed up the simulation | [Simulation performance plan](sim-performance-plan.md) | Native profiling harness, equality gate and the phased optimization plan across fleet command, custom battles and the server |

## Asset inputs and review

- Ship configuration, inspected primary-model links and lasting limitations: `assets/ships/<id>/README.md`.
- Ship authoring: canonical blueprint, original recipes and registered shared components.
- Current fixed model views: `assets/ships/<id>/generated/review/`.
- Temporary research, downloads, logs, captures, measurements and review output for any task: ignored `.build/` (diagnostic scripts write to `.build/reviews/<task>/`). A quick test rejects tracked `reports/`, `references/`, `review/` and `assets/reviews/` paths.
- Ship `reports/` and `references/` archives are removed; do not recreate them or rename them into another tracked archive.
- Original asset collections: [asset index](../assets/README.md), [aircraft index](../assets/aircraft/README.md).
- Playable ship roster: [src/ships/presets.ts](../src/ships/presets.ts).

## Historical context

Finished plans, reviews, handoffs and dated measurement logs are in [archive/](archive/README.md). They explain
why things were built as they were; their commands, paths and status claims are as of each record's date. A past
validation pass does not validate today's build. `assets/reviews/` holds historical task evidence.

## Maintaining these docs

- Keep repository invariants and task routing in `AGENTS.md`; keep the production sequence in `ship-pipeline.md`.
- Put detailed contracts in their linked reference guide. Link to the canonical rule instead of copying long instructions into multiple files.
- Keep vessel-specific measurements and modeling decisions under that vessel's `assets/` directory. Keep research downloads and diagnostic output local under `.build/`.
- Document current commands from `package.json` and scripts. Distinguish automated checks from required visual review and historical-accuracy evidence.
- Keep historical status claims visibly dated. Avoid fixed fleet counts or a second preset roster in shared prose.

- [Accounts and custom multiplayer](accounts.md): Bun auth/storage, PostgreSQL roles, account recovery and immutable match content.
