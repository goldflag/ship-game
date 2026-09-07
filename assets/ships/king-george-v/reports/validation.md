# King George V validation

Completed 6 September 2026. Current export: `9fe82d8913ea18f6983345a0f7819e434bc1ab48c4d03f235f94b33e23579f2f`.

Revision 4 corrects the main turrets' local proportions. The twin body was about 24% too short and the quadruple about 11% too short in the retained GameModels3D cameras. The original catalog now uses 11.9 m twin and 13.2 m quad bodies, lower and narrower roofs, an aft quad crown, revised barrel contours and rounded roof cutouts over the gun openings. B's barbette and two lower tower forefeet were adjusted for the complete mounting. Stable assemblies, joints, sockets and all 26 barrel chains remain intact.

[Before / reference / revised profiles](visual-iteration-04/local-proportions.png) · [Top comparison](visual-iteration-04/plan-proportions.png) · [Measured evidence and source disagreement](visual-iteration-04/README.md) · [In-game close-up](turrets-in-game.png)

| Check | Result |
| --- | --- |
| Shared compile, build and export | Passed; 26 barrel chains across 11 mounts |
| Published GLB | 9,683,076 bytes; 266,121 triangles; 137 meshes; 411 primitives |
| Independent decoded dimensions | Five principal hull measurements passed, within 0.025 m |
| Fixed visual review | Profile, plan, bow, stern and quarter inspected |
| Reference comparison | 30 unchanged fixed cameras; seven manual local raster measurements; three primary drawing cross-checks |
| Independence | Full production rebuild passed with the raw game cache unavailable |
| Unit and simulation suite | 387 passed, 0 failed; 190,693 assertions across 49 files; 95.48 s |
| Production build | Passed TypeScript, all six ship checks, aircraft checks and Vite |
| Runtime | Production Game on WebGPU in isolated Google Chrome; firing, damage, flooding, reset, inspection and articulation passed |

The tests used `bun test --timeout 15000`. Vite retains its existing large-chunk advisory. Evidence: [export](export.json), [dimensions](dimensions.json), [tests](tests.txt), [build](production-build.txt), [independence](independence.json), [fixed review](visual-iteration-04/fixed-review-contact.png).

The Orca review page was recreated between commands while its desktop window was unavailable; the interrupted attempt is retained under revision 4. Final runtime evidence comes from the same [production scene fixture](sea-trial.html), exercised through [review-headless.mjs](review-headless.mjs) in a separate browser. It uses the installed Chrome and temporary playwright-core 1.55.1 tooling under `.build/`; no production dependency was added. [Browser diagnostics](headless-browser.json) confirm WebGPU, the current model hash and no page errors. [Execution log](headless-browser.txt) records the captures. Earlier ordinary port-UI checks remain historical evidence in `visual-iteration-04/before/reports/`; they are not claimed as new checks.

Full positive/negative train, minimum/maximum elevation, recoil and restoration were exercised. The maximum recorded articulation muzzle error was 0.001737536 m. The 40° elevation/full-recoil close-up shows the main barrels clearing the revised openings. The automated hierarchy test also exercises 18 combinations on a translated, rotated, pitched and rolled hull. Previewing maximum train does not certify every firing bearing; CPU obstruction checks retain authority over firing.

[Elevated turrets](turrets-elevated-in-game.png) · [Positive train](articulation-starboard.png) · [Negative train](articulation-port.png) · [Runtime review sheet](visual-iteration-04/runtime-contact.png)

| Controlled trial | Observed result |
| --- | --- |
| Main AP at 1.8 km | 10 shells / 10 rounds; 213 impact records; target condition 1,380 → 1,281.414; 0.1266 m³ ingress |
| Secondary AP | 8 shells / 8 rounds; 25 impact records; 5 surface marks |
| Secondary HE | 8 shells / 8 rounds; 22 impact records; 4 surface marks |
| Incoming AP | Boiler 1.1 HP 170 → 150; four spaces breached; 2.3197 m³ water after two seconds |
| Reset | 7,400 rounds; all modules restored; zero water, breaches and surface marks |

[Trial results](sea-trial.json) include the current hash. Incoming AP deliberately uses a high penetration budget to exercise the breach path. Impact records include internal/fragment interactions. Armor, internal spaces and boiler isolation were inspected through the production ShipView in the fixture. The renderer-free simulation remains authoritative.

Local Blender 5.2 executed the original Python recipes; Blender MCP was unavailable. Only the two KGV main-gun catalog entries changed in this revision. The fitted hull, rooms, machinery, stability and Bismarck baseline were preserved.

The historical drawings and game raster do not agree exactly: the RN/Vickers evidence suggests roughly 12.7–12.8 m quad length and a taller crown, while the game view is about 13.2 m long. This revision follows the local game proportions and retains that conflict, along with the approximately 1.2 m deck-datum difference, in the [discrepancy register](discrepancies.md). Gunport recesses are visual details over closed simplified CPU face/roof envelopes. The hull still requires a 1.2394 buoyancy calibration. Passing export, tests and selected dimension checks does not certify historical accuracy.
