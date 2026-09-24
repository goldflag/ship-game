# IJN Shōkaku — December 1941

December 1941; original armament; 48-aircraft gameplay complement; sourced reconstruction with unresolved offsets

Open `/?ship=shokaku` or select this ship in port or Custom battle.

`blueprint.json` and `build.py` are the durable inputs; reusable equipment comes from `assets/parts/`. `recipe-inputs.json` declares additional original dependencies. Generated Blender scenes and runtime models are build outputs.

## Approved brief

- **Fit:** December 1941 (Pearl Harbor), original armament; unchanged.
- **Reference:** GameModels3D `pjsa108` A_Hull, which WoWS builds from the sister Zuikaku in her 1944 fit. The
  refit rule applies: match the reference wherever the 1943–44 refit did not change the ship; its later additions
  are accepted differences.
- **Taken from the reference (September 2026 pass):** the forebody lines (fine entry, strong bow flare, level
  forecastle to the hangar front), mapped onto our 26 m beam and 8.87 m draft; flush hull and upper-hangar sides;
  12.7 cm platforms and tubs, 25 mm galleries and all 20 mount positions at its hardpoints; downturned funnel
  trunks 4.4 m further aft; director tubs; lattice radio masts; island lookouts, signal lamps and searchlight.
- **Accepted differences:** the 1943–44 extra 25 mm triples and singles with their tubs, galleries and canvas
  screens, the Type 21/13 radars and radar director, the flight-deck safety-net panels and aft transverse
  platform, and the second starboard-forward director. Kept from the recipe where the reference disagrees: the
  26 m waterline beam (the reference's is about 24 m), the midbody and afterbody lines, the two aft directors,
  the two extra port radio masts and the island launch.

Authored hull: 257.5 m long, 26 m beam, 8.87 m draft. These are model inputs, not a new historical-accuracy certification.

- **Exterior:** Independent original geometry based on S01-S06, with the pjsa108 corrections above. S02 is a secondary arrangement with unverified drawing provenance; hidden offsets and exact bridge dimensions remain unresolved.
- **Internals:** Named machinery, ordnance, service, steering and side voids are gameplay volumes, not a recovered ship subdivision plan.
- **Air wing:** Global gameplay complement of 48 aircraft: 16 fighters, 16 dive bombers and 16 torpedo bombers. Aircraft types remain specific to this ship; this is not a historical manifest.
- **Flight deck:** The operational forward elevator has an opening through the flight-deck slab and adjoining upper-hangar roof, matching the existing platform footprint. Painted markings follow timber, steel and the independently owned lift surface with a 0.5 mm visual coating. Lift drive mechanisms, lower loading access and the other elevator openings remain unresolved; this correction does not certify full elevator travel or historical mechanism detail.
- **Weapons:** Six open Type 89 A1 and two gas-shielded A1 Mod 2 twins; twelve Type 96 triples. Positions follow the pjsa108 hardpoints. Ballistics, service timings, ammunition and aircraft flight performance remain gameplay calibration.

```sh
bun run ship:compile shokaku
bun run ship:build shokaku
bun run ship:review shokaku
bun run ship:check shokaku
```

Keep the current fixed views in `generated/review/`. Ship report/reference archives are removed. Research downloads, diagnostic results and extra captures belong in ignored `.build/`; do not recreate a tracked archive. Keep source links and lasting limitations here.

Follow the [ship pipeline](../../../docs/ship-pipeline.md) and [model review](../../../docs/ship-model-review.md). See [authoring tools](authoring/README.md) for ship-specific commands.

Appearance follows the [shared fleet finish](../../../docs/ship-appearance.md).
`appearance.json` preserves this recipe’s colors, scheme and deck coverings. It wears In commission, drawn by the game like every ship's (plating, mottling, runoff, tide stain, funnel soot); Blender bakes only fine paint grain.
The flight deck's weathered planks are modeled geometry (0.17 m boards at 0.176 m
pitch, 5 to 7 m long, seven stains over the slab); `decking` declares them
`modeled`, so the game adds no planks. This is not a new historical-accuracy claim.
