# Distant ship depth review — 2026-09-05

The normal perspective depth buffer could not consistently distinguish nearby ship surfaces at long ranges. At 24×, the Bismarck superstructure showed speckled interference. Raising the near plane from 0.5 m to 500 m removed the interference in the same 5 km view, isolating depth precision rather than overlapping model geometry.

The game now requests reversed depth. Three.js's scene pass uses a floating-point depth attachment, retaining the close near plane for bridge and shell-follow cameras. Sky Pro's fixed background depth is adjusted to the active depth convention; without that adjustment its cirrus layer paints over opaque ships. The raymarched cloud layer retains its camera-projected depth. No ship geometry or vendor source changes are involved.

- [Before](before.png): standard depth, 0.5 m near plane.
- [After](after.png): reversed depth, same near plane, camera, 24× magnification and stationary Bismarck at 5 km. Unedited 1920 × 1080 canvas captures from the actual game on WebGPU, Medium quality.

## Repeatable GPU checks

Run `bun run dev` and open `/scripts/diagnostics/ship-depth.html`.

- `await depthReview.checkDepth()` draws a green foreground fitting and a red backing surface 1 cm apart at 1, 5, 10 and 20 km, in both submission orders. It uses the actual Game renderer and the main scene pass's depth format. All eight center pixels must remain green. Standard depth failed this test before the fix; reversed depth passed all eight cases on WebGPU and WebGL with `EXT_clip_control`.
- `await depthReview.checkSkyOcclusion()` compares a 5 × 5 hull patch with sky layers visible and hidden. Opaque hull pixels must be unchanged (maximum channel difference ≤3). WebGPU passed with a difference of 0.
- `depthReview.prepare(range, near)` restores the stationary 24× view; `await depthReview.still()` renders and returns its PNG data URL. Manual frames also advance the renderer's node clock, avoiding stale pass textures in background tabs.
- `?standard=1` disables reversed depth before renderer initialization as a negative control. `?webgl=1` forces the actual WebGL fallback by declining a WebGPU adapter.

WebGL reversed depth requires `EXT_clip_control`; Three.js retains standard depth if that extension is unavailable. Such older backends retain the original distant-depth limitation. The diagnostic uses private Game/renderer fields and is excluded from the production entry points.

The [WebGPU check results](webgpu-checks.json) record depth ordering and sky occlusion. Full-scene WebGL visual verification remains incomplete: its initial canvas readbacks were blank, so `still()` was adjusted to present and capture synchronously; Orca then closed the runtime connection during the repeat check. The WebGL hardware-depth readback passed independently of canvas capture.

Validation: 81 relevant camera, aiming, game/frame, ballistics and combat tests passed; `bun run build` passed with the existing bundle-size warning.
