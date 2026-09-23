# Working on the ship editor

Read [README.md](README.md) for behaviour. The data model, compiler and storage are in
[docs/shipbuilding.md](../../../docs/shipbuilding.md).

- `Shipbuilder.tsx` is the shell (header, rail, dock tabs, ledger). `builderTool.ts` holds editor state, every
  action and the hotkeys (`key()`); `HelpDialog.tsx` lists the hotkeys separately, so change both.
  `BuilderViewport.tsx` is the Three.js viewport (picking, ghosts, previews) with `MoveHandles.ts`,
  `RotateHandles.ts` and `FreeformHandles.ts`. `CustomHullEditor.tsx` and `CustomHullViewport.tsx` edit an
  adjustable hull's sections. `mirrorEditing.ts`, `snapping.ts`, `placement.ts` and `internalPlacement.ts` are
  pure helpers with tests beside them.
- Dock tabs are Hull, Machinery, Armament, Outfit, Internals, Paint and Armor. Machinery, Armament and Outfit
  are shelves over one fittings layer (`fittingCategories.ts`); browser checks use these tab names.
- Edits are commands on a versioned source (`src/ships/constructionCommands.ts`, `constructionPatches.ts`,
  `constructionEditor.ts`). The Rust compiler (`crates/naval-sim/src/construction*.rs`) is the authority on
  validity; the editor never decides that a design is launchable.
- The catalog is always the latest (`adoptCatalog`); a new part needs publishing, not a design migration.
- The editor renders with WebGL, not WebGPU: `BuilderViewport.tsx` and `CustomHullViewport.tsx` use a plain
  `THREE.WebGLRenderer`, and the model keeps the `MeshStandardMaterial`s `constructionModel.ts` builds. Port
  and battle swap those for TSL node materials (`ShipMaterialPalette`, `ShipSurfaceDetail` plating and wear,
  `HullWetBand`) and add ship ambient occlusion (`ShipOcclusion`); none of that runs in the editor. Anything
  the editor must show has to live in geometry, vertex data or plain material properties (colour, map,
  roughness, metalness).
- Verify in a browser: `bun run ui:shot -- --state editor --design "<saved design>"` for a capture, and
  `bun run ship:browser:check -- --only <name>` for one check (`--list` shows all). Checks listed in
  `scripts/construction/known-browser-failures.json` are already red on master.
- The viewport cancels drags, ghosts and tooltips on window blur, so capture through the harness (`shot()` uses
  CDP), never `page.screenshot()`.
