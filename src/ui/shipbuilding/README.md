# Shipbuilder

The port's **New design** and **Edit design** actions open a source editor around the shared Rust/WASM construction compiler. The preview and the sea-trial callback use the same source revision and compiled result. Layers, tools, placement and rendering live here; solid geometry, armor occupancy, equipment fit, loading, stability and combat definitions come from Rust.

## Layout · "Slipway rails"

The ship fills a dry construction viewport with a fine ground grid below the hull and no water plane, over a neutral studio sweep (a radial grey gradient lit at the centre) rather than the port's maritime blue; the chrome is neutral grey and the scene's hemisphere ground light is neutral so paint colours read true. Chrome follows the Fleet action instrument language of [DESIGN.md](../../../DESIGN.md). Compact maritime cards group palette slots, tool buttons and object values; the top bar and ledger stay open to the scene.

- **Top bar.** `‹ Port` saves and returns. The design name is an inline field; the reading beside it (`12 pieces · 7 fittings`) opens the **Designs** menu: New design with a hull preset or one-block start, Armed patrol / Twin hull templates, Save as copy, Download backup, and account designs with their revisions (open latest, recover a copy, download the original, delete the design). The save state reads *Saved*, *Saving…* or *Not saved · keep a backup* in mint or salmon. Undo and redo show their depth; **SEA TRIALS** is the one brass command and is disabled while a block exists or the revision is compiling.
- **Warnings line** (upper left). `N BLOCKS · M WARNINGS`, expanded to one row per native diagnostic; **W** collapses it. Blocks (salmon) stop a trial and name the fix; warnings (gold) let an unsafe design sail; design notes (mint) are informational. A row with a source reference selects the affected part. Storage or compile errors, layout proposals and short notices appear as rows in the same strip.
- **Tool rail** (left edge) holds what a click does. A **Tools** caption heads the layer's modes and one-shot actions; each tool prints its key. Each button is a bordered maritime card and the active tool has a brass border and tinted fill. A **Modifiers** caption under the tools opens the two cards that change where a click lands: **Mirror** (`M`, mint when on) and **Snap** (`N`), a split toggle whose arrow opens target, spacing and guide settings. The size button beneath Snap shows the current grid spacing; click it or press **S** to cycle. Spacing choices in the popover are a button row. Alt/Option temporarily inverts snapping. Freeform keeps Snap available alongside its local mirror axes and move step. Selected pieces also offer **Center**, using mounting centers for fittings and retaining group spacing. The last card, **Keys** (`?`), opens a dialog listing every mouse control and hotkey, with each layer's tools taken from the rail definitions.
- **Palette dock** (the whole bottom edge). A transparent tab row carries the layer tabs (Hull, Armor, Internals, Fittings, Paint) as folder tabs whose open tab joins the solid card row beneath, with the hotkey legend at the row's right end. The card row lists the layer's entire selection as square cards, the first nine keyed **1–9**; it scrolls sideways, fades at whichever edge hides cards, and keeps the trailing `…` pinned. Cards show the piece itself: catalog parts use pre-baked PNGs from their exact published geometry (`bun run part:thumbnails`); hull shapes render through one offscreen context the first time the layer opens (`slotImages.ts`, cached for the session), armor and paint cards are full swatches, and internals tools keep their glyphs. Hull cards print the piece's metres in their bottom-left corner and the vertex hull card wears its corner handles; the ballast card also carries a small **100 t** label. Hovering or focusing a card shows its name and reading in a tooltip. The active card is outlined in brass; `…` (**0**) opens a boxed panel above the dock with every card in a grid. On Fittings a chip row sits between the tabs and the cards: eight shelves (Main battery at 100 mm and up, Light & AA, Torpedoes, Fire control, Superstructure, Running gear, Deck gear, Boats & aviation) choose which cards the row and keys **1–9** carry, and a nation filter at the row's right end (All plus the navies with parts on that shelf) keeps that navy's parts with the generic ones; the choice stays put across shelves and does nothing on a shelf without that navy. Shelf and nation are read off the part in `fittingCategories.ts` (kind, gun calibre, id prefix), not from the catalog. The Fittings panel lists every shelf and nation under shelf headings, and choosing a card there opens its shelf on the bar. Both Hull and Fittings panels have a search field, which takes focus; **0** on the empty field closes the panel again, and Escape always does. A card's tooltip stands above the dock and ends with its key. Above the cards a readout names the cursor piece with its editable size fields (or a fitting's placement and bearing) and the ghost's cell coordinates; while a selection is being dragged it shows the offset instead, and the open drawer takes its place. The view strip ends the card row at the right. Below 1240 px the tabs collapse to glyphs and the strip folds into rows of three.
- **Ledger** (right edge). Length, beam and height of the hull in metres, displacement, draft from the keel, GM, list (degrees to port or starboard, from the offset between the centers of gravity and buoyancy over the roll GM), trim (degrees by the bow or stern, marked ≈ because its longitudinal GM is estimated from the waterplane area and hull length), power, speed, usable space and CG, plus a layer-specific row (hull pieces, armor coverage, rooms, fittings, finishes). A reading a warning refers to turns gold or salmon. The mass bar splits hull steel, armor, walls, machinery and fittings, and stores. The Armor layer adds the coverage groups (thickness, material, area, faces).
- **Object tag.** A leader line connects the picked slab, face, wall or fitting to a compact card containing its values and the keys that act on it. Cards wrap long content and use mint or salmon borders for selections or launch blocks. Invalid components are tinted salmon red; their launch-block card appears only while the component is hovered. This is the whole properties UI: sizes, positions, bearings and boundary offsets are edited inline in the tag; a propeller's **Engine** select shows the automatic assignment and accepts a manual override. Guns have a **Turret rise** field that extends their barbette while keeping its magazine low in the hull. Magazines are built into weapons; Internals shows their volumes and selects the owning weapon. The cursor ghost has no tag.
- **View strip** (the card row's right end) holds how the ship is shown, never what a click does: one captioned ground of bare glyph squares in two groups, View (cycles Orbit, Plan, Profile, Bow), Camera and Fit, then the overlays Centers and, on the Fittings layer, Arcs (`A`, gun traverse arcs). Squares carry no captions or key badges so the strip never reads as a second tool rail; the tooltip carries name, value and key. Hull and fittings remember separate snap choices for the editor session, starting at 1 m and 0.25 m; placement and drags use the enabled snap targets; arrow-key nudges use the chosen step and typed position fields stay exact. The floor grid grows with the hull and fades out about one hull length past it, with brass chevrons pointing toward the labeled bow (−Z). Large grids show multiples of the snap step to limit visual density. Camera toggles Perspective (the default) and Orthographic while retaining the framing; P works in every layer and freeform mode. The choice lasts while the editor stays open. Centers toggles the small gold center-of-gravity dot (tagged CG above it) and mint center-of-buoyancy dot (tagged CB below it) together, initially off; the choice lasts while the editor stays open. The bar prints its shortcuts; they also appear in the Keys dialog and the table below.
- **Hotkey legend** (the dock's tab row, right end). The bottom row lists the standing keys: cards **1–9**, **0** for every card, **Q** view and **Home** fit. A row above it, in ivory, lists the keys that act on the cursor piece, the selection or the picked faces: rotate, nudge, raise or lower, copy, mirror copy, remove, Shift-click, and what Escape does next. Rows wrap upward; keys the rail, warnings lead and undo buttons already print stay off it, and the legend hides below 860 px wide or 800 px tall.
- **Orientation compass** (lower left, above the dock). The mint bow arrow and labeled stern, port and starboard follow the camera in every layer and view, independently of zoom, pan or hull symmetry. A straight-on view explicitly reads **Bow toward you** or **Bow away from you**; at deck height the facing side replaces overlapping side labels. This uses the shared ship coordinates: bow −Z, starboard +X, up +Y.

At widths up to 1100 px selection tags scroll within their available height. At 740 px and below, the ordinary editor stacks the design and the history/trial actions; the layer tabs spread across the dock's tab row as glyphs and the view strip folds into rows of three. A connected-path prompt gets a bounded, scrolling card beside the tool rail and above the palette, with Finish and Cancel side by side. The compass moves above that prompt, and the cursor-coordinate reading is hidden while drawing.

## Model memory debug panel

Press **F8** to toggle a nonmodal memory panel for the currently open ship; F8 or
Escape closes it. The Keys dialog lists the shortcut. Switch designs normally to
inspect another ship. Search by part name or source ID, sort by visual/simulation
size, and expand the simulation section breakdown.

All sizes use decimal MB. Simulation reports the current compiled definition's
runtime projection as UTF-8 JSON and indexed NSD encoding, not live Rust/WASM heap
allocations. Per-part simulation rows attribute explicitly identified records;
anonymous collision cells and ship-wide data remain in the shared row. Visual
measurements sum retained geometry backing buffers once plus an RGBA8/mipmap
texture allocation estimate. Shared buffers/textures are apportioned among users;
batched hull resources follow source triangle counts. These are not GLB transfer
sizes or total CPU/GPU process memory. Materials, driver allocations, editor
helpers and unused equipment cache entries are excluded. Source JSON is separate.

Simulation data updates on compilation; loaded visual resources are sampled every
1.5 seconds only while open. Invalid/currently compiling revisions and unloaded
fittings are labeled incomplete, and old revision totals are not presented as
current. `modelMemory.test.ts` covers byte attribution and shared-resource accounting.

## Layers

At widths up to 740 px the header uses two compact rows and the card row
scrolls. The shape drawer searches names and notes; its scrolling area stays
above the dock. Smooth curve thumbnails retain cap and
rim edges without drawing every curve facet.

| Layer | Rail | Hotbar |
| --- | --- | --- |
| Hull | Select V · Place B · Fill F · Erase E · Measure T | Cube, Slab, Bar, Wedge, Slope, Long slope, Corner out, Corner in, Freeform hull; searchable drawer with Plate, curves, open shells, bridge blocks/panels, breakwater and 100 t ballast |
| Armor | Select V · Paint B · Area A · Eyedrop I · Opening O | Armor (the millimetre field above the bar), Opening |
| Internals | Select V · Deck D · Bulkhead B · Split L · Merge J · Module U · Suggest G | Deck, Bulkhead, Split, Merge, then the internal packages of the catalog |
| Fittings | Select V · Place B · Rotate R · Suggest G | Deck and underwater parts of the catalog on eight shelves with a nation filter, drawer with search |
| Paint | Select V · Paint B · Area A · Eyedrop I | The seven named paints, Two tone, Disruptive |

**Placing.** Pick a slot and hover the ship: the ghost rests on the face under the pointer using the enabled grid, centerline and nearby geometry targets; its cell coordinates read out above the palette beside the piece's name and size fields. Empty space has no placement target or ghost. New designs choose a single editable custom hull preset or one centered cube; subsequent pieces attach to existing hull faces. Select a custom hull and choose **Edit hull sections** to edit its shape; **Apply hull** is one undoable source edit and retains equipment positions. A click places; a left drag lays a run along that face; **Fill** drags a rectangle and lays a lattice (at most 128 pieces per gesture). **R** rotates the next piece (90° hull, 15° fittings). With **Mirror** on, an off-centerline placement also places its twin across the centerline; armor and paint applied to a face also reach the mirrored face, including the other side of a piece that straddles the centerline. The complete run or fill appears while dragging, including mirrored pieces and loaded fitting models; releasing commits one undoable edit. Escape or a cancelled pointer discards the pending gesture. In every tool a left drag from empty space orbits (Perspective or Orbit view) or pans (orthographic construction views), right-drag pans, scrolling zooms and the middle button dollies. A stationary right-click removes the targeted piece or fitting.

**Fitting paint.** Select a fitting and use **Paint** in its object tag, or choose a swatch on the Paint layer and click the fitting. Select several fittings on the Paint layer to recolor them together. Mirror also paints an existing matching twin. **Original finish** restores the component’s authored materials. The last paint applied to a fitting becomes the default for newly placed fittings, mirrored copies and connected paths for the rest of the editor session; painting hull faces does not change that default. Paint is saved per fitting, supports undo/redo, and carries through sea trials and model exports.

**Editing.** Click selects, Shift-click adds. Selected hull blocks in **Select** show the freeform-style X/Y/Z movement gizmo in ship coordinates, plus a center handle for dragging in the view-facing coordinate plane. A multi-selection moves together. Gizmo drags, face drags, keyboard nudges and position fields stop at other blocks’ oriented bounds; touching faces can slide along one another, and fast drags cannot jump through a block. These bounds include deformed freeform corners and conservatively enclose curved shapes and openings. Existing overlapping drafts can be moved out along a shortest separating direction. The live offset says when another block stops movement; blocked moves do not add undo entries. In **Select**, a left drag on a hull piece, fitting or wall moves it: pieces slide in the plane of the pressed face (press a side face to move vertically), a wall slides along its own axis, the offset follows the enabled snap targets, a brass preview shows the destination with the offset above the palette, and release commits one undoable edit. A pressed piece that belongs to the selection carries the whole selection; otherwise it moves alone and becomes the selection. While placing fittings or modules, a drag on an already fitted part moves it the same way, and a plain click on it selects it. Escape cancels a pending move. **Shift-drag** draws a selection box in any tool and selects the hull pieces and visible fittings it encloses; Ctrl/⌘ with Shift-drag adds to the current selection. Box selection reaches through the hull and keeps the camera still. Arrow keys nudge a selection (PageUp/PageDown vertically), **R** rotates it, Delete or ⌘X removes it, ⌘C copies it 1 m to starboard and ⇧⌘C mirrors it across the centerline. The tag's fields accept any size from 0.25 to 500 m. **Erase** removes the clicked piece. Select, Erase and Measure outline the hovered block in ivory; placement keeps the support block clear and shows only the pending piece or path. Armor and Paint outline the hovered hull face. Fittings and internal items outline their model geometry on hover, including while painting fittings. The last hull block cannot be deleted: bulk deletion keeps one block and its surface assignments. **Measure** takes two clicks and shows the distance and Δx/Δy/Δz.

**Armor and paint.** Hover lights the face under the pointer. Paint (B) assigns the active slot to the clicked face. Area (A) selects every face with that name across the hull; Select and Shift-click build a selection by hand; with faces selected, pressing a slot key assigns it at once. There are no thickness presets: the Armor card carries the millimetre value typed into the field above the bar (0 mm keeps the structural skin), and changing that value with faces selected assigns them at once. Eyedrop copies the clicked face's thickness (or paint) into the slot. Opening removes the skin of the clicked face and admits water when submerged; zero armor keeps the structural skin. Two tone and Disruptive apply generic sandbox schemes to the whole hull.

The custom hull section editor also offers **Red lower hull** and **Red paint Y**: a coating boundary in meters from the hull center, saved with the design. See [red paint height](../../../docs/shipbuilding.md#custom-hull-red-paint-height) for defaults and behavior.

Custom hulls expose individual panels between neighboring sections, plus separate bow and stern caps. Armor view draws their boundaries without internal triangle diagonals. The selected-face tag carries an inline **Face armor** field in millimetres; editing it applies to the selected panels, including their opposite partners when Mirror is enabled. This reuses the existing tag, number-field and selection styling. See [custom hull panel armor](../../../docs/shipbuilding.md#armor-on-custom-hull-panels) for assignment persistence when hull sections change.

**Internals.** Internal packages, weapons owning built-in ammunition, and room boundaries can be selected, moved or removed, including through the hull. Selected modules show the XYZ movement gizmo in Select and Module, with the current snap step, drag preview, cancellation and undo. Selected decks and bulkheads show only the axis that changes their offset; groups share a gizmo at their center. Entering the layer clears external selections; box selection and select-all exclude hull blocks and external fittings without built-in ammunition. Entering the layer keeps the complete ship visible through its translucent hull; room bounding boxes are omitted so the hull silhouette stays clear. Internal powerplants need to fit entirely within free hull interior, without a surface-contact requirement. Deck, Bulkhead and Split add a boundary at the hovered height, station or offset on the chosen snap grid. Placed boundaries and placement/move previews follow the hull section, preserving holes and gaps rather than spanning the ship’s bounding box. Native boundary material is clipped to the hull interior, so only real interior equipment intersections block validation; Merge removes the clicked boundary and joins its rooms. Module places the slot's package with its base on the room floor under the pointer, inset by the skin thickness. Suggest asks the native solver for the missing internal families; the proposal shows as dashed outlines and applies as one undoable edit while its revision is current.

**Fittings.** The ghost of a gun shows its firing arc before placement; Arc toggles arcs for the mounts already fitted. Deck parts attach to the deck under the pointer through their attachment socket, underwater parts to the hull surface. Suggest asks the native solver to place the active slot's part.

The searchable drawer includes bitts, a fairlead, capstan, anchor windlass, stowed anchor, lifeboat with davits, cowl and mushroom vents, watertight door, deck hatch, vertical ladder, inclined stairs, compact optical rangefinder and **Searchlight (unlit)**. These are generic naval parts with estimated dimensions and loading. The rangefinder uses the director family; other fixed deck fittings add mass without buoyancy or a combat bonus. Doors and hatches remain closed models and do not create hull openings. The boat and davits remain stowed. The searchlight is static and has no beam, light source, power demand or detection behavior.

Railing, rope and chain cards draw connected paths: click each point on the ship, then press **Enter**, double-click or choose **Finish**. **Backspace** or **Ctrl/⌘Z** removes the last pending point; **Escape** cancels without changing the design. Pending points remain outside source, autosave and history; finish or cancel before using Port, Designs or Sea trials. The whole route (including its mirrored copy) commits as one undoable edit. The brass preview shows the pending route and points before committing. Railing points are deck-level feet; rope and chain can also snap to fixed fittings’ explicit support or rigging sockets. Rope **slack** is the vertical sag at the midpoint of each segment, adjustable in metres. It is limited to half the shortest segment and 20 m; routes support 2–64 points and at most 500 m. Native compilation checks physical attachment and clearance.

Select a path to edit its bearing, position, individual point coordinates and rope slack in its object tag. The point selector reaches every route point; **Insert point** adds a midpoint between the selected point and its neighbor, and **Remove point** keeps at least two points. Point coordinates are relative to the route origin; translation, rotation, copy and mirror preserve the route. Railing previews use three rails and regularly spaced posts with visible feet. Rope and chain use the same 16 intervals per segment as native loading; chain links and line members use shared instanced geometry. Light fittings read in kilograms.

The editor opens every design on the newest equipment catalog. Once that catalog loads, a design saved against an older revision moves onto it: every state in its undo history is rebased, so Undo never restores the old library, and the new revision saves. Fitted parts whose variant changed recompile with the new variant. A design keeps its saved revision only when the newest catalog no longer has a part it has fitted; **Designs** then names the missing parts. Old source revisions and catalogs remain available for undo and recovery.

| Shortcut | Action |
| --- | --- |
| Ctrl/⌘ Z, ⇧⌘Z or ⌘Y | Undo, redo |
| ⌘C, ⇧⌘C | Copy, mirror-copy the selection |
| ⌘A | Select every hull piece and fitting |
| 1–9, 0 | Hotbar slot; every card of the layer |
| Q, P, W, M, R, Home | View, camera projection, warnings, mirror, rotate, fit |
| N, Alt/Option, S | Toggle snapping, temporarily invert snapping, cycle grid spacing |
| ? | Open or close the controls and hotkeys dialog |
| PageUp / PageDown | The selection's height |
| Drag, right-drag | Orbit (pan in orthographic construction views), pan; a drag from the hull lays pieces while placing |
| Drag on a piece | Move the piece, fitting or wall (Select; fitted parts also while placing fittings or modules) |
| Shift-drag | Box select; Ctrl/⌘ adds to the selection |
| Right-click | Remove the targeted piece or fitting |
| Delete / Backspace / ⌘X | Remove the selection (a boundary merges its rooms) |
| Escape | Close the drawer or menu, dismiss a proposal, end a measurement, then return to Select and clear |

Shortcuts do not intercept text, number or select fields, and ⌘C / ⌘X stay with the browser while nothing is selected. The UI admits up to 10,000 hull primitives, 128 fittings and 24 boundaries (`CONSTRUCTION_LIMITS` in `constructionEditor.ts`, mirroring the native compiler); native complexity and fit diagnostics can impose tighter limits on a particular arrangement.

## Repository authoring

[Agent construction authoring](../../../docs/construction-authoring.md) connects
this same editor to repository source files. `repositoryId` and `openStore` select
the file adapter; `onEditorReady` supplies the shared batch/save interface. The
local Designs menu imports JSON as an independent local copy.

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

Module map: `builderLayers.ts` (layers, rails, palettes), `placement.ts` (face-adjacent snapping, runs, fills, mirror twins), `pathDrawing.ts` (pending route points and support-socket anchoring), `PathPointEditor.tsx` (inline route coordinates, point insertion/removal and rope slack), `builderReadings.ts` (ledger rows, mass groups, warnings), `builderTool.ts` (the builder tool: layer, tool, selection, cursor piece, snap, gestures and keys as one plain module that reads pointer events with their targets already raycast and submits command batches), `builderScene.ts` (the plain render description and pointer events crossing the viewport seam), `BuilderViewport.tsx` (the three.js adapter: raycasting, ghost, move drags, floor grid, tags, arcs), `MoveHandles.ts` (selection translation gizmo), `blockMovement.ts` (continuous movement clearance against oriented block bounds), `slotImages.ts` (offscreen card renders of hull shapes and catalog parts), `HelpDialog.tsx` (controls and hotkeys), `DesignsMenu.tsx`, `NumberField.tsx` (inline tag fields), `useBuilderSource.ts` (the React adapter: storage opening, catalog resolution and `useSyncExternalStore` over the modules), `src/ships/compiledRevision.ts` (compile debounce, cancellation and the one acceptance predicate), `src/ships/constructionRevisionOwner.ts` (history, the single edit door with its readiness rule, revision adoption, autosave ordering and conflict recovery). In development the viewport exposes itself as `window.shipbuilderViewport` for browser checks.

## Source storage and recovery

`openConstructionStore()` in `src/ships/constructionStore.ts` opens IndexedDB database `fleet-command-construction`. It returns `list`, `load`, `revisions`, `save`, `remove` and `close`. `save` accepts a source, its schema/catalog versions and `expectedRevisionId`; one transaction writes the immutable revision and advances the design head. A stale head rejects the whole transaction. No compiled geometry, runtime damage or renderer objects are stored.

`ConstructionRevisionOwner` owns editable history, the acknowledged save head and
source adoption for replacement, repository reload and polling. `submit(label,
commands)` is its one edit door: it refuses while the store is still opening or
an operation holds the design (`setBusy`), and returns the refusal instead of
dropping the edit; `applyBatch` is the same door for agents and throws the
rejection. Edits enqueue synchronously, so the agent editor handle can apply,
read and flush a revision in one turn. `CompiledRevision` compiles each revision
after a debounce and exposes `current` only for the exact source revision and
adoption, keeping the last accepted result for display. The React hook
subscribes to those snapshots and handles browser lifecycle.

`ConstructionAutosave` serializes writes and coalesces pending edits. It advances the expected head only after commit and retains the newest unsaved draft after an error. Source undo/redo is separate from autosave and compile results, retaining up to 50 undo steps. Saved revisions remain available after reopening the app; the store does not prune them automatically. Delete in the editor menu or port list uses an inline confirmation and atomically removes the design and every retained revision. Concurrent edits reject a stale deletion, and stale autosaves cannot recreate a deleted head. Deleting the open design drains its writer and opens a new one-block design.

For consumers, prefer `loadSavedConstructionWithCatalog(store, designId)`. It returns the decoded source and its exact immutable catalog. `readConstructionSource` decodes a detached value through an explicit reader and never rewrites the original revision. A source whose schema version differs from the reader's is refused.

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

`bun run ship:browser:check` automates the repository-authoring, storage,
design-deletion and shipbuilder-editing helpers below in headed Chromium;
append `--headless` for CI. It uses disposable files and fresh browser storage.
Install Chromium with `bunx playwright install chromium`, or set
`CONSTRUCTION_CHROME` to an existing executable. Failure screenshots are saved
under ignored `.build/construction-browser/`.

Browser helpers run against the real application toolchain and IndexedDB without test-only storage dependencies. `scripts/diagnostics/shipbuilder.html` mounts the editor alone on the Vite dev server for layout review; import the check modules from that page:

- `bun scripts/tests/shipbuilder-armament-browser.mjs <vite-url>` checks legacy magazine conversion, the Turret rise field and Page Up / Page Down, fixed magazine position, invalid-fit launch blocking, saving and undo against the native compiler.
- `checkInternalsSelection()` and `checkEquipmentPaletteImages()` from `scripts/tests/shipbuilder-internals-browser.ts`: layer-scoped selection/movement/deletion and decoded, non-empty pre-baked images for every fitting/internal catalog card.
- `checkConstructionStore()` from `scripts/tests/construction-store-browser.ts`: exact large-source close/reopen, competing writers, aborted transaction rollback and source recovery.
- `checkDesignDeletion()` from `scripts/tests/design-deletion-browser.tsx`: editor and port Delete controls, cancellation, conflict recovery, complete revision removal and a fresh starting block after deleting the open design.
- `mountShipbuilderReview()` then `checkShipbuilderEditing()` from `scripts/tests/shipbuilder-browser.tsx`: actual React controls, starter protection, attached placement and stacking, copy/undo/redo references, area selection and armor slots, openings, boundaries, fitting placement, save/reopen and canvas disposal.
- `checkShipbuilderSuggestions()` from the same module: native missing-internal proposals, saved-source isolation, obsolete-proposal fencing, one-command apply and exact undo.
- `checkShipbuilderArmor()` from the same module: area selection, the millimetre thickness field, native coverage readings, bulk and clicked-face painting without protection changes, explicit openings and paint undo.
- `bun scripts/tests/shipbuilder-boundaries-browser.mjs <vite-url>` checks Deck, Bulkhead and Split previews and placed planes against the native hull volume, verifies that room bounding boxes are absent, and captures each tool in `.build/boundary-review/`. Section geometry regressions cover taper, translation, rotation, hollow openings and separate hulls in `boundaryGeometry.test.ts`.
- `bun scripts/tests/shipbuilder-movement-browser.mjs <vite-url>`: real pointer capture for selection gizmos, collision stops, coordinate fields, keyboard nudges, cancellation, undo/redo, and desktop/compact captures in `.build/move-review/`. Collision geometry regressions live in `blockMovement.test.ts`. `bun scripts/tests/shipbuilder-internals-gizmo-browser.mjs <dev-server-url>` checks actual pointer drags on internal module and bulkhead gizmos, undo, cancellation, Module-tool snapping and internal-only group selection; captures stay in `.build/internal-gizmo/`.
- `checkShipbuilderPlacement()` from `scripts/tests/shipbuilder-placement-browser.ts`: face-only cursor preview, block hover outlines, empty-space rejection, right-drag pan and left-drag orbit while placing, runs, fills, gesture cancellation with the real renderer and native compiler. Synthetic pointer capture is stubbed; repeat camera gestures with browser mouse input to review capture behavior. The primitive geometry test compares preview shapes against native exterior polygons at every supported rotation.
- `checkShipbuilderHullBlocks()` from `scripts/tests/shipbuilder-hull-blocks-browser.ts`: mounts its own review hull and checks the full shape drawer, six bridge search results and empty results, resized/rotated bridge attachment, mirrored curved shells with exact undo/redo IDs, resized ballast with a fixed native 100,000 kg payload, and exact IndexedDB save/reopen. Review thumbnails and responsive layouts separately in the browser.
- `mountDeckFittingsReview()`, `checkDeckFittingsEditor()` and `checkDeckCatalogUpgrade(retainedRevision)` from `scripts/tests/shipbuilder-deck-fittings-browser.ts`: the complete fitting deck, static searchlight asset, pending connected routes, stable identity through undo/redo, rope picking/slack/save/reload, and an explicit library update that preserves authored source and restores the retained catalog on undo.
- `measureConstructionEditing()` from `scripts/tests/construction-editor-performance.ts`: source/history editing, actual worker/WASM compilation and IndexedDB save/reload for the patrol starter and a synthetic large hull. Mass is reported by Rust; this helper does not measure rendering, launch or battle performance.

The helpers are Vite modules for browser evaluation. The review surface is independent of App; exercise port entry, actual trials and custom battles through App as separate integration checks. Temporary browser captures and measurements belong in ignored `.build/`.

## Freeform hull editing

Hull selection tags and the Freeform rail button enter the eight-corner editor for a single box or freeform hull. `FreeformToolbar.tsx` owns Vertex/Edge/Face selection, local mirror axes, selection position/center entry, Move step (also G), nearby-corner matching and the Split popover. `FreeformShapeTools.tsx` adds reversible round/chamfer edge sets on one block. `freeformShape.ts` supplies preview geometry and mirrored edge selection; `construction_freeform.rs` owns native solid generation and validation. The ordinary palette, placement mirror and hotkey readout yield space during the session.

`FreeformHandles.ts` owns source face/edge picking, screen-sized focusable handles, affected-component highlights and a local-axis movement gizmo. The center/component handle drags in the camera-facing local plane. Axis handles constrain explicitly; arrow keys nudge the focused axis. It uses the active orthographic or perspective camera and previews detached primitive replacements. Pointer release commits one source command. Cancellation never writes history, storage or neighboring hulls.

`constructionVertex.ts` maps the selected vertex, edge or canonical face to corners. One renderer-free transform locks translations that conflict with local symmetry, expands mirrored edits without duplicate motion, then matches neighboring corners against the original source snapshot. Neighbor matching uses 0.025 m independently of Move step; no seam relationship persists. `construction_vertex.rs` retains authority over the physical solid and canonical face identities; source preview fans match its boundary geometry. The saved `kind: "vertex"` format accepts optional version-1 `shaping` controls while preserving old corner-only drafts.

The edit-session baseline is separate from undo history and changes only when a new session begins. Reset restores that block's session-entry shape, including its original kind. Changing layer, tool or design ends the session. Selecting another editable block starts a fresh baseline; selecting other objects ends freeform mode. Native compile gating, autosave, fixed equipment placement and fit warnings remain shared with ordinary primitive edits.

Validation includes `src/ships/constructionVertex.test.ts`, vertex cases in `primitiveGeometry.test.ts`, native construction tests, and `checkFreeformEditor()` / `checkFreeformDrags()` from `scripts/tests/freeform-editor-browser.ts`. Browser helpers exercise the production controls, native compilation, XYZ combinations, rigid edges/faces, the visible view strip, step cycling, nearby-corner undo/redo, projections, split, cancellation and exact IndexedDB reopen. Use real mouse drags separately to verify browser capture and one-command commits. `mountFreeformReview()` mounts a two-block fixture for that review.

## Fine fitting rotation

Fine fitting rotation uses right-drag (0.5° per pixel, or 0.1° with Shift), with one undo step on release for installed fittings. Shift-R turns fittings 1°; R retains its 15° turn. See [fine fitting rotation](../../../docs/shipbuilding.md#fine-fitting-rotation). The viewport retains ghost meshes across bearing changes and retains the pointer position when the cursor changes. `checkShipbuilderRotation()` in `scripts/tests/shipbuilder-rotation-browser.ts` covers stationary hotkeys, fractional cursor and installed rotation, undo/redo, cancellation and camera panning.

## Component palette images

Run `bun run part:thumbnails` after publishing equipment or changing `slotImages.ts` lighting/framing. It renders the current and retained catalogs into content-addressed PNGs under `public/models/components/thumbnails/`, without altering immutable model publications, and writes `src/generated/construction-thumbnails.json`. The index includes model, renderer-recipe and image hashes; `bun run build` checks freshness with `bun run part:thumbnails --check`. Commit the images and index together. Published cards use ordinary image requests; parts from an unknown catalog retain on-demand rendering as a compatibility fallback.

Freeform shaping regression coverage: `src/ships/freeformShape.test.ts` checks native/preview surface and volume agreement, mirror transforms, corner edits and source/history round trips; `scripts/tests/freeform-shaping-browser.ts` exercises the production controls and worker compilation.

## Snapping

`snapping.ts` resolves grid, ship centerline and source geometry alignment in screen space;
`SnapControls.tsx` exposes the shared session settings and `SnapOverlay.ts` draws non-interactive
lines and markers without labels. `BuilderViewport` caches authoring features per source revision
and supplies the active camera projection. Fittings use attachment sockets rather than barrel
bounds; coplanar triangle seams are excluded. Placement, paths, face drags and move/freeform
handles share the resolver. Geometry beats grid per axis, respects constrained movement, and
retains acquired targets until the larger release radius. Collision rejection clears snap feedback.
Exact coordinates pass through the tool without a second rounding operation.

See [snapping controls](../../../docs/shipbuilding.md) for keyboard, visibility and centering behavior.

`snapping.test.ts` covers target precedence, screen-space thresholds, hysteresis, constrained
axes, support seating and guide independence. `checkSnapping()` from
`scripts/tests/shipbuilder-snapping-browser.ts`, run on the diagnostic page, checks the
production controls, precision, undo, live Alt overrides and freeform cancellation.
