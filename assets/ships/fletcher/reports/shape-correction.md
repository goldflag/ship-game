# Fletcher revision 3: hull and superstructure correction

The revision-2 model still had incorrect major proportions. This correction changes the shape itself and preserves that version's recipe, blueprint, fixed views, matching views and runtime evidence under `../baseline/revision-2/`.

## What was wrong and what changed

- The forward keel rose roughly 30 m before the bow, producing a canoe-like forefoot. The new original station design keeps the deep forward body almost to the stem, with a short raked entry. Bow deck height rises from 4.95 to 6.12 m above the authored waterline.
- Forward waterlines/deck outlines were too fine. A fuller foredeck and original V-section entry now follow the matching plan and bow silhouettes. A flatter floor and fair bilges replace the previous generic rounded section.
- The stern was pointed in plan and its underwater body rose too quickly. The new broad rounded transom and longer afterbody run are authored through the same hull section tables.
- The forward gun deck and bridge were too low. Mount 52's deck is now 7.05 m, and the pilothouse roof 11.10 m. The two bridge tiers share their rounded foreface instead of receding longitudinally into stacked drums.
- Front-view probes showed that simply widening the bridge was wrong: the reference has a narrower central core and pronounced overhanging navigation wings. The final core is 5.30/5.44 m wide, with stepped wings reaching about 10.24 m. The upper observation/flying-bridge envelope is smaller than the first revision-3 trial.
- The forward deckhouse has a rounded front around Mount 52. The after deckhouse is longer, and a compact after AA support house replaces the exaggerated open trestle. Boats, mast and director were repositioned around the revised structure; funnel dimensions and cap curvature were refined.
- Rail/plate seams and bilge-keel roots now follow the authored hull surface so that floating details do not imply the wrong bow shape.

The blueprint owns all hull stations, principal structures, weapon positions and obstruction volumes. Its funnel plating uses the same loft as the visual jacket. Stable gun, torpedo, release, rudder and screw IDs remain intact. Steering and after-magazine envelopes were adjusted to the revised afterbody; the smaller steering compartment holds 58 m³ of floodwater. Handling, weapon counts, damage and reload settings are unchanged.

## Measured comparison

The actual exported GLB is rendered by the shared matching-camera stage. `check-shape.py` reads only those rasters and the preserved GameModels3D rasters. It does not read game geometry, topology, UVs or attachment transforms. Camera plan and image/model hashes must agree. The existing whole-reference scale/registration is unchanged; there is no component fitting.

| Sampled silhouette | Probes | Revision 2 RMS difference | Revision 3 RMS difference |
| --- | ---: | ---: | ---: |
| Bow stem position | 5 | 8.36 m | 0.29 m |
| Forward lower profile | 5 | 2.01 m | 0.40 m |
| Foredeck half-breadth | 3 | 0.49 m | 0.09 m |
| Upper bridge solid width | 5 | 3.82 m | 0.28 m |

These are sparse screen-space probes, not a full-model similarity score. Side/plan resolution is 0.064 m/pixel and the front view is 0.03667 m/pixel. The reference load datum is unverified; a roughly 0.4 m keel-height difference remains while the gameplay draft stays at 4.2 m. The bridge probes measure the uninterrupted solid width at five heights, excluding detached rigging/lights. They do not certify every bridge surface or small fitting.

The source is the already preserved [GameModels3D Fletcher](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pasd021) capture pack, reviewed with the preserved ONI 222-US recognition drawing and dated Navy photographs. The early weapon fit remains distinct from the reference's later AA/antenna arrangement. Exact construction lines, detailed gunhouse geometry, outfit date, paint and underwater appendages remain interpreted. See [discrepancies.md](discrepancies.md).

## Reproduce

The editable version-1 blueprint is the build input. `author-shape.py` preserves this revision's original sparse shape controls and can regenerate the hull/structure fields; run it deliberately, since it replaces those fields in the blueprint.

```sh
python3 assets/ships/fletcher/author-shape.py
bun run ship:compile fletcher
bun run ship:build fletcher
bun run ship:check fletcher
bun run ship:review fletcher
REFERENCE_SHIP=fletcher /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/reference/render_authored.py
python3 assets/ships/fletcher/check-shape.py
# After refreshing the in-game captures for this model hash:
python3 assets/ships/fletcher/review.py
```

Local Blender 5.2 was used; no Blender MCP tools were exposed. Final model: **257888 triangles**, **11533516 bytes**. Content hash: `09030d3f59d3503c8d7540106b1f9c1107b0d6527d5d9cd691641a5136df542b`.

The [comparison page](../generated/comparison/index.html) shows revision 2, revision 3 and the reference with identical cameras, followed by runtime captures and all matching views. Raw probes and limits are retained in [shape-measurements.json](../generated/comparison/shape-measurements.json). See [validation.md](validation.md) for final simulation, build and runtime evidence.
