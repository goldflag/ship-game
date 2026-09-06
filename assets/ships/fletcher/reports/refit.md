# Fletcher model revision 2 — 6 September 2026

This records the previous rebuild. Revision 3 corrects its remaining hull and superstructure errors; see [shape-correction.md](shape-correction.md). Revision-2 source and validation files are preserved under `../baseline/revision-2/`.

The initial prototype was rejected for insufficient model quality. Its recipe, blueprint, five review views and gameplay evidence are preserved in `../baseline/initial-prototype/`.

## Evidence actually inspected

- GameModels3D / World of Warships Fletcher `pasd021`: ten fixed raster views, including bridge, funnels and afterdeck close-ups. A disposable reference stage retains the game version, file hashes, one global scale and camera matrices. Only those rendered images were used during original authoring.
- US Navy ONI 222-US, issued 1 September 1945, printed page 89: actual side and top recognition drawings. The full original page and a PDF extract including the title and Fletcher pages are preserved under `../references/historical/`. These are schematic drawings of a later configuration, not construction blueprints.
- Bureau of Ships / NARA 19-N-31243 and 19-N-31245, 18 July 1942: actual photographs inspected. The 4,994 × 3,699 image of 19-N-31243 resolves the round bridge, director and aerial, high after AA tub, open funnel caps, torpedo decks, boat davits, floats and camouflage character.
- Sigsbee DD-502 general plans and the Bath Iron Works archive were located online. Their full plates were unavailable (blank Zoomify viewer/HTTP 403 for the former, selected full image 404 for the latter). They are recorded as access leads, not measured evidence.

## Original reconstruction decisions

The intended appearance remains the early round-bridge Fletcher in the July 1942 photographs. The GameModels3D model and ONI sheet show later light-AA arrangements; those extra Bofors platforms and fantail gun tub were not introduced into this earlier fit.

| Feature | Previous prototype | Revision 2 |
| --- | --- | --- |
| Hull | 13 coarse station rings, vertical stem, slab-like stern | 100 original fair station rings, finer forward waterlines, raked forefoot, flared bow, rounded overhanging stern, cambered steel deck |
| Bridge | Stacked rectangular boxes | Rounded chart house and pilothouse, lower AA wings, navigation wings, open bridge, portlight band, visor, stairways, peloruses and signal lights |
| Director / mast | Cuboid and generic tripod | Original Mk37-inspired enclosure, optical ends and Mk4-style grid; slender raked pole mast, smaller search array, yard, ladders and signal rigging |
| Funnels | Straight closed cylinders | Raked elliptical lofts, sloping open caps, recessed interiors, grilles, rolled seams, steam pipes, ladders, catwalks and guy wires |
| Five-inch positions | End guns too near bow and stern | Longitudinal centres interpreted from ONI plan: +37.4, +29.7, −20.4, −31.0, −39.5 m in Blender coordinates |
| Torpedo mounts | Almost on the main deck | On the raised machinery deck at 5.28 m, centres +2.0 and −12.3 m; original saddles, tubes, breeches, bands, air lines and trainer stations |
| Depth charges | Simple cylinders and rails | Open roller tracks and gates, rimmed drums, K-gun foundations/cradles/braces and ready-service drums |
| Boats / lifesaving | Solid flattened cylinders | Double-ended open boat shells, thwarts, floor, davits, falls and lashings; capsule floats with gratings, straps and supports |
| Working deck | Sparse blocks | Doors, portlights, louvers, firefighting hoses, gas cylinders, pipework, hatches, capstans, individually linked chain, fairleads, cable reels and fine three-line rails |
| Finish | Flat grey / red materials | Original packed camouflage and light wear texture, dark steel deck, contrasting fittings and hull-following 445 bow numbers |

These placements are engineering interpretations with approximately 0.5–1.5 m longitudinal uncertainty from a small recognition drawing, not published offsets. The second torpedo deck and new funnel surfaces also enter the CPU obstruction/structural-plating definition. Stable gun, torpedo launcher, muzzle, depth-charge release, screw and rudder IDs survive.

The first matching-view pass exposed insufficient cap slope and reversed/offset bow lettering. Both were revised and re-rendered before final validation. The final model has 253,480 triangles and an 11,341,816-byte GLB, within the shared 500,000-triangle / 30 MiB guardrails. These are asset limits, not a fleet frame-rate guarantee.

## Reproduce the inspection

```sh
bun run ship:compile fletcher
bun run ship:build fletcher
bun run ship:check fletcher
bun run ship:review fletcher
# Reference acquisition is isolated; it is not an authoring dependency:
bun run ship:reference fletcher
REFERENCE_SHIP=fletcher /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/reference/render_authored.py
python3 assets/ships/fletcher/review.py
```

The final two commands use the shared matched camera renderer and the original Fletcher report recipe. Re-run them after changing the model or references. `review.py` rejects stale model hashes, image hashes and mismatched camera plans. It preserves a manifest and publishes the local inspection page at `/ship-reference/fletcher/index.html`. Fixed Workbench views use material colour; the in-game captures and GLB thumbnail show the packed camouflage.

No Blender MCP tools were available. Local Blender 5.2 produced the source, GLB and review images. The original-authoring audit recorded only the blueprint-derived definition and original Python component recipes; no raw reference model, original game transform, texture, UV or network input was read by authoring.

See `validation.md` for final runtime and test evidence, and `discrepancies.md` for remaining historical and simulation limitations.
