# Naval firing and shell effects

The [September 6 horizon and dissipation correction](horizon-order.md) shortens firing smoke to 4.5–6 seconds and preserves smoke/splash visibility when reversed-depth draw sorting would otherwise paint the ocean over them. Earlier recipes and captures below remain historical review evidence.

The September 2026 effects use directional muzzle ignition, large hot-gas volumes, drifting propellant smoke, local light, velocity-aligned shell streaks, armor sparks, aerated water columns, falling spray and lingering surface foam. Internal module damage alone does not create an exterior explosion; magazine detonation has an explicit event flag.

The follow-up revision addresses the Iowa firing reference and the rigid spray problem. Main-gun gas now starts 14–23 m across per lobe, expands quickly with a decaying expansion rate, and cools over 0.62–0.82 seconds. A full Bismarck salvo uses 24 overlapping gas volumes. Water columns use eight expanding volume lobes plus 132 round droplets per shell; water particles never align with velocity, so there is no rod that reverses direction at the apex.

The smoke motion revision follows the apparent pace of the supplied New Jersey firing footage. Both coarse billows and fine erosion travel in the same flow. Turnover decelerates with `log(1 + 0.6 × age) / 0.6`, with much smaller envelope deformation. Gentle erosion begins later, so the plume remains connected while its folds soften. Muzzle smoke has reduced buoyant rise, wind response and continuing expansion, with a 9–12 second lifetime. This replaces the rejected constant-speed shearing and opposing noise translations that made the smoke boil in place. The motion uses particle age rather than wall-clock time, so pausing also freezes the interior detail. This is authored turbulence, not a fluid simulation.

## Sources and approximation register

- Original procedural textures and particle recipes: `src/game/EffectParticles.ts`, `src/game/EffectVolume.ts` and `src/game/CombatEffects.ts`. No third-party effect textures or model geometry were copied.
- Cloud technique reference: the vendored `threejs-sky-pro` 2.2.0 density and cumulus lighting implementation (`build/tsl/density.d.ts`, `build/tsl/cloudLighting.d.ts`, and their implementations in `build/index.js`). The combat material independently implements a periodic Worley volume, coarse shape plus finer erosion, animated density coordinates, two sunward shadow taps and Beer–Lambert transmittance. It shares the actual sky's sun direction; it does not call private Sky Pro APIs or modify the vendored package.
- Visual inspiration: [US Naval History and Heritage Command, Iowa broadside photograph DN-ST-85-05379](https://www.history.navy.mil/our-collections/photography/us-navy-ships/battleships/iowa-bb-61/DN-ST-85-05379.html), whose catalog description identifies muzzle fire, varying barrel recoil and concussion on the water. This is a general large-gun reference, not evidence of Bismarck-specific propellant or timing.
- Motion reference supplied by the user: [New Jersey firing clip, uploaded by Patrick Clyde](https://www.youtube.com/watch?v=lFWh6xlsTm0). The 8.641-second upload cuts between two firing views. Frames at 1.5/2.5 seconds and 6/8 seconds show cohesive lobes gradually spreading after their respective blasts. Six decoded reference frames and their source record are retained in `../references/`; they are not used as effect textures or embedded in the artifact. The upload's playback speed and color treatment are not independently verified, so it guides apparent motion rather than measured physical rates.
- Implementation uses [Three.js node materials](https://threejs.org/docs/pages/NodeMaterial.html) with per-instance opacity. Texture generation is deterministic and original.
- Flash duration, smoke expansion, color, wind response, spray launch speeds and caliber scaling are authored gameplay approximations, not measured Bismarck values. There is no physical fluid solve for the particles, AP fuze simulation, fragment damage or new shell dispersion model.
- Smoke, hot gas and aerated water use bounded 3D raymarches. Their bounding planes cover the sphere's perspective tangent cone, or the viewport when the camera is inside a volume, avoiding a straight cutoff at oblique views. They do not determine occlusion: the march ends at the opaque scene depth, with a soft density floor near sea level. Small droplets, mist, sparks and ignition cores remain textured billboards. Only surface foam shares the ocean's actual displacement and lighting. The existing player-centered foam field covers 1,536 m; water impacts beyond that field retain airborne spray but do not leave surface foam.
- Volume light absorption is local to each lobe, with constant sky fill and no inter-volume shadow solve. Water volumes approximate aeration and breakup, not liquid refraction or a fluid solve. The volume material uses 12 view samples for gas and 10 for water; its cost grows with screen coverage and overlapping salvos.
- The CPU still owns all shell trajectories, firing, hits, module damage and flooding. Effect particles never feed collision results back into the simulation. No ship blueprint, joint, recipe or model changed.

## Runtime and regression checks

### Smoke rendering cost (2026-09-05)

The [performance review](smoke-performance.md) records an optimization that skips lighting in empty gas, stops effectively opaque rays, and renders each effect plane in one pass. Alternating WebGPU shader comparisons retain the smoke detail and reduce mature-smoke GPU cost by roughly 14–27% in the final recorded run. Effect batches fall from 13 submissions to 7. Timings isolate smoke and remain sensitive to background GPU work; they are not a gameplay FPS promise. The report includes pixel comparisons, reproduction commands and a pre-existing WebGL2 depth-clipping issue discovered by the additional check.

### Horizon smoke cutoff (2026-09-05)

The 5 km binocular view exposed a straight missing band through the propellant clouds. The smoke was present in the scene pass but disappeared in the final composition. Sky Pro's `applyTo` used opaque scene depth to apply a second fog layer after Water Pro's material fog. Because transparent smoke does not write depth, that layer used the distant ocean behind it; the preset's 9,100–12,600 m far fade replaced nearby smoke with sky color. Above the ocean, clear depth bypassed that fog, producing the sharp band.

`Game` now composes Water Pro's output directly before exposure, tone mapping, the armor overlay and FXAA. Water Pro's existing `scene.fogNode` continues to fog ship and effect materials at their own distances and blend the ocean into the sky. Sky rendering, clouds and reflections still use Sky Pro. Smoke depth clipping against ships and water is unchanged. Removing the duplicate fog also reduces the extra haze previously applied to opaque objects.

The real Game review adds `horizon`: camera `(5000, 18, 0)`, looking at `(0, 18, 0)`, vertical FOV 4.33°, 2.5 seconds after a CPU-fired broadside. The unedited [before](../review/horizon-before.png) and [after](../review/horizon-after.png) captures retain camera and combat diagnostics in their adjacent JSON files.

`checkCombatSmokeHorizon(window.review)` in `scripts/tests/combat-effects-browser.ts` reads the final display target and checks plume contrast against neighboring sky/sea on every row across the horizon. It failed before the fix (minimum contrast 0.00565) and passed after it (38 rows, minimum contrast 0.09836; threshold 0.04), at 1920×1080 using WebGPU in Orca. The full 122-test simulation/game suite and `bun run build` passed. The full ocean/sky composition was not separately reviewed on WebGL2.

To repeat, open `/scripts/diagnostics/combat-effects.html` on the local Vite server, wait for `window.reviewReady`, then run:

```js
const { checkCombatSmokeHorizon } = await import('/scripts/tests/combat-effects-browser.ts');
await checkCombatSmokeHorizon(window.review);
```

### Earlier effects checks

- `bun test src/simulation src/ships src/game src/schematic`: 54 passing tests. This includes metadata snapshots, world-space impact normals, equal spray trajectories at 30/60/144 Hz, pause/reset behavior, bounded storage, surface foam clearing while stationary, fire persisting at 0.35 seconds then cooling fully, and water droplets retaining a round profile through the apex.
- `bun run build`: passed, including all four ship export checks and TypeScript.
- Bismarck WebGPU runtime reviewed with fixed cameras: fire at 0.2 s, changing smoke at 1.0, 1.4, 2.6 and 4 s, rising water at 2 s, breakup near the apex at 3.7 s, and target armor contact at 1.05 s. The close smoke view also confirmed removal of the straight perspective-bound cutoff. PNG capture originals were encoded to WebP without painting or compositing the frames. Captures and camera/shot metadata are in `../review/`.
- 2,272 allocated effect elements (including 384 volume slots), 256 shell meshes and 256 shell streaks. Five effect batches and four non-shadowing transient lights. Capacities are fixed so Three r185 compiles full instance matrix buffers even when the initial scene is idle. Inactive instances have zero scale and opacity.
- The 2026-09-05 browser review used Orca's embedded browser and the local Vite server. The production WebGL2 compatibility backend was not separately exercised.
- The revised artifact retains 870 encoded renderer frames: 8 seconds of close smoke motion, 8 seconds of broadside, 8 seconds of water impacts and 5 seconds of armor contact at 30 fps, 1280×720. All four WebM clips decoded successfully in Orca, including seeking and quarter-speed playback. The artifact opens on the smoke close-up at normal speed. Revised posters are 1920×1080. The self-contained HTML is about 20 MB. Capture wall times are recorded separately and are not a gameplay frame-rate benchmark.
- Runtime checks also covered a six-shell secondary broadside, target inspection, an enabled target reset and return to port. Reset and port cleared every active effect; muzzle alignment remained within 0.0022 m. Artifact video switching, seeking and quarter-speed playback worked. Its 390 px layout had no horizontal overflow and all example buttons were 44 px high; the narrow screenshot could not be taken because Orca's tab capture timed out while unfocused.
- The smoke motion pass confirmed all four artifact buttons remain 44 px high at a 390 px viewport, with no horizontal overflow and every image loaded. A paused runtime with 141 active smoke lobes retained identical age, sphere and dissipation-progress attributes after a zero-delta update.
- The reference-paced revision was inspected at 1.4, 2.5, 4 and 8 seconds after firing. The large folds remain recognizable across the early frames, with subdued deformation and later thinning. The shader carries fine erosion with the coarse flow, reduces envelope displacement, and avoids the previous rapid internal counterflow. All 54 tests and the production build passed again; no new effect instances or texture taps were added. All four refreshed clips decoded and sought successfully, playback was restored to 1×, and the 390 px artifact layout retained 44 px controls without horizontal overflow.
- A numerical check of 7,001 camera rays confirmed the volume bounds contain the projected sphere at oblique angles and cover the viewport from inside.
- The design detector was run once. Physical shell/flash colors intentionally differ from interface tokens. The standalone artifact uses larger reading text than the compact in-game HUD, while retaining Barlow, Barlow Condensed and the naval palette.

## Pull request integration

The effects branch incorporates `master` through `e7cc1ed`, including the new aiming controls, interpolated ship poses, fixed projectile shader capacity and Bismarck plate protection. Effect updates use the final frame camera and the wake follows the interpolated hull. The capture harness now fixes its aim through the current aiming interface. Armor contact fragments face the incoming side regardless of polygon winding; a plate penetration followed by turret module damage produces one exterior contact effect.

The combined branch passes all 101 tests across 19 files (5,860 assertions), and `bun run build` passes the four ship asset checks, TypeScript and Vite. The existing projectile pool regression remains in the combined suite and checks caliber-scaled bodies as well as hidden slots. A new WebGPU smoke check at 1.4 seconds produced 24 active gas volumes with muzzle error below 0.0022 m and no runtime error. The browser pixel regression also passed empty startup, growing and shrinking salvos, resets and all 256 projectile slots; its occupancy threshold accounts for the new dark steel color in the linear render target.

The retained videos and posters were captured before the upstream Bismarck model and daylight updates. They document the reviewed firing, smoke and water recipes; the integration checks above cover the current game. No ship model or blueprint changes are introduced by this effects branch.

## Reproduce or update the artifact

Run `bun run dev`, then open `/scripts/diagnostics/combat-effects.html` in the Orca browser. It instantiates the real Game and model with fixed review cameras and a 1280×720 CSS capture surface. The review page trains the guns through the CPU simulation before firing; it does not synthesize impact events. Its focus/pause and frame-scheduling overrides apply only while recording this isolated review page. The recorder freezes GPU buoyancy readbacks for the navigation buoys outside these fixed, above-water views; the ocean, wakes and combat continue updating. Captures record this omission in their metadata. The game itself retains normal buoyancy updates.

```sh
python3 scripts/diagnostics/capture-combat.py broadside 0.2 output.png
python3 scripts/diagnostics/capture-combat.py smoke 1.4 output.png
python3 scripts/diagnostics/capture-combat.py splash 2 output.png
```

`window.review.record('broadside', 8)` encodes the real renderer with WebCodecs at 30 fixed simulation timestamps per second. During recording the harness drives the same `Game.frame` and deterministic ocean updates explicitly. Render wall time is independent of video duration, avoiding background-window throttling. The capture script remuxes VP9 packets from IVF to WebM without re-encoding. After completion, `python3 scripts/diagnostics/capture-combat.py video output.webm` saves it and its diagnostics. `window.review.still('broadside', 1.4, true)` reviews the secondary battery. The review harness and capture scripts are not production game routes.

Use `NAVAL_REVIEW_PAGE=<browser-page-id>` to direct the capture script to an explicit Orca tab. The `smoke` camera provides a closer view of the evolving gas. Run `python3 scripts/diagnostics/package-combat.py` to rebuild the self-contained `../review/artifact.html` from the retained WebM and WebP captures. The stills and recordings use the same effects implementation and medium scene quality.
