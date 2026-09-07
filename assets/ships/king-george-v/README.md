# HMS King George V — early 1941

Playable lead ship of the WWII King George V class, using the same versioned blueprint, catalog, renderer and CPU combat systems as the other presets. Select **HMS King George V** in port or Custom battle, or open `?ship=king-george-v`.

The exterior targets the Home Fleet fit before the December 1941 AA refit. The full-resolution Vickers NPB5265 body plan (1937/38), July 1941 as-fitted profile, upper deck, shelter deck and bridge drawings guide the reconstruction. IWM A3655 (March 1941) and RMG N31777 (2 April 1941) guide appearance. Thirty matched GameModels3D views provide the same raster comparison workflow used for Bismarck. This is an original game reconstruction with documented approximations, not a certified historical replica.

| Authored target | Value | Basis |
| --- | --- | --- |
| Length overall | 227.08 m | RMG B9, rounded |
| Waterline length | 225.6 m | RMG B9, rounded; loading registration approximate |
| Bare hull beam | 31.3944 m | RMG builder-model record, 103 ft |
| Mean draft | 8.8392 m | RMG B9, 1940 standard 29 ft datum |
| Depth at side | 15.5773 m | RMG B9, 51 ft 1.31 in |
| Gameplay displacement | 38,641 t | RMG's 38,031 long tons at standard load |
| Main battery | A: four, B: two, Y: four 14-inch Mk VII | As-fitted plans and IWM A3655 |
| Secondary battery | Eight twin 5.25-inch Mk I | As-fitted plans; four per side |
| Speed | 28 kn | Nominal class speed; handling is game calibration |

The ten main guns use 30-second reloads, 2°/s train, −3°/+40° elevation and 100 AP rounds per barrel. The secondary guns use 8-second reloads, 10°/s train, −5°/+70° elevation and a provisional split of SAP-equivalent/AP and HE ammunition. All 26 bores retain independent elevation, recoil and muzzle chains. Four octuple pom-poms, four UP projectors, directors, cranes, a transverse catapult, one indicative Walrus, boats, four three-bladed screws and paired rudders complete the exterior. Light AA, UP, aircraft and appendage motion are visual only in the current game.

Armor uses separate magazine/machinery belts, stepped lower taper, decks, transverse bulkheads, barbettes and catalog-derived moving gunhouse facets. Machinery, ammunition supply, inspectable flood spaces, closed partitions, damage control and hydrostatic calibration use the shared simulation. Their detailed dimensions and behavior remain provisional.

`blueprint.json` and `build.py` are the build inputs. `author-blueprint.py` preserves the original construction study and also writes the three new entries in `assets/parts/guns.json`. Running it resets later blueprint edits and flooding calibration; use it deliberately, then refit internals and regenerate flooding/stability with the following commands. Normal model builds only need `ship:build`.

```sh
python3 assets/ships/king-george-v/author-blueprint.py
bun assets/ships/king-george-v/fit-internals.ts
bun assets/ships/author-flood-spaces.ts king-george-v
bun assets/ships/author-stability.ts king-george-v
python3 assets/ships/king-george-v/author-evidence.py
bun run ship:compile king-george-v
bun run ship:build king-george-v
bun run ship:independence king-george-v
bun run ship:review king-george-v
bun assets/ships/king-george-v/check-dimensions.ts
bun run ship:check king-george-v
bun test
bun run build
```

Local Blender executes the Python recipe; Blender MCP was not available. The model reads no historical raster or game geometry. The procedural teak is original and baked by the shared exporter. Reference images remain credited, reference-only files under `references/`.

Read the [source register](references/sources.json), [measurement study](references/measurements.json), [discrepancies](reports/discrepancies.md) and [validation record](reports/validation.md). [Fixed review views](generated/review/) and [decoded geometry measurements](reports/dimensions.json) provide build-specific evidence.

The [matched review](generated/comparison/index.html) is also served at `/ship-reference/king-george-v/index.html`. It includes same-camera overlays, historical registration, hull/armor sections, original source images and a portable ZIP. `ship:reference king-george-v` refreshes the isolated WoWS `pbsb107` stock-hull reference; its later radar/light-AA details are not evidence for the 1941 fit. `ship:compare king-george-v` regenerates the review from the current published GLB.

Revision 3 corrects the main gunhouse silhouette against RN mounting plates 2/62 and IWM photographs: upright front plates, continuous side walls, rounded rears, shallow roof crowns, flared rangefinder covers and round-bottomed gun openings. The quadruple and twin profiles are treated separately. See the [same-camera before/after review](reports/visual-iteration-03/README.md). Local mounting dimensions and minor fittings remain interpreted.

The rejected first model, its source recipes, blueprint, published pair and matched views are preserved in [visual iteration 02](reports/visual-iteration-02/before/). Revision 2 rebuilds the hull with 228 stations, reshapes the bridge and gunhouses, and adds open funnel mouths, galleries, original deck services, curved boat hulls and detailed aircraft cranes. The source body-plan readings remain approximate. In particular, the hull needs a 1.2394 uniform buoyancy calibration at the selected load; it is not an as-built hydrostatic reconstruction.
