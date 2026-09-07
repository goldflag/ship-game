# King George V validation

Completed 6 September 2026. Current original model hash: `4bb046b736b3ab0b36ab04ca06701ea206a85736bf80b40401067ef20e5dde0c`. Historical interpretations remain in the [discrepancy register](discrepancies.md).

| Check | Result |
| --- | --- |
| Shared build, compile and export | Passed; all 26 barrel chains across 11 mounts retained |
| Published GLB | 9,653,448 bytes; 264,791 triangles; 137 meshes; 411 primitives |
| Decoded dimensions | All five principal measurements within 0.025 m of their declared targets |
| Fixed review | Profile, plan, bow, stern and quarter views inspected |
| Reference comparison | 30 fixed cameras, historical drawing registration, original source gallery and portable ZIP |
| Independence | Complete production rebuild passed with the raw game reference cache unavailable |
| Unit and simulation suite | 387 passed, 0 failed; 190,693 assertions across 49 files (`bun test --timeout 15000`) |
| Production build | `bun run build` passed, including TypeScript, six ship checks and aircraft checks |
| Runtime | Current published model loaded on WebGPU; firing, damage, flooding, reset, inspection and articulation exercised |

Evidence: [export](export.json), [dimensions](dimensions.json), [measured geometry](measurements.json), [test log](tests.txt), [production build](production-build.txt), [independence](independence.json), [five fixed views](visual-iteration-03/fixed-review-contact.png). One preliminary bot test exceeded the default five-second wall-clock deadline during concurrent Blender work; the final full suite passed with a 15-second runner deadline. No simulation assertions or timing rules were changed. The production bundle retains Vite’s existing large-chunk advisory.

The hull, bridge, funnels and fittings use the retained Vickers drawings and independent recipes. The [third visual revision](visual-iteration-03/README.md) specifically replaces the main turrets’ incorrect sloping fronts and roof bevels with upright faces, continuous sides, rounded rear walls, shallow roof crowns and flared rangefinder covers, using RN plates 2/62 and IWM photographs. Both quadruple and twin mounting forms are represented separately. GameModels3D remains raster-only comparison evidence. Blender MCP was unavailable; local Blender 5.2 executed the original Python recipes. The Bismarck baseline remains untouched.

Port checks used the ordinary UI to open Armor and Internals, filter for Boiler 1.1 and select the machinery envelope. KGV’s **Reference review** link opens the comparison’s explicit `index.html` route. Read-only diagnostics are saved for [port](in-game-port.json), [armor](in-game-armor.json), [internals](in-game-internals.json) and [isolated boiler](in-game-isolation-ui.json). Runtime images below were captured from the controlled fixture using the same production renderer and ship view, rather than the surrounding React panels.

Full positive and negative train, minimum and maximum elevation, recoil and restoration were checked on the current model. The maximum recorded articulation muzzle error was 0.001941163 m. Close-up review at 40° elevation and full recoil showed the main barrels clearing their new openings. The automated hierarchy test additionally covers 18 pose combinations on a translated, rotated, pitched and rolled hull.

[Turrets in game](turrets-in-game.png) · [40° elevation and recoil](turrets-elevated-in-game.png) · [Positive train](articulation-starboard.png) · [Negative train](articulation-port.png) · [Restored port view](in-game-refined.png) · [Armor](in-game-armor.png) · [Internals](in-game-internals.png) · [Isolated boiler](in-game-isolation.png)

The retained [sea-trial fixture](sea-trial.html) uses the production Game, published GLB, CPU weapons/collision/flooding and visual adapters with explicit simulation steps. `review-browser.py` records it through the public Orca browser CLI. Its camera follows the actual mooring position after reset. Earlier runtime files, including superseded camera captures, are labelled and retained under the visual iteration archives.

| Controlled trial | Observed result |
| --- | --- |
| Main AP, free aim at 1.8 km | 10 shells fired; 10 rounds spent; target condition 1,380 → 1279.992; 0.1206 m³ water ingress |
| Secondary AP | 8 shells fired; 8 rounds spent; stopped/penetration/burst outcomes; 5 surface marks |
| Secondary HE | 8 shells fired; 8 rounds spent; contact/burst outcomes; 4 surface marks |
| Incoming AP | Boiler 1.1: 170 → 150 HP; 4 spaces breached; 2.3197 m³ water after two seconds; 2 surface marks |
| Return/reset | 7,400 rounds; all modules restored; zero breaches, water and surface marks |

Incoming AP deliberately uses a high penetration budget to exercise the breach path, separate from the catalog salvos. AP/HE changes use the actual reload interval. Impact-record counts include internal and fragment interactions. Full flooding and loss of flotation are covered by simulation tests. Gunport recesses remain visual details over a closed simplified CPU face envelope.

Evidence: [sea-trial results](sea-trial.json), [main AP](sea-trial-main-ap.png), [secondary AP](sea-trial-secondary-ap.png), [secondary HE](sea-trial-secondary-he.png), [damaged boiler](sea-trial-damage.png). Current records use the hash above; older hashes are retained only as labelled iteration history.

Passing these checks establishes game integration and selected dimensional agreement. The manually interpreted hull still needs a 1.2394 buoyancy calibration (about 31,177 t geometric displacement versus 38,641 t stated load); turret dimensions, UP projector stations and minor fittings remain provisional. These checks do not certify historical accuracy.
