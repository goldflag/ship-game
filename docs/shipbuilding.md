# Shipbuilding: source format, compiler and storage

This guide covers the data side of player-built ships: the versioned construction source,
the Rust compiler that derives everything physical from it, the equipment catalog, storage
and the technical limits.

Related guides:

- Editor UI (layout, tabs, tools, hotkeys, browser checks):
  [src/ui/shipbuilding/README.md](../src/ui/shipbuilding/README.md).
- Repository-backed construction ships and agent commands:
  [construction authoring](construction-authoring.md).
- Accounts, quotas and online limits: [accounts](accounts.md).
- Reusable component recipes and publication: [shared components](shared-components.md) and the
  [construction catalog notes](../assets/parts/construction/README.md).
- Machinery auxiliaries, pumps and repair: [machinery services](construction-services.md).
- Propeller and rudder forces: [maneuvering](maneuvering.md).

Blender remains the authoring tool for reusable components only. Player designs never pass
through Blender.

## Ownership

TypeScript owns commands, history, storage and rendering. Rust owns every physical result:
solid geometry, armor occupancy, equipment fit, loading, stability, flooding topology and the
combat definition. There is no second construction-physics implementation in TypeScript.
Preview envelopes (`primitiveGeometry.ts`, `pendingHull.ts` in the editor) are display-only.

## Source format

The contract is `ConstructionSource` in [blueprint.ts](../src/ships/blueprint.ts). Rust structs
are generated from it by `bun run multiplayer:definitions`
(`scripts/multiplayer/generate-rust-definitions.ts`); do not edit generated structs by hand.

- `schemaVersion: 1`, `id`, `name` and `coordinates` are shared with historical `ShipBlueprint`s.
- `revision` identifies one immutable source revision.
- `construction.version` is `1` or `2`. Both compile. New and edited designs use 2
  (`constructionStarter.ts`).
- Version 2 removes placeable magazines: turret wells carry an integral magazine, deck mounts
  carry ready ammunition and torpedo banks carry their own rounds. Opening a version-1 design
  converts it in one undoable command (`integrateConstructionMagazines` in
  `src/ships/constructionArmament.ts`). Saved version-1 revisions stay readable.
- `construction.catalogRevision` pins the exact equipment catalog the source was edited against.
- Historical hulls use `hull.kind: 'authored-stations-v1'`. Compiled designs use
  `'constructed-volume-v1'`: immutable convex cells plus attributed exterior polygons.

Coordinates are metres, +Y up, −Z bow, +X starboard. Compilation never recenters a design.
Equipment `bearingDeg` is clockwise. Published parts keep their original datum and sockets.

`ConstructionData` holds:

| Field | Content |
| --- | --- |
| `primitives` | Hull pieces: `kind`, `size`, `position`, `rotationDeg` (yaw) and optional records below |
| `surfaces` | Face assignments: `primitiveId`, canonical `face`, `thicknessMm`, `material`, `paint`, `open`, optional `panelId` |
| `equipment` | Fitted catalog parts: `partId`, `position`, `bearingDeg`, optional `paint`, `gun`, `launcher`, `wall`, `path`, `powerSourceId` |
| `boundaries` | Internal decks and bulkheads: `axis`, `offset`, `thicknessMm` |
| `loads` | Named box loads with `massKg` |
| `fittings` | Optional design-local fitting definitions; see [Custom fittings](#custom-fittings) |
| `defaultThicknessMm` | Structural skin for the whole design, 0.1–1,000 mm |
| `paint`, `finish` | Optional ship-wide paint and surface sheen (`matte`, `satin`, `semi-gloss`, `gloss`) |

New optional records are added with their own `version: 1` instead of bumping the source
schema, so older sources load unchanged:

| Record | On | Purpose |
| --- | --- | --- |
| `tilt` | primitive | Pitch and roll in degrees; `rotationDeg` stays yaw; order is YXZ |
| `vertices` | `vertex` primitive | Eight normalized local corners |
| `shaping` | `vertex` primitive | Reversible round/chamfer: edge indexes, radius, style |
| `mesh` | `vertex` primitive | Editable topology for prisms, curved solids and wedges |
| `solid` | `vertex` primitive | Compound solid: arbitrary closed geometry as an ordered union of convex parts |
| `customHull` | `custom-hull` primitive | Section-authored whole hull |
| `customHull.bilgeKeels` | custom hull | Symmetric visual fins |
| `customHull.paintBands` | custom hull | Up to eight height coatings |
| `balcony` | `balcony` primitive | Outline points, edge treatments, edge height, wall thickness |
| `wall` | equipment | Wall fitting size, linked `mirrorId`, optional `turnDeg` (90, 180, 270) |
| `path` | equipment | Connected route: local `points`, `slackM`, `access`, `heightM`, `railCount` |
| definition | `construction.fittings` | Design-local fitting: `solids`, `tubes`, `attach`, `material`, `fill`, `massKg` |

Surface assignments reference primitive IDs and canonical face names (`port`, `starboard`,
`bottom`, `top`, `bow`, `stern`, `slope`). Clipped patches of one face share that identity;
triangle numbers are never source references. Zero assigned armor keeps the structural skin.
Effective thickness is the greater of the assignment and `defaultThicknessMm`. `open: true`
omits the skin and creates a downflooding opening. Removing a boundary merges its rooms.

Primitive kinds are the union in `ConstructionPrimitive['kind']`. Shape recipes live in
[hull_shapes.rs](../assets/parts/construction/hull_shapes.rs); `multiplayer:prepare` emits the
display-only shape library from them (`construction_shape_library` in `naval-wasm`). `ballast`
is a block with a fixed 100,000 kg payload independent of its size.

### Freeform hulls

`kind: "vertex"` stores optional `vertices`: exactly eight finite normalized local corners, the
four bow corners `(-X,-Y), (+X,-Y), (+X,+Y), (-X,+Y)` then the same stern corners. Missing
`vertices` mean the unit cube. `size` scales the edit frame. Editing a box's corners turns it
into a vertex hull without changing its ID.

- `shaping` (round/chamfer) keeps one block and ID. The radius limit is 45% of the smallest
  frame dimension (`construction_freeform.rs`).
- `mesh` holds source vertices, mirror references, stable face IDs, canonical surface names and
  control rings. Limits are 4–256 vertices, at most 256 faces and 24 rings
  (`construction_mesh.rs`).
- Split cuts a block into independent eight-corner children with new IDs. It refuses to pass
  512 hull pieces (`constructionVertex.ts`), well below the general primitive cap.

Rust validates closed oriented topology, finite coordinates, folds and self-overlap, and derives
one faceted surface for rendering, collision, armor and buoyancy. Invalid drafts stay editable
and saveable but cannot launch. Arbitrary topology, tunnels and subdivision surfaces are not
supported on `vertices`, `shaping` or `mesh`; a block that needs them is a compound solid
instead. TypeScript counterparts: `constructionVertex.ts`, `freeformShape.ts` and
`constructionMesh.ts` under `src/ships/`. Editor controls are described in the
[editor README](../src/ui/shipbuilding/README.md#freeform-and-shape-editors).

### Compound solids

`kind: "vertex"` with `solid.version: 1` is one hull block of arbitrary closed geometry:
concave, curved, tunnelled, thin-walled or several shells. The block carries it already
decomposed, so the compiler never has to decompose anything at compile time:

| Field | Meaning |
| --- | --- |
| `label` | 1–80 characters, the shape's name in the editor and in diagnostics |
| `vertices` | 4–8,192 local corners shared by every part, each component within ±0.5; `size` scales this frame |
| `parts` | 1–256 convex parts, each a unique ID and 4–128 outward-wound polygons |
| `parts[].faces[].corners` | 3–64 distinct indices into `vertices`, counter-clockwise seen from outside |
| `parts[].faces[].group` | Optional surface group for armor and paint |

Unlike a freeform `mesh`, the corner frame is clamped to ±0.5, so `size` and `position` are the
block's real envelope and `ship:near`, `ship:bounds`, placement ghosts and mirroring stay honest
about geometry the editor cannot otherwise see. Every part must be a closed, planar-faced, outward-wound convex polyhedron enclosing more than
1e-7 m³, and parts may not share volume — they meet face to face. Rust rejects anything else
with the part index, part ID and polygon index in the message
(`crates/naval-sim/src/construction_solid.rs`). Whatever a sibling part covers becomes interior,
so the block gets one outer skin however the decomposition split it; the block then contributes
mass, buoyancy, rooms, flooding and hit geometry exactly like any other hull piece.

A `group` addresses its polygons for armor and paint. Because one group's patches can land on
more than one canonical side, its surface assignment is `{ primitiveId, face, panelId: group }`
— the same `panelId` channel custom hull panels use. An ungrouped polygon stays on its canonical
side with no panel. `solidPanels()` in `constructionEditor.ts` enumerates the addressable groups.

Cost, measured on an Apple M-series release build by
`cargo test -p naval-sim --release --lib solid_cost -- --nocapture`: a block of 16 or 64 boxed
parts compiles in 0.5–0.8 ms, a maximal 256-part block in 3.2 ms. Coplanar patches of one
surface group are merged below 64 patches, which is why the 16- and 64-part slabs come out as
six faces and the 256-part one keeps its 516 part-by-part patches.

`bun run ship:mesh <ship> <file>` imports a closed OBJ, STL, PLY or GLB triangle mesh into this
form: it welds near-coincident corners, refuses an open, inconsistently wound or self-intersecting
surface by name, reverses an inside-out one, and decomposes the result with a BSP over the mesh's
own face planes. That decomposition is exact — the parts tile the solid — rather than an
approximate convex hull fit, because the compiler runs identically in the browser, the worker and
the server. OBJ `usemtl`/`g` names and GLB material names become surface groups. The command
proposes a revision-guarded batch and never saves; `ship:apply` commits it. Its real budget is
`--max-planes` (48 by default): the BSP is exponential in the number of distinct face planes, so
curved surfaces must be decimated before import.

A compound solid replaces `vertices`, `mesh` and `shaping` on the same primitive; carrying two
shape records is an error. The editor draws the authored parts as a display-only draft envelope;
the shipped surface always comes from the native compile.

### Custom hull sections

`kind: "custom-hull"` with `customHull.version: 1`; `size` is `[beam, depth, length]`.
`construction_custom_hull.rs` enforces:

- 4–24 stations with stable IDs and ordered `t`.
- The same odd point count, 5–33, in every station. Left/right symmetry is implied.
- Optional point `contour` positions on the original 0–8 outline scale, so inserting or removing
  point pairs preserves unchanged panel IDs. Nine-point hulls without `contour` need no migration.
- `rake` 0–1.5 and `bulb` 0–1 bow parameters.

Rust derives closed convex cells and attributed exterior panels with mirrored triangulation.
Starting hulls come from `HULL_PRESETS` in `src/ships/constructionHullPresets.ts` (six ship-based,
four generic); regenerate ship-based sections with `bun scripts/construction/hull-presets.ts`.

### Armor on custom hull panels

A surface record with `panelId` overrides the whole-side record for one panel between
neighboring sections. Panel identity follows the bounding section IDs and outline edge, so
moving or resizing sections keeps armor; new adjacencies use the side default. `panelId` is
only valid on a `custom-hull` primitive.

### Custom hull paint bands

`customHull.paintBands` is `{ version: 1, bands: [{ id, upperY, paint }] }`, ordered, at most
eight. `upperY` is hull-local Y in metres, within ±500 m. An explicit empty list disables bands.
Legacy `customHull.redPaintY` still renders as one red-oxide band; `paintBands` wins when both
exist. Face paint remains above the highest band. Bands do not change armor, mass or buoyancy.

### Bilge keels

`customHull.bilgeKeels` (`version: 1`, `enabled`, and placement settings) emits visual plates
only (`construction_bilge_keels.rs`): no mass, buoyancy, armor, drag or roll damping. Hulls
without the record keep their shape.

### Balconies, wall fittings and paths

- `balcony`: 3–32 outline points, concave allowed (`construction_balcony.rs`). Size Y is the deck
  thickness. The deck, walls and railings are decorative: no structural mass, buoyancy,
  armor, flooding volume or runtime collision geometry. They remain visible and support
  equipment placement in the editor. A balcony may float; one that touches the hull still carries a piece standing on it.
- `wall`: Rust validates support, linked-pair symmetry, clearance and scaled mass
  (`construction_wall_fittings.rs`). A linked partner carries the opposite `turnDeg`. Wall
  fittings never cut hull openings or change flooding.
- `path`: points are equipment-local. Rope and chain sag is sampled at 16 intervals per
  segment; a route is at most 500 m (`construction_paths.rs`). Native code owns support, hull
  clearance, mass, CG and inertia. `src/game/constructionPathModel.ts` only draws the route.

### Custom fittings

`construction.fittings` holds design-local fitting definitions for small parts the catalog lacks.
An instance is an equipment row with `partId: "design:<definition id>"`, so N instances share one
shape and Clone carries definitions with the design.

```jsonc
{ "id": "fit-bollard-a", "name": "Twin bollard", "version": 1, "attach": "deck",
  "solids": [{ "id": "post", "kind": "cylinder", "size": [0.32, 0.62, 0.32], "position": [0, 0.31, 0], "rotationDeg": 0 }],
  "tubes": [{ "id": "bar", "points": [[-0.4, 0.5, 0], [0.4, 0.5, 0]], "diameterM": 0.07 }],
  "material": "steel", "fill": 0.35 }
```

- A solid is a hull-piece shape in fitting-local metres: `kind`, `size`, `position`, `rotationDeg`
  and optional `tilt`, `vertices`, `mesh`, `shaping` and `paint`. It has no armor, surfaces or
  `smoothGroup`, and `custom-hull`, `balcony` and `ballast` are excluded.
- A tube is a round section swept along `points` with `diameterM` and optional `paint`.
- The datum is the local origin. `attach` is `"deck"`: y = 0 seats on the deck and the lowest
  solid or tube must reach it. `"wall"` and `"internal"` are reserved.
- Mass is shape volume × density × `fill` (`material`: `steel` 7,850, `aluminium` 2,700, `brass`
  8,500, `wood` 700 kg/m³; `fill` 0.01–1, default 1), or `massKg` when given. Overlapping solids
  count their volume twice.
- A solid or tube without `paint` follows the instance `paint`, then the ship paint.

`construction_custom_fittings.rs` resolves each definition into a synthesized deck-fitting part
(bounds, centre of gravity, mass, one conservative box per solid and tube segment) and adds it to
the catalog the compiler looks parts up in. The published catalog and the content hash input are
unchanged, and a supplied `design:` catalog entry is discarded. A custom fitting therefore follows
the deck-fitting rules: support within 5 cm of its datum (`equipment-attachment` with `fit.gapM`
and `fit.seatPosition`), 10% of its boxes outside the hull, and one mass contribution. It never
joins the hull union and has no armor, buoyancy, room, flooding, module, obstruction or hit
geometry. Faults are `custom-fitting` diagnostics that name the definition and the solid, tube or
instance. `src/ships/constructionCustomFittings.ts` is the TypeScript resolver for the editor and
tools, tested against the native one; `src/game/constructionFittingModel.ts` is the one renderer.
Phases, versioning and deployment order are in the [plan](custom-fittings-plan.md).

## Compiler

The compiler is part of the `naval-sim` crate, identified by `COMPILER` in
[construction.rs](../crates/naval-sim/src/construction.rs).

| Module (`crates/naval-sim/src/`) | Role |
| --- | --- |
| `construction.rs` | Validation, union, skin, rooms, loading, definition, `suggest` |
| `construction_geometry.rs` | Convex polyhedra CSG and its bounds |
| `construction_cache.rs` | Content-addressed CSG reuse across editor revisions |
| `construction_transport.rs` | Lossless compact worker results; shared surfaces, loading and indexed vertices |
| `construction_custom_hull.rs`, `_vertex.rs`, `_freeform.rs`, `_mesh.rs`, `_balcony.rs` | Shape families |
| `construction_orientation.rs` | Yaw plus optional tilt, YXZ |
| `construction_installation.rs` | Gun wells, deck mounts, raised supports |
| `construction_propulsion.rs` | Compile-time propeller routing, exhaust capacity and effective power |
| `construction_propellers.rs` | Generated shafts, bearing housings and fins |
| `construction_services.rs` | Auxiliary power, pumps and work party included in machinery |
| `construction_paths.rs`, `_access.rs`, `_wall_fittings.rs`, `_bilge_keels.rs` | Fitting families |
| `construction_custom_fittings.rs` | Design-local fitting definitions resolved into deck-fitting parts |
| `construction_overlap.rs` | Editor-only hull overlap policy |

Entry points:

- WASM (`crates/naval-wasm/src/lib.rs`): `compile_construction`, `suggest_construction`,
  `construction_shape_library`, and a stateful `ConstructionCompiler` that keeps the cache.
- Native: `cargo run -p naval-sim --example compile_construction` takes the same source and
  catalog JSON. `compile_construction_edits` replays an array of revisions through one warm
  compiler and asserts equality with fresh compilation.
- Browser: `ConstructionClient` (`src/ships/constructionClient.ts`) runs the compiler in a
  dedicated worker (`construction.worker.ts`). Its `compile_compact` WASM entry emits a
  `naval-construction-result` version-1 envelope: ordinary result fields, a shared vertex table,
  and optional references for hull surfaces and loading already present elsewhere in the result.
  Coordinates retain all floating-point bits, including signed zero. `constructionTransport.ts`
  validates and expands the packet into an ordinary `ConstructionResult` with independent mutable
  arrays before exposing it to the editor, port or battle. Native/public `compile` JSON, saved
  sources and the battle definition format stay unchanged.

The disposable browser cache stores compact packets. Results of at least 64 KiB are gzip-compressed
when browser compression streams are available; a custom `X-Construction-Compression: gzip` header
marks these entries. Reads explicitly decompress them. Plain entries remain readable, and corrupt
or unavailable storage falls back to compilation. Cache writes finish before the worker replies,
so immediately closing the editor still leaves a reusable result. The worker sends compact JSON
rather than compressed bytes to the client, keeping decompression off the UI thread.

Geometry queries reuse bounds, face normals and content fingerprints for immutable face
allocations. Weak references preserve allocation identity without retaining dead vertex buffers;
copy-on-write edits get fresh facts. Spatial indexes narrow fitting support tests to nearby
geometry, and material budgets accumulate counts as cells are appended. These shortcuts preserve
exact clipping order, geometry limits and validation. The `wasm-dev` profile uses full Rust
optimization for interactive compilation, with incremental compilation and no LTO for faster
local rebuilds.

What compilation does:

- Unions convex polyhedra, clips shared exterior faces and subtracts material and equipment from
  room volume. Overlapping pieces count once for displacement and material.
- Coalesces adjacent convex pieces within each finished room when their exact union is convex.
  Room capacities, occupied spaces, cavities and openings are preserved; a bounded merge pass
  leaves remaining pieces intact. A room's convex-piece count is not its compartment count.
- Merges compatible coplanar armor patches within the same authored surface, retaining thickness,
  material, mount ownership and openings. Closed flooding fragments sharing a room pair and
  protection plate share one connection state; their original damage footprints, heights and
  sequential transfer order remain distinct. Ordinary doors retain independent controls.
- Builds gun clearance from the exposed structural hull faces, removing internal subdivision
  faces. Decorative balconies remain excluded from structural collision geometry.
- Battle caches can simplify armor contacts and buoyancy/flooding volumes separately from
  this authored output. Near-coplanar armor groups preserve original panel footprints and
  hit identities; hull/room volume candidates pass geometry and hydraulic accuracy checks.
  See [runtime approximations](sim-performance-plan.md#runtime-approximations). The serialized
  definition and editor geometry counts remain the detailed authoring model.
- Accepts concave sections, asymmetry and multiple immersed hulls in one rigid ship.
- Loads steel at 7,850 kg/m³ against seawater at 1,025 kg/m³, plus equipment, services and
  initial ammunition.
- Adds an internal allowance of 150 kg per cubic metre of the union envelope for unmodeled
  structure, distributed in the envelope's lower half. It creates no solids and does not reduce
  floodable volume.
- Freezes propeller-to-engine routing into the definition (`construction_propulsion.rs`).
  Damage never reroutes a propeller. `powerSourceId` is a manual override.
- Generates propeller shafts and fins (`construction_propellers.rs`): steel mass and clearance,
  no buoyancy or power.
- Applies no stability target or buoyancy multiplier. Heavy or top-heavy designs sink or capsize.

Errors block launch but never saving. Overload, instability and incomplete propulsion are
warnings.

Gun installation (`construction_installation.rs`, version 2):

- A catalog working well may cross its supporting deck; the compiler reserves the interior and
  removes the crossed skin without changing displacement.
- A part with explicitly empty occupancy is a deck mount. For older entries without occupancy,
  guns below 100 mm default to deck mounts.
- `gun.barbetteHeightM` (turret rise) is 0–30 m and requires version 2. It raises the support
  above deck; the lower magazine stays fixed. Supports add structural mass, never buoyancy.
- Combat shell contacts use a circular wall and open annular top for each complete generated
  support, while the visual and authoring model retains 64 sides. Hits retain their original
  armor sector's identity, material and thickness. This runtime approximation does not change
  working wells, gun clearance, mass or flooding; see [runtime approximations](sim-performance-plan.md#runtime-approximations).

Funnels and masts (`uncontested` in `construction.rs`) are never collision bodies. Their catalog
box encloses platforms, galleries, yards and rigging, so no overlap, intersection or clearance
fault is raised for one, or for anything entering one, in either source order; a funnel's uptake
reserves its volume without reporting it outside the free hull interior. Attachment and support,
mass, CG, inertia, power and exhaust, the sealed flooding opening an uptake cuts, rendering and
the runtime obstruction volumes are unchanged. The mount-clearance profile still ships their
bodies for combat; they are only withheld from the compile-time clearance check.

The editor overlap policy (`construction_overlap.rs`, `MIN_EXPOSED = 0.1`) requires each hull
block to keep 10% of its volume outside the other blocks. It is an editing aid; loading always
uses the physical union.

Equipment clash tests go through the fitting broadphase (`construction_geometry.rs`,
`Broadphase`) instead of comparing every fitting with every earlier one, so a design near the
1,000-row budget costs about linear time. Candidates keep insertion order, so the neighbour a
clash names is the one the exhaustive comparison named.

## Equipment catalog

`loadConstructionCatalog(revision?)` in `src/ships/constructionEquipment.ts` fetches
`models/components/catalog.json`, or `models/components/catalogs/<revision>/catalog.json` for a
retained revision, and rejects a revision mismatch. Catalog and weapon schema versions are 1.

The editor opens every design on the newest catalog. `ConstructionRevisionOwner.adoptCatalog`
rebases the whole undo history onto it, so Undo never restores the old library. A design keeps
its saved catalog revision only when the newest catalog lacks a part it has fitted; the Designs
menu then names the missing parts. Retained catalogs stay loadable for old revisions.

Palette thumbnails are built by `bun run part:thumbnails` into
`public/models/components/thumbnails/` with the index `src/generated/construction-thumbnails.json`.
`bun run build` checks freshness. Commit images and index together.

## Identity, storage and local authority

`content_hash` is a SHA-256 over the compiler name, simulation build, source and catalog.
Compiled definitions get `local-…` IDs. `isLocalShipId` in
[localShips.ts](../src/ships/localShips.ts) recognizes them; that module is a port presentation
registry, not an authority.

Storage goes through the `ConstructionStore` interface (`src/ships/constructionStore.ts`):
`list`, `load`, `revisions`, `save`, `remove`, `close`. `openConstructionStore()` returns:

- With a signed-in account: the cloud store (`constructionCloud.ts`), which calls `api/ships`.
  PostgreSQL keeps immutable revisions and a compare-and-swap current pointer. IndexedDB
  database `fleet-command-recovery-<account>` holds unsaved recovery drafts only.
- Without an account, or with an injected `name`/`indexedDB` (tests, the account-free browser
  harness): the IndexedDB database `fleet-command-construction`.

Every save writes an immutable revision and advances the design head only if
`expectedRevisionId` matches. A stale writer is rejected. Compiled geometry and battle damage
are never stored. Invalid physical drafts are saveable. See
[account storage](accounts.md#source-storage-and-recovery) for quotas and recovery, and
[online construction](accounts.md#online-construction) for how designs reach online battles.

Editing pipeline (`src/ships/`):

- `constructionCommands.ts` and `constructionEditor.ts`: the command set and edit helpers.
- `constructionHistory.ts`: undo/redo, 50 steps.
- `constructionRevisionOwner.ts`: the single edit door (`submit`, `applyBatch`), adoption,
  autosave ordering and conflict recovery.
- `constructionAutosave.ts`: serialized, coalesced writes.
- `compiledRevision.ts`: waits `CONSTRUCTION_COMPILE_IDLE_MS` (1 s) after the last edit, compiles
  only the newest revision and exposes a result only for the exact source revision. Opening a
  design and explicit retries skip the wait. Sea trials require a current passing result.

Each battle freezes its selected revisions. `LocalRuntime.with_construction`
(`crates/naval-wasm/src/lib.rs`) recompiles those sources against their exact catalogs. It does
not accept supplied physical definitions. Sea-trial controls are a local API and are absent
from the multiplayer protocol.

[constructionModel.ts](../src/game/constructionModel.ts) composes native exterior polygons with
component GLBs from `models/components/` for previews, trials, battles and GLB export.

## Limits

Source bounds are constants in `construction.rs`, mirrored by `CONSTRUCTION_LIMITS` in
`src/ships/constructionEditor.ts`:

| Limit | Value |
| --- | --- |
| Source JSON / catalog JSON | 16 MB / 4 MB |
| Primitives | 10,000 |
| Surface assignments | 65,536 |
| Equipment instances | 1,000 (32 online) |
| Loads | 128 |
| Custom fitting definitions / instances | 32 / 1,000, counted apart from equipment instances |
| Solids / tubes / triangles per custom fitting | 256 / 128 / 32,000 |
| Compound solid vertices / parts / polygons | 8,192 / 256 / 8,192, with 128 polygons per part |
| Compound solid exterior patches | 32,768 per block |
| Boundaries | 24 |
| Derived cells (`MAX_CELLS`) | 131,072, with 128 faces per cell |
| Face vertices per geometry collection | 4,194,304 |
| Derived skin patches (`MAX_SURFACES`) | 131,072 |
| Flooding portals (`MAX_CONNECTIONS`) | 16,384 |
| Piece dimensions / positions | 0.01–500 m / within ±1,000 m |
| IDs | 1–64 characters, ASCII letters, digits, `-`, `_` |
| Geometry cache | 32 MiB and 8,192 entries |
| Derived cell facts cache | 16 MiB and 32,768 slots per thread |
| Run or Fill gesture (editor) | 128 pieces |

Complexity failures keep the source and ask for simpler geometry. These are technical bounds,
not a promise that a maximal design compiles quickly. Online play applies lower limits; see
[accounts](accounts.md#online-construction).

## Known approximations

- Equipment inertia uses fixed envelopes; the simulation consumes diagonal inertia.
- Openings act on whole source faces. Internal decks and bulkheads are full axis-aligned planes
  clipped to the hull interior.
- Generated propeller supports are an engineering approximation, not a shaft-line simulation.
- Warped freeform faces are faceted; their signed volume is exact.
- Initial service and ammunition loading is fixed; expenditure does not recalculate dry mass.
- Resistance, package masses and handling are game approximations, not certified performance.

## History

Per-feature behavior notes, measurements and the original player-facing walkthrough are kept
verbatim in the [shipbuilding log](archive/shipbuilding-log.md). It is a historical record, not
current guidance.
