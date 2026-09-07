# Restored streaked water impacts

The current splash restores PR #80's first iteration, commit `06505595`: long directional water streaks, curved sheets, a low crown, fine droplets and drifting mist. Sheet shapes, launch speeds, delays, filaments and breakup timing match that version. Its lighter surface-foam recipe is restored too. This is the owner's preferred appearance, recorded in `DESIGN.md`.

The subsequent [parcel-column experiment](../polish/README.md) remains historical evidence. Current muzzle smoke and weather behavior are retained. Water continues responding to the live environment light, including while paused.

## Visual evidence

[Eight-second animation](splash.webm) · [rise](rise.webp) · [crest](crest.webp) · [collapse](fall.webp) · [foam](foam.webp) · [5 km binoculars](binoculars.webp) · [night](night.webp) · [storm](storm.webp).

The actual game fixture uses CPU Bismarck gunfire, the ocean, sky and effects at medium quality and 1920 × 1080. Near views use camera `[480, 64, 125]` looking toward `[325, 13, -35]`, at 52° vertical field of view; the 5 km view uses 4.33°. Stills are taken 1.2, 2.4, 4.8 and 6.8 seconds after firing, including shell flight. The video contains 240 actual rendered frames at fixed 30 Hz simulation timestamps; its render time is not an FPS measurement. Matching JSON files retain the camera, environment, event and model diagnostics. [Source hashes](source-hashes.json) identify the exact implementation.

## Rendering and validation

The sheets remain one bounded draw: 384 strips, 13,824 triangles maximum, covering 16 full impacts. Total combat-effect capacity is back to 3,424. Offscreen sheets keep aging but skip geometry publication; only used buffer ranges upload. Fine droplets and mist retain offscreen/subpixel culling. Visible sheet geometry is unchanged by camera distance or binocular zoom.

[68 focused tests](tests.txt) pass, including frame-rate independence, impact height, direction and caliber, camera-independent sheets, pause/reset, saturated pools, offscreen aging and unchanged detail under zoom. [The production build](build.txt) passes ship/aircraft checks, TypeScript and Vite, with the existing large-chunk warning.

[GPU checks](gpu-regression.json) exercise the production sheets under WebGPU and WebGL, each with standard and reversed depth. All four pass visibility, opaque occlusion, exact pause, lighting, saturation and reset/reuse checks without GPU validation errors.

[Paired performance measurements](gpu-effects.json) compare the restored effect with the original PR implementation using `scripts/diagnostics/water-performance.ts`: 30 alternating samples after eight warmup frames, Apple Metal 3, 1920 × 1080, isolated water rendering. CPU figures measure paused effect publication; GPU timestamps exclude browser scheduling. Neither establishes whole-game FPS.

Nearby CPU publication remains within 0.05 ms of the first iteration: 0.78 → 0.82 ms for eight impacts and 1.13 → 1.18 ms for saturation. For 32 distant impacts it falls from 1.13 → 0.34 ms, and offscreen from 1.12 → 0.05 ms. GPU samples were variable (millisecond-scale p90 swings); their full results are retained without claiming a reliable speedup. The geometry/draw budget matches the original, and culling removes hidden work without thinning visible streaks.

Launch speeds and dimensions remain authored gameplay approximations. No fluid solve or combat rule changes are introduced.
