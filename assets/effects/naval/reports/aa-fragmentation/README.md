# AA fragmentation and caliber visibility

Reviewed 2026-09-07. Source revisions are recorded in [source-hashes.json](source-hashes.json).

The owner supplied a [heavy flak reference](reference-heavy-aa.png) and a [current light-AA screenshot](reference-light-aa.png), then clarified that shells in general appeared the same size. These are visual direction, not historical ordnance evidence.

Heavy AA now ignites as an uneven fireball, with five short radial gas fingers and fourteen narrow fragments per burst. Fragments burn out within 0.38 seconds; hot gas cools within roughly half a second. Gas fingers disperse within 1.3 seconds, leaving the three charcoal volumes to drift and dissipate over roughly six seconds. The existing bounded smoke and ignition pools are reused, adding no draw calls or particle capacity. More smoke volumes are active briefly; this review does not establish a worst-case fleet GPU bound.

Automatic AA events now retain the fitted caliber. AA tracer width and exposure length vary with caliber; smaller tips and envelopes reduce the bright dash appearance. At equal range, a 20 mm AA core is about 44% as wide as a 105 mm core. Manual shell heads, glows and vapor trails also scale with the square root of caliber, preserving range/zoom compensation. Main-shell glow diameter is halved at ordinary battle distances, with opacity reduced from 0.65 to 0.22 and lower emission. Physical shell geometry and CPU ballistics are unchanged.

## Runtime captures

All images are direct, unedited canvas captures from the actual WebGPU game renderer through Orca's embedded browser, medium quality and resolution 1. AA comparisons use identical controlled muzzle snapshots, camera, time and viewport in `/scripts/diagnostics/anti-aircraft-effects.html`. Baseline effect classes were imported from the recorded base revision into temporary adjacent modules, swapped into the same scene, then disposed; those modules were removed. The fixture now renders explicitly so background tab throttling cannot return a stale capture.

| State | Before | After |
| --- | --- | --- |
| Heavy AA, 0.1 seconds after detonation | [Smoke only](before-heavy.png) | [Fireball and fragmentation](after-heavy.png) |
| Light AA, two seconds of flight | [Broad heads](before-light.png) | [Fine tracer cores](after-light.png) |

Additional captures: [fragments and cooling at 0.3 seconds](fragments.png), [charcoal smoke at 0.8 seconds](cooled-smoke.png), [drift at two seconds](drift.png), [heavy shells in flight](heavy-flight.png), [main-gun flight](main-shells.png), and [close shell body](shell-closeup.png). Main-gun views use the existing combat-effects review with actual CPU firing.

[Runtime samples](runtime.json) retain twenty light tracers and eight heavy tracers in their respective flight frames. Heavy bursts replace those tracers with 64 smoke volumes and 112 fragments at 0.1 seconds. At nine seconds, all heavy burst particles and tracers have expired. Fragment counts share the existing `flashes` diagnostic.

## Validation

- 98 tests passed across `AircraftGunfire`, `CombatEffects`, `ShellTrails`, `CameraRig`, simulation AA and shell travel. Coverage includes caliber distinctions at equal range and binocular zoom, real fitted caliber propagation, captured ballistic endpoints, event-history eviction, late-frame cooling, pause, optics, expiry and reset.
- `bun run build` passed all ship and aircraft checks, TypeScript and Vite. Existing bundle-size advisory remains.
- The design detector returned advisory colors outside the HUD palette. Combat materials intentionally use their own steel, smoke and ignition colors.
- The older standalone `checkCombatEffects` GPU fixture is stale: its 13-draw ceiling predates the current 19-draw scene. With that ceiling temporarily corrected for diagnosis, both the original and changed effects fail its unlit shell-grid pixel check identically on WebGPU and WebGL2. [Compared results](legacy-gpu-fixture.json) record this limitation; the temporary diagnostic copies were removed. That fixture is not reported as passing. In-game WebGPU captures and the focused suites provide this change's validation.
