# IJN Kongō

Kongō · 1942 exterior after the GameModels3D pjsb007 B hull · reference design waterline

Open `/?ship=kongo` or select this ship in port or Custom battle.

This is a legacy Blender-recipe preset (like Alaska, Hood and Yamato), by explicit request, rather than a
construction ship. `blueprint.json` (written by `author-blueprint.py`), `build.py` and its region modules are the
durable inputs: `kongo_kit.py` (shared vocabulary: prisms, members, rails, boats, windows), `kongo_pagoda.py`,
`kongo_midships.py`, `kongo_aft.py` and `kongo_hull.py`, plus `kongo_windows.py`, a generated table of the windows
and portholes measured off the textured reference. Reusable guns come from `assets/parts/`. Generated Blender
scenes and runtime models are build outputs.

## Approved brief

- **Vessel and fit:** IJN Kongō as GameModels3D World of Warships vehicle
  [`pjsb007`](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pjsb007) shows her in its B hull, whose
  geometry is `jsb007_kongo_1942`. The owner asked for circa 1944 and accepted this 1942 fit, the only non-1910s
  configuration the source offers, over the original battlecruiser: four twin 35.6 cm/45 turrets (Nos. 2 and 3 with
  roof rangefinders), fourteen 15.2 cm casemates, four open twin 12.7 cm/40 Type 89 mounts, six twin 25 mm Type 96,
  four twin and two single 13.2 mm Type 93, a main director and 10 m rangefinder on the pagoda, two Type 94
  high-angle directors, an after director with two rangefinder pods, one catapult, two A-frame boat davits, a
  derrick on the tripod mainmast, ten searchlights and ten boats (two 15 m motor boats, two covered 12 m launches,
  four 9 m cutters and a 9 m boat slung under each davit). No radar.
- **Paint:** the reference's only paint, no camouflage: blue-grey hull and upperworks, grey steel roofs and casemate
  ledge, natural wood weather decks, a linoleum aircraft deck, black funnel caps and mast heads, red-oxide bottom to
  the waterline with no boot topping, the gold chrysanthemum on the stem. The fleet's IJN ensign flies at the stern.
- **Reference policy:** GameModels3D only. The catapult stays empty as the reference shows it. Armour zones and
  thicknesses come from the reference's armour model; other gameplay values are provisional game calibration.

## Model and simulation basis

The hull is an original authored-stations loft (196 stations, 29 pinned points each) sampled from the reference at
15 m per source unit with its y = 0 design waterline: 221.75 m overall, 30.97 m over the anti-torpedo bulges,
9.15 m keel draft, 33,094 t at that waterline. Each section unites the hull body with the bulge shells and keeps the
bulge top (1.36 m), the steel casemate ledge on the upper deck (4.36 m) and the narrower forecastle wall to the
forecastle deck (6.63 m), whose scalloped casemate embrasures, V-shaped after end and bow sheer the loft follows.
Superstructure prisms were measured from plan cuts of the reference every 0.1 m (closed wall outlines and roof
columns, bridged vertically over window openings and mirrored) and grouped into height bands; the two funnels are
measured stadiums with exhausts. `author-blueprint.py` records how the blueprint was made and rebuilds it from those
measurements (`--loft`, `--structures`); rerun the gameplay helpers (below), then `bun run ship:build kongo`, after
any hull, structure or mount change.

Where a measured prism stood in for open framing or small gear, the recipe draws the real thing and records the
edit in `author-blueprint.py` (`STRUCTURE_EDITS`) or a region's `CLAIMED_STRUCTURES`: the mainmast head's platform,
bracket and yards, the girts of the lattice tower abaft the forward funnel, the forecastle's cable plates and
windlass beds, and the slivers that doubled the aircraft deck's walls.

Fittings follow reference datums: hawse pipes, cables, stoppers, windlasses, capstans and housed anchors; bitts,
fairleads, ventilators, hatches and winches on the weather decks; funnel caps with spark cages, sirens and steam
pipes; the tripod mainmast's lookout platform, topmast, yards, gaff and derrick; the searchlight towers' lattice
legs; the davits, boats and cradles; the after director (which trains) and rangefinder pods; the catapult on its
turntable with the aircraft deck's brass strips, trolley rails and turntables; the port boat ramp; streamlined twin
rudders and three-bladed screws. Windows and portholes were located by orthographic renders of the textured
reference and seated on this blueprint's own walls and loft (`.build/kongo/seat_windows.py`, `seat_hull.py`).

Mounts sit at the reference's hardpoint datums. The Kongō 35.6 cm twin, installed as its 1942 variant (`type41-356-kongo-1942-twin`, the same recipe with the reference's 14.34 m muzzle reach), carries its yaw
datum 3.326 m below the reference gunhouse floor, so the recipe raises each barbette to the turret's 3.14 m bearing
plane; the 15.2 cm casemate (`type41-152-kongo-casemate`), open Type 89 twin (`type89-127-yamato-open-twin`), twin
25 mm (`type96-25-mogami-2`) and 13.2 mm Type 93 recipes are reused unchanged. Casemate arcs are game estimates set
by bearing and installed half-sector.

Machinery (four boiler rooms under the funnels, four turbine rooms between Nos. 3 and 4 turrets, four shafts),
magazines, flood spaces, stability (GM 7% of beam) and damage-control values are game estimates; the visual
reference does not establish internal plans. The 203 mm belt stands on the original shell inside the bulges, with
the 152 mm upper belt and casemate armour, 120/110 mm armoured deck and slopes, 38 mm middle and upper decks, 229 mm
barbettes, 254 mm conning tower and the steering-gear box read from the reference's armour model.

## Accepted approximations

- Superstructure tiers are measured prisms: sloped faces step, and small overhangs, open galleries and rails are
  approximated. The after tower's tapered octagon is stepped boxes.
- The loft is symmetric and the reference's aircraft deck is not: its port wing stands out to 8.65 m between 32.8
  and 40.8 m aft of amidships while the starboard wall runs at 6.75 m. The loft carries the mean, the port wing is
  its own structure, and the starboard wall there stands about 1 m wide of the reference.
- The casemate drums turn half inside their embrasures, as in the reference; the sweep reports those contacts with
  the hull as reachable and they are accepted.
- Windows and portholes come from the reference's painted textures, so painted vents and grilles read as dark
  panels too. The boats' topsides use the reference's light grey; the slung boats' varnished hulls use the fittings
  wood.
- The derrick, davits and catapult are fixed; the catapult is empty, as in the reference.
- Stability, mass distribution, flooding compartmentation, handling (30.5 kn) and weapon values are shared game
  calibration, not historical measurements. Model fidelity and export checks do not certify historical accuracy.

Kongō heads the Japanese battleship line of the research tree in place of its placeholder.

```sh
python3 assets/ships/kongo/author-blueprint.py   # add --loft/--structures only to re-measure from .build/kongo
bun -e "import { writeLocalDamage } from './assets/ships/author-local-damage.ts'; await writeLocalDamage(['kongo'])"
bun assets/ships/author-flood-spaces.ts kongo && bun assets/ships/author-stability.ts kongo && bun assets/ships/author-damage-control.ts kongo
bun run ship:build kongo
bun run ship:review kongo
bun run ship:check kongo
```

Keep the current fixed views in `generated/review/`. Reference downloads, measurements and comparison captures stay
in ignored `.build/`.
