# Liberty Collier — EC2-S-AW1

EC2-S-AW1 machinery-aft collier, Delta Shipbuilding 1945; representative armed fit

Open `/?ship=liberty-collier` or select this ship in port or Custom battle.

`blueprint.json` and `build.py` are the durable inputs; reusable equipment comes from `assets/parts/`. `recipe-inputs.json` declares additional original dependencies. Generated Blender scenes and runtime models are build outputs.

Before changing historical geometry, inspect the corresponding GameModels3D or War Thunder model as the primary visual reference. If unavailable, state that explicitly.

Authored hull: 135.23 m long, 17.3291 m beam, 8.7196 m draft. These are model inputs, not a new historical-accuracy certification.

- **Exterior:** Liberty hull family with the documented EC2-S-AW1 structural conversion: aft machinery and 95 ft 10.5 in poop, detached navigation bridge, five holds with ten hinged steel hatch covers, hatch-lifting posts instead of cargo derricks. Based on ABS Workhorse of the Fleet p105, reproduced outboard profile and dated Delta Jagger Seam launch photograph. No complete original collier GA or lines obtained; hatch/deckhouse placements remain measured reconstruction, not builder-certified.
- **Internals:** Estimated watertight envelopes, permeability, machinery and magazines. Finite-angle stability calibrated to stated displacement and an estimated GM; room boundaries are not historical plans.
- **Weapons:** Representative armed merchant battery: aft 5-inch, bow 3-inch and Oerlikons. Dated weapons inventory is unresolved for the collier. Shared CPU surface gunnery; game ballistics and ammunition.

```sh
bun run ship:compile liberty-collier
bun run ship:build liberty-collier
bun run ship:review liberty-collier
bun run ship:check liberty-collier
```

Keep the current fixed views in `generated/review/`. Ship report/reference archives are removed. Research downloads, diagnostic results and extra captures belong in ignored `.build/`; do not recreate a tracked archive. Keep source links and lasting limitations here.

Follow the [ship pipeline](../../../docs/ship-pipeline.md) and [model review](../../../docs/ship-model-review.md).

Appearance follows the [shared fleet finish](../../../docs/ship-appearance.md).
`appearance.json` preserves this recipe’s colors, scheme and deck coverings while
adding the shared matte materials and restrained original surface wear. Existing
markings and plank detail remain intact; this is not a new historical-accuracy claim.
