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

Two wake generators sit 112 m forward and aft of the origin: bow depth/radius 2.8/11 m, stern 2.2/14 m. Wake foam strength is 1.25 and persistence 0.995. Buoyancy samples a 190 × 28 m footprint with 1.8 s smoothing and 0.45 rotation influence. These values were chosen for visually stable battleship motion, not hydrodynamic accuracy.

The demo's image-based sky is replaced by Sky Pro's animated clouds and atmosphere. That changes what the water reflects even if its material settings stay the same. Cloud reflections are baked at width 384 with 16 cloud march steps and 8 skipped frames. The game uses ACES tone mapping and neutral exposure; it does not add the demo's optional bloom or film grain.

## Daylight correction

The first pass used sun elevation 28°, sun peak intensity 3.2, environment lighting 0.55, and hemisphere fill 0.4, plus a blue HUD gradient reaching 79% opacity at the bottom. Their combined effect was too dark for daytime.

The corrected setup uses sun elevation 48°, sun intensity 6.6, environment lighting 1.0, hemisphere fill 0.65 with a lighter tint, and cloud-base shadow strength 0.60 instead of 0.88. The HUD shade is now confined to shorter edge regions (20% opacity at the top, 44% at the bottom), and hides with the instruments. Wave shape, foam, water colors, and fog remain as listed above.

## Repeating arc correction

The initial game used the deterministic wave seed `1941`. Water Pro 3.5.1 constructs its random-hash input as `float(cellIndex) + randomSeed * 100000`. At approximately 194,100,000, float32 values are spaced 16 units apart. The 65,536 cells in a 256² cascade therefore collapse to only 4,097 distinct hash inputs. Neighboring Fourier components acquire identical random phases, creating organized bands and curved wave packets. The periodic FFT tiles repeat those packets across the ocean; zooming out exposes the pattern.

This was reproduced at a fixed camera and ocean tick. Reading the actual GPU spectrum buffers found identical phases in about 93.7% of active neighboring coefficients across all three High-quality cascades. Changing only the seed to the library default `1` removed the sweeping arcs, with zero repeated neighboring phases in the same check. Wave shape controls, mesh detail, foam, wakes, lighting, and fog were held constant. The screenshot of the interactive demo does not establish its seed, but the supplied library defaults to `1`.

The game now explicitly uses `1`. This is a workaround for the library's float hash-input construction; it does not patch the vendor bundle or eliminate the underlying FFT tile periodicity. Before adding arbitrary multiplayer match seeds, the library needs integer-safe seed mixing on both WebGPU and WebGL. A numeric match ID should not be passed directly into this version's seed option.

The dev-only GPU regression harness is at `/scripts/diagnostics/ocean-spectrum.html` while `bun run dev` is running. It initializes the actual Game configuration, freezes the camera and ocean time, reads back the initial Fourier coefficients, and exposes `window.oceanDiagnostic.passed`. With the game seed it must pass; `?seed=1941` is the negative control and must fail. `?quality=medium` and `?quality=ultra` exercise the other supported cascade layouts. The diagnostic uses private buffer fields specific to Water Pro 3.5.1 and must be reviewed when upgrading that dependency. Vite's production build does not include this page.
