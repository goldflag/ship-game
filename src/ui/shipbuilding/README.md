# Shipbuilder

The port's **New design** and **Edit design** actions open a source editor around the shared Rust/WASM construction compiler. The preview and the sea-trial callback use the same source revision and compiled result. Layers, tools, placement and rendering live here; solid geometry, armor occupancy, equipment fit, loading, stability and combat definitions come from Rust.

## Layout · "Slipway rails"

The ship fills a dry construction viewport without a ground grid or water plane, over a neutral studio sweep (a radial grey gradient lit at the centre) rather than the port's maritime blue; the chrome is neutral grey and the scene's hemisphere ground light is neutral so paint colours read true. Chrome follows the Fleet action instrument language of [DESIGN.md](../../../DESIGN.md). Compact maritime cards group palette slots, tool buttons and object values; the top bar and ledger stay open to the scene.

- **Top bar.** `‹ Port` saves and returns. The design name is an inline field; the reading beside it (`12 pieces · 7 fittings`) opens the **Designs** menu: a new one-block design, Patrol / Twin hull templates, Save as copy, Download backup, and the local designs with their revisions (open latest, recover a copy, download the original, delete the design). The save state reads *Saved locally*, *Saving…* or *Not saved · keep a backup* in mint or salmon. Layer tabs sit in the middle. Undo and redo show their depth; **SEA TRIALS** is the one brass command and is disabled while a block exists or the revision is compiling.
- **Warnings line** (upper left). `N BLOCKS · M WARNINGS`, expanded to one row per native diagnostic; **W** collapses it. Blocks (salmon) stop a trial and name the fix; warnings (gold) let an unsafe design sail; design notes (mint) are informational. A row with a source reference selects the affected part. Storage or compile errors, layout proposals and short notices appear as rows in the same strip.
- **Tool rail** (left edge) changes with the layer; each tool prints its key. Each button is a bordered maritime card. The active tool has a brass border and tinted fill; enabled toggles (Mirror, Arc) use mint. The last card, **Keys** (`?`), opens a dialog listing every mouse control and hotkey, with each layer's tools taken from the rail definitions.
- **Hotbar** (bottom). Nine square cards keyed **1–9** hold the layer's palette and show the piece itself: hull shapes and catalog parts are rendered from their real geometry by one offscreen context the first time a layer opens (`slotImages.ts`, cached for the session), armor and paint cards are full swatches, and internals tools keep their glyphs. Hovering or focusing a card shows its name and reading in a tooltip; the ballast card also carries a small **100 t** label. The active card is outlined in brass; the trailing `…` opens a boxed panel above the bar with every card. Both Hull and Fittings panels have a search field. Under the cards a readout names the cursor piece with its editable size fields (or a fitting's placement and bearing) and the ghost's cell coordinates; while a selection is being dragged it shows the offset instead. The palette sits above the view controls.
- **Ledger** (right edge). Displacement, draft from the keel, GM, power, speed, usable space and CG, plus a layer-specific row (hull pieces, armor coverage, rooms, fittings, finishes). A reading a warning refers to turns gold or salmon. The mass bar splits hull steel, armor, walls, machinery and fittings, and stores. The Armor layer adds the coverage groups (thickness, material, area, faces).
- **Object tag.** A leader line connects the picked slab, face, wall or fitting to a compact card containing its values and the keys that act on it. Cards wrap long content and use mint or salmon borders for selections or launch blocks. This is the whole properties UI: sizes, positions, bearings and boundary offsets are edited inline in the tag; a fitting's magazine and power links are small selects there. The cursor ghost has no tag.
- **View bar** (lower right). View (cycles Orbit, Plan, Profile, Bow), Slice, snap step, Mirror and Fit. The bar prints no keycaps; the keys live in the Keys dialog and the table below.
- **Orientation compass** (lower left). The mint bow arrow and labeled stern, port and starboard follow the camera in every layer and view, independently of zoom, pan or hull symmetry. A straight-on view explicitly reads **Bow toward you** or **Bow away from you**; at deck height the facing side replaces overlapping side labels. This uses the shared ship coordinates: bow −Z, starboard +X, up +Y.

## Layers

At widths up to 740 px the header uses three compact rows and the palette uses
two rows of five cards, capped at 344 px wide. The cursor size fields and view
controls have separate rows. The shape drawer searches names and notes; its
scrolling area stays above the palette. Smooth curve thumbnails retain cap and
rim edges without drawing every curve facet.

| Layer | Rail | Hotbar |
| --- | --- | --- |
| Hull | Select V · Place B · Fill F · Erase E · Mirror M · Measure T | Cube, Slab, Bar, Wedge, Slope, Long slope, Corner out, Corner in, Plate; searchable drawer with curves, open shells, bridge blocks/panels, breakwater and 100 t ballast |
| Armor | Select V · Paint B · Area A · Eyedrop I · Mirror M · Opening O | Skin 0, Splinter 25, Deck 40, Light belt 50, Belt 100, Heavy belt 200, Turret face 300, Custom … mm, Opening |
| Internals | Select V · Deck D · Bulkhead B · Split L · Merge J · Module U · Suggest G | Deck, Bulkhead, Split, Merge, then the internal packages of the catalog |
| Fittings | Select V · Place B · Rotate R · Arc A · Mirror M · Suggest G | Deck and underwater parts of the catalog, drawer with search |
| Paint | Select V · Paint B · Area A · Eyedrop I · Mirror M | The seven named paints, Two tone, Disruptive |

**Placing.** Pick a slot and hover the ship: the ghost rests on the face under the pointer with its corner snapped to the grid (1 m hull, ¼ m fittings); its cell coordinates read out under the palette beside the piece's name and size fields. Empty space has no placement target or ghost. New designs start with one centered cube; subsequent pieces attach to existing hull faces. A click places; a left drag lays a run along that face; **Fill** drags a rectangle and lays a lattice (at most 128 pieces per gesture). **R** rotates the next piece (90° hull, 15° fittings). With **Mirror** on, an off-centerline placement also places its twin across the centerline; armor and paint applied to a face also reach the mirrored face, including the other side of a piece that straddles the centerline. The complete run or fill appears while dragging, including mirrored pieces and loaded fitting models; releasing commits one undoable edit. Escape or a cancelled pointer discards the pending gesture. In every tool a left drag from empty space orbits (Orbit view) or pans (construction views), right-drag pans, scrolling zooms and the middle button dollies. A stationary right-click removes the targeted piece or fitting.

**Editing.** Click selects, Shift-click adds. In **Select**, a left drag on a hull piece, fitting or wall moves it: pieces slide in the plane of the pressed face (press a side face to move vertically), a wall slides along its own axis, the offset snaps to the grid (1 m for hull pieces and walls, ¼ m for fittings), a brass preview shows the destination with the offset under the palette, and release commits one undoable edit. A pressed piece that belongs to the selection carries the whole selection; otherwise it moves alone and becomes the selection. While placing fittings or modules, a drag on an already fitted part moves it the same way, and a plain click on it selects it. Escape cancels a pending move. **Shift-drag** draws a selection box in any tool and selects the hull pieces and visible fittings it encloses; Ctrl/⌘ with Shift-drag adds to the current selection. Box selection reaches through the hull, respects the slice, and keeps the camera still. Arrow keys nudge a selection (PageUp/PageDown vertically), **R** rotates it, Delete removes it, ⌘D copies it 1 m to starboard and ⇧⌘D mirrors it across the centerline. The tag's fields accept any size from 0.25 to 500 m. **Erase** removes the clicked piece. Hover outlines the whole block in ivory in every hull tool; Armor and Paint outline the hovered face. The last hull block cannot be deleted: bulk deletion keeps one block and its surface assignments. **Measure** takes two clicks and shows the distance and Δx/Δy/Δz.

**Armor and paint.** Hover lights the face under the pointer. Paint (B) assigns the active slot to the clicked face. Area (A) selects every face with that name across the hull; Select and Shift-click build a selection by hand; with faces selected, pressing a slot key assigns it at once. Custom opens a millimetre field in its slot; Eyedrop copies the clicked face's thickness (or paint) into the slot. Opening removes the skin of the clicked face and admits water when submerged; zero armor keeps the structural skin. Two tone and Disruptive apply generic sandbox schemes to the whole hull.

**Internals.** Entering the layer cuts the ship just under the main deck (the highest deck, else the top of the largest hull piece); compiled rooms show as pale blue volumes. Deck, Bulkhead and Split add a boundary at the hovered height, station or offset on the 1 m grid; Merge removes the clicked boundary and joins its rooms. Module places the slot's package with its base on the room floor under the pointer, inset by the skin thickness. Suggest asks the native solver for the missing internal families; the proposal shows as dashed outlines and applies as one undoable edit while its revision is current.

**Fittings.** The ghost of a gun shows its firing arc before placement; Arc toggles arcs for the mounts already fitted. Deck parts attach to the deck under the pointer through their attachment socket, underwater parts to the hull surface. Suggest asks the native solver to place the active slot's part.

| Shortcut | Action |
| --- | --- |
| Ctrl/⌘ Z, ⇧⌘Z or ⌘Y | Undo, redo |
| ⌘D, ⇧⌘D | Copy, mirror-copy the selection |
| ⌘A | Select every hull piece and fitting |
| 1–9 | Hotbar slot |
| Q, S, W, M, R, Home | View, slice, warnings, mirror, rotate, fit |
| ? | Open or close the controls and hotkeys dialog |
| PageUp / PageDown | The selection's height; with Shift, the slice |
| Drag, right-drag | Orbit (pan in construction views), pan; a drag from the hull lays pieces while placing |
| Drag on a piece | Move the piece, fitting or wall (Select; fitted parts also while placing fittings or modules) |
| Shift-drag | Box select; Ctrl/⌘ adds to the selection |
| Right-click | Remove the targeted piece or fitting |
| Delete / Backspace | Remove the selection (a boundary merges its rooms) |
| Escape | Close the drawer or menu, dismiss a proposal, end a measurement, then return to Select and clear |

Shortcuts do not intercept text, number or select fields. The UI admits up to 512 hull primitives, 128 fittings and 24 boundaries; native complexity and fit diagnostics can impose tighter limits on a particular arrangement.

## React integration

Import `Shipbuilder` from `./Shipbuilder` and load a `ConstructionCatalog` with `loadConstructionCatalog`. Required props are `catalog`, `onClose(source, result?)` and `onLaunch(source, result)`. `onClose` runs after a successful save flush, receiving the saved source and its current compiled result when available. It may return a promise; the port uses this to register and display the saved revision before closing. `onLaunch` may return a promise; rejection leaves the editor open with an actionable error. If storage has failed, **TRIAL DRAFT** still supplies the immutable in-memory source to the application.

Optional props:

- `initialSource`: reopen a detached source, including a clean return from a trial. A different saved revision causes a compare-and-swap conflict instead of silently overwriting another tab's work.
- `initialDesignId`: load the latest local source and its exact retained catalog.
- `onSave(source)`: receives the source after an IndexedDB transaction commits. Use it to refresh the owning application's custom roster.
- `starterSource`: override the initial generic template.
- `compileClient`: inject a `BuilderCompiler` for controlled integration tests. The editor owns and disposes this client.
- `createModel`: override the shared source-backed preview composer. Each returned group belongs to the editor and must be independently disposable.
- `suggestLayout(source, partIds, signal?)`: override the native layout request, returning `Promise<ConstructionSuggestion>` with a proposed source and diagnostics. By default the editor calls `ConstructionClient.suggest`. It applies the proposed equipment, boundaries and loads as one undoable edit only while the originating source revision is current. It never runs a separate layout or fit solver in JavaScript.

The default compiler is `ConstructionClient`, using a dedicated module worker. New source revisions cancel obsolete work; completed results must match both source identity and revision before enabling launch. While compilation is pending, or validation returns no surfaces, the viewport renders selectable source hull primitives. Native surfaces replace these display envelopes when available; the envelopes never derive armor, openings, union geometry or physical validity.

`EquipmentPreview` owns a viewport-scoped cache of exact catalog assets, separately from compiled hull geometry. Existing installations keep their meshes through edits and invalid drafts; new instances and the cursor/run ghosts reuse the loaded asset. Source positions, bearings and deletions update immediately. Only initial asset loading or a missing asset uses a bounds fallback. Clones borrow geometry and textures from the cache, which releases them once on catalog change or unmount. The viewport also releases pending loads, geometry, materials, the canvas and its WebGL context on unmount.

Only canonical faces belonging to source hull primitives can receive armor, paint or opening assignments. Native fixed equipment-support surfaces remain rendered and physically inspectable; hull coverage counts only editable exterior hull skin. Fixed supports never become editable hull keys. Face IDs containing colons are retained without splitting the primitive identity.

Module map: `builderLayers.ts` (layers, rails, palettes), `placement.ts` (face-adjacent snapping, runs, fills, mirror twins), `builderReadings.ts` (ledger rows, mass groups, warnings), `BuilderViewport.tsx` (three.js scene, picking, ghost, move drags, tags, arcs), `slotImages.ts` (offscreen card renders of hull shapes and catalog parts), `HelpDialog.tsx` (controls and hotkeys), `DesignsMenu.tsx`, `NumberField.tsx` (inline tag fields), `useBuilderSource.ts` (history, autosave, compile gate). In development the viewport exposes itself as `window.shipbuilderViewport` for browser checks.

## Source storage and recovery

`openConstructionStore()` in `src/ships/constructionStore.ts` opens IndexedDB database `fleet-command-construction`. It returns `list`, `load`, `revisions`, `save`, `remove` and `close`. `save` accepts a source, its schema/catalog versions and `expectedRevisionId`; one transaction writes the immutable revision and advances the design head. A stale head rejects the whole transaction. No compiled geometry, runtime damage or renderer objects are stored.

`ConstructionAutosave` serializes writes and coalesces pending edits. It advances the expected head only after commit and retains the newest unsaved draft after an error. Source undo/redo is separate from autosave and compile results, retaining up to 50 undo steps. Saved revisions remain available after reopening the app; the store does not prune them automatically. Delete in the editor menu or port list uses an inline confirmation and atomically removes the design and every retained revision. Concurrent edits reject a stale deletion, and stale autosaves cannot recreate a deleted head. Deleting the open design drains its writer and opens a new one-block design.

For consumers, prefer `loadSavedConstructionWithCatalog(store, designId)`. It returns the decoded source and its exact immutable catalog. `readConstructionSource` can migrate a detached value through an explicit reader; migrations do not rewrite original revisions. No migration from an unsupported source version is assumed.

The **Designs** menu opens the latest source, downloads an exact original revision or recovers an earlier revision as a new design. Version, catalog, JSON, damaged-index, transaction, concurrent-tab and quota errors remain visible in the warnings line with Download, Retry save and Save a copy actions. Catalog failure never substitutes the current equipment variants. Incomplete physical designs remain saveable; source syntax errors do not replace a prior revision. Keep a downloaded backup if local saving is unavailable or full, then retry or save a new copy after resolving the storage problem.

## Validation

Run the pure command/history/autosave/source-reader tests:

```sh
bun test src/ships/constructionEditor.test.ts src/ships/constructionHistory.test.ts src/ships/constructionAutosave.test.ts src/ships/constructionStore.test.ts src/ui/shipbuilding/editorNumbers.test.ts
bun test src/ui/shipbuilding/placement.test.ts src/ui/shipbuilding/builderReadings.test.ts src/ui/shipbuilding/ArmorInspection.test.tsx
bun test src/ui/shipbuilding/primitiveGeometry.test.ts
bunx tsc --noEmit
bun run build
```

Browser helpers run against the real application toolchain and IndexedDB without test-only storage dependencies. `scripts/diagnostics/shipbuilder.html` mounts the editor alone on the Vite dev server for layout review; import the check modules from that page:

- `checkConstructionStore()` from `scripts/tests/construction-store-browser.ts`: exact large-source close/reopen, competing writers, aborted transaction rollback and source recovery.
- `checkDesignDeletion()` from `scripts/tests/design-deletion-browser.tsx`: editor and port Delete controls, cancellation, conflict recovery, complete revision removal and a fresh starting block after deleting the open design.
- `mountShipbuilderReview()` then `checkShipbuilderEditing()` from `scripts/tests/shipbuilder-browser.tsx`: actual React controls, starter protection, attached placement and stacking, copy/undo/redo references, area selection and armor slots, openings, boundaries, fitting placement, save/reopen and canvas disposal.
- `checkShipbuilderSuggestions()` from the same module: native missing-internal proposals, saved-source isolation, obsolete-proposal fencing, one-command apply and exact undo.
- `checkShipbuilderArmor()` from the same module: area selection, preset and custom millimetre slots, native coverage readings, bulk and clicked-face painting without protection changes, explicit openings and paint undo.
- `checkShipbuilderPlacement()` from `scripts/tests/shipbuilder-placement-browser.ts`: face-only cursor preview, block hover outlines, empty-space rejection, right-drag pan and left-drag orbit while placing, runs, fills, gesture cancellation with the real renderer and native compiler. Synthetic pointer capture is stubbed; repeat camera gestures with browser mouse input to review capture behavior. The primitive geometry test compares preview shapes against native exterior polygons at every supported rotation.
- `checkShipbuilderHullBlocks()` from `scripts/tests/shipbuilder-hull-blocks-browser.ts`: mounts its own review hull and checks the full shape drawer, six bridge search results and empty results, resized/rotated bridge attachment, mirrored curved shells with exact undo/redo IDs, resized ballast with a fixed native 100,000 kg payload, and exact IndexedDB save/reopen. Review thumbnails and responsive layouts separately in the browser.
- `measureConstructionEditing()` from `scripts/tests/construction-editor-performance.ts`: source/history editing, actual worker/WASM compilation and IndexedDB save/reload for the patrol starter and a synthetic large hull. Mass is reported by Rust; this helper does not measure rendering, launch or battle performance.

The helpers are Vite modules for browser evaluation. The review surface is independent of App; exercise port entry, actual trials and custom battles through App as separate integration checks. Temporary browser captures and measurements belong in ignored `.build/`.
