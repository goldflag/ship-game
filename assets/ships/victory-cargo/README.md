# Victory Cargo — VC2-S-AP2

VC2-S-AP2 Victory cargo ship, 1945 arrangement; 6000 shp geared steam turbine

Open `/?ship=victory-cargo` or select this ship in port or Custom battle.

`blueprint.json` and `build.py` are the durable inputs; reusable equipment comes from `assets/parts/`. `recipe-inputs.json` declares additional original dependencies. Generated Blender scenes and runtime models are build outputs.

Before changing historical geometry, inspect the corresponding GameModels3D or War Thunder model as the primary visual reference. If unavailable, state that explicitly.

Authored hull: 138.76 m long, 18.8976 m beam, 8.6868 m draft. These are model inputs, not a new historical-accuracy certification.

- **Exterior:** Independently reconstructed from National Park Service HAER CA-345 Winthrop Victory sheets 2, 3 and 6: 455 ft 3 in overall, 62 ft beam, raised forecastle, five hatches, paired kingposts, turbine machinery, superstructure and hull lines. HAER drawings were made in 2010 from historical drawings and photographs; loading and fine equipment remain estimates, not a claim to match the laid-up vessel in 2010.
- **Internals:** Estimated watertight envelopes, permeability, machinery and magazines. Finite-angle stability calibrated to stated displacement and an estimated GM; room boundaries are not historical plans.
- **Weapons:** Representative armed merchant battery: aft 5-inch, bow 3-inch and Oerlikons. Dated weapons inventory is unresolved for the collier. Shared CPU surface gunnery; game ballistics and ammunition.

```sh
bun run ship:compile victory-cargo
bun run ship:build victory-cargo
bun run ship:review victory-cargo
bun run ship:check victory-cargo
```

Keep the current fixed views in `generated/review/`. Ship report/reference archives are removed. Research downloads, diagnostic results and extra captures belong in ignored `.build/`; do not recreate a tracked archive. Keep source links and lasting limitations here.

Follow the [ship pipeline](../../../docs/ship-pipeline.md) and [model review](../../../docs/ship-model-review.md).

Appearance follows the [shared fleet finish](../../../docs/ship-appearance.md).
`appearance.json` preserves this recipe’s colors, scheme and deck coverings while
adding the shared matte materials and restrained original surface wear. Existing
markings and plank detail remain intact; this is not a new historical-accuracy claim.
