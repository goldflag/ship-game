# Ocean

The game's own ocean renderer. It replaces the vendored Water Pro 3.5.1 bundle with an
implementation we own, limited to what the game uses. Sky Pro stays vendored; the ocean
consumes its provider through `OceanSky` in `contracts.ts`.

## Clean-room rule

Water Pro's license forbids decompiling, deobfuscating or otherwise reverse engineering its
compiled bundle. Nobody working on this folder opens, reads, greps, diffs or pattern-matches
`vendor/threejs-water-pro/build/index.js` (or Sky Pro's `index.js`), including through tools
or subagents. Build from the game's own code, this document, three.js (`node_modules/three`),
published literature and black-box observation of the running game (screenshots, frame times,
values read through the public API the game already calls). The repository is public: code
here must be original work. Do not copy preset constants out of the vendor package; tune our
own parameters against captures instead.

Useful literature: Tessendorf, *Simulating Ocean Water* (2001) and *Interactive Water Surfaces*
(iWave, 2004); Horvath, *Empirical Directional Wave Spectra for Computer Graphics* (2015);
Hasselmann et al. (JONSWAP, 1973); Bruneton, Neyret & Holzschuch, *Real-time Realistic Ocean
Lighting using Seamless Transitions from Geometry to BRDF* (2010) for filtered slopes and
roughness; McGuire & Mara, *Efficient GPU Screen-Space Ray Tracing* (2014).

## Layout

| Path | Owns |
| --- | --- |
| `contracts.ts` | Interfaces between parts. Change a contract before changing both sides. |
| `Ocean.ts` | The facade the game holds: creation, per-frame update, parameters, sky binding, post-process. |
| `quality.ts` | The four tiers: cascades, mesh density, wake resolution, reflection budget. |
| `waves/` | CPU spectrum (seeded, normalised to Hm0), GPU evolution + inverse FFT, foam persistence, height readback. |
| `surface/` | Clipmap mesh and horizon ring, the surface material and its shading. |
| `wake/` | Dispersive wake field, generators, wake foam. |
| `screen/` | Scene fog node, screen-space reflections, underwater post-process and waterline. |
| `stubs/` | A temporary Gerstner stand-in for the wave field until the FFT field lands. |

## Frame

`Game.frame` calls `ocean.update(dt)` once, after ship poses, wake generators and lighting are
current, then renders. `update`:

1. advances `ocean.time` by `dt` (never when `dt` is 0: a paused frame renders without stepping
   waves, foam or wake);
2. follows the camera (clipmap snap, sky `followCamera`, underwater state);
3. updates the wave field (spectrum rebuild if dirty, evolution, FFT, foam) and steps the wake;
4. rebinds the environment texture if the sky rebuilt it, and moves floating objects.

The surface draws inside the game's normal scene pass, first in the transparent queue, so it can
read the opaque scene through three's viewport colour/depth copies. There is no second scene
render, no separate reflection G-buffer and no water-depth pass. `ocean.postProcess(scenePass,
color)` adds the underwater view to the game's output chain.

## Features

Everything below is in use today and must survive the replacement. Items marked *dropped* were
disabled or unused and are not rebuilt.

**Waves.** JONSWAP spectrum with peak wavelength, wind speed, γ, wind direction and directional
spreading; significant height is exact (normalise the realised spectrum so 4σ equals
`significantHeight`, time-averaged, over the tier's cascades). Choppy horizontal displacement.
Integer-safe seeded randomness (no float hash inputs). Periodic cascades, largest tile 1,024 m,
bands split so no wavelength is counted twice. Time folds modulo a period with every ω quantised
to it, so float32 time stays precise. CPU bounds on height and horizontal displacement replace
the old GPU readback of the spectrum.

**Mesh.** Camera-centred clipmap, 256 m base, 6 levels, snapped per level so vertices never swim,
seam-free between levels; a flat horizon ring from the clipmap edge to 95% of `camera.far`,
growable when the air map raises `far` (`ensureHorizon(far)`). Vertex displacement samples a
distance-appropriate mip. Low/Medium/High/Ultra segments 16/32/64/128.

**Surface.** Opaque result, alpha 1. Custom colours (`WaterColors`): pigment and foam are
emitted radiance, pre-scaled by the game at night. Fresnel reflection of the sky provider with
roughness from unresolved slope variance and a tiny grazing guard (1e-4, not 0.05: distant slopes
must keep distinct reflectance under 24× binoculars). Sun specular and glints, subsurface
light through crests toward the sun, crest foam (Jacobian, persistence, windward streaks, wind
stretch), low-opacity surface foam, shoreline foam where the water column is shallow (islands
and hulls), and wake foam. Straight-through visibility of submerged geometry: the opaque scene
at the same screen position, attenuated by `exp(-absorption × column)` and filled with the
pigment. No refraction offset. An optional sun shadow node attenuates the lit terms; ambient
pigment keeps 45% in full shadow; sky reflection is unshadowed. The underside, seen from a
submerged camera, shows Snell's window and total internal reflection.

**Reflections of ships.** Screen-space rays against the opaque depth, enabled on High and Ultra
when Graphics → Reflections is Scene. Clip each ray to the viewport before spending the step
budget; march in reciprocal depth; refine hits with 8 binary steps; full-float depth; fade by
confidence and screen edge. `maxDistance` is live: `WaterViewFocus` stretches it to twice the
range of a hull seen through binoculars.

**Fog.** `scene.fogNode` for every fogged material: ramp from `start` to `end` raised to `power`,
colour blending from `color` to the sky's fog sampler along the view ray over
`skyBlendDistance`. Sky backdrop materials set `fog = false`.

**Environment.** `scene.environment` is the sky provider's environment texture with intensity 1;
rebound when the provider rebuilds it.

**Wake.** `WakeFieldApi`: up to 16 generators, a 1,536 m field the game anchors on its focus
ship, friction, foam strength/threshold/lifetime, heights bounded to ±8 m, paused frames leave it
untouched, reset clears it. Tier resolutions: Low off, Medium 256², High 512², Ultra 1024².
The game adds its own trail and torpedo foam through `ocean.setWakeSampler`.

`wake/` solves ∂²h/∂t² + γ∂h/∂t = −g√(−∇²)(h + head) in fragment passes on float targets, one
path for WebGPU and WebGL2. A single truncated iWave kernel of radius P under-reads |k| for waves
longer than about P cells, so on a 1.5 m grid a ship's 150 m waves would turn slow and the Kelvin
wedge would change with the tier; `kernel.ts` instead fits radius-3 kernels on a binomial
reduce/collapse pyramid whose coarsest level is 32² on every tier, within 3% of deep-water |k| from
6 cells to 576 m. Each generator is a moving pressure patch: `depth` is its head in metres (the
depression it would settle into at rest), eased in over about a second and faded below 1 m/s;
`radius` shapes a Gaussian footprint along the path swept each step. The Kelvin wedge, bow and
stern systems come out of the dispersion; heights are a fraction of `depth` to about `depth`.
`friction` is γ in 1/s. The field steps at a fixed 1/30 s and the sampler blends the last two steps
(one step behind). Foam is set to 1.5 × `foamStrength` along the swept hull path, added where the
slope over a 12 m baseline passes `foamBreakThreshold`, spreads at 3 m²/s and decays with
`foamLifetime`. Scrolling moves content by whole cells; an edge sponge absorbs outgoing waves.
A step renders 2 × levels + 2 passes (8, 10, 12 by tier), about 0.2–0.4 ms on WebGPU.

**Underwater.** A submerged camera sees exponential absorption toward the pigment over the
distance to the first surface; the waterline across the near plane is handled per pixel.
Nothing runs for it when the camera is certainly above the waves (CPU bound).

**Floating objects.** Buoys ride the surface through a GPU height readback one frame late;
`WaveHeightSampler` serves presentation-only callers. Combat never reads GPU waves.

*Dropped:* refraction, underwater distortion, spray, rain, underwater particles, ocean floor and
caustics, the built-in sky, masking, multiplayer tick sync.

## Quality tiers

| Tier | Cascades (N) | Segments | Wake | Scene reflections |
| --- | --- | --- | --- | --- |
| Low | 1 × 256 | 16 | off | no |
| Medium | 2 × 256 | 32 | 256² | no |
| High | 3 × 256 | 64 | 512² | 16 steps |
| Ultra | 3 × 512 | 128 | 1024² | 32 steps |

## Validation

Unit tests (`bun test src/game/ocean`) cover the spectrum, bounds, seeds, quality tiers, geometry
coverage, the wake's dispersion pyramid (including aliasing on a real grid) and its generators.
`bun scripts/browser/ocean-wake.ts [--resolution 256|512|1024] [--webgl] [--measure]` runs
`/scripts/diagnostics/ocean-wake.html` headed: a Bismarck-sized hull sails, turns, stops, resets and
teleports, every check reads the public sampler back, and the captures, results and step cost land
in `.build/ocean-wake/`. `/scripts/diagnostics/ocean-review.html` renders fixed scenes of the real game
for side-by-side review; `.build/ocean-review/waterpro/` holds the Water Pro captures they are
compared with.
