# HMS King George V — early 1941

Early 1941 Home Fleet exterior, before December AA refit; 1940 standard mean-draft datum

Open `/?ship=king-george-v` or select this ship in port or Custom battle.

`blueprint.json` and `build.py` are the durable inputs; reusable equipment comes from `assets/parts/`. Generated Blender scenes and runtime models are build outputs.

The previous authoring workflow used [King George V on GameModels3D](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pbsb107) for visual comparison. Recheck its configuration when changing geometry.

Authored hull: 227.08 m long, 31.3944 m beam, 8.8392 m draft. These are model inputs, not a new historical-accuracy certification.

- **Exterior:** Original early-1941 reconstruction informed by Vickers as-fitted plans and IWM photographs. Principal dimensions sourced; station offsets, minor fittings and paint reflectance interpreted.
- **Internals:** Estimated machinery, magazines, partitions, flooding and stability for inspectable combat; not an as-built internal survey.
- **Weapons:** Ten 14-inch and sixteen 5.25-inch guns. Source-based bore, layout, speed and train/elevation; ballistics and damage calibrated for gameplay. Pom-poms, UP and aircraft are visual only.

```sh
bun run ship:compile king-george-v
bun run ship:build king-george-v
bun run ship:review king-george-v
bun run ship:check king-george-v
```

Keep the current fixed views in `generated/review/`. Ship report/reference archives are removed. Research downloads, diagnostic results and extra captures belong in ignored `.build/`; do not recreate a tracked archive. Keep source links and lasting limitations here.

Follow the [ship pipeline](../../../docs/ship-pipeline.md) and [model review](../../../docs/ship-model-review.md). `author-blueprint.py` resets subsequent blueprint edits and updates shared catalog entries; run it only for deliberate regeneration, then refit internals and regenerate flooding/stability. Normal builds do not need it.
