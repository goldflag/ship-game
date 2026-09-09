# USS Enterprise (CV-6), June 1942

June 1942, Battle of Midway; pre-bulge hull; reconstruction in progress

Open `/?ship=enterprise-cv6` or select this ship in port or Custom battle.

`blueprint.json` and `build.py` are the durable inputs; reusable equipment comes from `assets/parts/`. Generated Blender scenes and runtime models are build outputs.

Before changing historical geometry, inspect the corresponding GameModels3D or War Thunder model as the primary visual reference. If unavailable, state that explicitly.

Authored hull: 246.736 m long, 28.0416 m beam, 7.9121 m draft. These are model inputs, not a new historical-accuracy certification.

- **Exterior:** Dimensional reconstruction from CV-6 contract offsets, CV-5 as-built plans and CV-6 1942 photos. not certified 100% accurate.
- **Internals:** Physical protection surfaces and contained provisional room envelopes. Thickness families, boundaries, capacities, flooding and ballistics remain estimates.
- **Air wing:** Global gameplay complement of 48 aircraft: 16 fighters, 16 dive bombers and 16 torpedo bombers. Aircraft types remain specific to this ship; this is not a historical manifest.
- **Weapons:** 8 single 5-inch/38, 4 quadruple 1.1-inch, 30 single 20 mm. Local fitting geometry, some placements and ballistic/damage values remain provisional.

```sh
bun run ship:compile enterprise-cv6
bun run ship:build enterprise-cv6
bun run ship:review enterprise-cv6
bun run ship:check enterprise-cv6
```

Keep the current fixed views in `generated/review/`. Ship report/reference archives are removed. Research downloads, diagnostic results and extra captures belong in ignored `.build/`; do not recreate a tracked archive. Keep source links and lasting limitations here.

Follow the [ship pipeline](../../../docs/ship-pipeline.md) and [model review](../../../docs/ship-model-review.md).
