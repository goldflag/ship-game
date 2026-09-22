# Agent-authored ships that people can still edit

Agents should be able to build ships that look like the real vessel, and the result must stay a
normal construction design that people open, understand and change in the editor. This plan
covers four steps: flexible fittings, visual mesh fittings, a Blender front end and a better
hull fit. None of them is built yet.

Related: [construction authoring](construction-authoring.md), [custom fittings](custom-fittings-plan.md),
[shipbuilding](shipbuilding.md), [reference workflow](reference-workflow.md).

## Why

The 2026-09-22 Scharnhorst pass (PR #445) showed where the construction format, not the tooling,
stops a realistic ship:

- Fittings must sit on hull structure. A searchlight on a mast platform needed a fake plate and a
  post hidden in the mast; the boats needed skid platforms on stanchions; a Flakvierling on a 15 cm
  turret roof was impossible. Balconies must touch the hull or the whole draft is invalid.
- Custom fittings are too small: 32 definitions, 48 solids and 16 tubes each, no per-instance
  scale, deck attachment only.
- Superstructure detail has no good home. Hull pieces are real structure (buoyancy, rooms, flooding,
  hit geometry), so detailed shapes are expensive and must decompose into convex parts (48 face
  planes by default). Compound solids cannot be reshaped in the editor.
- The online limits (`services/compiler/limits.ts`) allow 32 catalog equipment rows, 16 fitting
  definitions and 96 fitting instances. The Scharnhorst has 174 equipment rows, so a realistic ship
  cannot enter an online battle at all.

## Owner's decisions

1. Armor stays one value per face. No internal armored decks or height-cut belts.
2. Propeller efficiency and unmodelled weight are deferred.
3. Non-structural fittings may float: no hull support under them.
4. Custom fitting limits go up substantially.
5. Superstructure looks and structure are separate: a visual mesh fitting carries the detail, a few
   simple editable blocks carry structure, armor and supports.
6. The visual mesh has a detail budget that works in online battles, and it is never armorable.
7. The hull stays the in-game `custom-hull`. Blender may be used to shape it, but the saved hull
   is sections.

## The result, by part

| Part | Source of truth | People can | Agents build it with |
| --- | --- | --- | --- |
| Hull | `custom-hull` sections | Reshape fully | Blender, fitted by `ship:loft` |
| Superstructure structure | A few blocks | Edit, armor, seat guns | Blender export or batches |
| Superstructure and hull detail | Visual mesh fittings | Move, scale, delete | Blender export |
| Guns, boats, masts, deck gear | Equipment rows | Everything | Export or `ship:place` |
| Armor, paint, loads | Face assignments, loads | Everything | Batches, `ship:armor`, `ship:ballast` |

Shells hit the structural blocks, not the visual mesh; blocks that follow the mesh envelope keep
that difference invisible. Moving a block does not move its visual mesh; the person moves the
mesh too, or deletes it and keeps the blocks.

## Step 1: flexible fittings

Deliver in the editor first; every later step builds on it.

### 1a. Non-structural fittings float

Today every fitting except wall fittings and paths needs a hull cell or balcony within 8 cm, and deck
fittings and deck-mounted guns also need a closed plating face under them
(`construction.rs` `equipment()`, steps A and B around `:2902-3014`; `construction_paths.rs:40-60`).

- Drop the support requirement for deck fittings (catalog and custom), directors, masts and
  deck-mounted guns without a well (`construction_installation.rs:148-163`). Guns with wells or
  magazines, torpedo launchers, funnels (uptakes cut the deck), engines, rudders, propellers and
  wall fittings keep their rules.
- Keep a sanity bound: the datum must lie within the ship's hull bounds grown by a fixed margin, so a
  typo 50 m off the beam still fails.
- The editor and `ship:place` still snap to the nearest surface by default; floating is what happens
  when a person or an agent chooses a point in the air (`viewport/picking.ts` gains empty-space and
  equipment targets).
- Balconies stop needing a face contact: skip them in the connectivity search
  (`construction.rs:1015-1087`) and pick a non-balcony anchor. Check whether a balcony can currently
  bridge two hull groups that are otherwise detached; the search walks through balconies although
  they are left out of the hull union.

### 1b. Parents

An optional `parent` on an equipment row names a hull piece or another equipment row. It is how a
floating fitting stays manageable.

- Moving, rotating, copying, mirroring and removing a parent carries its children
  (`constructionEditor.ts` move/rotate/copy/remove, `constructionCommands.ts`).
- Cycles, missing parents and parents that are themselves unsupported are compile errors, never panics.
- Phase 1 parents are hull pieces and non-moving equipment (masts, funnels, directors, deck fittings).
- Phase 2 parents are trainable guns: a Flakvierling on a turret roof trains with the turret. The
  runtime already carries nested mounts (`MountDefinition.parent_mount_id`, `mount_frames.rs`, used by
  Iowa); the construction compiler must set it and order mounts parent-first
  (`construction.rs:3342-3362`), the model must attach children under `${parent}.yaw`
  (`constructionModel.ts`, as propeller supports are reparented today), and child guns need
  overlap, intrusion and clearance exemptions against their parent. Watch `mount_clearance.rs`:
  any nested mount turns off its proximity filter (`:605-617`), which is quadratic with dozens of
  light guns.
- `parent` is optional and skip-if-absent in serialization (`SERDE_DEFAULT_FIELDS` in
  `scripts/multiplayer/generate-rust-definitions.ts`) so existing source hashes do not change.

### 1c. Bigger custom fittings

- Definitions 32 → 256; solids 48 → 256; tubes 16 → 128; tube points 64 → 256.
- The 64-box cap per part (`construction_custom_fittings.rs:245-250`) is why 48 + 16 always fit.
  Replace it with box merging (merge the smallest neighbouring boxes until 64 remain) so the
  compile-time burial and seat checks stay bounded.
- Per-instance `scale: [x, y, z]` on custom fitting instances, applied about the datum with mass
  scaled by the volume factor. Wall fittings already scale per instance
  (`construction_wall_fittings.rs:76-99`); reuse that hook (`construction.rs:2376-2396`).
- Mirrored twins bake the reflection into geometry with flipped winding; a negative scale would
  break render batching (`ShipBatching.ts` drops negative-determinant transforms).
- `attach: "wall"` for side-mounted definitions, following the wall-fitting rules.
- Render each definition once and share its geometry across instances
  (`constructionFittingModel.ts`, `constructionModel.ts:121-131` rebuild it per instance today).

### 1d. Online limits

The online caps in `services/compiler/limits.ts` were set before decorative fittings were
mass-only. Count only equipment that has simulation weight (guns, launchers, directors, machinery,
propulsion) against a raised structural cap, and give decorative rows (deck fittings, custom
instances) their own larger cap. Set the numbers by measuring a maximal realistic design (the
Scharnhorst) against the compile worker's 10 s, 0.5 CPU and 8 MiB artifact limits.

### Acceptance

- The Scharnhorst without its workaround pieces (mast post, searchlight plate, boat-deck stanchions)
  compiles with the same equipment floating or parented, and compiles online.
- Every existing design and published preset compiles byte-identically, or changes only where a
  documented rule changed (bump `COMPILER`, rebuild construction presets, refresh manifests).

## Step 2: visual mesh fittings

A custom fitting definition gains `meshes`: arbitrary triangle meshes, non-convex and open allowed.
They are visual plus mass only, like every custom fitting: no armor, hull, buoyancy, flooding,
modules or hit geometry (`construction_custom_fittings.rs:497-549` already proves fittings stay out
of simulation geometry).

- **Encoding:** quantized positions over the definition bounds and u16 indices, deflated and base64
  encoded (`deflate-q16-u16-v1`), about 7–8 bytes per triangle. The rigging surface's
  `deflate-f32-u32-v1` decoder (`construction_paths.rs:75-110`) is the model for a bounded Rust
  decoder; TypeScript needs a synchronous inflate for the resolver and renderer.
- **Schema:** `meshes: [{id, encoding, data, triangles, vertices, paint?}]` on a version 2
  definition, so an older compiler rejects it instead of ignoring it. A mesh-bearing definition
  requires `massKg` (open meshes have no volume) and may give a centre of gravity. The rendered
  paint comes from the mesh's paint, then the instance, then the ship paint.
- **Budgets (starting values, to be measured):**

| Budget | Local | Online |
| --- | --- | --- |
| Triangles per mesh | 20,000 | 20,000 |
| Unique mesh triangles per design | 100,000 | 50,000 |
| Encoded mesh bytes per design | 1 MiB | 512 KiB |
| Rendered triangles per design (instances × definition) | 1,000,000 | 200,000 |

- Strip mesh data from the compiled definition's echo of the source (`construction.rs:1474` embeds
  the whole source) so match content does not carry it twice.
- Account storage keeps every revision in full (100 MiB per account, `services/api/storage.ts`);
  mesh-heavy designs need content-addressed mesh blobs or revision pruning before this ships online.
- The editor treats a mesh as a unit: select, move, rotate, scale, delete, repaint. No vertex editing.
- A `ship:fitting-mesh` command imports OBJ, STL, PLY or GLB through `parseMeshFile`
  (`scripts/construction/meshFile.ts`), decimates to budget and proposes a guarded batch.
- Seat and burial checks use a few boxes per mesh, not one bounding box.

### Acceptance

- A mesh-built Scharnhorst tower and bridge sit over the existing structural blocks, within the
  online budget, and load in an online battle with the same frame time as the block-built ship.
- The armor view shows no armor on the mesh.

## Step 3: Blender front end

Blender becomes an optional authoring front end whose only output is a revision-guarded batch.
Builds never run Blender; `blueprint.json` stays the only durable source.

- `ship:blender-import <ship>` compiles the source and writes a scratch `.blend` under `.build/`:
  one object per hull piece built from the compiled surfaces grouped by `primitiveId` (the composed
  GLB merges the hull and loses IDs), the custom hull and balconies as locked references, one empty
  per equipment row, visual meshes as meshes, materials named by construction paint ID.
- `ship:blender-export <ship> <file.blend>` reads the scene and proposes a batch:
  - identity lives in custom properties (`constructionId`, `constructionRole`), never object names;
    duplicated IDs get new IDs;
  - blocks → `vertex` primitives (eight-corner when they fit, compound solids otherwise);
  - visual meshes → mesh fitting definitions and instances;
  - empties named by catalog part → equipment rows seated by the native resolver;
  - boxes with the tank role → loads;
  - a sections object → `ship:loft` onto the custom hull;
  - unchanged objects (same shape hash) are skipped, so re-exporting does not churn IDs;
  - `constructionDiffCommands` turns the result into commands; a dry-run compile gates it.
- One frame conversion module, tested both ways (runtime ↔ Blender, bearings clockwise for equipment
  and counter-clockwise for primitives). `ship:mesh --up z` is a reflection today, not a rotation;
  fix it or retire it in favour of the shared conversion.
- One shared Blender launcher (`scripts/build/blender.ts`) replaces the five copies in the ship,
  part and aircraft pipelines, keeping the ship pipeline's audit hook so reference and published
  geometry cannot enter a scene.
- Rules to rewrite: `docs/shipbuilding.md:19-20` ("Player designs never pass through Blender"),
  `docs/construction-authoring.md:3-5` and `:852`, `assets/AGENTS.md:10`, `docs/ship-pipeline.md:3`,
  and a construction variant of step 4 of the MCP loop in `docs/ship-build-reference.md:44`.

### Acceptance

- An agent imports the Scharnhorst, rebuilds the tower and bridge in Blender against the reference
  and exports it; the batch compiles, a person edits a gun and a block in the editor, and a second
  export keeps those edits.

## Step 4: hull fit

Research on the cached Scharnhorst reference: the forward sections are not star-shaped at any
centre (wine-glass sections with a narrow waist and a wider forefoot), so a better centre cannot fix
the bow fold. A horizontal band cut does.

1. **Loft, script only:** keep a flat bottom (a chine point above the keel instead of forcing a V),
   sample outlines at the cut's own vertices, resample by arc length between pinned corners, and
   report the pinned creases (`scripts/construction/loft.ts`, `slice.ts`).
2. **Band-cut fallback in the compiler:** when a span fails the star check, cut it into horizontal
   bands between mirrored outline points; each band is a symmetric trapezoid slab with its own
   centre. Only failing spans take the fallback, so every hull that compiles today stays
   byte-identical (prove it on Valiant and the Scharnhorst). Mirror it in the loft's
   `foldFailures` and the editor preview caps.
3. **Crease markers:** a per-hull list of crease contour positions that splits the side smoothing
   groups (#431 made every side one smoothing group) and pins those points when the editor
   redistributes an outline. Lighting only; the compile is unaffected.
4. **More sections:** raise 4–24 to 4–48. Compile and buoyancy cost grow linearly for hulls that use
   them; the section ruler and panel lists need attention.
5. **Later:** a stem profile (per-point z offset at an end station) so a raked forefoot survives; it
   touches every bow transform, so it waits.

### Acceptance

- `ship:loft` fits the Scharnhorst reference end to end, without hand-shaped ends, and the Atlantic
  bow knuckle shows as a crease.

## Order and deployment

1. Step 1a + 1c + 1d, then 1b phase 1, then 1b phase 2.
2. Step 2.
3. Step 3, which depends on 1 and 2 for the fittings it exports.
4. Step 4 can run in parallel with 2 and 3.

Every format change is optional and skip-if-absent, bumps `COMPILER` where compile output changes,
and deploys the compile worker and server before the client, so an old compiler never silently builds
a ship without the new fields.

## Open questions

- Should masts and directors, which carry modules or gun-arc obstructions, float freely,
  or only when parented?
- Are the starting online budgets right? They should be set by measurement, not taken from this page.
- Paint on visual meshes: one paint per mesh, per material group, or vertex colours from Blender?
