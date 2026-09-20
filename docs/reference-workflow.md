# Measuring a reference ship

An agent building a construction ship against a real vessel needs three things the authoring commands did not
provide: the reference geometry in the game's own coordinates, measurements taken from it, and the mount
positions it carries. `ship:reference`, `ship:slice` and `ship:hardpoints` cover those three. They read and
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

Parts are grouped coarsely from the source path (`hull`, `gun-main`, `director`, `torpedo`, `misc`, …) so a
measurement can keep the hull and drop deck clutter with `--parts hull`.

## 2. Measure it: `ship:slice`

One measurement per call, always over a cached reference:

```sh
bun run ship:slice pgsb507 --levels --parts hull          # up-facing area by height: the deck finder
bun run ship:slice pgsb507 --plan 4.1 --simplify 0.2      # footprint rings at a height
bun run ship:slice pgsb507 --top z --step 1               # side-view silhouette (--top x for the front view)
bun run ship:slice pgsb507 --width --bin 1                # half-breadth per height band
bun run ship:slice pgsb507 --stations -60,-20,0,20,60 --parts hull   # hull cross sections
bun run ship:slice pgsb507 --probe 6.6,-21.5              # every surface a downward ray crosses
bun run ship:slice pgsb507 --section z=-40                # raw cut outlines, open chains included
```

`--box x0,y0,z0,x1,y1,z1` limits any measurement to a region, `--parts` to named groups or part keys, and
`--limit` caps the rows returned.

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

## Limits

- The reference is geometry only: no materials, no armour, no internal subdivision, no mass.
- `y = 0` is the source model's waterline, which is a design waterline, not our compiled hydrostatic one.
- Hardpoint bearings come from the node's local `+Z` after the reflection; a source that rotates a mount by
  its own animation rather than its transform reads as bearing 0.
- Downloaded geometry lives only in `.build/` and must never be committed or published.
