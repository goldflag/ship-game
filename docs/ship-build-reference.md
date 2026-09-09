# Ship build details

Follow the [ship pipeline](ship-pipeline.md) for authoring order and [model review](ship-model-review.md) for visual acceptance.

## Commands

```sh
bun run ship:new my-ship        # Create original starter inputs; refuses existing directories
bun run ship:compile my-ship    # Validate and compile into .build/ships/my-ship
bun run ship:build my-ship      # Generate, export, validate and publish locally
bun run ship:check my-ship      # Check the definition, GLB and thumbnail
bun run ship:check all          # Check every registered playable preset
bun run ship:review my-ship     # Render the current five fixed review views
bun run ship:thumbnail my-ship  # Refresh the port card without rebuilding geometry
bun run test
bun run build
```

The archived `ship:reference`, `ship:compare` and `ship:independence` commands, modeling specifications and port reference pages have been removed. Reference research is part of authoring, not a build dependency. Do not recreate ship `reports/` or `references/` directories.

For standalone original equipment and the general model viewer, see [shared components](shared-components.md). `part:build` uses the same registered callable that ship recipes import; its generated previews stay in `.build/parts/`.

## Blender setup

Use Blender MCP for the interactive authoring loop below. Batch generation, export, thumbnails and fixed review renders continue through the existing pipeline commands: `BLENDER_BIN` overrides the executable, with the standard macOS application or `blender` on PATH as defaults. Those commands start isolated Blender processes and do not require MCP or use the open interactive scene.

### Blender MCP authoring loop

For a new ship, complete the [brief and reference approval](ship-pipeline.md#start-a-new-ship-collaboratively) before ship-specific geometry or paint authoring. This loop is required for ship geometry and articulation work when MCP is available. Documentation-only, simulation-only and unchanged-asset checks do not require an interactive Blender session.

1. **Verify the live connection and scene.** Discover the tools exposed in this session; an installed server or configuration entry alone is not proof of a working connection. Make a read-only scene query first. Common [Blender MCP](https://github.com/ahujasid/blender-mcp) capabilities are `get_scene_info`, `get_object_info`, `get_viewport_screenshot` and `execute_blender_code`; use the actual exposed names and schemas. Identify the open file, ship, objects and scene units before editing. Check for unsaved work before opening or clearing a scene. Do not replace unrelated user work or share a mutable scene with another authoring task.
2. **Inspect the starting model and reference.** For an existing ship, inspect this worktree's current `generated/source.blend`; for a new ship, scaffold and build the starter first. Use a task-owned interactive scene; any scratch saves belong under `.build/ships/<id>/`. Query affected objects, dimensions, parent/joint relationships and pivots, then capture and actually inspect the viewport. Inspect the user-approved GameModels3D or War Thunder model/configuration, following the selected reference policy, in the source viewer or [local comparison app](../tools/ship-overlay/README.md). Verify configuration, scale and waterline before comparing. External game geometry is comparison-only and must not be imported into the original authoring scene or recipes.
3. **Make small changes and inspect them.** Use MCP to frame/isolate assemblies and execute focused Blender operations, including Python where appropriate. After each meaningful shape or attachment change, inspect fresh screenshots from relevant orthographic views and close-ups. Compare the turret, bridge and bow first, then fittings and mechanisms. Exercise moving assemblies through intermediate and neighboring poses. Correct visible mismatches before adding further detail; tool success or numeric bounds alone never counts as inspection. Temporary captures stay in `.build/`; do not accumulate tracked iteration files.
4. **Preserve accepted edits in source.** Implement the accepted result in `build.py`, declared shared recipes, the component catalog/blueprint, or a supported versioned original component asset that the recipe actually loads. Editing the generated scene or saving MCP's Python in a scratch file does not satisfy this step. Preserve stable IDs and coordinate conversion. Use the pipeline for recipe execution with its staging environment; do not assume the interactive process has `SHIP_OUTPUT` or `SHIP_DEFINITION` set.
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

## Build lifecycle and locks

`ship:build` stages output under `.build/ships/<id>/`. Geometry and articulation validation precede model publication. Each destination is replaced with a complete temporary sibling; the GLB/JSON pair is guarded by a shared hash at runtime. A crash between replacements fails visibly; run the build again to recover. Export diagnostics (`export.json`), authoring read audits and logs stay in staging. They are never required to run the game or check published assets.

Commands writing the same staging directory use a lock with process information. After an interrupted process, confirm it has stopped before removing `.build/ships/<id>.lock`. Builds reject authoring inputs that change while Blender is running. `ship:review` checks the retained Blender scene against the current definition and writes the five fixed images plus camera settings.

The authoring audit rejects raw game model/cache paths, the Bismarck baseline and network access from Python recipes. Independent original geometry remains required; removing the reference archive does not permit importing third-party game geometry or textures.

## Shared recipe inputs

Presets may share original text recipes under `assets/` using optional `recipe-inputs.json`: `{ "version": 1, "files": ["assets/ships/convoy/geometry-v2.py"] }`. The register and listed files enter the content hash and pre-publication input check. Baselines, reference folders and parent traversal are rejected. Rebuild each declared consumer after changing a shared recipe.

Resolve authoring inputs first during integration, run `ship:check all`, then apply its narrow repair. See the [integration workflow](integration-workflow.md).
