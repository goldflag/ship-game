# Local patches to Water Pro 3.5.1

## Optional refraction removal

The `refractionEnabled` option passed to `WaterSystem.create` defaults to true in
the library; the game chooses false before the first surface material is built.
The shared Fresnel object retains the choice across preset and quality changes.
`WaterSystem.refractionEnabled` exposes the choice as a read-only property.
Changing the graph after rendering caused a WebGL context loss in a diagnostic,
so runtime switching is deliberately excluded from the public API. The WebGPU
performance probe can rebuild the graph through private fields for comparison.

When disabled, the above-water surface uses the water medium color without
sampling submerged scene color. A submerged camera sees an unwarped view through
the interface. Above-water captures omit transparent effects, and the water-depth
pass is skipped while underwater rendering is conservatively disabled. Opaque
scene color/depth remain available for shoreline contact and ship reflections.
Transparent effects therefore no longer appear in the surface reflection capture.
The sky reflection, FFT waves, foam and wakes keep their existing settings.

Submerged cameras retain the complete scene/transparent captures and water-depth
pass for underwater fog. The game also disables the optional full-screen
underwater distortion. `SceneCapturePass` restores the renderer's transparent
flag even when a capture throws. The optional third capture argument defaults to
the original behavior, and the declarations mirror the bundle additions.

Validation uses `src/game/OceanCapture.test.ts`, the actual submarine diagnostic
`scripts/diagnostics/underwater-visibility.html?test`, and the production custom
battle with ship, aircraft, distant and binocular views. Temporary measurements
and images belong under `.build/`.

## Grazing water detail

`build/index.js`: the Fresnel/reflection-normal grazing guard (`rp`) is `1e-4`,
with its orthogonal component (`Nn`) derived as `sqrt(1 - rp²)`.
Upstream used `0.05` and `sqrt(1 - 0.05²)`.

The old guard clamped every incident cosine below 0.05 to the same reflectance
and bent the reflection normals to that angle. A 29 m observation point has
a sea-view cosine of about 0.0058 at 5 km and 0.00145 at 20 km. The old guard
therefore erased the lighting differences between distant wave slopes, exposed
by binocular magnification. This smaller positive guard retains protection for
back-facing normals without flattening ordinary battle sightlines.

Mip filtering, slope-variance roughness, reflection horizon protection, fog,
wave simulation and geometry are unchanged. The constants do not add shader
samples or rendering passes. The existing dielectric function for submerged
views is unchanged.

The vendor distribution contains the runtime bundle and declarations, without
the original TypeScript implementation. Preserve this patch when replacing
the bundle until upstream has an equivalent correction. Run the production
shader regression in `/scripts/diagnostics/water-detail.html`; see
`assets/reviews/water-detail/README.md` for before/after evidence.
