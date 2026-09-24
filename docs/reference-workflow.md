# Measuring a reference ship

An agent building a construction ship against a real vessel needs three things the authoring commands did not
provide: the reference geometry in the game's own coordinates, measurements taken from it, and the mount
positions it carries. `ship:reference`, `ship:slice` and `ship:hardpoints` cover those three, and `ship:loft` fits an adjustable
hull to a measured one. They read and
write only the ignored `.build/` tree, so no downloaded geometry ever reaches `assets/`, `public/models` or a
commit. GameModels3D data is a viewing reference: measure it, do not redistribute it.

## The frame

Everything these commands print is in ship metres, the same frame the authoring commands use:

| Axis | Meaning |
| --- | --- |
| `+X` | starboard |
| `+Y` | up, with `y = 0` the waterline |
| `−Z` | bow |

A World of Warships source model is converted at 15 m per source unit with source `+Z` reflected to runtime
`−Z`, which is the conversion the model viewer already uses, so a reference and our own ships can be compared
number for number. The source's own `y = 0` is taken as the waterline; it is the model's designed waterline,
not a measurement of our hydrostatics, so a draft read from a reference is a starting guess.

## 1. Cache a reference: `ship:reference`

```sh
bun run ship:reference pgsb507                 # a GameModels3D vehicle ID or page URL (network)
bun run ship:reference plans/scharnhorst.glb   # a local GLB or OBJ, no network
bun run ship:reference --list                  # what is already cached
```

The cache is `.build/references/<name>/`: `mesh.bin` (one triangle list, the hull first) and `reference.json`
(the part list with per-part bounds and triangle ranges, the `HP_*` hardpoint transforms, and the frame). A
second run reuses the cache; `--refresh` rebuilds it. `--hull`, `--components` and `--hull-only` choose which
source configuration is assembled, `--scale` and `--flip-z` set the frame for a local file, and `--name` gives
the cache a readable name.

`--render` draws the cached configuration with its source textures, so windows, doors and markings the model
paints rather than models are visible: `--shots side,top,front,stern` (orthographic; side and top with the bow on
the right) and one `--camera preset|az,el[,m]` or `--eye x,y,z --target x,y,z` shot with `--fov` or `--ortho`, in the
same frame and camera conventions as `ship:overlay` and `ui:shot`. `--paint`, `--parts` and `--offset z|x,y,z` pick the
paint scheme, the groups and a shift into your ship's frame; images land in `.build/references/<name>/renders/`.

Parts are grouped coarsely from the source path (`hull`, `gun-main`, `director`, `torpedo`, `misc`, …) so a
measurement can keep the hull and drop deck clutter with `--parts hull`.

## 2. Measure it: `ship:slice`

One measurement per call, always over a cached reference:

```sh
bun run ship:slice pgsb507 --levels --parts hull          # up-facing area by height: the deck finder
bun run ship:slice pgsb507 --plan 4.1 --simplify 0.2      # footprints at a height, traced from open shells (see below)
bun run ship:slice pgsb507 --top z --step 1               # side-view silhouette (--top x for the front view)
bun run ship:slice pgsb507 --width --bin 1                # half-breadth per height band
bun run ship:slice pgsb507 --stations -60,-20,0,20,60 --parts hull   # hull cross sections
bun run ship:slice pgsb507 --probe 6.6,-21.5              # every surface a downward ray crosses
bun run ship:slice pgsb507 --section z=-40                # raw cut outlines, open chains included
```

`--box x0,y0,z0,x1,y1,z1` limits any measurement to a region, `--parts` to named groups or part keys, and
`--limit` caps the rows returned.

`--plan` traces footprints even though GameModels3D meshes are open shells: the cut is rasterised (`--res`, about
4 cm by default), gaps up to `--close` metres (0.25) are bridged, enclosed interiors are filled and features thinner
than `--min-thickness` (0.3 m, so rails and ladders) drop out. Where the cut already closes into a matching ring, the
exact ring comes back instead (`source: "exact"`, otherwise `"traced"`). `--sym` mirrors the cut across x = 0 first,
and `--parts hull,misc,other` leaves guns and directors out of a deckhouse footprint. Measure just below a deck so
the wall is traced, not the clutter standing on it.

`--levels` is the one to reach for first: its `strongest` list is the deck heights, and on the Scharnhorst it
returns the main deck at 4.15 m, the forecastle at 6.55 m and the bridge deck at 12.25 m. `--probe` with
`--y` answers "what should `ship:place --y` be here", returning the nearest up-facing surface below and above.

A hull station returns the deck line, the keel, the maximum half-breadth, the sampled starboard half outline
from the deck edge down to the keel, and the section area. The outline is sampled by height rather than walked
around a closed ring, because source hull meshes are open shells: a watertight ring usually does not exist.
Everything above the detected deck line is discarded, so masts, boats and superstructure never enter the hull.
If a station reports `found: false`, cap the deck with `--y` or restrict the geometry with `--parts hull`.

## 3. Read its mounts: `ship:hardpoints`

```sh
bun run ship:hardpoints pgsb507 --match GD_               # the gun directors
bun run ship:hardpoints pgsb507 --part sk-c34-283-triple --table
```

Each `HP_*` node becomes a row: the position in ship metres, the compass bearing of its facing (0 bow, 90
starboard), the nearest up-facing hull surface below it (`deckY`) and the gap to it (`deckOffsetM`). Points
that ride on another mount — a gun's own muzzle and sight points — are marked `nested` and hidden unless
`--nested` is given. `--table` prints tab-separated `part, id, x, y, z, bearing` rows; `--part` fills the first
column with the catalog ID to place.

A hardpoint's `deckOffsetM` near zero means the source mount sits directly on that deck, so `ship:place --at
x,z --y <deckY> --bearing <bearing>` reproduces it. A large offset means the reference carries the mount on a
platform that has to be built first.

## 4. Fit a hull to it: `ship:loft`

```sh
bun run ship:loft my-ship --reference pgsb507 --max-stations 48 --points 17 --out .build/loft.json
```

It measures a station every `--sample` metres, greedily adds the station the current set represents worst until
the worst half-breadth error is under `--tolerance` or `--max-stations` (default 24, at most 48) is reached, and
then builds each section's outline:

- **Sampled at the cut's own vertices.** A station is sampled at every height where the cut has a vertex as well as
  evenly, so a knuckle, chine or belt step is a measured point rather than something the samples cut across.
- **Fins removed.** A protrusion shorter than `--fin` metres of height (default 1) that sticks out more than 15 cm
  beyond what the outline returns to above and below it — a bilge keel, a shaft bracket — is cut back to the hull.
  A broad bulge such as a forefoot keeps its shape. `--fin 0` keeps everything.
- **Flat bottoms stay flat.** The nearly level run at the keel (under 10° of rise) ends at a chine point, one point
  above the keel, with the keel beside it on the centreline. The keel is no longer dragged to the centreline, which
  turned a flat bottom and its bilge into a V.
- **Corner lines are pinned.** Corners (a turn of at least `--crease` degrees, default 10, that turns as much at
  half the chord length, so a smooth bilge is not a corner) are followed from station to station into lines along
  the hull. The strongest `--creases` lines (default a quarter of the points on one side) get the same outline
  index in every section: at the corner where a section has one, at the line's interpolated height where the line
  runs past a section without a corner, and spaced like any other point where the line does not reach. Points
  between pins are spaced by arc length.
- **Resampled** to `--points` (odd, 5–33, the same count in every station, which the format requires), then the
  tip rule: an end station narrower than `--tip` (a fifth of the maximum half-breadth by default) becomes a true
  stem or transom point, and only an end station may.

The output lists the pinned lines under `creases` (contour position, index, height, how many sections have the
corner, whether it is sharp enough to be a lighting crease), writes the sharp ones into the batch as
`customHull.creases`, and names the `bandedSpans` the native compiler will cut into horizontal bands. `accuracy`
compares the fitted hull with every measured station, taking the hull between two sections as the straight blend
of their outline points: the largest distance from a measured outline point to the fitted outline, the half-breadth
error from 0.25 m above the keel up, deck and keel height error, and section-area error.

Then it runs the native fold check **before** proposing anything: a TypeScript port of the span test in
`construction_custom_hull.rs`, including the band-cut fallback (`src/ships/customHullSpans.ts`); the Rust builder
remains the authority. A span neither cut accepts is named the same way the native message names it
(`Sections "st0" and "st1" fold through each other at the bow cap at point 0`); the loft splits that span with the
measured station nearest its middle and tries again, and if a fold survives no batch is written and the command
exits non-zero. Otherwise it proposes a revision-guarded `primitive-patch` that sets the piece's `size`, `position`,
`customHull.stations` and `customHull.creases`; check it with `ship:apply … --dry-run` before applying, because only
the native compiler decides fit, support and clearance. The new stations have new IDs, so panel-level paint and armor
on the old hull no longer apply, and fittings seated on the old hull may need `ship:reseat`.

`--parts` defaults to `hull`, `--primitive` to `hull`, and `--box`/`--y` restrict the geometry the same way
`ship:slice` does. Rake and bulb are left as they are: the fit assumes the native mapping with both at zero, so
a non-zero bow setting will shift the fitted bow sections.

### What it does well, and what it does not yet

**The Scharnhorst fits end to end.** `--max-stations 48 --points 17` against `pgsb507` fits the whole hull, stem to
stern, with no hand-shaped ends and no fold: seven spans, mostly in the wine-glass bow, take the band cut, and the
batch compiles. Against all 115 measured stations the outline is within 0.29 m (median) and 0.71 m (90th
percentile) of the reference, and the section area within 0.5 % (median) and 1.7 % (90th percentile). The Atlantic
bow's knuckle at about 1.4–1.9 m, which continues aft as the top of the belt, is pinned and written as a crease.

**Seventeen points is the limit on detail.** Each pin spends one of the eight intervals per side, so a hull with
many corners trades resolution between them; `--points 33` or fewer `--creases` shifts that balance.

**Appendages below the waterline follow the reference.** Skegs, rudders and shaft bossings that the source groups
with the hull are lofted as hull where they are too tall to be fins; the largest errors on the Scharnhorst (about
2 m of outline offset) are at the skeg around z = 96. Restrict `--box` or `--parts` to leave them out.

**The stem profile is not modelled.** Every point of an end station shares one z, so a raked or curved forefoot is
approximated by the stations behind it; a per-point stem offset would fix it but touches every bow transform.

Adjustable levers: `--sample` (candidate spacing), `--tolerance` (when the greedy stops), `--max-stations`,
`--points`, `--tip`, `--fin`, `--crease`, `--creases`.

## Limits

- The reference is geometry only: no materials, no armour, no internal subdivision, no mass.
- `y = 0` is the source model's waterline, which is a design waterline, not our compiled hydrostatic one.
- Hardpoint bearings come from the node's local `+Z` after the reflection; a source that rotates a mount by
  its own animation rather than its transform reads as bearing 0.
- Downloaded geometry lives only in `.build/` and must never be committed or published.
