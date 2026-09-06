# Fletcher-class destroyer

An independently authored early-war 1942-inspired Fletcher preset, rebuilt against GameModels3D comparison rasters, original US Navy ONI side/deck drawings and July 1942 Bureau of Ships photographs through the shared version 1 blueprint pipeline. Select **Fletcher** in port or on either side of a custom battle.

- Five articulated single 127 mm / 5-inch guns, plus one twin 40 mm and six single 20 mm mounts.
- **3 — Torpedoes:** two trainable quintuple mounts, ten Mk 15 rounds total, without spare reloads. Bring either broadside 40–140° from the bow toward the sight; wait for the mounts to train, then press left mouse / Q for one tube, or hold for a spaced salvo. Runs are straight at about 45 kn for 5.5 km, at 2 m depth, arming after 300 m. Gunnery → Target waterline supplies lead.
- **4 — Depth charges:** two stern racks and six side throwers, with 28 charges. Press left mouse / Q for one charge or hold to release a pattern. Charges enter the water, sink at 2.5 m/s, and burst at 10 m. Blast damage falls with distance to the submerged hull, within a 32 m radius. A close pass is required; keep moving clear. Your ship and allies can be damaged too.
- Hull HP: 600 under the common displacement rule. Equipment condition is separate; hull failure, flooding or capsize can sink the ship. Speed: 36 kn. All handling, damage, flooding, magazine health, depth-charge stocks and reloads are provisional game tuning.

Depth charges affect nearby surface hulls and submerged submarines within their three-dimensional blast reach. Type VIIC can dive below the shallow charge pattern. The fixed burst depth and broad blast radius are gameplay adaptations; selectable burst depth and sonar are absent. Damage uses the shared hull durability, equipment, breach, flooding and score rules.

The hull is 114.7 × 12.1 m, with an approximate loaded 4.2 m draft and 2,924 tonne gameplay displacement. Revision 3 corrects the deep raked bow, fuller foredeck, transom and bridge proportions against matching reference views. It retains the raked open funnels, raised torpedo banks, working-deck detail and original camouflage. Sources support the class identity, principal dimensions and main weapon counts; the chosen load, hull offsets, armor and many fittings remain estimates. The light AA fit is inspired by early-war equipment, not certified to a specific day. Read the [source register](references/sources.json) and [discrepancies](reports/discrepancies.md).

`blueprint.json`, `build.py`, the optional `author-shape.py` shape authoring helper, and the original catalog in `assets/parts/guns.json` are the durable sources. The GLB, thumbnail, Blender scene and fixed review images are reproducible outputs. No commercial game mesh or texture is used. Local Blender was used; Blender MCP was unavailable.

Revision 4 rebuilds the five Mk 30 enclosures and both screws from inspected Navy component references and matching GameModels3D closeups. The gunhouses now share original facets with CPU armor and have separate elevating shields. The handed propellers have broad rounded blades, camber, thickness, shaped hubs and shaft brackets. See [turret and propeller corrections](reports/components.md). Regenerate the Mk 30 catalog facets with `python3 assets/parts/author-mk30.py`; propeller controls remain in `build.py`. The previous sources and views are preserved in `baseline/revision-3/`.

```sh
bun run ship:compile fletcher
bun run ship:build fletcher
bun run ship:check fletcher
bun run ship:review fletcher
bun test src/simulation/fletcher.test.ts src/game/ShipView.test.ts
bun run build
```

The development-only `/scripts/diagnostics/fletcher.html` fixture loads the production model, ocean, Fleet HUD, damage and effects. Its `window.fletcherReview.setup('main' | 'secondary' | 'torpedo' | 'depth-charge')` and `advance(seconds, heldFire)` methods reproduce short weapon reviews. It remains outside the production entry point.

See the [hull and superstructure correction](reports/shape-correction.md), [earlier model revision report](reports/refit.md), [matching before/after and source review](generated/comparison/index.html), and [validation report](reports/validation.md). The local comparison page is served at `/ship-reference/fletcher/index.html`. Original prototype files and revision-2 sources/review evidence are preserved under `baseline/initial-prototype/` and `baseline/revision-2/`.
