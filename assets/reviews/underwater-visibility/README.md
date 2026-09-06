# Underwater visibility · 2026-09-06

The reported failure was an almost uniform blue screen while submerged. The original Black Flag absorption profile was designed around short underwater columns; it erased the VIIC at chase-camera distances. Disabling distortion did not restore visibility. Reducing only absorption did, with the same camera and geometry.

`Game.frame` now eases the coefficients down to 5% over the first 2 m of camera submersion. The original surface profile returns above water. This is a rendering adjustment for playability; no ship geometry, simulation, lighting or vendor source changes were needed.

| Same 50 m dive and camera | Capture |
| --- | --- |
| Original absorption | [Before](before.png) |
| Corrected absorption | [After](after.png) |

[Periscope](periscope.png) and [surface](surface.png) views retain the original absorption values. [Live gameplay at 50 m](gameplay.png) shows the complete hull from the normal chase view, after ordering a dive through the Depth panel.

The deterministic GPU diagnostic uses the actual Type VIIC GLB, Game frame, camera rig and Water Pro pipeline. A hull pixel counts as readable when it differs by at least 24/255 in one channel from the same scene with the hull hidden. More than 2% of the frame must contain readable hull pixels. At 7, 50 and 150 m, the original profile achieves about 0.073%; the corrected profile achieves about 12.6%. All three corrected views pass, and both above-water restoration checks pass. The original profile remains a failing negative control. These checks measure nearby hull visibility, not historical optical accuracy.

- GPU results, coefficients, camera positions and recovery checks: [runtime.json](runtime.json).
- Regression page: `/scripts/diagnostics/underwater-visibility.html?test` while running the dev server; add `&legacy` for the negative control.
- 33 relevant camera/game/submarine tests passed; `bun run build` passed.

The normal-game image is a direct canvas capture. Orca's separate HUD screenshot timed out because its browser capture lacked window visibility; the GPU diagnostic and canvas capture completed successfully.
