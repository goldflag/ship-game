# Liberty Cargo — EC2-S-C1

EC2-S-C1 general cargo design; 1941 USMC plans with representative 1943 defensive armament

Open `/?ship=liberty-cargo` or select this ship in port or Custom battle.

`blueprint.json` and `build.py` are the durable inputs; reusable equipment comes from `assets/parts/`. `recipe-inputs.json` declares additional original dependencies. Generated Blender scenes and runtime models are build outputs.

Before changing historical geometry, inspect the corresponding GameModels3D or War Thunder model as the primary visual reference. If unavailable, state that explicitly.

Authored hull: 134.569 m long, 17.3291 m beam, 8.4328 m draft. These are model inputs, not a new historical-accuracy certification.

- **Exterior:** Original reconstruction from US Maritime Commission / Gibbs & Cox inboard profile and hold plan 312-S1-3-2 (30 August 1941), and St Johns River as-built midship section (28 August 1943), retained by Lloyd's Register for Thomas Sully. Five holds, amidship machinery, three cargo masts, flat floor and tight bilge follow the plans. End-section interpolation and small fittings remain estimates.
- **Internals:** Estimated watertight envelopes, permeability, machinery and magazines. Finite-angle stability calibrated to stated displacement and an estimated GM; room boundaries are not historical plans.
- **Weapons:** Representative armed merchant battery: aft 5-inch, bow 3-inch and Oerlikons. Dated weapons inventory is unresolved for the collier. Shared CPU surface gunnery; game ballistics and ammunition.

```sh
bun run ship:compile liberty-cargo
bun run ship:build liberty-cargo
bun run ship:review liberty-cargo
bun run ship:check liberty-cargo
```

Keep the current fixed views in `generated/review/`. Ship report/reference archives are removed. Research downloads, diagnostic results and extra captures belong in ignored `.build/`; do not recreate a tracked archive. Keep source links and lasting limitations here.

Follow the [ship pipeline](../../../docs/ship-pipeline.md) and [model review](../../../docs/ship-model-review.md).
