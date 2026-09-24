# Yukikaze

## Approved brief

Approved in conversation: Yukikaze using [GameModels3D AL Yukikaze, `pjsd718`](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pjsd718), hull `PJUH708_YUKIKAZE` / `A_Hull`, `A1_Artillery`, `A1_Torpedoes`, `A_AirDefense`, `A_Directors`, `A_Radars` and `A_DepthChargeGuns`. This is the source game's configuration; a historical year/refit is not independently established.

GameModels3D is the sole external visual reference. The approved default skin/paint shows gray steel, reddish-brown deck panels and a weathered underwater hull. Do not add the optional Azur Lane skin or markings/flags absent from the source.

Fit: three twin 127 mm Type C mounts, two quadruple 610 mm banks, ten single and three triple 25 mm mounts, and the shown depth-charge outfit. The missing source port propeller may use an independently authored mirrored counterpart. Source scale/loading/waterline are unverified. Internals, protection, ammunition and performance use provisional game conventions. Fidelity to this model does not certify historical accuracy.

Comparison alignment: source scale `15`, runtime translation `[0, 0, 1.15]`, zero rotation. This aligns the reference's 118.494 m length with the authored 118.5 m hull, without a vertical correction or a historical loading claim.

## Authoring

`blueprint.json`, original `build.py` and declared original helpers are the durable inputs. `torpedo-assemblies.py` builds the tapered quadruple banks, raised working deck and connected AA platform. Forward/aft launcher travel is limited to ±110°/±130° for clearance against the approved model’s surroundings; these are inferred game limits, not verified historical stops. `refinements.py` builds the detailed bridge, raked funnels and Type C fittings; the blueprint supplies the bridge and funnel surfaces used by both rendering and simulation. `python3 assets/ships/yukikaze/authoring/type-c.py` regenerates the original Type C enclosure in the shared component catalog. External geometry and textures are comparison-only and never read by the recipe. Downloads and additional captures stay under ignored `.build/`.

### How the 2026-09 accuracy pass was made

The hull, superstructure and fittings were measured on the approved `pjsd718` model in the comparison frame above (runtime z = source z + 1.15) and written as original tables:

- `authoring/lines.json`: 141 control stations (0.2 m apart at the ends, 2 m amidships) of keel, deck-at-side and half-breadth at 24 fractions of the keel-to-deck height, with the anchor hawse recess bridged. `python3 assets/ships/yukikaze/authoring/hull.py` writes them into the blueprint's hull and derives beam, depth, waterplane and reserve buoyancy. After a hull change run `author-flood-spaces.ts` and then `author-stability.ts` (remove `stability` first).
- `authoring/structures.py` writes the measured bridge tiers, director house, after bridge block, both funnel surfaces, the fore funnel casing and torpedo reload lockers, the torpedo working deck, the two-level after deckhouse and the after uptake.
- `build.py` and `refinements.py` place the masts, radar, forward AA platform, cable gear, boats, searchlight tower, steam pipe, bilge keels, shafts, A-brackets, screws and rudder at the measured positions. Mounts and depth-charge releases sit on the reference hardpoints.

Accepted differences from the reference: items the preset does not carry are left out (paravane cranes and float on the quarterdeck, the torpedo reload gantry at the fore funnel and the loading derrick on the after deckhouse, the direction-finder loop behind the after funnel, canvas splinter mats). Lifelines are lowered locally where the deck-edge 25 mm singles train across them, and the fore funnel casing's after face stands 0.1 m aft of the measured position so the forward bank clears it. The shared Type C gunhouse (`type3-127-typec-twin`) is shorter at the face than the reference's; it was not changed in this pass.

```sh
bun run ship:compile yukikaze
bun run ship:build yukikaze
bun run ship:review yukikaze
bun run ship:check yukikaze
```

Follow the [ship pipeline](../../../docs/ship-pipeline.md) and [model review](../../../docs/ship-model-review.md).

Appearance follows the [shared fleet finish](../../../docs/ship-appearance.md).
`appearance.json` preserves this recipe’s colors, scheme and deck coverings while
adding the shared matte materials and restrained original surface wear. Existing
markings and plank detail remain intact; this is not a new historical-accuracy claim.
