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

The surface's fragment shader also reads every wake sampler's inputs: trail foam, bow waves, hull contact
foam and the sea around hulls. WebGPU binds at most 12 uniform buffers per shader stage by default, and
three gives each uniform array its own buffer. Past that, pipeline creation fails and the sea stops
drawing. A system the surface reads therefore packs its arrays into one buffer with `PackedVec4Arrays`
(`src/game/packedUniforms.ts`).

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
Mip chains stop at 16×16 texels, and `surface()` fades a cascade whose waves are finer than that under
the pixel into `slopeVariance`. Close to the camera `surface()` also draws the band below the finest
cascade as ripples: its slopes read as many times finer as its band spans (16 on High, 32 on Ultra;
the saturation range is self-similar in slope), shown where the pixel resolves them, with the
variance they draw taken out of the tail's roughness. Low's single cascade holds the peak and draws
none. A quarter of the tail (Cox–Munk's total less the drawn slopes) roughens the sky reflection:
in full it hazed a light air's mirrored clouds. `unresolvedVariance` carries all of it for the physical
reflections, which blur it along the plane of incidence instead (see *Physical shading*).

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

**Whitecaps** (`waves/whitecaps.ts`, the resolve pass in `waves/field.ts`). A crest breaks where it
is both compressed along the wind (the choppy displacement's −ŵ·∇(D·ŵ)) and steep on its forward
face (the slope falling away downwind). Both fields are linear in the wave amplitudes and a quarter
period apart for every travelling mode, so over a tile they are uncorrelated Gaussians whose
variances the CPU spectrum gives exactly (a unit test checks the blend's tile variance is 1 against
the inverse DFT); weighted by cos⁴θ and cos²θ of each wave's angle to the wind, they favour the
wind-driven waves whose crests run across it, so breaking zones stretch along the crests. Blended
0.9 rad onto the face and normalised, they make a standard-normal breaking indicator per cascade.
The wind sets the share of the sea whitecaps and windrows cover (Monahan & O'Muircheartaigh,
3.84·10⁻⁶·U^3.41, none below 3.5 m/s, scaled by the map); the whitecaps' part, what must add to the
windrows' coverage as the two overlap at random, becomes an optical depth −ln(1 − W) (patches land at
random and overlap). Each cascade takes the share of it its breaking waves carry (slope variance
within 1/32 to 2 of the sea's mean wavelength, none shorter than 3 m); its threshold is the normal
quantile of that share over a measured persistence (19.5 area per unit breaking: the patches grow as
they age; a finer cascade shows 0.62 of its foam through its gate; dense seas saturate as
D/(1 + 0.5·D)); a cascade asked to break over more than half its sea hands the rest to the others by
share. Injection ramps from 0 to 1 over ±1.5/z of the indicator around the threshold z, so breakers
reach full strength alike at every wind, and foam decays with e-folding time one period of the waves
that broke (about 2.6 s at 9 m/s, 5 s for a storm's big breakers: stage-B foam takes a few to ten
seconds to clear). As it ages it spreads: an explicit diffusion step in the same pass, 0.05·λ·c for the
breaking waves (at most 3 m²/s) along the wind and half that across, so a breaker's patch grows from
its crest into a larger, fainter one drawn out downwind. Because thresholds follow the spectrum's
own statistics, coverage holds whatever the wavelengths, heights or choppiness: on High the area
whitecaps and windrows cover (a pixel counts where its foam passes the faint rim, as a photograph's
brightness threshold would) is 0.14/0.63/1.6/4.0/7.9/14/24/45% of the sea at 6/9/12/15/18/21/25/30 m/s on the table's
sea and 0.11/0.59/1.5/4.2/7.9/12/22/41% on the realistic one, against Monahan's 0.17/0.69/1.8/3.9/7.3/12/22/42%
(`ocean-waves.html`'s `foamCoverage`, a square kilometre at twelve instants, through the surface's own
foam functions; a light air's few whitecaps vary by a fifth or more between runs). The extras texture's fourth channel persists
the bubble cloud the same way for half the foam's lifetime: it is also the foam that broke in the
last few seconds (`fresh`), a whitecap's core. `surface()` returns foam and fresh foam per area of sea
(divided by the surface's compression J, held to 0.35–2.5, so foam gathers on converging crests),
their mean over an ellipse 8 m along the crests and 2.5 m across or the pixel's footprint (`foamMean`,
`bubbles`: one anisotropic read), and the wind's whitecap share (`whitecapShare`). A finer cascade's
foam shows where the coarser cascades' compression, in its own standard deviations, passes −1 (full
from 0.75): short waves break on the crests of long ones, and the long tiles hide a finer tile's
repeats. Paused frames leave both channels untouched.

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

**Surface.** Opaque result, alpha 1. This paragraph is the look first tuned to the replaced library,
which `realism.reflections` and `realism.waterColor` replace (see *Physical shading*); foam, crest
light and the underside are shared. Custom colours (`WaterColors`): the pigment is emitted
radiance, pre-scaled by the game at night; foam is lit (below). Fresnel reflection of the sky provider with
roughness from unresolved slope variance and a tiny grazing guard (1e-4, not 0.05: distant slopes
must keep distinct reflectance under 24× binoculars). Sun glints on the resolved facets (a lobe of
slope variance 1e-3, weighted by the share of the slopes the pixel resolves: glitter close up, no
bleached sheen far off), subsurface
light through crests toward the sun, whitecaps, windrows, shoreline foam where the water column is
shallow (coasts and hulls), and wake foam. Foam shading lives in `surface/foam.ts`. Every foam reads
one generated texture (`surface/foamTexture.ts`): lace (warped Worley filaments around holes),
patches (fbm) and churn (heaped billows, Worley domes at three scales) are equalised, and every mip
level down to 16×16 is averaged from the raw fields and equalised again, so thresholding a channel at
1 − coverage keeps exactly that share at any distance (smaller levels only average: equalised, they
drew the tile as a grid); the texture is sampled with 8× anisotropy, and a pattern gives way to its
mean over 4–24 texels across a pixel's narrow side. A whitecap is one substance through its life
(Monahan's stage A and B): where fresh foam (`fresh`, swayed ±40% by the patches and ±45% by the
billows, so outlines fray down to the billows instead of drawing the field's texels) passes 0.85–1.3,
a small core of dense white water on the breaking crest; around and behind it a larger patch of old
foam (from 0.01 to full at 0.3), lace covering 25–62% of it at 12–60% opacity, dimmer where its
filaments thin and drawn out along the wind as it fades. Dense white water, whitecap cores and the
realistic wake's churned water alike, is 97% opaque on its billows and opens to 8% in the gaps
between them, where the bubble-lit water shows turquoise, and its billows darken to 82% in their
creases and brighten on their sunward side (the churn channel a step toward the sun). Where a pixel
is too coarse for a whitecap (1.5–4 m footprint) the same model is drawn on the spread foam with the
lace and churn at four times their scale (the windrows' layout): its core covers the drawn core's own
mean share (the 0.85–1.3 threshold averaged over the sway), and a thin patch's cover is raised 2.2×
for what spreading takes from whitecaps smaller than the spread, a full patch's not at all, so a big
breaker seen from the air is a marbled, streaked patch as bright as its drawn mean instead of a white
disc. Further off (8–20 m) the pixel takes the wind's whitecap share at 0.26 opacity, a quarter of
the light as Koepke measured of real whitecaps: distant whitecaps soften into the sea instead of
staying flecks, and a mean already holds their aerated water, so no bubble cloud is added there.

Grazing views and binoculars need two more corrections, because a pixel there can be a tenth of a metre wide and
tens of metres deep. First, pattern blur counts the area the sampler averages, not only its resolved texel. The
sampler averages the lace along the pixel's length, and a threshold on that flattened pattern draws hard lines
across the view. Second, a drawn whitecap is thresholded on its amounts undiluted by the pixel's length (3 m of
whitecap depth) and scaled by the share it covers. A whitecap lying flat on the water that would still draw a line
over 20–60 pixels long and under a row tall goes to the wind's mean too; a real breaking face stands up as a short
fleck, which flat foam cannot draw. The bubble cloud
brightens the water body toward daylight scattered back by bubbles (30%) and tinted by 4.5 m of water
(pale turquoise, up to 60% of the way; a whitecap's to 45% of a hull's propeller wash), and scatters
half the reflection away. Windrows, old foam in lines along the wind, take a growing share of the
wind's coverage from 13 m/s (Beaufort 7, "foam begins to be blown in streaks"; 9 "dense streaks") to a
quarter of it by 25 m/s, at most 4% of the sea, at 0.5 opacity: soft bands about 1–5 m wide and 12–32 m
apart that meander, wiggle over 20 m of their length, swell and break 41 times a tile, gathered in
stretches built from the patches at two scales an irrational ratio apart (which also shift the bands
across the wind: no lattice from the air), beaded by the lace into strings of patches, and thickened
where the surface converges (0.3–2.2×), so they ride the waves. All foam is a diffuse scatterer
(albedo 0.8): the sky's radiance about its normal plus 0.55 of the sun's irradiance over π (the share
the game's lit meshes take under AgX), wrapped 0.5 past the terminator and cut by the sun's shadow,
so it follows the sky and the moon at night without a tint. Its wet top keeps half the water's Fresnel
reflection, and it is never darker than the water it covers without glints. Straight-through visibility of submerged
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
stretches it to twice the range of a hull seen through binoculars. With physical reflections the
ray follows the whole resolved slope instead, and the image is filtered rather than the surface
flattened (see *Physical shading*).

**Physical shading.** Two of `ocean.realism`'s switches change the surface's shading; each is live
(flipping it rebuilds the surface graph, so the look tuned to the replaced library is exactly the
graph with it off). Both are on by default.

*`realism.reflections`* (`surface/physicalReflection.ts`, after Bruneton, Neyret & Holzschuch 2010).
The pixel's normal is the mean of the waves it resolves; the facets it does not resolve form a
Gaussian slope distribution around it: `unresolvedVariance` (the filtered and faded cascades plus
all of Cox–Munk's tail) plus the slope change across the pixel's own footprint (screen-space
derivatives × 0.25, Kaplanyan et al. 2016, at most 0.1), split along and across the wind in Cox &
Munk's measured proportions (3.16e-3·U : 0.003 + 1.92e-3·U).
- A viewer sees each facet by its projected area, which favours facets turned toward them (Smith;
  Heitz's visible normals), and each mirrors by its Fresnel reflectance, which falls steeply as a
  facet turns toward the viewer. Taking F ≈ e^{−k·cos θ} near the view (k is Schlick's own falloff,
  about 5 at grazing and 0 looking down) multiplies the Gaussian by an exponential, which only moves
  its mean by −kσ²; the visible facets of that shifted distribution give the lobe's centre and its
  spread in closed form (within 2° of the numerical average up to σ = 0.18). A 9 m/s sea seen at a
  grazing angle mirrors sky about 18° up, not the horizon, so the far sea is darker than the sky
  over it and the horizon is crisp, as on a clear day at sea.
- The rays spread by twice the facets' in-plane spread but across the plane of incidence only by
  twice the cross slope times the cosine of incidence: grazing reflections smear toward the viewer
  and stay sharp sideways. The PMREM filters isotropically, so an elongated lobe takes three taps
  along the plane of incidence (weights ½, ¼, ¼), each blurred by the short axis but at least half
  the long one. Lookup roughness comes from a measured table: a thin line filtered through the
  game's 384 px sky bake spreads to angular deviations of 1.1° at roughness 0.1, 4.7° at 0.2, 10° at
  0.4, 20° at 0.6 and 33° at 0.8 (three's PMREM is a chain of GGX-sampled passes whose roughness
  names no lobe). Rays below the horizon read the horizon (the sky bake holds its colour below it).
- The reflectance is Bruneton et al.'s mean Fresnel over the visible facets,
  F0 + (1 − F0)(1 − cos θ)^{5e^{−2.69σ}}/(1 + 22.7σ^{1.5}) with σ the RMS slope along the view (0.37
  at the horizon at 9 m/s, where a mirror would reflect nearly all), and the water body takes the rest.
- The sun (or moon) is reflected by the same anisotropic distribution plus its 1.4° disc's own
  spread (9.4e-6 per axis) as a Beckmann glitter BRDF with Smith masking: single resolved facets
  sparkle close up, farther pixels average them into a glitter path that widens with the wind and
  toward the horizon, and from the air the glint is a broad patch. Above a quarter of the sun's
  irradiance, about twice sunlit foam, the glitter is compressed with a soft knee (radiance /
  (1 + luminance / knee)). In full, a low sun over a rough sea spreads a glow several times brighter than the
  sky, which blooms over any ship in front of it.
- Screen-space rays follow the whole resolved slope, one in-plane deviation below the lobe's centre
  (hulls stand above the water that mirrors them, so the lobe's lower part meets a hull its raised
  centre would miss); four taps read the image over the whole lobe along its projected smear
  (±0.5 and ±1.5 deviations, at most 4% of the viewport per deviation). Light air still breaks a
  hull's image into a faint vertical smear: Cox–Munk's 0.018 mean square slope at 3 m/s spreads the
  rays ±6–9°.

*`realism.waterColor`* (`surface/waterBody.ts`). The body is light scattered back out of the water:
subsurface remote-sensing reflectance r_rs = (0.089 + 0.125u)u, u = b_b/(a + b_b) (Lee et al. 2002,
with their 1/(1 − 1.7 r_rs) for light the surface returns), times the downwelling irradiance under
the surface: the sun's on the horizontal less its Fresnel reflection, where the shadow lets it, plus
the sky's (π × the PMREM's roughest level, less 6.6% hemispherical Fresnel), crossing back into air
÷ n². Absorption a is the map's `absorptionColor`; backscattering b_b is one open-ocean default,
(0.00323, 0.00395, 0.00565)/m at about 620/550/460 nm: sea water's own (half of Morel's 1974
scattering) plus particles at 0.003/m at 550 nm on a λ⁻¹ slope, Jerlov's oceanic type II–III, whose
chlorophyll (about 1 mg/m³) goes with the maps' absorption. Noon, dusk, night, overcast and ship
shadows follow the light with no night scaling; `waterColor` and the 45% shadow share are unused.
Submerged hulls, terrain and shallows use the same optics: the scene behind a column s of water is
dimmed by exp(−(a + b_b)·s·(1 + |view.y|/0.85)) (the image's path plus daylight reaching its depth
with μ_d = 0.85), receives 97% of the day's light through the surface, fills in with the deep
water's upwelling in proportion to what the column takes away, and crosses into air ÷ n². The
underside and the underwater view keep the pigment. The North Atlantic's water comes out about a
third as bright as the pigment and bluer (r_rs ≈ 0.001, 0.0034, 0.0054/sr); the Pacific's clearer
blue much bluer.

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

Tiles are 1,024 / 181 / 31 m (Low takes the first, Medium two). A realistic sea whose peak passes
128 m grows all of them by one factor (above).

## Validation

Unit tests (`bun test src/game/ocean`) cover the spectrum, bounds, seeds, quality tiers, geometry
coverage, the wake's dispersion pyramid (including aliasing on a real grid), its generators and the
share of each cascade a slick stills.
`bun scripts/browser/ocean-waves.ts` runs `/scripts/diagnostics/ocean-waves.html` headed: it checks
the wave field alone on WebGPU (GPU transform against a CPU inverse DFT, Hm0, mipmaps, `heightAt`,
foam persistence and whitecap coverage by wind through the surface's own foam functions, update
timings per tier) and writes to `.build/ocean-waves/`;
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
