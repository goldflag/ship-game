# Bismarck · Baltic paint, March–May 1941

24 May 1941 fit; standard 9.33 m reference draft (not battle load)

Open `/?ship=bismarck` or select this ship in port or Custom battle.

`blueprint.json` and `build.py` are the durable inputs; reusable equipment comes from `assets/parts/`. `recipe-inputs.json` declares additional original dependencies. Generated Blender scenes and runtime models are build outputs.

## Approved brief

The requested refinement uses only [Bismarck ’41 on GameModels3D](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pgsb708), with `A_Hull` and the corresponding A equipment. Preserve the existing Baltic paint. The reference supplies the target shapes; geometry and textures remain independently authored. Its A rangefinders have no mattress aerials; the existing sensor joint IDs remain stable.

Comparison uses 15 m per source unit, a 2 m longitudinal offset to align the hull ends, and a +0.85 m reference height adjustment to align the midship weather deck. The source loading condition is unverified; this alignment does not establish a historical waterline.

Authored hull: 250.5 m long, 36 m beam, 9.33 m draft. These are model inputs, not a new historical-accuracy certification.

- **Exterior:** Continuous raised superstructure platform, separated navigation/conning bridge, tapered tower and curved galleries; reshaped funnel with open searchlights; revised rangefinders, asymmetric forward boat stowage and four aft motor launches on stepped shelves, main gunhouses, fine hull ends and three-bladed screws. Small fittings and surface detail remain visual estimates of the approved model.
- **Internals:** Plate thicknesses and machinery sequence evidence-based; room boundaries and hull-conforming plate envelopes approximate. Standard-draft datum, not battle displacement.
- **Weapons:** Independent gunhouse polygons; historical bore and turret frames. Simplified geometry and AP budget, no fuze, spall or material penetration model. AA: eight twin 105 mm, eight twin 37 mm and twelve single 20 mm mounts use original visual placements and provisional CPU fire control. Two upper quad 20 mm fittings remain decorative.

The 150 mm and 105 mm side batteries use conservative operating envelopes from the approved game's firing sectors, with its endpoint dead zones removed. These are not independently verified mechanical or historical stops. The user chose reference fidelity for combined turret poses: opposing extreme main-turret angles can intersect even in the source model (for example Anton 145°/+10° with Bruno −138°). Preserve those source ranges; this accepted limitation is not a collision-free independent-pose claim. The reusable original `sk-c34-380-twin` builder owns main-turret geometry and preserves separate traverse, elevation and recoil joints.

```sh
bun run ship:compile bismarck
bun run ship:build bismarck
bun run ship:review bismarck
bun run ship:check bismarck
```

Keep the current fixed views in `generated/review/`. Ship report/reference archives are removed. Research downloads, diagnostic results and extra captures belong in ignored `.build/`; do not recreate a tracked archive. Keep source links and lasting limitations here.

Follow the [ship pipeline](../../../docs/ship-pipeline.md) and [model review](../../../docs/ship-model-review.md). Preserve the original `baseline/` unchanged. The separate paint recipe and `paint-scheme.json` are registered original inputs.

Appearance follows the [shared fleet finish](../../../docs/ship-appearance.md).
`appearance.json` preserves this recipe’s colors, scheme and deck coverings while
adding the shared matte materials and restrained original surface wear. Existing
markings and plank detail remain intact; this is not a new historical-accuracy claim.
