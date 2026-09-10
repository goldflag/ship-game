# Shōkaku authoring and checks

`generate_blueprint.py` replaces the canonical blueprint from the original arrangement recipe. Run it only for deliberate regeneration. Then run `bun assets/ships/author-stability.ts shokaku` and regenerate local damage profiles before `ship:build shokaku`.

`python3 assets/ships/shokaku/authoring/flight_deck.py` applies the forward lift aperture to an existing blueprint without replacing other authoring data. Full blueprint regeneration calls the same original clipping recipe. Repeating this correction is a no-op once the aperture exists.

The `review_*.py` tools inspect the current source/export for physical attachments, moving-neighbor clearances, gun mechanisms, bridge windows, deck intersections and rudders. Their default diagnostic output is ignored `.build/ships/shokaku/`. They do not write ship reports or reference archives.

Example with local Blender:

```sh
bun run ship:build shokaku
bun run ship:review shokaku
/Applications/Blender.app/Contents/MacOS/Blender -b assets/ships/shokaku/generated/source.blend --python-exit-code 1 --python assets/ships/shokaku/authoring/review_windows.py
/Applications/Blender.app/Contents/MacOS/Blender -b assets/ships/shokaku/generated/source.blend --python-exit-code 1 --python assets/ships/shokaku/authoring/review_decks.py
```

`review_decks.py` also supports `-- --glb public/models/shokaku.glb`. `--out` on the window/deck checks lets you direct temporary output to another ignored location. Old correction baselines were removed with the report archive; these checks operate on the actual current meshes.

For live inspection, start the game and open `/?ship=shokaku`. Evaluate `runtime_review.js`, then `window.shokakuReview.gridSweep()` and `window.shokakuReview.independentPoses()` in the development page. Scripts in `runtime/` exercise close-up cameras, flight operations, firing, damage and reset. Read each fixture before running it; several reset or seed the development battle. Store returned telemetry and decoded screenshots only in `.build/`.

Use a separate local review browser/profile if running `runtime/cdp.mjs`. Stop that isolated browser after inspection. Repeat affected checks after geometry changes; numerical sweeps do not replace visual inspection or historical reference comparison. See the [ship pipeline](../../../../docs/ship-pipeline.md).
