# Ship construction with agents

Ship construction uses the custom editor and the shared Rust construction compiler.
Blender may be used as an optional authoring front end for a construction ship: its only output is
a revision-guarded batch ([Blender front end](#blender-front-end)). Builds never run Blender and
`blueprint.json` stays the only durable source. Blender remains the permanent authoring tool for
original reusable components. Existing Blender-backed ships remain supported; migrating their hulls
is separate work. Both routes use the versioned blueprint/definition family in `src/ships/blueprint.ts`.

## The agent loop

```sh
bun run ship:summary my-ship                      # one screen: revisions, conventions, headroom, rows
bun run ship:get my-ship --ids gun-forward        # exact records; ship:bounds and ship:near answer where
bun run ship:schema --op move                     # the batch contract; ship:place and ship:reseat propose batches
bun run ship:apply my-ship batch.json --dry-run --brief
bun run ship:apply my-ship batch.json
bun run ship:inspect my-ship --brief              # every independent error, with gaps and seat positions
bun run ship:mesh my-ship shape.obj --id hangar --at 0,6,-18  # a closed mesh as one compound-solid hull block
bun run ship:fitting-mesh my-ship bridge.glb --id fit-bridge --mass 40000 --out bridge.json  # any mesh as visual detail
bun run ship:view my-ship --focus gun-forward     # works on drafts that do not compile
bun run ship:blender-import my-ship               # optional: edit in Blender, then ship:blender-export
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
downward to remain editable. `bun run ship:build <id>` of a source ship rewrites the shared
data and rebuilds the construction presets (Valiant, Resolute) whose model inputs include it;
commit all three with the ship. By hand: `bun scripts/construction/hull-presets.ts` (`--check`
verifies freshness). Saved designs retain their own versioned sections and are
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
torpedo launchers do not. A well whose top stops within 1 cm below the deck still
crosses it: seating arithmetic and lofted plating land fractions of a millimetre
below a deck plane, and a well that did not cut it left a skin-thin lid the later
checks could not measure. Platforms (`balcony`), including their walls and railings,
are decorative and contribute no structural mass, buoyancy, armor, flooding volume or
runtime collision geometry. They remain visible and can seat deck-mounted light guns
and fittings. A balcony may float: it needs no contact with the hull. A balcony that does
touch the hull still carries a hull piece standing on it, as saved designs rely on. Working wells still need real hull or
deckhouse interior beneath them; a balcony does not provide that interior or create a
simulated deck penetration.

### Floating fittings

Non-structural deck equipment needs no support under it: catalog and custom deck fittings,
masts, and light deck-mounted guns without a working well (under 100 mm, or no occupancy).
They add mass, or a ready-ammunition module at their datum, and nothing in the simulation
depends on what is beneath them, so a searchlight may stand on a mast's own platform and a
float may hang beside a deckhouse. Their datum must stay within `FLOAT_MARGIN_M` (10 m) of
the hull's bounding box; further out is an `equipment-attachment` error, because it is almost
always a mistyped position. Guns with wells, torpedo launchers, directors, funnels,
machinery, rudders, propellers, wall fittings and paths keep their support rules.

### Parents

An equipment row may name a `parent`: a hull piece or another equipment row it rides on. It keeps
a searchlight on its mast's platform, or a float beside its deckhouse, as the parent is moved,
turned, copied or removed, and it keeps a light gun on a turret roof as the turret trains. The row
keeps its own absolute `position` and `bearingDeg`; the format has no relative coordinates. Under
a fixed parent the compiled ship is identical with or without the link.

- Only equipment that may [float](#floating-fittings) takes a parent. A gun with a well, a
  launcher, a director, a funnel, machinery or a wall or path fitting is refused.
- Parents are hull pieces, deck fittings (catalog and custom), masts, funnels, directors and guns.
  A torpedo launcher cannot carry equipment yet.
- Chains are allowed, at most 8 links from a row to its first hull piece or unparented row: a
  lamp on a searchlight platform on a mast is two.
- An unknown parent, a row naming itself, a loop, a chain deeper than 8, an ID that names both a
  hull piece and an equipment row, a row that cannot float, a parent that cannot carry and a row
  that cannot [train](#trainable-parents) are each an `equipment-parent` error naming the row
  (`sourceId`) and its parent (`relatedSourceIds`). They are source faults: they report with the
  other source checks and stop the compile there.

The edits the editor and `ship:apply` share honour the link:

| Edit | A parent | A child alone |
| --- | --- | --- |
| `move` | Everything it carries moves by the same delta, once | Moves alone |
| `rotate` | Its riders swing about its datum and keep their pose on it: a fitting's riders turn by +degrees; a hull piece's by −degrees, because `rotationDeg` is counter-clockwise | Turns about its own datum |
| `copy` | Brings everything it carries; list a destination for each rider, or the command fails naming them. Copies ride the copied parent | Keeps its parent |
| `copy` with `mirror` | As `copy`; each mirrored rider rides the mirrored parent | Keeps a parent on the centreline (within 1 µm of X = 0); drops one off it, since the reflection would not stand on it |
| `remove` | Removes everything it carries too | Removes only itself |

The editor's copy and mirror copy bring the riders with fresh IDs, and its undo label says how
many attached fittings a removal took. Rewriting a record whole (`equipment`, `equipment-patch`,
`primitive`) never moves anything else, so a batch that must carry riders uses `move` or
`rotate`. In the editor, the rotation toolbar and quarter turns of a hull block carry its riders
through a pure yaw; a block tipped about X or Z leaves them where they stand.

### Trainable parents

A row with a gun anywhere up its chain is carried: it trains with the nearest such gun, its
carrier. A 2 cm Flakvierling on a 15 cm turret roof, or a searchlight on a platform on that roof,
turns with the turret in battle and in port. Its `position` and `bearingDeg` are its place at the
neutral pose, with every gun trained to zero, and the editor draws it there.

- Only deck fittings (catalog and custom) and light deck guns without a well or a raised barbette
  may be carried; each row a gun carries, directly or through other rows, is checked. A mast is
  refused because its gun-arc obstruction is fixed, and a raised barbette because it is fixed hull
  material; neither could train.
- A carried gun is a mount with `parentMountId` naming its carrier. The compiler lists mounts in
  source order except that a carried mount follows its carrier, so a rider may come first in the
  source. The runtime composes its frame from the carrier's train (as for Iowa's roof Bofors):
  its muzzles, aim, fire, clearance, contacts and turret armor follow the turret.
- A carried gun never clashes (`equipment-overlap`) with a gun that carries it, nor that gun with
  it. It is still checked against everything else at the neutral pose, as a fixed gun is.
- Gun clearance on a constructed ship: a carrier's barrels pass through what it carries, and a
  carried gun's barrels pass its carriers' barrels. A carried gun's barrels still clear its
  carrier's gunhouse (it cannot fire down through the roof it stands on) and everything else.
  Keep a roof mount behind or above the turret's barrels, since nothing stops them meeting.
- Mass, ready ammunition and the loading's centre of gravity stay at the neutral pose. The
  carried gun's ready-ammunition module also stays there, a few metres at most from where the
  turret takes it; this is the one piece of carried geometry that does not train.
- The model draws each carried row under its carrier's yaw joint (`constructionModel.ts`), so it
  batches and turns with it. `ship:render --pose` poses the carrier; the rows follow.

### Fit tolerances

A gun's working well is derived geometry, clipped against plating and against the
seams between touching blocks, so it collects wedges and shavings no authoring move
can remove. Its fit check ignores that residue up to the allowance below; an authored
internal package or load still has to fit exactly. The constants live in one block,
`fit` in `crates/naval-sim/src/construction.rs`:

| Constant | Value | Meaning |
| --- | --- | --- |
| `OUTSIDE_FLOOR_M3` | 0.005 m³ | Outside volume ignored outright, for a small well |
| `OUTSIDE_FRACTION` | 0.5% | Outside volume ignored, as a share of the well's own volume. Derived working wells only: an authored internal package must still fit exactly |
| `ATTACHMENT_M` | 0.08 m | Attachment datum to its hull support, raised from 5 cm |
| `FITTED_BASE_M` | 0.005 m | Depth an exterior body may sink into the hull under its base (unchanged) |
| `DECK_CROSSING_M` | 0.01 m | Gap below a deck a working well still crosses |
| `FLOAT_MARGIN_M` | 10 m | How far outside the hull's bounding box a [floating](#floating-fittings) datum may stand |

Real faults still fail: a turret with a well floating 0.3 m over its deck, one buried
0.5 m in it, or a well half outside the hull are all far above these allowances.

Funnels and masts are never collision bodies. Each catalog box encloses
platforms, galleries, yards and rigging that real structure passes through, so
the compiler raises no overlap, intersection or clearance fault for one, or for
anything entering one, whichever the source lists first: hull pieces may bury
them, equipment may share their envelope, a gun may train through them, and a
funnel's below-deck uptake never reports volume outside the free hull interior.
`ship:place`, `ship:reseat` and `ship:suggest` follow the same rule. Their
attachment and support checks, mass, CG, exhaust capacity, the sealed flooding
opening an uptake cuts and their runtime gun-arc obstruction volumes are
unchanged: the obstruction data is shared with the barrel-clearance profile, and
only the compile-time rejection is lifted from it.

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
4–48-section interpolation/simplification. Increasing count retains existing
sections. Changing section adjacency creates new panel IDs; old panel overrides
remain stored and new panels inherit side defaults. Inspect panel IDs again before
assigning armor. Equipment stays at its authored placement when the hull changes.

`customHull.creases` lists crease lines as port contour positions (strictly between the deck edge 0 and the keel
4, each on an outline point, ascending; mirrored to starboard). They split the side lighting there, as at a
knuckle or hard chine, and the editor keeps a creased point in place when it re-spaces an outline. They do not
change the compiled solid. `ship:loft` writes them for the corner lines it pins.

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
| `summary` | Coordinate conventions, hull-piece bounds, used/limit/free for every source limit, hull pieces as `[id, kind, position, size, rotation, surface assignments]` rows, equipment as kind → catalog part → `id: [x, y, z, bearingDeg]`, boundaries and loads. Deck fittings list IDs only unless `--positions` or `--kind deck-fitting`; `--no-positions` lists IDs everywhere. `--kind` keeps one hull-piece or equipment kind. `parents` maps each equipment ID with a [parent](#parents) to it. `--compile` adds launchability, diagnostics, loading totals and derived surface/flooding-portal usage |
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
bun run ship:place my-ship --table .build/fittings.json
bun run ship:ballast my-ship --waterline -9.9
bun run ship:armor my-ship --rules .build/scheme.json
bun run ship:account list
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

`--commands` takes the command list on its own, without the two expectations, and reads the
current revisions itself:

```sh
bun run ship:apply my-ship --commands .build/refit.json --label "Move the forward gun" --dry-run
bun run ship:apply my-ship --commands .build/refit.json --label "Move the forward gun"
```

The file is a bare JSON array, or `{"label": …, "commands": […]}`; an explicit `--label` wins.
A file that already carries `expectedRevision` or `expectedFileHash` is refused, because its own
expectations would be replaced rather than honoured: pass it as the positional argument instead.
The transaction is unchanged. Both revision checks still run against the source read in the same
process, and the save still fails if the file changed between that read and the write, so a
competing editor or agent is caught exactly as before. Use the guarded form when a batch is
written now and applied later; use `--commands` when it is written and applied in one step.

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
Command 2 (primitive-patch): result is not a valid source: Custom hulls require 4–48 sections
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
| `finish` | optional `finish` | Set the whole-ship sheen (`matte`, `satin`, `semi-gloss`, `gloss`) of painted surfaces; omission restores original finishes |
| `wear` | optional `wear` | Set the weathering drawn in port and battle (`fresh`, `in-commission`, `long-deployment`, `battle-worn`); omission reads as `in-commission`. Visual only |
| `primitive`, `equipment`, `boundary`, `load` | `value` | Add or replace the complete source record by stable ID |
| `primitive-patch`, `equipment-patch` | `id`, `changes` | Merge only supplied fields into an existing record; nested objects merge, arrays replace, `null` removes optional fields |
| `fitting`, `fitting-patch` | `value`; `id`, `changes` | Add, replace or patch a design-local fitting definition ([Custom fittings](#custom-fittings)); `solids` and `tubes` replace whole |
| `hull-sections` | `id`, `count` | Resize an adjustable hull's section list with the same 4–48-section interpolation/simplification as the UI |
| `hull-station` | `id`, `stationId`, `changes: {t?, points?}` | Edit one existing section while retaining its ID and other sections |
| `copy` | `copies: [{from,to}]`, optional `mirror` or `offset` | Copy hull pieces, equipment and loads using caller-supplied new IDs; preserve surfaces and remap copied magazine/engine links and [parents](#parents). A copied parent needs a copy of each rider |
| `remove` | `ids` | Remove selected records and everything they carry; retain the last hull piece. A custom fitting definition is refused while instances outside the command use it |
| `move` | `ids`, `delta: [x,y,z]` | Translate pieces, equipment, loads and boundary offsets; riders move with their parent |
| `turret-rise` | `id`, `heightM` (0–30) | Set a gun's rise above its deck attachment; `position` Y moves by the change, as the editor's **Turret rise** does |
| `rotate` | `ids`, `degrees` (required) | Add `degrees` to each hull piece's `rotationDeg` and each fitting's `bearingDeg` about their own datums; wall fittings are skipped; riders swing with their parent |
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
- Compound solids: `solid` with `version: 1` on a `vertex` primitive carries arbitrary closed
  geometry — concave, curved, tunnelled or thin-walled — as an ordered union of convex parts
  over one shared vertex pool. Send it whole through `primitive` or `primitive-patch`; `null`
  drops the piece back to an eight-corner block. Armor and paint reach a polygon `group`
  through `surface-patch` with `panelId` set to the group name. Format, rules and limits are in
  [compound solids](shipbuilding.md#compound-solids).
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
remaps the propeller's link; copying only the propeller retains its original link. [Parents](#parents)
follow the same rule, and a copied parent brings its riders.

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
8 cm from its support (5 mm for wall fittings and fitted gun bases) for equipment that
cannot [float](#floating-fittings), decks are sheered
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
bun run ship:place my-ship --part generic-twin-bitts --at 3.2,-12 --parent forecastle
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
each copy on its own support (IDs `…-1`, `…-2`; at most 1,000 copies per request and
1,000 equipment records per design). `--parent <id>` makes the new records ride a hull piece,
fitting or gun ([Parents](#parents)); seating is unchanged (it seats on hull surfaces, so give a
turret-roof rider its height with a `move` or `equipment` command), and a mirrored pair keeps the parent only
when it stands on the centreline. Connected fittings (railings, ropes, ladders
with a path) have no single seat; write their points with an `equipment` command. `place` does not set
`magazineId` or `powerSourceId`; patch them afterwards in a version-1 design.

`reseat` takes each record to its **nearest** support along its attachment direction
and reports `from`, `position`, the signed `gapM` found (negative was buried, positive
floated) and the support piece, face and slope. Records within 1 mm are left alone, so
a valid design yields no batch. Wall fittings only reach as far as the editor's wall
snap (0.75 × their larger dimension); a linked twin follows its partner. With `--slide`
a record with nothing under it moves sideways to the closest support, 1 cm inside its
edge. Under `--all`, equipment that may float is lifted out of a support that rose into
it but left where it floats above one, and never slid sideways; name it with `--ids` to
seat it. Under `--all`, a record with a `parent` is left alone: it rides its parent, and a
reseated parent moves what it carries by its own delta (a `move` in the batch). Under
`--all`, a record without a seat is a warning and the rest are still proposed; when the candidate then stops at an error on a record the batch does not
touch, the batch is returned with `candidate.unverified` and a nonzero exit code.

Limits: only the attachment point is seated. Whether the whole body fits (a gun base
across a deck edge, a door taller than its wall, an engine wider than the hull) is
decided by the candidate compile, whose diagnostics are returned in `candidate`.
Batches contain only `equipment` and `equipment-patch` commands, plus a `move` for the riders of a
reseated parent.

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

### A whole placement table at once

`ship:place --table rows.json` seats every row in one native resolver call and one
compile session instead of one process per fitting. A row carries the flags of a single
placement — `part`, `x`, `z` and optional `id`, `y`, `on`, `bearing`, `mirror`, `repeat`,
`step`, `parent` (which may name a record an earlier row places) — plus `extra`, an
object merged into every record the row produces (gun battery and arcs, launcher settings,
paint). `extra` may not set `id`, `partId`, `position` or
`bearingDeg`; the seat resolver owns those. The file is a bare array or
`{"version": 1, "rows": [...]}`, at most 128 rows, and is checked whole before anything
is placed.

```sh
bun run ship:place my-ship --table .build/secondaries.json --out .build/secondaries-batch.json
bun run ship:place my-ship --table .build/secondaries.json --apply
```

Rows are planned against each other, so IDs stay unique and the 128-record limit counts
the rows before it. A row that cannot be expressed at all (unknown part, taken ID) is
reported and the rest continue; a row with no support is reported `unsupported` and left
out of the batch while the seated rows still compile together. The result carries `rows`
(one line each: status, position, support, errors), `counts`, and `conflicts` — pairs of
seated rows whose source-level boxes, working spaces included, claim the same space.
Conflicts are approximate and conservative: they name candidates the compiler may stop
before reaching. The exit code is nonzero when any row failed.

`--apply` saves the proposed batch through the same guarded transaction as `ship:apply`;
without it nothing is written. `--table` cannot be combined with the single-placement
flags, because every row carries its own.

### Ballast and trim

`ship:ballast` fills box loads until the native compiler floats the ship where you asked.
It models nothing itself: each step is a real compile whose `loading` it reads.

```sh
bun run ship:ballast my-ship --waterline -1.25                       # the design's own tank- loads
bun run ship:ballast my-ship --tanks .build/tanks.json --waterline -9.9 --trim 0 --apply
```

Tanks are the design's `load` records whose IDs start with `--prefix` (default `tank-`),
the ones named by `--ids`, or the boxes in a `--tanks` plan file, which also creates them.
A plan row is a load — `id`, `name`, `center`, `size` — with an optional `capacityKg`;
otherwise capacity is the box volume at `--density` (default 1025 kg/m³ seawater; use the
fuel or feedwater density for those tanks).

The solve moves two numbers: how much ballast, and how far forward or aft its centre sits.
Mass is filled bottom-first — lowest tanks first, and within a tier the tank nearest the
wanted centre — so the vertical centre stays as low as the plan allows. `--waterline` is
the ship-space height the sea should reach (`loading.waterlineY`). `--trim` is the
distance LCG should sit from LCB: `0`, the default, is even keel; a negative value trims
by the bow. `--tolerance` (default 0.02 m) and `--iterations` (default 12) bound the
search; the longitudinal tolerance is five times the waterline one.

The result reports every compile it took (`steps`), the per-tank fill, the flotation it
reached and, when it fell short, a `note` saying whether the tanks ran out of capacity,
could not put their centre far enough fore or aft, or simply ran out of iterations.
A tank that ends empty is left out of the batch, or removed if it was already in the
design, because the compiler rejects a massless load. Without `--apply` nothing is saved
and the exit code is nonzero unless it converged.

### Armor schemes

`ship:armor --rules scheme.json` writes a protection table the way one reads it — a belt
between two frames, a deck over the magazines — and turns it into `surface-patch`
commands. It decides nothing about the plating; the compiler still judges mass and fit.

```sh
bun run ship:armor my-ship --rules .build/scheme.json --out .build/armor.json
bun run ship:armor my-ship --rules .build/scheme.json --targets --apply
```

```json
[
  { "name": "belt", "faces": ["port", "starboard"], "z": [-60, 60], "y": [-6, 2],
    "changes": { "thicknessMm": 320, "material": "armor-steel" } },
  { "name": "armored deck", "panels": ["8@[\"section-90\",\"section-82\"]"],
    "changes": { "thicknessMm": 80, "material": "armor-steel" } }
]
```

A rule selects by `primitives` (or `primitivePrefix`), `faces`, `panels`, and the `z` and
`y` windows a target must lie inside; `null` leaves a window's end open. Omitting a
selector means every value of it. The custom-hull panel IDs are the ones
`ship:inspect --panels` prints, and a target's window is the strip's own extent between
its two stations, so a belt is written in frame positions rather than panel names. Rules
are read in order and a later rule wins where two overlap, exactly as the file reads.
`mirror` defaults to true, so a rule reaches the opposite side or panel.

Each rule becomes one command, and the report gives each rule's target count, anything it
named but did not match (`unmatched`, which is a nonzero exit), and with `--targets` every
face it reached. `mass` is the compiler's own answer before and after, so the estimate
needs no second mass model. Without `--apply` nothing is saved.

### The account library

`ship:account` reaches the game account named by `NAVAL_TEST_EMAIL` and
`NAVAL_TEST_PASSWORD` in `.env.local` (`bun run bootstrap` copies the file into a
worktree). Neither value, nor the account's address, is ever printed or returned.

```sh
bun run ship:account list
bun run ship:account save my-ship --name "Scharnhorst" --confirm
```

`list` is read-only: one sign-in, one read of the saved library, one sign-out. `save`
uploads one repository source as a new revision of an account design and refuses to run
without `--confirm`. It replaces the revision it just read, so a save that races another
writer is rejected by the service rather than overwriting it, and the request carries an
idempotency key so a retry cannot create a second revision. The account owns its own
design identity: `save` reuses the design whose name matches, takes one named by
`--design`, or mints a new one. `--url` (or `ACCOUNTS_URL`) points at another service;
the default is the live one.

## Importing a mesh as a hull block

`ship:mesh` turns a closed OBJ, STL, PLY or GLB triangle mesh into one compound-solid hull
block — concave, curved, tunnelled or thin-walled geometry the block vocabulary cannot express.
Like `ship:place` it never saves: it prints a revision-guarded batch for `ship:apply`, `--out`
refuses to overwrite, and the exit code is nonzero when the candidate does not compile.

```sh
bun run ship:mesh my-ship .build/hangar.obj --id hangar --at 0,6.1,-18 --out .build/hangar.json
bun run ship:mesh my-ship .build/tower.glb --id tower --up z --scale 0.001 --bearing 180
bun run ship:mesh my-ship .build/boat.stl --id boat --group boats --weld 0.002 --max-planes 64
```

| Flag | Effect |
| --- | --- |
| `--id` | The new hull piece's ID; an existing ID is refused rather than overwritten |
| `--at x,y,z` | Where the mesh's own centre lands, in ship metres. Geometry is never silently re-seated |
| `--scale n` or `sx,sy,sz` | Applied before anything else; a negative axis mirrors and the winding is reversed with it |
| `--up z` | Rotate a Z-up file into the ship's Y-up frame: +Z becomes +Y and +Y becomes −Z (the glTF convention). A rotation, so winding is kept |
| `--up blender` | The file is in this repository's Blender frame (+X bow, +Y port, +Z up); uses the shared conversion in `scripts/construction/blenderFrame.ts` |
| `--bearing deg` | Clockwise from the bow, like equipment bearings; stored as the block's `rotationDeg` (counter-clockwise, so `rotationDeg = −bearing`), applied by the compiler, not baked into the corners |
| `--label`, `--group` | The shape's name; `--group` overrides every polygon's surface group with one name |
| `--weld m` | Corner welding grid, by default 1e-5 of the mesh's largest dimension |
| `--max-parts`, `--max-planes` | 256 and 48. `--max-planes` is the real budget: the decomposition is exponential in the number of distinct face planes |

The mesh has to be one closed, consistently wound, non-self-intersecting shell. An open surface,
a flipped triangle or two interpenetrating shells are refused with the count and a sample of the
offending welded edges or triangle pairs; an inside-out mesh is reversed and the report says so.
Boolean-union overlapping shells, close holes and decimate curved surfaces before importing.
OBJ `usemtl`/`g` names and GLB material names become surface groups, which
`ship:inspect --panels` lists and `surface-patch` arms through `panelId`.

## Blender front end

Blender is an optional place to shape a construction ship. It never becomes a source: the import
writes a scratch scene under `.build/`, and the export reads the edited scene and proposes a
revision-guarded batch for `ship:apply`, like `ship:place` and `ship:mesh`. Builds never run Blender
and `blueprint.json` stays the only durable source; a person can keep editing the result in the editor.

```sh
bun run ship:blender-import my-ship                    # .build/construction-blender/my-ship/scene.blend (+ scene.json)
# edit and save scene.blend in Blender (open it, or drive it through Blender MCP)
bun run ship:blender-export my-ship .build/construction-blender/my-ship/scene.blend --out .build/blender.json
bun run ship:apply my-ship .build/blender.json --dry-run --brief
bun run ship:apply my-ship .build/blender.json
bun run ship:blender-import my-ship --replace          # continue from the saved revision
```

Both commands run Blender headless (`scripts/build/blender.ts`: `BLENDER_BIN`, then the macOS
application, then `blender` on PATH) under an audit hook that refuses network access, the reference
cache, raw game model formats and every published model or glTF file, so reference geometry cannot
enter a scene through the tools. Import refuses to overwrite an existing scene without `--replace`,
because it may hold unexported work; `--out other.blend` writes elsewhere. Export only reads the file
and `--out` refuses to overwrite a batch.

| Frame | +X | +Y | +Z | Yaw |
| --- | --- | --- | --- | --- |
| Construction source | starboard | up | stern (bow is −Z) | `rotationDeg` counter-clockwise from above; equipment `bearingDeg` clockwise (0 bow, 90 starboard) |
| Blender scene | bow | port | up | Z rotation, counter-clockwise from above |

Metres in both; heights carry over unchanged, so construction Y = 0 is Blender Z = 0. Construction
(x, y, z) is Blender (−z, −x, y); Blender (x, y, z) is construction (−y, z, −x). The map is a proper
rotation, so winding and handedness survive it. A hull piece's `rotationDeg` is the Blender Z rotation
unchanged; an equipment bearing is the negated Z rotation, so bearing 90 (starboard) is Z −90°.
`scripts/construction/blenderFrame.ts` and its Python twin `blender/frame.py` are the only
conversion; `blenderFrame.test.ts` checks them both ways and against each other.

What the scene holds, by collection:

| Collection | Objects | Export |
| --- | --- | --- |
| Reference | The custom hull and balconies as their compiled skin, locked and unselectable | Never. Hull sections change through `ship:loft` or `hull-station` |
| Blocks | One mesh per hull piece, built from the source recipe (exact corners, compound-solid parts, the native shape library), placed at its `position` with its yaw; tilt is baked into the mesh | Changed pieces become hull pieces (below) |
| Equipment | One empty per equipment row at its datum, turned to its bearing, with a locked wire box of the catalog bounds as a child | Rows: position from the location, bearing from the Z rotation |
| Loads | Wire boxes | Loads: the box's bounds, `massKg` and `loadName` from properties |

Materials are named by construction paint ID (`naval-gray`, `dark-gray`, …); the whole paint palette
is kept in the file. Identity is in custom properties, never in object names, because Blender renames
copies `name.001`: `constructionId`, `constructionRole` (`block`, `equipment`, `load`, `reference`,
`proxy`), `constructionKind`, `partId` and `seat` on empties, `massKg` and `loadName` on loads, and the
hashes `shapeHash` (geometry, materials, world transform, those properties) and `meshHash` (local
geometry only), which the export recomputes with the same function (`blender/scene.py`).

The export, object by object:

- **Unchanged** (same `shapeHash`): skipped, so its record keeps whatever the editor or another agent
  did since the import, and exporting twice changes nothing.
- **A block moved or turned only** (same `meshHash`, a pure Z rotation, unit scale): `position` and
  `rotationDeg` change; kind, shape, tilt and armor stay.
- **A block reshaped**, scaled or tilted: eight vertices forming a hexahedron (one per octant around
  their centre, six box faces as quads or triangle pairs) become an eight-corner `vertex` block;
  anything else becomes a compound solid through the same decomposition as `ship:mesh`
  (`--max-planes`, default 48; `--max-parts`, default 256). The object's Z rotation becomes the
  piece's `rotationDeg`. A failure names the object and nothing is proposed. Ballast blocks can move
  but not be reshaped.
- **A new mesh** in Blocks (or with `constructionRole: block`) is a new hull piece whose ID comes from
  the object name (`Searchlight platform` → `searchlight-platform`, made unique).
- **A copy** of an imported object carries its `constructionId`; the object still named as imported
  keeps the ID and each copy gets `<id>-copy`. A copied block that was only moved keeps the original's
  kind and face assignments.
- **A new empty** in Equipment needs a `partId` property, or an object name that is a part ID
  (`generic-twin-bitts.001`); `design:` parts are custom fittings.
- **Seating**: an empty whose `seat` property is true is seated by the native resolver (`ship:place`'s)
  against the edited hull, nearest support along its attachment direction. The import sets it for
  equipment that cannot [float](#floating-fittings); a fitting that may float keeps the empty's height.
  Wall fittings keep their bearing.
- **Paint**: a block whose majority material differs from the paint it was imported with is painted on
  every face, keeping each face's armor; a new block is painted when its material is not the ship paint.
  Several materials on a compound solid become surface groups with their own paint. A material that is
  not a paint ID (`Material.001`) stops the export unless `--materials map.json` maps it
  (`{"Material.001": "dark-gray"}`); `naval-gray.001` counts as `naval-gray`.
- **Deleted**: an imported record whose object is gone is removed. Records added to the source after
  the import were never in the scene and are kept, and a record removed from the source after the
  import stays removed unless its object was changed in Blender.
- Objects without a role outside those collections (cameras, lights, scratch meshes) are listed as
  ignored.

A worked example is `scripts/construction/blenderFrontEnd.test.ts`: a destroyer starter hull with a
deckhouse, a bridge, a 5-inch gun and a stores load; in Blender the deckhouse moves 1 m aft, the bridge
is duplicated forward, a box platform and an octagonal locker are added, and the gun turns to bearing
30. The export (abridged):

```json
{
 "changes": {
  "unchanged": 2, "moved": ["deckhouse"],
  "reshaped": [{"id": "searchlight-platform", "as": "eight-corner block"},
               {"id": "ready-locker", "as": "compound solid", "parts": 1, "planes": 10}],
  "added": [{"id": "bridge-copy", "object": "bridge.001", "role": "block"},
            {"id": "searchlight-platform", "object": "Searchlight platform", "role": "block"},
            {"id": "ready-locker", "object": "Ready locker", "role": "block"}],
  "removed": [], "equipment": ["gun-a"], "loads": [],
  "painted": [{"id": "searchlight-platform", "paint": "dark-gray"}],
  "reassigned": [{"object": "bridge.001", "from": "bridge", "to": "bridge-copy"}]
 },
 "seating": [{"id": "gun-a", "status": "seated", "position": [0, 4.55, -25], "gapM": 0}],
 "candidate": {"launchable": true, "diagnostics": [{"code": "unpowered", "severity": "warning"}]},
 "batch": {"expectedRevision": "…", "expectedFileHash": "…", "label": "Blender export", "commands": [
  {"op": "primitive", "value": {"id": "deckhouse", "kind": "box", "size": [4, 2.4, 10], "position": [0, 5.25, 7], "rotationDeg": 0}},
  {"op": "primitive", "value": {"id": "bridge-copy", "kind": "vertex", "size": [3, 1.6, 4], "position": [0, 7.25, 9], "rotationDeg": 0}},
  {"op": "primitive", "value": {"id": "searchlight-platform", "kind": "vertex", "size": [2, 1, 2], "position": [3.5, 4.55, 20], "rotationDeg": 0, "vertices": ["…"]}},
  {"op": "primitive", "value": {"id": "ready-locker", "kind": "vertex", "size": [2, 2, 2], "position": [-3.5, 5.05, 20], "rotationDeg": 0, "solid": "…"}},
  {"op": "equipment", "value": {"id": "gun-a", "partId": "us-5in38-mk30-mod0-single", "position": [0, 4.55, -25], "bearingDeg": 30}},
  {"op": "surface", "value": {"primitiveId": "searchlight-platform", "face": "port", "thicknessMm": 0, "material": "steel", "paint": "dark-gray"}}
 ]}
}
```

Blender stores single-precision floats, so exported positions, sizes and corners are snapped to 10 µm
and angles to 0.00001°: a block set on a deck in Blender touches it in the source. On the Scharnhorst
(54 blocks, 214 equipment rows, 32 loads, 21 references) an import takes about 9 s and an export 2–6 s.

Not yet exported: visual mesh fittings (step 2 of the ship authoring plan),
hull sections through `ship:loft`, and equipment parents. Equipment empties are display boxes, not the
part models; custom fitting shapes are not drawn.

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
  and `remove` work as for catalog deck fittings. Instances have their own limit of 1,000 and never
  count against the 1,000 equipment instances.
- `remove` with a definition ID is refused while instances outside that command use it; the error
  names them.
- `ship:summary` lists definitions as `[id, name, solids, tubes, massKg, instances, partId, mesh
  triangles]` and reports `customFittingInstances` and `customFittingDefinitions` headroom, plus
  `meshTriangles`, `meshBytes` and `renderedTriangles` once a definition has meshes. `ship:get --ids
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

Limits: 256 definitions, 256 solids and 128 tubes each, about 32,000 triangles, tubes of 2–256 points
up to 100 m and 0.01–2 m across. The compiler checks at most 64 conservative boxes per definition:
one per solid and tube segment when they fit, one per whole tube next, and past that neighbouring
boxes merge along the fitting's longest axis. An instance may carry `scale: [x, y, z]` (0.05–20 per
axis, custom fittings only): the shape scales about its datum in its own axes and mass follows the
volume, so one definition covers every size of float or locker. A `custom-fitting` diagnostic names
the definition in `sourceId` and the solid, tube or instance in its message; an instance more than
10 m outside the hull's box reports `equipment-attachment`, and a bad scale `equipment-scale`.

### Visual mesh fittings

`ship:fitting-mesh` turns any OBJ, STL, PLY or GLB triangle mesh (open, non-convex, thin-walled,
with holes) into a custom fitting definition whose shape is a visual mesh. It is detail, not
structure: the mesh is drawn and weighed and nothing else. Shells, armor, buoyancy, flooding and
the armor view ignore it, so put a few simple blocks underneath for the structure, armor and gun
seats, and let the mesh carry the look. Like `ship:mesh` it never saves: it prints a
revision-guarded batch (a `fitting` command, plus an `equipment` row with `--at`), `--out` refuses
to overwrite, and a native dry-run compile gates it.

```sh
bun run ship:fitting-mesh my-ship .build/bridge.glb --id fit-bridge --name "Bridge detail" --mass 40000 --up z --out .build/bridge.json
bun run ship:fitting-mesh my-ship .build/house.obj --id fit-house --mass 12000 --paint roof=deck-gray,glass=boot-top-black --at 0,-20 --bearing 180
bun run ship:apply my-ship .build/bridge.json
bun run ship:place my-ship --part design:fit-bridge --at 0,-32 --y 14 --out .build/bridge-seat.json
```

| Flag | Effect |
| --- | --- |
| `--id`, `--name` | The new definition; an existing ID is refused |
| `--mass kg` | Required: a mesh has no volume to weigh. The centre of gravity is the area centroid of the triangles |
| `--scale n` or `sx,sy,sz` | Applied first, positive only (a file in centimetres needs 0.01); turn with `--bearing`, never mirror |
| `--up z` | Turns a Z-up file (Blender, most CAD) −90° about X into the ship's Y-up frame: a rotation, so nothing is mirrored |
| `--paint group=paint,…` | Coatings for the file's `usemtl`/`g` or GLB material names; other groups follow the instance, then the ship paint |
| `--at x,z [--y h \| --on id] [--bearing deg] [--instance id]` | Also seats one instance, exactly as `ship:place` would |
| `--out file` | Writes the batch; the printed report then leaves the encoded payload out, which keeps MCP output short |

The mesh is centred on its footprint with its lowest point on the datum (the report gives
`sourceOrigin`), quantized to 16 bits over its own bounds, welded, and split into meshes of at
most 20,000 triangles. There is no decimation: a mesh over budget is refused with the counts, so
simplify it in a modelling tool first. Budgets, identical online and local:

| Budget | Value |
| --- | --- |
| Triangles per mesh / meshes per definition | 20,000 / 16 |
| Unique mesh triangles per design (each definition once) | 100,000 |
| Encoded mesh bytes per design (base64 `data`) | 1 MiB, about 7–9 bytes per triangle |
| Drawn triangles per design (instances × definition triangles, meshes, solids and tubes) | 1,000,000 |

A definition with meshes is `version: 2`, needs `massKg` and may give `centerOfGravity`. An
instance's `scale` multiplies the mass by the volume factor like any custom fitting. The
compiler checks seat and burial against up to eight boxes per mesh (the triangles split three times
along their longest axis), so an L- or U-shaped deckhouse does not claim its open notch. Mirrored
copies are placed and turned, not reflected; model both sides in the file when they differ.

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
before publishing. Builds never run Blender for ship construction; a Blender scene is only an
authoring front end whose edits reach the source as a batch.

Outputs are `public/models/<id>.glb`, its compiled JSON and thumbnail, plus
`generated/build.json`, `generated/thumbnail/render.json` and the five fixed views
in `generated/review/`. The `construction-v2` build manifest separates compiled
definition, model recipe/input and presentation fingerprints. Builds and checks
compile through the simulation's WASM build (`scripts/construction/publicationCompiler.ts`),
not the native binary: native builds round differently on an arm64 Mac and on
x86_64 Linux (last digits, and occasionally whether a sliver room survives), so a
ship published on one never checked on the other. WASM floating point is the same
everywhere, and dev and release WASM builds agree. Authoring commands keep the faster
native compiler. Compiler source changes only invalidate an asset when its
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
   (each named), then every bad fitting paint or barbette height, equipment
   [parent](#parents), primitive, surface assignment (with the reason), boundary
   and load.
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
| `toleranceM` | Tolerance the gap was tested against: `0.08` attachment, `0.005` fitted base |
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
