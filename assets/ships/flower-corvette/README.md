# Flower Corvette — Cobalt 1941 arrangement

Flower class, HMCS Cobalt 1941 short-forecastle arrangement; representative early-war armament

Open `/?ship=flower-corvette` or select this ship in port or Custom battle.

`blueprint.json` and `build.py` are the durable inputs; reusable equipment comes from `assets/parts/`. `recipe-inputs.json` declares additional original dependencies. Generated Blender scenes and runtime models are build outputs.

Before changing historical geometry, inspect the corresponding GameModels3D or War Thunder model as the primary visual reference. If unavailable, state that explicitly.

Authored hull: 62.484 m long, 10.0584 m beam, 3.5052 m draft. These are model inputs, not a new historical-accuracy certification.

- **Exterior:** Independently lofted against Port Arthur Shipbuilding general arrangement dated 19 November 1941, sheets 1–2: short forecastle, two masts, raised 4-inch platform, narrow wheelhouse/open compass deck, tall circular funnel, boat platforms and aft casing. Transverse sections, loading, camouflage and small fittings remain reconstructed. Not a later extended-forecastle Sackville.
- **Internals:** Estimated watertight envelopes, permeability, machinery and magazines. Finite-angle stability calibrated to stated displacement and an estimated GM; room boundaries are not historical plans.
- **Weapons:** 4-inch, aft 2-pounder and two twin Lewis light mounts. Early-war representative hardware, not a certified Cobalt weapons inventory. No later Hedgehog or Type 271 lantern. Depth charges and minesweeping equipment are visual only.

```sh
bun run ship:compile flower-corvette
bun run ship:build flower-corvette
bun run ship:review flower-corvette
bun run ship:check flower-corvette
```

Keep the current fixed views in `generated/review/`. Ship report/reference archives are removed. Research downloads, diagnostic results and extra captures belong in ignored `.build/`; do not recreate a tracked archive. Keep source links and lasting limitations here.

Follow the [ship pipeline](../../../docs/ship-pipeline.md) and [model review](../../../docs/ship-model-review.md).

Appearance follows the [shared fleet finish](../../../docs/ship-appearance.md).
`appearance.json` preserves this recipe’s colors, scheme and deck coverings while
adding the shared matte materials and restrained original surface wear. Existing
markings and plank detail remain intact; this is not a new historical-accuracy claim.
