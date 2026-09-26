# IJN Fusō

Fusō · 1943 exterior after the GameModels3D pjsb006 B hull · reference design waterline

Open `/?ship=fuso` or select this ship in port or Custom battle.

This is a legacy Blender-recipe preset (like Kongō, Alaska, Hood and Yamato), by explicit request, rather than a
construction ship. `blueprint.json` (written by `author-blueprint.py`), `build.py` and its region modules are the
durable inputs: `fuso_kit.py` (shared vocabulary adapted from Kongō's kit: prisms, members, rails, boats, windows),
`fuso_pagoda.py`, `fuso_midships.py`, `fuso_aft.py` and `fuso_hull.py`, plus `fuso_fittings.py`, a generated table of
the reference's deck fittings and bridge gear (kind, datum and size from the reference's per-instance bounds).
Reusable guns come from `assets/parts/`. Generated Blender scenes and runtime models are build outputs.

## Approved brief

Approved by the owner on 2026-09-25.

- **Vessel and fit:** IJN Fusō in her 1943 fit after the 1930s reconstruction, as the reference shows her: six twin
  35.6 cm/45 turrets, fourteen 15.2 cm casemates, four open twin 12.7 cm Type 89 high-angle mounts, 25 mm Type 96 AA
  (ten twin and seventeen single mounts, the fuller B_AirDefense fit) and the pagoda foremast.
- **Reference:** GameModels3D World of Warships vehicle
  [`pjsb006`](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pjsb006) in configuration hull B: `B_Hull` with
  `AB1_Artillery`, `B_AirDefense` and the `AB_*` components (ATBA, Finders, AirArmament, Directors, Radars). Both hulls
  use the one visual model `jsb006_fuso_1943`. Cached with `bun run ship:reference pjsb006 --hull B_Hull`.
- **Reference policy:** GameModels3D only; no War Thunder, Sketchfab, photographs or plans. Armour zones and
  thicknesses come from the reference's armour model (`jsb006_fuso_1943`); other gameplay values are provisional game
  calibration.
- **Paint:** the reference's source (default) paint, as Kongō has: one light blue-grey over hull and upperworks, grey
  steel roofs, platforms, casemate ledge and turret tops, natural wood weather decks, a linoleum aircraft deck with brass
  strips on the quarterdeck, a black funnel cap and a red-oxide bottom to the waterline without boot topping, the gold
  chrysanthemum on the stem. Where the source shows nothing, the fleet's appearance conventions apply
  (`docs/ship-appearance.md`): the fleet's IJN ensign flies from the mainmast gaff, as at sea.
- **Accepted approximations:** listed below.

## Model and simulation basis

The hull is an original authored-stations loft (331 stations, 26 points each) cut from the reference hull at 15 m per
source unit with its y = 0 design waterline. `ship:lines` follows one shell and missed this hull's flat bottom (it read
the bulges' underside, 0.4 m high, as the keel) and its casemate ledge (it stopped at the ledge as a deck), so each
station was built as the starboard envelope of every hull crossing, cut with the same HullSlicer: the flat bottom at
9.68 m, the bilge and anti-torpedo bulges out to 16.38 m, the side above them, the casemate ledge on the upper deck at
4.06 m, the forecastle wall inboard of it (traced by `ship:slice --plan 5.3`, with a station pair at every corner so its
casemate embrasures stay crisp) and the forecastle deck at 6.67 m rising to 7.53 m at the stem head. Aft of the
forecastle's rounded end the upper points close the quarterdeck to the centreline. At that waterline the loft is 212.53 m
overall, 32.76 m over the bulges, 9.68 m keel draft and 42,792 t.

Superstructure blocks were grouped from plan cuts of the reference every 5 cm (`planPolygons`, the code behind
`ship:slice --plan`, mirrored): a block continues while each cut matches the last, thin transitional layers (window
bands, wall kinks) are absorbed into the block they touch, hull below each station's deck and the barbettes are taken
out first, and a light gun's working circle is cut out of any block standing round it (a tub whose walls the cuts
filled in), opened to the block's edge where the gun stood inside it. `author-blueprint.py` records the edits
(`STRUCTURE_EDITS`): the funnel's layers become one casing on its measured oval (3.96 m by 5.86 m, the same from the
base blocks at 12.3 m to the rim at 23.9 m; the steam pipes up its sides stand outside it) with a forward casing whose
block takes the taper's mean breadth, and fragments without support go (the forecastle's ground tackle and the quarterdeck capstan, which the
recipe draws; barbette lugs; a stepped walkway; the tower's leg pieces, which the recipe draws whole). The port quarter's
crane sponson is its own block, as the symmetric loft cannot carry it. Firing obstructions are boxes in fore-and-aft
strips of each block, halved until no box stands more than 0.35 m outside the block's walls: the pagoda base's after
face is notched 0.7 m in the middle, where No. 3 turret's muzzles point, and a box squared across the notch stopped
that turret at rest.

Mounts sit at the reference's HP_ datums (`ship:hardpoints pjsb006`). The six turrets reuse the Kongō 1942 twin
(`type41-356-kongo-1942-twin`): its gunhouse, roof slope and 14.34 m barrel reach match the reference's `jgm006`/`jgm007`
within 0.4 m, and `jgm007`'s roof rangefinder is the part's rangefinder option (Nos. 2 to 5). Its yaw datum sits 3.326 m
below the reference gunhouse floor, so the recipe raises each barbette (4.82 m, as measured) to the turret's bearing
plane. The fourteen casemates reuse `type41-152-kongo-casemate`, their datum 0.44 m below the reference node so the
bore stands at the reference's 5.85 m. The 12.7 cm twins are the catalog's `type89-127-a1-twin`, built on the same
visual (`jgs009`); the 25 mm twins `type96-25-mogami-2` and singles `type96-25-kongo-single`. Movement interlocks keep
the main and 12.7 cm barrels (with their recoil stroke) out of the blocks they reach, the superfiring pairs apart, and
the turrets clear of the light mounts their barrels pass over: No. 2 and the forward 25 mm singles, No. 3 and
casemates 4, No. 4 and the twins abreast the funnel, Nos. 5 and 6 and the after 25 mm mounts. Every turret trains from
rest to either beam.

Fittings follow reference datums: `fuso_fittings.py` lists the reference's 272 ventilators, hatches, fairleads,
bollards, winches and reels with their sizes, its bridge gear (searchlights, controls, binoculars, lamps, lockers) and
55 portholes read off orthographic renders of its painted hull sides (drawn on both sides). The recipe draws the
pagoda's main director (which trains) on the top platform, the 10 m rangefinder through the tower behind it with the
radar mattress on the tower's face, the Type 22 radars, the enclosed 3.5 m rangefinders (round houses with the tube
through their sides) and open 1.5 m ones, the Type 91 high-angle directors in wells sunk 0.8 m into their platforms,
the tower's rear legs (upright to a knee at 13.2 m, then raked aft) with the raked struts, braces and web plates
outboard of them, the signal yard (narrow and railed, straight across the tower's after face and swept 25 degrees aft
to its tips) with its halyards to the flag lockers, the day lights, the red and green side lights, bridge glazing in
the three bands the reference paints (panes cast onto this model's walls), the funnel's cap band, cage grill, the five
steam pipes up each side and the tall pipe at each forward quarter, the tapered forward casing, the lattice tower
under the after searchlight platform, the Type 13 antennas on the funnel's sides, the after director (which trains)
in its well, the three periscope houses and the enclosed 4.5 m rangefinders (tubes fore and aft) on the after tower
with the two large windows on each side of its upper deckhouse, the lookout top's star plate on six radial webs, the
pole mainmast with its topmast, trucks, pole, yard, gaff and stays, the aerials the
reference's side render traces (the forestay with its bridle and insulator, the long aerial from the mainmast to the
pagoda top, the vee over the funnel and the backstay to the stern's ensign staff), the catapult, the stowed aircraft
crane, the linoleum aircraft deck (its forward edge the reference's chevron, flat at z 83.25 within 2.4 m of the
centreline and square across at z 77.45 outboard of 7.25 m) with its brass strips every 1.39 m, brass edging and
trolley rails, boats at their reference parts' centres and long axes (two 9 m cutters and four open 12 m motor launches
canted bow inboard, two 15 m motor boats stowed stem aft), the paravanes on the forecastle, life buoys and buoy boxes,
stowed radial davits, ground tackle and housed anchors, the stem's chrysanthemum and jackstaff, rails, knees under
overhangs, and
below the waterline the centreline skeg, four three-bladed screws on shafts in bossings with struts and twin rudders
behind the inner screws (reference x 2.8 m).

Machinery (four boiler rooms between Nos. 2 and 3 turrets and under the funnel, four turbine rooms between Nos. 4 and 5,
four shafts), magazines, flood spaces, stability (GM 7% of beam) and damage-control values are game estimates; the visual
reference does not establish internal plans. The 305 mm main belt (229 mm forward and aft of it, 102 mm at the ends),
the 203 mm upper belt, 152 mm casemate armour, the 99 and 51 mm armoured deck with 76 and 102 mm slopes, the 131 mm deck
over the after magazines, 57 mm bow deck, 35 mm casemate deck, 241, 203, 152 and 140 mm bulkheads, 305/216 mm barbettes,
the 305 mm conning tower, the 152 mm after control tower and the steering gear's 83/70/102 mm box read their zones and
thicknesses from the reference's armour model; the belt stands on the hull body inside the bulges, at half-breadths
sampled from station cuts of that model. Hull and superstructure plating are 26 and 16 mm.

## Accepted approximations

- The turrets are Kongō's 1942 twin part, placed at the reference's datums and raised on their barbettes; the
  gunhouse outline is that part's, not a new variant traced from `jgm006`/`jgm007`.
- Displacement at the reference waterline (42,792 t, 9.68 m keel draft) is the reference's loading, heavier than
  published full-load figures for the ship; the stated mass equals the loft's displacement.
- The loft is symmetric: the port quarter's crane sponson is a separate block, and the hull's small asymmetries are
  averaged.
- Superstructure blocks are measured prisms: sloped faces step, and small overhangs, open galleries and rails are
  approximated. Tub walls that plan cuts filled in are cut back to each light gun's working circle.
- The casemate drums turn half inside their embrasures, as in the reference and in Kongō; the sweep reports those
  contacts with the hull as reachable, and `sweep-accepted.json` accepts them. The casemate datum sits 0.44 m below the
  reference node so the bore stands at the reference height.
- The two 15 m motor boats beside No. 4 turret sit 0.8 m lower than the reference's, with a 0.95 m wheelhouse and no
  mast, so the gunhouse and barrels turn over them. The after capstan stands 0.6 m lower and the stowed crane's jib
  tapers to 0.3 m at its outer end, under No. 6 turret's barrels at full depression; ventilators and other deck
  fittings under a gunhouse or the main barrels' depression are cut down to clear them.
- Rigging is the mainmast's stays and the aerials the reference's side render shows, as straight runs between the
  points it traces (the long aerial in seven segments along its sag); the signal halyards run straight from the yard
  arms to the flag lockers.
- The pagoda's top platform, which the reference paints as linoleum with brass strips, stays grey steel, as the
  approved brief lists its platforms.
- The shared 25 mm single's ring sight hangs 8 cm clear of its rail; the recipe joins it with three spokes rather
  than editing the shared part.
- Windows and portholes come from the reference's painted textures, so painted vents and grilles read as glazing too.
  The anchors lie housed against the plating under their hawses (at the bow a ring round a dark mouth, as the side
  render shows); the hawse pipes are not openings through the hull.
- Movement interlocks are game clearance, not verified historical mechanical stops.
- Stability, mass distribution, flooding compartmentation, handling (24.7 kn) and weapon values are shared game
  calibration, not historical measurements. Model fidelity and export checks do not certify historical accuracy.

Fusō takes the placeholder's place in the Japanese battleship line of the research tree.

```sh
python3 assets/ships/fuso/author-blueprint.py   # add --loft/--structures only to re-measure from .build/fuso
bun -e "import { writeLocalDamage } from './assets/ships/author-local-damage.ts'; await writeLocalDamage(['fuso'])"
bun assets/ships/author-flood-spaces.ts fuso && bun assets/ships/author-stability.ts fuso && bun assets/ships/author-damage-control.ts fuso
bun run ship:build fuso
bun run ship:review fuso
bun run ship:check fuso
```

Keep the current fixed views in `generated/review/`. Reference downloads, measurements and comparison captures stay
in ignored `.build/`.
