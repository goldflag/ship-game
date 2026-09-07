# Ship build and reference details

Use this reference when changing build/export code, troubleshooting stale outputs, configuring Blender, or preparing comparison evidence. Follow the [ship pipeline](ship-pipeline.md) for the required authoring order and [model review](ship-model-review.md) for visual acceptance.

- [Commands](#commands) and [Blender setup](#blender-setup)
- [Thumbnails](#thumbnails), [build lifecycle and locks](#build-lifecycle-and-locks), and [shared recipe inputs](#shared-recipe-inputs)
- [Repository layout](#repository-layout)
- [Source archive and LFS](#source-archive-and-lfs)
- [Comparison records and local output](#comparison-records-and-local-output)
- [Reference policy](#reference-policy)
- [Reference-stage setup and per-vessel configuration](../scripts/reference/README.md)
- [Integration and narrow rebuilds](integration-workflow.md)

## Commands

```sh
bun install
bun run ship:new my-ship          # Create an original starter; refuses existing directories
bun run ship:compile my-ship      # Validate JSON and compile into .build/ships/my-ship
bun run ship:build my-ship        # Build Blender source, export, validate, then publish locally
bun run ship:check my-ship        # Detect stale definitions/models and verify the exported GLB
bun run ship:review my-ship       # Render five repeatable orthographic review views
bun run ship:reference bismarck  # Refresh isolated game-model raster reference pack
bun run ship:compare bismarck    # Rebuild measurements, matched sheets and local page
bun run ship:independence bismarck # Full build with raw reference cache unavailable
bun run ship:thumbnail my-ship    # Bake the port card image from the validated runtime GLB
bun run test                     # Repository test runner
bun run build                    # Checks published presets, types and production bundle
```

## Blender setup

`BLENDER_BIN` overrides the executable. The default uses the standard macOS application if present, otherwise `blender` on PATH. The tested environment uses Blender 5.2, Bun 1.3.3, and the versions in `bun.lock`. No MCP connection is required for batch builds.

## Thumbnails

Port thumbnails are checked-in transparent 600 × 180 PNGs at `public/models/<ship-id>-thumbnail.png`. The carousel loads these images directly, including while the harbor is preparing. `ship:build` refreshes the thumbnail after publishing the validated model; `ship:thumbnail` refreshes it independently without rebuilding geometry. The original shared rendering recipe is `assets/ships/thumbnail.py`; camera settings and model, recipe and image hashes are recorded under `assets/ships/<ship-id>/generated/thumbnail/render.json`. `ship:check` rejects missing or stale thumbnails. After changing the presentation recipe, run `ship:thumbnail` for all affected presets. It has a separate hash so lighting or framing changes do not invalidate ship geometry. Blender renders the exported materials using Cycles; this is a studio model view rather than a capture of the ocean scene.

## Build lifecycle and locks

`ship:build` stages its output under `.build/ships/<id>/`. It publishes only after the geometry and articulation checks pass. Each destination is replaced with a complete temporary sibling; the GLB/JSON pair is guarded by a shared hash at runtime. A crash between replacements fails visibly rather than silently mixing versions. Run the build again to recover. Build logs stay in the staging directory.

Commands that write the same staging directory use a lock with process information. If a process is forcibly interrupted, confirm it has stopped before removing `.build/ships/<id>.lock`. Builds also reject authoring inputs that change while Blender is running. `ship:review` reads the retained generated Blender source and saves camera settings alongside its five images, so review works after a clean checkout.

## Shared recipe inputs

Presets may share original text recipes under `assets/` using an optional `recipe-inputs.json`: `{ "version": 1, "files": ["assets/ships/convoy/geometry-v2.py"] }`. The register and every listed file enter the content hash and the pre-publication change check. Reference folders, baselines and parent traversal are rejected. Rebuild each listed consumer when its shared recipe changes. Liberty Cargo, the machinery-aft Liberty Collier, Victory Cargo and the Cobalt-1941 Flower register the same original component recipe and plans-v2.json measurements; they retain separate versioned blueprints, compiled definitions and generated sources. Original schematic scans and provenance remain under assets/ships/convoy/references/plans/.

## Repository layout

```text
assets/
  parts/guns.json                  Reusable original gun specifications
  ships/<ship-id>/
    blueprint.json                Editable placement, hull parameters and gameplay volumes
    build.py                      Per-ship original Blender recipe
    README.md                     Configuration, evidence and modeling limitations
    modeling-spec.json            Optional reviewed dimensions, evidence and comparison parameters
    references/sources.json       Source provenance and what each reference supports
    references/                   Reference-only images; never shipped as game textures
    reports/                      Export validation and unresolved accuracy discrepancies
    generated/source.blend        Current generated, editable Blender source
    generated/review/              Fixed-camera review images
    generated/comparison/          Rebuildable local review output (ignored except build.json)
      build.json                  Tracked comparison input hash and output hashes
    baseline/                     Preserved original files when migrating an existing ship
scripts/ships/
  pipeline.ts                     Compilation, hashing, staging and GLB validation
  blender_components.py           Shared original gun geometry and articulation
  starter.py                      Minimal original hull recipe for new ships
  export.py                       Common batching, material bake and coordinate conversion
  review.py                       Repeatable inspection cameras
scripts/reference/                Isolated acquisition/capture and raster-only review stages
public/ship-reference/<ship-id>/   Served copy of the comparison page (ignored; written by ship:compare / ship:check)
public/models/<ship-id>.glb        Runtime visual model
public/models/<ship-id>.json       Compiled ship definition and content hash
src/ships/blueprint.ts             Versioned source/compiled types and input validation
src/simulation/                    Renderer-free weapons, movement and damage
```

Generated Blender sources and runtime files are retained with their recipes. Comparison renders, `.build/`, Blender backups and caches are ignored. The Bismarck baseline is preserved in this repository, so builds do not rely on `/Users/bill/models`.

## Source archive and LFS

Archival references, reports and captures use Git LFS according to [`.gitattributes`](../.gitattributes); text records remain in ordinary Git. The comparison input hash treats an LFS pointer as its content SHA-256, so asset checks can run without fetching the archive.

For historical inspection or Blender comparison builds, fetch the required originals with `git lfs pull` (scope the download to the needed paths when appropriate). Checkouts made with `GIT_LFS_SKIP_SMUDGE=1` contain pointers until the content is fetched. See [clone options](../README.md#cloning-without-the-asset-archive). Automated validation of pointers is not visual review of their contents.

## Comparison records and local output

Only `assets/ships/<id>/generated/comparison/build.json` is version controlled in the comparison directory. It records an input hash and expected output hashes. Rendered comparisons and the served `public/ship-reference/<id>/` copy are ignored.

The [reference checker](../scripts/reference/pipeline.ts) always verifies the record's input hash. When none of its recorded output files exists locally, the record alone can pass. When any exists, the complete recorded set must be present and match its hashes; valid local output is republished if needed. An incomplete or stale pack requires `bun run ship:compare <id>`, then `ship:check <id>`.

Current recipes do not produce ZIPs or duplicate GLBs. An old manifest that lists a missing ZIP can fail the completeness check when other recorded files are present; regenerate the comparison instead of editing hashes or fabricating files.

On a fresh clone, run `ship:compare <id>` before opening the review page. Port review links include only pages present when Vite starts/builds; restart/rebuild after publishing a new page. Open `/ship-reference/<id>/index.html` explicitly to avoid Vite's directory fallback. Blender renders remove date/time PNG chunks so identical pixels yield identical bytes.

## Reference policy

Prefer dated plans and documented dimensions for historical features. Record refit, equipment variant, game version, and loading condition separately. Other games' models can expose discrepancies, including shapes that are difficult to see in photographs. They may also differ from the intended historical configuration or share an inaccurate source.

For GameModels3D browser access, retain permitted comparison views and camera/configuration notes. For reference files available for this use, inspect them in a separate reference scene with documented scale and alignment. Do not trace their topology, retopologize/shrinkwrap from them, bake their textures, or include their meshes in our runtime assets. Reference art remains credited reference material. Resolve discrepancies against the source register; two matching game models are not automatically independent confirmation.

Bismarck now uses WoWS Bismarck ’41 `pgsb708`, with source/version recorded in `references/gamemodels3d/manifest.json`. `ship:reference` is the only stage that reads the raw game geometry under ignored `.build/reference-cache/`. It creates a disposable Blender scene, neutral captures, a contact sheet and a browsable index. Its single global registration preserves game-model proportions and leaves its load datum unverified. No game vertices, UVs, textures, offsets or attachment transforms enter the production recipe.

King George V uses the same workflow with `pbsb107` and 30 vessel-specific views. Its capture plan explicitly selects `A_Hull` and compatible artillery/AA/director components so later hull variants cannot replace an already assembled reference. The production model remains an independent early-1941 interpretation of the retained Vickers drawings.

For ships with `modeling-spec.json`, `ship:build` also runs `ship:compare`: measure the actual exported GLB, render it through the matched camera plan, register preserved historical rasters with one uniform scale, and generate sheets, overlays, sections, JSON measurements and a local HTML page. The page links the runtime GLB from `public/models`. See [comparison records and local output](#comparison-records-and-local-output) for retention, freshness checks and publishing, and [reference-stage setup](../scripts/reference/README.md) for comparison modes and per-vessel configuration.

`ship:independence` runs the full asset build with the raw cache moved away, restores it afterward and records the model hash. A Python audit hook additionally rejects raw model/cache paths, the preserved Bismarck baseline and authoring network connections; it records local authoring reads. The production recipe uses the blueprint, original component catalog and original geometry code only. This is an input-boundary check, not a general native-code sandbox. See [reference-stage setup and reuse](../scripts/reference/README.md) for Python/Pillow prerequisites and per-vessel parameters.
