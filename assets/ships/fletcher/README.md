# Fletcher-class destroyer

Early round-bridge Fletcher; revision 5, hull, superstructure and fittings re-measured from GameModels3D pasd021

Open `/?ship=fletcher` or select this ship in port or Custom battle.

`blueprint.json` and `build.py` are the durable inputs; reusable equipment comes from `assets/parts/`. Generated Blender scenes and runtime models are build outputs.

**Reference:** [Fletcher on GameModels3D](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pasd021) (`pasd021`, `A_Hull` with the cached default equipment). GameModels3D only; fidelity is to that model, not a historical survey. Our frame is the reference's shifted aft: runtime z = reference z + 0.466 m, so the reference hull fills our 114.7 m station frame exactly (`bun run ship:overlay fletcher --offset 0.466`).

Authored hull: 114.7 m long, 12.02 m beam, 3.80 m draft at the reference waterline; stated mass 2,924 t, which the stability buoyancy scale (1.13) reconciles with the hull's 2,580 t geometric displacement. These are model inputs, not a historical-accuracy certification.

## How it was made

- **Hull:** `authoring/lines.json` holds 142 starboard sections measured from the reference (0.1 m apart at the raked stem and round counter, 2 m in the parallel body), with the skeg, sonar dome, rudder, shaft bossings, brackets and bilge keels left out and faired lightly fore and aft. `author-shape.py` turns them into the blueprint's `authored-stations-v1` loft; `build.py` draws the appendages from the same measurements (skeg to z 40, rudder z 52.0-55.7, 3.9 m screws at z 51.15, strut at 42.2, A-bracket at 49.7, propeller guards).
- **Superstructure:** deckhouses, bridge tiers, funnels and the Bofors house traced from reference plan cuts; roofs follow the sheer as the reference's do (the blueprint keeps each block's mean roof as its flat hit and obstruction proxy).
- **Mounts:** guns, Bofors, Oerlikons, torpedo banks and depth-charge gear stand on the reference hardpoints (`bun run ship:hardpoints pasd021`); hardpoint heights are mount base planes. The bridge 20 mm sit 6 cm above theirs on the 01 roof.
- **Rooms:** the below-deck envelopes rise 0.4 m with the keel (capacities kept); flood spaces and stability were regenerated after the hull change.

```sh
python3 assets/ships/fletcher/author-shape.py      # hull lines, structures, mounts, rooms
bun assets/ships/author-flood-spaces.ts fletcher     # then remove `stability` and:
bun assets/ships/author-stability.ts fletcher
bun run ship:build fletcher
bun run ship:review fletcher
bun run ship:check fletcher
```

## Accepted differences and limitations

- **Fit, not the reference's refit:** the reference carries twin Bofors on waist sponsons, four more 20 mm on the main deck, three 20 mm and a tub at the stern, four Mk 51 directors (bridge wings, waist, after tub), an extra mast antenna and platforms around the after funnel. The preset keeps its early fit and leaves these out; the Mk 37 keeps its Mk 4 antenna, which the reference lacks. The preset's six K-guns: two pairs on the reference's K-gun stations, the third pair 3.5 m aft.
- **Shared parts:** the Mk 30 (`us-5in38-mk30-single`) gunhouse is 0.6 m shorter than the reference's, starts 0.48 m above its base and carries its trunnion 0.35 m higher; the twin Bofors and Oerlikon differ in detail. These are shared parts and are not edited here.
- **Clearance:** without a `mountClearance` profile, some reference-layout poses still touch: the after Bofors and Mount 54 (and each other) at low elevation, Mounts 51/52, Mount 55 depressed over the after deckhouse, Mount 53 depressed over the Bofors house. The 20 mm tub screens (0.78 m) and Bofors tub screen (0.5 m) are lower than the reference's so the guns clear them.
- **Internals:** provisional machinery, magazines, ready-service and flooding envelopes; not surveyed watertight subdivisions. The fine forebody still clips a few lower corners of the forepeak and forward magazine envelopes.
- **Weapons:** five articulated 127 mm guns; two trainable quintuple Mk 15 mounts with ten total rounds; two racks and six K-guns with 28 charges. Shallow 10 m blast, damage, reloads and arcs are gameplay tuning.

Keep the current fixed views in `generated/review/`. Research downloads, diagnostic results and extra captures belong in ignored `.build/`; do not recreate a tracked archive.

Follow the [ship pipeline](../../../docs/ship-pipeline.md) and [model review](../../../docs/ship-model-review.md).

Appearance follows the [shared fleet finish](../../../docs/ship-appearance.md).
`appearance.json` preserves this recipe’s colors, scheme and deck coverings while
adding the shared matte materials and restrained original surface wear. Existing
markings and plank detail remain intact; this is not a new historical-accuracy claim.
