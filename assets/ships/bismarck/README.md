# Bismarck · Baltic paint, March–May 1941

24 May 1941 fit; standard 9.33 m reference draft (not battle load)

Open `/?ship=bismarck` or select this ship in port or Custom battle.

`blueprint.json` and `build.py` are the durable inputs; reusable equipment comes from `assets/parts/`. `recipe-inputs.json` declares additional original dependencies. Generated Blender scenes and runtime models are build outputs.

The previous authoring workflow used [Bismarck ’41 on GameModels3D](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pgsb708) for visual comparison. Recheck its configuration when changing geometry.

Authored hull: 250.5 m long, 36 m beam, 9.33 m draft. These are model inputs, not a new historical-accuracy certification.

- **Exterior:** Independent 1941-04: revised secondary gunhouses, separated navigation/conning bridge and scalloped tower galleries. Principal dimensions documented; local shapes and fittings remain image estimates.
- **Internals:** Plate thicknesses and machinery sequence evidence-based; room boundaries and hull-conforming plate envelopes approximate. Standard-draft datum, not battle displacement.
- **Weapons:** Independent gunhouse polygons; historical bore and turret frames. Simplified geometry and AP budget, no fuze, spall or material penetration model. AA: eight twin 105 mm, eight twin 37 mm and twelve single 20 mm mounts use original visual placements and provisional CPU fire control. Two upper quad 20 mm fittings remain decorative.

```sh
bun run ship:compile bismarck
bun run ship:build bismarck
bun run ship:review bismarck
bun run ship:check bismarck
```

Keep the current fixed views in `generated/review/`. Ship report/reference archives are removed. Research downloads, diagnostic results and extra captures belong in ignored `.build/`; do not recreate a tracked archive. Keep source links and lasting limitations here.

Follow the [ship pipeline](../../../docs/ship-pipeline.md) and [model review](../../../docs/ship-model-review.md). Preserve the original `baseline/` unchanged. The separate paint recipe and `paint-scheme.json` are registered original inputs.
