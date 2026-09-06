# Main turret proportions — revision 4

The previous twin gunhouse was about 24% too short in the fixed GameModels3D side view. The quadruple was about 11% too short, its roof was about 10% too wide, and its crown lay 3.3 m too far forward in the top view. This revision corrects those local proportions in our original catalog geometry.

[Side profiles: before / reference / revised](local-proportions.png) · [Top view: before / reference / revised](plan-proportions.png) · [Five fixed review views](fixed-review-contact.png)

| Raster measurement | Previous difference from reference | Revised difference |
| --- | ---: | ---: |
| Quadruple body length | −10.6% | 0.0% |
| Twin body length | −23.9% | +0.6% |
| Quadruple roof width | +10.4% | −0.2% |
| Twin exposed barrel length | +12.7% | −0.4% |
| Quadruple projected face height | +19.6% | 0.0% |
| Twin projected face height | +17.2% | −2.5% |

These are manual raster picks with approximately ±4 pixel boundary uncertainty, not claims of exact agreement. The [measurement register](measurements.json) retains the actual pixel coordinates, scales, before/after values and primary-drawing cross-checks. The crown moved from local X +0.5 m to −2.8 m, independently of the widest plan station.

The local side sheets translate each complete raster to one front-floor corner and use the same uniform display reduction. They do not scale individual components. The top sheets use exactly the same crop and camera. [Presentation registration](presentation-registration.json) records the translations; untouched, globally registered images are in the shared comparison page and the `before/matched` archive.

Original changes include 13.2 m quad and 11.9 m twin bodies, narrower and lower roofs, rounded roof cutouts over the elevation ports, longer rear barrel jackets, shorter exposed barrels, revised rangefinder roots and an aft location for B's rangefinder. B's barbette grows from 4.7 to 4.9 m radius. Two lower bridge forefeet retreat to leave the complete twin gunhouse room to rotate. Roof-mounted projectors follow the revised roof height. Stable assembly, joint, socket and barrel IDs are retained. The fitted hull, simulation rooms, machinery, stability and ammunition behavior are preserved.

Durable sources are `author-blueprint.py`, its `--catalog-only` mode, `author-turret-proportions.py`, `assets/parts/guns.json`, `blueprint.json` and `build.py`. The bounded refit preserves the already fitted internals. Reproduce it with the two authoring recipes, `author-evidence.py`, then the shared `ship:build` and `ship:review` commands. Local Blender 5.2 executes the original recipe; Blender MCP was unavailable.

RN mounting plates 2 and 62 and IWM photographs guide the form. Plate 62 supports a twin nearly as long as the quadruple. However, the gun-spacing-calibrated RN plan and the registered Vickers profile suggest roughly 12.7–12.8 m quad length, while the game raster measures about 13.2 m; the profile also suggests a taller crown. This visual revision follows the local game comparison and records that disagreement. The reference deck sits roughly 1.2 m below the authored standard-load deck in the shared cameras. No whole-ship vertical shift was applied. Exact mounting dimensions, load registration and minor fittings remain unresolved in the [discrepancy register](../discrepancies.md).

The final export hash is `9fe82d8913ea18f6983345a0f7819e434bc1ab48c4d03f235f94b33e23579f2f`. Its source, build and comparison passed with the raw game cache unavailable. The final suite passed 387 tests; `bun run build` passed. The [validation report](../validation.md) records the final runtime checks. `before/` retains the complete rejected revision and its original reports.
