# Liberty — deck cargo

EC2-S-C1 Liberty, 1943–44 representative vehicle deck cargo fit

Archived preset; its old URL selects `liberty-collier`. Preserved exports are in `retired-public/`.

`blueprint.json` and `build.py` are the durable inputs; reusable equipment comes from `assets/parts/`. `recipe-inputs.json` declares additional original dependencies. Generated Blender scenes and runtime models are build outputs.

Before changing historical geometry, inspect the corresponding GameModels3D or War Thunder model as the primary visual reference. If unavailable, state that explicitly.

Authored hull: 134.569 m long, 17.0688 m beam, 8.46 m draft. These are model inputs, not a new historical-accuracy certification.

- **Exterior:** Original representative Liberty EC2-S-C1. Published length/beam and five holds; interpreted sections, cargo, fittings and loading. No claim to reproduce a specific named ship.
- **Internals:** Estimated watertight envelopes, permeability, machinery and magazines. Finite-angle stability calibrated to stated displacement and an estimated GM; room boundaries are not historical plans.
- **Weapons:** Aft 5-inch main battery; forward 3-inch and eight Oerlikons in secondary battery. Troop fit adds two aft 3-inch guns. Surface fire only; ballistics and ammunition are gameplay approximations.

```sh
bun run ship:compile liberty-deck-cargo
bun run ship:build liberty-deck-cargo
bun run ship:review liberty-deck-cargo
bun run ship:check liberty-deck-cargo
```

Keep the current fixed views in `generated/review/`. Ship report/reference archives are removed. Research downloads, diagnostic results and extra captures belong in ignored `.build/`; do not recreate a tracked archive. Keep source links and lasting limitations here.

Follow the [ship pipeline](../../../docs/ship-pipeline.md) and [model review](../../../docs/ship-model-review.md).
