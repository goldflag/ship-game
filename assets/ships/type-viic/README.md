# Type VIIC · 1941

U-570 as captured, August–September 1941 · raised periscopes; original reconstruction

Open `/?ship=type-viic` or select this ship in port or Custom battle.

`blueprint.json` and `build.py` are the durable inputs; reusable equipment comes from `assets/parts/`. Generated Blender scenes and runtime models are build outputs.

Before changing historical geometry, inspect the corresponding GameModels3D or War Thunder model as the primary visual reference. If unavailable, state that explicitly.

Authored hull: 67.1004 m long, 6.15315 m beam, 4.7625 m draft. These are model inputs, not a new historical-accuracy certification.

- **Exterior:** U-570 August–September 1941: British dimensioned docking section, captured general arrangement and ONI photographs. Circular midbody, saddle shoulders, deck, tower and stern fittings reconstructed independently. Interpolated offsets, exact slot counts and small fittings remain estimates; see fidelity-01 report.
- **Internals:** Six stable spaces follow the captured-boat arrangement and fit conservatively inside the rounded body using disjoint cells. Capacities, pump rates, damage and buoyancy remain game tuning; outer free-flooding plating and pressure boundary are not separately simulated.
- **Weapons:** Four bow / one stern 533 mm tubes and 14 torpedoes; articulated 88 mm deck and 20 mm guns. G7a fast run, gyro arc, reload, arming, blast and reserve distribution are simplified. Surface guns; torpedoes launch down to 12 m. Ballast, diving rates, 150 m operating limit and propulsion transitions are gameplay approximations.

```sh
bun run ship:compile type-viic
bun run ship:build type-viic
bun run ship:review type-viic
bun run ship:check type-viic
```

Keep the current fixed views in `generated/review/`. Ship report/reference archives are removed. Research downloads, diagnostic results and extra captures belong in ignored `.build/`; do not recreate a tracked archive. Keep source links and lasting limitations here.

Follow the [ship pipeline](../../../docs/ship-pipeline.md) and [model review](../../../docs/ship-model-review.md).
