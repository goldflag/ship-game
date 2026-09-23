# Ocean configuration

The sea is the game's own WebGPU ocean in `src/game/ocean`. Its design, parts, quality tiers and
validation are in [its README](../src/game/ocean/README.md); this page records the configuration the
game gives it. Sky Pro 2.2.0 supplies the live sky, clouds and atmosphere, and the environment the
water reflects.

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
swell. The peak wavelengths and wave periods remain visual/gameplay choices.

`src/maps/seaCalibration.ts` turns wind into significant height and peak wavelength in metres,
choppiness (0.65, rising to 1.55 between 3 and 15 m/s) and the crest and windward foam gains.
`VisualEnvironment` writes them to `ocean.waves` with JONSWAP γ 2.6; `Game` keeps directional
sharpness at 0.8, whose broader spread breaks parallel ripples into small crossing waves. The ocean
normalises its spectrum so that 4 × the standard deviation of the rendered surface equals
`significantHeight` (Hm0, the [NOAA spectral-height definition](https://www.ndbc.noaa.gov/faq/wavecalc.shtml)),
so no renderer-specific gain is fitted and the table needs no recalibration when the spectrum or its
cascades change. `window.reviewWaves()` on `/scripts/diagnostics/helm-optics.html` reads GPU heights
back around the hull at four wave times and reports 4 × RMS beside the requested height.

Wind speed also changes foam: whitecaps start earlier, and the high-wind gains decrease to retain dark
water between breakers. Crest foam decays over 2.8 s with opacity 0.8 × the map's foam value / 0.45
(0.8 in the Atlantic) and a 0.5 wind stretch. Surface foam is wind streaks: none up to 10 m/s, rising
to opacity 0.15 over 5% of the sea by 25 m/s. Foam is an artistic choice; the flatter high-wind coverage
is not a calibrated whitecap-fraction model.

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
The two surfaces share height statistics, not exact phases or a hydrodynamic model.

## Water colour

The selected **A · Steel blue** palette uses `waterColor #2d373c` and `transmissionColor #49575e`
across all four maps and the port, a muted, cool blue-gray. Absorption is map-specific (Atlantic
`#945b57`, Pacific `#b67b45`, Arctic `#916d59`, Indian `#a97851`) and the port inherits the Atlantic
swatches. The pigment and foam are emitted radiance: `VisualEnvironment` scales them for night (see
below), always starting from the original map swatches. The sky's environment lights every material
at intensity 1.

Reflectance keeps a 1e-4 grazing guard rather than 0.05, so distant wave slopes keep distinct
reflectance under 24× binoculars instead of turning into one flat colour. Submerged hulls and terrain
show straight through the surface: the opaque scene at the same screen position, attenuated by
`exp(−absorption × column)` and filled with the pigment, with no refraction offset.

## Fog

`ocean.fog` becomes `scene.fogNode` for every fogged material, including transparent effects: a ramp
from `start` to `end` raised to `power`, whose colour turns into the sky's own fog colour along the
view ray over `skyBlendDistance`. Sky backdrops are not fogged. The final composition adds no Sky Pro
`applyTo` fog pass: that pass reads opaque depth behind transparent smoke and can erase it at the
horizon.

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
breaking into speckle. Screen-space reflections still omit offscreen geometry.

The displaced surface also receives ship shadows from the same directional shadow map.
`src/game/WaterShadows.ts` builds a receiver node from the light's depth texture and binds it with
`ocean.setShadowNode`; it adds no shadow map or caster pass. Graphics → Water shadows applies live: Off
removes the sampling, Low uses one comparison, Medium four and High a nine-tap soft filter. The
Low/Medium/High/Ultra presets choose Off/Low/High/High. A shader branch skips the texture reads
outside the shadow camera's bounds. Shadows attenuate the lit terms (sun specular and glints,
subsurface light and foam); the ambient pigment keeps 45% in full shadow and the sky reflection is
unshadowed. They follow the active sun or moon and the local or zoomed hull anchor; ships outside the
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
  `window.reflectionResult.passed`.

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
during turns, which keeps foam attached to the stern even when the ship's centre moves slowly. Three
stern streams merge and widen with age, while bow-shoulder foam moves sideways from the recorded
course. Old samples keep their original heading through turns. Coverage decays over **23 seconds**,
with a smooth cutoff at **55 seconds**, and slow world-space turbulence breaks up the outline.
Emission follows motion, reverses its trailing end when sailing astern, fades to nothing 3 m below the
surface and restarts after a move of over 100 m. Shell splashes and aircraft crashes add short-lived
foam rings. For constructed ships, emitters use the compiled hull-volume bounds and their local
centre, so the authoring origin need not be amidships.

Each ship has its own **1,536 m** foam field (the tier's wake resolution up to 256², 128² on Low),
refreshed at most **20 times per second**, or 5 times when the hull is more than 2.5 km away in
apparent distance. An **8 × 8 atlas** keeps one texture binding for up to 64 trails; a larger battle
keeps the focus hull and the trails nearest to it. `WakeFoamGpu` paints the stamps into the atlas on
the GPU with max blending; overlapping samples use maximum coverage rather than additive buildup.

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
  retention through a turn, fading after the engines stop and clearing in port.
  `window.wakeDiagnostic.passed` must be true; `?quality=` selects the tier.
- `/scripts/diagnostics/wake-foam-gpu.html` compares the GPU atlas with the CPU reference raster
  (`src/game/testing/wakeFoam.ts`), both raw coverage and the world-space sampler the water uses,
  through turns, pause, teleport, tile reassignment and reset. `window.result.passed` must be true;
  comparing a manually flipped readback alone would miss an upside-down atlas.
- `/scripts/diagnostics/torpedo-trail.html` lays synthetic torpedo runs through the real track layer
  for review captures (`trailFixture(degrees, depth, seconds, turnAt, view)`).
- Unit tests cover 60 independent trails, a stopped player, submerged ships, per-ship teleports, tile
  reassignment, the generator limit, fleet replacement and port cleanup.

### Bow waves

`src/game/BowWaves.ts` draws each moving hull's bow wave analytically in the hull's own frame and joins the same wake sampler: its height adds to the vertex displacement, its slope to the surface normal and its white water to the foam by maximum coverage. Crests therefore stay sharp at any range, which the wake field's 3 m cells cannot. The eight nearest moving, surfaced hulls to the camera are drawn; speed is the displayed speed smoothed over 2.5 s, submergence fades it out and going astern draws none.

- **Stem crest.** A crest climbs the stem, peels away from a fine-entrance waterline at `crestAngle` (tan, 0.18) and has a trough inboard of it, over a broad rise around the stem. Its height is 0.3 × U²/2g, scaled by beam and capped at 4 m (about 2.8 m for Bismarck at 26.6 kn). White water covers the stem and rides just outboard of the crest, then trails aft and spreads, with broken water along the forward hull side.
- **Kelvin V.** The closed-form stationary-phase solution for a point source carries a transverse and a divergent system inside the 19.47° cusp. It uses an Airy-style cusp limit and an e^(−kd) source depth of a quarter beam. Its slope is the wave vector, so normals need no finite differences. The amplitude (1.6 × U²/2g × √(beam/length)) is exaggerated so the V reads in a 9 m/s sea. In calm water the curved transverse crests and both arms show in the sky reflection. Divergent crests break into feathered dashes near the cusp. `kelvinSystems` is the CPU reference, tested against the brute-force Kelvin integral.
- **Turns.** The V is laid along the arc the stem has run, using track curvature measured from each hull's heading change per metre, so it follows the curved stern trail instead of swinging with the bow. The crest and hull-side wash stay in the straight hull frame.
- **Resolution.** Displaced features must span four water-mesh vertices (the clipmap rings double from 4 m on High), so they do not crawl as the hull crosses the grid. Normals and foam must span five pixels, stretched by the grazing angle, so distant crests fade rather than shimmer.

While the layer is on, trails stop painting their bow-shoulder stamps; the stern streams are unchanged. The developer console's **Toggle bow waves** compares against the wake field alone, and `game.shipWake.bowWaves.tuning` retunes the shape live. Measured on the previous ocean with vsync off at 1728×1030 on an Apple GPU, switching the layer off and on every 0.6 s over 20 rounds, it added about 0.2 ms per frame with one hull in view and 0.8–1.2 ms with eight hulls whose wakes fill the view; cost grows with the water pixels inside wakes. The CPU update takes under 1 µs per frame. These are visual tuning values, not a hydrodynamic model.

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

`VisualEnvironment.syncLighting` supplies the same active celestial light to the ocean (`ocean.sun`:
direction, intensity and colour), the scene's directional light and its shadows, and combat effects,
including on paused frames. Moonlight fades near the horizon; the low sun receives a warmer tint and
reduced direct intensity, reaching the full daylight at 18°.

Moon ambient is 0.07 with tint `#b4c9f0`. The water pigment, transmission and foam use 24% of their
original linear radiance at night, reaching 100% at 18°. Absorption and wave energy are unchanged.
Port restores its original colours, fill and direct light.

Cloud ambient gain remains 1.1 × weather scale because Sky Pro already attenuates the incoming solar
radiance. Its shared cloud baker and aerial haze include lunar diffuse light; its night composite
preserves premultiplied colour when adjusting opacity. These
[Sky Pro patches](../vendor/threejs-sky-pro/PATCHES.md) also reach the water's reflections. They add
no render passes or cloud march samples. The settings are artistic gameplay lighting, not a
geographic or calibrated astronomical model.

`/scripts/diagnostics/night-lighting.html` (`reviewLighting(hours, options)`) checks that the ocean
and the scene light carry the same intensity, and that a battle night has the night fog colour and
lunar cloud fill.

## Sky and atmosphere

Sky Pro's animated clouds and atmosphere are what the water reflects. Its environment bake follows
Graphics → Clouds (for example 384 px wide with 16 cloud march steps at Medium) and refreshes every
ninth frame. The game uses ACES tone mapping and neutral exposure, without bloom or film grain.

The game requests reversed depth for centimetre-scale ship details at long battle ranges. Three.js
gives the main scene pass a floating-point depth attachment, retaining the 0.5 m battle near plane and
60 km far plane. Sky Pro 2.2.0's sky and cirrus background shaders need their constant far-depth value
to match (0 for reversed depth); volumetric clouds already project their hit distance through the
camera. The ocean and smoke use Three.js's depth conversion nodes, which account for reversed depth.

### Port light and horizon

Port sun peak intensity is **5.8** and hemisphere fill **1.75**, lifting shaded hulls and harbor
buildings. Exposure remains **1**, with the existing sun angles and restrained forward scattering.
Battle fog uses power **1.4** and the complete authored sky-colour blend distance for the selected
map/weather; port fog uses power **0.85** and a **2,600 m** blend. There is no custom horizon veil and
no depth-based post fog.

Sky Pro's atmospheric march uses a **0.8** correction toward midpoint attenuation near the daylight
horizon, lifting the dark strip caused by its long sampling segments. The correction tapers to zero at
**6°** view elevation and fades out between **18° and 6°** solar elevation. The upper sky, authored
scattering colours, exposure, dusk and night keep their values. Reflections and far-fog sky colour
share the correction; see the
[Sky Pro patch record](../vendor/threejs-sky-pro/PATCHES.md#daylight-horizon-attenuation--september-20-2026)
and the [GPU regression check](browser-verification.md#horizon-rendering-check).

### Daylight

The Atlantic's daytime setup uses sun elevation 48°, sun intensity 6.6, environment lighting 1.0 and
hemisphere fill 0.65 with a light tint; the other maps author their own sun, fill and sky. The HUD shade is confined to short edge regions (20% opacity at the top,
44% at the bottom) and hides with the instruments.

Sky Pro's cloud volumes use their own lighting; the scene's hemisphere light does not reach them. The
cloud lighting uses base-shadow strength **0.20**, ambient intensity **1.10** and ground-bounce albedo
**(0.09, 0.105, 0.12)** in linear RGB, an artistic fill for bright daylight cloud bases with a cool
gray underside and brighter sunlit edges. The water reflects that lighting through the sky provider.

The sky scattering is tuned away from a dark slate blue: less molecular blue scattering, broader
aerosol scattering and more diffuse sky fill. These are visual settings, not a calibrated atmosphere.

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
Mie strength, preserving their relative haze, and draws both discs at 1.4° (`CELESTIAL_DISC` 7.5e-5;
the real discs are 0.53°). Raising `mieG` concentrated the same light into a hotter core, and a
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
clouds control cloud coverage, altitude, fill, wind and distance haze. Storm clouds do not include
precipitation or lightning, and visual visibility does not alter CPU bot acquisition or ballistics.

`VisualEnvironment.setScene` applies the composed conditions and freezes Sky Pro's celestial clock on
an arc matching the authored sun direction, keeping the full moon opposite the sun. Night retains low
ambient fill for readable silhouettes and uses a dark fog tint. The provider's sun-only fog sampler
receives the same lunar ambient term as the sky dome, faded in with sky darkness, so the distant fog
blend does not paint the night backdrop black. The shadow anchor follows the active sun or moon, with
a restrained lunar directional fill at night. Returning to port restores cloud fill, horizon coverage,
sun, atmospheric scattering and fog alongside the harbor's 9 m/s sea. Setup choices survive returns
to port for the current page session. `Game.diagnostics()` exposes the selections and applied
lighting.

Versioned map definitions live in `assets/maps/environments.v1.json`, consumed through
`src/maps/catalog.ts`. Each map supplies water, absorption and transmission colours, wave and wind
multipliers, wave-foam opacity, sun elevation, azimuth and intensity, cloud coverage, altitude and
thickness, atmospheric scattering and fog. Map selection does not rebuild the ocean; the port restores
every overridden parameter on return. `/scripts/diagnostics/ocean-maps.html` (`reviewMap(id, weather)`,
`reviewLandform(index, overview)`) captures each map in a paused battle.

The map scripts under `assets/maps/` rebuild an illustrated guide of the four settings from real
captures into ignored `.build/reviews/maps/`. These are independently authored, region-inspired
gameplay landscapes, not surveyed coastlines or calibrated regional weather.

Coastal maps widen a central clear lane according to the largest fleet, then place islands relative to
the midpoint of the two spawn lines. The shared CPU island-height function drives the rendered mesh,
chart outline, camera clearance, projectile contact and conservative hull clearance; the ocean draws
shoreline foam where the water column is shallow. Bots blend an outward course near shores. Land
contact removes inward ship motion without grounding damage; full bathymetry, tides, beaching, route
planning and terrain blast propagation are outside this first map implementation. Shells can fly over
high ground and stop on it; torpedoes stop at submerged coastal slopes. Ground impacts currently reuse
the small hard-surface impact effect.

Original island recipes and capture scripts stay under `assets/maps/`. The renderer uses eroded
heightfields with asymmetric ridges and connected drainage valleys, triplanar rock and vegetation
textures, slope-dependent snow and rock, and clustered tree impostors. See the
[terrain recipe and review notes](../assets/maps/terrain-notes.md). Terrain meshes are generated at
launch and disposed when switching maps. The rendered land surface is a finite tessellation of the
continuous CPU height function, so very close grazing contacts remain approximate.

## Reviewing the ocean in the real game

`bun scripts/browser/ocean-review.ts --tag <name>` renders the fixed scenes of
`/scripts/diagnostics/ocean-review.html` (port, near, wide, grazing, sun, storm, calm, dusk, night,
islands, 5 and 20 km zoom, air, submerged, periscope and a ninety-second wake) into
`.build/ocean-review/<name>/`; `--measure` adds serialised frame costs. Compare a change against a
baseline tag. Every page above freezes waves with `game.ocean.time = seconds`; a paused frame never
advances it, and parameter changes still apply on the next update. Temporary captures belong in
ignored `.build/`.

## Comparing with Water Pro

The vendored Water Pro 3.5.1 library the game's ocean replaced can still draw the sea, to compare the
two in the real game. The developer console (Shift-D) command "Switch ocean renderer" flips the
`oceanRenderer` graphics setting (`game` or `waterpro`, saved with the other rows but outside the
quality presets): in port the scene rebuilds at once, at sea it applies on the return to port, like the
ocean tier. `Game` then loads `src/game/comparison/WaterProOcean.ts`, and with it the library's
bundle, as a separate chunk; the default game never downloads it. The adapter drives the library
through its declarations as the game did before the replacement, with the same scene values from
`VisualEnvironment`, translated where Water Pro measures them differently: the significant height
becomes the per-map FFT gain the game once measured, and surface foam and the wake's breaking slope
take the values the game gave the library. The realism switches do not apply to it.
`bun scripts/browser/ocean-review.ts --tag <name> --param renderer=waterpro` renders the review
scenes with it. The clean-room rule in the ocean README applies: never open the library's `index.js`.
