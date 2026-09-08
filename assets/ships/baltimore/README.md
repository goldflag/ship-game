# USS Baltimore (CA-68)

CA-68 · October 1943 exterior · 24 ft 2 in limiting keel-draft datum; dimensional reconstruction under review

Open `/?ship=baltimore` or select this ship in port or Custom battle.

`blueprint.json` and `build.py` are the durable inputs; reusable equipment comes from `assets/parts/`. `recipe-inputs.json` declares additional original dependencies. Generated Blender scenes and runtime models are build outputs.

Before changing historical geometry, inspect the corresponding GameModels3D or War Thunder model as the primary visual reference. If unavailable, state that explicitly.

Authored hull: 205.257 m long, 21.59 m beam, 7.366 m draft. These are model inputs, not a new historical-accuracy certification.

- **Exterior:** LOA, beam, waterline length and limiting keel draft are documented in NAVSHIPS 250-010. Top envelope and longitudinal stations are measured from the Navy camouflage drawing. Underwater sections and smaller fittings remain interpreted.
- **Internals:** Physical protection surfaces and contained provisional room envelopes. Thickness families, boundaries, capacities, flooding and ballistics remain estimates.
- **Weapons:** Original catalog-based 8-inch triple / 5-inch twin components; primary turret section OP1112 p517. Secondary shield details and AA fittings remain under review. The twelve quad 40 mm Bofors mounts now use shared aiming, finite ammunition and damage alongside the six twin 5-inch DP mounts. AA rates and arcs are gameplay approximations; the single 20 mm fittings remain visual.

```sh
bun run ship:compile baltimore
bun run ship:build baltimore
bun run ship:review baltimore
bun run ship:check baltimore
```

Keep the current fixed views in `generated/review/`. Ship report/reference archives are removed. Research downloads, diagnostic results and extra captures belong in ignored `.build/`; do not recreate a tracked archive. Keep source links and lasting limitations here.

Follow the [ship pipeline](../../../docs/ship-pipeline.md) and [model review](../../../docs/ship-model-review.md).
