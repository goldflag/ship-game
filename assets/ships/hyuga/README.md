# IJN Hyūga

Hyūga · 1942 exterior after the GameModels3D pjsb517 A hull · reference design waterline

Open `/?ship=hyuga` or select this ship in port or Custom battle.

This is a legacy Blender-recipe preset (like Kongō, Takao, Alaska, Hood and Yamato), by explicit request, rather than a
construction ship. `blueprint.json` (written by `author-blueprint.py`), `build.py` and its region modules are the
durable inputs: `hyuga_kit.py` (shared vocabulary after the Kongō kit: prisms, members, rails, boats, windows,
stanchions and support queries), `hyuga_pagoda.py`, `hyuga_midships.py`, `hyuga_aft.py` and `hyuga_hull.py`, plus two
generated tables: `hyuga_fittings_table.py` (positions and bounding sizes of the reference's deck fittings) and
`hyuga_windows.py` (windows and portholes read off the textured reference). The Ise-class 35.6 cm twin is a new catalog
variant, `type41-356-hyuga-twin`, on its own builder (`assets/parts/ijn-hyuga-356/`); the 14 cm casemate is
`type3-140-hyuga-casemate` on the Kongō casemate builder. Generated Blender scenes and runtime models are build
outputs.

## Approved brief

The owner approved this brief on 2026-09-25.

- **Vessel and fit:** Hyūga in 1942, the Ise-class battleship before the 1943 hybrid conversion, as GameModels3D World of
  Warships vehicle [`pjsb517`](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pjsb517) shows her in its A
  hull (the only one), visual model `jsb049_hyuga_1942`: six twin 35.6 cm/45 Type 41 turrets (the reference's `jgm191`),
  sixteen 14 cm/50 casemates (`jgs197`), four open twin 12.7 cm/40 Type 89 mounts (`jgs158`), ten twin 25 mm Type 96
  (`jga019`), the pagoda foremast with the Type 94 main director and 10 m rangefinder, two Type 91 and two Type 94
  high-angle directors, Type 95 and machine-gun directors, the after control tower and mainmast, a boat derrick, eight
  searchlights, one catapult on the quarterdeck (empty, as the reference shows it) and eighteen boats (eleven 9 m
  cutters, two 6 m dinghies, two 12 m motor launches, 17 m and 11 m motor boats and a 14 m landing craft). No radar.
- **Paint:** the reference's source ("default") paint, as Kongō has: one grey over hull and upperworks, grey steel roofs and
  the casemate ledge, natural wood weather decks, a black funnel cap and upper mainmast, a red-oxide bottom to the
  waterline with no boot topping, and the gold chrysanthemum on the stem. Where the source shows nothing, the fleet's
  appearance conventions (docs/ship-appearance.md) apply; the fleet's IJN ensign flies from the mainmast's aerial spar.
- **Reference policy:** GameModels3D only; no War Thunder, Sketchfab, photographs or plans. Other gameplay values are
  provisional game calibration.
- **Tree:** Hyūga fills the Japanese battleship line's Ise-class node (class Ise, 1917), because GameModels3D has no
  conventional Ise; Ise herself is built separately as the 1943–45 hybrid.

## Model and simulation basis

The hull is an original authored-stations loft: 343 stations of 40 points at the reference's y = 0 design waterline,
215.25 m overall (212.75 m on the waterline), 33.82 m over the anti-torpedo bulges, 9.73 m to the keel and 42,544 t at
that waterline. Each section is the shell walked by the `ship:lines` station walker from its widest point up to the
upper-deck edge, the casemate ledge or the knuckle, then the forecastle's side or wall read off `ship:slice --plan`
footprints up to the forecastle deck edge found by vertical probes; so the flared bow, the stem's rake, the bulges and
their tops, the ledge under the casemates with its scalloped embrasures, the inset forecastle wall, the forecastle's
V-shaped after end at No. 3 barbette and the quarterdeck's rising sheer follow the reference. Where the walk climbed a
casemate's front above the shoulder, the section stops at the shoulder height of the stations either side, so the ledge
runs unbroken and the casemate parts stand on it; the stem head stops at the deck edge, below the bow fittings. Every
section gives the shell below 4.3 m, the climb above it, the ledge's inboard corner and the wall the same number of
points, so the loft's facets run straight from station to station. The loft's flat decks stand 0.12 m above the
measured deck edges, between the edge and the crown of the reference's cambered decks.

Superstructure prisms come from plan cuts of the reference's hull group every 0.1 m (mirrored, gaps up to 1 m bridged so
doors and windows do not open the outline, features thinner than 0.25 m left out), with our loft and the main barbettes
cleared, followed up through the levels: a piece that keeps its footprint continues its band, and each band is one prism
with its middle level's outline. A block standing less than 0.6 m over the deck or the block below reaches down to it,
and the after tower's lowest tiers, traced standing on the reference's deck crown, reach down to our flat deck.
The recipe draws what the tracer cannot: the funnel's lattice tower (the traced block round the funnel's middle is
replaced by the funnel casing, its trunks, corner posts, X bracing, girts and knees), the mainmast's pole, yards and
aerial spar, stanchions and brackets under the platforms that stand on them, and the pagoda's after legs.
`author-blueprint.py` records how the blueprint was made and rebuilds it from those measurements (`--loft`,
`--structures`); the scripts that make them live in ignored `.build/hyuga/`.

Mounts sit at the reference's hardpoint datums (`HP_JGM`, `HP_JGS`, `HP_JGA`). The Ise-class 35.6 cm twin
(`type41-356-hyuga-twin`) was measured from plan and cross-section cuts of the reference turret: a lozenge plan widest at
the training axis, chamfered face corners and a shallow V back, sides leaning in about 15°, a gabled roof whose ridge
rises from 1.73 m over the inclined face plate to 2.64 m aft, barrels 2.25 m apart with the muzzles 14.16 m ahead of the
axis; its yaw datum is the reference gunhouse floor, so each barbette rises to the bearing plane 0.25 m below it. It keeps
the Type 41 gun's catalog values from the Kongō twin and adds turned barrels, blast bags, sight hoods with their covers,
the periscope hood and ladders. The casemate (`type3-140-hyuga-casemate`) is the Kongō cylindrical casemate (the same
drum form as the reference's) carrying the 14 cm/50 3rd Year Type gun's catalog values and the reference's 6.19 m barrel
reach, seated on the ledge 0.86 m below the reference drum datum. The open 12.7 cm twins are `type89-127-yamato-open-twin`
(built against the same `jgs158` visual) and the 25 mm twins `type96-25-mogami-2` (the `jga019` twin's size). Casemate
arcs are game estimates set by bearing and half-sector.

Fittings follow reference datums: directors, rangefinders and searchlights at the reference's hardpoints and part bounds;
ventilators, hatches, winches, reels, fairleads, capstans, paravanes, lockers and lamps at the reference's part bounds on
our decks (a fitting with nothing under it is left out); the anchors housed against the shell; the boats in their cradles;
the catapult on its turntable at the reference's pivot and 10° heading; four three-bladed screws, their shafts and
A-brackets, the inner shafts' skegs and the twin rudders at the reference's positions. Windows and portholes were located
by orthographic renders of the textured reference and set in the plane of this model's own walls where they stand within
0.35 m of the reference's, never on a prism a region module replaces (hull portholes on the loft, mirrored).

Machinery (four boiler rooms under the funnel between No. 2 and No. 3 barbettes, four turbine rooms between No. 4 and
No. 5, four shafts), magazines, flood spaces, stability (GM 7% of beam) and damage-control values are game estimates;
the visual reference does not establish internal plans. The repository's tools do not expose the reference's armour model,
so protection is provisional game calibration placed on the loft: a 299 mm belt on the original shell inside the bulges
with 102 mm below it and at the ends, a 203 mm upper belt, 152 mm casemate armour, a 102 mm armoured deck with a 32 mm
upper deck, 299 mm barbettes, a 305 mm conning tower and a protected steering gear.

Handling (native trial, calm water): 25.3 kn top speed (the class's modernised speed), 14.9 kn in a hard turn (59%),
1.08°/s, 90° in 46.1 s and an 810 m steady turning circle — close to Kongō's 1.19°/s and 846 m with the heavier, slower
ship.

## Accepted approximations

- Displacement at the reference waterline (42,544 t, 9.73 m keel draft) is the reference's loading, heavier than the
  class's published full-load figure; the stated mass equals the loft's displacement.
- Superstructure tiers are measured prisms: sloped faces step, and small overhangs, open galleries and the pagoda's open
  framework are approximated. The funnel's lattice tower, the mainmast and the platforms' supports are simplified
  original constructions.
- The loft is symmetric and its decks flat; the reference's cambered decks crown 0.14 m higher at the centreline.
- The casemate drum, curtain and barrel taper are the 15.2 cm recipe's; only the gun's catalog values and barrel reach
  are the 14 cm's. The drums turn half inside their embrasures, as the reference's do.
- Boats are stowed square to the centreline at the reference's positions (the reference turns several a few degrees).
- Windows and portholes come from the reference's painted textures, so painted vents and grilles can read as dark panels;
  openings whose wall here stands away from the reference's are left out.
- Stability, mass distribution, flooding compartmentation, armour and weapon values are shared game calibration, not
  historical measurements. Model fidelity and export checks do not certify historical accuracy.

Hyūga fills the Ise-class node of the Japanese battleship line of the research tree.

```sh
python3 assets/ships/hyuga/author-blueprint.py   # add --loft/--structures only to re-measure from .build/hyuga
bun -e "import { writeLocalDamage } from './assets/ships/author-local-damage.ts'; await writeLocalDamage(['hyuga'])"
bun assets/ships/author-flood-spaces.ts hyuga && bun assets/ships/author-stability.ts hyuga && bun assets/ships/author-damage-control.ts hyuga
bun run ship:build hyuga
bun run ship:review hyuga
bun run ship:check hyuga
```

After a change to the turret recipe's shell, `python3 assets/parts/ijn-hyuga-356/sync_shape.py` rewrites its catalog
entry. Keep the current fixed views in `generated/review/`. Reference downloads, measurements and comparison captures stay
in ignored `.build/`.
