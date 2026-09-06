# Plan-led convoy ships — revision 2

These are three structurally different merchant designs and a rebuilt early Flower, not alternate cargo loads on one ship.

| Preset | Structural distinction | Nominal speed |
| --- | --- | --- |
| [Liberty Cargo](../liberty-cargo/README.md) | EC2-S-C1; amidship machinery, three single cargo masts, five holds | 11 kn |
| [Liberty Collier](../liberty-collier/README.md) | EC2-S-AW1; machinery and long poop aft, detached forward bridge, ten hinged steel lids and hatch-lifting posts | 11 kn |
| [Victory Cargo](../victory-cargo/README.md) | VC2-S-AP2; longer/wider hull, raised forecastle, paired kingposts and geared turbine | 15 kn |
| [Flower Corvette](../flower-corvette/README.md) | Cobalt's 19-Nov-1941 short forecastle, raised gun deck, open compass bridge, two tall masts and minesweeping stern | 16 kn |

Victory is explicitly a different class, not a Liberty variant. A tanker was considered but rejected as the silhouette solution: ABS describes the Liberty tanker as deliberately disguised to resemble the standard cargo ship.

Merchant main guns face aft. Keys 1/2 select main/secondary batteries. The Flower has a forward 4-inch, aft 2-pounder and two twin Lewis mounts; no later Hedgehog or Type 271 lantern. Depth charges and minesweeping gear are visual-only.

## Sources and authorship

[Original scans and provenance](references/plans/README.md) include Cobalt's actual 1941 builder GA, Thomas Sully's USMC/Gibbs & Cox Liberty plans and NPS HAER Winthrop Victory profile, deck and body plans. Collier evidence is weaker: ABS's class history, a reproduced interpretation and a dated Delta Shipbuilding launch photograph; no complete original collier GA was obtained.

[plans-v2.json](plans-v2.json) records dimensions, traced silhouette ordinates and scan registration. [author-blueprints-v2.ts](author-blueprints-v2.ts) emits an `apply_patch` patch for each authoritative blueprint and stability record. Keep authoring data and blueprint refinements in agreement. [geometry-v2.py](geometry-v2.py) independently builds components from the compiled blueprint; no reference raster or third-party mesh enters production geometry or textures.

Each `recipe-inputs.json` registers the shared original recipe and plan measurements in the content hash. Changes require rebuilding all four consumers. Preserve all assembly/joint/socket IDs and the Blender (+X bow, +Y port, +Z up) → runtime (-Y, Z, -X) conversion.

## Verification

Run `bun run ship:build <id>`, then `bun run ship:review <id>` and inspect profile, plan, bow, stern and quarter views. Run local Blender with `-b --python assets/ships/convoy/render-alpha-profiles-v2.py`, then `python3 assets/ships/convoy/compare-plans-v2.py` for uniformly scaled plan/model/overlay comparisons using the recorded camera, LOA and waterline. These use actual rendered alpha, not color-keyed cutouts, and never distort a silhouette to fit.

Run `bun test src/simulation/convoy.test.ts src/game/ShipView.test.ts` and `bun run build`. With Vite running, `bun assets/ships/convoy/review-headless.ts http://127.0.0.1:<port>` exercises the real WebGPU renderer, observed UI controls, inspection, articulation, battles, mixed fleets and reset in a separate temporary Chrome profile. Evidence is under `reports/browser/`.

Add `--port-only` for the shorter inspection/articulation matrix, recorded separately in `reports/browser-port/`. Captures stream individually so an interrupted final upload does not discard them. Only a successful `run.json` establishes a complete run; see the validation report for this session's thermal-sleep interruption and partial evidence.

See [validation](reports/validation.md) and each ship's discrepancy register. Passing exports are not historical certification.

[Merge integration evidence](reports/merge-validation.md) records the subsequent fleet-pipeline rebuild. `bun assets/ships/convoy/verify-merge-continuity.ts <reviewed-commit>` checks that the rebuilt simulation definitions, scene hierarchy, geometry and materials still match the reviewed commit; only the definition stamp and at most 1e-7 UV float rounding may differ. It never rewrites old screenshot provenance.

## Retired revision 1

`geometry-v1.py`, `author-blueprints.ts`, the deck-cargo/troopship originals and their generated models remain preserved but are no longer active presets. Their former public GLB/JSON/thumbnail files are archived under each ship's `retired-public/`, outside the game download. Old URL IDs resolve to the collier and Victory respectively. `reports/browser-v1/`, `validation-v1.md` and `sources-v1.json` record the superseded work; they do not validate revision 2.
