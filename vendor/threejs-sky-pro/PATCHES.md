# Local patches to Sky Pro 2.2.0

## Lunar cloud lighting — September 7, 2026

The retained runtime bundle is patched in `build/index.js`, with the corresponding
constructor declaration in `build/baking/AmbientSkyBaker.d.ts`. Reapply or verify
these changes when replacing the upstream bundle; its original license still applies.

- `AmbientSkyBaker` accepts the existing `TimeOfDay`. Its diffuse cloud fill now
  includes the dome's lunar radiance: moon color × intensity × ambient × phase
  illumination × positive moon elevation. Zenith/horizon fill uses 65% of that
  radiance and ground fill 20%. These gains are artistic, not calibrated scattering.
  The cache includes the resulting lunar RGB, so phase/color/intensity/elevation
  changes invalidate it and returning to daylight removes the contribution.
- The cloud march's two aerial-perspective paths include lunar in-scattering,
  weighted by lost atmospheric transmittance. Its far-distance sky blend includes
  the same lunar radiance. Previously these sun-only paths faded clouds to black
  against a moonlit sky. The visible clouds and reflection bake share this shader.
- The final cloud composite keeps RGB premultiplied by the adjusted coverage when
  steepening night opacity. Increasing alpha alone created dark silhouettes and
  amplified small horizon samples into conspicuous black blocks.

No new passes, cloud samples, textures or render-target sizes are introduced.
The generated upstream source map is unchanged and does not describe local patches.
See [the GPU review](../../assets/reviews/night-lighting/README.md) and its diagnostic
fixture for the actual renderer checks, including night, dawn and port restoration.
