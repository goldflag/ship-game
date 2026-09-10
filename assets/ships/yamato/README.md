# Yamato

7 April 1945 exterior fit; 10.4 m trial waterline datum; reconstruction under dimensional review

Open `/?ship=yamato` or select this ship in port or Custom battle.

`blueprint.json` and `build.py` are the durable inputs; reusable equipment comes from `assets/parts/`. `recipe-inputs.json` declares additional original dependencies. Generated Blender scenes and runtime models are build outputs.

Before changing historical geometry, inspect the corresponding GameModels3D or War Thunder model as the primary visual reference. If unavailable, state that explicitly.

Authored hull: 263 m long, 38.9 m beam, 10.4 m draft. These are model inputs, not a new historical-accuracy certification.

- **Exterior:** 263 m LOA / 38.9 m beam. Original reconstruction; station offsets, hull sections and fittings remain under review.
- **Internals:** Physical protection surfaces and contained provisional room envelopes. Thickness families, boundaries, capacities, flooding and ballistics remain estimates.
- **Weapons:** 46 cm triple geometry uses USNTMJ O-45(N) measured spacing, roller path and trunnion dimensions. Secondary shapes and exterior station measurements remain interpreted; combat is approximate. Twelve twin 127 mm AA mounts now use shared aiming, finite ammunition and damage. Their rates, arcs and supply are gameplay approximations; the 25 mm fittings remain visual.

```sh
bun run ship:compile yamato
bun run ship:build yamato
bun run ship:review yamato
bun run ship:check yamato
```

Keep the current fixed views in `generated/review/`. Ship report/reference archives are removed. Research downloads, diagnostic results and extra captures belong in ignored `.build/`; do not recreate a tracked archive. Keep source links and lasting limitations here.

Follow the [ship pipeline](../../../docs/ship-pipeline.md) and [model review](../../../docs/ship-model-review.md).

Appearance follows the [shared fleet finish](../../../docs/ship-appearance.md).
`appearance.json` preserves this recipe’s colors, scheme and deck coverings while
adding the shared matte materials and restrained original surface wear. Existing
markings and plank detail remain intact; this is not a new historical-accuracy claim.
