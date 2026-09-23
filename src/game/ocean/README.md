# Ocean

The game's own ocean renderer, limited to what the game uses. It replaced a vendored
commercial ocean library, Water Pro, which stays in `vendor/threejs-water-pro` only so the two
can be compared in the real game: `src/game/comparison/WaterProOcean.ts` drives it behind
`OceanApi`, loaded on demand when the developer console's "Switch ocean renderer" (the
`oceanRenderer` graphics setting) selects it. Sky Pro stays vendored; the ocean consumes its
provider through `OceanSky` in `contracts.ts`. The game renders only through WebGPU
(`src/game/webgpu.ts`); there is no WebGL path.

## Clean-room rule

The license of the ocean library this folder replaced forbids decompiling, deobfuscating or
otherwise reverse engineering its compiled bundle, which is vendored for the comparison and
remains in the repository's history. Nobody opens, reads, greps, diffs or pattern-matches
`vendor/threejs-water-pro/build/index.js` in any revision, or Sky Pro's vendored `index.js`,
including through tools or subagents; the comparison adapter uses only the library's `.d.ts`
declarations and the game's former integration code. Build
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
| `waves/` | CPU spectrum (seeded, normalised to Hm0), GPU evolution + inverse FFT, foam persistence, height readback, the sea around hulls. |
| `surface/` | Clipmap mesh and horizon ring, the surface material and its shading. |
| `wake/` | Dispersive wake field, generators, wake foam. |
| `screen/` | Scene fog node, screen-space reflections, underwater post-process and waterline. |

## Frame

`Game.frame` calls `ocean.setHullSea(...)` and `ocean.update(dt)` once, after ship poses, wake generators
and lighting are current, then renders. `update`:

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
Integer-safe seeded randomness (no float hash inputs). Periodic cascades, largest tile 1,024 m
(more in a realistic storm), bands split so no wavelength is counted twice. Time folds modulo a
period with every ω quantised
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

**Realistic sea state** (`waves/seaState.ts`; `realism.seaState`, on by default). The calibration
table's heights are realistic but its peak wavelengths are an art direction's: Hs/λp runs from 1/18
at 9 m/s to 1/7 at 25 m/s, the breaking limit, where real wind seas run 1/33 to 1/41. With the
switch on the field draws the table's significant height on the sea a real wind raises to that
height. Eliminating the fetch between JONSWAP's growth laws (Hasselmann et al. 1973: g²m0/U⁴ =
1.6·10⁻⁷χ, fp·U/g = 3.5·χ^−0.33) gives the peak wavelength from Hs and U, a 3/2 law: 70 m at 9 m/s
(Pierson–Moskowitz's developed sea), 146 m at 15, 298 m at 25. Donelan, Hamilton & Hui's (1985)
measured wind-sea spectrum at that wave age replaces JONSWAP: Toba's ω⁻⁴ equilibrium range above the
peak, γ = 1.7 + 6·log10(U/cp) and a peak width from U/cp, held to the same saturation range (they
meet 4–6 ωp above the peak). Its drawn slopes are 79% of Cox–Munk's total at 9 m/s and a third in a
storm; the tail keeps the rest. Choppiness is 1/(π·0.1412) ≈ 2.25, at which a trochoid cusps exactly
at Stokes' limiting steepness: crests sharpen (J < 0.5 on a tenth of the surface on High) and fold
only where the linear sea passes breaking (0.03–0.08%). Tiles grow by one factor until the largest
holds 8 peak wavelengths (never shrunk, at most 4×: the tier's layout up to 12 m/s, 2,381 / 421 / 72
m on High at 25 m/s), so every band keeps its place on its lattice, and the longest waves no longer
repeat 3–4 times a tile from the air. Tile sizes are uniforms, so a new layout adds no work per
frame. The field reads the switch live and rebuilds when it flips, paused or not; `WaveField.sea` is
the sea as drawn (spectral reads such as the peak belong there, not on `params`). Off draws `params`
on the tier's tiles, pixel for pixel as before. Combat, hull motion and `session/sea.ts` read the
table either way.

**Sea around hulls** (`waves/hullSea.ts`). Combat poses every hull on its own sea, two long-crested sines
(`session/sea.ts`, the Rust `SeaState`); the field draws an unrelated spectrum of the same height, so a hull could
ride a combat crest over a drawn trough, a whole hull at once in the realistic sea's 300 m storm swells.
`setHullSea(waves, time, hulls)` blends the drawn long waves into the combat sea near the nearest 16 hulls, at the
simulation's clock (the drawn poses' own time; the berth's in port), never the field's: height = field + α·long +
β·combat, `long` the first cascade low-passed by its mip chain, α = n(1 − w) − 1 and β = n·w with n = 1/√((1 − w)² +
w²), which keeps the variance of seas of equal height across the fade. w is 1 within max(0.3 L, 0.75 B, λ/4) of a
hull's centre line and fades out over max(L, λ) more (λ the longest combat wave): the crest and trough beside the hull
are the ones it rides, and over a wavelength the blend tilts the sea no more than the waves do. Hulls join as
1 − Π(1 − wᵢ), smooth where reaches overlap; contact scales a hull (a submarine or wreck below every trough takes
none). `displacement` evaluates the combat sea where the vertex lands and removes the long waves' horizontal motion
with their heights; `surface` scales their slopes and strain before finer foam follows the first cascade's crests,
then adds the combat slopes (filtered as the mip chain would, exp(−(k·footprint)²/8)) and the blend's gradient across
both seas; `heightAt` (buoys, the waterline, the torpedo overlay) follows. Shorter waves, grid-bound crest foam, wake
and bow waves ride on top. A box low-pass falls from 0.9 to 0.1 over a factor of five in wavelength, so no mip level
splits cleanly: at each rebuild and combat wavelength the field weighs the long-wave variance (λ ≥ λc/2) a level
leaves beside a hull, twice, against the shorter variance it takes, over the cascade's spectrum binned to 64² cells.
The realistic storm splits at a 31–39 m box and loses its long peak whole. Only the realistic sea couples: with
`realism.seaState` off the art-directed sea is drawn exactly as before, since its short steep waves rule the water
beside a hull and combat's swell leaves that gap unchanged (3.9 m rms in a live 30 m/s battle, where the realistic
sea's falls from 2.5–3.5 m to 1.4–2.0 m). The hull wet band reads `heightAt` and the contact foam the water's drawn
position, so both follow. Per vertex it costs a 16-hull loop, one texture read and two sines; per pixel the loop with
its gradient, three reads and two sines; `heightAt` (the wet band's per hull fragment) the loop, three reads and two
sines. Combat eases heave over 1.5 s and
averages it over the waterplane, so a storm still leaves a waterline 1.5–2 m rms from the water beside it: the
authority's own motion, drawn as it is.

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

Tiles are 1,024 / 181 / 31 m (Low takes the first, Medium two). A realistic sea whose peak passes
128 m grows all of them by one factor (above).

## Validation

Unit tests (`bun test src/game/ocean`) cover the spectrum, bounds, seeds, quality tiers, geometry
coverage, the wake's dispersion pyramid (including aliasing on a real grid) and its generators.
`bun scripts/browser/ocean-waves.ts` runs `/scripts/diagnostics/ocean-waves.html` headed: it checks
the wave field alone on WebGPU (GPU transform against a CPU inverse DFT, Hm0, mipmaps, `heightAt`,
foam persistence and coverage, update timings per tier) and writes to `.build/ocean-waves/`;
`--sea-state off` checks the table's sea as given. Cascades holding under a millionth of the variance
(a light air's 1 km tile) are reported but not judged: their amplitudes are below half-float
resolution.
`bun scripts/browser/ocean-wake.ts [--resolution 256|512|1024] [--measure]` runs
`/scripts/diagnostics/ocean-wake.html` headed: a Bismarck-sized hull sails, turns, stops, resets and
teleports, every check reads the public sampler back, and the captures, results and step cost land
in `.build/ocean-wake/`. `/scripts/diagnostics/ocean-review.html` renders fixed scenes of the real game
for side-by-side review (`bun scripts/browser/ocean-review.ts --tag <name>` saves them to
`.build/ocean-review/<name>/`; `--param wind=<m/s>` sets the wind of scenes without their own,
`--param realism=off` the replaced library's look, `--param hullsea=off` the sea without the hull coupling); keep a
baseline tag to compare a change against. Its placed hulls ride the combat sea as the authority poses them, on a fixed
battle seed; `oceanReview.hullSeaProbe()` flattens the drawn waves and reads heights back around the player's hull,
which must equal combat's `seaHeight` within the full reach (0.1 mm on High at 30 m/s) and 0 past the fade.
