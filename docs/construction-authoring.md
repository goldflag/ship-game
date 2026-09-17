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
bun run ship:new my-ship --template patrol --name "My ship"
bun run ship:edit my-ship
```

`ship:new` defaults to a one-block construction source. Templates are `blank`,
`patrol` and `catamaran`; these are original sandbox layouts.
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
extends its circular support above the deck while the integrated magazine stays
at the lower end. Barbette paint applies to the whole fixed support; the deck
retains its own finish around the circular opening. Both edits support undo.

The Fletcher and capital-ship funnels use oval below-deck uptake openings. The
native compiler uses the same outline for deck cutting, clearance and sealed
flooding openings, preserving the surrounding deck. Guns and these two funnels
are the only current fittings that cut the deck; the separate funnel cap,
closed hatches, vents and torpedo launchers do not.

Sea Trials transfers the exact draft to the game and uses the real native local
battle path. Returning reopens that source; combat damage never enters the file.
The normal local-design menu also imports downloaded JSON as a new local copy.

## Agent commands

```sh
bun run ship:inspect my-ship --source
bun run ship:apply my-ship .build/refit-batch.json
bun run ship:export my-ship .build/my-ship-backup.json
bun run ship:import other-ship .build/my-ship-backup.json
bun run ship:compile my-ship
bun run ship:render my-ship
bun run ship:trial my-ship --seconds 15
```

Inspect returns the logical `revision`, the file's `fileRevision`, exact equipment
variants, native diagnostics and loading. `--source` includes the complete source.
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
| `remove` | `ids` | Remove selected records; retain the last hull piece |
| `move` | `ids`, `delta: [x,y,z]` | Translate pieces, equipment, loads and boundary offsets |
| `rotate` | `ids`, `degrees` | Rotate hull/equipment around their own datums |
| `surface` | `value` | Assign a canonical source face's armor, paint or opening |
| `construction-version` | `version` | Set construction format 1 or 2 atomically with the equipment migration |
| `catalog` | `revision` | Adopt another retained parts-catalog revision; fitted variants must exist in it |
| `vertices` | `id`, `selection`, `delta`, optional `mirror`, `nearby` | Use the same freeform transformation as the UI |

`selection` is `{mode: "vertex" | "edge" | "face", index: number}`; `mirror` is
three booleans for the local X/Y/Z planes. Coordinate order and corner indexing
are documented in [freeform hulls](shipbuilding.md#freeform-hulls).
Rust remains authoritative for geometry, fit, loading and launch validity.

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
bun run ship:render my-ship --view quarter
bun run ship:render my-ship --part gun-forward --isolate --view profile
bun run ship:render my-ship --pose .build/poses.json --view quarter
bun run ship:render my-ship --published
bun run ship:trial my-ship --seconds 15
```

Render defaults to profile, plan, bow, stern and quarter orthographic views.
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
in `generated/review/`. Source, compiler/producer identity and actual output bytes
determine freshness. Unchanged valid builds reuse output. Failed verification
does not publish the candidate; mismatched output pairs fail visibly.

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
