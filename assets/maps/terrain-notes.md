# Battle terrain

Every battle map with land is a real place where a naval battle was fought, reproduced from surveyed
elevation data. The North Atlantic stays open sea.

| Map | Real place | Battle | Chart up (true bearing) |
| --- | --- | --- | --- |
| Iron Bottom Sound | Savo Island to Lunga Point, Guadalcanal | Savo Island, 9 Aug 1942; Guadalcanal, 13–15 Nov 1942 | 315° (Savo at the top) |
| Vestfjord | Inner Vestfjord, between Lofoten/Hinnøya and Hamarøy | Action off Lofoten, 9 Apr 1940; Narvik, 10 and 13 Apr 1940 | 75° (up-fjord toward Narvik) |
| Sunda Strait | Off St. Nicholas Point and Bantam Bay, Java | Sunda Strait, 28 Feb – 1 Mar 1942 | 295° (the strait at the top) |
| Strait of Dover | Mid-strait off Cap Gris-Nez | Channel Dash, 12 Feb 1942 | 45° (the North Sea at the top) |

## Framing

A chart is a 96 km square in the game's frame (x east of the chart centre, z toward the chart's bottom). Its
recipe, `charts/<id>.json`, names the centre's latitude and longitude and the true bearing of the chart's top.
The centre is the midpoint between the fleets' default spawn lines; team a starts toward the bottom and team b
toward the top, so the bearing points the battle axis along the real approach: the sound between Savo and
Lunga, the fjord toward Narvik, the coast toward Bantam Bay, the strait toward the North Sea.

The layouts follow War Thunder's naval minimaps: a battle square of open water with the fleets entering from
opposite edges and coast or islands on the flanks for cover. Every framing was chosen by a search over centres
and bearings that keeps a clear lane (no land within the rectangle |x| ≤ 3.3 km, |z| ≤ 10.8 km, so default
spawns from 1 to 20 km apart are legal), at least 90 % water in the mission deployment bands (|x| ≤ 5 km,
7 ≤ |z| ≤ 17 km), and as much coast as possible within 12–25 km. The bake prints these figures in
`.build/maps/<id>-report.json` beside a shaded-relief preview with the lane, spawn lines and mission circle.

## Baking

```sh
python3 scripts/maps/bake-terrain.py --all          # or one or more map ids
```

The script needs Python 3 with numpy and Pillow, and curl. It downloads AWS Terrain Tiles (Terrarium encoding,
`s3://elevation-tiles-prod`) into the ignored `.build/maps/dem-cache/`, then for every 40 m sample of the chart
projects the chart position onto the sphere (azimuthal equidistant about the centre, rotated by the bearing),
averages 2 × 2 bilinear DEM samples and writes `public/maps/terrain/<id>.ntf`. Commit the `.ntf` files; runtime
never downloads elevation data.

Cleaning: survey spikes (samples standing more than 60 m plus the local spread above the median of their
9 × 9 neighbourhood: radar voids and blunders, never real summits or cliffs, which have a wide spread around them)
are replaced by that median; land is above 0.5 m; DEM specks under three samples are dropped, and water that cannot reach the
open sea (polders behind dikes, paddies, river flats the DEM flattened) becomes lowland. Land stands at least 1 m above the sea. The sea floor is synthetic, 2.5 m at the coast
deepening 0.12 m per metre offshore to 160 m, because the global bathymetry in the tiles is far coarser than
the coast. The outer 6 km of the chart settles below the sea (to −60 m, the depth beyond the chart), so the
world ends in open water instead of a cut mountain.

## Format (NTF1)

Little-endian: the bytes `NTF1`; u32 columns (along +x) and rows (along +z); f32 cell size, origin x and origin
z (chart metres of sample (0, 0)) and metres per height quantum (0.25); u32 flags (0); u32 payload length;
then a zlib stream of i16 residuals, row-major, each `q − (left + up − up_left)` with zeros outside the grid.
A height is `q × step` metres: land above zero, sea floor below.

`crates/naval-sim/src/terrain.rs` and `src/maps/heightfield.ts` decode it and evaluate the same bilinear
height and the same deployment-clearance scan, operand for operand. A battle places the chart in its world:
custom and online battles centre it between the default spawn lines (offset `[0, −spawnDistance / 2]`),
missions centre it on the mission area (`[0, 0]`). Grounding, shell and torpedo hits, sight lines, navigation,
camera clearance, the charts and the rendered land all read that one surface.

## Rendering

`createBattleLandscape(map, terrain, quality)` (`src/game/BattleLandscape.ts`) draws the placed field; the game adds
its `root` to the scene, calls `update(camera)` every frame and `dispose()` when the battle ends. An open-sea map gets
an empty view. Building the land takes about 150–230 ms on the main thread at battle start; per frame the land costs a
few hundredths of a millisecond of CPU. Everything lives in `src/game/terrain/`, each file documented at its head:

| Part | What it does |
| --- | --- |
| `TerrainLod.ts` | CDLOD quadtree over the chart: 16² quad patches drawn as instances of one mesh, level-0 vertices 20 m apart (High) or 40 m (Medium), each level's band set so a triangle edge spans about 5 (High) or 9 (Medium) pixels at the current lens, so binoculars pull full detail out to what they look at. Vertices slide onto the coarser grid across the outer part of each band: no seams or pops. Patches wholly under 30 m of water are skipped |
| `TerrainMaterial.ts` | The vertex shader reads the height texture texel by texel and interpolates exactly as `Heightfield.height`, so every level-0 vertex stands on the surface ships ground on and shells strike. The fragment shader takes the smooth normal from central-difference gradients and the cover from `TerrainSurface` |
| `TerrainField.ts` | CPU preparation: heights, gradients, the sun's visibility (a line sweep with a penumbra, redone when the sun moves by 0.3°) and per-sample attributes on an 80 m grid: D8 drainage area, topographic position at 240 m and 960 m, and signed distance to the coast |
| `TerrainBake.ts` | The open sky of every attribute sample, baked once on the GPU (16 horizon directions out to 2.8 km): valleys, coves and cliff feet get less of the sky's light |
| `TerrainSurface.ts` | Land cover per map style, driven by the ground: height, slope, aspect (toward the equator), hollows and knolls, a wetness index (ln of drainage area over the slope), coast distance and open sky. Noise only breaks the boundaries at tens of metres. Vestfjord: a ragged, aspect-dependent snowline at 150–300 m, dark rock on faces steeper than about 33° with snow in the couloirs, heath, rock and birch with lying snow below, dark skerries and a wet tidal band. Iron Bottom Sound: rainforest canopy with gallery forest down every gully, kunai on the coastal plain and the low dry spurs, coconut blocks on the coastal flats, grey-brown beaches. Sunda Strait: forest, paddies with village groves on the wet plains, palm groves along the coastal strip, black sand. Strait of Dover: streaked chalk faces within a few hundred metres of the sea with shingle at their foot, small winter fields with hedgerows, hanger woods on valley sides and copses in wet hollows. Every procedural pattern fades to its mean as a pixel outgrows it, so distant land keeps its brightness and never shimmers. A wet band and a broken foam line mark the waterline. Medium drops the finest detail (leaf clumps, fall-line streaks, furrow noise, froth and the small relief) |
| `TerrainTrees.ts`, `TreeAtlas.ts` | High only: up to one tree per 20 m cell on the nearest 256 level-0 patches with land, placed, sized and chosen on the GPU from the same masks (`treeCover`) that paint the ground. Camera-facing cards from a procedural atlas (broadleaf, coconut palm, conifer, bare winter tree), lit as rounded crowns and shaded by the land's own shadow; they dissolve before the end of level 0, where the painted canopy takes over |
| `TerrainNoise.ts`, `TerrainTextures.ts` | A 512² tile of value and Worley noise (crowns, fields, hedgerows) and the luminance of four CC0 aerial photographs (rock, grass, sand, snow; `public/terrain/ASSETS.md`) |

Ships' and clouds' shadows reach the land through the sun's shadow node; the scene fog does the aerial perspective.

### Cost

Measured on the development Mac (Apple GPU) in a paused custom battle with `--bench`: frames with the land alternating
with frames without, each waited on and timed by wall clock, trimmed means over 100–120 pairs at a 1600 × 900 window
drawn at two thirds of device resolution. Milliseconds added per frame:

| View | Medium | High | Ultra |
| --- | --- | --- | --- |
| Chase camera at the spawn (`spawn`) | 0.0–0.6 | 0.3–1.1 | 0.2–1.3 |
| 12× binoculars filled with coast (`binoculars`) | 1.1–2.0 | 2.7–3.2 | — |

At the spawn Vestfjord, whose mountains fill the most of the view, is the dearest map; under binoculars the four
cost about the same, since the land fills half the frame in each. The CPU side (patch selection
and the sun's follow) stays under 0.1 ms a frame; recomputing the land's own shadows takes about
15 ms (more before the JIT warms) and happens only when the sun has moved 0.3°. Trees are capped at the nearest 256 level-0 patches with land: under
binoculars level 0 stretches over tens of kilometres, where a tree on every slot cost several milliseconds.

### Review and captures

```sh
bun scripts/browser/terrain-review.ts --tag v4                     # every map and view to .build/reviews/terrain/v4/
bun scripts/browser/terrain-review.ts --maps vestfjord --presets cliffs,binoculars --tag try
bun scripts/browser/terrain-review.ts --serve 5391                 # then curl 'localhost:5391/run?maps=…&presets=…&tag=…[&debug=sun]'
bun scripts/browser/terrain-review.ts --bench --presets spawn --quality high --tag bench   # frame cost, wall clock
bun scripts/browser/terrain-review.ts --build --presets spawn --tag build                  # battle-start build cost
```

The page (`scripts/diagnostics/terrain-review.html`) starts a real paused battle on each map and draws its own copy
of the land. Views: `coast3`, `coast8` and `coast20` (sea level facing the coast that stands highest over the lane),
`binoculars` (12× from the lane), `aerial` (900 m up), `cliffs` and `cliffsNear` (the steepest coast, from 2.5 km and
through 4× from 900 m), `spawn` (the chase camera), `overview` and `art`. `&debug=` draws one input instead of the lit land:
`albedo`, `normal`, `sun`, `sky`, `occlusion`, `lod`, `coast`, `relief`, `slope`. `--bench` alternates frames with and
without the land and compares their wall-clock times pair by pair, which is the only timing that holds up on Apple GPUs.

`bun scripts/browser/terrain-review.ts --art --size 1920x1080 --tag art` renders each map's `art` view (behind the
player's ship through a long lens, toward the main coast; on the Strait of Dover toward the cliffs) and writes its picker
tile (`public/maps/<id>.webp`, 640 × 360) and loading-screen backdrop (`public/maps/<id>-backdrop.webp`, 1920 × 1080)
with `cwebp`.

## Data sources and attribution

AWS Terrain Tiles combine several open elevation sources (https://github.com/tilezen/joerd, docs/attribution.md).
The ones behind these maps:

- SRTM and GMTED2010 terrain data courtesy of the U.S. Geological Survey (Guadalcanal, Java, Sumatra).
- Global ETOPO1 terrain data, U.S. National Oceanic and Atmospheric Administration.
- Norway terrain data © Kartverket; ArcticDEM terrain data DEM(s) were created from DigitalGlobe, Inc., imagery
  and funded under National Science Foundation awards 1043681, 1559691 and 1542736 (Vestfjord).
- Europe terrain data produced using Copernicus data and information funded by the European Union – EU-DEM
  layers; United Kingdom terrain data © Environment Agency copyright and/or database right 2015, all rights
  reserved (Strait of Dover).

No other game's geometry, textures or minimap images are used; the War Thunder minimaps were layout references
only.
