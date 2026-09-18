# Ship construction with agents

Ship construction uses the custom editor and the shared Rust construction compiler.
Blender remains the permanent authoring tool for original reusable components.
Existing Blender-backed ships remain supported; migrating their hulls is separate work.
Both routes use the versioned blueprint/definition family in `src/ships/blueprint.ts`.

## Start and edit

```sh
bun install
bunx playwright install chromium
bun run multiplayer:prepare:dev
bun run ship:templates
bun run ship:new my-ship --template destroyer-hull --name "My ship"
bun run ship:edit my-ship
```

`ship:new` defaults to `destroyer-hull`. Adjustable presets are `patrol-hull`,
`destroyer-hull`, `battleship-hull` and `barge-hull`; each starts with one editable
`custom-hull`, a level deck and no equipment. `blank` retains the one-block starter;
`patrol` and `catamaran` retain the older armed sandbox layouts. `ship:templates`
lists choices and dimensions as JSON. These are original sandbox shapes.
The brief/reference approvals in the ship pipeline still apply to historical
vessels. A generic template does not establish historical accuracy.

`ship:edit` prints a loopback URL and runs until interrupted. It opens the existing
Shipbuilder directly, without preparing the harbor. `--port 5195` chooses a fixed
port. The repository source is `assets/ships/<id>/blueprint.json`; there is no
parallel ship document format. `build.py` and `source.blend` are unnecessary for
construction-backed ships.

The menu beside the design name provides Download backup, Reload repository and
Save local copy. Repository changes autosave to the source file.
External file changes update the preview while the browser has no pending edits.
Competing edits produce a visible conflict and preserve the unsaved browser draft.
Reload deliberately takes the file revision and retains the previous draft as an
undo step. Save local copy puts an independent design in the normal IndexedDB
library. Repository deletion remains a Git operation.

Select a gun in Fittings to change **Turret rise** or **Barbette paint**. Rise
extends its circular support above the deck. A turret well's integrated magazine
stays at its lower end; a deck mount's ready ammunition follows the raised gun.
Barbette paint applies to the whole generated support. The surrounding deck retains
its own finish. Both edits support undo.

Full funnel casings use oval below-deck uptake openings. The native compiler uses the same outline for deck cutting, clearance and sealed
flooding openings, including separate uptakes on trunked funnels, preserving the
surrounding deck. Guns with working wells and full funnels cut the deck;
deck-mounted light guns, the separate funnel cap, closed hatches, vents and
torpedo launchers do not.

Sea Trials transfers the exact draft to the game and uses the real native local
battle path. Returning reopens that source; combat damage never enters the file.
The normal local-design menu also imports downloaded JSON as a new local copy.

## Adjustable hull first

Prefer one adjustable `custom-hull` for the main hull, or one per hull for a
multihull. Edit its dimensions, sections, bow rake and bulb before fitting equipment.
Use freeform pieces for superstructure, appendages and geometry the adjustable hull
cannot represent. Record any main-hull exception in the ship README; do not default
to assembling a whole ship hull from many vertex pieces.

The UI's **Edit hull sections** and the agent source share exactly the same
`customHull.version: 1` data. `size` is `[beam, depth, length]` in metres;
`position` and `rotationDeg` place the whole hull. Section `t` runs from bow (0)
to stern (1). Each section has a stable ID and nine ordered cross-section points:
port deck down to keel (index 4), then up to starboard deck. Point X scales by
half the beam and point Y by depth. Retain left/right symmetry, point ordering
and existing IDs. Rust validates the physical solid; source edits do not certify fit.

Use `primitive-patch` for dimensions, rake, bulb and `customHull.redPaintY`
(hull-local metres; `null` disables the red coating). Use `hull-station` to change
one existing section's `t` or nine-point outline, and `hull-sections` for the UI's
4–24-section interpolation/simplification. Increasing count retains existing
sections. Changing section adjacency creates new panel IDs; old panel overrides
remain stored and new panels inherit side defaults. Inspect panel IDs again before
assigning armor. Equipment stays at its authored placement when the hull changes.

## Agent commands

```sh
bun run ship:inspect my-ship --source-only --panels
bun run ship:catalog my-ship --query gun
bun run ship:inspect my-ship --source
bun run ship:apply my-ship .build/refit-batch.json --dry-run
bun run ship:apply my-ship .build/refit-batch.json
bun run ship:export my-ship .build/my-ship-backup.json
bun run ship:import other-ship .build/my-ship-backup.json
bun run ship:compile my-ship
bun run ship:render my-ship
bun run ship:trial my-ship --seconds 15
```

Inspect returns the logical `revision`, the file's `fileRevision`, exact equipment
variants, native diagnostics and loading. `--source` includes the complete source.
`--source-only` reads the source and revisions without compiling and explicitly
returns `compiled: false`; it makes no launchability claim. `--panels` adds canonical
custom-hull panel IDs for armor/paint targeting. `ship:catalog` searches the design's
exact retained equipment catalog by ID, name or kind and returns dimensions,
capabilities and sockets. Do not substitute a current variant for a retained one.

`ship:apply --dry-run` applies the batch to a detached candidate and runs the native
compiler without changing the file or revision history. Invalid candidates exit
nonzero with diagnostics. An ordinary apply still permits physically invalid drafts
so agents can repair them over several transactions. A dry run does not reserve the
revision; a later apply must still pass both revision checks.

All command results are JSON; failed commands exit nonzero. Physically invalid
drafts remain inspectable/saveable, but cannot build or enter trials.

A batch applies as one transaction:

```json
{
  "version": 1,
  "expectedRevision": "<revision from inspect>",
  "expectedFileHash": "<fileRevision from inspect>",
  "label": "Move forward gun",
  "commands": [
    { "op": "move", "ids": ["gun-forward"], "delta": [0, 0, -1] }
  ]
}
```

The shared command implementation is `src/ships/constructionCommands.ts`.
Commands are:

| Operation | Fields | Behavior |
| --- | --- | --- |
| `name` | `name` | Rename the design |
| `skin` | `thicknessMm` | Set default structural skin |
| `primitive`, `equipment`, `boundary`, `load` | `value` | Add or replace the complete source record by stable ID |
| `primitive-patch`, `equipment-patch` | `id`, `changes` | Merge only supplied fields into an existing record; nested objects merge, arrays replace, `null` removes optional fields |
| `hull-sections` | `id`, `count` | Resize an adjustable hull's section list with the same 4–24-section interpolation/simplification as the UI |
| `hull-station` | `id`, `stationId`, `changes: {t?, points?}` | Edit one existing section while retaining its ID and other sections |
| `copy` | `copies: [{from,to}]`, optional `mirror` or `offset` | Copy hull pieces, equipment and loads using caller-supplied new IDs; preserve surfaces and remap copied magazine/engine links |
| `remove` | `ids` | Remove selected records; retain the last hull piece |
| `move` | `ids`, `delta: [x,y,z]` | Translate pieces, equipment, loads and boundary offsets |
| `rotate` | `ids`, `degrees` | Rotate hull/equipment around their own datums |
| `surface` | `value` | Assign a canonical source face's armor, paint or opening |
| `surface-patch` | `targets: [{primitiveId,face,panelId?}]`, `changes`, optional `mirror` | Change armor/material/paint/opening independently; mirror targets the opposite face/panel on the same primitive |
| `construction-version` | `version` | Set construction format 1 or 2 atomically with the equipment migration |
| `catalog` | `revision` | Adopt another retained parts-catalog revision; fitted variants must exist in it |
| `vertices` | `id`, `selection`, `delta`, optional `mirror`, `nearby` | Use the same freeform transformation as the UI |

`selection` is `{mode: "vertex" | "edge" | "face", index: number}`; `mirror` is
three booleans for the local X/Y/Z planes. Coordinate order and corner indexing
are documented in [freeform hulls](shipbuilding.md#freeform-hulls).
Rust remains authoritative for geometry, fit, loading and launch validity.

Recent editor features are source-authorable through these patches:

- Adjustable hulls: `size`, `customHull.rake`, `bulb`, `redPaintY` and `stations`.
- Balconies: `balcony.points` with stable IDs and per-edge `open`/`railing`/`wall`,
  plus `heightM` and `wallThicknessM`.
- Freeform edge treatments: `shaping` with `version: 1`, `edges`, `radius` and
  `style: "round" | "chamfer"` on a `vertex` primitive; `null` restores sharp edges.
- Guns: nested `gun` settings for turret rise, barbette paint, battery and arcs.
  Exact catalog variants retain their integrated ammunition and working spaces;
  current light deck mounts do not need an invented below-deck magazine.
- Fittings: fractional `bearingDeg`, instance `paint`, wall dimensions and linked
  mirrored windows/doors/portholes. Patching a linked wall updates its partner.
- Railing, rope and chain: `path.points` in equipment-local metres and `slackM`.
- Propulsion: `powerSourceId: null` removes an explicit engine override and restores
  native automatic assignment. Funnel capacity is pooled by the native compiler.

For example, these commands can be placed in the revision-guarded batch above:

```json
[
  { "op": "primitive-patch", "id": "hull", "changes": {
    "size": [14, 10, 130], "customHull": { "rake": 0.4, "redPaintY": -1.2 }
  } },
  { "op": "equipment-patch", "id": "gun-forward", "changes": {
    "gun": { "barbetteHeightM": 0.6, "barbettePaint": "naval-gray" }
  } }
]
```

`copy` defaults to a 1 m starboard offset, matching the UI. `mirror: true` reflects
across ship X=0 instead; move the copies in a subsequent command if needed.
Destinations must be new unique IDs. Boundaries are not copyable. Wall copies are
independent, matching the UI. Copying an engine and its linked propeller together
remaps the propeller's link; copying only the propeller retains its original link.

Native layout proposals are available without editing the ship:

```sh
bun run ship:suggest my-ship --parts <catalog-part-id>,<another-part-id> --out .build/layout.json
bun run ship:apply my-ship .build/layout.json --dry-run
bun run ship:apply my-ship .build/layout.json
```

Suggestions return diagnostics and a ready-to-apply batch with both expected
revisions. They add missing equipment families/variants using the existing native
placement solver; they do not generate a historical arrangement, reposition existing
fittings or create repeated copies of a fitted variant. Request at most 16 IDs;
connected paths must still be authored explicitly. Add an internal deck/floor before
requesting machinery in a curved hull; the solver needs a suitable flat support.
Proposal files never overwrite
existing files. Failed proposals return no applicable batch and exit nonzero.

Read again after a conflict; do not blindly replace an expected revision.
Replacing an existing file through `ship:import` requires
`--expect <fileRevision>`. Source export refuses to overwrite an existing backup.
Logical revisions protect browser commands; SHA-256 file revisions also detect
external editors that changed data without changing the revision string.
Atomic sibling replacement and a writer lock protect repository saves. The lock
cannot make an unrelated text editor participate in a transaction; a final content
check catches changes observed before replacement.

The development editor exposes `window.constructionEditor` with `source()`,
`result()`, `apply(batch)`, `flush()`, `undo()`, `redo()` and `launch()`.
`apply` uses `expectedRevision`; file-backed saves additionally use the
repository's current file revision. `await flush()` after a batch waits for its
save, including a batch submitted before React's next render. Wait for
`result().revision === source().revision` before inspecting or launching.

## Visual review and trials

```sh
bun run ship:render my-ship --view quarter --quick
bun run ship:render my-ship --part gun-forward --isolate --view profile
bun run ship:render my-ship --pose .build/poses.json --view quarter
bun run ship:render my-ship --published
bun run ship:trial my-ship --seconds 15
```

Render defaults to profile, plan, bow, stern and quarter orthographic views.
`--quick` skips the sampled articulation sweep for an iteration preview and records
that omission in JSON. It does not replace `ship:review` or model acceptance.
Rendering currently requires a valid compiled draft; use the editor's source
preview to inspect invalid geometry.
`--part` accepts an installed equipment ID or retained node ID. `--isolate`
hides other meshes. Pose files map gun mount IDs to
`{"trainDeg": 30, "elevationDeg": 20, "recoil": 0.5}`; native clearance resolves
the request before rendering and the output records any blocked movement.

Images, camera metadata, inspection data and sampled articulation results go to
`.build/construction/<id>/render/`. `--out` chooses another diagnostic directory.
Review actually opens the GLB for `--published`; source review composes the same
native surfaces and component models as the editor. The automated sweep includes
endpoint/intermediate train and elevation, recoil, and differently posed neighbors.
It compares retained muzzle transforms with CPU poses. Blocked samples are reported,
not silently treated as cleared travel. Sampling is not a proof of every pose or a
historical-fidelity certification; inspect the images and complete the four model
acceptance checks.

Trial advances the real local worker/WASM simulation with helm and firing commands,
then resets it. JSON includes source/hash, initial and final motion/ammunition,
result, and reset state. Duration is 1–120 simulated seconds. Trial output stays
under `.build/construction/<id>/trial/`.

## Build and publish

```sh
bun run ship:build my-ship
bun run ship:check my-ship
bun run ship:review my-ship
bun run ship:thumbnail my-ship
bun run ship:register my-ship
bun run build
```

The standard pipeline dispatches by the existing blueprint's construction source.
Construction builds compile through Rust, verify exact retained component bytes,
compose/export through Three.js, reload the candidate GLB and check articulation
before publishing. No Blender process runs for ship construction.

Outputs are `public/models/<id>.glb`, its compiled JSON and thumbnail, plus
`generated/build.json`, `generated/thumbnail/render.json` and the five fixed views
in `generated/review/`. The `construction-v2` build manifest separates compiled
definition, model recipe/input and presentation fingerprints. Every check runs
the native compiler; compiler source changes only invalidate an asset when its
consumed output changes. Model and presentation recipes follow transitive value
imports, ignoring comments and erased TypeScript types. Missing imports fail closed.

Published preset identity hashes the canonical compiled definition and actual
exported GLB payload, excluding only the scene/root identity tags to avoid a
circular hash. The native draft/build identity remains unchanged for player-design
admission. A fresh export is sealed with its published identity, then reloaded and
articulation-checked before publication. No retained stale GLB is patched to pass.
Exact numbers, array order, component identities and binary payload are preserved.

Lighting/camera changes refresh images without exporting geometry. Model recipe
changes trigger export, but identical output keeps its identity and bytes; image
stages reuse intact outputs when their visual inputs match. Unchanged valid builds
write nothing. Output hashes still detect corruption, and unknown/old manifests
require a real rebuild. `ship:compile` produces a provisional definition in staging;
only `ship:build` assigns the final model/definition identity.

Failed verification does not publish the candidate; mismatched output pairs fail
visibly. Changing the manifest format requires a one-time construction preset
rebuild, followed by `multiplayer:content`.

`ship:register` checks the built asset and adds one `preset(id)` roster entry to
`src/ships/presets.ts`. Run `multiplayer:content` (also included in `dev` and `build`)
to derive its runtime asset and menu metadata. Registration enables the game/model viewer and fleet checks;
it does not assert visual acceptance. Constructed presets use native volume
hydrostatics and do not need the legacy station-hull lookup table. Unregistered
drafts and browser player designs do not enter the trusted online manifest.

Blender is still used indefinitely by `part:build` and `part:publish` for original
reusable components. Follow [shared components](shared-components.md), preserve
variant identities and published datums, and publish new component revisions
before selecting them in construction sources.

## Validation and limits

`bun run ship:authoring:check` covers the tools' TypeScript and transaction tests.
`bun run ship:browser:check` runs the repository-authoring, IndexedDB, design
deletion and shipbuilder-editing checks in headed Chromium. It starts its own
loopback server, uses fresh browser storage, and keeps disposable repository
sources under ignored `.build/construction-browser/`; authored ships and account
libraries are untouched. Add `--headless` for CI. Failures exit nonzero and leave
a screenshot there; temporary sources and browser contexts are cleaned up.
`scripts/tests/construction-authoring-browser.ts` checks a disposable
`authoring-check*` source through the real editor, including immediate batch/save,
external refresh, conflicting saves and recovery through undo.
Run native construction acceptance tests and `bun run build` for integration.

Review/export uses Playwright Chromium, installed with the command above.
`CONSTRUCTION_CHROME` can select an existing compatible Chrome executable.
The editor/file API is loopback-only development tooling; it is absent from the
production server. Source and complexity limits remain those of the construction
compiler. Repository undo snapshots under `.build/construction/history/` are
scratch recovery; commit source revisions to Git for durable history.

### Freeform shape topology

`vertex` primitives may carry `mesh.version: 1` instead of `vertices`/`shaping`.
Use `editableMesh` from `src/ships/constructionMesh.ts` to convert a supported
native prism, wedge, corner, cylinder, cone or dome preset without changing its
surface. Half and quarter variants use the same contract. The shared `vertices`
command accepts `selection.mode: "ring"` as well as vertex/edge/face selections;
`primitive-patch` accepts the versioned mesh record. Original face IDs and mirror
references survive movement. Ring and outline insertion/removal are shared pure
source transformations. See the shipbuilding guide for bounds and validity rules.
