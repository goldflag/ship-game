# Fletcher-class destroyer

Early round-bridge Fletcher; original reconstruction, revision 4 with corrected hull, superstructure, Mk30 gunhouses and propellers

Open `/?ship=fletcher` or select this ship in port or Custom battle.

`blueprint.json` and `build.py` are the durable inputs; reusable equipment comes from `assets/parts/`. Generated Blender scenes and runtime models are build outputs.

The previous authoring workflow used [Fletcher on GameModels3D](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pasd021) for visual comparison. Recheck its configuration when changing geometry.

Authored hull: 114.7 m long, 12.1 m beam, 4.2 m draft. These are model inputs, not a new historical-accuracy certification.

- **Exterior:** Original round-bridge Fletcher reconstruction. The hull and superstructure corrections are retained; revision 4 adds original Mk30 gunhouse facets and handed screw lofts. Navy general arrangements and matching reference rasters guide the reconstruction; exact offsets, propeller pitch distribution, load datum and outfit remain interpreted.
- **Internals:** Provisional machinery, magazines, ready-service and flooding envelopes; not surveyed watertight subdivisions.
- **Weapons:** Five articulated 127 mm guns; two trainable quintuple Mk 15 mounts with ten total rounds; two racks and six K-guns with 28 charges. Shallow 10 m blast, damage, reloads and arcs are gameplay tuning.

```sh
bun run ship:compile fletcher
bun run ship:build fletcher
bun run ship:review fletcher
bun run ship:check fletcher
```

Keep the current fixed views in `generated/review/`. Ship report/reference archives are removed. Research downloads, diagnostic results and extra captures belong in ignored `.build/`; do not recreate a tracked archive. Keep source links and lasting limitations here.

Follow the [ship pipeline](../../../docs/ship-pipeline.md) and [model review](../../../docs/ship-model-review.md).
