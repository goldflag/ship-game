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

## Blender setup

`BLENDER_BIN` overrides the executable. The default uses the standard macOS application if present, otherwise `blender` on PATH. No MCP connection is required for batch builds. Discover available Blender MCP tools for interactive inspection; use local Blender when unavailable and state the tool actually used.

## Repository layout

```text
assets/parts/                         Original reusable equipment and recipes
assets/ships/<ship-id>/
  blueprint.json                      Editable geometry parameters and gameplay data
  build.py                            Original Blender geometry recipe
  recipe-inputs.json                  Optional additional original recipe dependencies
  README.md                           Configuration, source links and lasting limitations
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
