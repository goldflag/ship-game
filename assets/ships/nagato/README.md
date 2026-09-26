# IJN Nagato

Nagato · 1944 exterior after the GameModels3D pjsb010 B hull · reference design waterline

Open `/?ship=nagato` or select this ship in port or Custom battle.

This is a legacy Blender-recipe preset (like Kongō, Takao, Alaska, Hood and Yamato), by explicit request, rather than a
construction ship. `blueprint.json` (written by `author-blueprint.py` from the measured loft in `authoring/lines.json`),
`build.py` and its modules are the durable inputs: `nagato_kit.py` (shared vocabulary: materials, primitives with
ownership, merged rails and wires, boats, searchlights, rangefinders, glazing), `nagato_fittings.py` (mount seats,
roof paint, posts, the gun decks' splinter screens, the funnel's searchlight towers and the main director),
`nagato_masts.py` (pagoda topmast and yards, rangefinders, directors, lights, the tripod mainmast and aircraft crane
jib, the funnel cap, sirens and lattice), `nagato_boats.py` (boats, boat cranes, davits, the catapult, the aircraft
deck's strips, tracks and turntables), `nagato_hull.py` (deck gear, ground tackle, screws, rudders, bilge keels, the
chrysanthemum, staffs and propeller guards) and `nagato_rails.py`, plus three measured datum tables: `nagato_gear.py`
(deck-gear positions and sizes), `nagato_windows.py` (windows and portholes) and `nagato_tiers.py` (the open tiers of
the pagoda and the mainmast).
Reusable guns come from `assets/parts/`. Generated Blender scenes and runtime models are build outputs.

## Approved brief

- **Vessel and fit:** IJN Nagato in 1944 as GameModels3D World of Warships vehicle
  [`pjsb010`](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pjsb010) shows her in configuration hull B:
  `B_Hull` with `AB1_Artillery`, `B_AirDefense` and the `AB_*` components (ATBA, Finders, AirArmament, Directors,
  AirSupport), the fuller 1944 anti-aircraft fit; both hulls use the one visual model `jsb010_nagato_1944`. Four twin
  41 cm/45 Type 3 turrets (No. 2 and No. 3 with their rangefinder housings, two 25 mm triples on each of their roofs),
  eighteen 14 cm/50 3rd Year Type casemates, four twin 12.7 cm/40 Type 89 high-angle mounts, 25 mm Type 96 in ten
  triple, twelve twin and twenty-four single mounts besides the four on the turret roofs, the pagoda foremast with its
  Type 94 director, 10 m, 4.5 m and 1.5 m rangefinders, two Type 91 high-angle directors, the tripod mainmast with the
  aircraft crane, a catapult (empty, as the reference stows it), six searchlights, two boat cranes and nine boats. The
  `AB_Radars` component the brief names does not exist on this vehicle; no radar is fitted.
- **Paint:** the reference's source (`default`) paint, as Kongō has: one blue-grey over hull and upperworks, natural
  wood weather decks and 01 and 02 decks round the pagoda and funnel, grey steel roofs, casemate shelf, deck-edge
  sponsons and the forecastle head's chain deck, a linoleum aircraft deck with pale strips from deck edge to deck edge,
  a black funnel band, a black mainmast above 22.65 m and the pagoda's black topmast, the gold chrysanthemum on the
  stem. The reference paints its bottom a weathered red and green; following the fleet's
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
(`ship:slice --section x=2`) instead, and each corrected station was re-levelled on its own measured outline. The
stations forward of reference z −98.5 were re-measured on station cuts to the true stem and forefoot (`ship:lines`
had cut the stem back by up to 1.4 m), and at two stern stations the points by the propeller guards were re-set on
the shell under the guards' rails. At the reference's y = 0 design waterline it is 225.2 m overall, 34.6 m over the
anti-torpedo bulges, 9.3 m keel draft and 41,901 t. The raised forecastle deck abaft the break (the casemate battery,
3.5 to 6.5 m, and its narrower continuation aft to No. 3 barbette) is the 5.0 m plan outline of the reference, a
measured prism; its volume counts toward reserve buoyancy. The loft's runtime z is reference z + 2.2 m.

Superstructure prisms were grouped from `ship:slice pjsb010 --plan y --sym --parts hull` cuts every 0.1 m: a run of
levels whose outline stays within IoU 0.85 of its first is one prism with the outline of its middle level, a
single-level transition folds into the neighbour it matches, and each prism starting within 0.25 m of the surface
under it is carried down to it. In the pagoda and the after control position the window rows are real openings, so
those regions were re-cut with gaps up to 0.8 m bridged and the bridged area kept only where a roof stands within
1.6 m above it (a room behind windows, not open legs or railed platforms). Short vertical gaps up to 1.6 m between
stacked prisms are closed. The working circles of the open light mounts (25 mm and 12.7 cm) are cut out of every prism
beside or round them above their soles. The funnel is a stack of measured stadiums with its exhaust on the top one.
Three pieces the plan cuts cannot see because they are single plates were cut as sections instead: the compass
bridge's windscreen (a prism at 19.05-20.45 m, section y=19.7), and two decks with their bulwarks, the deck under the
compass bridge at 17.9 m and the deck abaft the pagoda at 17.4 m where the two pagoda 25 mm singles stand (sections
y=17.6, 18.2 and 18.7, deck heights from vertical probes).

Where a pagoda or mainmast prism stands for legs, the central tube, fins and bulwarks with open space between them
(under half of its footprint solid in the reference's own sections: 35 prisms), the model draws what those sections
show instead of the solid block: the reference is cut every 0.1 m through the prism (`ship:slice pjsb010 --section
y=...`), runs of similar cuts are drawn from their middle cut as columns and 6 cm walls, and the decks and ceilings that
vertical probes (`--probe x,z`) cross within its height become 8 cm plates; the two decks above are drawn the same way.
The blueprint keeps the measured prisms as the combat volumes. The mainmast's tripod legs are struts from the after
control deck to the 28.75 m platform, on the line through their plan-cut centres, and the trunk under the 23.65 m
platform is a 0.76 m square post; the reference paints the whole mainmast black above 22.65 m.

Mounts sit at the reference's HP_ datums (`bun run ship:hardpoints pjsb010`): the 41 cm turrets are the catalog's
`type3-410-nagato-twin` (Nos. 1 and 4), `-rf` (No. 2) and `-rf-aft` (No. 3), each built against this reference's own
gun visual; the 12.7 cm twins `type89-127-a1-twin` (built against `jgs009`, this reference's mount); the 25 mm triples
`type96-25-triple` (`jga173`), twins `type96-25-mogami-2` and singles `type96-25-kongo-single`. The 14 cm casemate is a
new part, `type3-140-nagato-casemate` (assets/parts/ijn-140-nagato/), measured from the reference's `jgs053` drum
casemate: the catalog's `type3-140-3year-single` is Kuma's open-backed shield deck mount and does not match. The main
barbettes are the measured 5.87 m drums. Nos. 2 and 3 turrets rest at 8° elevation, their barrels astride the lower
turret's rear-roof arch and davit. Every hull-mounted gun but the casemates carries a `mountClearance` envelope (barrels
with recoil, gunhouse or carriage box, and for the turrets their tapered faces and after ends and the rangefinder end
hoods and sight hood as capsules, measured on the catalog turrets) against the prisms it can reach and its overlapping
neighbours; with it all four turrets train together from rest to either beam.

Fittings follow reference datums and the part bounds of the reference's deck gear: vents, bitts, fairleads, winches,
capstans, hatches, reels, lockers, lamps, life buoys, paravanes and accommodation ladders; bower, stern and sheet
anchors with cables from the hawse pipes to the forecastle capstan; the Type 94 director (which trains for the rig),
the 10 m, 4.5 m and 1.5 m rangefinders, the Type 91 directors, machine-gun control sights, periscopes, six searchlights
and their controls; the pagoda topmast with two signal yards; the tripod mainmast with its upright pole, the 10.5 m
top yard with its braces and lifts, the masthead gaff (the ensign flies from its peak at sea), the lower gaff, the
signal blocks forward of the trunk and the aircraft crane jib; the funnel's black band, rim, domed grating, steam
pipes, ladder and sirens, the X-braced lattice under its searchlight and 25 mm platforms and the two four-legged
searchlight towers (plan cuts y = 9.6 to 17); the splinter-screened gun decks round the 25 mm triples on the decks
(section y = 4.6 through the reference's gun-deck parts); the two 17 m and one 11 m motor boats, two 12 m launches, the
9 m cutter, the 6 m dinghy, the two jib boat cranes with their slung cutters, davits and the stowed boom; the catapult
on its turntable, the aircraft trolleys on their two tracks with four turntables and the aircraft deck's pale
strips; the jack staff and the raked ensign staff
(profile x = 0) and a propeller guard over each outer screw (plan cuts y = 1.3 to 1.45); four three-bladed screws with
broad blades, each on a shaft with its hull bossing, bearing housing and single bracket strut leaning into the hull
(plan cuts at the shaft heights, station cuts at the brackets), the twin rudders with rounded corners hung on their
stocks clear of the hull (profile cut x = 2.3) and bilge keels. Windows and portholes were located on orthographic
renders of the reference's painted textures and seated on this model's own walls where they stand within 0.4 m of the
reference's; the compass bridge's windscreen carries its band of 0.6 m panes every 0.74 m, 0.93 m tall on its face and
1.2 m on its sides, and the after control room its band of four windows on each quarter, measured on the same
renders.

Machinery (four boiler rooms under the funnel, four turbine rooms between the funnel and No. 3 turret, four shafts),
magazines, flood spaces, stability and damage-control values are game estimates; the visual reference does not
establish internal plans. Protection (305 mm main belt on a line 10% inboard of the bulged loft, 229 mm lower and upper
belts, 76 mm lower side, 102 mm forward and after belts, 25 mm casemate battery plating, 102 mm armoured deck with 76 mm
slopes, 69 mm upper deck, 305 mm bulkheads and barbettes, a 369 mm conning tower and the steering-gear box) uses
commonly published Nagato figures as provisional game calibration: the repository's reference tools expose no armour
model for this vehicle.

## Accepted approximations

- Superstructure tiers are measured prisms: sloped faces step, and the pagoda's and mainmast's inclined legs are
  stepped columns of their open tiers or straight struts. The open tiers are drawn from one cut per run of similar
  cuts, so walls and legs step at run boundaries; their gameplay volumes stay solid prisms. The two control drums
  abreast the funnel stand on columns; the flying catwalks abaft the pagoda top are not modelled.
- The casemate shelf beside the forecastle block is flat at its outer edge (3.72 m) where the reference's rises
  gently to the wall foot (4.0 m); the lower casemates stand on pedestals over it.
- The 14 cm casemate drums turn half inside their wall recesses, as the reference's do; `sweep-accepted.json` accepts
  those contacts and the neighbouring casemates meeting only when posed independently toward each other.
- A blueprint holds at most 64 mounts: the twelve 25 mm singles of the forecastle-head and quarterdeck groups are fixed
  fittings drawn with the same catalog recipe at their rest bearings. The two small davits abreast No. 1 turret are
  left out (they stand in its barrels' depressed sweep).
- Nos. 2 and 3 turrets' barrels pass through the lower turret's rear-roof arch and davit when laid below about 8°
  within about 15° of the centreline, or posed apart from it, as the reference's own turrets would; the arch and davit
  are left out of the motion envelope because the simulation stalls a superfiring pair training together over them
  (`sweep-accepted.json`). A sweep ignoring those two meshes finds no other contact between the turrets.
- Casemate arcs, the arcs of the mainmast singles and of the two singles abaft the pagoda, the mainmast singles'
  depression, the 5° depression of the nine 25 mm triples inside the splinter-screened gun decks (their barrels
  reach the 0.62 m screens' tops below it), some casemate stops and No. 1 turret's stop at the stowed dinghy are game
  estimates set by the sweep; the reference shows no mechanical stops.
- Windows and portholes come from the reference's painted textures, so painted vents and a few girder holes read as
  glazing; rigging, halyards and aerials are omitted apart from the mainmast's lifts and peak halyards and the crane's
  topping lift.
- The boats' hulls use a light grey; boat and crane details, the catapult and the mast yards are simplified. The
  branch tracks from the aircraft deck's turntables toward the catapult are left out, and the funnel carries three
  steam pipes where the reference runs six round its after face.
- The loft takes the keel where the shell comes within 0.3 m of the centre line, so the narrow skeg on the centre line
  ahead of the twin rudders (runtime z 76 to 85, up to 1.2 m deep) is left out.
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
