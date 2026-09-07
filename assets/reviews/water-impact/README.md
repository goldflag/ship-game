# Shell water impacts — September 7, 2026

This first-pass streaked appearance is the selected direction. The [restored streaks, current animation and checks](streaks/README.md) retain this recipe with current lighting and offscreen culling.

The splash now rises as a coherent, irregular water column with a low outward crown. Thin sheets lose cohesion as gravity pulls them back into the sea; small round droplets continue falling, and lighter mist drifts with the ocean wind. Incoming direction inclines the plume, caliber controls its size, and the CPU event's surface height anchors both the column and returning spray.

The previous recipe used eight smoke-like raymarched spheres per splash. `src/game/WaterPlumes.ts` now builds fourteen column sheets and ten crown sheets per impact in one bounded mesh batch. Curved, world-space strips keep their orientation through the apex and camera changes. Original procedural textures supply lengthwise filaments, irregular edges and gradual breakup. The mesh uses ordinary depth testing and normal alpha blending, with the existing sun direction and scene fog. The remaining ocean foam continues to use `FleetWakeFoam` / `WakeFoam` and the displaced water material.

## Runtime evidence

- [Eight-second animation](splash.webm): actual `Game.frame`, CPU gunnery, ocean, sky and effects, captured at 30 fixed simulation timestamps per second through Orca's browser.
- [Rising splash](rise.png), [crest](crest.png), [falling water](fall.png): 1.2, 2.4 and 4.8 seconds after firing, respectively. These include shell flight time, not just splash age.
- [Binocular-distance view](binoculars.png): the same salvo from 5 km, with a 4.33° vertical field of view. The water column remains visible against both the sky and the sea.
- Each capture has matching JSON diagnostics. `source-hashes.json` records the exact effect source files for this review.

The fixture is `/scripts/diagnostics/combat-effects.html`, medium water quality, North Atlantic defaults, WebGPU, 1920 × 1080 rendered pixels. The near camera is `[480, 64, 125]`, looking toward `[325, 13, -35]`, with a 52° vertical field of view. A normal Bismarck main-battery salvo supplies all shot and splash events. The fixture's wake update was corrected to pass the current fleet-view collection, and its video recorder now advances Three's node frame before each explicit render so the scene pass cannot reuse a cached image. Production gameplay uses the existing fleet update and animation loop.

## Validation and cost

`bun test src/game/WaterPlumes.test.ts src/game/CombatEffects.test.ts src/game/ShipWake.test.ts src/game/WakeFoam.test.ts src/game/FleetWakeFoam.test.ts src/game/renderOrder.test.ts src/simulation/shellTravel.test.ts src/simulation/ap-projectile.test.ts src/simulation/combat.test.ts` passed: **66 tests**, no failures. See [test output](tests.txt).

Checks include frame-rate independence at 30/60/144 FPS, gravity-driven rise and fall, impact-direction and caliber response, camera-independent sheet geometry, spray reentry above/below mean sea level, saturated pools, pause, reset, and existing shell/foam behavior. `bun run build` passed ship and aircraft checks, TypeScript and the production bundle; the existing large-chunk warning remains. See [build output](build.txt). The browser reported no console messages during the inspected still captures.

The water sheets use one draw call and at most 384 strips / 13,824 triangles. Spray and mist retain separate bounded instance batches; total combat effect capacity is 3,424. The [CPU measurements](plume-cpu.json) cover sheet publication with eight and sixteen simultaneous impacts, after warmup. They exclude GPU work and other game systems and are not a whole-game frame-rate measurement. The water column no longer performs per-pixel volume raymarching.

## Reference and limits

Visual reference: [U.S. Navy, Nimitz Tests Phalanx CIWS, June 23, 2019, photo 190623-N-VW723-0087](https://www.dvidshub.net/image/5542636/nimitz-tests-phalanx-ciws). The photograph guided the irregular whitewater silhouette, dense lower column and finer surrounding mist. It depicts small-caliber fire and is not evidence for a 38 cm shell's plume dimensions or timing. No source image is used as a runtime texture.

Launch speeds, dimensions, breakup and mist timing remain authored visual approximations. This is not a fluid simulation: there is no refractive liquid volume, spray-to-spray collision or feedback into combat. The existing caliber bounds and surface-foam coverage apply. No ship blueprint, model, joint, ballistic trajectory, hit or damage rule changed.
