# Ocean configuration

The water starts from Water Pro 3.5.1's `blackFlag` preset. Sky Pro 2.2.0 supplies the live sky and reflections using its `partlyCloudy` preset. Configuration is in `src/game/Game.ts`; the defaults below refer to the shipped Black Flag preset, not any particular state of the interactive demo.

The initial direction was a relatively restrained sea viewed from a camera hundreds of meters away, with a 250.5-meter ship as the scale reference. These are first-pass artistic and gameplay settings, not measurements or a calibrated North Atlantic sea state.

| Water parameter | Black Flag preset | Default game (Atlantic) | Intent |
| --- | --- | --- | --- |
| FFT amplitude multiplier | 1 | 0.75 | Reduce wave displacement for introductory sailing. This is not a wave height in meters. |
| Wind speed | 15 | 9 | Lower wind-driven wave energy. |
| Peak wavelength | 47 m | 65 m | Emphasize longer swells beside a large hull. |
| Choppiness | 1.5 | 1.05 | Reduce sharp, horizontally displaced crests. |
| Surface foam opacity | 0.30 | 0.13 | Less persistent white texture across the surface. |
| Wave foam opacity | 0.60 | 0.45 | Retain whitecaps with less visual noise. |
| Water fog fade | 300–1,210 m | 2,500–16,000 m | Longer sightlines for the distant chase camera and eventual naval encounters. |
| Fog sky-blend distance | 700 m | 10,000 m | Move the sky-color transition farther out. |
| Water grid | Base 200 m, 5 levels | Base 256 m, 6 levels | Larger extent around the moving camera. |
| Ocean floor | Visible, depth 8 m | Hidden; configured depth 200 m | An open sea without a visible shallow seabed. |
| Spray / underwater particles | Enabled | Disabled | Omit extra particle effects from this first sailing build. |

Base water colors remain the Black Flag colors: `waterColor #224659`, `transmissionColor #226755`, `absorptionColor #945b57`. The 1,024 m largest FFT tile, spectrum settings, foam textures, and Fresnel parameters are inherited. High water quality is the default, including the third ripple cascade and screen-space reflections.

Fair mode uses amplitude 0.35, wind 5, wavelength 65 m. Heavy uses amplitude 1.4, wind 16, wavelength 100 m. All three currently share the same daylight/cloud setup; they change the sea, not the weather system.

Two wake generators sit 112 m forward and aft of the origin; their current configuration is described under **Ship wake** below. Buoyancy samples a 190 × 28 m footprint with 1.8 s smoothing and 0.45 rotation influence. These values were chosen for visually stable battleship motion, not hydrodynamic accuracy.

The demo's image-based sky is replaced by Sky Pro's animated clouds and atmosphere. That changes what the water reflects even if its material settings stay the same. Cloud reflections are baked at width 384 with 16 cloud march steps and 8 skipped frames. The game uses ACES tone mapping and neutral exposure; it does not add the demo's optional bloom or film grain.

## Ship wake

`src/game/ShipWake.ts` combines Water Pro's wave displacement with the foam history in `src/game/WakeFoam.ts`. Both are sampled by the actual water material, so foam follows the ocean's displacement, lighting and bubble texture. There is no floating decal or flat plane above the sea.

The displacement field covers **1,536 × 1,536 m**, centered on the ship through a dedicated downward-facing anchor camera. Moving the viewing camera cannot discard or reposition the existing trail. The selected quality's cell count stays unchanged (Medium 256², High 512², Ultra 1024²); the smaller extent improves spatial detail over the previous 2,048 m field without increasing the solve cost.

The bow radius is **10 m** and the stern radius is **14 m**, with full-speed displacement depths of **0.32 m** and **0.18 m**. Depth scales with squared speed, and the emitters switch off below 0.1 m/s. Friction is **0.065**, allowing the disturbance to spread outward; native foam strength is limited to **1.2** and the breaking threshold is **0.09**. The native foam uses `exp(-dt / 9)` decay. These are visual tuning values rather than a calibrated hydrodynamic model.

Foam history records a position, heading, speed and birth time every **3 m** of travel. Three stern streams merge and widen with age, while bow-shoulder foam moves sideways from the recorded course. Old samples keep their original heading through turns. Coverage decays over **23 seconds**, with a smooth cutoff at **55 seconds**, and slow world-space turbulence breaks up the outline. The water material's foam texture dissolves the remaining patches. Emission follows motion and reverses its trailing end when sailing astern.

The foam coverage texture updates at most **20 times per second**, at 256² on Medium and 512² on High/Ultra. Overlapping samples use maximum coverage rather than additive buildup. Distance-based samples and interpolated birth times keep density consistent across rendering frame rates. Stopping leaves existing foam to spread and fade; returning to port clears both foam and displacement.

Pausing switches the ocean to fixed-step mode with zero elapsed time, allowing rendering without stepping its wake integrators. This avoids Water Pro's host-clock `update(0)` continuing to extrapolate wake heights and decay foam while paused. Unpausing restores the host clock.

The dev-only `/scripts/diagnostics/ship-wake.html` page runs the actual Game frame loop with controlled input and clock, then reads the native WebGPU wake buffers and foam coverage texture. It checks no wake at rest, foam 150 m behind the stern, widening with age, bounded displacement, retention through turns and camera orbit, exact field preservation while paused, fading after stopping, and clearing on return to port. Results are exposed as `window.wakeDiagnostic`; `?quality=medium` or `?quality=ultra` select the other field resolutions. Private buffer inspection is specific to Water Pro 3.5.1. The field currently follows the single player; a fleet implementation will need to choose shared field coverage for the ships in view.

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

## Repeating arc correction

The initial game used the deterministic wave seed `1941`. Water Pro 3.5.1 constructs its random-hash input as `float(cellIndex) + randomSeed * 100000`. At approximately 194,100,000, float32 values are spaced 16 units apart. The 65,536 cells in a 256² cascade therefore collapse to only 4,097 distinct hash inputs. Neighboring Fourier components acquire identical random phases, creating organized bands and curved wave packets. The periodic FFT tiles repeat those packets across the ocean; zooming out exposes the pattern.

This was reproduced at a fixed camera and ocean tick. Reading the actual GPU spectrum buffers found identical phases in about 93.7% of active neighboring coefficients across all three High-quality cascades. Changing only the seed to the library default `1` removed the sweeping arcs, with zero repeated neighboring phases in the same check. Wave shape controls, mesh detail, foam, wakes, lighting, and fog were held constant. The screenshot of the interactive demo does not establish its seed, but the supplied library defaults to `1`.

The game now explicitly uses `1`. This is a workaround for the library's float hash-input construction; it does not patch the vendor bundle or eliminate the underlying FFT tile periodicity. Before adding arbitrary multiplayer match seeds, the library needs integer-safe seed mixing on both WebGPU and WebGL. A numeric match ID should not be passed directly into this version's seed option.

The dev-only GPU regression harness is at `/scripts/diagnostics/ocean-spectrum.html` while `bun run dev` is running. It initializes the actual Game configuration, freezes the camera and ocean time, reads back the initial Fourier coefficients, and exposes `window.oceanDiagnostic.passed`. With the game seed it must pass; `?seed=1941` is the negative control and must fail. `?quality=medium` and `?quality=ultra` exercise the other supported cascade layouts. The diagnostic uses private buffer fields specific to Water Pro 3.5.1 and must be reviewed when upgrading that dependency. Vite's production build does not include this page.
