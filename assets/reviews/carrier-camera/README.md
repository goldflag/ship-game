# Carrier camera — 7 September 2026

Validated with the WebGPU renderer at 1,302 × 1,003 logical pixels, medium water quality, two Enterprise carriers 20 km apart, and the map at its 80 km maximum width. Source baseline: `cb01ec2d`, with this carrier-camera fix applied.

- `before.png` restores only the original 57,000 m horizon-ring extent, reproducing the exposed rectangular sea edge. The camera retains its map viewing range.
- `after.png` uses the expanded 950,000 m ring at the same camera pose and frozen simulation time. Water fills the viewport.
- `review.json` records the actual geometry and frame-by-frame rotation/height during descent and ascent. Both change throughout the 1.4-second transition; rotation reaches 34.95° halfway and 69.89° at completion, with no final angular jump.

Open `/scripts/diagnostics/carrier-camera.html` in development to repeat the renderer review. Use `carrierCameraReview.frame(.1)` to step the paused renderer and `carrierCameraReview.maximum()` to restore maximum zoom. The page uses the actual `Game.frame` camera and water paths.

Validation: 70 camera, map-navigation, overlay and carrier-flight tests passed, plus `bun run build` (ship/aircraft asset checks, TypeScript and Vite). The water regression raycasts against the actual vendor mesh at maximum zoom/pan in 2,048 × 1,176 and 390 × 844 windows and verifies that reopening the map reuses the expanded geometry.
