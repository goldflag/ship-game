# Shipbuilder

The port's **Shipbuilder** opens a source editor around the shared Rust/WASM construction compiler. The preview and the sea-trial callback use the same source revision and compiled result. Dimensions, placement commands, selection and rendering live here; solid geometry, armor occupancy, equipment fit, loading, stability and combat definitions come from Rust.

## First design

1. Start with **Patrol hull**, or choose **Connected catamaran** and press **Starter hull**. **Blank** creates an empty, saveable source.
2. Use **Hull** to choose a primitive and set its dimensions. **Place at coordinates** and **Place row** use the displayed grid; **Place** and **Brush** use the viewport's grid plane. Top/orbit uses Y, side uses X and bow uses Z from the placement coordinates.
3. Click to select a piece; Shift-click adds or removes a piece from the selection. Copy makes new stable IDs and selects the copies. Mirror makes a copy across the centerline and preserves its face assignments and equipment links.
4. In **Surfaces**, click exposed faces or select an area group, then apply millimeter thickness, material and a named paint. Armor presets set the next assignment; **Apply to selected faces** commits it. **Inspect selected faces** and **Hull armor coverage** show native thickness, exposed area, material, paint and openings. The mint lines show inward armor depth. **Paint selected faces** and **Paint clicked faces** change only paint, preserving armor and openings. **Open to sea** removes the selected skin; zero armor still retains structural skin. Two-tone and disruptive paints are generic sandbox schemes.
5. **Equipment** places published original variants at their fixed dimensions. **Suggest internals** proposes missing internal equipment families; **Suggest selected fitting** finds a position for the selected variant. Existing equipment stays in place. Inspect the proposed additions or fit errors, then **Apply suggestion** as one undoable edit. **Inspect** exposes placement and magazine/power assignments. Use **Rooms** to add or move decks and bulkheads; deleting a boundary merges its neighboring spaces after compilation.
6. Inspect native diagnostics. Errors prevent trial launch; warnings allow a trial of an unsafe design. **Sea trial** passes an immutable source/result pair to the owning application. Trial damage never enters the source store.

Orbit, Top, Side and Bow are orthographic views. **Fit** frames the hull; **Deck slice** reveals internals below the selected height. At smaller widths, **Tools** and **Inspect** open the corresponding rail while retaining a view of the ship.

| Shortcut | Action |
| --- | --- |
| Ctrl/Command Z | Undo |
| Ctrl/Command Shift Z or Ctrl/Command Y | Redo |
| Ctrl/Command D | Copy selected pieces |
| Ctrl/Command A | Select hull and equipment |
| R | Rotate selection 90 degrees |
| Delete / Backspace | Remove selection |
| Home | Fit ship |
| Escape | Return to selection and clear it |

Shortcuts do not intercept text, number, select or editable fields. Hull coordinates snap to 1 m; equipment coordinates snap to 0.25 m. Numeric fields reject non-finite values. The UI admits dimensions from 1 to 500 m, up to 512 hull primitives, 128 equipment instances and 24 boundaries. One brush gesture has at most 128 placements. Native complexity and fit diagnostics can impose tighter limits on a particular arrangement; these counts are not a frame-rate guarantee.

## React integration

Import `Shipbuilder` from `./Shipbuilder` and load a `ConstructionCatalog` with `loadConstructionCatalog`. Required props are `catalog`, `onClose()` and `onLaunch(source, result)`. `onClose` runs after a successful save flush. `onLaunch` may return a promise; rejection leaves the editor open with an actionable error. If storage has failed, **Trial unsaved draft** still supplies the immutable in-memory source to the application.

Optional props:

- `initialSource`: reopen a detached source, including a clean return from a trial. A different saved revision causes a compare-and-swap conflict instead of silently overwriting another tab's work.
- `initialDesignId`: load the latest local source and its exact retained catalog.
- `onSave(source)`: receives the source after an IndexedDB transaction commits. Use it to refresh the owning application's custom roster.
- `starterSource`: override the initial generic template.
- `compileClient`: inject a `BuilderCompiler` for controlled integration tests. The editor owns and disposes this client.
- `createModel`: override the shared source-backed preview composer. Each returned group belongs to the editor and must be independently disposable.
- `suggestLayout(source, partIds, signal?)`: override the native layout request, returning `Promise<ConstructionSuggestion>` with a proposed source and diagnostics. By default the editor calls `ConstructionClient.suggest`. It applies the proposed equipment, boundaries and loads as one undoable edit only while the originating source revision is current. It never runs a separate layout or fit solver in JavaScript.

The default compiler is `ConstructionClient`, using a dedicated module worker. New source revisions cancel obsolete work; completed results must match both source identity and revision before enabling launch. The preview disposes obsolete groups, geometry, materials and textures, and releases the canvas/WebGL context on unmount. Previous compiled surfaces can remain visible while a new revision compiles; their diagnostics do not enable launch for the new revision.

Only canonical faces belonging to source hull primitives can receive armor, paint or opening assignments. Native fixed equipment-support surfaces remain rendered and physically inspectable; hull coverage counts only editable exterior hull skin. Fixed supports never become editable hull keys. Face IDs containing colons are retained without splitting the primitive identity.

## Source storage and recovery

`openConstructionStore()` in `src/ships/constructionStore.ts` opens IndexedDB database `fleet-command-construction`. It returns `list`, `load`, `revisions`, `save` and `close`. `save` accepts a source, its schema/catalog versions and `expectedRevisionId`; one transaction writes the immutable revision and advances the design head. A stale head rejects the whole transaction. No compiled geometry, runtime damage or renderer objects are stored.

`ConstructionAutosave` serializes writes and coalesces pending edits. It advances the expected head only after commit and retains the newest unsaved draft after an error. Source undo/redo is separate from autosave and compile results, retaining up to 50 undo steps. Saved revisions remain available after reopening the app; the store does not prune them automatically.

For consumers, prefer `loadSavedConstructionWithCatalog(store, designId)`. It returns the decoded source and its exact immutable catalog. `readConstructionSource` can migrate a detached value through an explicit reader; migrations do not rewrite original revisions. No migration from an unsupported source version is assumed.

**Library** opens the latest source, downloads an exact original revision or recovers an earlier revision as a new design. Version, catalog, JSON, damaged-index, transaction, concurrent-tab and quota errors remain visible. Catalog failure never substitutes the current equipment variants. Incomplete physical designs remain saveable; source syntax errors do not replace a prior revision. Keep a downloaded backup if local saving is unavailable or full, then retry or save a new copy after resolving the storage problem.

## Validation

Run the pure command/history/autosave/source-reader tests:

```sh
bun test src/ships/constructionEditor.test.ts src/ships/constructionHistory.test.ts src/ships/constructionAutosave.test.ts src/ships/constructionStore.test.ts src/ui/shipbuilding/editorNumbers.test.ts
bun test src/ui/shipbuilding/ArmorInspection.test.tsx
bunx tsc --noEmit
bun run build
```

Browser helpers run against the real application toolchain and IndexedDB without test-only storage dependencies:

- `checkConstructionStore()` from `scripts/tests/construction-store-browser.ts`: exact large-source close/reopen, competing writers, aborted transaction rollback and source recovery.
- `mountShipbuilderReview()` then `checkShipbuilderEditing()` from `scripts/tests/shipbuilder-browser.tsx`: actual React controls, source references, armor/openings, equipment/boundaries, save/reopen and canvas disposal.
- `checkShipbuilderSuggestions()` from the same module: native missing-internal proposals, saved-source isolation, obsolete-proposal fencing, one-command apply and exact undo.
- `checkShipbuilderArmor()` from the same module: presets, native selected-face/coverage readings, bulk and clicked-face painting without protection changes, explicit openings and paint undo.
- `measureConstructionEditing()` from `scripts/tests/construction-editor-performance.ts`: source/history editing, actual worker/WASM compilation and IndexedDB save/reload for the patrol starter and a synthetic large hull. Mass is reported by Rust; this helper does not measure rendering, launch or battle performance.

The helpers are Vite modules for browser evaluation. The review surface is independent of App; exercise port entry, actual trials and custom battles through App as separate integration checks. Temporary browser captures and measurements belong in ignored `.build/`.
