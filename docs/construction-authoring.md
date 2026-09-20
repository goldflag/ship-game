# Ship construction with agents

Ship construction uses the custom editor and the shared Rust construction compiler.
Blender remains the permanent authoring tool for original reusable components.
Existing Blender-backed ships remain supported; migrating their hulls is separate work.
Both routes use the versioned blueprint/definition family in `src/ships/blueprint.ts`.

## The agent loop

```sh
bun run ship:summary my-ship                      # one screen: revisions, conventions, headroom, rows
bun run ship:get my-ship --ids gun-forward        # exact records; ship:bounds and ship:near answer where
bun run ship:schema --op move                     # the batch contract; ship:place and ship:reseat propose batches
bun run ship:apply my-ship batch.json --dry-run --brief
bun run ship:apply my-ship batch.json
bun run ship:inspect my-ship --brief              # every independent error, with gaps and seat positions
bun run ship:view my-ship --focus gun-forward     # works on drafts that do not compile
```

Read narrowly, edit through guarded batches, let the native compiler judge, then look. Misspelled
flags and malformed commands fail without changing anything. The same commands are Model Context
Protocol tools; see [MCP server](#mcp-server).

## Start and edit

```sh
bun install
bunx playwright install chromium
bun run multiplayer:prepare:dev
bun run ship:templates
bun run ship:new my-ship --template fletcher-hull --name "My ship"
bun run ship:edit my-ship
```

`ship:new` defaults to `fletcher-hull`. Adjustable presets are `bismarck-hull`
and `king-george-v-hull` (battleships), `admiral-hipper-hull` and `baltimore-hull`
(cruisers), and `fletcher-hull` and `yukikaze-hull` (destroyers). Generic starters
are also available: `patrol-hull`, `destroyer-hull`, `battleship-hull` and
`barge-hull`, each with eight sections and a level deck. Each preset starts
with one editable `custom-hull` and no equipment. Ship-based presets preserve
the source game's length, beam, waterline and deck sheer. `blank` retains the one-block starter;
`patrol` and `catamaran` retain the older armed sandbox layouts. `ship:templates`
lists choices, source ships and dimensions as JSON.

These are reduced, editable versions of our original in-game hulls, not complete
historical ships. Their blueprint sections are sampled to at most 16 stations,
at least 4% of the hull length apart, with nine outline controls. Short end
transitions are simplified instead of crowding the controls. Bismarck and King
George V use broader end caps to remove needle tips; very thin end caps extend
downward to remain editable. Regenerate the shared data after
changing a source hull with `bun scripts/construction/hull-presets.ts` (or use `--check`
to verify freshness). Saved designs retain their own versioned sections and are
not changed by a template update. The brief/reference approvals in the ship
pipeline still apply when authoring a new historical vessel.

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

Select a gun in Armament to change **Turret rise**. Rise extends its circular
support above the deck. A turret well's integrated magazine stays at its lower
end; a deck mount's ready ammunition follows the raised gun. The whole generated
support wears the turret's `paint`, or the ship paint (`construction.paint`) under
an unpainted turret. The surrounding deck retains its own finish.

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
`position` and `rotationDeg` place the whole hull. Optional `tilt: {version: 1, pitchDeg, rollDeg}` adds pitch and roll; local axes rotate in YXZ order. Section `t` runs from bow (0)
to stern (1). Each section has a stable ID and an ordered cross-section outline:
port deck down to the keel (the middle point), then up to starboard deck. Every
section of one hull uses the same odd point count, 5–33 (`src/ships/customHullTopology.ts`);
presets start with nine. Outlines with other counts carry a `contour` position per
point on the 0–8 outline scale (keel 4), mirrored about the keel and equal across sections.
Point X scales by half the beam and point Y by depth. Retain left/right symmetry, point ordering
and existing IDs. Rust validates the physical solid; source edits do not certify fit.

Use `primitive-patch` for dimensions, rake, bulb and `customHull.paintBands` (or legacy `redPaintY`)
(hull-local metres; `null` disables the red coating). Use `hull-station` to change
one existing section's `t` or outline (keep the hull's point count; to change the count, replace
every section's `points` in one `primitive-patch` of `customHull.stations`), and `hull-sections` for the UI's
4–24-section interpolation/simplification. Increasing count retains existing
sections. Changing section adjacency creates new panel IDs; old panel overrides
remain stored and new panels inherit side defaults. Inspect panel IDs again before
assigning armor. Equipment stays at its authored placement when the hull changes.

## Reading a design cheaply

A finished ship is large: Valiant's source is about 130 KB, `ship:inspect` about 800 KB and
`--source` more. Read in this order and stop as soon as the question is answered:

```sh
bun scripts/construction/cli.ts summary my-ship
bun scripts/construction/cli.ts get my-ship --ids gun-forward,hull --fields position,bearingDeg,size
bun scripts/construction/cli.ts bounds my-ship --kind gun
bun scripts/construction/cli.ts near my-ship --point 0,8,-40 --radius 6
bun scripts/construction/cli.ts near my-ship --between gun-forward,bridge
```

None of these compile. Each returns `revision` and `fileRevision`, so a result can seed a
guarded batch directly. Output is JSON with one record per line.

| Command | Returns |
| --- | --- |
| `summary` | Coordinate conventions, hull-piece bounds, used/limit/free for every source limit, hull pieces as `[id, kind, position, size, rotation, surface assignments]` rows, equipment as kind → catalog part → `id: [x, y, z, bearingDeg]`, boundaries and loads. Deck fittings list IDs only unless `--positions` or `--kind deck-fitting`; `--no-positions` lists IDs everywhere. `--kind` keeps one hull-piece or equipment kind. `--compile` adds launchability, diagnostics, loading totals and derived surface/flooding-portal usage |
| `get` | Exact source records from any table. Selectors `--ids`, `--kind`, `--part`, `--prefix` intersect; `--fields` projects (the ID is always kept); `--surfaces` adds the face assignments of selected hull pieces. An unknown ID fails and lists the closest IDs |
| `bounds` | Axis-aligned boxes in ship coordinates: hull pieces from their size, rotation, tilt and section or vertex controls; equipment from the catalog dimensions around its datum, turned by its bearing, including wall sizing, path points and turret rise; part working spaces as `occupancy`. No selector lists hull pieces and loads; `--all` adds every equipment row. Boundaries return their plane |
| `near` | Records whose box lies within `--radius` of `--point`, or intersects `--box x0,y0,z0,x1,y1,z1`, nearest first (`--limit`, default 25; `--kind`). `--between idA,idB` gives the per-axis gap between two boxes; negative is overlap depth |

Boxes are source-level estimates. `approximate: true` with `why` marks a conservative or
incomplete box: curved and sloped shapes use their size envelope, adjustable hulls their section
controls, guns and launchers their stowed pose, and parts turned off the ship axes the box around
the turned part. Use them to choose positions and find neighbours, then confirm with
`ship:apply --dry-run`; only the native compiler decides fit, support and clearance.

The query implementation is `src/ships/constructionQuery.ts`. Use `ship:inspect --source` only
when a whole-source read is needed.

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

Measuring a real vessel to build against — caching a reference mesh, slicing it for deck heights and hull
stations, and reading its mount positions — is [the reference workflow](reference-workflow.md)
(`ship:reference`, `ship:slice`, `ship:hardpoints`).

Inspect returns the logical `revision`, the file's `fileRevision`, exact equipment
variants, native diagnostics and loading. `--source` includes the complete source.
`--source-only` reads the source and revisions without compiling and explicitly
returns `compiled: false`; it makes no launchability claim. `--panels` adds canonical
custom-hull panel IDs for armor/paint targeting. `ship:catalog` searches the design's
exact retained equipment catalog by ID, name or kind and returns dimensions,
capabilities and sockets. Do not substitute a current variant for a retained one.
`ship:inspect --brief` keeps the revisions, launchability, table counts, loading totals and
diagnostics and drops the per-equipment and per-mass rows. `ship:catalog` also accepts
`--kind <kind>`, `--ids id,id` (unknown IDs list the closest) and `--brief` (ID, name, kind,
placement and dimensions; no sockets or model data).

`--brief` on a dry run keeps the loading totals and drops the per-item mass contributions
(about 60 KB on a bare hull). `ship:apply --dry-run` applies the batch to a detached candidate and runs the native
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

The shared command implementation is `src/ships/constructionCommands.ts`. Command
shapes are declared once in `src/ships/constructionCommandSchema.ts`; the runtime
validator, the patch tables and the JSON Schema derive from it, and tests fail when the
TypeScript types drift from it.

```sh
bun run ship:schema              # JSON Schema (draft 2020-12) of a batch, plus conventions
bun run ship:schema --op move    # one command and the records it references
```

Every command is shape-checked before the first one applies: unknown `op`, unknown or
missing fields, wrong types, non-finite numbers and `null` on a required field are
rejected, and nothing is saved. Shape only: a physically invalid draft still applies and
the native compiler judges it. Errors name the zero-based command index, the op, the
JSON path within that command and the offending value or ID, with close matches:

```text
Command 3 (move): delta[1] must be a finite number, got null
Command 0 (rotate): degrees is required
Command 7 (remove): unknown source ID "gun-fwd"; closest: "gun-forward"
Command 2 (primitive-patch): result is not a valid source: Custom hulls require 4–24 sections
Batch: label is required
```

In code the error is a `ConstructionCommandError` with `commandIndex`, `op`, `path`
and `value`; the CLI prints its message as `{"error": …}`.

Commands are:

| Operation | Fields | Behavior |
| --- | --- | --- |
| `name` | `name` | Rename the design |
| `skin` | `thicknessMm` | Set default structural skin |
| `ship-paint` | optional `paint` | Set the ship paint worn by faces without an assignment and by fittings (with their barbettes) without a `paint`; omission restores naval gray faces and original fitting finishes |
| `primitive`, `equipment`, `boundary`, `load` | `value` | Add or replace the complete source record by stable ID |
| `primitive-patch`, `equipment-patch` | `id`, `changes` | Merge only supplied fields into an existing record; nested objects merge, arrays replace, `null` removes optional fields |
| `fitting`, `fitting-patch` | `value`; `id`, `changes` | Add, replace or patch a design-local fitting definition ([Custom fittings](#custom-fittings)); `solids` and `tubes` replace whole |
| `hull-sections` | `id`, `count` | Resize an adjustable hull's section list with the same 4–24-section interpolation/simplification as the UI |
| `hull-station` | `id`, `stationId`, `changes: {t?, points?}` | Edit one existing section while retaining its ID and other sections |
| `copy` | `copies: [{from,to}]`, optional `mirror` or `offset` | Copy hull pieces, equipment and loads using caller-supplied new IDs; preserve surfaces and remap copied magazine/engine links |
| `remove` | `ids` | Remove selected records; retain the last hull piece. A custom fitting definition is refused while instances outside the command use it |
| `move` | `ids`, `delta: [x,y,z]` | Translate pieces, equipment, loads and boundary offsets |
| `turret-rise` | `id`, `heightM` (0–30) | Set a gun's rise above its deck attachment; `position` Y moves by the change, as the editor's **Turret rise** does |
| `rotate` | `ids`, `degrees` (required) | Add `degrees` to each hull piece's `rotationDeg` and each fitting's `bearingDeg` about their own datums; wall fittings are skipped |
| `surface` | `value` | Assign a canonical source face's armor, paint or opening |
| `surface-patch` | `targets: [{primitiveId,face,panelId?}]`, `changes`, optional `mirror` | Change armor/material/paint/opening independently; mirror targets the opposite face/panel on the same primitive |
| `surface-remove` | `targets: [{primitiveId,face,panelId?}]`, optional `mirror` | Remove face assignments so the faces inherit again (panel from its side, side from the ship paint and default skin). Each named target must hold an assignment; the mirrored one is removed when present. Stale panel overrides are removable |
| `construction-version` | `version` | Set construction format 1 or 2 atomically with the equipment migration |
| `catalog` | `revision` | Adopt another retained parts-catalog revision; fitted variants must exist in it |
| `vertices` | `id`, `selection`, `delta`, optional `mirror`, `nearby` | Use the same freeform transformation as the UI |

`selection` is `{mode: "vertex" | "edge" | "face", index: number}`; `mirror` is
three booleans for the local X/Y/Z planes. Coordinate order and corner indexing
are documented in [freeform hulls](shipbuilding.md#freeform-hulls).
Equipment `bearingDeg` is clockwise seen from above (0 bow, 90 starboard); a hull piece's
`rotationDeg` is yaw about +Y, counter-clockwise seen from above. `rotate` adds the same
number to both.
Rust remains authoritative for geometry, fit, loading and launch validity.

Recent editor features are source-authorable through these patches:

- Adjustable hulls: `size`, `customHull.rake`, `bulb`, `paintBands`, legacy `redPaintY`, `stations`
  and `bilgeKeels` (`null` removes the keels).
- Balconies: `balcony.points` with stable IDs and per-edge `open`/`railing`/`triple-railing`/`wall`,
  plus `heightM` and `wallThicknessM`.
- Freeform edge treatments: `shaping` with `version: 1`, `edges`, `radius` and
  `style: "round" | "chamfer"` on a `vertex` primitive; `null` restores sharp edges.
- Guns: nested `gun` settings for battery and arcs; use `turret-rise` for rise.
  Exact catalog variants retain their integrated ammunition and working spaces;
  current light deck mounts do not need an invented below-deck magazine.
- Fittings: fractional `bearingDeg`, instance `paint`, wall dimensions and linked
  mirrored windows/doors/portholes. Patching a linked wall updates its partner.
- Railing, rope, chain and ladders: `path.points` in equipment-local metres, `slackM`, railing
  `heightM`/`railCount` and ladder `access` settings.
- Propulsion: `powerSourceId: null` removes an explicit engine override and restores
  native automatic assignment. Funnel capacity is pooled by the native compiler.

For example, these commands can be placed in the revision-guarded batch above:

```json
[
  { "op": "primitive-patch", "id": "hull", "changes": {
    "size": [14, 10, 130], "customHull": { "rake": 0.4,
      "paintBands": { "version": 1, "bands": [
        { "id": "lower-hull", "upperY": -1.2, "paint": "red-oxide" },
        { "id": "waterline", "upperY": -0.7, "paint": "boot-top-black" }
      ] }
    }
  } },
  { "op": "turret-rise", "id": "gun-forward", "heightM": 0.6 }
]
```

`position` is the turret datum and `gun.barbetteHeightM` is the support generated below
it. `turret-rise` changes both, so the deck attachment stays where it was. Patching
`gun.barbetteHeightM` alone keeps the gunhouse still and moves the attachment instead,
detaching the gun from its deck height. The batch has no catalog: `turret-rise` does not
check that the ID is a gun, and it does not perform the editor's version-1 magazine conversion.

Every source field of a hull piece or fitting except `id` is patchable; a test compares
the patch tables with the types in `src/ships/blueprint/constructionTypes.ts`. `null` is
accepted only on optional fields.

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

### Placing equipment

Do not compute equipment heights by hand. The compiler rejects an attachment more than
5 cm from its support (5 mm for wall fittings and fitted gun bases), decks are sheered
and `position` is the part's retained datum, not the centre or base of its bounds.
`ship:place` and `ship:reseat` resolve the seat against the hull the native compiler
builds, then compile the exact candidate before returning it. Like `ship:suggest` they
never save: they print a guarded batch for `ship:apply`, `--out` refuses to overwrite,
and the exit code is nonzero when there is no launchable proposal.

```sh
bun run ship:place my-ship --part us-5in38-mk30-mod0-single --at 0,-35 --id gun-a --out .build/gun.json
bun run ship:place my-ship --part generic-twin-bitts --at 3.2,-20 --bearing 90 --mirror --repeat 3 --step 0,8
bun run ship:place my-ship --part generic-diesel-3000kw --at 0,15 --on machinery-floor
bun run ship:place my-ship --part generic-watertight-door --at 3.4,10 --y 2.95 --mirror
bun run ship:reseat my-ship --all --out .build/reseat.json
bun run ship:reseat my-ship --ids gun-a,mast-fore --slide
```

Coordinates are ship metres: +X starboard, +Y up, −Z bow. `--at x,z` is the datum of
the new record and `--bearing` is clockwise from the bow. X and Z are kept exactly; only
the coordinate along the part's attachment direction is solved:

| Part | Seat |
| --- | --- |
| Deck parts (guns, launchers, funnels, masts, directors, deck fittings) | Y, so the `attachment` socket lies on the support under (x,z); a gun's `barbetteHeightM` is included. Topmost exposed surface by default, so a point under a deckhouse lands on its roof. |
| Internal parts (engines) | Y, on the inner face of the bottom plating by default (lowest), raised until all four base corners clear a curved or V floor; `residualM` is how far the datum then floats. Internal decks are supports: name one with `--on <boundary id>`. |
| Rudders | Y, below the hull bottom above (x,z). |
| Propellers | Y, 0.65 diameters below the hull above (x,z), the editor's rule; the compiler derives shaft and struts. Not touched by `reseat`. |
| Wall fittings (doors, windows, portholes, vents, hardware) | Along the wall normal. `--y` (datum height) is required; without `--bearing` the fitting faces out of the nearest hull side. Installed at catalog size, upright; patch `wall` afterwards to resize or turn. |
| Sideways fittings without a wall mount (stowed anchor, vertical ladder) | Along the socket direction; `--y` and `--bearing` are required. |

`--y` selects the support nearest that datum height instead of the outermost one;
`--on <id>` restricts supports to one hull piece or internal deck. Faces covered by
another piece and faces marked open are not supports. `--mirror` adds the exact
reflection across X=0 (bearing negated, IDs `…-starboard`/`…-port`, wall fittings linked
through `wall.mirrorId` as the editor does) and reports the twin's own `residualM`; a
twin more than 5 cm off its support is an error, so place each side separately on an
asymmetric hull. A centreline request stays single. `--repeat n --step dx,dz` seats
each copy on its own support (IDs `…-1`, `…-2`; at most 64 copies, 128 equipment records
per design). Connected fittings (railings, ropes, ladders with a path) have no single
seat; write their points with an `equipment` command. `place` does not set
`magazineId` or `powerSourceId`; patch them afterwards in a version-1 design.

`reseat` takes each record to its **nearest** support along its attachment direction
and reports `from`, `position`, the signed `gapM` found (negative was buried, positive
floated) and the support piece, face and slope. Records within 1 mm are left alone, so
a valid design yields no batch. Wall fittings only reach as far as the editor's wall
snap (0.75 × their larger dimension); a linked twin follows its partner. With `--slide`
a record with nothing under it moves sideways to the closest support, 1 cm inside its
edge. Under `--all`, a record without a seat is a warning and the rest are still
proposed; when the candidate then stops at an error on a record the batch does not
touch, the batch is returned with `candidate.unverified` and a nonzero exit code.

Limits: only the attachment point is seated. Whether the whole body fits (a gun base
across a deck edge, a door taller than its wall, an engine wider than the hull) is
decided by the candidate compile, whose diagnostics are returned in `candidate`.
Batches contain only `equipment` and `equipment-patch` commands.

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

## Custom fittings

When the catalog lacks a small part (a bollard, locker, davit, pipe run or light mast), define it
inside the design instead of building it from hull pieces, which would become armored, buoyant,
floodable structure. A definition is a set of hull-piece shapes (`solids`) and swept round `tubes`
in fitting-local metres; the local origin at y = 0 seats on the deck. It adds mass only: shells,
armor, modules and flooding ignore it. The format is in
[shipbuilding](shipbuilding.md#custom-fittings).

- `fitting` adds or replaces a whole definition; `fitting-patch` merges fields (`solids` and
  `tubes` replace whole). Every instance follows a change.
- An instance is an `equipment` row with `partId: "design:<definition id>"`. Seat it with
  `ship:place --part design:<id>`; `--mirror`, `--repeat`, `ship:reseat`, `copy`, `move`, `rotate`
  and `remove` work as for catalog deck fittings. Instances have their own limit of 512 and never
  count against the 128 equipment instances.
- `remove` with a definition ID is refused while instances outside that command use it; the error
  names them.
- `ship:summary` lists definitions as `[id, name, solids, tubes, massKg, instances, partId]` and
  reports `customFittingInstances` and `customFittingDefinitions` headroom. `ship:get --ids
  <definition id>` or `--kind custom-fitting` returns definitions, and `ship:catalog <ship> --query
  design:` shows the resolved size and bounds centre.
- `ship:view --focus <instance> --isolate` frames one instance.

A twin bollard (chamfered base, two posts with black caps, a cross bar) and a davit whose arm, stay
and fall are tubes:

```json
{
  "version": 1,
  "expectedRevision": "<revision>",
  "expectedFileHash": "<fileRevision>",
  "label": "Define custom fittings",
  "commands": [
    { "op": "fitting", "value": {
      "id": "fit-bollard-a", "name": "Twin bollard", "version": 1, "attach": "deck", "material": "steel", "fill": 0.35,
      "solids": [
        { "id": "base", "kind": "vertex", "size": [1.3, 0.12, 0.5], "position": [0, 0.06, 0], "rotationDeg": 0,
          "shaping": { "version": 1, "edges": [2, 6, 10, 11], "radius": 0.05, "style": "chamfer" } },
        { "id": "post-port", "kind": "cylinder", "size": [0.32, 0.62, 0.32], "position": [-0.38, 0.43, 0], "rotationDeg": 0 },
        { "id": "post-stbd", "kind": "cylinder", "size": [0.32, 0.62, 0.32], "position": [0.38, 0.43, 0], "rotationDeg": 0 },
        { "id": "cap-port", "kind": "cylinder", "size": [0.42, 0.08, 0.42], "position": [-0.38, 0.78, 0], "rotationDeg": 0, "paint": "boot-top-black" },
        { "id": "cap-stbd", "kind": "cylinder", "size": [0.42, 0.08, 0.42], "position": [0.38, 0.78, 0], "rotationDeg": 0, "paint": "boot-top-black" }
      ],
      "tubes": [{ "id": "cross-bar", "points": [[-0.38, 0.55, 0], [0.38, 0.55, 0]], "diameterM": 0.07 }]
    } },
    { "op": "fitting", "value": {
      "id": "fit-davit", "name": "Radial davit", "version": 1, "attach": "deck", "massKg": 420,
      "solids": [
        { "id": "socket", "kind": "cylinder", "size": [0.45, 0.3, 0.45], "position": [0, 0.15, 0], "rotationDeg": 0 },
        { "id": "block", "kind": "box", "size": [0.16, 0.22, 0.16], "position": [0, 2.85, -0.9], "rotationDeg": 0, "paint": "boot-top-black" }
      ],
      "tubes": [
        { "id": "arm", "diameterM": 0.16,
          "points": [[0, 0, 0], [0, 2.2, 0], [0, 2.433, -0.031], [0, 2.65, -0.121], [0, 2.836, -0.264], [0, 2.979, -0.45], [0, 3.069, -0.667], [0, 3.1, -0.9]] },
        { "id": "stay", "points": [[0, 1.2, 0], [0, 2.95, -0.55]], "diameterM": 0.05 },
        { "id": "fall", "points": [[0, 2.74, -0.9], [0, 1.5, -0.9]], "diameterM": 0.03, "paint": "boot-top-black" }
      ]
    } }
  ]
}
```

Edges 2, 6, 10 and 11 of a `vertex` block are its four top edges. The davit arm reaches along
local −Z, so bearing 90 swings it out to starboard.

```sh
bun run ship:apply my-ship .build/fittings.json
bun run ship:place my-ship --part design:fit-bollard-a --at 3,-30 --mirror --id bollard-fwd --out .build/bollards.json
bun run ship:place my-ship --part design:fit-bollard-a --at 4,10 --bearing 90 --repeat 4 --step 0,8 --mirror --id bollard-row --out .build/row.json
bun run ship:place my-ship --part design:fit-davit --at 4.6,0 --bearing 90 --mirror --id davit --out .build/davits.json
```

Limits: 32 definitions, 48 solids and 16 tubes each, about 20,000 triangles, tubes of 2–64 points
up to 100 m and 0.01–2 m across. A `custom-fitting` diagnostic names the definition in `sourceId`
and the solid, tube or instance in its message; a floating instance reports the usual
`equipment-attachment` with `fit.gapM` and `fit.seatPosition`.

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
Rendering requires a valid compiled draft; use `ship:view` to look at an invalid one.
`--part` accepts an installed equipment ID or retained node ID. `--isolate`
hides other meshes. Pose files map gun mount IDs to
`{"trainDeg": 30, "elevationDeg": 20, "recoil": 0.5}`; native clearance resolves
the request before rendering and the output records any blocked movement.

Images, camera metadata, inspection data and sampled articulation results go to
a directory unique to the call under `.build/construction/<id>/render/`, printed in the
result, so concurrent agents keep separate evidence. `--out` chooses another diagnostic directory.
Review actually opens the GLB for `--published`; source review composes the same
native surfaces and component models as the editor. The automated sweep includes
endpoint/intermediate train and elevation, recoil, and differently posed neighbors.
It compares retained muzzle transforms with CPU poses. Blocked samples are reported,
not silently treated as cleared travel. Sampling is not a proof of every pose or a
historical-fidelity certification; inspect the images and complete the four model
acceptance checks.

### Looking while you work: `ship:view`

```sh
bun run ship:view my-ship                                           # quarter view, exterior
bun run ship:view my-ship --view profile,plan --mode armor
bun run ship:view my-ship --focus gun-forward,bridge --highlight gun-forward
bun run ship:view my-ship --focus engine-1 --isolate --azimuth 120 --elevation 25 --perspective
bun run ship:view my-ship --mode internals --section x=0 --view profile
bun run ship:view my-ship --mode ids --region -8,0,-40,8,20,-10
```

`view` is exploratory and never replaces `ship:render`/`ship:review`. It works on a
draft that does not compile: JSON then carries `fallback: true`, the diagnostics and
`invalidIds`, and the image is the editor's source preview — native faces when the
compiler still produced them, source solids otherwise — with the pieces and fittings
named by an error drawn salmon. A valid exterior is the same composed model
`ship:render` draws. JSON always includes `revision`, `fileRevision` and `contentHash`.

| Flag | Meaning |
| --- | --- |
| `--view a,b` | `profile`, `plan`, `bow`, `stern`, `quarter` (default); several names give several PNGs from one browser session |
| `--azimuth deg`, `--elevation deg` | Camera bearing from the ship (bow 0°, starboard 90°, stern 180°) and height above the horizon (−90…90); overrides that part of a single preset |
| `--focus id,id` | Frame these primitive, equipment or boundary IDs (union bounds plus margin). `--isolate` hides everything else |
| `--region x0,y0,z0,x1,y1,z1` | Frame a box in ship metres (+x starboard, +y up, −z bow) |
| `--zoom f`, `--perspective`, `--size WxH` | Magnify the framing; 35° perspective instead of orthographic; image size up to 3200x2400. Without `--size` the image is at most 1600x1000 and one side shrinks to the framing |
| `--mode exterior\|armor\|internals\|ids` | `armor`: the editor's thickness colours; `legend` lists the scale and each thickness in mm with its colour. `internals`: translucent hull with machinery, magazines, boundaries, CG and CB. `ids`: one flat colour per primitive and equipment ID; `legend.visible` maps colour → ID with pixel count and `pixelBox` |
| `--section x\|y\|z=value` | Clip at a plane, keeping the half away from the camera; `x<0` or `x>0` names the kept half |
| `--highlight id,id` | Tint the IDs magenta and box them through the ship |
| `--out dir` | Default is a new `.build/construction/<id>/view/<file revision>-<time>/` per call, so concurrent calls never overwrite each other |

Each view reports its file, `camera` (position, target, up, right, projection,
`worldUnitsPerPixel` and the world-to-pixel formula), `framedBounds`, the bounds of
every focused ID, the section kept and the mode legend. A negative first number needs
the space form: `--region -8,0,…`. Gun poses are the defaults; use `ship:render --pose`
for posed mounts.

Trial advances the real local worker/WASM simulation with helm and firing commands,
then resets it. JSON includes source/hash, initial and final motion/ammunition,
result, and reset state. Duration is 1–120 simulated seconds. Trial output stays
in a directory unique to the call under `.build/construction/<id>/trial/`.

## Iteration latency and warm sessions

`bun run ship:timings <id>` measures each phase of the loop and checks that every compiler
path returns identical bytes. Measured 2026-09-19 (Apple silicon, other work running; ms):

| Phase | Valiant | Resolute |
| --- | --- | --- |
| Native compile through `cargo run` (previous path) | 2693 | 1289 |
| Native compile, example binary run directly | 2541 | 969 |
| Same, warm `--serve` process, first / repeat request | 2484 / 2293 | 970 / 813 |
| Same source and compiler again (result cache) | 44 | 30 |
| Vite start / Chromium launch / review page load | 130 / 143 / 627 | 113 / 143 / 743 |
| Compose model / each view / close | 1192 / 210 / 31 | 930 / 154 / 29 |
| One view in a cold browser, all phases | 2334 | 2111 |
| One view through a warm session | 1405 | 1134 |
| `inspect` or `apply --dry-run`: before / now / repeated revision | 2694 / 2543 / 44 | 1291 / 971 / 30 |
| `render --quick`, five views: before / now / warm session / warm and repeated revision | 5869 / 5718 / 4387 / 2289 | 4025 / 3706 / 2609 / 1787 |

What the numbers decided:

- The native compile dominates and its geometry cache does not help natively: a repeat request
  reuses 4726 operations on Valiant and saves under 0.3 s, because room and path solving
  (`room_plane_faces`, about 40 % of samples) is not cached. A warm compiler process is therefore
  not worth starting for compile latency alone.
- Commands recompile the same revision repeatedly (`inspect`, `render`, `view`, `trial`). Results are
  cached in `.build/construction/compile-cache/` by compiler build, catalog revision and exact
  source text (eight entries, least recently used removed). `CONSTRUCTION_COMPILE_CACHE=off` disables it.
- The example binary runs directly when `.build/construction/compiler-stamp.json` proves it fresh:
  every input in Cargo's dep-info (Rust sources, embedded assets, manifests, lockfile) must be
  older than the start of the `cargo build` that produced it. The check costs about 1 ms; a stale
  binary is rebuilt first, and anything unverifiable (custom target directory or `RUSTFLAGS`,
  inputs edited during the build, missing dep-info) uses `cargo run` as before. Only a binary
  proven fresh reads or writes the result cache.
- A warm browser saves about 1 s per browser command. Composition, not start-up, is the larger cost.

```sh
bun run ship:session start            # [--idle-minutes 30] [--no-browser]
bun run ship:session status
bun run ship:session stop
bun scripts/construction/check-session.ts valiant   # cold and warm bytes, PNG hash, killed-daemon fallback
```

A session is opt-in and per worktree: one daemon on `127.0.0.1` with a random port and a bearer
token in `.build/construction/session.json` (mode 0600), log in `session.log`. It keeps one
`compile_construction --serve` process, one review server and one Chromium; each browser request
gets a fresh context and page, and requests run one at a time in arrival order. It exits after the
idle timeout, when its own sources change (`scripts/construction/{session,session-daemon,compiler,browser,server,files}.ts`,
`package.json`, `bun.lock`), or on `stop`. Before every compile it repeats the binary freshness
check and restarts only the compiler process after a rebuild; review TypeScript is served by Vite
and needs no restart.

Fallback guarantees: `compileConstruction`, `suggestConstruction` and `withConstructionBrowser` use a
session only after a probe bounded at 500 ms confirms the file's version, worktree, source
fingerprint, live pid and token. A missing, stale or foreign file, a crashed or hung daemon, a
compiler the daemon cannot vouch for, a compile error, or a page that fails to open all run the
cold path, which also produces the error message. `CONSTRUCTION_SESSION=off` ignores sessions.
Cold and warm compiler output, the profile PNG and the inspection JSON are byte-identical on
Valiant (`check-session.ts`).

Bun cannot attach Playwright to a remote Chromium, so the daemon holds the page. In a session the
`page` given to `withConstructionBrowser` forwards `page.evaluate` only, with arguments and results
as JSON; any other member throws and names the `CONSTRUCTION_SESSION=off` escape.

The repository save lock (`.build/construction/<id>.lock/owner.json`) records its pid and time.
A lock whose process is gone, or that is older than 30 s, is taken over; a live holder still
returns the conflict error.

## MCP server

`bun run ship:mcp` serves every construction command as a tool over stdio; the repository's
`.mcp.json` registers it as `ship-construction`. Each tool is one CLI command run as a child
process, so names (`ship_summary`, `ship_apply`, `ship_view`, …), flags and results are exactly
those above: `--dry-run` is the boolean `dry_run`, `--ids a,b` the string `ids`. `ship_apply` and
`ship_import` take the JSON document inline as `batch` or `source`. Unknown arguments are rejected
before anything runs. PNGs named in a result are attached as images, text beyond 60,000 characters
is cut with a pointer to the narrower reads, and calls run one at a time. Tools that write the
repository are marked destructive; `edit` and `timings` are not served. A live warm session is used
automatically.

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

### Diagnostics

Every compile (`ship:inspect`, `ship:apply --dry-run`, `ship:suggest`, the editor)
returns `diagnostics: [{ severity, code, message, sourceId?, relatedSourceIds?, fit? }]`.
A ship is launchable only with no `error`. Optional fields are absent, never null.

One compile reports every independent fault it can reach, at most 32 per phase.
A fitting reports only its first fault. The phases run in order and a failed phase
stops the ones after it:

1. Source: counts over a limit (each with its count), invalid or duplicate IDs
   (each named), then every bad fitting paint or barbette height, primitive,
   surface assignment (with the reason), boundary and load.
2. Hull pieces: every piece whose shape fails, then every detached piece
   (`relatedSourceIds` names a piece of the group it is not joined to).
3. Boundaries that miss the interior, ballast and loads that do not fit.
4. Fittings and gun installations together: attachment, fit, overlap, links,
   weapon data, then barbette and magazine support for guns without a fault. A
   faulty fitting stays in place as an obstacle, so a neighbor that overlaps it is
   reported too.
5. Gun clearance at the initial pose, for every mount.

A closing `checks-skipped` warning lists the phases that did not run; their
silence is not a pass. Geometry budget, subdivision, loading and stability faults
describe the whole ship and carry no `sourceId`.

`sourceId` is the hull piece, fitting, boundary or load at fault.
`relatedSourceIds` lists the other instances involved: the overlapped fitting, the
engine named by a power link, the mounts drawing on a magazine. `fit` measures a
failed support, attachment or clearance check; the same numbers are in `message`:

| Field | Meaning |
| --- | --- |
| `gapM` | Metres from the attachment datum to the nearest support along the socket direction. Positive floats clear of it, negative is buried in it. When nothing lies on the socket line, the distance to the nearest support |
| `toleranceM` | Tolerance the gap was tested against: `0.05` attachment, `0.005` fitted base |
| `nearestSupportId` | Hull piece that owns that support. Absent for internal structure |
| `seatPosition` | Equipment `position` that closes the gap. It fixes this fault only; the next compile checks the rest |
| `penetrationM` | Depth of the overlap with the hull along the seating axis, or the shallowest extent of the overlap with `relatedSourceIds[0]` |

`equipment-attachment`, the hull-overlap form of `equipment-fit` and the
unconnected-collar form of `installation-support` carry a seat;
`equipment-overlap` carries the other fitting and the depth. Volume faults state
the cubic metres outside free interior and where. A gun floating 0.8 m and one sunk
0.5 m report in one compile as `gapM: 0.8` and `gapM: -0.5`, each with its
`seatPosition`.

`ship:suggest` accepts a draft whose only faults name fittings. It sets those
fittings aside for support geometry, accepts a placement only if the draft without
them compiles and the full draft gains no new fault, and returns a
`suggestion-draft` warning listing them in `relatedSourceIds`. They are returned
unchanged. Hull, boundary, ballast and load faults still refuse the suggestion.

### Freeform shape topology

`vertex` primitives may carry `mesh.version: 1` instead of `vertices`/`shaping`.
Use `editableMesh` from `src/ships/constructionMesh.ts` to convert a supported
native prism, wedge, corner, cylinder, cone or dome preset without changing its
surface. Half and quarter variants use the same contract. The shared `vertices`
command accepts `selection.mode: "ring"` as well as vertex/edge/face selections;
`primitive-patch` accepts the versioned mesh record. Original face IDs and mirror
references survive movement. Ring and outline insertion/removal are shared pure
source transformations. See the shipbuilding guide for bounds and validity rules.
