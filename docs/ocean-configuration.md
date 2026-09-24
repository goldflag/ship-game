# Ocean configuration

The sea is the game's own WebGPU ocean in `src/game/ocean`. Its design, parts, quality tiers and
validation are in [its README](../src/game/ocean/README.md); this page records the configuration the
game gives it. The sky is the game's own too (`src/game/sky`, [its README](../src/game/sky/README.md)): it
supplies the atmosphere, clouds, the celestial light the sea and ships share, and the environment the
water reflects. The Sky Pro library it replaced remains as a comparison ([below](#comparing-with-sky-pro)).

`Game.initialize` creates the ocean for the Graphics → Ocean tier (Low, Medium, High or Ultra; it
applies when the port next loads) with wave seed 1941 (any integer is safe). From then on
`VisualEnvironment` (`src/game/VisualEnvironment.ts`) writes each scene's sea, colours, foam, fog and
light into the facade's live parameter objects (`ocean.waves`, `ocean.colors`, `ocean.foam`,
`ocean.fog`, `ocean.sun`), and the next frame renders them. The values are artistic gameplay choices
unless a section says otherwise.

The game renders only through WebGPU. `src/game/webgpu.ts` asks `navigator.gpu` for an adapter before
the renderer initialises and refuses a renderer that three dropped to WebGL2, so a browser without
WebGPU gets the start-up error screen instead of a black canvas.

## Calibrated wind sea

Battle wind resolves through the versioned `seaCalibration` table in
`assets/maps/battle-conditions.v1.json`. Numeric wind and legacy weather presets
share that table. Its representative open-sea significant heights follow the
[NWS Beaufort guide](https://www.weather.gov/pqr/beaufort), with continuous
interpolation between these targets:

| Wind (m/s) | 6 | 9 | 12 | 15 | 18 | 21 | 25 | 30 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Significant height (m) | 0.9 | 1.8 | 2.7 | 4.0 | 5.5 | 7.0 | 8.8 | 11.3 |

Zero wind is flat. Lower-speed anchors retain small waves and ease into whitecaps.
These are representative conditions, not a wave forecast: the model has no fetch,
wind-duration history, water-depth-dependent spectrum or independent incoming
swell. The table's peak wavelengths and wave periods remain visual/gameplay choices; the rendered
sea replaces them with a real wind sea's unless the realism switch is off (see
[Realistic sea state](#realistic-sea-state)).

`src/maps/seaCalibration.ts` turns wind into significant height and peak wavelength in metres,
choppiness (0.65, rising to 1.55 between 3 and 15 m/s) and the crest and windward foam gains (which only
the Water Pro comparison still reads).
`VisualEnvironment` writes them to `ocean.waves` with JONSWAP γ 2.6; `Game` keeps directional
sharpness at 0.8, whose broader spread breaks parallel ripples into small crossing waves. The ocean
normalises its spectrum so that 4 × the standard deviation of the rendered surface equals
`significantHeight` (Hm0, the [NOAA spectral-height definition](https://www.ndbc.noaa.gov/faq/wavecalc.shtml)),
so no renderer-specific gain is fitted and the table needs no recalibration when the spectrum or its
cascades change. `window.reviewWaves()` on `/scripts/diagnostics/helm-optics.html` reads GPU heights
back around the hull at four wave times and reports 4 × RMS beside the requested height.

Wind speed sets the share of the sea whitecaps cover, from Monahan & O'Muircheartaigh's measured
whitecap fraction 3.84·10⁻⁶·U^3.41: none below 3.5 m/s, 0.17% at 6 m/s (scattered white horses), 0.7%
at 9, 1.8% at 12, 3.9% at 15, 7.3% at 18, 22% at 25 and 42% at 30, scaled by the map's foam value /
0.45 (1 in the Atlantic, 0.56 Pacific, 0.67 Arctic, 1.1 Indian). The ocean places whitecaps where its
own spectrum's crests break to give that share of area (see the ocean README), so the coverage holds on
the table's sea and on the realistic one alike: measured on High it is within about a tenth of the
curve from 15 to 30 m/s and a fifth from 9 to 12 m/s on either (a light air's few whitecaps are noisy:
0.11–0.14% at 6 m/s). A whitecap is a small dense core
on its breaking crest and a larger patch of lacy old foam it leaves; averaged over their area they
reflect about a quarter of the light, so the share of the sea they whiten is well below their area.
Foam lives one period of the waves that broke (`lifetime`), spreading as it ages, with a 0.5 wind
stretch and opacity 1. From 13 m/s part of that coverage lies in windrows, old foam gathered into
broken lines along the wind (Beaufort 7, "foam begins to be blown in streaks", to 9, "dense
streaks"): a quarter of it by 25 m/s and at most 4% of the sea (0.07% at 15 m/s, 0.7% at 18, 2.4% at
21), at 0.5 opacity (`foam.surface`, whose `coverage` is the windrows' share of the sea).

Map multipliers are height 1.0 Atlantic, 0.65 Pacific, 0.6 Arctic and 1.05 Indian; wavelength 1.0,
0.8, 0.8 and 1.1; and the preset wind multiplier 1.0, 0.7, 0.65 and 1.1. Numeric wind bypasses the map
wind multiplier; legacy presets first resolve that wind multiplier, then enter the same calibration
curve. Cloud cover remains independent of wave energy. Port resolves its standing 9 m/s wind (toward
35°) through the same curve on the berth's map (1.8 m significant height, 32 m peak wavelength), so
the developer console's reading is the sea on screen; only its daylight, clouds and fog stay
port-specific. The hull on show rides that sea through `BerthMotion`, a presentation-only copy of the
authority's sea response; the port session is still never stepped.

CPU combat receives the same significant height through `src/game/session/sea.ts`
and `crates/naval-sim/src/environment.rs`, using the shared content manifest; the
simulation reads only `significantHeightM` and `peakWavelengthM` from the table.
Its two sine components have weights 0.7/0.3, so their envelope amplitude is
`Hs / (4 × sqrt((0.7² + 0.3²) / 2))`. The CPU retains its coarse four-times-peak-wavelength
envelope and seeded phase; GPU waves never supply combat poses, collision or flooding samples.
The two surfaces share height statistics, not exact phases or a hydrodynamic model; around the hulls
the drawn sea takes combat's own (see [The sea around hulls](#the-sea-around-hulls)).

### Realistic sea state

The table's wavelengths are an art direction's: 32 m at 9 m/s and 62 m at 25 m/s make the sea
Hs/λp = 1/18 to 1/7 steep, the last at the breaking limit, where real wind seas run 1/33 to 1/41.
With `ocean.realism.seaState` on (the default; the developer console's *Toggle realistic sea state*
flips it live, paused or not) the ocean draws the table's significant height, wind and direction on
the sea a real wind raises to that height (`src/game/ocean/waves/seaState.ts`):

- **Peak wavelength.** JONSWAP's fetch-limited growth laws (Hasselmann et al. 1973) give the total
  variance, g²m0/U⁴ = 1.6·10⁻⁷χ, and the peak frequency, fp·U/g = 3.5·χ^−0.33, at a dimensionless
  fetch χ = gX/U². Eliminating χ gives Hs ∝ Tp^(3/2) at a given wind (the form of Toba's 3/2 law), so
  Hs and U fix the peak. The table's seas up to 9 m/s are fully developed: at 9 m/s it gives 70 m,
  Pierson–Moskowitz's 71 m for that height. Above 9 m/s the table's heights are those of younger,
  fetch-limited seas, a little steeper.
- **Spectrum.** Donelan, Hamilton & Hui's (1985) measured wind-sea spectrum at the resulting wave age
  U/cp: Toba's ω⁻⁴ equilibrium range above the peak (JONSWAP's ω⁻⁵ tail left a storm's 10–80 m wind
  waves as smooth swell), γ = 1.7 + 6·log10(U/cp) and a peak width 0.08·(1 + 4·(U/cp)⁻³), held to
  the same α = 0.02 saturation range, which it meets 4–6 ωp above the peak. The drawn slopes are 79%
  of Cox–Munk's total at 9 m/s and a third in a storm; the rest stays unresolved roughness.
- **Choppiness** 1/(π·0.1412) ≈ 2.25: a trochoid then cusps exactly at Stokes' limiting steepness,
  so crests sharpen as waves steepen (the Jacobian falls below 0.5 on about a tenth of the surface
  on High) and fold into loops only where the linear sea passes breaking (0.03–0.08%).
- **Tiles.** Every cascade grows by one factor until the largest tile holds 8 peak wavelengths
  (never shrunk, at most 4×), so the bands keep their places on each lattice and the longest waves no
  longer repeat 3–4 times a tile from the air map.

| Wind (m/s) | 3 | 6 | 9 | 12 | 15 | 18 | 21 | 25 | 30 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Significant height (m) | 0.15 | 0.9 | 1.8 | 2.7 | 4.0 | 5.5 | 7.0 | 8.8 | 11.3 |
| Table peak (m), Hs/λp | 11, 1/71 | 21, 1/24 | 32, 1/18 | 43, 1/16 | 53, 1/13 | 60, 1/11 | 60, 1/9 | 62, 1/7 | 75, 1/7 |
| Drawn peak (m) | 5 | 37 | 70 | 100 | 146 | 197 | 246 | 298 | 368 |
| Peak period (s) | 1.9 | 4.8 | 6.7 | 8.0 | 9.7 | 11.2 | 12.6 | 13.8 | 15.4 |
| Drawn Hs/λp | 1/36 | 1/41 | 1/39 | 1/37 | 1/36 | 1/36 | 1/35 | 1/34 | 1/33 |
| Wave age U/cp | 1.04 | 0.79 | 0.86 | 0.96 | 0.99 | 1.03 | 1.07 | 1.16 | 1.25 |
| γ | 1.80 | 1.70 | 1.70 | 1.70 | 1.70 | 1.76 | 1.88 | 2.09 | 2.28 |
| Tiles on High (m) | 1,024 / 181 / 31 | ← | ← | ← | 1,166 / 206 / 35 | 1,580 / 279 / 48 | 1,968 / 348 / 60 | 2,381 / 421 / 72 | 2,947 / 521 / 89 |

Atlantic figures; Low draws the first tile, Medium the first two, Ultra the same sizes at 512².
A map's height scale makes its seas younger, so shorter and steeper (the Pacific's 5.7 m at 25 m/s peaks
at 169 m, 1/30); its wavelength scale does not apply while the switch is on. Off, the ocean draws the
table's wavelength, γ 2.6 and choppiness on the tier's tiles exactly as before. Either way combat,
hull motion and the port's `BerthMotion` read the table through `session/sea.ts`, and whitecaps cover
the same share of the sea. The realistic sea's heights are also easier to invert: `heightAt` (buoys, the torpedo
overlay, the waterline) misses by 2 cm at the 90th percentile in the 25 m/s storm, where the table's
folded crests cost 12 cm.

### The sea around hulls

Every hull rides combat's two sines while the ocean draws its own spectrum, so in a storm a hull could
sit on a combat crest over a drawn trough with its bottom showing, or under a drawn crest; the realistic
sea's 300 m swells lift or drop the drawn water along a whole hull at once. The game passes the drawn
hulls, the combat sea's components (`seaWaves` in `session/sea.ts`) and the simulation's clock to
`ocean.setHullSea` every frame, and near each hull the ocean blends its long waves into that sea
(`src/game/ocean/waves/hullSea.ts`). Presentation only: combat, hitboxes and poses never read it.

- **Clock.** The battle's `presentationTime`: the simulated time of the poses drawn this frame, between
  the last two snapshots by the interpolation fraction, never the ocean's wave time. Paused and tactical-
  paused frames hold it. In port it is `BerthMotion`'s clock, with still water while the hull is inspected.
- **Hulls.** The nearest 16 to the camera (the wake field takes 8), each a centre line through its hull's
  actual extents. Full coupling within max(0.3 L, 0.75 B, λ/4) of the centre line, none beyond max(L, λ)
  further, λ being combat's longer wavelength (4 × the table's peak): the crest and trough beside the hull
  are the ones it rides, and over a wavelength the blend tilts the water less than the waves themselves
  do. Overlapping reaches join as 1 − Π(1 − wᵢ), smooth where a max would crease the lighting. With more
  hulls than slots, those near the cut fade instead of popping as the camera moves.
- **Contact.** A hull couples in full while its highest point (a submarine's periscope eye, a ship's deck
  edge) stands above the still-water line, and not at all once it is deeper than combat's amplitude and a
  metre more: a submarine at depth or a wreck going down leaves the drawn sea alone.
- **Blend.** Height = drawn + α·long + β·combat, `long` the first cascade low-passed by its mip chain,
  α = n(1 − w) − 1, β = n·w, n = 1/√((1 − w)² + w²): the two seas are uncorrelated, so a plain cross-fade
  would calm the ring between them to 0.71 of the swell. Combat's heights are taken where each vertex
  lands, so the drawn height equals `seaHeight` at the hull's own points; the long waves' horizontal
  motion goes with their heights. Slopes, strain and the blend's gradient across both seas follow, and
  `heightAt` (buoys, the waterline test, the torpedo overlay) too. Shorter waves, crest foam (bound to
  the grid, so it stays on the shorter crests), the wake and bow waves ride on top.
- **Split.** A box low-pass falls from 0.9 to 0.1 over a factor of five in wavelength, so no mip level
  separates the long waves cleanly. When the spectrum rebuilds or combat's wavelength changes, the field
  weighs, over the first cascade's spectrum binned to 64² cells (0.1–2 ms), the variance of drawn waves
  longer than λ/2 a level would leave beside a hull (twice) against the shorter variance it would take.
  The storm loses its long peak whole beside a hull and keeps most of its 50–100 m waves (a sea whose
  waves were all far shorter than combat's would lose none):

| Low-pass box on High, Atlantic (m) | 9 m/s | 15 | 25 | 30 |
| --- | --- | --- | --- | --- |
| Realistic sea | 23 | 31 | 31 | 39 |

Only the realistic sea couples. With `ocean.realism.seaState` off the ocean draws the table's
art-directed sea exactly as before, the look tuned to compare with the library it replaced. That sea
peaks at a quarter of combat's wavelength and runs at the breaking limit, so the water beside a hull
is ruled by waves no hull in combat follows, and blending in combat's swell does nothing for it: in a
live 30 m/s battle (Bismarck and Fletcher, 100 s per case) the gap between the drawn water and a hull's
still-water line stays 3.7–3.9 m rms with or without it, where on the realistic sea it falls from
2.5–3.5 m to 1.4–2.0 m and water more than 4 m below the Fletcher's still-water line (its draft is
4.2 m) from 20% of samples to 0.1%. On the GPU, heights read back around the hulls of a paused 25 m/s
battle with the drawn waves flattened match `seaHeight` at the drawn poses' time to 0.01 mm. The hull
waterline layers read the same water ([Hull waterline](#hull-waterline)): the wet band through
`heightAt`, the contact foam at the water's drawn position, so paint, foam and sea all meet the pose
combat gives the hull.

What remains is combat's own motion. The authority eases heave over 1.5 s (37° behind a 12.6 s swell),
averages it over the waterplane and pitches a battleship about a third of the wave's chord slope, so in
a 25–30 m/s storm a hull's still-water line sits 1.5–2 m rms from the water beside it amidships and up
to 4–5 m at a battleship's ends (measured over two minutes of Bismarck and Fletcher; a hull following
the sea without easing would leave 0.6–1.3 m, the sea's curvature along it). Drawn water there is still
combat's truth: shells splash and openings flood against the same `seaHeight`.

## Water colour

The selected **A · Steel blue** palette uses `waterColor #2d373c` and `transmissionColor #49575e`
across every map and the port, a muted, cool blue-gray. Absorption is map-specific (North Atlantic
`#945b57`, Iron Bottom Sound `#b67b45`, Vestfjord `#916d59`, Sunda Strait `#a97851`, Strait of Dover
`#8a6a55`) and the port inherits the Atlantic swatches. The pigment is emitted radiance:
`VisualEnvironment` scales it for night (see below), always starting from the original map swatches. Foam is lit like any white surface by the sky and the sun or
moon, so it needs no night scaling. The sky's environment lights every material
at intensity 1.

Reflectance keeps a 1e-4 grazing guard rather than 0.05, so distant wave slopes keep distinct
reflectance under 24× binoculars instead of turning into one flat colour. Submerged hulls and terrain
show straight through the surface: the opaque scene at the same screen position, attenuated by
`exp(−absorption × column)` and filled with the pigment, with no refraction offset.

### Physical water colour and reflections

`ocean.realism.waterColor` and `ocean.realism.reflections` (both on by default; the developer
console's **Toggle physical water colour** and **Toggle physical reflections**, or
`?realism=off` on the review page) replace the look above, which was tuned to match the replaced
library; switched off, the surface is exactly that look. The physics and constants are in the
[ocean README](../src/game/ocean/README.md) under *Physical shading*; in short:

- **Water colour.** The body is sunlight and skylight scattered back out of the water, from the
  map's absorption and one open-ocean backscattering, (0.00323, 0.00395, 0.00565)/m (sea water plus
  particles, Jerlov's oceanic type II–III), through Lee et al.'s (2002) remote-sensing reflectance,
  lit by the sun and sky that cross the surface and ÷ n² on the way out. It follows noon, dusk,
  night, overcast and ship shadows without the night pigment scaling. The Atlantic's water is about
  a third as bright as the Steel-blue pigment and bluer; the Pacific's is deep blue. Shallows and
  submerged hulls use the same optics: attenuation (a + b_b)·s·(1 + |view.y|/0.85) over the column,
  97% of the daylight through the surface and ÷ n², so they read darker and bluer than before.
- **Reflections.** The unresolved facets (all of Cox–Munk's tail plus the pixel's footprint, split
  along and across the wind) reflect as a lobe centred on the facets the viewer sees, weighted by
  their Fresnel reflectance, with Bruneton et al.'s mean Fresnel: a 9 m/s sea mirrors about 37% of
  the sky some 18° up at the horizon instead of nearly all of the horizon, so the far sea is darker
  than the sky and the horizon crisp. Reflections smear toward the viewer and stay sharp sideways;
  the sun makes a glitter path that widens with the wind and toward the horizon, compressed above a
  quarter of the sun's irradiance so a low sun doesn't blind the view; ship reflections
  follow the whole wave slope and blur by the same lobe, so light air leaves only a faint smear under
  a hull and a 9 m/s sea little beyond the waterline.

Measured at 1600 × 900 on High in one page, flipping the switches every 12 serialised frames (300
frames each, trimmed means, while other GPU work ran): both on cost 0.47 ms near (9.48 → 9.95 ms),
0.32 ms grazing and 0.12 ms wide. The reflections carry it (0.3–0.45 ms, about two thirds of it the
two extra sky taps of an elongated lobe); the physical water colour costs under 0.1 ms.

## Fog

`ocean.fog` becomes `scene.fogNode` for every fogged material, including transparent effects: a ramp
from `start` to `end` raised to `power`, whose colour turns into the sky's own fog colour along the
view ray over `skyBlendDistance`. Sky backdrops are not fogged. The final composition adds no depth-based
post fog: such a pass reads opaque depth behind transparent smoke and can erase it at the horizon (the
sky's post chain adds only sun shafts and a rain veil).

| Scene | Start | End | Power | Sky blend |
| --- | --- | --- | --- | --- |
| Before the first scene applies (`Game.initialize`) | 2,500 m | 16,000 m | 1.4 | 10,000 m |
| Battle: the map's fog, then the weather's (Atlantic 8,000–48,000 m, 28,000 m blend) | map | map | 1.4 | map |
| Port | 650 m | 5,600 m | 0.85 | 2,600 m |

The air map pushes fog out to 400–900 km while it is open, and the developer console's visibility
override scales the whole ramp. Night, dawn and dusk tint the fog colour (see below).

## Submerged camera

The maps' absorption removes over 99% of green/blue light along a 50 m underwater column, which would
hide our own Type VIIC at chase distance. `VisualEnvironment.update` eases the absorption to 5% of the
surface value over the first 2 m of camera submersion, a 20× longer visibility range that keeps the
water colour and distant haze, and restores the exact surface swatch when the camera comes back up. It
is a gameplay visibility adjustment, not measured Atlantic water clarity.

A submerged camera sees the ocean's underwater pass (`ocean.postProcess`): exponential absorption
toward the pigment over the distance to the first surface, with the waterline across the near plane
handled per pixel. Nothing runs for it when the camera is certainly above the waves. The surface seen
from below shows the sky through Snell's window and, outside it, a lit ceiling: daylight from the sky
scattered along the surface, tinted by the map's absorption and dimmed over 60 m of camera depth, so
the waves stay visible from a submarine's depth.

`/scripts/diagnostics/underwater-visibility.html?test` runs the actual `Game.frame` at 7, 50 and 150 m.
It compares visible-hull pixels with the same view without the hull and checks surface and periscope
restoration; `window.visibilityResult.passed` must be true. Add `&legacy` to restore the surface
absorption after each frame as a negative control; its dive checks must fail.

## Zoomed ship reflections and shadows

Above 1.5× magnification in battle, `WaterViewFocus` selects the visible hull nearest the centre of
the rendered view. It stretches `ocean.reflections.maxDistance` from its 400 m base to twice the
camera-to-hull distance, capped at the camera far plane, and the sun/moon shadow map follows that
hull with its usual size and resolution. Returning to an ordinary view, the air map or port restores
the base reach and shadow anchor. Selection is independent of combat targeting and works while
paused.

Graphics → Reflections **Ships and sky** turns on screen-space ship reflections where the tier traces
them: High with 16 ray steps and Ultra with 32. Low and Medium reflect only the sky. Rays are clipped
to the viewport, marched in reciprocal depth and refined with binary steps against full-float depth
(see the ocean README), off a normal keeping 30% of the wave slope so a hull's image wavers rather than
breaking into speckle. With physical reflections on, rays follow the whole slope and the hit image is
smeared along the plane of incidence by the unresolved facets instead. Screen-space reflections still
omit offscreen geometry.

The displaced surface also receives ship shadows from the same directional shadow map.
`src/game/WaterShadows.ts` builds a receiver node from the light's depth texture and binds it with
`ocean.setShadowNode`; it adds no shadow map or caster pass. Graphics → Water shadows applies live: Off
removes the sampling, Low uses one comparison, Medium four and High a nine-tap soft filter. The
Low/Medium/High/Ultra presets choose Off/Low/High/High. A shader branch skips the texture reads
outside the shadow camera's bounds. Shadows attenuate the lit terms (sun specular and glints,
subsurface light and foam); the ambient pigment keeps 45% in full shadow (with physical water colour,
shadowed water keeps the skylight's share of its upwelling) and the sky reflection is unshadowed. They follow the active sun or moon and the local or zoomed hull anchor; ships outside the
map's 760 m footprint cast no water shadows. The Shadows setting controls map resolution for both hull
and water shadows; its Off option overrides Water shadows without losing the selected water quality.
Off stops shadow-map rendering and sets its intensity to zero; an already allocated map is kept so
cached programs can reuse it when shadows are enabled again.

Checks, with the game paused and ocean time frozen:

- `/scripts/diagnostics/water-shadows.html?test` compares frames with only water shadow reception
  disabled and enabled, checks restoration, all four water shadow levels and global Off/Low/High, and
  exposes `window.shadowResult.passed`. Add `&calm` for a flat sea.
- `/scripts/diagnostics/water-reflections.html?test` looks at a hull 5 km and 20 km away through 24×
  binoculars and counts the pixels the reflections change (the same frame traced and untraced), with
  the base reach and with `WaterViewFocus`; the focused reach must change at least twice as many
  pixels, move the shadow anchor onto the hull, and restore both at 1×. It exposes
  `window.reflectionResult.passed`. It measures the near-mirror trace with physical reflections
  off: with them on (`&physical=1`), a 9 m/s sea mirrors a distant hull only from water within a
  few hundred metres of it, which the base reach already covers.

## Ship wake

Every hull on the water leaves a wake in two layers, both shaded by the ocean surface itself; there
is no decal or flat plane above the sea. `src/game/ShipWake.ts` configures them and composes the
surface's wake foam as the maximum of the field's breaking foam, the trail foam and torpedo tracks
(`ocean.setWakeSampler`).

**Wake field** (`ocean.wake`, `src/game/ocean/wake/`): a dispersive displacement field of
**1,536 × 1,536 m** centred on the focus hull, so the camera can orbit and zoom without moving the
trail. Cells per edge follow the tier: Low has no field, Medium 256², High 512², Ultra 1024². Its 16
generators go to the nearest eight hulls within 900 m. Bow and stern generators sit at ±44.8% of hull
length with radii of 28% and 39% of beam (about **10 m** and **14 m** for Bismarck) and full-speed
depths of **0.32 m** and **0.18 m**, scaled by the square of the speed ratio; they switch off below
0.1 m/s and fade as a submarine submerges. Friction is **0.065**, breaking foam starts at a slope of
**0.015** over the field's 12 m baseline, foam strength is **1.2** × the fastest nearby hull's speed
ratio and foam lives **9 s**. Moves over 100 m are teleports and restart a generator. The field's
physics, costs and diagnostics are in the ocean README; `bun scripts/browser/ocean-wake.ts` runs
`/scripts/diagnostics/ocean-wake.html`.

**Trail foam** (`src/game/WakeFoam.ts`, `src/game/FleetWakeFoam.ts`): each ship records a position,
heading, speed and birth time at most every **3 m** of hull-end travel, including the arc swept
during turns, which keeps foam attached to the stern even when the ship's centre moves slowly. With
`ocean.realism.wake` off (the look first tuned to match the replaced ocean library), three stern
streams merge and widen with age, while bow-shoulder foam moves sideways from the recorded course.
Old samples keep their original heading through turns. Coverage decays over **23 seconds**, with a
smooth cutoff at **55 seconds**, and slow world-space turbulence breaks up the outline.
Emission follows motion, reverses its trailing end when sailing astern, fades to nothing 3 m below the
surface and restarts after a move of over 100 m. Shell splashes and aircraft crashes add short-lived
foam rings. For constructed ships, emitters use the compiled hull-volume bounds and their local
centre, so the authoring origin need not be amidships.

Each ship has its own **1,536 m** foam field (the tier's wake resolution up to 256², 128² on Low),
refreshed at most **20 times per second**, or 5 times when the hull is more than 2.5 km away in
apparent distance. An **8 × 8 atlas** keeps one texture binding for up to 64 trails; a larger battle
keeps the focus hull and the trails nearest to it. `WakeFoamGpu` paints the stamps into the atlas on
the GPU with max blending; overlapping samples use maximum coverage rather than additive buildup.

### Realistic wake

`ocean.realism.wake` (on by default; the developer console's **Toggle realistic wakes**) draws what a
warship at speed leaves instead of the translucent streams: churned white water behind the stern,
bubble clouds under it and a slick that outlasts both. `ShipWake` binds its sampler on the switch
(one recompile of the surface); off, the sampler, stamps and shading are the original ones exactly.

- **Churned water.** Each trail sample lays a band about a beam wide at the stern (half-width
  **0.45 beam**), widening by **0.13 beam × √(metres run since ÷ beam)**, as two half-band stamps whose
  widths bulge and draw in by **±35%** along the track, a beam or two per lobe, so the outline is
  ragged rather than a painted strip. Its turbulence goes as smooth(speed ÷ full speed)^**1.3**, so a
  slow hull leaves little white water; a hard turn adds up to **60%** (turn rate × length ÷ speed), and
  it decays with a **24 s** e-folding time, gone by 55 s. The surface covers the share of world-anchored
  eddies (9 m down to 1.5 m) that the turbulence sets, up to **88%**: nearly all white behind the stern,
  torn at its edge, breaking into patches as it decays. Where the eddies fall below a pixel it takes
  their mean coverage, so a distant wake keeps its brightness instead of dissolving into speckle. A
  2.5 m warp frays the outline. The field's hull foam, the analytic bow white water and torpedo tracks
  share the surface's churned-water shading (up to 0.97 opaque instead of 0.75).
- **Bubble clouds.** The same turbulence, torn a little further, puts bubble clouds under the churned
  water, at most **60%** of the water body: turquoise, from the absorption colour over 2 m of water
  down and back (see the ocean README).
- **Slick.** Samples every **18 m** also paint a slick that lasts **4 minutes**: half-width
  **0.55 beam**, widening by **0.2 beam × √(metres run ÷ beam)**, fading with an **80 s** e-folding
  time. It stills **75%** of the waves shorter than 25 m and of the unresolved roughness, so the band
  reads smoother than the sea around it, brighter or darker with what it mirrors; where it crosses the
  centre of the sun's glitter it mirrors the sun in broken highlights (at 95% it made one blown-out
  patch). A faint bubble residue (**8%**) keeps an old wake a shade lighter from the air. The slick follows turns, fades after a stop and is cleared with
  the trail; a hull 3 m under water leaves none.

The atlas is **RG8**: red holds each hull's foam, or its turbulence, on the 1,536 m square around it
as before; green holds its slick on a **4,096 m** square (16 m cells at 256²) centred on the trail it
holds, up to 42% of its edge from the hull, so a straight run keeps about 3.7 km. Each trail records
the boxes its stamps painted in each channel: the sampler tests a tile's union box once, reads a channel
only inside its own box and square, and skips every tile outside all trails, so the cost follows the
trails' area. A sample lays two churn stamps plus a slick stamp every six, fewer than the original
trail's three per sample. `game.shipWake.trailTuning.stamps` (applied as trails repaint) and
`.shading` (next frame) retune it live.

Measured on an Apple GPU at 1600 × 900 (High), switching the realism on and off in alternating blocks
in one page (`.build` scratch drivers; the surface timed alone and whole frames, paired per round):

- One hull, chase view: no measurable cost (the surface alone +0.1 ms, interquartile −0.4…0.4 ms;
  whole frames within ±0.4 ms). `ShipWake.update` takes 0.08 ms of CPU in both modes.
- Sixty hulls with their trails in view: the surface costs about 0.3 ms more GPU time on an idle
  GPU, up to 1.6 ms (interquartile 0.4…4 ms) while other work shares it. `ShipWake.update` takes
  0.2–0.3 ms in both modes. A trail lays 8–10% fewer stamps than the original one (Bismarck at full
  speed: 719 against 782 per refresh). The atlas doubles to 8 MB (2 MB on Low).

**Torpedo tracks** (`src/game/TorpedoTrackFoam.ts`): exhaust released at running depth rises at
1.5 m/s, so a track begins astern of the round, stays where it was laid and outlives it (30 s).
Airborne rounds and rounds deeper than 8 m leave none. One 1,024² field follows the viewer, or under
magnification the round nearest the line of sight.

A paused frame renders without stepping: `ocean.update(0)` advances neither waves, foam nor wake, and
the trail and track layers ignore a zero step. Returning to port clears the field, trails and tracks.

Checks:

- `/scripts/diagnostics/ship-wake.html` sails a real battle's Bismarck through `Game.frame` with a
  controlled clock and helm and reads the GPU trail atlas back: no foam at rest, visible foam 262 m
  astern at speed, a trail that widens with age, exact preservation through a paused camera orbit,
  retention through a turn, fading after the engines stop and clearing in port. The realistic wake
  also needs a slick that outlasts the churned water astern and stays after the stop; `?realism=off`
  checks the original trail. `window.wakeDiagnostic.passed` must be true; `?quality=` selects the tier.
- `/scripts/diagnostics/wake-foam-gpu.html` compares the GPU atlas with the CPU reference raster
  (`src/game/testing/wakeFoam.ts`), both raw coverage (both channels) and the world-space sampler the
  water uses, through turns, pause, teleport, tile reassignment and reset, for the original and the
  realistic trail. `window.result.passed` must be true; comparing a manually flipped readback alone
  would miss an upside-down atlas.
- `/scripts/diagnostics/torpedo-trail.html` lays synthetic torpedo runs through the real track layer
  for review captures (`trailFixture(degrees, depth, seconds, turnAt, view)`).
- Unit tests cover 60 independent trails, a stopped player, submerged ships, per-ship teleports, tile
  reassignment, the generator limit, fleet replacement and port cleanup, in both trails; the realistic
  band's width, continuity and decay, the slick's reach and square-root widening, speed scaling, the
  painted boxes the sampler relies on, and the live switch.

### Bow waves

`src/game/BowWaves.ts` draws each moving hull's bow wave analytically in the hull's own frame and joins the same wake sampler: its height adds to the vertex displacement, its slope to the surface normal and its white water to the foam by maximum coverage. Crests therefore stay sharp at any range, which the wake field's 3 m cells cannot. The eight nearest moving, surfaced hulls to the camera are drawn; speed is the displayed speed smoothed over 2.5 s, submergence fades it out and going astern draws none.

- **Stem crest.** A crest climbs the stem, peels away from a fine-entrance waterline at `crestAngle` (tan, 0.18) and has a trough inboard of it, over a broad rise around the stem. Its height is 0.3 × U²/2g, scaled by beam and capped at 4 m (about 2.8 m for Bismarck at 26.6 kn). White water covers the stem and rides just outboard of the crest, then trails aft and spreads, with broken water along the forward hull side.
- **Kelvin V.** The closed-form stationary-phase solution for a point source carries a transverse and a divergent system inside the 19.47° cusp. It uses an Airy-style cusp limit and an e^(−kd) source depth of a quarter beam. Its slope is the wave vector, so normals need no finite differences. The amplitude (1.6 × U²/2g × √(beam/length)) is exaggerated so the V reads in a 9 m/s sea. In calm water the curved transverse crests and both arms show in the sky reflection. Divergent crests break into feathered dashes near the cusp. `kelvinSystems` is the CPU reference, tested against the brute-force Kelvin integral.
- **Turns.** The V is laid along the arc the stem has run, using track curvature measured from each hull's heading change per metre, so it follows the curved stern trail instead of swinging with the bow. The crest and hull-side wash stay in the straight hull frame.
- **Resolution.** Displaced features must span four water-mesh vertices (the clipmap rings double from 4 m on High), so they do not crawl as the hull crosses the grid. Normals and foam must span five pixels, stretched by the grazing angle, so distant crests fade rather than shimmer.

While the layer is on, trails stop painting their bow-shoulder stamps; the stern streams are unchanged. The developer console's **Toggle bow waves** compares against the wake field alone, and `game.shipWake.bowWaves.tuning` retunes the shape live. Measured on the previous ocean with vsync off at 1728×1030 on an Apple GPU, switching the layer off and on every 0.6 s over 20 rounds, it added about 0.2 ms per frame with one hull in view and 0.8–1.2 ms with eight hulls whose wakes fill the view; cost grows with the water pixels inside wakes. The CPU update takes under 1 µs per frame. These are visual tuning values, not a hydrodynamic model.

### Hull waterline

Two visual-only layers make hulls sit in the sea rather than on it. Neither reads or feeds the simulation.

- **Wet band.** `src/game/HullWetBand.ts` darkens albedo by 45% and cuts roughness by 60% on every shared ship paint within a band just above the sea at that fragment, and everywhere below it. The sea height is read per fragment exactly as the surface draws it: `waveField.heightAt` (the FFT cascades, inverting the choppy sideways displacement, with [the sea around hulls](#the-sea-around-hulls) blended in) plus the wake field and the bow waves, so the band climbs the stem underway and follows each crest along the side. The band is 0.3–0.9 m at rest by hull length (the paint palette stores it as `shipSurface.w`, beside roughness, metalness and the surface-detail plating flag), plus 0.2 m per metre of significant wave height, capped at 1.6 m; noise breaks its upper edge into short tongues. Fragments above the tallest possible crest plus band, or below the deepest trough, skip the sea read. Premade and construction hulls share the palette, so both get it; ship views clone the paint, so the palette receives the band when it is created, and the sea attaches once the water exists, before the first compile. The band multiplies whatever colour and roughness surface detail gives a paint (the teak `colorNode`, plated or plain roughness), with one wrapper per base node, so equal paints still share a program.
- **Contact foam.** `src/game/HullContactFoam.ts` joins the wake sampler's foam by maximum coverage: a narrow line of broken water outboard of each hull, faint at rest (0.12 foam energy plus 0.025 per metre of significant height), stronger underway (+0.3) and toward the stem (+0.4 over the forward 30%), capped at 0.55 (the surface draws wake energy solid from 0.6) and torn by world-anchored noise. Its hull shape is sliced from the drawn model itself (`hullWaterlineProfile.ts`): 32 stations by 7 levels from −6 m to +6 m about the design waterline, sliced once per hull while its model loads (tens to a couple of hundred milliseconds for a detailed model, which must not land in a battle frame). The water fragment transforms its displaced world position into the hull's drawn frame, heave, pitch and roll included, and reads the breadth at its own height, so the line stays on the hull in a heavy sea; empty stations past the ends read as inside the hull, so no foam trails off the stem or stern. Like the bow waves, a line narrower than three grazing-stretched pixels widens and fades rather than shimmering, and hulls where it would span under a twentieth of that are not slotted at all. The eight nearest surfaced hulls within 4 km are drawn. Everything per hull lives in one uniform buffer, so the surface gains no texture binding; every open-water pixel tests one bounding circle per slot. The surface's own depth-based shoreline foam also draws a faint line where a hull meets the water; the contact foam adds the speed, bow and sea-state shaping that depth alone cannot.

`game.hullWetBand.enabled` (a uniform) and `game.shipWake.hullFoam.enabled` switch the layers for comparison; `game.shipWake.hullFoam.tuning` retunes the foam live. Neither adds a render pass.

## Wind

Funnel exhaust, gun and impact smoke, burning-turret smoke and falling-aircraft trails use the
ocean's wind direction and speed; flags and radars read the same wind. Direction is in radians from
+X toward +Z; visual drift uses 35% of the wind speed with each particle's own response factor.
Returning to port restores the harbor's standing wind (9 m/s toward 35°). The renderer-free sea model
also uses this weather wind to drive gradual ship leeway. CPU waves add hull motion and
heading-dependent resistance; shell flight still omits aerodynamic wind drift. See
[the runtime contract](ship-runtime-contract.md#blueprint-and-simulation-contract).

## Night and sunrise lighting

The numeric time slider blends the authored night, dawn/dusk and map fog colours by solar elevation.
Hemisphere fill retains 50% of the map/weather daylight setting at night and reaches full strength at
18° elevation. This keeps ship details readable while preserving a darker sea and sky.

The sky computes the active celestial light (`sky.light`: direction, colour, intensity, whether it is
the moon, and a lightning flash) from its own atmosphere: sunlight at sea level after the air it
crosses, white at a high sun and golden near the horizon, never dimming faster than the game's earlier
ramp, and the moon once it outshines the sun. `VisualEnvironment.syncLighting` shares it with the ocean
(`ocean.sun`), the scene's directional light and its shadows, and combat effects, including on paused
frames; a flash multiplies the hemisphere fill and smoke's ambient by `1 + flash`.

The moon is full unless the developer console picks another phase (Shift-D, "moon 0.12"); the sky
places it on the sun's arc 2π·phase behind the sun, with its path inclined 28° so an evening crescent
stands over the afterglow. Moonlight above the air is 0.8 × the lit share of the disc in tint
`#b4c9f0`, about a tenth of daylight: lifted far above nature so night hulls read. The water pigment
and transmission use 24% of their original linear radiance at night, reaching 100% at 18°; foam takes
the moon and the night sky's light. Absorption and wave energy are unchanged. Port restores its
original colours, fill and direct light. The settings are artistic gameplay lighting, not a geographic
or calibrated astronomical model.

`/scripts/diagnostics/night-lighting.html` (`reviewLighting(hours, options)`) checks that the ocean
and the scene light carry the same intensity and that a battle night has the night fog colour (with the
Sky Pro comparison, also its lunar cloud fill).

## Sky and atmosphere

[The sky's README](../src/game/sky/README.md) describes its parts: Hillaire's scattering tables with the
planet's shadow for twilight, a limb-darkened sun, a phase-lit moon, a seeded star catalog and a
procedural Milky Way, volumetric clouds with cirrus, cloud shadows and rain shafts, screen-space sun
shafts, rain, splashes and lightning with procedural thunder. Graphics → Clouds picks its tier live.
What the water reflects and every material is lit by is its environment bake: an equirectangular image
from sea level under the camera (256, 384, 512 or 768 px wide by tier) of the sky and a short cloud
march, refreshed in four bands over 16 frames with one PMREM refilter a sweep. Below the horizon it
holds a sea (the sky mirrored with water's Fresnel over the dim water body), so hulls are not lit from
below by the horizon's colour. The display grades with AgX (`DisplayTransform`); bloom, when on, gives
the sun, moon and lightning their glow.

The game requests reversed depth for centimetre-scale ship details at long battle ranges; the main scene
pass keeps a floating-point depth attachment, the 0.5 m battle near plane and the 60 km far plane. The
sky's dome is a full-screen backdrop at the far plane drawn right after the sea, so it shades only the
sky left visible; the clouds' composite follows it, depth-tested at the clouds' own distance, so ships
hide clouds and clouds hide the sea from the chart's height. The ocean and smoke use Three.js's depth
conversion nodes, which account for reversed depth.

### Port light and horizon

Port sun peak intensity is **5.8** and hemisphere fill **1.75**, lifting shaded hulls and harbor
buildings. Exposure remains **1**, with the existing sun angles and restrained forward scattering.
Battle fog uses power **1.4** and the complete authored sky-colour blend distance for the selected
map/weather; port fog uses power **0.85** and a **2,600 m** blend. There is no custom horizon veil and
no depth-based post fog.


### Daylight

The Atlantic's daytime setup uses sun elevation 48°, sun intensity 6.6, environment lighting 1.0 and
hemisphere fill 0.65 with a light tint; the other maps author their own sun, fill and sky. The HUD shade is confined to short edge regions (20% opacity at the top,
44% at the bottom) and hides with the instruments.

The clouds light themselves from the atmosphere, not from the scene's hemisphere light: sunlight at
their altitude, sky light from above and the sea's bounce from below, with the scene's cloud ambient
(**1.10**, the weather's share) and base shadow (**0.20**, **0.55** in storms) grading the fill and the
darker bases. The water reflects that lighting through the environment bake.

The authored scattering values below were tuned against Sky Pro; each sky maps them onto its own model
(the game's sky through the documented gains in `src/game/sky/atmosphere/model.ts`), so they read as
visual controls, not a calibrated atmosphere.

| Sky parameter | Port | North Atlantic |
| --- | --- | --- |
| Rayleigh | 0.42 | 0.38 |
| Turbidity | 3.2 | 2.2 |
| Mie scattering strength | 0.25 | map value × 0.45 (`SUN_HAZE`) |
| Mie directional G | 0.6 | 0.72 |
| Sky multiple scattering | 1.4 | 1 |
| Cloud coverage control | 0.38 | 0.40 |

The port and the Atlantic use cloud thickness 2,400 m, altitude 1,700 m and horizon coverage boost
0.06. Coverage
is a nonlinear shape control, not a percentage of visible sky. Scene transitions restore all
scene-specific sky parameters.

### Sun glare and celestial discs

Facing the sun at sea, the forward aureole once bleached about a third of the sky and the water
beneath it. `VisualEnvironment` applies `SUN_HAZE` **0.45** to every map and weather preset's authored
Mie strength, preserving their relative haze, and both skies draw the discs at 1.4° (1 − cos θ =
7.5e-5; the real discs are 0.53°). Raising `mieG` concentrated the same light into a hotter core, and a
disc-only brightness multiplier made no visible difference after ACES, so neither is used. The low
sun remains the brightest case.

In port, broad aerosol scattering made the sun-facing view pale and washed out, including its water
reflections; a fixed-camera comparison isolated the forward haze, and port Mie strength **0.25**
restores visible clouds and water colour. Review both sun-facing and normal-port directions when
changing atmospheric scattering; the normal port camera faces away from the sun.

## World ocean maps

Custom battle's **Battle conditions** combines time of day, cloud cover and wind. Legacy weather
presets set a wind speed (Clear and Fog 5 m/s, Map default and Partly cloudy 9 m/s, Overcast 12 m/s,
Storm clouds 16 m/s) and the calibrated sea turns wind into waves and foam. Presets live in
`assets/maps/battle-conditions.v1.json`; the renderer-free `src/maps/conditions.ts` resolver layers
weather over the map's sky and fog, then applies time-of-day sun angles, ambient scaling and
twilight/night fog tint. Omitted selections and **Map default** retain the map's values. Dawn,
Morning, Noon, Dusk and Night remain fixed during play; Clear, Partly cloudy, Overcast, Fog and Storm
clouds control cloud coverage, altitude, fill, wind and distance haze. Storm clouds bring rain (0.9) and
lightning (3 strikes a minute), Overcast a drizzle (0.15); a custom sky rains from 75% cover, harder as
the wind rises to a gale, and thunders on a solid deck in a storm-force wind (`src/maps/precipitation.ts`,
a table rather than the conditions JSON, which the simulation content hashes, and outside
`src/maps/conditions.ts`, which the construction ships' model fingerprints include). Rain and lightning
are visual only, and so is visibility: none of it alters CPU bot acquisition or ballistics.

`VisualEnvironment.setScene` applies the composed conditions as a renderer-independent `SkyScene`
(sun angles and intensity, moon phase, the authored atmosphere, clouds, rain and lightning); the sky
places the sun exactly where the scene authored it, on an equinox arc whose pole makes that elevation, and
the moon on the same arc. Night retains low ambient fill for readable silhouettes and uses a dark fog
tint; the far fog turns into the sky's own moonlit colour, so the distant fog blend does not paint the
night backdrop black. The shadow anchor follows the active sun or moon, with
a restrained lunar directional fill at night. Returning to port restores cloud fill, horizon coverage,
sun, atmospheric scattering and fog alongside the harbor's 9 m/s sea. Setup choices survive returns
to port for the current page session. `Game.diagnostics()` exposes the selections and applied
lighting.

Versioned map definitions live in `assets/maps/environments.v1.json`, consumed through
`src/maps/catalog.ts` (`OceanMap`). There are five: the open **North Atlantic** and four real places
where naval battles were fought, **Iron Bottom Sound**, **Vestfjord**, **Sunda Strait** and the
**Strait of Dover**. Each map supplies water, absorption and transmission colours, wave and wind
multipliers, wave-foam opacity, sun elevation, azimuth and intensity, cloud coverage, altitude and
thickness, atmospheric scattering and fog, plus:

- `bearing`: the true bearing of the chart's top (0, 315, 75, 295 and 45°). The game frame is the
  chart's (x east of the chart centre, z toward its bottom), so true north lies `bearing` degrees
  counter-clockwise of chart up. Charts, the helm compass and every heading or bearing readout show
  true values (`trueBearing`).
- `battle`: the actions fought there, with dates, which the map tiles and the loading screen show;
  the open Atlantic has none and shows its region.
- `land.terrain`: the baked heightfield `public/maps/terrain/<id>.ntf`, or null for open sea.

The authored sun `azimuth` (map and time-of-day presets alike, and the clock's sun path) is a true
direction in the sky's convention (a compass bearing B is azimuth 180 − B); `battleEnvironment` turns
it by the map's bearing into the chart frame, so the sun stands where it would over the real place.
`water.windDirection` stays in the chart frame, where the simulation reads it. The port keeps the
Atlantic, whose bearing is 0. Map selection does not rebuild the ocean; the port restores every
overridden parameter on return. `/scripts/diagnostics/ocean-maps.html` (`reviewMap(id, weather)`,
`captureMap()`) captures each map in a paused battle; `scripts/browser/terrain-review.ts` reviews the land itself
(see the rendering section of [battle terrain](../assets/maps/terrain-notes.md#rendering)).

The coasts are surveyed elevation data, baked once per map into a 96 km square heightfield at 40 m
(`scripts/maps/bake-terrain.py`; framing, sources and attribution in the
[terrain notes](../assets/maps/terrain-notes.md)). `src/maps/heightfield.ts` decodes it and
`crates/naval-sim/src/terrain.rs` decodes the same bytes, with the same bilinear height and the same
deployment-clearance scan. A battle places the chart in its world (`PlacedTerrain`, world = chart +
offset): custom and online battles centre it between the default spawn lines (`customTerrainOffset`,
`[0, −spawnDistance / 2]`), missions on the mission area (`MISSION_TERRAIN_OFFSET`, `[0, 0]`). Every
chart keeps a clear lane for the default spawns at 1–20 km apart; a spawn is legal only with no land
sample within 300 m (`DEPLOYMENT_CLEARANCE_M`), which the deployment chart and the Rust battle both
check.

The page fetches a map's heightfield once (`loadMapTerrain`): choosing the waters in the battle dialog
starts it, and the deployment chart shows **Charting the coast…** and keeps Start disabled rather than
judging ships against open sea until it arrives. `Game` charts the map as the first loading stage of a
custom, fleet-command or online battle, before a session reads it. Sessions expose the placed terrain as
`BattleSession.terrain`; the rendered land (`createBattleLandscape`), camera clearance, rangefinder
sight lines and the charts all read it. The navigation and deployment charts draw the coastline and
relief bands above 100, 300, 600 and 1,000 m, traced from the heightfield by marching squares
(`src/maps/chartContours.ts`, cached per field).

## Reviewing the ocean in the real game

`bun scripts/browser/ocean-review.ts --tag <name>` renders the fixed scenes of
`/scripts/diagnostics/ocean-review.html` (port, near, wide, grazing, sun, storm, calm, dusk, night,
a real coast, 5 and 20 km zoom, air, submerged, periscope, a ninety-second wake, and wakes seen from 2 km
up after three minutes, close astern, through a turn, behind a destroyer and across the morning
glitter: `wakeAir`, `wakeStern`, `wakeTurn`, `wakeDestroyer`, `wakeGlint`) into
`.build/ocean-review/<name>/`; `--measure` adds serialised frame costs and `--param realism=off` renders
the look tuned to the replaced library. Compare a change against a baseline tag. Other GPU work on the
machine moves frame times by several milliseconds: compare shading costs by flipping
`game.ocean.realism` between `oceanReview.measure()` calls in one page and reading low percentiles. Every page above freezes waves with `game.ocean.time = seconds`; a paused frame never
advances it, and parameter changes still apply on the next update. Temporary captures belong in
ignored `.build/`.

## Reviewing the sky in the real game

`bun scripts/browser/sky-review.ts --tag <name>` renders the fixed scenes of
`/scripts/diagnostics/sky-review.html` (port, noon, wide, morning sun, sunset both ways, twilight, moon,
shafts, stars, a crescent night, a dusk crescent, zenith, clear, overcast, fog, storm, binoculars, an
aircraft in the cloud shell, the chart overhead and tilted, rain by day and night, lightning by night and
day) into `.build/sky-review/<name>/`. `--sky skypro` renders them with the comparison, `--clouds <tier>`
picks the tier, `--bench` times the sky's own update and meshes in frames alternating with frames
without them, `--frames` times whole frames, and `--scale 1.5` renders at the game's Retina pixel ratio,
where the frame is bound by the GPU rather than the CPU. The [sky's Budget](../src/game/sky/README.md#budget)
has the per-tier comparison with Sky Pro and why it is timed by wall clock rather than GPU timestamps.
Every sky part keeps a focused page under `scripts/diagnostics/sky-*.html`.

## Comparing with Sky Pro

The vendored Sky Pro 2.2.0 library the game's sky replaced can still draw the sky. The developer console
command "Switch sky renderer" flips the `skyRenderer` graphics setting (`game` or `skypro`, saved outside
the quality presets like `oceanRenderer`); in port the scene rebuilds at once, at sea it applies on the
return to port. `Game` then loads `src/game/comparison/SkyProSky.ts`, and with it the library's bundle,
as a separate chunk. The adapter keeps every setting the game gave Sky Pro: the partly cloudy preset
with the game's cloud lighting (base shadow 0.20, ambient 1.10, ground bounce (0.09, 0.105, 0.12)), the
1.4° discs, its moon ambient 0.07, the local horizon patch at **0.8** (see the
[Sky Pro patch record](../vendor/threejs-sky-pro/PATCHES.md) and the
[GPU horizon check](browser-verification.md#horizon-rendering-check), which needs this renderer), the
provider's moonlit fog term, and the sunrise-tinted scene light the game derived from its sun. It draws
no rain, lightning, shafts or cloud shadows, as before; a Water Pro sea takes either sky. The sky's
clean-room rule applies: never open the library's `index.js`.

## Comparing with Water Pro

The vendored Water Pro 3.5.1 library the game's ocean replaced can still draw the sea, to compare the
two in the real game. The developer console (Shift-D) command "Switch ocean renderer" flips the
`oceanRenderer` graphics setting (`game` or `waterpro`, saved with the other rows but outside the
quality presets): in port the scene rebuilds at once, at sea it applies on the return to port, like the
ocean tier. `Game` then loads `src/game/comparison/WaterProOcean.ts`, and with it the library's
bundle, as a separate chunk; the default game never downloads it. The adapter drives the library
through its declarations as the game did before the replacement, with the same scene values from
`VisualEnvironment`, translated where Water Pro measures them differently: the significant height
becomes the per-map FFT gain the game once measured, and crest foam (the calibration table's crest and
windward gains, a 2.8 s decay and 0.8 of the map's foam opacity), surface foam and the wake's breaking
slope take the values the game gave the library. The realism switches do not apply to it.
`bun scripts/browser/ocean-review.ts --tag <name> --param renderer=waterpro` renders the review
scenes with it. The clean-room rule in the ocean README applies: never open the library's `index.js`.
