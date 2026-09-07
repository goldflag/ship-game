# King George V validation

Completed 6 September 2026. The early-1941 preset is integrated and playable in the existing game. Historical limitations remain in the [discrepancy register](discrepancies.md).

Content hash: `a9398f04d9cb73a9c3e101f0574d92d6ed1242844718ada33c814f31be8c8dfc`.

| Check | Result |
| --- | --- |
| Shared ship build and export | Passed; 26 barrel chains across 11 independently moving mounts |
| Published GLB | 3,338,060 bytes; 91,581 triangles; 110 meshes; 303 primitives |
| Decoded geometry | All five measurements within 0.025 m of their declared targets |
| Fixed review cameras | Current profile, plan, bow, stern and quarter views inspected |
| Unit and simulation suite | 387 passed, 0 failed; 183,061 assertions across 49 files |
| TypeScript | `bun run typecheck` passed |
| Production build | `bun run build` passed, including six ship checks and all aircraft checks |
| Browser runtime | Published asset loaded on WebGPU; final diagnostic fixture reported no runtime error |

The shared Blender helper now supports enclosed quadruple mounts with the same barrel IDs as the compiler. Bismarck, Yamato, Baltimore, Enterprise and Type VIIC were rebuilt through `ship:build` after that helper changed; their export checks passed. Bismarck's preserved baseline was untouched. Blender MCP was unavailable: local Blender executed the original Python recipes.

Evidence: [export](export.json), [decoded dimensions](dimensions.json), [test log](tests.log), [production build log](production-build.log), [browser console](browser-console.json). The production build retains Vite's large-chunk advisory; this review is not a cross-device frame-rate benchmark.

The [five fixed views](../generated/review/) show the quad–twin–quad battery, eight secondary mounts, tower/funnel arrangement, aircraft gap and catapult, early light-AA fittings, original hull, four screws and paired rudders. The [camera register](../generated/review/cameras.json) records their transforms and the same content hash. Historical raster registration remains approximate, as described in the source and measurement registers.

Port checks used the ordinary UI: select KGV, open Statistics, Armor and Internals, filter for Boiler 1.1 and isolate it. The sheet reports `2 × 4 + 1 × 2`, 640 nominal main-battery salvo damage and 1,000 main rounds. The runtime articulation control exercised both train limits, elevation limits, full recoil and restoration. The largest recorded port muzzle error was 0.001942 m. The automated hierarchy test additionally exercises 18 pose combinations on a translated, rotated, pitched and rolled hull.

Evidence: [port](in-game-port.png), [armor](in-game-armor.png), [internals](in-game-internals.png), [isolated boiler state](in-game-isolation.json), [maximum articulation](articulation-starboard.png), [opposite articulation](articulation-port.png), [restored pose](articulation-restored.json).

Custom battle was configured through its real controls with KGV as player and friendly bot, against Bismarck and another KGV, at 5 km. All four independent actors and models loaded. Pause, resume and Return to port worked; return restored 7,400 rounds and zero floodwater. The embedded browser lost focus between automation commands, triggering the game's intended pause behavior. The launch check therefore establishes fleet integration, while sustained firing was checked separately with the controlled fixture below. See [setup](custom-battle-setup.json) and [runtime state](custom-battle.json), seed `2495879337`.

The saved [sea-trial fixture](sea-trial.html) runs the production Game, published GLB, CPU weapons/collision/flooding and visual adapters, with a fixed camera and explicit simulation steps. Open it through the development server, then call `kingGeorgeTrial.battery('main')`, `battery('secondary')`, `battery('secondary', 'he')`, `damage()` and `reset()` on that object. AP/HE changes use the actual loading interval. Aim is a free world-space point on an idle target 1.8 km abeam.

| Controlled trial | Observed result |
| --- | --- |
| Main AP | Ten shells fired; ten rounds spent; target condition fell from 1,380 to 1,280.24; water ingress recorded |
| Secondary AP | Eight shells fired; eight rounds spent; protected-hull impacts and five visible surface marks |
| Secondary HE | Eight shells fired; eight rounds spent; contact/burst outcomes and five surface marks |
| Incoming AP | Boiler 1.1 fell from 170 to 150 HP; four spaces breached; 2.32 m³ water after two seconds; two surface marks |
| Return/reset | 7,400 rounds; all modules restored; zero breaches, water and surface marks |

Incoming AP deliberately uses a high penetration budget to isolate the breach path; it is not a claim about the catalog shell's penetration. Firing images preserve effects while the fixture is paused, and flight outcomes come from CPU steps. Impact-record counts include internal and fragment interactions, not just shell strikes. Full flooding and loss of flotation are covered by the simulation suite.

Evidence: [sea-trial results](sea-trial.json), [main firing](sea-trial-main-ap.png), [secondary AP](sea-trial-secondary-ap.png), [secondary HE](sea-trial-secondary-he.png), [damaged boiler inspection](sea-trial-damage.png). All reviewed model evidence uses the hash above. Passing these checks demonstrates game integration and selected dimensional agreement, not historical certification.
