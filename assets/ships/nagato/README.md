# IJN Nagato

Nagato · 1944 exterior after the GameModels3D pjsb010 B hull · reference design waterline

Open `/?ship=nagato` or select this ship in port or Custom battle.

This is a legacy Blender-recipe preset (like Kongō, Takao, Alaska, Hood and Yamato), by explicit request, rather than a
construction ship. `blueprint.json` (written by `author-blueprint.py` from the measured loft in `authoring/lines.json`),
`build.py` and its modules are the durable inputs: `nagato_kit.py` (shared vocabulary: materials, primitives with
ownership, merged rails and wires, boats, searchlights, rangefinders, glazing), `nagato_fittings.py` (mount seats,
roofs, posts and the main director), `nagato_masts.py` (pagoda topmast and yards, rangefinders, directors, lights,
the tripod mainmast and aircraft crane jib, the funnel cap), `nagato_boats.py` (boats, boat cranes, davits, the
catapult), `nagato_hull.py` (deck gear, ground tackle, screws, rudders, bilge keels, the chrysanthemum) and
`nagato_rails.py`, plus two measured datum tables: `nagato_gear.py` (deck-gear positions and sizes) and
`nagato_windows.py` (windows and portholes). Reusable guns come from `assets/parts/`. Generated Blender scenes and
runtime models are build outputs.

## Approved brief

- **Vessel and fit:** IJN Nagato in 1944 as GameModels3D World of Warships vehicle
  [`pjsb010`](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pjsb010) shows her in configuration hull B:
  `B_Hull` with `AB1_Artillery`, `B_AirDefense` and the `AB_*` components (ATBA, Finders, AirArmament, Directors,
  AirSupport), the fuller 1944 anti-aircraft fit; both hulls use the one visual model `jsb010_nagato_1944`. Four twin
  41 cm/45 Type 3 turrets (No. 2 and No. 3 with their rangefinder housings, two 25 mm triples on each of their roofs),
  eighteen 14 cm/50 3rd Year Type casemates, four twin 12.7 cm/40 Type 89 high-angle mounts, 25 mm Type 96 in ten
  triple, twelve twin and twenty-four single mounts besides the four on the turret roofs, the pagoda foremast with its
  Type 94 director, 10 m, 4.5 m and 1.5 m rangefinders, two Type 91 high-angle directors, the tripod mainmast with the
  aircraft crane, a catapult (empty, as the reference stows it), six searchlights, two boat cranes and eight boats. The
  `AB_Radars` component the brief names does not exist on this vehicle; no radar is fitted.
- **Paint:** the reference's source (`default`) paint, as Kongō has: one blue-grey over hull and upperworks, grey steel
  roofs and casemate shelf, natural wood weather decks, a linoleum aircraft deck, a black funnel band and mast heads,
  the gold chrysanthemum on the stem. The reference paints its bottom a weathered red and green; following the fleet's
  appearance conventions (docs/ship-appearance.md) the bottom is plain red oxide to the waterline with no boot topping,
  and the game weathers it at runtime.
- **Reference policy:** GameModels3D only; no War Thunder, Sketchfab, photographs or plans. Model fidelity and export
  checks do not certify historical accuracy.

## Model and simulation basis

The hull is an original authored-stations loft (208 stations, 30 points each) measured with `bun run ship:lines` from
the cached reference in three spans sharing one frame and one set of levels: the stem to the forecastle break
(reference z −114.8 to −57.5, deck = forecastle deck), the casemate shelf (−57.5 to 12, deck capped at the shelf's
outer edge, 3.72 m) and the upper deck to the stern (12 to 110.4). The first span's deck detection caught No. 1
barbette's ring, the windlass beds and the breakwater; its deck follows the forecastle deck line cut at x = 2 m
(`ship:slice --section x=2`) instead, and each corrected station was re-levelled on its own measured outline. At the
reference's y = 0 design waterline it is 225.2 m overall, 34.6 m over the anti-torpedo bulges, 9.3 m keel draft and
41,897 t. The raised forecastle deck abaft the break (the casemate battery, 3.5 to 6.5 m, and its narrower
continuation aft to No. 3 barbette) is the 5.0 m plan outline of the reference, a measured prism; its volume counts
toward reserve buoyancy. The loft's runtime z is reference z + 2.2 m.

Superstructure prisms were grouped from `ship:slice pjsb010 --plan y --sym --parts hull` cuts every 0.1 m: a run of
levels whose outline stays within IoU 0.85 of its first is one prism with the outline of its middle level, a
single-level transition folds into the neighbour it matches, and each prism starting within 0.25 m of the surface
under it is carried down to it. In the pagoda and the after control position the window rows are real openings, so
those regions were re-cut with gaps up to 0.8 m bridged and the bridged area kept only where a roof stands within
1.6 m above it (a room behind windows, not open legs or railed platforms). Short vertical gaps up to 1.6 m between
stacked prisms are closed. The working circles of the open light mounts (25 mm and 12.7 cm) are cut out of every prism
beside or round them above their soles. The funnel is a stack of measured stadiums with its exhaust on the top one.

Mounts sit at the reference's HP_ datums (`bun run ship:hardpoints pjsb010`): the 41 cm turrets are the catalog's
`type3-410-nagato-twin` (Nos. 1 and 4), `-rf` (No. 2) and `-rf-aft` (No. 3), each built against this reference's own
gun visual; the 12.7 cm twins `type89-127-a1-twin` (built against `jgs009`, this reference's mount); the 25 mm triples
`type96-25-triple` (`jga173`), twins `type96-25-mogami-2` and singles `type96-25-kongo-single`. The 14 cm casemate is a
new part, `type3-140-nagato-casemate` (assets/parts/ijn-140-nagato/), measured from the reference's `jgs053` drum
casemate: the catalog's `type3-140-3year-single` is Kuma's open-backed shield deck mount and does not match. The main
barbettes are the measured 5.87 m drums. Nos. 2 and 3 turrets rest at 8° elevation: level, their barrels pass through
the lower turret's rear-roof arch and davit, as the reference's own turrets would. Every hull-mounted gun but the
casemates carries a `mountClearance` envelope (barrels with recoil, gunhouse or carriage box, the turrets' roof arch,
davit and rangefinder housings as capsules) against the prisms it can reach and its overlapping neighbours.

Fittings follow reference datums and the part bounds of the reference's deck gear: vents, bitts, fairleads, winches,
capstans, hatches, reels, lockers, lamps, life buoys, paravanes and accommodation ladders; bower, stern and sheet
anchors with cables from the hawse pipes to the forecastle capstan; the Type 94 director (which trains for the rig),
the 10 m, 4.5 m and 1.5 m rangefinders, the Type 91 directors, machine-gun control sights, periscopes, six searchlights
and their controls; the pagoda topmast with two signal yards; the tripod mainmast with its topmast, top yard, gaff,
signal blocks and the aircraft crane jib; the funnel's black band, rim, domed grating, steam pipes and ladder; the 17 m
and 11 m motor boats, 12 m launches, the 9 m cutter, the 6 m dinghy, the two jib boat cranes with their slung cutters,
davits and the stowed boom; the catapult on its turntable and the aircraft trolleys; four three-bladed screws on shafts
with brackets, the twin rudders and bilge keels. Windows and portholes were located on orthographic renders of the
reference's painted textures and seated on this model's own walls where they stand within 0.4 m of the reference's.

Machinery (four boiler rooms under the funnel, four turbine rooms between the funnel and No. 3 turret, four shafts),
magazines, flood spaces, stability and damage-control values are game estimates; the visual reference does not
establish internal plans. Protection (305 mm main belt on a line 10% inboard of the bulged loft, 229 mm lower and upper
belts, 76 mm lower side, 102 mm forward and after belts, 25 mm casemate battery plating, 102 mm armoured deck with 76 mm
slopes, 69 mm upper deck, 305 mm bulkheads and barbettes, a 369 mm conning tower and the steering-gear box) uses
commonly published Nagato figures as provisional game calibration: the repository's reference tools expose no armour
model for this vehicle.

## Accepted approximations

- Superstructure tiers are measured prisms: sloped faces step, tapered legs of the pagoda and mainmast are stepped or
  drawn as straight members, and small overhangs, open galleries and the pagoda's open framework are approximated; a
  few measured platforms stand on added posts.
- The casemate shelf beside the forecastle block is flat at its outer edge (3.72 m) where the reference's rises
  gently to the wall foot (4.0 m); the lower casemates stand on pedestals over it.
- The 14 cm casemate drums turn half inside their wall recesses, as the reference's do; `sweep-accepted.json` accepts
  those contacts and the neighbouring casemates meeting only when posed independently toward each other.
- A blueprint holds at most 64 mounts: the twelve 25 mm singles of the forecastle-head and quarterdeck groups are fixed
  fittings drawn with the same catalog recipe at their rest bearings. The two small davits abreast No. 1 turret are
  left out (they stand in its barrels' depressed sweep).
- Casemate arcs, the mainmast singles' arcs and depression, and some casemate stops are game estimates set by the
  sweep; the reference shows no mechanical stops.
- Windows and portholes come from the reference's painted textures, so painted vents and a few girder holes read as
  glazing; rigging, halyards and aerials are omitted.
- The boats' hulls use a light grey; boat and crane details, the catapult and the mast yards are simplified.
- Handling (25 kn), stability, mass distribution, flooding compartmentation, protection and weapon values are shared
  game calibration, not historical measurements.

Nagato takes the placeholder's place in the Japanese battleship line of the research tree.

```sh
python3 assets/ships/nagato/author-blueprint.py   # add --structures only to re-measure from .build/nagato
bun -e "import { writeLocalDamage } from './assets/ships/author-local-damage.ts'; await writeLocalDamage(['nagato'])"
bun assets/ships/author-flood-spaces.ts nagato && bun assets/ships/author-stability.ts nagato && bun assets/ships/author-damage-control.ts nagato
bun run ship:build nagato
bun run ship:review nagato
bun run ship:check nagato
```

Keep the current fixed views in `generated/review/`. Reference downloads, measurements and comparison captures stay
in ignored `.build/`.
