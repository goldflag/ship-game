# Shipbuilder (editor UI)

The port's **New design** and **Edit design** open this editor around the Rust/WASM construction
compiler. Layers, tools, placement and rendering live here. Solid geometry, armor, fit, loading,
stability and the combat definition come from Rust.

- Source format, compiler, catalog, storage and limits: [docs/shipbuilding.md](../../../docs/shipbuilding.md).
- Repository-backed ships and the agent editor handle:
  [construction authoring](../../../docs/construction-authoring.md).
- Seeing a change in the real game: [browser verification](../../../docs/browser-verification.md).
- Visual language: [DESIGN.md](../../../DESIGN.md).

## File map

State and editing logic (no React, no three.js):

| File | Role |
| --- | --- |
| `builderTool.ts` | The builder tool: layer, tool, selection, cursor piece, snap, gestures and **all keys** (`key()`); submits command batches |
| `builderLayers.ts` | Pure data: `BUILDER_TABS`, `BUILDER_RAIL` (tools and their keys), `DEFAULT_TOOL`, `HULL_SHAPES`, `paletteFor` |
| `builderScene.ts` | The seam to the viewport: `BuilderScene` render description and `BuilderPointerEvent` |
| `useBuilderSource.ts` | React adapter: store opening, catalog resolution and adoption, `useSyncExternalStore` |
| `src/ships/constructionRevisionOwner.ts` | History, the single edit door, autosave ordering, conflict recovery |
| `src/ships/compiledRevision.ts` | Compile debounce, cancellation and the one acceptance predicate |
| `placement.ts`, `blockMovement.ts`, `mirrorEditing.ts` | Face-adjacent placement, runs, fills, `mirrorTwin`; movement clearance; reflected edits |
| `snapping.ts`, `customHullSnap.ts` | Grid, centerline and geometry snap resolution in screen space |
| `pathDrawing.ts`, `internalPlacement.ts`, `balconyPlacement.ts`, `boxSelection.ts`, `internalSelection.ts` | Per-gesture helpers |
| `builderReadings.ts`, `turretArmor.ts`, `propellerAssignment.ts`, `blockDimensions.ts`, `modelMemory.ts` | Ledger rows, mass groups, warnings and read-only readouts |
| `customHullEditing.ts` | Pure custom hull section operations |

Viewport (three.js):

| File | Role |
| --- | --- |
| `BuilderViewport.tsx` | Raycasting, ghost, move drags, right-drag rotation, tags, arcs. Exposes `window.shipbuilderViewport` in dev |
| `MoveHandles.ts`, `RotateHandles.ts`, `FreeformHandles.ts` | Translation, three-axis rotation and freeform gizmos |
| `SnapOverlay.ts`, `itemOutline.ts`, `surfaceOutline.ts`, `builderGrid.ts` | Guides, hover outlines, floor grid |
| `pendingHull.ts`, `primitiveGeometry.ts`, `boundaryGeometry.ts`, `equipmentPreview.ts` | Display-only geometry while a compile is pending; cached catalog assets |
| `CustomHullViewport.tsx`, `CustomHullPreview.tsx` | The custom hull editor's own viewport |

Chrome (React):

| File | Role |
| --- | --- |
| `Shipbuilder.tsx`, `Shipbuilder.css` | The whole screen: top bar, rail, dock, ledger, drawer, object tags |
| `ViewBar.tsx`, `SnapControls.tsx`, `BuilderOrientation.tsx` | View strip, Snap cell and popover, compass |
| `HelpDialog.tsx` | Keys dialog; tool keys are read from `BUILDER_RAIL` |
| `DesignsMenu.tsx`, `NewDesignDialog.tsx`, `TrialControls.tsx`, `ModelMemoryPanel.tsx` | Menus, dialogs, sea-trial panel, F8 memory panel |
| `FreeformToolbar.tsx`, `FreeformShapeTools.tsx`, `FreeformMeshTools.tsx`, `RotationToolbar.tsx` | Freeform and Rotate mode panels |
| `CustomHullEditor.tsx`, `HullSectionRuler.tsx`, `HullPaintControls.tsx`, `BalconyEditor.tsx` | Full-screen section editor; balcony outline editor |
| `NumberField.tsx`, `WallSizeFields.tsx`, `RailingFields.tsx`, `AccessFields.tsx`, `PathPointEditor.tsx`, `SurfaceFinishSelect.tsx` | Inline tag fields |

Catalog and palette:

| File | Role |
| --- | --- |
| `fittingCategories.ts` | Fitting tab, shelf and nation, derived from the part (kind, calibre, mount, id prefix), not stored in the catalog |
| `hullCategories.ts` | Hull type chips |
| `slotImages.ts`, `builderGlyphs.tsx` | Card renders and line glyphs |

`hull-prototype/` and `propeller-playground/` are standalone review pages (`bun run hull:prototype`,
`bun run propeller:playground`), each with its own `NOTES.md`.

## Screen layout

All placements below are in `Shipbuilder.tsx` and `Shipbuilder.css`.

- **Top bar** (`.sb-top`): `‹ Port` saves and returns; inline design name; the pieces/fittings
  reading opens the **Designs** menu; save state; the **Checks** chip; undo/redo; **SEA TRIALS**.
  Sea trials need a current compiled definition with no blocks. If saving has failed the button
  reads **TRIAL DRAFT**.
- **Checks chip** (`.sb-warn`, in the top bar): reads *Checks pending*, *Checking design…* or the
  block/warning count. **W** or a click opens the list in a panel under the bar. Rows with a
  source reference select the affected part. Storage errors, compile errors, layout proposals
  and notices open the same panel. Messages never appear in the rail.
- **Tool rail** (`.sb-rail`, left edge): one joined column of glyph cells, in this order:
  1. The layer's tools and actions from `BUILDER_RAIL`, each printing its key; on Hull also
     **Freeform (D)**.
  2. Modifiers: **Mirror (M)** and **Snap (N)** with its spacing row and settings arrow.
  3. **View strip** (`ViewBar.tsx`, `.sb-viewbar`): View (Q), Camera (P), Fit (Home), then Centers (C)
     and, on the fitting tabs only, Arcs (A). Cells carry no key badges; keys show in the tooltip.
     The view strip is inside the rail, not on the dock. It is hidden in freeform mode.
  4. Foot: **Center** (only with a selection) and **Keys (?)**.
- **Palette dock** (`.sb-dock`, the full-width bottom bar):
  1. Tab row (`.sb-dock-tabs`): the seven tabs, with the hotkey legend (`.sb-keys`) at its right end.
  2. Shelf row (`.sb-shelves`): Hull type chips, fitting shelves plus nation filter, or the Paint
     selectors (Ship paint, Surface finish).
  3. Card row (`.sb-hotbar`): every card of the layer, first nine keyed **1–9**, trailing `…`
     (**0**) opening the drawer (`.sb-drawer`) above the dock. Hull and fitting drawers have search;
     a fitting search reaches all three fitting tabs.
- **Ledger** (`.sb-ledger`, right edge): hull dimensions, displacement, draft, GM, list, trim,
  power, speed, space, CG, a mass bar, and on Armor the thickness groups and read-only
  **Turret armor** list.
- **Object tag**: a leader line from the picked item to a card with its values. This is the
  whole properties UI; there are no XYZ position fields.
- **Orientation compass** (`.sb-orientation`): lower left, above the dock.

Responsive rules: tabs collapse to glyphs at 1240 px wide and below; the hotkey legend hides at
860 px wide or 800 px tall and below, where the rail also scrolls; 740 px and below stacks the
header.

## Tabs and layers

There are five layers (`BuilderLayer`) but seven dock tabs (`BUILDER_TABS`), in this order: Hull,
Machinery, Armament, Outfit, Internals, Paint, Armor. Machinery, Armament and Outfit are three tabs
over the one `fittings` layer: they share its rail, tools and selection, and each reopens the
shelf it last showed.

| Tab | Layer | Rail (`BUILDER_RAIL`) | Opens in |
| --- | --- | --- | --- |
| Hull | `hull` | Select V · Rotate O · Place B · Fill F · Erase E · Measure T, plus Freeform D | Select |
| Machinery · Armament · Outfit | `fittings` | Select V · Place B · Erase E · Rotate R · Suggest G | Place |
| Internals | `internals` | Select V · Deck D · Bulkhead B · Split L · Merge J · Module U · Erase E · Suggest G | Module |
| Paint | `paint` | Select V · Paint B · Area A · Eyedrop I · Erase E | Paint |
| Armor | `armor` | Paint B · Fill A · Eyedrop I · Erase E | Paint |

Fitting shelves (`FITTING_CATEGORIES`): Machinery has Running gear, Funnels, Masts; Armament has
Main battery, Light & AA, Torpedoes, Fire control; Outfit has Mooring, Access, Fixtures,
Boats & aviation, Doors & windows. Browser checks must use these tab names, not "Fittings".

Layer notes:

- **Hull.** Pieces attach to existing hull faces only; empty space has no ghost. A click places,
  a drag lays a run, Fill lays a lattice, at most 128 pieces per gesture. Blocks may overlap
  while each keeps 10% of its volume outside the others (checked natively). The last hull block
  cannot be deleted.
- **Fittings.** Deck parts attach through their socket, underwater parts to the hull surface.
  Railing, rope and chain cards draw connected paths (Enter or double-click finishes, Backspace
  removes a point, Escape cancels). Pending points stay out of source, autosave and history.
- **Custom fittings.** <a id="custom-fittings"></a>The Outfit tab's **Custom** shelf lists the open
  design's own fitting definitions (`construction.fittings`) with cards drawn live from the
  definition and a `×N` count of fitted instances. A card arms placement like any deck fitting;
  instances select, move, rotate, mirror, copy, paint and delete like catalog fittings and have
  their own limit (ledger row **Custom fittings**, 1,000). The shelf strip and a selected instance
  show the definition's name (editable), mass, solid and tube counts, **Duplicate definition** and
  **Delete definition**, which is disabled while instances use it (`CustomFittingFields.tsx`).
  A definition with visual meshes reads "mesh, N triangles"; the mesh is a unit (select, move,
  rotate, scale, delete; no vertex editing), and each named mesh group has its own paint picker
  (**instance paint** follows the instance and ship paint). The Armor view never shows armor on it.
  Shapes are not editable in the editor yet; agents define them with the `fitting` command or
  `ship:fitting-mesh`. See
  the [plan](../../../docs/custom-fittings-plan.md).
- **Parents.** <a id="parents"></a>A selected fitting that may float (deck fittings, masts, light
  deck guns without a well) shows **Attached to**: *Nothing* or one of the twenty nearest hull
  pieces and fittings that can carry it (deck fittings, masts, funnels, directors; never itself or
  what it carries). A parent's tag reads **carries N**. Moving, turning, copying, mirror-copying and
  removing a parent carries its riders, in the handles' previews too; a removal's undo label and
  notice count the attached fittings. Hull-block quarter turns and the Rotate toolbar carry riders
  through a pure yaw only. The rules are in
  [construction authoring](../../../docs/construction-authoring.md#parents).
- **Internals.** Entering it clears external selections. Deck, Bulkhead and Split add
  boundaries; Merge removes one; Module places a package on the first floor inside the hull.
- **Paint.** Keeps a face selection. **Ship paint** is `construction.paint`; **Surface finish**
  is `construction.finish`. The last paint applied to a fitting becomes the session default.
- **Armor.** A paint bucket with no selection: the active card is laid on clicked or swept faces.
  The Armor card carries the typed millimetre value; thicknesses in use follow as cards; Opening
  removes skin. Turret armor is read-only, drawn from the compiler's gunhouse mesh
  (`turretArmor.ts`).
- **Mirror.** Places twins across the centerline and applies edits to an existing twin. Twins are
  found geometrically (`mirrorTwin` in `placement.ts`); the source stores no link, except wall
  fittings, which keep a persistent `wall.mirrorId`.

Mouse: left-drag from empty space orbits (pans in orthographic views), right-drag pans, wheel
zooms. Right-drag on a fitting rotates it, 0.5° per pixel or 0.1° with Shift. A stationary
right-click never removes anything; use Erase or Delete. Shift-drag box-selects in any tool.

## Hotkeys

- Global handling: `BuilderTool.key()` in `builderTool.ts`. `Shipbuilder.tsx` attaches the window
  `keydown` listener, excludes text fields and the help dialog, and handles **F8** itself.
- Tool keys: the `key` of each `BUILDER_RAIL` entry in `builderLayers.ts`.
- The user-facing list: `HelpDialog.tsx` (**?**). Update it when adding a key.
- The dock legend: the `acting` and `standing` hints in `Shipbuilder.tsx`.
- The custom hull section editor has its own listener in `CustomHullEditor.tsx`.

| Key | Action |
| --- | --- |
| ⌘Z, ⇧⌘Z or ⌘Y | Undo, redo |
| ⌘C, ⇧⌘C, ⌘X, ⌘A | Copy, mirror-copy, remove, select all |
| 1–9, 0 | Palette card; open or close the drawer |
| Q, P, Home, C, A | View, camera projection, fit, centers, gun arcs (fitting tabs) |
| W, M, N, S, Alt/Option | Checks, mirror, snap, cycle grid spacing, invert snap while held |
| R, Shift-R | Rotate about the vertical: ±90° hull, 15° / 1° fittings; quarter-turn wall fittings |
| X, Y, Z (Hull) | Quarter-turn the cursor block or selection in pitch, yaw, roll |
| O (Hull) | Rotate mode with three-axis rings |
| D (Hull) | Enter or finish Freeform for one selected editable shape |
| 1–4, G, O (Freeform) | Vertex, edge, face, ring mode; move step; projection |
| Arrows, PageUp/PageDown | Nudge by the snap step, raise or lower; arrows resize wall fittings |
| Delete, Backspace | Remove the selection (a boundary merges its rooms) |
| F8, ? | Model memory panel, Keys dialog |
| Escape | Close a panel, cancel a gesture, then return to the layer's default tool |

## Freeform and shape editors

Source formats for these are in [docs/shipbuilding.md](../../../docs/shipbuilding.md#freeform-hulls).

- **Freeform** (D): `FreeformToolbar.tsx` owns Vertex/Edge/Face/Ring modes (Face is the default,
  last mode is remembered), local mirror axes, the **Twin** control, Move step and Split.
  `FreeformShapeTools.tsx` adds round/chamfer; `FreeformMeshTools.tsx` adds rings and prism outline
  points. `FreeformHandles.ts` draws handles and the local-axis gizmo. One drag is one command;
  cancellation never writes history. The session baseline for **Reset edit** is separate from undo.
- **Rotate** (O): `RotationToolbar.tsx` holds no source state; `RotateHandles.ts` previews until
  release. Orientation math is `src/ships/constructionOrientation.ts`.
- **Custom hull sections**: select a custom hull and choose **Edit hull sections**.
  `CustomHullEditor.tsx` covers the builder with Orbit, Section, Plan and Profile views (keys 1–4),
  a station ruler and its own snapping. **Apply hull** is one undoable source edit.
- **Balcony outline**: **Edit balcony outline** opens `BalconyEditor.tsx`, a plan drawing with
  draggable points and per-edge Open / Railing / Triple railing / Solid wall.

## Compilation and preview

`CompiledRevision` waits one second after the last committed edit, then compiles only the newest
revision in a worker (`ConstructionClient`). Opening a design and explicit retries skip the wait.
The ledger keeps the last accepted readings, marked **last check**. While a compile is pending,
`pendingHull.ts` shows source envelopes for changed pieces and keeps unaffected native faces;
these never enter the compiled result. `EquipmentPreview` caches catalog assets per viewport, so
fitted models survive edits and invalid drafts. Compile completion does not refit the camera.

The editor adopts the newest equipment catalog on open; see
[equipment catalog](../../../docs/shipbuilding.md#equipment-catalog).

## React integration

Import `Shipbuilder` from `./Shipbuilder`. Required props: `catalog` (from
`loadConstructionCatalog`), `onClose(source, result?)` and `onLaunch(source, result)`; both may
return a promise. Optional props:

- `initialSource`, `initialDesignId`, `starterSource`: what to open.
- `onSave(source)`: called after a save commits.
- `openStore`, `repositoryId`, `onEditorReady`: repository authoring (see construction authoring).
- `compileClient`, `createModel`, `suggestLayout`: test and integration overrides. Layout
  suggestions always come from the native solver; there is no JavaScript fit solver.

Storage is `openConstructionStore()`: the account cloud store when signed in, IndexedDB
otherwise. See [storage](../../../docs/shipbuilding.md#identity-storage-and-local-authority).

## Verifying a change

Unit tests sit beside their modules (`*.test.ts`). Run the ones you touched with `bun test <files>`,
then `bunx tsc --noEmit` and `bun run build`. `bun run test` runs everything and fails only on
failures that are not in `scripts/tests/known-failures.json`.

Browser checks (headed Chromium; registry and flags in `scripts/construction/check-browser.ts`):

```sh
bun run ship:browser:check -- --list                         # registered and unregistered checks
bun run ship:browser:check -- --only shipbuilder-editing     # one registered check by name
bun run ship:browser:check -- --only shipbuilder-placement-browser.ts#checkShipbuilderPlacement
```

`--only` takes a registered name or `<file>#<export>` for any module under `scripts/tests/`, and
accepts a comma list. Checks listed in `scripts/construction/known-browser-failures.json` are
reported as known red. Failure screenshots go to ignored `.build/construction-browser/`.

One image of the real editor with a saved design:

```sh
bun run harness:designs        # once per machine: cache the test account's designs
bun run ui:shot -- --state editor --design "Fletcher design" --out .build/shots/editor.png
```

`--state editor` requires `--design`; `bun run ui:shot -- --list` names the saved designs. Do not
write a new diagnostics page or Playwright launcher; extend `scripts/browser/harness.ts`. Details
are in [browser verification](../../../docs/browser-verification.md).

Standalone feature checks under `scripts/tests/` (`shipbuilder-*-browser.*`, `freeform-*-browser.*`,
`hull-paint-bands-browser.mjs`) take a running Vite URL, for example
`node scripts/tests/shipbuilder-snapping-browser.mjs <vite-url>`. Captures belong in ignored `.build/`.
`scripts/diagnostics/shipbuilder.html` mounts the editor alone for layout review.
After publishing equipment or changing `slotImages.ts` lighting, run `bun run part:thumbnails`.

The previous, longer README is preserved verbatim at the end of the
[shipbuilding log](../../../docs/archive/shipbuilding-log.md); it is history, not guidance.
