# Visible tracers in T shot follow — September 7, 2026

The previous effect hid each entire trail within 65 m of its shell. The default T camera is 48.09 m away, so following a salvo showed physical projectiles with no nearby trails. The old close-view test explicitly expected this disappearance and missed the player's required behavior.

[Before](before.png) · [Default T camera after correction](after.png) · [12 m zoom and orbit](close-orbit.png)

The correction removes the distance cutoff. Each ribbon endpoint now gets a width from its camera depth, with no physical-width minimum that could expand into a thick tube at close range. Segments crossing the eye are clipped to the near plane before widening. Width is applied before Three r185's instance transform; applying it through `positionNode` would instead scale the translated position. The detailed projectile, original trail history, pause, impacts and reset behavior remain intact.

The added regression exercises the actual `ShellFollow` and `CameraRig` together at the normal follow distance, then uses orbit and wheel input to reach 12 m. It failed before the correction with zero rendered trail segments. A second check covers a trail crossing the camera's near plane and verifies a width below three pixels at both ends at 720p.

The WebGPU captures use CPU-fired Bismarck salvos at 0.65 seconds, the normal Game renderer, the T keyboard action and production camera poses. The close view also drives the production drag and wheel listeners. Diagnostics retain the loaded ship hash, camera and effects, and [source hashes](source-hashes.json) identify the corrected renderer and review harness. `before.png` records the merged implementation from commit `6f060763`.

95 focused tests passed (7,384 assertions), covering camera controls, trail rendering inputs, combat effects, shell following, input dispatch and shell ballistics. `bun run build` passed the fleet/aircraft checks, TypeScript and Vite with the existing bundle-size advisory. The final WebGPU views were visually inspected. WebGL2 and worst-case GPU frame time were not measured.

To reproduce, open `/scripts/diagnostics/combat-effects.html` on the development server. Call `review.shellFollowStill()` for the normal T camera or `review.shellFollowStill(-2000, true)` for the closest zoom with an orbit. `review.capture()` returns the actual game canvas.
