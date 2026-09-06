# Liberty — troop transport

Archived revision 1, no longer an active preset. The former runtime GLB/definition/thumbnail are preserved in `retired-public/`; the old URL selects Victory Cargo. The description below records the superseded fit, not current game behavior. See [revision 2](../convoy/README.md).

Playable representative 1943–44 EC2-S-C1 Liberty fit. Independently authored blueprint, gun parts and versioned original component recipe. Generated Blender, GLB, thumbnails and review images are build outputs.

134.5692 m × 17.0688 m, 8.46 m estimated loaded draft, 14,478 t provisional displacement, 11 kn. Main battery: aft 5-inch gun. Secondary: bow 3-inch and eight Oerlikons. The troop fit adds two aft 3-inch guns, deck shelters, ventilation and extra life rafts. Troop carrying is represented by the model and room configuration; there is no passenger mission system.

Select the ship in the port carousel or on either side of Custom battle. Keys 1/2 select main/secondary batteries. The Liberty main gun faces aft; broadside and stern bearings give it clear fire. The Flower main gun faces forward. Port Armor and Internals use the same structural shell, machinery, magazines and flooding spaces as combat.

Both boilers feed a single reciprocating engine and shaft. Destroyed/immersed machinery reduces power; magazines supply their linked mounts. Closed boundaries, positional breaches, pumps, finite damage-control resources, geometry-derived flotation and reset behavior use the shared CPU simulation. Their numerical performance is provisional gameplay calibration.

Build with `bun run ship:build liberty-troopship`; fixed views with `bun run ship:review liberty-troopship`; verify with `bun run ship:check liberty-troopship`. The shared original recipe is [geometry-v1.py](../convoy/geometry-v1.py), explicitly registered in `recipe-inputs.json`. Rebuild all four convoy presets after changing it. Initial blueprints were authored by [author-blueprints.ts](../convoy/author-blueprints.ts); edit the versioned blueprint for durable refinements.

See [source register](references/sources.json), [discrepancies](reports/discrepancies.md), [stability calibration](reports/stability.json), and [convoy validation](../convoy/reports/validation.md). Export validation does not certify historical accuracy.
