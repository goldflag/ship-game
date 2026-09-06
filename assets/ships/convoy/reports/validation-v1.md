# Archived convoy validation — revision 1

Superseded by the plan-led revision 2. This is the original numeric/UI record, not validation of current generated models; current fixed-view folders have since been rebuilt.

Build and review: 2026-09-05–06. Three representative Liberty fits and an extended-forecastle Flower-class corvette are registered in the port and Custom battle catalog. Each uses the version 1 blueprint/component pipeline and the existing renderer-free CPU combat simulation.

## Build evidence

All four `ship:build` operations passed using local Blender; no Blender MCP connection was exposed in this session. Five fixed review views per ship were generated with `ship:review` and visually inspected: profile, plan, bow, stern and quarter. The original cargo rigs, distinct deck loads/shelters, corvette fittings and separate gun assemblies are present. Retained render images and camera settings live in each ship's `generated/review/` directory.

| Preset | Triangles | GLB bytes | Functional mounts | Export |
| --- | ---: | ---: | ---: | --- |
| Liberty Cargo | 44,448 | 2,123,252 | 10 | Passed |
| Liberty Deck Cargo | 49,936 | 2,400,372 | 10 | Passed |
| Liberty Troopship | 48,704 | 2,328,132 | 12 | Passed |
| Flower Corvette | 28,228 | 1,328,112 | 4 | Passed |

Published definition/recipe hashes:

```text
liberty-cargo      a49bca84429f2dfa9f55b681e50608dd6bbe56fd6dff8bd0d72c10fd2d657cf1
liberty-deck-cargo 3b2e8d58afc5d24d8c74e1ef2be901214070fa81b7ffafdd7a10c89af0f12679
liberty-troopship  6ed8672a163705001d5df69912dd836fd21aeb6c7c0e03fa9813a69b04d2b180
flower-corvette   3c41f4a9783f7f77913ab2685198910d7b7acc186a8aee1014470d8b5682a862
```

`bun run build` passed all nine ship checks, thirteen aircraft checks, TypeScript and the production Vite bundle. The existing large main-bundle warning remains; asset sizes above are individual GLBs, not the complete application download.

## Simulation and articulation

The complete test suite passed: **405 tests, 0 failures**, 167,774 assertions across 49 files. Added coverage in `src/simulation/convoy.test.ts` exercises:

- Distinct fits, dimensions, mount inventories and handling.
- Every flood-cell and machinery-box corner contained within the authored hull.
- Calibrated upright displacement, positive reserve buoyancy and restoring stability.
- Both batteries training, firing only aligned/loaded guns, spending ammunition, reloading and resetting.
- Machinery loss, progressive water uptake, finite motion/steering, sinking and clean reset.
- Shell contacts on all six hull directions and local underwater breaches admitting water.
- An eight-ship mixed convoy with independent actors, both teams' bots moving/firing and reset.

Four added `ShipView` tests load the actual exported GLB hierarchies and apply the full train/elevation/recoil matrix. Rendered muzzle sockets agree with CPU poses within the 25 mm tolerance. Every gun retains stable yaw, elevation, recoil and muzzle IDs. Screw and rudder pivot empties are retained, although their motion is not simulated.

## Browser review

The Flower rendered with WebGPU in Orca's harbor. Orca Computer Use also confirmed the Flower's armor and translucent internal views in desktop Chrome. Repeated embedded-tab recreation, debugger-attachment and desktop window-selection errors interrupted those tools. The complete repeatable matrix therefore ran in a separate **headless Chrome WebGPU process**, with its own temporary profile and the real React app, game controls, simulation and renderer. No changes to the game's production entry point were needed.

All four presets passed port selection, both inspection modes, engine isolation/clear, catalog train/elevation/recoil limits and frozen port state (tick 0). The camera was allowed to settle before captures. Maximum live port muzzle discrepancy was **0.00001783 m**, well below the 0.025 m tolerance.

Each ship then launched a two-ship battle against a Flower at 1 km, accelerated, steered and fired for 20 simulated seconds, paused and returned to port. The Flower used its main battery; the Liberty ships used their forward-bearing secondary batteries. Separate CPU tests cover both batteries on each ship, including the aft Liberty main gun.

| Player | Rounds fired | Player / opponent impact marks | Return/reset |
| --- | ---: | ---: | --- |
| Flower Corvette | 4 | 1 / 3 | Passed |
| Liberty Cargo | 190 | 7 / 96 | Passed |
| Liberty Deck Cargo | 190 | 5 / 96 | Passed |
| Liberty Troopship | 190 | 6 / 96 | Passed |

The final mixed battle rendered all eight actors: one of each preset on each side, with Flower commanded by the player. Every bot moved and fired (24–51 rounds per Liberty bot, 17 for the enemy Flower). Impact marks appeared on every ship. Maximum live combat muzzle discrepancy stayed below **0.000020 m**. Every battle returned to tick 0 with original ammunition/integrity, no floodwater, no events and no impact marks. Actual gun smoke, flashes, water splashes and ship silhouettes were visually inspected in the captured frames.

Evidence: [port states and articulation](browser-v1/port-review.json), [battle/reset diagnostics and UI states](browser-v1/battle-review.json), and 25 canvas captures in `browser-v1/`. These JPEGs contain the rendered canvas; matching UI snapshots are in the JSON rather than overlaid in the images. Incomplete early tool captures were excluded from the accepted record.

This is a functional review, not a controlled performance benchmark. The headless run used default High/Atlantic settings at 1440 × 857 canvas resolution amid other desktop GPU work; individual battle readings were approximately 19–34 FPS (mixed fleet 27 FPS). Desktop Flower inspection showed about 55–67 FPS. Chromium emitted three overlay-mailbox messages around test teardown; the assertions and captures completed, with no reported device-loss error. Do not turn these spot readings into a minimum-FPS guarantee.

To repeat, start Vite, then run `bun assets/ships/convoy/review-headless.ts http://127.0.0.1:<port>`. `CONVOY_CHROME_BIN` overrides the local Chrome executable. The diagnostic HTML is not part of the production build. It interacts with observed controls, applies only the existing development articulation hook, captures evidence and stops its dedicated browser after completion.

## Accuracy and gameplay limits

These are independently authored, representative game ships. Hull offsets, detailed fittings, paint, load state, ordinary-steel thicknesses, gun performance, watertight layouts, pumps, CG/GM and damage tuning remain approximations. Published Flower dimensions/displacement and Liberty beam measurements disagree between sources; each discrepancy register identifies the chosen basis. The uniform buoyancy calibration matches the declared mass/draft but does not establish an accurate historical stability curve.

The Liberty variants share their hull and machinery but differ visibly in deck load/accommodation and, for the troop fit, gun inventory. Their aft main guns intentionally cannot fire through the superstructure at forward targets. All four have ordinary steel hull plating, not an armored citadel. Their equipment descriptions now derive the actual main-gun reload and machinery/shaft count.

The Flower's Hedgehog, depth-charge racks and throwers are visual fittings only. ASW weapons, sonar, cargo handling, passenger missions and aircraft combat are outside the implemented surface-combat systems. Cargo and auxiliary fitting articulation are also visual-only; only functional guns use the CPU combat joint contract.
