# Fletcher validation

Validated 2026-09-06 after the reference-led model rebuild. Export content hash: `4697b4259a43065b9ad72a386daea744c665e75d125c499680f97fd81a14c958`.

## Build and simulation

- Shared `ship:compile`, `ship:build`, `ship:check` and `ship:review` passed. Local Blender 5.2 built and exported the original recipe; no Blender MCP tools were available.
- Export checks passed: **253,480 triangles**, **11,341,816-byte GLB**, 80 meshes, 12 gun mounts / 13 muzzles, two trainable torpedo assemblies / ten muzzles, and eight depth-charge release sockets. Stable joint and socket IDs are preserved. See [export.json](export.json).
- The rebuild changes Fletcher's blueprint and original recipe. It does not change the shared component recipe or combat implementation. The shared components and other ships had already been rebuilt during the initial feature; this revision rebuilt Fletcher.
- `bun test --timeout 15000`: **297 passed, zero failed**, across 40 files, with 34,336 assertions. The longer timeout accommodates the existing large bot-battle test without weakening assertions. Full output: [tests.txt](tests.txt).
- `bun run build`: passed all six ship checks, aircraft checks, TypeScript and Vite. Vite retains its existing large-chunk advisory. Full output: [production-build.txt](production-build.txt).

The suite includes blueprint validation, exact rotated weapon origins, torpedo broadsides and ammunition, ballistic depth-charge entry, timestep consistency, three-dimensional blast distance, flooding, friendly/self damage, scoring, bot release conditions, disabled magazines, projectile limits, reset, and actual exported-model articulation.

## Model and source review

- Visually inspected all five final fixed Blender views: profile, plan, bow, stern and quarter, under [generated/review](../generated/review/).
- Captured the actual exported GLB with the same ten orthographic cameras used for the isolated GameModels3D reference. Compared the silhouette, bridge, funnels, weapon layout and afterdeck; corrected funnel-cap rake, hull-number orientation and fine fittings after the first review. One global reference scale is recorded in the capture plan; no per-component fitting is used.
- Inspected the original ONI 222-US Fletcher recognition drawing and dated July 1942 Navy photographs. The later recognition/game AA layouts are distinguished from the early round-bridge fit. Full Sigsbee/Bath Iron Works plates could not be retrieved and were not used as measured evidence.
- The [comparison pack](../generated/comparison/index.html) includes the original prototype, matching reference views, source extracts, photographs, runtime captures and a manifest of their hashes. It is also served at `/ship-reference/fletcher/index.html`.
- Workbench fixed views show material colours. The packed, independently authored camouflage texture was inspected on the actual GLB in the production WebGPU scene.

## In-game articulation and weapons

Orca initially displayed the rebuilt Fletcher, but its preview later reset and returned `runtime_unavailable` and `browser_tab_closed` before the final captures could complete. Final checks used a fresh, isolated headless Chromium 151.0.7922.34 with WebGPU/Metal, without attaching to or changing the Orca browser. The development [weapon fixture](../../../../scripts/diagnostics/fletcher.html) loads the production Game, simulation, exported model, ocean, effects and Fleet HUD; its fixed camera and time controls make the checks repeatable.

- **18 articulation poses** passed: three train positions, three elevation fractions and both recoil endpoints. Maximum gun muzzle disagreement was **0.000597 m**; maximum torpedo muzzle disagreement was **0.00000242 m**. Full poses: [articulation.json](runtime-review/articulation.json).
- Additional close-up captures checked the actual GLB elevation-joint rotation against CPU elevation at **−15° and 85°**, with recoil, and recorded world muzzle positions. See [pose-closeups.json](runtime-review/pose-closeups.json), [port / low](runtime-review/articulation-close-port-low.png) and [starboard / high](runtime-review/articulation-close-starboard-high.png).
- Visually inspected the [exterior](runtime-review/exterior-quarter.png), [bridge](runtime-review/bridge-closeup.png) and [afterdeck](runtime-review/afterdeck-closeup.png) in the production harbour scene.
- All **ten torpedoes** trained, launched and hit a surfaced Type VIIC. Scoring capped at its 450 HP with one frag. See [launch](runtime-review/torpedo-launch.png) and [result](runtime-review/torpedo-result.json).
- **Eight depth charges** launched, entered the sea, sank and produced eight underwater blasts; ammunition fell from 28 to 20. A close-pass blast damaged the target and caused continuing flooding. All projectiles expired. See [blast](runtime-review/depth-charge-blast.png) and [result](runtime-review/depth-charge-result.json).
- Reset cleared torpedoes and charges and restored ammunition. No browser page errors occurred. See [reset](runtime-review/reset.json) and the compact [runtime summary](runtime-review/summary.json).

The initial feature's responsive HUD, keyboard, pause and return-to-port evidence is preserved with its original model under [baseline/initial-prototype/reports](../baseline/initial-prototype/reports/). This visual revision does not change those controls; the new captures above establish behavior with the rebuilt asset.

These checks establish model, pipeline and gameplay consistency. They do not certify historical accuracy. Source access limits, inferred hull lines, outfit and paint interpretations remain recorded in [refit.md](refit.md) and [discrepancies.md](discrepancies.md).
