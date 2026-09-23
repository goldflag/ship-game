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
| `environment/` | Equirectangular bake of dome, clouds and sea, prefiltered into three's CubeUV layout; the ocean's `OceanSky` provider. |
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
optical-depth reads, in-scattering the sky's own radiance along the ray in each channel's share of the
ray's extinction before the point, so distant clouds converge on the horizon in its colour and turn pale
blue on the way (`fromSea` gives the bake's viewpoint). Beyond 15 km, fair skies count distance at a
quarter (`AERIAL`, an art-directed scale that climbs back as the haze thickens: about 0.8 overcast, 1
in storm and fog), so a cumulus bank 60–120 km off still shows as hazed shapes through binoculars while
the dome keeps its golden-hour haze. Below the horizontal the dome holds the horizon's colour, which
also meets the sea's far fog seamlessly from altitude. Night: the moon scatters through the same tables as a second
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
sea below, darkened toward bases by `baseShadow`). The sun's light reaches the layer through a small table
filled each frame that carries the planet's shadow, so after sunset the tops catch pink and orange while the
shadow line climbs; below the horizon the afterglow lights the clouds from its side, and a twilight gain keeps
clouds in shadow deep blue-grey rather than black. Aerial perspective once per ray at the
transmittance-weighted mean depth; past the farthest cloud marched, a horizon bank in proportion to the
cover. The composite (order −29) sits at the far plane under the layer, where the depth test culls
the sea and ships before shading, and tests each pixel at the clouds' own depth from inside or above
the layer and in rain; it adds lightning's glow from `SkyUniforms.lightningPosition` (irradiance at
1 km, softened by the cloud around the channel), confined to the struck cell (about 2.2 at 0.5 km from the
channel, 0.7 at 1 km, 0.12 at 2 km), while the rest of the deck lifts by 0.6 × `SkyUniforms.flash`. Rain
shafts fade out between 8 and 22 km, lit partly by the sky behind them. Cirrus is a 2D layer at 9 km drawn in the dome,
lit from a 64² table of its light along each direction that the clouds' submission fills every frame
(so the dome reads no atmosphere tables for it); Low draws none. The cloud shadow map (40 km around the camera, laid out in the clouds' drifting frame so it follows the
wind exactly) is the sun's transmittance through the shell, read through a cubic B-spline by
`cloudShadow` for ships, islands and the sea. Under storm cells, while the scene rains, the march
first crosses the air below the base through slanted grey rain shafts. `look` and `erosion`
(uniforms in `march.ts` and `field.ts`) grade the lighting and shapes live.

**Weather** (`weather/`). Near-camera rain: instanced streaks in four nested boxes that wrap around
the camera (few, large near drops and many thin far ones), each drop its own size, fall speed and
brightness, slanted by the wind and streaked by the camera's own motion over an exposure. A drop shows a
blurred view of what lies behind it (mostly sky at or above the horizon, mostly sea below it), with
forward glints of the celestial light and flares toward a lightning strike; looking down along the fall
and from a high camera the streaks fade and shorten, so rain seen from the chase camera is a faint grey
haze, not a field of lines, and long streaks are held faint. Splashes (rings and crowns) ride the drawn
sea; a rain veil over distance (`postProcess`, a uniform branch that costs nothing dry) glows toward a
strike.
Lightning is a seeded Poisson process at `weather.lightning` per minute, 2–25 km away at random
bearings (half cloud-to-ground, an occasional close one), with 2–4 return strokes, a branching bolt
from the cloud base to the sea, the cloud light (`lightningPosition/Intensity`: irradiance
`intensity × (1 km / r)²` in the sea's units, 40 at a stroke's peak) and the scene flash; a thunder
cue delayed by distance for the game's procedural thunder (`GameAudio.thunder`). Precipitation and
lightning come from the weather preset (`src/maps/precipitation.ts`) and the developer console.

**Environment** (`environment/`). Equirectangular linear HDR bake (RGBA16F, the tier's width) from sea
level under the camera: the dome (sky, celestial bodies without the sun's disc and stars, cirrus) with the
clouds' short march over it above the horizon, and below it the sea as ships see it from above (the sky
mirrored with water's Fresnel over the dark water body). A sweep bakes the sky in four horizontal bands,
one every fourth frame, the last also taking the sea's half, then prefilters the bake into three's PMREM
(CubeUV) layout itself, once per 16 frames. The prefilter keeps three's layout and Gaussian chain but not
its GGX importance sampling (512 samples per texel at every level, about 7 ms of GPU per refilter on the
development machine, a spike every sweep): about 0.6 ms, for reflections nobody can tell apart. A change
of sun or light, or a jump of the origin by 2 km, re-bakes and prefilters it whole at once.
`scene.environment` is the prefiltered texture (ships' image-based light) and the sea reflects it through
`pmremTexture`, which reads it as it is. The far fog colour (`createFogSampler`) is the sky seen from the
camera without discs, stars or clouds.

## Quality tiers

`quality.ts` owns the numbers; Graphics → Clouds picks the tier live.

| Tier | Cloud buffer | Marched per update | Updated | Steps / light | Shadow map | Cirrus | Bake | Shafts | Rain drops |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Low | ⅓ res | 1 of 16 | every frame | 40 / 3 | 512² | none | 256 × 128, 12 steps | 16 | 3,000 |
| Medium | ½ res | 1 of 16 | every frame | 64 / 4 | 1024² | yes | 384 × 192, 16 steps | 24 | 8,000 |
| High | ½ res | 1 of 4 | every frame | 80 / 4 | 1024² | yes | 512 × 256, 24 steps | 32 | 12,000 |
| Ultra | ½ res | 1 of 4 | every frame | 128 / 5 | 1024² | yes | 768 × 384, 32 steps | 48 | 20,000 |

## Budget

Sky Pro's cost per tier is the ceiling. Measured 2026-09-23 on an Apple M5 Pro (headed Chromium, the
High preset with each Clouds tier, 1600 × 900 at the game's 1.5 pixel ratio), milliseconds per frame,
means over noon, sunset, overcast, storm and binoculars and two sessions per sky:

| Clouds tier | Sky's own work: Sky Pro | Game sky | Whole frame: Sky Pro | Game sky |
| --- | --- | --- | --- | --- |
| Low | 0.19 | 0.22 | 6.94 | 6.77 |
| Medium | 0.41 | 0.27 | 7.38 | 7.09 |
| High | 0.77 | 0.28 | 7.81 | 7.02 |
| Ultra | 0.84 | 0.29 | 7.72 | 7.05 |

The game sky's figures include its cloud shadows, stars, shafts and weather, which Sky Pro never drew.
To repeat, alternate the skies over at least two sessions each:

    bun scripts/browser/sky-review.ts --tag <sky>-<tier> --sky game|skypro --clouds <tier> --scale 1.5 \
      --only noon,sunset,overcast,storm,binoculars --bench --frames

- `--bench` (`benchmarkSky`): the sky's own update and meshes, from frames with them alternating with
  frames without, each serialised by waiting for the GPU and timed by wall clock. The pairing cancels
  the drift between sessions. The post passes (shafts, rain veil) and the sea's sky lookups run in
  both kinds of frame.
- `--frames` (`wallFrames`): whole frames with everything, which vary by about half a millisecond
  between sessions (the GPU is shared with the rest of the machine).
- `--scale 1.5`: the pixel ratio the game renders at on a Retina display. At 1 the frame is partly
  CPU-bound: the sky's compute, submitted early, runs while the CPU encodes the rest of the frame,
  and wall-clock timing misses it.
- GPU timestamps (`--clock gpu`, `--parts`) leave the CPU out, but on Apple GPUs a pass that waits on
  the frame's scene reads as busy for the whole wait: the shafts, which sample the scene, read 6 ms
  and cost nothing by wall clock. Use them for shares within one sky, not to compare skies. They
  also agree on the direction (Sky Pro 0.50 / 1.18 / 1.77 / 1.85 ms per tier, the game sky 0.47 /
  0.39 / 0.28 / 0.49).

## Verification

`scripts/diagnostics/sky-review.html` renders the fixed scenes of the real game (port, noon, wide,
morning sun, sunset both ways, twilight, moon, a low sun behind the ship's tower, stars, a crescent
night with the Milky Way's core over the sea, a dusk crescent, zenith, clear, overcast, fog, storm,
24× binoculars, aircraft in the cloud shell, overhead and tilted chart, a daylight downpour from the
bridge, moonlit rain, and a seeded cloud-to-ground bolt by night and by day). `bun scripts/browser/
sky-review.ts --tag <name> [--only a,b] [--quality high] [--clouds medium] [--sky game|skypro]
[--scale 1.5] [--frames] [--bench] [--weather]` saves PNGs and timings to `.build/sky-review/<tag>/`; `--weather`
times the rain and splashes by GPU timestamps, each drawn at several times its capacity in frames
alternating with none. Timing a mesh means drawing the scene pass again: it renders once per node
frame, which only the browser's animation frames advance, so the page's `redraw()` advances it
before every timed frame. Every part also keeps a focused diagnostics page under
`scripts/diagnostics/sky-*.html` (`sky-celestial.html`: the Milky Way band, the moon's phases
through glasses and the sun; `sky-atmosphere.html`: sun sweeps, per-map skies and haze).
