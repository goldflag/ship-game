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
- the **sea** (first in the transparent queue, order −30; it writes depth);
- **dome** (`dome.ts`, order −29.5): a full-screen backdrop at the far plane, drawn only where
  nothing else has, so it shades just the visible sky (none of it from the chart's height);
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

**Atmosphere** (`atmosphere/`). Hillaire 2020 over a 6,360 km planet with air to 6,460 km:
Rayleigh, Mie (a grey maritime aerosol, 1.2 km scale height) and an ozone tent at 25 km, in km and per
km (`model.ts` holds the profiles, the CPU side and the grade; `luts.ts` the passes; `Atmosphere.ts`
the part). Tables, all fragment passes into small render targets:

- optical depth to the top of the air (256 × 64, float32, Bruneton's parameterisation), so any
  transmittance, including a segment's, is one or two reads;
- multiple scattering (32 × 32), integrated one direction per texel of a 256² target and then summed,
  which keeps the GPU full;
- the sky view, an atlas of four 192 × 108 sections (sun and moon seen from the camera, then from sea
  level for the bake), latitude squared toward the horizon and longitude toward the light. Each holds
  Rayleigh with its phase plus all multiple scattering, and the aerosol's single scattering without its
  phase: the aureole's lobe (the authored Cornette–Shanks lobe plus a narrow forward core) is applied
  per pixel, so it stays crisp;
- ambient light by altitude (64 texels to 16 km, above and below), for the clouds.

The optical depth and multiple scattering rebuild when the air changes, the sky view and ambient when
the sun or moon do, and the camera's sections when its altitude moves by 2% (5 m near the sea); a
steady camera costs no passes. Aerial perspective is a closed form, not a table: transmittance from two
optical-depth reads, in-scattering the sky's own radiance along the ray in the share of the ray's
extinction before the point, so distant clouds converge on the horizon in its colour (`fromSea` gives
the bake's viewpoint). Below the horizontal the dome holds the horizon's colour, which also meets the
sea's far fog seamlessly from altitude. Night: the moon scatters through the same tables as a second
light at `SKY_GRADE.moon` of its lifted irradiance, over a navy floor (airglow and starlight) that keeps
the sky off black; the moonlit horizon sits near the battle night fog `#182839`. Twilight: the sky's
exposure lifts as the sun sets (`TWILIGHT`, about ×3.5 at sunset to ×600 by −10°, applied also to
`sunTransmittance` and the ambient light), so the afterglow, the Earth's shadow and Belt of Venus and
the ozone blue hour stay visible; ozone's red absorption is raised toward a broadband red channel's so
the blue hour is blue, not magenta. The grade (`SKY_GRADE`): a gain over physics, a chroma lift, a
luminance shoulder that keeps the glare round a low sun under the display's bloom threshold (and golden
rather than bleached through AgX), and half a display level of dither against 8-bit banding at night.
Authored `rayleigh` scales the molecules by a root and the dome's chroma by another (the maps author it
as how blue the sky is), `turbidity` sets the aerosol (thickening toward the fog preset), `mie` the
aureole, `mieG` its lobe and `multiple` the multiple scattering. The CPU derives the scene light from
the same optical depths: the physical colour of the sun at the sea, softened, on the high sun's tint, and
never dimmer than the game's readability ramp; the moon as the stub had it; and the sky's irradiance.

**Celestial** (`celestial/`). Sun disc with limb darkening; moon disc with a procedural albedo
(maria, crater brightness), lit by the actual sun direction so its terminator matches the phase,
with faint earthshine; stars from a seeded catalog (magnitudes to about 6.5, blackbody colours,
denser along the galactic plane) drawn as tiny points with twinkle near the horizon; a procedural
Milky Way band with dust lanes. All radiance is above the atmosphere; the dome multiplies it by the
transmittance to space, so a low sun reddens and stars fade into the horizon haze and daylight on
their own. Screen-space shafts (Mitchell 2007) from the sun, or the moon at night, through cloud
gaps and past silhouettes, at reduced resolution.

**Clouds** (`clouds/`). A shell over the curved planet between the scene's base altitude and
base + thickness. GPU-generated noise: a tiling Perlin–Worley base volume and a Worley detail
volume, a 2D weather map (coverage, cloud type, precipitation) drifting with the wind and
remapped by `coverage` with the horizon lift. Density erodes the base shape at the edges; cloud
types run from flat stratus to towering cumulonimbus. Ray march at reduced resolution with
blue-noise jitter and an interleaved pixel pattern, empty-space skipping and early exit; light
march toward the sun (and moon) with Beer–powder, a dual-lobe phase function with a silver lining,
multiple-scattering octaves, and sky-coloured ambient from above with sea bounce from below;
lightning lights the interior from `SkyUniforms.lightningPosition`. Temporal reconstruction
reprojects by the clouds' mean depth. The composite upsamples to full resolution. Cirrus is a
2D layer high above, drawn in the dome. The cloud shadow map (top-down, around the camera) is the
sun transmittance through the shell, sampled by `cloudShadow` for ships, islands, the sea and
smoke. Under rain cells the march continues below the base through grey rain shafts.

**Weather** (`weather/`). Near-camera rain streaks in a box that wraps around the camera, slanted
by wind and stretched by camera motion; splashes on the sea near the camera; lightning strikes
(Poisson, located under rain cells) with a branching bolt, return-stroke flicker, interior cloud
light and a scene-wide flash; a thunder cue delayed by distance for the game's audio. Precipitation
and lightning come from the weather preset (`assets/maps/battle-conditions.v1.json`).

**Environment** (`environment/`). Equirectangular linear HDR bake (RGBA16F, the tier's width) from sea
level under the camera: the dome (sky, celestial bodies without the sun's disc and stars, cirrus) with the
clouds' short march over it, the clouds skipped below the horizon. A sweep bakes the sky in four
horizontal bands, one every fourth frame, the last also taking the cheap half below the horizon, and
bumps `needsPMREMUpdate` once finished: three's PMREM (about 0.07 ms on the development machine)
refilters once per 16 frames. A change of sun or light, or a jump of the origin by 2 km, re-bakes it
whole at once. `scene.environment` is this texture (ships' image-based light) and the sea reflects it
through PMREM. The far fog colour (`createFogSampler`) is the sky seen from the camera without discs,
stars or clouds.

## Quality tiers

`quality.ts` owns the numbers; Graphics → Clouds picks the tier live.

| Tier | Cloud buffer | Marched per frame | Steps / light | Shadow map | Bake | Shafts | Rain drops |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Low | ¼ res | 1 of 4 | 48 / 4 | 128² | 256 × 128, 12 steps | 16 | 3,000 |
| Medium | ½ res | 1 of 4 | 64 / 5 | 256² | 384 × 192, 16 steps | 24 | 8,000 |
| High | ½ res | 1 of 4 | 96 / 6 | 512² | 512 × 256, 24 steps | 32 | 16,000 |
| Ultra | ½ res | 1 of 4 | 128 / 6 | 512² | 768 × 384, 32 steps | 48 | 30,000 |

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
