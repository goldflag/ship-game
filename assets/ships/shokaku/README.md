# IJN Shōkaku — December 1941

December 1941; original armament; 48-aircraft gameplay complement; sourced reconstruction with unresolved offsets

Open `/?ship=shokaku` or select this ship in port or Custom battle.

`blueprint.json` and `build.py` are the durable inputs; reusable equipment comes from `assets/parts/`. `recipe-inputs.json` declares additional original dependencies. Generated Blender scenes and runtime models are build outputs.

Before changing historical geometry, inspect the corresponding GameModels3D or War Thunder model as the primary visual reference. If unavailable, state that explicitly.

Authored hull: 257.5 m long, 26 m beam, 8.87 m draft. These are model inputs, not a new historical-accuracy certification.

- **Exterior:** Independent original geometry based on S01-S06. S02 is a secondary arrangement with unverified drawing provenance; hidden offsets and exact bridge dimensions remain unresolved.
- **Internals:** Named machinery, ordnance, service, steering and side voids are gameplay volumes, not a recovered ship subdivision plan.
- **Air wing:** Global gameplay complement of 48 aircraft: 16 fighters, 16 dive bombers and 16 torpedo bombers. Aircraft types remain specific to this ship; this is not a historical manifest.
- **Flight deck:** The operational forward elevator has an opening through the flight-deck slab and adjoining upper-hangar roof, matching the existing platform footprint. Painted markings follow timber, steel and the independently owned lift surface with a 0.5 mm visual coating. Lift drive mechanisms, lower loading access and the other elevator openings remain unresolved; this correction does not certify full elevator travel or historical mechanism detail.
- **Weapons:** Six open Type 89 A1 and two gas-shielded A1 Mod 2 twins; twelve Type 96 triples. Positions are plan-measured estimates. Ballistics, service timings, ammunition and aircraft flight performance remain gameplay calibration.

```sh
bun run ship:compile shokaku
bun run ship:build shokaku
bun run ship:review shokaku
bun run ship:check shokaku
```

Keep the current fixed views in `generated/review/`. Ship report/reference archives are removed. Research downloads, diagnostic results and extra captures belong in ignored `.build/`; do not recreate a tracked archive. Keep source links and lasting limitations here.

Follow the [ship pipeline](../../../docs/ship-pipeline.md) and [model review](../../../docs/ship-model-review.md). See [authoring tools](authoring/README.md) for ship-specific commands.

Appearance follows the [shared fleet finish](../../../docs/ship-appearance.md).
`appearance.json` preserves this recipe’s colors, scheme and deck coverings while
adding the shared matte materials and restrained original surface wear. Existing
markings and plank detail remain intact; this is not a new historical-accuracy claim.
