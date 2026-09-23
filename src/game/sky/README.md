# Sky

The game's own sky: atmosphere, sun and moon, stars, volumetric clouds, cloud shadows, sun shafts,
rain and lightning, and the environment the sea reflects. It replaced the vendored Sky Pro library
as the default; Sky Pro stays in `vendor/threejs-sky-pro/` behind the developer switch
**Switch sky renderer** (Graphics `skyRenderer`), lazily loaded through
`src/game/comparison/SkyProSky.ts`, so the two can be compared. The game renders only through
WebGPU (`src/game/webgpu.ts`).

The brief was not to copy Sky Pro but to look good: cinematic rather than calibrated. Physically
based scattering and cloud lighting underneath, graded for a rich golden hour and blue hour, silver
cloud edges, readable moonlit nights, and moody storms. Each Graphics → Clouds tier must cost no
more GPU time than Sky Pro's same tier on the same scene (see [Budget](#budget)).

## Clean-room rule

Sky Pro's license (`vendor/threejs-sky-pro/LICENSE.md` §3.6) forbids decompiling, deobfuscating or
otherwise reverse engineering its compiled bundle, and the repository is public. Nobody working on
this folder opens, reads, greps, diffs or pattern-matches `vendor/threejs-sky-pro/build/index.js`
(or the removed Water Pro bundle in any past revision), including through tools or subagents. Its
`.d.ts` declarations and `PATCHES.md` describe only the public API the comparison adapter calls.
Build from the game's own code, this document, three.js (`node_modules/three`), published literature
and black-box observation of the running game (captures, frame times). Code here must be original
work. Do not copy preset constants out of the vendor package; tune our own values against captures.

Useful literature: Hillaire, *A Scalable and Production Ready Sky and Atmosphere Rendering
Technique* (EGSR 2020) and *Physically Based Sky, Atmosphere and Cloud Rendering in Frostbite*
(SIGGRAPH 2016 course); Bruneton & Neyret, *Precomputed Atmospheric Scattering* (2008); Schneider &
Vos, *The Real-time Volumetric Cloudscapes of Horizon Zero Dawn* (SIGGRAPH 2015) and Schneider,
*Nubis: Authoring Real-Time Volumetric Cloudscapes* (2017) and *Nubis³* (2022/2023); Wrenninge et
al., *Oz: The Great and Volumetric* (multiple-scattering octaves, 2013); Mitchell, *Volumetric Light
Scattering as a Post-Process* (GPU Gems 3, 2007); Jensen et al., *A Physically-Based Night Sky
Model* (SIGGRAPH 2001); Tatarchuk, *Artist-Directable Real-Time Rain Rendering* (2006).

## Layout

| Path | Owns |
| --- | --- |
| `contracts.ts` | `SkyApi` (the facade both renderers implement), `SkyScene`, and the interfaces between parts. Change a contract before changing both sides. |
| `Sky.ts` | The game's facade: builds the parts, writes the shared uniforms, composes the dome and the post chain, computes the celestial light. |
| `uniforms.ts` | `SkyUniforms`: sun, moon, star frame, camera, time, wind drift, lightning. Written once per frame by the facade, read by every part. |
| `celestialModel.ts` | CPU model placing sun, moon and stars for the authored sun angles and moon phase. Renderer-free. |
| `quality.ts` | The four tiers: cloud march budget, bake sizes, shadow map, shaft samples, rain drops, stars. |
| `dome.ts` | The backdrop: sky + celestial bodies + cirrus, drawn behind everything opaque. |
| `atmosphere/` | Scattering LUTs, sky radiance, aerial perspective, sunlight colour at any altitude, cloud ambient. |
| `celestial/` | Sun disc, moon and its phase, stars, Milky Way, sun and moon shafts. |
| `clouds/` | Noise volumes, weather map, volumetric march, temporal reconstruction, composite, cirrus, cloud shadow map, rain shafts. |
| `weather/` | Near rain, splashes, lightning (bolts, flicker, cloud light, scene flash), thunder cue. |
| `environment/` | Equirectangular bake of dome and clouds, PMREM refresh, the ocean's `OceanSky` provider. |
| `stubs/` | A minimal implementation of every part, used until the real one lands and by tests. |

## Frame

`VisualEnvironment.update` calls `sky.update(dt)` once per frame before the ocean updates:

1. advances sky time and the cloud drift by `dt` (0 on a paused frame: nothing moves, but every
   pass still runs so captures converge);
2. writes the shared uniforms (camera, sun, moon, star frame, lightning);
3. updates the parts in order: atmosphere LUTs → celestial → weather → clouds (march, temporal
   resolve, shadow map) → environment bake (amortised over frames);
4. refreshes the celestial light the sea, scene light and effects share.

Then the scene renders in the game's single scene pass:

- opaque geometry (ships, islands);
- **dome** (`dome.ts`): a full-screen backdrop at the far plane, drawn only where nothing opaque
  is, last in the opaque queue;
- the **sea** (first in the transparent queue, order −30);
- the **cloud composite** (order −29): premultiplied cloud radiance, depth-tested at the clouds'
  own distance, so ships hide clouds, clouds hide the sea from above (chart, aircraft), and smoke,
  spray and rain blend over them;
- smoke, spray, rain streaks, bolts (order ≥ 0).

`sky.postProcess(scenePass, color)` then adds sun shafts and rain haze in linear radiance, after the
ocean's underwater pass and before the display grade (`DisplayTransform`: exposure, AgX, bloom).

## Units

Radiance is in the sea's units: the scene's `sun.intensity` (about 6 in daylight) is the sun's
irradiance above the atmosphere, and a sky pixel of radiance ~0.3–1.0 reads as daylight blue after
the display grade. Lengths are metres, angles degrees at the API and radians inside. World axes:
+Y up; compass azimuth 0 toward +Z, 90 toward +X (sunrise), 270 toward −X (sunset). The planet is
a sphere of radius 6,360 km whose surface is the sea at y = 0 under the camera.

## Parts

**Atmosphere** (`atmosphere/`). Hillaire 2020: transmittance LUT, multiple-scattering LUT and a
camera-centred sky-view LUT (non-linear in latitude, finest at the horizon), rebuilt when the sun,
parameters or camera altitude change. Rayleigh, Mie and ozone; the planet's shadow gives the
Earth-shadow band and Belt of Venus at twilight. Aerial perspective works for any direction and
distance (clouds and bakes), not only the frustum. The authored `rayleigh/turbidity/mie/mieG/
multiple` (Sky Pro's scale) map onto our coefficients through documented gains, tuned by eye.
Moonlight scatters through the same model at night, lifted for readability. The CPU keeps the
sunlight and moonlight colour at sea level (for the scene light) and the zenith sky irradiance.
Cinematic grading lives here too: the golden-hour sun and warm aureole, the blue hour's ozone blue.

**Celestial** (`celestial/`). Sun disc with limb darkening; moon disc with a procedural albedo
(maria, crater brightness), lit by the actual sun direction so its terminator matches the phase,
with faint earthshine; stars from a seeded catalog (magnitudes to about 6.5, blackbody colours,
denser along the galactic plane) drawn as tiny points with twinkle near the horizon; a procedural
Milky Way band with dust lanes. All radiance is above the atmosphere; the dome multiplies it by the
transmittance to space, so a low sun reddens and stars fade into the horizon haze and daylight on
their own. Screen-space shafts (Mitchell 2007) from the sun, or the moon at night, through cloud
gaps and past silhouettes, at reduced resolution.

**Clouds** (`clouds/`). A shell over the curved planet between the scene's base altitude and
base + thickness. Noise: a tiling Perlin–Worley base volume (128³) and a Worley detail volume
(32³), both filled by compute at startup, and a CPU-built weather map (36 km, drifting with the wind)
of rank-equalised coverage and storm-cell potentials, type variation, and the clear-air distance for
the scene's coverage. `model.ts` holds the renderer-free formulas (cover, cloud type from stratus to
cumulonimbus, height profiles), which the shaders compile and the tests check. Each frame the clouds
are one compute submission: a ray in every interleave block of a reduced-resolution buffer (IGN
jitter, clear air crossed in leaps the weather map's distances allow, strides and a step back at
cloud edges, early exit), the temporal reconstruction (every pixel reprojects its history by the
nearest rays' depth and the wind's drift, then blends in this frame's four nearest rays weighted by
distance: temporal upsampling, no block pattern), and a slice of the shadow map. A tier may update
only every few frames (`cloudUpdateInterval`, 1 on every tier today): the composite turns the last
update to the current view in between. After a cut every pixel is marched for two frames. Light: unrolled samples toward the sun (the moon at night)
with the nearest reading the detail, two far samples reading only the weather cover, multiple-scattering
octaves over a dual-lobe phase (silver linings), Beer–powder, and the atmosphere's ambient (sky above,
sea below, darkened toward bases by `baseShadow`); aerial perspective once per ray at the
transmittance-weighted mean depth; past the farthest cloud marched, a horizon bank in proportion to the
cover. The composite (order −29) sits at the far plane under the layer, where the depth test culls
the sea and ships before shading, and tests each pixel at the clouds' own depth from inside or above
the layer and in rain; it adds lightning's glow from `SkyUniforms.lightningPosition` (irradiance at
1 km, softened by the cloud around the channel). Cirrus is a 2D layer at 9 km drawn in the dome. The
cloud shadow map (40 km around the camera, laid out in the clouds' drifting frame so it follows the
wind exactly) is the sun's transmittance through the shell, read through a cubic B-spline by
`cloudShadow` for ships, islands and the sea. Under storm cells, while the scene rains, the march
first crosses the air below the base through slanted grey rain shafts. `look` and `erosion`
(uniforms in `march.ts` and `field.ts`) grade the lighting and shapes live.

**Weather** (`weather/`). Near-camera rain streaks in a box that wraps around the camera, slanted
by wind and stretched by camera motion; splashes on the sea near the camera; lightning strikes
(Poisson, located under rain cells) with a branching bolt, return-stroke flicker, interior cloud
light and a scene-wide flash; a thunder cue delayed by distance for the game's audio. Precipitation
and lightning come from the weather preset (`assets/maps/battle-conditions.v1.json`).

**Environment** (`environment/`). Equirectangular linear HDR bake from sea level under the camera
of dome, celestial bodies and clouds (a short march), refreshed in slices over several frames; the
PMREM follows by bumping `pmremVersion`. `scene.environment` is this texture (ships' image-based
light) and the sea reflects it through `OceanSky.createReflectionSampler`. The far fog colour
(`createFogSampler`) is the sky seen from the camera without discs, stars or clouds.

## Quality tiers

`quality.ts` owns the numbers; Graphics → Clouds picks the tier live.

| Tier | Cloud buffer | Marched per update | Updated | Steps / light | Shadow map | Bake | Shafts | Rain drops |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Low | ⅓ res | 1 of 16 | every frame | 40 / 3 | 512² | 256 × 128, 12 steps | 16 | 3,000 |
| Medium | ½ res | 1 of 16 | every frame | 64 / 4 | 1024² | 384 × 192, 16 steps | 24 | 8,000 |
| High | ½ res | 1 of 4 | every frame | 80 / 4 | 1024² | 512 × 256, 24 steps | 32 | 16,000 |
| Ultra | ½ res | 1 of 4 | every frame | 128 / 5 | 1024² | 768 × 384, 32 steps | 48 | 30,000 |

## Budget

Sky Pro's cost per tier is the ceiling. Measure with `bun scripts/browser/sky-review.ts --measure`
on the same scenes and tier with `--sky skypro` and `--sky game`, interleaved and repeated (the GPU
is shared; single runs are noisy). Sky Pro baselines: `.build/sky-review/skypro-*` (captured
2026-09-23 on the main checkout's hardware).

## Verification

`scripts/diagnostics/sky-review.html` renders 19 fixed scenes of the real game (port, noon, wide,
morning sun, sunset both ways, twilight, moon, stars, zenith, clear, overcast, fog, storm, 24×
binoculars, aircraft in the cloud shell, overhead and tilted chart). `bun scripts/browser/
sky-review.ts --tag <name> [--only a,b] [--quality high] [--clouds medium] [--sky game|skypro]
[--measure]` saves PNGs and timings to `.build/sky-review/<tag>/`. Every part also keeps a focused
diagnostics page under `scripts/diagnostics/sky-*.html`.
