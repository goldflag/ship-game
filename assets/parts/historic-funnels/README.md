# Historical funnel components

Original, individually installable funnels for the versioned construction catalog. GameModels3D's World of Warships models are the only visual references. Production recipes use hand-authored metric sections and fittings; reference meshes, materials and textures are never builder inputs.

The dates below are the **source resource's asset-year labels**, not independently established historical refits. Each reference uses the site's default `A_Hull`. Funnel positions were identified in the complete mid-hull source before extracting a viewing-only comparison. Emden represents the aft real funnel, not an improvised fourth funnel.

| Catalog ID | Source model / position | Navy | Published triangles |
| --- | --- | --- | ---: |
| `dreadnought-aft-funnel` | [Dreadnought 1906](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pbsb503), aft | UK | 2,226 |
| `hood-forward-funnel` | [Hood 1941](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pbsb507), forward | UK | 2,878 |
| `nelson-funnel` | [Nelson 1944](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pbsb517), sole | UK | 3,098 |
| `emden-aft-funnel` | [Emden 1908](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pgsc502), aft | Germany | 2,498 |
| `mikasa-forward-funnel` | [Mikasa 1905](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pjsb011), forward | Japan | 2,830 |
| `clemson-forward-funnel` | [Clemson 1930](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pasd019), No. 1 | USA | 2,002 |
| `dunkerque-funnel` | [Dunkerque 1940](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pfsb506), sole | France | 3,702 |
| `kirov-forward-funnel` | [Kirov 1938](https://gamemodels3d.com/en/games/worldofwarships/vehicles/prsc525), forward | USSR | 2,906 |
| `aosta-forward-funnel` | [Duca d'Aosta 1943](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pisc506), forward | Italy | 5,384 |
| `cesare-forward-funnel` | [Giulio Cesare 1943](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pisb505), forward | Italy | 2,338 |
| `blyskawica-funnel` | [Błyskawica 1938](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pwsd501), single trunked funnel | Poland | 2,618 |
| `aurora-middle-funnel` | [Aurora 1917](https://gamemodels3d.com/en/games/worldofwarships/vehicles/prsc001), middle | Imperial Russia | 2,354 |
| `scharnhorst-funnel` | [Scharnhorst 1939](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pgsb507), sole | Germany | 5,874 |

## Construction and publication

`geometry.py` registers separate builders through `construction-library.json`; Duca d'Aosta and Scharnhorst use the more detailed `aosta.py` and `scharnhorst.py` recipes, so refining either leaves the other funnels' revisions alone. `construction.json` remains the authoritative installation definition. `part:inputs <id>` declares the shared original `construction/geometry.py` helper and appearance inputs. Authoring axes are +X forward, +Y port, +Z up; the standard exporter performs the documented conversion once.

The attachment socket is the flat sole at runtime Y=0. The inlet and one metre of below-deck occupancy fit inside the supporting hull. Measured bounds include ladders, pipes, rails and platforms; the default collision envelope conservatively encloses those fittings. The outlet follows the raked cap's centre. Original root metadata gives the renderer the actual mouth width and length; the existing smoke renderer reads the installed, rotated `exhaust-out` socket. Machinery simulation and propulsion formulas are unchanged. Starter designs fit the Clemson package, the smallest of these funnels, now that the RN corvette funnel is retired. Mass and exhaust capacity are game estimates comparable to existing catalog packages, not historical measurements.

Recipes favor 32-segment casings, visible inner walls and shallow dark baffles. No invisible full-depth ducts are modeled. The general target is under 5,000 triangles per package, with a 5,500-triangle allowance for Duca d'Aosta's paired casings and service fittings and 6,000 for Scharnhorst's gallery, paired ladders and 31 jacket ventilators. The earlier national funnel packages, the Fletcher forward funnel, the German cruiser funnel cap and the generic capital funnel had no same-variant source model and are retired from the catalog; see [construction equipment](../construction/README.md#national-masts-and-directors).

## Duca d'Aosta refinement

The forward funnel uses the same GameModels3D `pisc506` / default `A_Hull` reference and separate cap island. The original wedge-shaped side housings were replaced with rounded, nearly vertical casings positioned forward of the jacket centre. Shaped service decks, attached hanging frames, access ladders and pipe clips replace generic rectangular platforms. The cap now has a recessed neck, sloping shoulder, short raked oval crown, radial grating and an **aft** auxiliary opening. The visible mouth has a short liner and recessed baffle rather than a solid lid.

Common-scale front, side, rear, top and quarter comparisons give published/reference envelopes of 11.40/11.40 m length, 8.85/8.85 m width and 8.57/8.56 m height. These envelope matches do not certify every surface. Service guard patterns, small valve mechanisms, bracket counts and some platform curves remain simplified; no source paint or texture was copied. The source's 1943 label remains unverified as a historical refit. Mass, centre of gravity and exhaust capacity are unchanged. The exhaust socket is at the new mouth centre, runtime `[0, 7.55, 0]`.

## Scharnhorst

The funnel uses GameModels3D `pgsb507` / default `A_Hull`, resource `gsb003_scharnhorst_1939_midback`. The jacket is an egg plan, fullest one metre forward of its centre: a half ellipse aft and a blunter 2.2 superellipse forward, 8.60 m long and 5.12 m in beam, with doubled plating over the lowest 2.85 m. A cap shelf overhangs the jacket at 8.56 m; its apron rises to an inset cowl whose lip rakes from 9.43 m aft to 11.15 m forward. The mouth has a lip, a short liner, egg-crate dividers (three fore-and-aft, four athwartships) resting on a soot baffle, and no hidden full-depth uptake. Thirty-one mushroom ventilators stand on the apron in the source's uneven port and starboard groups.

Common-scale side, front, rear, top and quarter comparisons give published/reference jacket and cap envelopes of 8.60/8.61 m length, 5.12/5.12 m beam (6.06/6.06 m over the cap shelf) and 11.15/11.15 m height above the deckhouse roof the source funnel stands on. The sole is that roof plane; the source's forward fairing wedge, the deckhouse the after half of the foot merges into and the round ventilator trunk beside it belong to the ship and are omitted, so the doubled foot plating is carried all the way round.

**The searchlight platform is deliberately reduced.** The source carries a 14 × 12.9 m platform at gallery height, with searchlight lobes and a long tail over the hangar. A funnel's collision envelope is its single bounding box, so that platform would have forbidden every fitting and superstructure block within 6.5 m of the centreline for the funnel's whole height. The package keeps a 0.8 m walkway gallery at the same height (5.05 m), on gussets, with two-bar rails and a ladder trunk each side; the resulting envelope is 6.72 × 11.15 × 10.20 m. Build the wide platform from hull plates where a design wants it.

Also simplified: ladder safety hoops, under-gallery beams, the forward pipe cross-connection, jackstays at 0.5 m and 4.9 m, plating seams and the access door's fittings. Steam, waste and vent pipes stand off on saddles clear of the jackstays. Mass (60 t), centre of gravity and exhaust capacity (120 MW, against the class's roughly 160,000 shp) are game estimates. The exhaust socket is at the mouth centre, runtime `[0, 10.3, 0.1]`.

Build with `bun run part:build <id>`, publish with `bun run part:publish`, and refresh cards with `bun run part:thumbnails`. Review the exact immutable published model through `bun run model:viewer`, then install it in Shipbuilder. These are static components; clearances against independently articulated neighboring weapons remain the ship designer's responsibility.

## Reference policy and limitations

Durable source URLs, resource names, extraction boundaries and checksums live in `tools/ship-overlay/component-references.json` and `catalog-reference-extractions.json`. Downloads and comparison images belong only in ignored `.build/`. Extractions retain metric scale and are base-aligned for front, side, rear, top and quarter comparisons; disconnected ship equipment and neighboring platforms may be excluded. Duca d'Aosta explicitly retains its separate cap island.

These are economical interpretations, with **unreviewed** registry status rather than a historical or exact-fidelity certification. Remaining differences include simplified cap cage patterns, pipe bends and bracket counts; omitted sheet seams, rivets, guy wires and source paint/markings; and simplified service-platform outlines. Dunkerque's cowl uses sparse lofts. Fine details obscured by the source or extraction boundary are not claimed as exact. Shared named naval finishes provide restrained surface quality instead of copying source textures.

Notable remaining overall-envelope differences (published / extracted reference) are Nelson's length 6.69 / 7.43 m, Mikasa's length 4.24 / 4.72 m and Błyskawica's width 3.60 / 3.25 m. These include differences in external pipes, ladders and platforms as well as extraction coverage. Do not treat a matching height or an exact source-variant label as full shape acceptance.
