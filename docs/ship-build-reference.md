# Ship build details

Follow the [ship pipeline](ship-pipeline.md) for authoring order and [model review](ship-model-review.md) for visual acceptance.

## Commands

```sh
bun run ship:new my-ship        # Create original starter inputs; refuses existing directories
bun run ship:compile my-ship    # Validate and compile into .build/ships/my-ship
bun run ship:build my-ship      # Reuse valid stages; rebuild and validate affected outputs
bun run ship:build all          # Fleet from src/ships/presets.ts
SHIP_JOBS=10 bun run ship:build all --force # Genuine rebuild; bypass every stage cache
bun run ship:check my-ship      # Check the definition, GLB and thumbnail
bun run ship:check all          # Check every registered playable preset
bun run ship:review my-ship     # Render the current five fixed review views
bun run ship:thumbnail my-ship  # Refresh the port card without rebuilding geometry
bun run test
bun run build
```

The archived `ship:reference`, `ship:compare` and `ship:independence` commands, modeling specifications and port reference pages have been removed. Reference research is part of authoring, not a build dependency. Do not recreate ship `reports/` or `references/` directories.

For standalone original equipment and the general model viewer, see [shared components](shared-components.md). `part:build` uses the same registered callable that ship recipes import; its generated previews stay in `.build/parts/`.

## Construction-backed ships

The standard ship commands dispatch construction sources to the custom
[construction pipeline](construction-authoring.md). These ships retain source JSON,
GLB/definition, thumbnail and fixed reviews; they do not produce `source.blend`.
Blender remains the reusable-component authoring tool and the backend for existing
legacy ship recipes. For a construction ship it is only an optional
[front end](construction-authoring.md#blender-front-end) whose output is a guarded batch.

## Blender setup

Use Blender MCP for the interactive authoring loop below. Batch generation, export, thumbnails and fixed review renders continue through the existing pipeline commands: `BLENDER_BIN` overrides the executable, with the standard macOS application or `blender` on PATH as defaults. Those commands start isolated Blender processes and do not require MCP or use the open interactive scene.

### Blender MCP authoring loop

For a new ship, complete the [brief and reference approval](ship-pipeline.md#start-a-new-ship-collaboratively) before ship-specific geometry or paint authoring. This loop is required for ship geometry and articulation work when MCP is available. Documentation-only, simulation-only and unchanged-asset checks do not require an interactive Blender session.

1. **Verify the live connection and scene.** Discover the tools exposed in this session; an installed server or configuration entry alone is not proof of a working connection. Make a read-only scene query first. Common [Blender MCP](https://github.com/ahujasid/blender-mcp) capabilities are `get_scene_info`, `get_object_info`, `get_viewport_screenshot` and `execute_blender_code`; use the actual exposed names and schemas. Identify the open file, ship, objects and scene units before editing. Check for unsaved work before opening or clearing a scene. Do not replace unrelated user work or share a mutable scene with another authoring task.
2. **Inspect the starting model and reference.** For an existing ship, inspect this worktree's current `generated/source.blend`; for a new ship, scaffold and build the starter first. Use a task-owned interactive scene; any scratch saves belong under `.build/ships/<id>/`. Query affected objects, dimensions, parent/joint relationships and pivots, then capture and actually inspect the viewport. Inspect the user-approved GameModels3D or War Thunder model/configuration, following the selected reference policy, in the source viewer or [local comparison app](../tools/ship-overlay/README.md). Verify configuration, scale and waterline before comparing. External game geometry is comparison-only and must not be imported into the original authoring scene or recipes.
3. **Make small changes and inspect them.** Use MCP to frame/isolate assemblies and execute focused Blender operations, including Python where appropriate. After each meaningful shape or attachment change, inspect fresh screenshots from relevant orthographic views and close-ups. Compare the turret, bridge and bow first, then fittings and mechanisms. Exercise moving assemblies through intermediate and neighboring poses. Correct visible mismatches before adding further detail; tool success or numeric bounds alone never counts as inspection. Temporary captures stay in `.build/`; do not accumulate tracked iteration files.
4. **Preserve accepted edits in source.** Implement the accepted result in `build.py`, declared shared recipes, the component catalog/blueprint, or a supported versioned original component asset that the recipe actually loads. Editing the generated scene or saving MCP's Python in a scratch file does not satisfy this step. Preserve stable IDs and coordinate conversion. Use the pipeline for recipe execution with its staging environment; do not assume the interactive process has `SHIP_OUTPUT` or `SHIP_DEFINITION` set. For a construction-backed ship the scene is a `ship:blender-import` scratch file and `blueprint.json` is the source: run `ship:blender-export`, dry-run and apply its batch, then continue from a fresh import ([Blender front end](construction-authoring.md#blender-front-end)); the saved `.blend` alone preserves nothing.
5. **Rebuild and inspect the result again.** Run `ship:build <id>` from the durable inputs. Reopen the newly generated scene through MCP, inspect affected assemblies again, and confirm the accepted changes survived. Then run `ship:review <id>`, inspect the fixed views, register a new built preset as described in the ship pipeline before comparing the actual exported GLB in the local app, and perform the required in-game articulation checks. If a change disappeared during rebuild, fix the recipe or original component input and repeat; never patch the published GLB or its hash to conceal it.

If MCP tools are absent, report that they are not exposed in this session. If a tool fails, report the actual connection/capability failure; do not claim Blender was inspected through MCP. Continue independent work and use local Blender plus inspected renders for the same edit–inspect–correct loop when needed. An agent-session refresh may be needed to expose a newly configured server. Summarize the actual tools used, inspected views/assemblies, remaining limitations and rebuild verification in the task response or PR. No additional tracked report is required.

## Repository layout

```text
assets/parts/                         Original reusable equipment and recipes
  guns.json                          Canonical versioned gun definitions
  library.json                       Variant discovery and explicit builders
  library.py                         Reusable mount entry point
scripts/parts/                       Standalone component build/check tooling
assets/ships/<ship-id>/
  blueprint.json                      Editable geometry parameters and gameplay data
  build.py                            Original Blender geometry recipe
  recipe-inputs.json                  Optional additional original recipe dependencies
  README.md                           Approved brief, source links and lasting limitations
  authoring/                          Optional reusable ship-specific authoring/check tools
  generated/source.blend              Current generated Blender scene
  generated/review/                   Current five fixed views and cameras.json
  generated/thumbnail/render.json     Thumbnail settings and hashes
  baseline/                          Explicitly retained original migration assets
scripts/ships/                        Shared build, geometry, export and review tools
public/models/<ship-id>.glb           Runtime visual model
public/models/<ship-id>.json          Compiled simulation definition and content hash
public/models/<ship-id>-thumbnail.png Port card image
.build/ships/<ship-id>/               Ignored staging, logs and diagnostic results
.build/                              Ignored temporary research/downloads/captures
```

Commit canonical inputs, current runtime exports, the generated Blender scene, current fixed views and thumbnail metadata. Preserve `assets/ships/bismarck/baseline/`. Do not commit reference downloads, report folders, full telemetry, extra copies of definitions/models, or per-iteration snapshots. Do not relocate the deleted archive into another tracked directory. Historical source comments and frozen baseline files can refer to removed archives; consult Git history when needed instead of restoring them as build dependencies.

## Thumbnails

Port thumbnails are transparent 600 × 180 PNGs. `ship:build` refreshes the thumbnail after publishing the validated model; `ship:thumbnail` refreshes it independently. The shared rendering recipe is `assets/ships/thumbnail.py`; camera settings and model, recipe and image hashes are in `generated/thumbnail/render.json`. `ship:check` rejects missing or stale thumbnails. The presentation recipe has a separate hash so lighting/framing changes do not invalidate geometry.

## Incremental builds and fingerprints

`ship:build` compiles and validates the blueprint every time. Fingerprints use
compiled data, canonical Python syntax (excluding comments/source locations),
canonical JSON, declared recipe inputs, and transitive local Python imports.
Compiler TypeScript source text, UI code, comments, review scripts and unused
library variants are not model inputs. Python 3 is required to fingerprint recipes.

| Change | Work performed |
| --- | --- |
| UI, comments, type-only schema/compiler edit with identical compiled output | Validation only; reuse source, model and thumbnail |
| Ship recipe or declared/transitive geometry/appearance dependency | Regenerate only its consumers, then export, validate and thumbnail |
| Geometry fields in the compiled definition, fitted equipment or selected builder | Regenerate affected ship, export, validate and thumbnail |
| Runtime-only definition fields such as handling | Reuse geometry; export the new definition identity, validate; reuse thumbnail |
| Exporter or its imported helpers | Reuse geometry; export, validate and thumbnail |
| Thumbnail recipe or its imported helpers | Reuse geometry/model; validate and render thumbnail |
| Missing/corrupt retained source or model | Regenerate that stage; intact independent stages can be reused |
| Deleted `.build/ships/` staging | Restore from verified retained outputs; no forced geometry rebuild |
| `--force` | Execute geometry, export, validation and thumbnail for every selected ship |

`fingerprints.ts` defines the explicit geometry input contract. Recipes receive
that projection, including inspection volumes; runtime-only fields are not
available to geometry recipes. Add a property to that contract when a recipe
starts consuming it. Fitted weapon definitions are conservative geometry inputs.
`recipe-inputs.json` remains the declaration for dynamic recipe/data reads; the
authoring audit rejects undeclared repository file reads. Transitive imports are
resolved within the repository, never from a blanket list of shared scripts.

`generated/build.json` records source/model stage identities and SHA-256 hashes
of their actual bytes. Reuse requires both matching inputs and intact bytes.
`ship:check` recompiles current inputs, checks model integrity and articulation,
and checks the thumbnail. It needs no staging cache or Blender process. Do not
edit manifests or embedded identities to make stale outputs pass.

The retained Blender source carries the geometry identity; the GLB and runtime
JSON share the full definition/export identity. A runtime-only change therefore
requires a real export, without regenerating the original scene. Thumbnails use
the visual model identity so a gameplay-only edit does not rerender the card.

Fleet jobs are bounded by `SHIP_JOBS` (1–18); builds default to the available logical CPUs, capped at 18 and a
2 GiB per-job memory allowance with 4 GiB reserved. Output is buffered per ship.
`timings.json`, per-process logs, read audits and `export-timings.json` in staging
record which stages executed, startup, geometry/appearance, visibility,
conversion, batching, export, validation and thumbnail durations.
`SHIP_PROFILE=1` additionally writes Python profiles and separate shared texture
times; the unprofiled geometry duration includes appearance and source saving.
Timing files are diagnostics, not cache-validity inputs. See [measured pipeline performance](ship-pipeline-performance.md).

## Build lifecycle and locks

`ship:build` stages output under `.build/ships/<id>/`. Geometry and articulation validation precede model publication. Each destination is replaced with a complete temporary sibling; the GLB/JSON pair is guarded by a shared hash at runtime. A crash between replacements fails visibly; run the build again to recover. Export diagnostics (`export.json`), authoring read audits and logs stay in staging. They are never required to run the game or check published assets.

Commands writing the same staging directory use a lock with process information. After an interrupted process, confirm it has stopped before removing `.build/ships/<id>.lock`. Builds reject authoring inputs that change while Blender is running. `ship:review` checks the retained Blender scene against the current geometry identity and writes the five fixed images plus camera settings.

The authoring audit rejects raw game model/cache paths, the Bismarck baseline and network access from Python recipes. Independent original geometry remains required; removing the reference archive does not permit importing third-party game geometry or textures.

## Shared recipe inputs

Presets may share original text recipes under `assets/` using optional `recipe-inputs.json`: `{ "version": 1, "files": ["assets/ships/convoy/geometry-v2.py"] }`. The register and listed files enter the content hash and pre-publication input check. Baselines, reference folders and parent traversal are rejected. Rebuild each declared consumer after changing a shared recipe.

Resolve authoring inputs first during integration, run `ship:check all`, then apply its narrow repair. See the [integration workflow](integration-workflow.md).
