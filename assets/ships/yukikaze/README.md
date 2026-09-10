# Yukikaze

## Approved brief

Approved in conversation: Yukikaze using [GameModels3D AL Yukikaze, `pjsd718`](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pjsd718), hull `PJUH708_YUKIKAZE` / `A_Hull`, `A1_Artillery`, `A1_Torpedoes`, `A_AirDefense`, `A_Directors`, `A_Radars` and `A_DepthChargeGuns`. This is the source game's configuration; a historical year/refit is not independently established.

GameModels3D is the sole external visual reference. The approved default skin/paint shows gray steel, reddish-brown deck panels and a weathered underwater hull. Do not add the optional Azur Lane skin or markings/flags absent from the source.

Fit: three twin 127 mm Type C mounts, two quadruple 610 mm banks, ten single and three triple 25 mm mounts, and the shown depth-charge outfit. The missing source port propeller may use an independently authored mirrored counterpart. Source scale/loading/waterline are unverified. Internals, protection, ammunition and performance use provisional game conventions. Fidelity to this model does not certify historical accuracy.

Comparison alignment: source scale `15`, runtime translation `[0, 0, 1.15]`, zero rotation. This aligns the reference's 118.494 m length with the authored 118.5 m hull, without a vertical correction or a historical loading claim.

## Authoring

`blueprint.json`, original `build.py` and declared original helpers are the durable inputs. `torpedo-assemblies.py` builds the tapered quadruple banks, raised working deck and connected AA platform. Forward/aft launcher travel is limited to ±110°/±130° for clearance against the approved model’s surroundings; these are inferred game limits, not verified historical stops. `refinements.py` builds the detailed bridge, raked funnels and Type C fittings; the blueprint supplies the bridge and funnel surfaces used by both rendering and simulation. `python3 assets/ships/yukikaze/authoring/type-c.py` regenerates the original Type C enclosure in the shared component catalog. External geometry and textures are comparison-only and never read by the recipe. Downloads and additional captures stay under ignored `.build/`.

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
