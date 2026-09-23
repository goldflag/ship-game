# Ocean

The game's own ocean renderer, limited to what the game uses. It replaced a vendored
commercial ocean library, which is no longer in the tree. Sky Pro stays vendored; the ocean
consumes its provider through `OceanSky` in `contracts.ts`. The game renders only through
WebGPU (`src/game/webgpu.ts`); there is no WebGL path.

## Clean-room rule

The license of the ocean library this folder replaced forbids decompiling, deobfuscating or
otherwise reverse engineering its compiled bundle, and that bundle remains in the repository's
history. Nobody working on this folder opens, reads, greps, diffs or pattern-matches it in any
past revision, or Sky Pro's vendored `index.js`, including through tools or subagents. Build
from the game's own code, this document, three.js (`node_modules/three`),
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

Everything below is what the game uses. Items marked *dropped* were disabled or unused in the
replaced library and were not rebuilt.

**Waves.** JONSWAP spectrum with peak wavelength, wind speed, γ, wind direction and directional
spreading; significant height is exact (normalise the realised spectrum so 4σ equals
`significantHeight`, time-averaged, over the tier's cascades). Choppy horizontal displacement.
Integer-safe seeded randomness (no float hash inputs). Periodic cascades, largest tile 1,024 m,
bands split so no wavelength is counted twice. Time folds modulo a period with every ω quantised
to it, so float32 time stays precise. CPU bounds on height and horizontal displacement replace
the old GPU readback of the spectrum. Short waves are held to a saturation range (α·g²·ω⁻⁵) above
the peak: the game's calibrated seas are far steeper than developed ones, and a JONSWAP normalised
to their height would roughen every ripple. α = 0.02, a young sea's, is where the drawn slopes meet
Cox–Munk's measured total from 9 to 18 m/s (Phillips' developed 0.0081 left two thirds of it).
Crest foam persists per cascade in tile space; only cascades near the spectral peak inject it. Mip
chains stop at 16×16 texels, and `surface()` fades a cascade whose waves are finer than that under
the pixel into `slopeVariance`. Close to the camera `surface()` also draws the band below the finest
cascade as ripples: its slopes read as many times finer as its band spans (16 on High, 32 on Ultra;
the saturation range is self-similar in slope), shown where the pixel resolves them, with the
variance they draw taken out of the tail's roughness. Low's single cascade holds the peak and draws
none. A quarter of the tail (Cox–Munk's total less the drawn slopes) roughens the sky reflection:
in full it hazed a light air's mirrored clouds.

**Mesh.** Camera-centred clipmap, 256 m base, 6 levels, snapped per level so vertices never swim,
seam-free between levels; a flat horizon ring from the clipmap edge to 95% of `camera.far`,
growable when the air map raises `far` (`ensureHorizon(far)`). Vertex displacement samples a
distance-appropriate mip. Low/Medium/High/Ultra segments 16/32/64/128.

**Surface.** Opaque result, alpha 1. Custom colours (`WaterColors`): pigment and foam are
emitted radiance, pre-scaled by the game at night. Fresnel reflection of the sky provider with
roughness from unresolved slope variance and a tiny grazing guard (1e-4, not 0.05: distant slopes
must keep distinct reflectance under 24× binoculars). Sun glints on the resolved facets (a lobe of
slope variance 1e-3, weighted by the share of the slopes the pixel resolves: glitter close up, no
bleached sheen far off), subsurface
light through crests toward the sun, crest foam (Jacobian, persistence, windward streaks, wind
stretch), wind streaks of surface foam, shoreline foam where the water column is shallow (islands
and hulls), and wake foam. Every foam reads one generated texture whose channels are equalised
(lace, patches, streaks), so thresholding a channel at 1 − coverage covers exactly that share:
thinning foam keeps fewer filaments instead of turning grey, and where filtering has flattened
the pattern the pixel takes the coverage itself. Foam facing away from the sun keeps 60% of its
light, so whitecaps take the shape of their wave. Straight-through visibility of submerged
geometry: the opaque scene at the same screen position, attenuated by `exp(-absorption × column)`
and filled with the pigment. No refraction offset. An optional sun shadow node attenuates the lit
terms; ambient pigment keeps 45% in full shadow; sky reflection is unshadowed. The underside, seen
from a submerged camera (and only computed for back faces), shows Snell's window and, outside it,
total internal reflection of the lit sea: dark looking down into the deep, bright toward the
horizontal where daylight (the sky's mean radiance, tinted by what the water absorbs least)
scatters along the surface, dimmed by the water above the camera.

**Reflections of ships.** Screen-space rays against the opaque depth, enabled on High and Ultra
when Graphics → Reflections is Scene. Clip each ray to the viewport before spending the step
budget; march in reciprocal depth; refine hits with 8 binary steps; full-float depth; fade by
confidence and screen edge. Rays leave a normal keeping 30% of the wave slope: one ray per pixel
off the full slope breaks a hull's image into speckle. `maxDistance` is live: `WaterViewFocus`
stretches it to twice the range of a hull seen through binoculars.

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
path on WebGPU. A single truncated iWave kernel of radius P under-reads |k| for waves
longer than about P cells, so on a 1.5 m grid a ship's 150 m waves would turn slow and the Kelvin
wedge would change with the tier; `kernel.ts` instead fits radius-3 kernels on a binomial
reduce/collapse pyramid whose coarsest level is 32² on every tier, within 3% of deep-water |k| from
6 cells to 576 m. Each generator is a moving pressure patch: `depth` is its head in metres (the
depression it would settle into at rest), eased in over about a second and faded below 1 m/s;
`radius` shapes a Gaussian footprint along the path swept each step. The Kelvin wedge, bow and
stern systems come out of the dispersion; heights are a fraction of `depth` to about `depth`.
`friction` is γ in 1/s. The field steps at a fixed 1/30 s and the sampler blends the last two steps
(one step behind). Foam is set to 0.3 × `foamStrength` along the swept hull path, added where the
slope over a 12 m baseline passes `foamBreakThreshold`, spreads at 3 m²/s and decays with
`foamLifetime`. Scrolling moves content by whole cells; an edge sponge absorbs outgoing waves.
A step renders 2 × levels + 2 passes (8, 10, 12 by tier), about 0.2–0.4 ms on WebGPU.

**Realistic wake** (`realism.wake`, on by default). The game's sampler adds `bubbles` and `slick`
(`contracts.ts`); a sampler with a slick is the realistic wake. The surface then shades its foam as
dense churned water (opacity 0.97 and a soft lace edge: the sampler tears the edge itself), lights the
water body under it from bubble clouds (a diffuse layer of albedo 0.4 relative to foam seen through
2 m of water down and back up, `transmittance(absorptionColor, 2)`: the turquoise under a wake), and
reads the waves with `waves.surface(xz, slick)`. Every cascade then loses `calm` × its share of slope
in waves shorter than 25 m (`slickShares`: the saturation range holds equal slope per octave), and the
close-range ripples and unresolved tail lose `calm` of theirs, so reflections sharpen and the glitter
changes where the short waves are stilled, while the swell runs through. Low's single tile keeps its
long waves and loses about a quarter of its slope. Without a slick every read is the original graph.
The game side (atlas channels, stamps, sampling cost) is in the configuration guide's "Ship wake".

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
coverage, the wake's dispersion pyramid (including aliasing on a real grid), its generators and the
share of each cascade a slick stills.
`bun scripts/browser/ocean-waves.ts` runs `/scripts/diagnostics/ocean-waves.html` headed: it checks
the wave field alone on WebGPU (GPU transform against a CPU inverse DFT, Hm0, mipmaps, `heightAt`,
foam persistence and coverage, update timings per tier) and writes to `.build/ocean-waves/`.
`bun scripts/browser/ocean-wake.ts [--resolution 256|512|1024] [--measure]` runs
`/scripts/diagnostics/ocean-wake.html` headed: a Bismarck-sized hull sails, turns, stops, resets and
teleports, every check reads the public sampler back, and the captures, results and step cost land
in `.build/ocean-wake/`. `/scripts/diagnostics/ocean-review.html` renders fixed scenes of the real game
for side-by-side review (`bun scripts/browser/ocean-review.ts --tag <name>` saves them to
`.build/ocean-review/<name>/`); keep a baseline tag to compare a change against.
