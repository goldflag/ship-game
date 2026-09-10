# Yamato

7 April 1945 exterior fit; 10.4 m model waterline datum. Original reconstruction refined against the GameModels3D visual configuration; historical accuracy remains unverified.

Open `/?ship=yamato` or select this ship in port or Custom battle.

`blueprint.json` and `build.py` are the durable inputs; reusable equipment comes from `assets/parts/`. `recipe-inputs.json` declares additional original dependencies. Generated Blender scenes and runtime models are build outputs.

## Approved reference brief

The requested refinement targets [GameModels3D Yamato `pjsb018`](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pjsb018), `A_Hull` and its default equipment configuration. Its hull geometry is named `jsb039_yamato_1945`; the source's upgrade label says `Yamato_1944`, so neither label establishes historical accuracy. This pass uses GameModels3D only as an external visual reference and retains the existing Kure-gray appearance. Geometry and textures are authored independently.

Comparison uses 15 metres per source unit and, in Blender's bow-positive coordinates, a longitudinal offset of -2.5 m with no vertical offset. The reference shell spans 262.974 m and reaches -10.404 m; the authored shell remains 263 m long, 38.9 m maximum beam and 10.4 m draft. The correspondence establishes a model comparison datum, not a verified historical loading condition.

The forward hull uses a fine waterline entrance, flared upper stem and separate submerged bulb. The deck descends gradually from ahead of the bridge over approximately 32 m, then rises toward the bow. Compartment containment, forward protection surfaces and provisional loading follow the changed hull. The bridge has a battered lower foundation, a 6.696 m wide vertical upper core, distinct lookout galleries, a raised navigation room and supported signal wings. The director has an asymmetric faceted housing, aft-set tapered rangefinder arms and a raked aerial. Staggered Type 22 horns stand on supported open upper wings. The funnel has a narrow capsule section. Gunhouse floors and supporting barbettes are positioned against the reference while retaining their original yaw, elevation, recoil and socket IDs.

## Limits

- Sparse dimensional comparison does not certify every surface or historical detail. Gunhouse shapes, exposed AA mechanisms, exact gallery fittings and aft equipment remain independently interpreted; the reference is more detailed.
- The main battery retains the existing original 46 cm triple component geometry. Internal layouts, armor thicknesses, loading, flooding and ballistics remain provisional gameplay models.
- Twelve twin 127 mm AA mounts retain shared aiming, finite ammunition and damage. Their rates, arcs and supply are gameplay approximations; the 25 mm fittings remain visual.
- The original `mountClearance` profile enables swept barrel movement checks for all fitted gun mounts, including independent neighbors and full recoil, with a 0.02 m margin. Its fixed and yaw-parented contact bodies follow the original fittings. Nominal catalog arcs remain available where the physical path clears; blocked moves may require raising before traversing. This gameplay interlock is not a full rigid-body collision model.
- Appearance follows the [shared fleet finish](../../../docs/ship-appearance.md). `appearance.json` retains named paints, deck coverings and restrained original surface wear.

```sh
bun run ship:compile yamato
bun run ship:build yamato
bun run ship:review yamato
bun run ship:check yamato
```

Keep the current fixed views in `generated/review/`. Research downloads, diagnostic results and extra captures belong in ignored `.build/`; do not create tracked report or reference archives. Follow the [ship pipeline](../../../docs/ship-pipeline.md) and [model review](../../../docs/ship-model-review.md).
