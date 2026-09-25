# Ship asset pipeline

**Source of truth:** versioned `blueprint.json` + original component catalog. New ships use the [custom construction editor and Rust compiler](construction-authoring.md); Blender remains the permanent tool for reusable components and may serve as an optional [front end](construction-authoring.md#blender-front-end) for a construction ship, whose only output is a revision-guarded batch (builds never run it). Existing legacy ships retain their original geometry recipes. These produce a compiled simulation definition and an articulated visual model. Historical presets and future player-built ships use this same contract.

Prefer an adjustable `custom-hull` for the main hull, using the shared section editor
or agent commands. Use one per hull for multihulls. Reserve freeform pieces for
additional structures and shapes that sections cannot represent; explain any
main-hull exception in the ship README. See [agent hull authoring](construction-authoring.md#adjustable-hull-first).

The workflow below documents Blender-recipe ships and the shared acceptance
requirements. A new Blender-recipe preset follows [Blender-recipe presets](#blender-recipe-presets):
`ship:new --legacy` scaffolds it and `ship:register` accepts it.
When the owner asks for a premade ship "using the Blender pipeline" or "like Yamato
or Bismarck", that is the path, and the custom-hull preference above does not apply.

## Read for your task

| Task | Required detail |
| --- | --- |
| New ship or geometry change | This workflow, [model review](ship-model-review.md), [coordinate/component contract](ship-runtime-contract.md#coordinate-and-component-contract), the [MCP authoring loop](ship-build-reference.md#blender-mcp-authoring-loop), and the ship's README |
| Combat, internals or equipment behavior | This workflow and the relevant [runtime contract sections](ship-runtime-contract.md) |
| Build or stale artifacts | [Build details](ship-build-reference.md) |
| Paint, decks or surface finish | [Shared appearance rules](ship-appearance.md), then the ship's approved brief |
| Merge or rebase | [Integration workflow](integration-workflow.md) |

Per-ship authoring inputs live under `assets/ships/<id>/`; reusable equipment lives in `assets/parts/guns.json`, with original builders and discovery metadata in the [shared component library](shared-components.md). The [asset layout](ship-build-reference.md#repository-layout) lists retained outputs and shared tools. Ship reports and reference archives have been removed. Research downloads and diagnostics stay in ignored `.build/`; do not recreate them in another tracked folder. Historical documentation may name removed files; it is not a current completion checklist.

## Start a new ship collaboratively

A prompt such as “create Iowa” starts a short briefing and reference-selection conversation. It does not authorize the agent to invent a sister ship, year, refit or camouflage. Reuse answers and approvals already present in the conversation or an existing approved ship README; ask only for missing decisions, normally in one batch of at most three questions:

| Decision | What to resolve |
| --- | --- |
| Vessel | Exact named ship/hull number, or which member of a requested class. If the user has no preference, propose one concrete candidate. |
| Appearance | Year/refit and paint/camouflage, markings and flags. Offer the source model's fit and visible paint as a concrete option when available; do not assume a requested year exists in that model. |
| Reference policy | Recommend **GameModels3D-only** for the initial experiment, or let the user choose **primary model plus selected supporting sources**. War Thunder is an alternative primary model when selected by the user. |

Research available model/configuration options while answers are pending so the choices are concrete. Do not start ship-specific geometry or paint authoring until the missing choices and reference proposal are approved. Continue tool checks, code inspection and other work that does not depend on those decisions.

### Reference proposal and approval

Inspect the candidate before asking the user to approve it. Present a compact proposal in the conversation with the exact source URL/vehicle ID, hull/equipment variant, intended vessel/year, clear previews and unresolved differences. Show side, top and front views plus only the close-ups needed to judge important fittings; use the original source viewer for paint/texture previews because the local comparison app replaces materials with cyan/amber. Do not ask the user to approve an unseen link list or a folder of downloads. A screenshot is useful only when the relevant shape, fitting or marking is legible at the intended inspection scale; reject grainy, tiny, obscured or mismatched material regardless of age or color. Do not collect historical photos simply to satisfy an evidence quota.

Offer these three items for the user to accept or correct:

- [ ] Vessel and fit: the exact ship, year/refit and reference hull/equipment variant, including any explicitly accepted mismatch.
- [ ] Paint: the shown scheme and markings, or the user's specified treatment; identify anything the source does not show.
- [ ] Reference coverage: the proposed model and any individually listed supplements are clear enough for the requested work; listed gaps or approximations are accepted or left unresolved.

Wait for explicit approval of the proposal (a reply such as “approved” is sufficient when unambiguous). Silence, a proposed default, or elapsed time is not approval. If a source is unavailable or fails the user's quality check, prepare a better candidate and return to this checkpoint. Do not silently substitute a sister ship, another game's model or a different fit. Ask again only for a material change to the approved vessel, appearance, source policy or reference set; routine corrections against the approved reference do not need repeated approval.

### Apply the approved reference policy

- **GameModels3D-only:** use the approved GameModels3D model/configuration as the sole external visual reference for geometry, equipment placement and any appearance it actually shows. Do not search for or download archival photos, plans or other models unless the user subsequently approves expanding the reference set. Acceptance measures fidelity to that approved model, with explicit agreed approximations; do not claim independently verified historical accuracy. This also applies to a user-selected War Thunder-only experiment.
- **Primary model plus selected support:** retain the approved GameModels3D or War Thunder model as the primary visual reference. Add only user-approved, legible plans, photographs or other sources that answer a specific missing detail. Explain any conflict with the primary model instead of silently mixing configurations. Historical-accuracy claims are limited to what the accepted evidence supports.
- **Unspecified or invisible details:** do not invent facts or treat a source's missing texture as permission to invent camouflage. Propose a concrete simplification, user-designed paint or additional source for approval. Keep unresolved details qualified. The source policy governs external reference research; existing original recipes/catalog components may still be reused where they match the approved fit. Gameplay values absent from the visual model use existing game conventions as explicitly provisional balancing assumptions, not claimed historical measurements; ask before expanding historical research for them.

Keep the approved decisions in the conversation until scaffolding, then add a short **Approved brief** section to the ship README: vessel/year/fit, paint, reference policy, accepted source links/configuration, and accepted approximations or unresolved limits. This is the durable handoff for a fresh session. Do not create a separate approval manifest, report, source register or tracked image archive. Approval previews and downloads stay in ignored `.build/`; keep only concise lasting decisions in the README.

## Author and publish a ship

Run commands from the repository root. Replace `my-ship` with the lowercase ship ID.

1. **Agree the brief and approve references.** Complete the [collaborative briefing and reference checkpoint](#start-a-new-ship-collaboratively) before historical geometry or appearance work. Inspect the accepted primary model/configuration, record known scale/waterline limitations, and follow the selected source policy throughout the task. Use the source viewer for reference approval and the [local comparison app](../tools/ship-overlay/README.md) once our model is built and registered.
2. **Scaffold only when new:** `bun run ship:new my-ship` for a construction ship, or `bun run ship:new my-ship --legacy` for a [Blender-recipe preset](#blender-recipe-presets). It refuses existing directories and creates a minimal starter, not a finished historical ship. Add the approved brief to its README after scaffolding; do not precreate the ship directory just to store the brief. Inspect the existing scene through the [authoring loop](ship-build-reference.md#blender-mcp-authoring-loop), with Blender MCP or background renders. For existing ships, inspect this worktree's `generated/source.blend`; for new ships, build the starter to get an inspectable scene.
3. **Iterate visually and author durable inputs.** Search `bun run part:list` and inspect matching components in `bun run model:viewer` before creating gun geometry. Reuse the exact registered variant through `assets/parts/library.py` and declare the dependencies from `part:inputs`; see [shared components](shared-components.md). Installed model previews are inspection-only, not source assets. Use MCP or background Blender for focused edits, object/pivot inspection and fresh screenshots after meaningful changes. Compare against the primary reference and correct visible mismatches before adding detail. Persist accepted interactive changes in source, then rebuild to verify they survive. Edit the blueprint for hull, mounts, protection, machinery, compartments and connections; reuse or extend catalog parts for distinct equipment. Edit `build.py` or a versioned original component asset for geometry. Generated-scene edits alone are lost on rebuild. Shared text recipes must be declared in [`recipe-inputs.json`](ship-build-reference.md#shared-recipe-inputs). Preserve stable IDs, joints and sockets. Use runtime meters, +Y up, -Z bow, +X starboard, waterline Y=0; apply the documented Blender conversion exactly once.
4. **Complete gameplay data.** Update internals and compartment containment after hull changes. Author applicable [local damage/fire profiles](ship-runtime-contract.md#local-damage-fires-and-combat-loss) and equipment extensions; inspect authoring-helper scope before running them. Combat behavior must come from definitions/components, with no ship-name branches. Author a wing secondary's `bearingDeg` as the centre of its beam arc, as before: side secondaries rest trained fore or aft automatically, clamped to that arc ([rest rule](gunnery.md#rest-and-idle-secondaries)).
5. **Compile and build:**
   ```sh
   bun run ship:compile my-ship
   bun run ship:build my-ship
   ```
   Compile validates inputs and writes staging data. Build runs isolated local Blender, validates the exported hull/joints/muzzles, and publishes matching `public/models/<id>.glb` and `.json`, retained Blender source and thumbnail. Export diagnostics stay in `.build/ships/<id>/export.json`. No reference archive or report folder is required. Read [build details](ship-build-reference.md) for hashes, locks and recovery.
6. **Register a new playable preset.** Run `bun run ship:register my-ship` to add one `preset('my-ship')` entry per line to [`src/ships/presets.ts`](../src/ships/presets.ts) (for a Blender-recipe preset it also reports the funnel mouths the smoke finds, and warns when a surface ship has none). Add the ship's type and nation to the identity table in [`src/game/shipModel.ts`](../src/game/shipModel.ts) yourself: the model viewer, the battle catalog and the port file ships by it, and `src/game/shipModel.test.ts` fails without it. Then run `bun run ship:hydrostatics` and `bun run multiplayer:content` to derive runtime assets and menu metadata. `ship:new` does not register it. Register after the first successful build and before comparison-app or in-game inspection: both discover ships through this roster. Registration makes the candidate inspectable; it is not visual acceptance. This is the authoritative runtime/fleet-check roster; do not duplicate it in package scripts or shared prose. See [runtime representation and loading](ship-runtime-performance.md) for the derived binary contract and measurements.
7. **Review the built geometry:** `bun run ship:review my-ship`. Reopen the rebuilt scene, through MCP or background renders, and verify accepted edits survived the clean build. Inspect all five fixed views plus close-ups, approved primary-model comparisons, with historical overlays only when the selected reference policy includes them; also inspect the actual exported GLB with the local comparison app. Complete every [visual acceptance check](ship-model-review.md): physical attachment, priority proportions, detailed exposed guns and clearance through articulation. Resolve known failures in authoring inputs, rebuild and repeat the affected checks.
8. **Verify in-game and finish.** Load the exact published ship/hash. Check full traverse/elevation/recoil, independently positioned neighboring mounts, fitted weapons, free aim, firing, hits, damage, flooding and reset. In port, inspect Armor and Internals, isolate a volume, return to Statistics, launch and return to port. Use the shared inspection/statistics adapters for new properties. Run the checks below and summarize results to the user. Update the ship README only for lasting configuration or limitation changes; leave raw results in `.build/`.

For national cloth ensigns and articulated sensors, see [ensigns and radar rigs](ship-runtime-contract.md#ensigns-and-radar-rigs).

## Blender-recipe presets

A premade ship built as a Blender recipe (Bismarck, Yamato, Iowa, King George V, Hood, Alaska) keeps its geometry in `build.py` and its gameplay data in `blueprint.json`. The steps above apply, with these differences.

**Layout.** `bun run ship:new my-ship --legacy [--name "Name"] [--part gun-part-id]` writes this layout from `scripts/ships/legacy-template/`, modelled on Alaska, and runs `author-blueprint.py` once. Its placeholder cruiser (loft, deckhouses, funnel, two turrets of `--part`, armour and rooms) compiles and builds, so there is a scene to inspect at once; replace every table with measured values. `recipe-inputs.json` starts with the part's `part:inputs` and the appearance files.

| File | Holds |
| --- | --- |
| `author-blueprint.py` | Writes `blueprint.json` from measured tables: hull stations, structures, mounts, armour |
| `build.py`, plus region modules on a large ship | The Blender geometry recipe |
| `appearance.json` | Material roles bound to named paints and finishes ([ship appearance](ship-appearance.md)) |
| `recipe-inputs.json` | Every shared recipe file the build reads, as `assets/` paths only, and the [catalog entries](ship-build-reference.md#shared-recipe-inputs) it reads under `records` |
| `README.md` | The approved brief, the build route and accepted approximations |

After the first successful build, `bun run ship:register my-ship` checks the published outputs, adds the ship's line to `src/ships/presets.ts` and reports its funnel mouths.

**Measuring.** Trace deck and deckhouse outlines with `ship:slice <ref> --plan <y> --sym --parts hull,misc,other`, and see the windows, doors and markings a GameModels3D reference paints into its textures with `ship:reference <ref> --render` ([reference workflow](reference-workflow.md)).

**Gameplay data, in order.** Run the authoring helpers once the hull and structures have settled, and always pass the ship ID: with no arguments, stability and damage control rewrite a fixed list of other ships.

1. Local damage: `bun -e "import { writeLocalDamage } from './assets/ships/author-local-damage.ts'; await writeLocalDamage(['my-ship'])"`. Its command line accepts registered ships only, and flood spaces need its regions. Do not rerun it on an existing ship: it rewrites committed calibration.
2. `bun assets/ships/author-flood-spaces.ts my-ship`
3. `bun assets/ships/author-stability.ts my-ship`. It fills `stability` only when absent; remove the field to recompute after a hull change.
4. `bun assets/ships/author-damage-control.ts my-ship` writes the shared fleet defaults over any existing `damageControl`.

**After the first build** of a new preset, register it, then run `bun run ship:hydrostatics my-ship` and `bun run multiplayer:content`. From then on, `ship:build` refreshes both itself. The hydrostatic table is keyed by the definition's content hash, and the game refuses a model whose definition version differs, so a stale table or stale content breaks loading.

**Traps.**

- Turret clearance (`mountClearance`) tests barrels against every `obstructions` box, not only the listed structures. One box around a stepped or L-shaped deckhouse freezes nearby mounts at rest; use fore-and-aft strips of 3 m or less.
- `ship:check` warns when two `structures` share a top plane that nothing above covers: the renderer z-fights there wherever the recipe draws the blocks, and hits pay two coincident plates. Trim one footprint, or end one block where the other begins. Admiral Hipper, Cleveland, Bismarck, Yamato, Alaska, King George V, Mogami and Enterprise predate the check.
- `surface.py` refuses a hull texture wider than 4096 px. Lower the hull binding's `pixelsPerMeter` for a long hull (Hood uses 15).
- A recipe can call the registered builders in `construction-library.json`: load `construction/geometry.py` as `sys.modules['geometry']` first and strip each object's `nodeId`. Library builders under `scripts/` cannot be declared in `recipe-inputs.json`; call `blender_components.create_gun_mount` instead.
- Declare `construction-library.json` and `construction.json` under `records` with the builder and part IDs the recipe uses, and read them through `catalog_records.catalog()` (Hood's `registered()` does). Listed under `files` they are hashed whole, and the ship goes stale whenever any part is published. `assets/parts/library.json` is already fingerprinted per fitted part.
- A GameModels3D reference is not centred on our midships (about 2.3 m on Iowa, 2.0 m on Alaska). `ship:overlay` measures the fore-and-aft offset (waterline half-breadths, then side and top silhouettes; within 3 cm of the hand-measured values) and prints it; pass it to any other comparison.
- GameModels3D paints windows and doors into its textures. Compare against a textured render before removing detail that seems absent from the geometry; Iowa lost its bridge windows this way.

**Attachment and clearance.** Run both after every geometry change; each exits 1 on a failure and writes its details to `.build/ships/<id>/`. They read the retained `generated/source.blend`, or the published GLB with `--glb` (construction ships always use the GLB).

- `bun run ship:floating <id>` searches out from the hull through touching parts (intersecting, within 6 cm, or embedded) and lists every part or cluster it never reaches, by assembly. Merged rail and wire meshes count as attached but carry nothing (`--leaf`).
- `bun run ship:sweep <id>` poses every mount through its installed traverse, elevation and recoil against the fixed ship and the other mounts at rest, then neighbouring mounts against each other, and replays each contact through the simulation's interlock resolver. A contact the interlocks stop first is covered; one the mount can reach fails. `--mounts main-*` narrows it while iterating; a whole ship takes a few minutes.

**Handling.** Run `bun run ship:trial <id> --vs` after any hull, draft, mass, screw, rudder or steering-room change, including an accuracy pass that re-seats the hull. It compiles the working blueprint (no build needed), runs the native maneuvering trial on it and on the definition published at `origin/master` (or `--vs <ref>`), and prints both with the change; it exits 1 when top speed, hard-turn speed as a share of top, hard-turn rate or time to turn 90° gets more than 10% worse (the [handling gate](maneuvering.md#handling-trial-and-gate)). A legacy ship without authored screws infers one at 0.6 × draft whose wash reaches the steering-room rudder: King George V's re-seat moved the two 0.7 m closer and her hard-turn speed fell from 71% to 27% of top speed, which no other check caught. Fix a regression in ship data (steering room, screws, draft). Never tune `handling.maxYawRate` to pass the gate: it also sets the port's turning circle and maneuverability score (`src/ships/statistics.ts`), and reverting it costs a full `ship:build`. A gain that follows from the corrected hull is kept and explained in the PR.

**Review.** The overlay comparison found most proportion errors on Hood and Alaska. `bun run ship:overlay my-ship` renders the published GLB and the ship's suggested reference (cached with `ship:reference` if needed; `--reference` picks another) from the same orthographic camera, ours-only red and reference-only blue, as side, top, front, bridge and aft shots with IoU in `summary.json`, all under `.build/ships/<id>/overlay/`. `--box x0,y0,z0,x1,y1,z1` adds views clipped to a region, and `--camera` takes a `ui:shot` pose (`bowQuarter`, `az,el[,m]`). Add close views of the bridge glazing and of the underwater stern (screws, rudders, shafts) to the fixed views; distant views hide both.

**Subagents.** Lessons from the Iowa, Yamato, Hood and Alaska builds of September 2026, which each took about two hours from request to PR:

- One agent builds the skeleton: hull lines, blueprint, first `build.py` and comparison tools. They share one frame and one set of measurements. A new ship is best done by that agent alone.
- Region agents pay off only for detail passes on a large ship, and only after a foundation commit: one recipe module per region, a shared vocabulary module, and a written brief with an ownership table (files, structure IDs, mounts) and absolute tool paths. Use three or four; Iowa's six cost almost three times a single-agent build and finished no sooner.
- Region modules run in the recipe's shared globals, so each wraps its work in a function. The `git:setup` merge driver merges blueprint edits by record ID (mounts, structures, compartments); expect overlapping, coplanar blocks at region seams.
- Each worktree agent spends 5–10 minutes bootstrapping. Tell agents to commit early and often, so work survives a rate limit or a stopped agent.
- Finish with one agent auditing what no region owns: glazing, screws and rudders, rigging ends, underwater fittings and close views.
- `ship:build` holds a per-ship lock, and parallel Blender builds contend for CPU and disk. Check free disk space before launching worktree agents.

## Required visual acceptance checks

All four checks in [ship model review](ship-model-review.md) are required for new models and affected geometry: **no floating parts; turret/bridge/bow proportions faithful to the approved reference and configuration; intricate exposed guns; no turret clipping.** Known defects block visual acceptance. Successful export checks do not certify any of these visual requirements or historical accuracy.

## Validation by change

| Change | Required verification |
| --- | --- |
| Blueprint, simulation or equipment behavior | Relevant simulation tests, `bun run build`; rebuild affected models when definitions/hashes change; exercise changed behavior in-game |
| Hull, draft, mass, screws, rudders or steering room (any accuracy pass) | `ship:trial <id> --vs` within the [handling gate](maneuvering.md#handling-trial-and-gate), fixed in ship data rather than `handling.maxYawRate`; then the model rows below |
| Model geometry or articulation | `ship:build <id>`, `ship:review <id>`, `ship:check <id>`, `ship:floating <id>`, `ship:sweep <id>`, all affected visual checks and in-game articulation; relevant simulation tests and `bun run build` |
| Shared catalog, compiler or geometry recipe | `ship:check all`; rebuild every affected/stale asset, then repeat relevant model/runtime checks |
| Thumbnail presentation only | `ship:thumbnail <id>` for affected presets, inspect thumbnails, `ship:check all` and `bun run build` |
| Reference research only | Present a new or materially changed reference set for approval; update concise accepted source links and lasting limitations in the ship README. Keep downloads and captures local. |

`bun run test` is the repository test runner; use focused tests while iterating. `bun run build` runs ship/aircraft asset checks, TypeScript and the production bundle. Do not run model-loading tests while a build publishes those same assets. After integration, use `bun run ship:check all` and apply the [narrow repair it requests](integration-workflow.md#during-conflict-resolution).

Keep the single current fixed-camera set in `generated/review/`. Additional close-ups, overlays, command output and articulation diagnostics belong in `.build/`; do not copy blueprints, compiled definitions or old model versions into tracked review folders. Keep approximations explicit in the ship README; GameModels3D-only comparisons do not establish historical accuracy; unsupported details remain qualified.
