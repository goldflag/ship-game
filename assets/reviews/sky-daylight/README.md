# Sky daylight comparison

Open [the comparison](index.html) for side-by-side images or a draggable divider.

Captured September 5, 2026 from the existing `/scripts/diagnostics/harbor.html` page, using the actual `Game` renderer in Orca's embedded browser. Baseline revision: `c8c612c2f66da72224338656f6d46607e9f2f77e`. Settings: Bismarck, WebGPU, High quality, Atlantic sea, 1600 × 900 canvas at one rendered pixel per image pixel, ACES tone mapping and exposure 1. Images are unedited canvas PNGs, without the diagnostic status overlay or game instruments.

The game was paused after initialization. Both pairs were captured in that same session with frozen animation time; sky uniforms were updated live to the values subsequently saved in `src/game/Game.ts`. Each capture awaited the end of a complete Game frame after allowing the temporal sky and reflection passes to settle.

Port uses the default orbit (azimuth 1.08 rad, elevation 0.23 rad, distance 325 m) and ship x=240 m. Sea uses the default chase orbit (0.82 rad, 0.25 rad, 345 m) and ship x=0 m. Camera matrices were snapped after scene transitions. The game retains its normal animation when played; these images freeze it only for comparison.

The final parameter changes are recorded in [ocean configuration](../../../docs/ocean-configuration.md#softer-daylight-and-scattered-clouds). Cloud coverage controls are nonlinear and do not represent percentages of image area. The atmosphere is visually tuned, not a measured weather reconstruction.
