# Ocean configuration

The water starts from Water Pro 3.5.1's `blackFlag` preset. Sky Pro 2.2.0 supplies the live sky and reflections using its `partlyCloudy` preset. Configuration is in `src/game/Game.ts`; the defaults below refer to the shipped Black Flag preset, not any particular state of the interactive demo.

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

`src/maps/seaCalibration.ts` separates significant height in metres from the
Water Pro FFT amplitude multiplier. The latter was fitted against native GPU
height samples at two wave times, then checked at a third time and intermediate
wind speeds. Gains are specific to Water Pro 3.5.1, seed 1, spectral sharpness 0.8,
JONSWAP gamma 2.6 and the current cascade layout. The fit uses
`Hm0 = 4 × standard deviation`, the [NOAA spectral-height definition](https://www.ndbc.noaa.gov/faq/wavecalc.shtml).
Recalibrate after changing the spectrum, seed or cascade layout. Calibration adds
no GPU readback or normalization work to the normal game loop.

The production check sampled 6,144 heights per case across 39 High-quality
wind/map combinations, including intermediate winds: every measured height was
within 2% of its target. Medium and Ultra also stayed within 1% at 6, 9, 25 and
30 m/s in the Atlantic. Low retains its single cascade and omits short waves;
its measured height was 13% below target at 6 m/s and 5% below at 9 m/s, then
within 2% at 25 and 30 m/s. Keep that quality tradeoff explicit when comparing.

The selected natural-ocean treatment uses broader waves at moderate winds,
with a smaller wavelength multiplier at high winds. Wind
speed changes the native foam injection gains as well as the waves. Whitecaps
start earlier, while the high-wind gains decrease to retain dark water between
breakers. The 2.8 s foam decay, 0.8 Atlantic wave-foam opacity, 0.08 maximum surface
foam opacity and native bubble textures remain fixed. Foam is an artistic choice;
the flatter high-wind coverage is not a calibrated whitecap-fraction model.

Map height multipliers remain 1.0 Atlantic, 0.65 Pacific, 0.6 Arctic and 1.05 Indian;
each has its own measured FFT gain to account for its wavelength scale. Numeric
wind bypasses the map wind multiplier; legacy presets first resolve that wind
multiplier, then enter the same calibration curve. Cloud cover remains independent
of wave energy. Port restores amplitude 0.12, wind 4 m/s, peak wavelength 14 m,
choppiness 0.65, gamma 2.2 and the original sheltered foam settings.

CPU combat receives the same significant height through `src/game/session/sea.ts`
and `crates/naval-sim/src/environment.rs`, using the shared content manifest.
Its two sine components have weights 0.7/0.3, so their envelope amplitude is
`Hs / (4 × sqrt((0.7² + 0.3²) / 2))`. This replaces interpreting the FFT gain as
metres. The CPU retains its coarse four-times-peak-wavelength envelope and seeded
phase; GPU detail never supplies combat poses, collision or flooding samples.
The two surfaces share height statistics, not exact phases or a hydrodynamic model.

Run `bun run water:calibration` to open the development-only
`/scripts/diagnostics/ocean-calibration.html` page. Wind spans the full 0–30 m/s
battle range; the map selector exercises sheltered maps. **Measure height** samples
6,144 points over three wave times with the actual Game/Water Pro pipeline. Use
`?wind=9&map=north-atlantic&quality=high` to restore a case; `low`, `medium` and
`ultra` are also available. The Bismarck hull stays fixed as a size reference.
Playback renders once per frame; screenshots are explicit. Temporary evidence
belongs in ignored `.build/`. To refit an anchor, measure it, multiply its FFT gain
by `target / measured`, then repeat the measurement and check neighboring speeds.

## Water appearance and rendering

The Atlantic palette remains `waterColor #19364a`, `transmissionColor #355166`,
and `absorptionColor #945b57`. The four maps retain their deep-blue family and
the Pacific's small green shift. The 1,024 m largest FFT tile, foam textures,
Fresnel parameters and quality-tier cascade counts are unchanged. High remains
the default, including its third ripple cascade and screen-space reflections.
Calibration adds no geometry, render passes or particles; altered slopes can
still change fragment-shader work. See the [palette comparison](../assets/reviews/water-palette/README.md).

Water fog fades from 2,500 to 16,000 m with a 10,000 m sky blend. The grid retains
its 256 m base and six levels; the ocean floor is hidden at configured depth 200 m.
Spray and underwater particles remain disabled. Air operations expands the existing
flat horizon ring for the map camera; it reuses that mesh on subsequent visits.

## Current port light and horizon

Port sun peak intensity is **5.8** and hemisphere fill **1.75**, lifting shaded hulls and harbor buildings. Exposure remains **1**, with the existing sun angles and restrained forward scattering.

The additional horizon softening introduced with the naval-blue palette has been reverted. Sky and water use their existing Sky Pro / Water Pro shading, with the sky preset's original cloud fade distances. Battle fog uses power **1.4** and the complete authored sky-color blend distance for the selected map/weather. Port fog retains power **0.85** and a **2,600 m** sky-color blend distance. The custom horizon veil, cool-color sampler overrides and water-surface haze blend are removed; no depth-based post-fog is added.

The naval-blue palette retains spectral sharpness 0.8. Battle waves now follow the calibrated wind curve above; port keeps the original restrained tuning. The following correction sections also record earlier iterations and their evidence.

The vendored Fresnel shader's grazing-angle guard is reduced from 0.05 to 0.0001. The old guard gave shallow wave slopes identical reflectance, turning distant water into a flat color that was conspicuous at 24×. The smaller positive guard preserves wave shading at naval sight angles; texture filtering already follows the camera projection. It adds no wave samples, mesh detail or render passes. Pixel filtering and weather haze still soften the far horizon. See the [water detail review](../assets/reviews/water-detail/README.md) and [vendor patch record](../vendor/threejs-water-pro/PATCHES.md).

### Submerged camera visibility

Black Flag's custom absorption coefficients remove over 99% of green/blue scene light along a 50 m underwater column, making the VIIC disappear at ordinary chase distances. `VisualEnvironment.update` (called from `Game.frame`) now scales those coefficients from their original values to 5% using a smooth transition as the camera moves from sea level to 2 m below it. This gives the underwater view 20 times the absorption distance while retaining the blue water color and distant haze. It is a gameplay visibility adjustment, not measured Atlantic water clarity.

The game shows submerged hulls and terrain through the surface using an undistorted scene sample, attenuated by the water column depth. Surface refraction and animated underwater distortion remain disabled; submerged cameras retain their unwarped view and underwater fog. Straight-through visibility reuses the opaque scene capture and the surface fragment's depth, so it does not require the separate surface water-depth pass or transparent-effect capture. That depth pass still runs for underwater fog. Sky reflections, FFT cascades, foam and wakes retain their quality settings. See the [vendor patch](../vendor/threejs-water-pro/PATCHES.md#straight-through-surface-visibility). If a diagnostic re-enables distortion, its intensity still eases to 15% below the surface using the saved preset value.

The original linear RGB coefficients are saved once after loading the preset. Each frame derives its values from that copy, so repeated dives cannot accumulate the adjustment. Surface, tactical and above-water periscope cameras restore the original coefficients. The change uses Water Pro's public color uniforms; simulation depth, waves and the vendored shader remain separate.

The dev-only `/scripts/diagnostics/underwater-visibility.html?test` runs the actual `Game.frame` and GPU water pipeline at 7, 50 and 150 m. It compares visible-hull pixels with the same view without the hull, and checks surface/periscope restoration. `window.visibilityResult.passed` must be true. Add `&legacy` to restore the old coefficients as a negative control; its dive checks must fail. See the [before/after evidence](../assets/reviews/underwater-visibility/README.md).

Custom battle uses independent time-of-day, cloud-cover and wind-speed sliders.
Wind is in m/s and drives the calibrated sea above; cloud cover changes sky coverage
without changing wave energy. Legacy presets retain their wind speeds (Clear/Fog
5 m/s, Map default/Partly cloudy 9 m/s, Overcast 12 m/s, Storm clouds 16 m/s), then
apply the map wind multiplier. Their old amplitude and wavelength entries have been
replaced by the shared calibration. Scene transitions restore the complete battle
or sheltered-port spectrum and foam settings. The [weather/sea consolidation review](../assets/maps/review/weather-seas/README.md)
records the previous small-wave iteration.

Nearby ships receive bow and stern wake generators scaled to their hull; their configuration is described under **Ship wake** below. Buoyancy samples a 190 × 28 m footprint with 1.8 s smoothing and 0.45 rotation influence. These values were chosen for visually stable battleship motion, not hydrodynamic accuracy.

Funnel exhaust, gun and impact smoke, burning-turret smoke and falling-aircraft trails use the ocean's wind direction and weather-adjusted speed. Direction is in radians from +X toward +Z; visual drift uses 35% of ocean wind speed with each particle's existing response factor. Returning to port restores the sheltered wind (speed 4, direction 35°). The renderer-free sea model also uses this weather wind to drive gradual ship leeway. CPU waves add hull motion and heading-dependent resistance; shell flight still omits aerodynamic wind drift. See [the runtime contract](ship-runtime-contract.md#blueprint-and-simulation-contract).

The demo's image-based sky is replaced by Sky Pro's animated clouds and atmosphere. That changes what the water reflects even if its material settings stay the same. Cloud reflections are baked at width 384 with 16 cloud march steps and 8 skipped frames. The game uses ACES tone mapping and neutral exposure; it does not add the demo's optional bloom or film grain.

Water Pro's `scene.fogNode` owns distance fog, including transparent effects and the ocean's sky-color blend. The final composition uses Water Pro's output directly, without Sky Pro's additional `applyTo` fog pass: that pass reads opaque depth behind transparent smoke and can erase it at the ocean horizon. Sky Pro still supplies the sky, clouds, lighting and reflections. See the [horizon regression review](../assets/effects/naval/reports/validation.md#horizon-smoke-cutoff-2026-09-05).

The game requests reversed depth for centimeter-scale ship details at long battle ranges. Three.js gives the main scene pass a floating-point depth attachment, retaining the 0.5 m battle near plane and 60 km far plane. Sky Pro 2.2.0's sky and cirrus background shaders require their constant far-depth value to match the active backend (0 for reversed depth, 1 otherwise); volumetric clouds already project their hit distance through the camera. Water and smoke use Three.js's depth conversion nodes, which account for reversed depth. See the [distant ship depth review](../assets/reviews/ship-depth/README.md) for the GPU regression fixture and matching 24× captures.

## Zoomed ship reflections and shadows

Above 1.5× magnification in battle, `WaterViewFocus` selects the visible hull nearest
the center of the rendered view. Its range extends water reflection rays to twice
the camera-to-hull distance, capped at the camera far plane. The existing sun/moon
shadow map follows that hull with its original size and resolution. Returning to
an ordinary view, the air map or port restores the normal reflection range and
shadow anchor. Selection is independent of combat targeting and works while paused.

High and Ultra retain screen-space ship reflections; Medium keeps them disabled.
The water shader clips reflection rays to the viewport, refines geometry hits more
precisely and uses full-float reflection depth to avoid distant speckling. Screen-space
reflections still omit offscreen geometry and break up with wave slopes. This extends
the reflected ship silhouette on water and the ship's own sun/moon shading.

The displaced water surface also receives ship shadows from that same directional
shadow map. `WaterShadows` binds its depth texture after the scene renders
and adds no shadow map or caster pass. Graphics → Water shadows applies live:
Off removes water shadow sampling, Low uses one comparison, Medium uses four,
and High uses the original nine-tap soft filter. Overall Low/Medium/High/Ultra
presets choose Off/Low/High/High respectively; saved settings retain the choice.
A shader branch skips those texture reads outside the shadow camera's bounds;
each enabled quality only filters water inside those bounds.
Shadows attenuate the lit water color, subsurface scattering, glints and foam while retaining ambient fill
and sky reflections. They follow the active sun/moon and the existing local or
zoomed hull anchor; ships outside that map's 760 m footprint do not cast water
shadows. The Shadows setting controls map resolution for both hull and water shadows;
its Off option overrides Water shadows without losing the selected water quality.
Off stops shadow-map rendering and sets its intensity to zero; an already
allocated map is retained so cached scene-capture programs can safely reuse it
when shadows are enabled again.

The dev fixture `/scripts/diagnostics/water-shadows.html?test` compares frozen
frames with only water shadow reception disabled/enabled, checks restoration and
all four live water quality levels and global Off/Low/High settings, and exposes `window.shadowResult.passed`. Add `&calm`
for a flat sea or `&webgl` for the fallback backend. WebGL capture uses the
direct scene draw because this review host returns an empty post-process
framebuffer; that check covers water shading, not the final composition.
Temporary captures belong in `.build/`.

The development fixture `/scripts/diagnostics/water-reflections.html?test` compares
the old range against zoomed coverage at 5 km and 20 km, then checks restoration.
Use `&calm` for a mirror comparison or `&webgl` for the fallback renderer. It exposes
`window.reflectionResult.passed` and `reflectionReview.still()` for inspected images.
Temporary captures belong in `.build/`. See the [vendor patch](../vendor/threejs-water-pro/PATCHES.md#naval-range-ship-reflections).

## Ship wake

`src/game/ShipWake.ts` combines Water Pro's wave displacement with independent per-ship foam histories in `src/game/WakeFoam.ts`, packed into one shared texture by `src/game/FleetWakeFoam.ts`. Both are sampled by the actual water material, so foam follows the ocean's displacement, lighting and bubble texture. There is no floating decal or flat plane above the sea.

The displacement field covers **1,536 × 1,536 m**, centered on the player through a dedicated downward-facing anchor camera. Moving the viewing camera cannot discard or reposition the existing trail. The selected quality's cell count stays unchanged (Medium 256², High 512², Ultra 1024²); the smaller extent improves spatial detail over the previous 2,048 m field without increasing the solve cost.

The native solver supports **16 generators**, allocated to the nearest eight hulls in its local field. Bow/stern offsets are ±44.8% of hull length; radii are 28% and 39% of beam (about **10 m** and **14 m** for Bismarck), with full-speed displacement depths of **0.32 m** and **0.18 m**. Depth scales with squared speed, and the emitters switch off below 0.1 m/s. Friction is **0.065**, allowing the disturbance to spread outward; native foam strength is limited to **1.2** and the breaking threshold is **0.09**. The native foam uses `exp(-dt / 9)` decay. These are visual tuning values rather than a calibrated hydrodynamic model.

Foam history records a position, heading, speed and birth time every **3 m** of travel. Three stern streams merge and widen with age, while bow-shoulder foam moves sideways from the recorded course. Old samples keep their original heading through turns. Coverage decays over **23 seconds**, with a smooth cutoff at **55 seconds**, and slow world-space turbulence breaks up the outline. The water material's foam texture dissolves the remaining patches. Emission follows motion and reverses its trailing end when sailing astern.

Each ship has its own **1,536 m** foam field at **256²**, updated at most **20 times per second**. An **8 × 8 atlas** keeps one GPU texture binding and supports the full 60-ship battle; distant ships retain local trail resolution independently of the player’s displacement field. The shader checks tile bounds before sampling and combines overlapping ship fields with maximum coverage. Hull length and beam determine the foam emission positions and initial width; speed is normalized to each ship’s handling definition. Submergence fades emission to zero at 3 m below the surfaced origin. Overlapping samples use maximum coverage rather than additive buildup. Distance-based samples and interpolated birth times keep density consistent across rendering frame rates. Stopping leaves existing foam to spread and fade; returning to port clears both foam and displacement.

Pausing switches the ocean to fixed-step mode with zero elapsed time, allowing rendering without stepping its wake integrators. This avoids Water Pro's host-clock `update(0)` continuing to extrapolate wake heights and decay foam while paused. Unpausing restores the host clock.

The dev-only `/scripts/diagnostics/ship-wake.html` page runs the actual Game frame loop with controlled input and clock, then reads the native WebGPU wake buffers and foam coverage texture. It checks no wake at rest, foam 150 m behind the stern, widening with age, bounded displacement, retention through turns and camera orbit, exact field preservation while paused, fading after stopping, and clearing on return to port. Results are exposed as `window.wakeDiagnostic`; `?quality=medium` or `?quality=ultra` select the other field resolutions. Private buffer inspection is specific to Water Pro 3.5.1. Fleet regression tests additionally cover 60 independent trails, a stopped player, submerged ships, per-ship teleports, tile reassignment, the native generator limit, fleet replacement, and port cleanup.

## Night and sunrise lighting

The numeric time slider now blends the authored night, dawn/dusk and map fog
colors by solar elevation. The original implementation changed the sun position
but retained the map's daytime fog. Hemisphere fill retains 50% of the map/weather
daylight setting at night and reaches full strength at 18° elevation. This keeps
ship details readable while preserving a darker sea and sky.

`VisualEnvironment.syncLighting` (`src/game/VisualEnvironment.ts`) supplies the same active celestial light to Water Pro's
shader uniforms, its scene directional light and combat effects. It runs after
Sky Pro updates and after Water Pro resynchronizes its provider light, including
paused frames. Moonlight fades near the horizon; the low sun receives a warmer
tint and reduced direct intensity, reaching the original daylight at 18°.

Moon ambient is 0.07 with tint `#b4c9f0`. The custom water and foam colors use 24%
of their original linear radiance at night, reaching 100% at 18°; each application
starts from the original map/Black Flag swatches. Absorption and wave energy are
unchanged. Port restores its original colors, fill and direct light.

Cloud ambient gain remains 1.1 × weather scale because Sky Pro already attenuates
the incoming solar radiance. Its shared cloud baker and aerial haze now include
lunar diffuse light; its night composite preserves premultiplied color when
adjusting opacity. These [vendor patches](../vendor/threejs-sky-pro/PATCHES.md)
also apply to water reflections. They add no render passes or cloud march samples.
The settings are artistic gameplay lighting, not a geographic or calibrated
astronomical model. See the [fixed-camera review](../assets/reviews/night-lighting/README.md).

## Daylight correction

The first pass used sun elevation 28°, sun peak intensity 3.2, environment lighting 0.55, and hemisphere fill 0.4, plus a blue HUD gradient reaching 79% opacity at the bottom. Their combined effect was too dark for daytime.

The corrected setup uses sun elevation 48°, sun intensity 6.6, environment lighting 1.0, hemisphere fill 0.65 with a lighter tint, and cloud-base shadow strength 0.60 instead of 0.88. The HUD shade is now confined to shorter edge regions (20% opacity at the top, 44% at the bottom), and hides with the instruments. Wave shape, foam, water colors, and fog remain as listed above.

## Cloud fill correction

The cloud undersides remained too dark after the first daylight pass. Sky Pro's cloud volumes use their own lighting calculation; increasing the scene's hemisphere light does not illuminate them. The inherited `partlyCloudy` preset supplies ambient intensity 0.7 and very dark ground-bounce albedo (approximately 0.0091, 0.0152, 0.0185 in linear RGB), while the game still applied base-shadow strength 0.60.

The current cloud lighting uses base-shadow strength **0.20**, ambient intensity **1.10**, and ground-bounce albedo **(0.09, 0.105, 0.12)** in linear RGB. This is an artistic fill adjustment for brighter daylight cloud bases, not a measured ocean reflectance. It retains a cool gray underside and brighter sunlit edges. The water reflects the brighter cloud lighting through the existing SkyProvider. The change was checked in the WebGPU scene with the same camera, including the normal sailing view.

## Softer daylight and scattered clouds

The port sky still read as dark slate blue. The current tuning reduces molecular blue scattering, broadens aerosol scattering, and increases diffuse sky fill. Port sun intensity rises from 3.8 to 5; the sea keeps its 6.6 intensity. Exposure remains 1. These are visual settings, not a calibrated atmosphere.

| Sky parameter | Port before → after | Sea before → after |
| --- | --- | --- |
| Rayleigh | 0.9 → 0.42 | 0.41 → 0.38 |
| Turbidity | 3.2 → 3.2 | 1 → 2.2 |
| Mie scattering strength | 0.65 → 1.2 | 0.19 → 0.5 |
| Mie directional G | 0.8 → 0.6 | 0.8 → 0.72 |
| Sky multiple scattering | 0.66 → 1.4 | 0.66 → 1 |
| Cloud coverage control | 0.48 → 0.38 | 0.64 → 0.40 |

Both scenes use cloud thickness 2,400 m (previously 3,200 m), altitude 1,700 m, and horizon coverage boost 0.06 (previously 0.12). Coverage is a nonlinear shape control, not a percentage of visible sky. Cloud fill, water material, sun direction, and harbor fog retain their existing settings. Scene transitions restore all scene-specific sky parameters.

The [before/after review](../assets/reviews/sky-daylight/index.html) contains unedited 1,600 × 900 WebGPU canvas captures from the actual Game renderer. Each pair shares its camera and frozen animation time; the review notes describe the capture setup.

## Port sun glare correction

The broader aerosol scattering above made the sun-facing port view pale and washed out, including its water reflections. A fixed-camera comparison isolated the forward sun haze: reducing only port `mieScatteringStrength` from **1.2 to 0.25** restored visible clouds and water color. The sea remains at **0.5**. Sun intensity, exposure, diffuse sky fill, cloud settings, fog and water materials retain their previous values, keeping the shaded hull readable and the normal harbor view close to the accepted daylight direction.

The [port glare review](../assets/reviews/port-glare/README.md) records matching sun-facing and normal-port captures from the actual WebGPU renderer. Review both directions when changing atmospheric scattering; the normal port camera faces away from the sun and missed this regression.

## Repeating arc correction

The initial game used the deterministic wave seed `1941`. Water Pro 3.5.1 constructs its random-hash input as `float(cellIndex) + randomSeed * 100000`. At approximately 194,100,000, float32 values are spaced 16 units apart. The 65,536 cells in a 256² cascade therefore collapse to only 4,097 distinct hash inputs. Neighboring Fourier components acquire identical random phases, creating organized bands and curved wave packets. The periodic FFT tiles repeat those packets across the ocean; zooming out exposes the pattern.

This was reproduced at a fixed camera and ocean tick. Reading the actual GPU spectrum buffers found identical phases in about 93.7% of active neighboring coefficients across all three High-quality cascades. Changing only the seed to the library default `1` removed the sweeping arcs, with zero repeated neighboring phases in the same check. Wave shape controls, mesh detail, foam, wakes, lighting, and fog were held constant. The screenshot of the interactive demo does not establish its seed, but the supplied library defaults to `1`.

The game now explicitly uses `1`. This is a workaround for the library's float hash-input construction; it does not patch the vendor bundle or eliminate the underlying FFT tile periodicity. Before adding arbitrary multiplayer match seeds, the library needs integer-safe seed mixing on both WebGPU and WebGL. A numeric match ID should not be passed directly into this version's seed option.

The dev-only GPU regression harness is at `/scripts/diagnostics/ocean-spectrum.html` while `bun run dev` is running. It initializes the actual Game configuration, freezes the camera and ocean time, reads back the initial Fourier coefficients, and exposes `window.oceanDiagnostic.passed`. With the game seed it must pass; `?seed=1941` is the negative control and must fail. `?quality=medium` and `?quality=ultra` exercise the other supported cascade layouts. The diagnostic uses private buffer fields specific to Water Pro 3.5.1 and must be reviewed when upgrading that dependency. Vite's production build does not include this page.

## Smaller wave scale

The September 5 scale adjustment reduces Atlantic peak wavelength from 65 to 28 m, amplitude from 0.75 to 0.45, and choppiness from 1.05 to 0.8. Fair, Heavy, and port conditions receive the same artistic direction while retaining their relative intensity. Ship geometry, cameras, water colors and CPU combat are unchanged. See the [matching before/after views](../assets/reviews/ocean-scale/index.html).

## World ocean maps

Custom battle’s **Battle conditions** combines time-of-day and weather selections. Each weather preset also sets wave amplitude, wind speed and peak wavelength, replacing the separate Sea conditions control in battle setup and Settings. Original presets live in `assets/maps/battle-conditions.v1.json`; the renderer-free `src/maps/conditions.ts` resolver applies the map’s water multipliers to the weather’s waves and layers weather over its sky/fog, then applies time-of-day sun angles, ambient scaling and twilight/night fog tint. Omitted selections and **Map default** retain existing map values. These are fixed artistic lighting presets, not geographic solar calculations. Dawn, Morning, Noon, Dusk and Night remain fixed during play; Clear, Partly cloudy, Overcast, Fog and Storm clouds control cloud coverage, altitude, fill, wind and distance haze. Old saved sea preferences are ignored; graphics settings store only quality and render scale. Storm clouds do not include precipitation or lightning, and visual visibility does not alter CPU bot acquisition or ballistics.

`VisualEnvironment.setScene` applies the composed uniforms and freezes Sky Pro’s celestial clock on an arc matching the authored sun direction, keeping the full moon opposite the sun. Night retains low ambient fill for readable silhouettes and uses a dark fog tint. The provider’s sun-only fog sampler receives the same lunar ambient term as the sky dome, faded in with sky darkness; this prevents the distant fog blend from painting the night backdrop black. The water light’s shadow anchor follows the active sun/moon direction, with a restrained lunar directional fill at night. Returning to port restores cloud fill, cloud wind, horizon coverage, sun, atmospheric scattering and fog alongside the existing sheltered sea. Setup choices survive returns to port for the current page session. `Game.diagnostics()` exposes the selections and applied lighting for in-game review. See the [setup and environment review](../assets/maps/review/battle-conditions/README.md).

Versioned map definitions live in `assets/maps/environments.v1.json`, consumed through `src/maps/catalog.ts`. Select a map, time of day and weather in Custom battle. These selections survive repeated battles during the current page session.

Each map supplies custom water/absorption/transmission colors, wave and wind multipliers, wave-foam opacity, sun elevation/azimuth/intensity, cloud coverage/altitude/thickness, atmospheric scattering and fog. Weather presets retain the small-wave direction and multiply each map's wave scales. The port restores all overridden shader parameters on return, including color, cloud height and foam. Quality tiers retain their normal cascade layouts; map selection does not rebuild the water system.

The [illustrated map guide](../assets/maps/review/index.html) records the four settings and their actual rendered views. These are independently authored, region-inspired gameplay landscapes, not surveyed coastlines or calibrated regional weather.

Coastal maps widen a central clear lane according to the largest fleet, then place islands relative to the midpoint of the two spawn lines. The shared CPU island-height function drives the rendered mesh, chart outline, camera clearance, projectile contact and conservative hull clearance. Bots blend an outward course near shores. Land contact removes inward ship motion without grounding damage; full bathymetry, tides, beaching, route planning and terrain blast propagation are outside this first map implementation. Shells can fly over high ground and stop on it; torpedoes stop at submerged coastal slopes. Ground impacts currently reuse the small hard-surface impact effect.

Original island recipes and capture scripts stay under `assets/maps/`. The renderer uses eroded heightfields with asymmetric ridges and connected drainage valleys, triplanar rock and vegetation textures, slope-dependent snow and rock, and clustered tree impostors. See the [terrain recipe and review notes](../assets/maps/terrain-notes.md). Terrain meshes are generated at launch and disposed when switching maps. The rendered land surface is a finite tessellation of the continuous CPU height function, so very close grazing contacts remain approximate. No ship model assets or CPU wave poses are changed.
