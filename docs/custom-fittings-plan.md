# Custom fittings

Small parts that are not in the fittings catalog (bollards, lockers, davits, pipes, platform
details, light masts), defined inside one design and fitted like any deck fitting. Phase 1 is
built; phases 2–4 are planned.

Related: [shipbuilding](shipbuilding.md#custom-fittings) for the source format, limits and compiler,
[construction authoring](construction-authoring.md#custom-fittings) for the agent commands, and the
[editor README](../src/ui/shipbuilding/README.md#custom-fittings).

## Why

Before this, the only in-design way to make a missing part was hull primitives, which become
armored, buoyant, floodable hull structure. Agent-built ships must stay clonable and editable by
people, so a custom fitting lives inside the design source (Clone copies the source, so it carries
the fitting for free) and is built from the shape vocabulary the editor already edits.

## Owner's decisions

1. Custom-fitting instances do not count against the 128 equipment instances. They have their
   own limit: 512 per design, 96 online.
2. Format versioning was left to the implementation; see [Versioning](#versioning-and-deployment).
3. Shells ignore custom fittings completely: no collision, hit volume, damage, armor or module.
4. Tubes are part of version 1.

## Model

`construction.fittings` holds definitions; instances are ordinary `construction.equipment` rows
with `partId: "design:<definition id>"`. N instances share one shape, and move, rotate, copy,
mirror, remove, paint, `ship:place`, `ship:reseat`, `ship:get`, `ship:bounds`, `ship:near`,
selection and the inspector work because an instance is an equipment row.

One resolver on each side turns a definition into a synthesized catalog part (`kind:
"deck-fitting"`, `placement: "deck"`, size, bounds centre, centre of gravity, mass, conservative
`fitting` boxes, no GLB):

- Rust, the authority: `crates/naval-sim/src/construction_custom_fittings.rs`.
- TypeScript, for the editor and tools: `src/ships/constructionCustomFittings.ts`.
  `constructionCustomFittings.test.ts` compares the two on bounds, centre of gravity, mass and
  boxes through the WASM export `construction_custom_fitting_parts`.

Each side then looks parts up in an effective catalog: the published parts plus the design's own.
The compiler always receives the published catalog and resolves definitions itself; a supplied
`design:` catalog entry is discarded, never trusted.

Because the synthesized part is a deck fitting, it inherits the compiler's deck-fitting rules
without new code paths: it must seat on a support within 5 cm (`equipment-attachment` with
`fit.gapM` and `fit.seatPosition`), it must keep 10% of its boxes outside the hull, and it adds one
mass contribution at its centre of gravity. It gets no module, obstruction, clearance body, armor
plate, room, opening or hull cell. `a_seated_instance_adds_loading_only_and_nothing_a_shell_can_hit`
asserts that the compiled hull volume, armor surfaces, modules, compartments, obstructions, mounts
and mount clearance are byte-identical with and without instances.

Catalog deck fittings are ignored by shells in the same way, so decision 3 needed no change to
them. Shells test `def.armor`, `def.modules`, `def.connections` and `def.mounts`
(`contacts.rs` `ship_contacts`); a deck fitting produces none of those (`construction.rs`:
`module_kind` is `None` for `deck-fitting`, and "Deck fittings are cosmetic: guns train and fire
through them"). The one indirect effect, shared with every fitting, is mass: it moves the centre of
gravity and waterline, and `hull.mass_kg` feeds `max_hull_integrity` and collision impulses.

Rendering has one builder, `src/game/constructionFittingModel.ts`, which draws solids with the
editor's hull-block geometry (`primitiveGeometry`) and tubes with `constructionTubeGeometry`. The
editor viewport and placement ghost (`equipmentPreview.ts`), palette cards (`slotImages.ts`), port,
battle and GLB export (`constructionModel.ts`) and `ship:view`/`ship:render` (`tools/construction`)
all use it. Solids and tubes with a `paint` keep it; the rest follow the instance paint, then the
ship paint.

## Versioning and deployment

The table is an additive optional field with `version: 1` on each definition, like `tilt`,
`wall` and `path` before it. `construction.version` and `schemaVersion` do not change, and
`fittings` is a late optional field in the Rust generator, so a design without it serializes and
hashes exactly as before (`bun run ship:check all` stays green).

Readers that predate the field fail safe rather than misread:

- The old TypeScript decoder keeps unknown fields, so an old editor preserves `fittings` on save.
- The old Rust compiler ignores the unknown field and rejects each instance as `missing-part`, so
  the design cannot launch there; nothing compiles to a different ship.
- Account storage (`services/api/storage.ts`) stores the source JSON without reading it.

Deploy the compile worker and the Rust server no later than the client. The old worker
(`services/compiler/worker.ts`) counts every equipment row against its limit of 32 and its old
compiler binary rejects `design:` parts, so until it is updated a design with custom fittings is
refused for online play with a clear message. Local play, saving and cloning are unaffected.

## Limits

| Limit | Value |
| --- | --- |
| Definitions per design | 32 (16 online) |
| Instances per design | 512 (96 online), separate from the 128 catalog instances (32 online) |
| Solids / tubes per definition | 48 / 16 |
| Triangles per definition (cell faces plus tubes) | 20,000 |
| Tube | 2–64 points, segments ≥ 1 cm, ≤ 100 m, diameter 0.01–2 m |
| Solid | the hull-piece checks: 0.01–500 m, closed topology, shaping ≤ 45% |
| Local coordinates and overall span | within 100 m |
| Mass | 0.001–1,000,000 kg |

Rust constants are in `construction_custom_fittings.rs`, mirrored by `CUSTOM_FITTING_LIMITS`.
Online limits are in `services/compiler/limits.ts`.

## Phase 1 (built)

- Source table, resolvers, compiler integration, the renderer and its five consumers.
- Commands `fitting` and `fitting-patch`; `remove` accepts a definition and refuses while
  instances outside the command use it; `constructionDiffCommands` covers the table.
- `ship:summary` lists definitions and the separate headroom; `ship:get --ids <definition>` and
  `--kind custom-fitting` return them; `ship:catalog <ship> --query design:` lists the resolved parts.
- Editor: a Custom shelf on the Outfit tab with live cards and `×N` use counts; definition name,
  mass, solid and tube counts, Duplicate definition and Delete definition (disabled while used)
  on the shelf and on a selected instance; a Custom fittings ledger row.

Deferred from the design: `attach: "wall"` and `attach: "internal"`. Wall fittings scale a
published model to a `wall` record and internal parts reserve hull interior; both need compiler
work that phase 1 avoided. The field accepts only `"deck"` so a later version can add them.
Overlapping solids count their volume twice; set `massKg` when that matters.

## Phase 2: Edit shape

An isolation mode on a definition. The viewport hides the ship and shows the definition's solids
at the origin with a deck plane at y = 0; the hull-block tools (place, move, rotate, freeform,
shaping, paint) act on the solids through `fitting-patch`, and leaving the mode returns to the
ship with every instance updated. Tubes reuse the path point editor. The builder tool needs a
target abstraction (design primitives or one definition's solids) rather than a second tool.

## Phase 3: Make fitting from selection, Explode to hull blocks

- Make fitting from selection: selected hull blocks become one definition (positions made local
  to the selection's bottom centre) plus one instance in their place; armor and surfaces are dropped
  after a confirmation that names the lost plating.
- Explode to hull blocks: the reverse for one instance, producing hull pieces with new IDs.

## Phase 4: Export, import and a personal library

Definitions export as JSON and import into another design with ID remapping on collision. An
account-level library (a `ships`-style table) lists a player's definitions across designs; adding
one copies it into the design, so designs stay self-contained.

Promotion into the published catalog stays a Blender job through the parts pipeline.
