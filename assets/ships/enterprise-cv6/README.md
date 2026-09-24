# USS Enterprise (CV-6), June 1942

June 1942, Battle of Midway; pre-bulge hull; reconstruction in progress

Open `/?ship=enterprise-cv6` or select this ship in port or Custom battle.

`blueprint.json`, `build.py` and its region modules (`details.py` fitting vocabulary, `sponsons.py`, `island.py`, `fittings.py`, `stern.py`) are the durable inputs; reusable equipment, including the carrier guns, comes from `assets/parts/`. Generated Blender scenes and runtime models are build outputs.

## Approved brief

- **Fit:** June 1942 (Midway), pre-bulge hull, CXAM radar, Mk 33 directors, 1.1-inch quads and 20 mm singles.
- **Reference:** GameModels3D [`pasa518`](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pasa518) (WoWS `ASA001_Enterprise_1944`), with the refit rule: match it wherever the 1943–44 refit did not change the ship; elements it has only because of that refit are left out. Measured with the reference raised 0.87 m (its deeper 1944 waterline, read on the flight deck, forecastle, afterdeck and keel) and 0.4 m aft. Our draft and waterline are kept.
- **Matched to the reference:** stem rake and bow flare (anchor pockets bridged), 5-inch sponsons and gun stations, island and funnel width, tripod leg spread, the forward-lower and aft-lower 1.1-inch tub stations, and the kinds and places of small fittings (floater nets, lockers, hose racks, bollards, chocks, anchors).
- **Accepted differences:** the 1944 anti-torpedo blister and wider gallery sponsons, 40 mm Bofors and Mk 51 tubs, extra 20 mm galleries, SK/SC/SG radars and the Mk 37 directors are refit items and are omitted. The reference's plated forecastle and quarterdeck sides are left out (the 1942 ends stay open). The island's aft end, the forward director and bridge front, the hangar openings (open here, closed curtains there), the screws and the rudder keep the recipe's plan-derived shapes where the refit plausibly changed them or the plans disagree with the reference.

Authored hull: 246.736 m long, 28.0416 m beam, 7.9121 m draft. These are model inputs, not a new historical-accuracy certification.

- **Exterior:** Dimensional reconstruction from CV-6 contract offsets, CV-5 as-built plans and CV-6 1942 photos. not certified 100% accurate.
- **Internals:** Physical protection surfaces and contained provisional room envelopes. Thickness families, boundaries, capacities, flooding and ballistics remain estimates.
- **Air wing:** Global gameplay complement of 48 aircraft: 16 fighters, 16 dive bombers and 16 torpedo bombers. Aircraft types remain specific to this ship; this is not a historical manifest.
- **Weapons:** 8 single 5-inch/38 Mk 24, 4 quadruple 1.1-inch, 30 single 20 mm Mk 4. Local fitting geometry, some placements and ballistic/damage values remain provisional.
- **Clearance:** the eight 5-inch mounts carry a `mountClearance` installation profile (barrels against the flight deck, hangar and gallery walls, portals, 20 mm galleries and each sponson neighbour) plus `clearance-*` obstruction strips for recipe-only deck-edge camber and deck-end knees. These are game envelopes, not historical stops. The 20 mm gallery rails are open in way of each mount.

```sh
bun run ship:compile enterprise-cv6
bun run ship:build enterprise-cv6
bun run ship:review enterprise-cv6
bun run ship:check enterprise-cv6
```

Keep the current fixed views in `generated/review/`. Ship report/reference archives are removed. Research downloads, diagnostic results and extra captures belong in ignored `.build/`; do not recreate a tracked archive. Keep source links and lasting limitations here.

Follow the [ship pipeline](../../../docs/ship-pipeline.md) and [model review](../../../docs/ship-model-review.md).

Appearance follows the [shared fleet finish](../../../docs/ship-appearance.md).
`appearance.json` preserves this recipe’s colors, scheme and deck coverings. It wears In commission, drawn by the game like every ship's (plating, mottling, runoff, tide stain, funnel soot); Blender bakes only fine paint grain.
The flight deck's blue-stained planks are modeled geometry (0.144 m boards at 0.149 m
pitch, 6 to 10 m long, nine stains over the slab); `decking` declares them
`modeled`, so the game adds no planks. This is not a new historical-accuracy claim.
