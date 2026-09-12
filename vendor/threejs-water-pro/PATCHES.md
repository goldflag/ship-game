# Local patches to Water Pro 3.5.1

## Naval-range ship reflections

The game's zoomed view can extend SSR rays to tens of kilometres. The bundle's
SSR DDA now clips the projected ray to the viewport before distributing its
existing step budget. The reciprocal-depth interval uses the same clip fraction,
preserving perspective-correct marching. Binary hit refinement uses eight steps
instead of four to resolve the existing 2 m tolerance across longer ray intervals.

`Fp`, the water reflection G-buffer allocator, uses nearest-filtered RGBA32F
instead of RGBA16F. Its alpha stores view depth in meters: half-float spacing is
4 m at 5 km and 16 m at 20 km, exceeding the hit tolerance and producing missing
or speckled reflections. Full-float storage adds eight bytes per full-resolution
pixel; hit refinement adds four depth reads per candidate crossing. The DDA step
cap, result texture, strength and quality feature gates stay unchanged. Preserve
these changes and the corresponding declarations when replacing the vendor bundle.

The actual-game diagnostic is `/scripts/diagnostics/water-reflections.html?test`.
It compares a stationary Bismarck at 5 km and 20 km with the original ray range,
then checks ordinary-view restoration. `&calm` removes wave displacement for a
mirror comparison; `&webgl` selects the fallback backend. Temporary GPU readbacks
and inspected before/after captures live under `.build/`.

High-quality WebGPU captures show wave-distorted reflections at both ranges.
WebGL passes the reflection-buffer and restoration checks too, but its final
canvas capture remains black in this fixture, as in the earlier surface-visibility
review. That fallback's final composition is not visually certified here.

## Straight-through surface visibility

The game enables the creation-only `surfaceTransmissionEnabled` option while
keeping `refractionEnabled` false and full-screen underwater distortion disabled.
The above-water shader samples opaque scene color at the original screen UV and
applies the game's custom-color absorption using scene depth minus the current water
surface fragment's view depth. It restores visibility of submerged hulls and
terrain without the wave-normal UV offset or a separate surface water-depth pass.
The below-water interface stays on its existing unwarped path.

Absorption is evaluated analytically from the existing custom-color uniform,
without compiling the unused physical-water lookup buffer into this surface
path. The combined lookup shader caused WebGL context loss during validation;
the custom-color expression avoids that failure and matches the WebGPU image.

The new option defaults to false in the library and is retained on the shared
Fresnel object across presets and quality changes. With refraction enabled, the
original refraction path takes precedence. There is no public runtime graph
switch. No performance measurement was requested for this restoration.

The actual-game WebGPU capture shows the fully submerged VIIC from above, with
refraction and underwater distortion both disabled. Dive visibility and recovery
checks pass at 7, 50 and 150 m. WebGL also passes those dive checks without shader
errors after the analytic-absorption change; its above-water diagnostic capture
is black with either transmission setting, so fallback surface visibility is
not certified. Temporary images and functional checks remain in `.build/`.

## Optional refraction removal

The `refractionEnabled` option passed to `WaterSystem.create` defaults to true in
the library; the game chooses false before the first surface material is built.
The shared Fresnel object retains the choice across preset and quality changes.
`WaterSystem.refractionEnabled` exposes the choice as a read-only property.
Changing the graph after rendering caused a WebGL context loss in a diagnostic,
so runtime switching is deliberately excluded from the public API. The WebGPU
performance probe can rebuild the graph through private fields for comparison.

When both refraction and straight-through transmission are disabled, the
above-water surface uses the water medium color without
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
