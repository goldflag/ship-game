# Local patches to Water Pro 3.5.1

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
