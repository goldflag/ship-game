# IJN Ise

Ise · 1944-45 hybrid battleship after the GameModels3D pjsb526 A hull · reference design waterline

Open `/?ship=ise` or select this ship in port or Custom battle.

This is a legacy Blender-recipe preset (like Alaska, Hood, Kongō and Takao), by explicit request, rather than a
construction ship. `blueprint.json` (written by `author-blueprint.py`), `build.py`, `ise_kit.py` (the shared
vocabulary, adapted from Kongō's kit), `ise_fittings.py` (bridge glazing, directors, rangefinders and radars,
masts, yards and cranes, searchlights, boats, catapults, the flight deck's trolley tracks and turntables, the
rocket launchers, ground tackle and deck gear, screws, shafts and rudders, rails), `ise_blocks.py` (a generated
table: measured blocks beyond the blueprint's 256-structure limit and the posts under unsupported blocks) and
`ise_windows.py` (a generated table of the reference's painted windows and portholes) are the durable inputs;
`measure-plan.ts` and `measure-windows.py` are the measurement scripts; the guns come from `assets/parts/`.
Generated Blender scenes and runtime models are build outputs.

## Approved brief

Approved by the owner on 2026-09-25.

- **Vessel and fit:** IJN Ise as the aircraft-carrying hybrid battleship after her 1943 conversion, in the
  1944-45 fit the reference shows: GameModels3D World of Warships vehicle
  [`pjsb526`](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pjsb526), configuration A hull (the only
  one), visual model `jsb048_ise_hybrid_1945`, every component. Four twin 35.6 cm/45 Type 41 turrets (Nos. 1-4);
  the hangar and the after flight deck in place of Nos. 5 and 6, with two catapults (empty); heavy 12.7 cm and
  25 mm anti-aircraft batteries; the 12 cm AA rocket launchers the reference carries.
- **Paint:** the reference's source ("default") paint, as on Kongō; the fleet's appearance conventions
  (`docs/ship-appearance.md`) where the source shows nothing.
- **Reference policy:** GameModels3D only; no other models, photographs or plans.
- **Gameplay:** a battleship (identity type `Battleship`). The flight deck, hangar and catapults are structure and
  fittings only: no air wing and no deck operations (the blueprint carries no `airWing`, which is what makes a
  carrier in the simulation); the catapults are empty; the rocket launchers are visual fittings unless an existing
  weapon type fits them (none does, see below).

## Model and simulation basis

The fit as built: eight open twin 12.7 cm/40 Type 89; 25 mm Type 96 in twenty-seven triple and eleven single
mounts; six 12 cm 28-tube rocket launchers on the after gallery; a Type 94 director and 10 m rangefinder with the
Type 21 mattress on the pagoda, Type 94 high-angle directors abreast it, 1.5 m and 4.5 m rangefinders, six 25 mm
control positions, Type 22 radars on the pagoda and Type 13 on the after mast, the after tower's director, eight
searchlights, the boat crane, the stern aircraft crane, and boats (a 17 m motor boat, two 12 m motor launches, five
9 m cutters, a 6 m dinghy and two 14 m landing craft). The fleet's IJN ensign flies from the after mast's gaff.
Armour zones and thicknesses come from the reference's public armour model (`jsb048_ise_hybrid_1945` armour and the
`jgm191` turret armour).

The source's default paint is one blue-grey over hull and upperworks (its texture, seen unlit, is linear
0.133, 0.147, 0.181 on the hull sides and 0.127, 0.138, 0.168 on the pagoda; the light and dark patches its lit
renders show are shadows of the flight deck, sponsons and platforms, not a pattern). The model paints it
`ise-reference-grey` (0.128, 0.140, 0.170), with grey steel roofs and flight deck, natural wood weather decks, a
black funnel cap and mast head and a red-oxide bottom without boot topping; the swatches are linear-RGB
interpretations of the reference's texture, not measured historical paint.

The hull is an original authored-stations loft: 228 stations of 31 points from `bun run ship:lines` with dense
upper levels (0.12 to 1 of the height from 1.5 m to the deck, bracketing the old casemate ledge at 0.567), 215.0 m
overall, 33.82 m over the anti-torpedo bulges and 9.42 m to the keel at the reference's y = 0 design waterline,
40,975 t there. Between the hangar's ends (reference z 41.9 to 91.05) the hangar walls run flush with the hull, so
the loft there comes from a second run capped at 4.87 m and brought down to the upper deck (4.51 m forward, rising
to the quarterdeck's 4.85 m). The forecastle wall is a sawtooth in plan (each former 14 cm casemate embrasure is a
V-shaped recess with a rounded cap at its foot); it is sampled every 0.5 m at 5.6 m (the wall) and 5.1 m (the
caps) and written into the loft's upper levels. Stations where the tool followed deck-edge fittings (a ledge taken
for the deck over No. 1 turret, anchor bolsters and fairleads at the stern) are dropped.

Superstructure blocks are measured (`measure-plan.ts`): plan cuts of the reference's hull group every 5 cm from
4.57 to 44 m, mirrored, features under 0.3 m dropped, gaps closed up to 0.6 m below 15 m and 0.25 m above, are
rasterised on a 10 cm grid. Each grid column's solid runs (bridging 15 cm gaps below 12 m and 1.2 m above) start
and end at heights snapped to the levels where many columns start or end (decks, roofs, platforms) or to steps
that grow with the run (0.3, 0.6 and 1 m), a column whose ends few others share joins its neighbour's block, and
columns sharing a start and an end form a block traced back to an outline, split where it would enclose a hole
and straightened only as far as the simulation's ear clipping can still cap it. Cleared first: the hull below its
own deck, whole-hull cuts, each main turret's barbette well (the recipe draws the barbettes, and the breeches swing
down into them), and each secondary and AA mount's working space (the carriage circle, and for the 25 mm mounts
the barrels' reach over their arc); a tub floor that ends a few centimetres over a gun's seat inside its carriage
circle ends under it. The 232 blocks with the most visible surface (those the 12.7 cm barrels reach first) are
blueprint structures (hits, supports, interlocks); the rest are drawn from `ise_blocks.py`. The pagoda's three
glazed fronts (the lower bridge's wedge, the upper bridge's pointed room and the compass room over it) are thin
shells in the reference that enclose no solid, so the raster leaves them open; they are added as rooms outlined on
thin-wall cuts (`measure-plan.ts --thin`). The funnel's topmost block carries the exhaust datum (open top at
26.0 m, centred 3.55 m abaft reference midships) and is painted black above 23 m. Blocks resting on nothing, whose
lattice legs and knees are under the plan cuts' minimum, stand on posts found from a contact graph of the blocks;
posts within a turret's or 12.7 cm mount's reach are firing obstructions too.

Windows and portholes are the reference's painted ones (`measure-windows.py` reads them off orthographic textured
renders of the reference, and the depth of each one's wall off the thin-wall cuts); the recipe glazes each where
this model's own wall faces the view within 39 degrees and stands within 0.5 m of the reference's.

Mounts sit at the reference hardpoints. The main turrets are the Kongō 1942 twin (`type41-356-kongo-1942-twin`,
the Ise-class gunhouse is within 0.2 m of it in width and bore height, 14.15 against 14.34 m of muzzle reach), its
yaw datum 3.336 m under the hardpoint so the bore axes match, on 9.6 m barbettes measured from the reference; the
superfiring Nos. 2 and 3 stand 0.15 m higher still (see the approximations). The 12.7 cm twins are
`type89-127-yamato-open-twin` (built against `jgs158`, this reference's own visual); the 25 mm triples
`type96-25-triple` (built against `jga173`, whose datums match this reference's `jga181` to the centimetre); the
singles `type96-25-kongo-single` (the same shared single Takao uses; its ring sight is carried on cross-wires as on
Takao). The 12 cm rocket launchers are visual fittings in the recipe: the simulation has no rocket weapon type, so
they neither train nor fire. Every mount stands on a seat down to its platform.

Interlocks (`mountClearance`, installation envelopes): the main turrets' and 12.7 cm mounts' barrels, with the full
recoil stroke, against the 128 nearest blueprint structures and every obstruction box; the gunhouse bodies from the
3.4 m working floor to the 6.0 m roof (the upper turret of each superfiring pair from 3.8 m, so the pair's bodies
never meet in height and train together to either beam); the lower turret's roof guard rail as a chain of thin
capsules; neighbours: each superfiring pair, and No. 2 with the forward 12.7 cm pair abaft it. Obstruction boxes:
blocks in fore-and-aft strips (2 m within an interlocked mount's reach, boxed only where the block fills the whole
strip; 10 m elsewhere), the drawn blocks beyond the structure limit that the main barrels can reach, the posts near
interlocked mounts, the stowed boats, the dinghy, and the catapult girders in eighteen boxes along each slant.

Machinery (four boiler rooms between Nos. 2 and 3 turrets, four turbine rooms abaft No. 4, four shafts), magazines,
flood spaces, stability (GM 7% of beam) and damage-control values are game estimates; the visual reference does not
establish internal plans. Protection follows the reference's armour model, fitted to the loft: the 299 mm main
belt with its 200 mm lower edge and the 199 mm upper belt on the original shell inside the bulges, the 149 mm side
over the uptakes, the armoured deck at 0.72 m (167 mm over the forward magazines, 57 mm over the boilers, 152 mm
abaft No. 3 turret) with 32 mm slopes, 44 mm upper deck, the transverse bulkheads, 299 mm barbettes, the 265 mm
conning tower and the 100 mm after belt and 51 mm deck over the steering gear.

## Accepted approximations

From the approved brief: no air wing or deck operations, empty catapults, the rocket launchers as visual fittings,
GameModels3D as the only reference.

## Known limitations

These are the model's own approximations and gaps, not yet reviewed by the owner.

- **After turrets' arcs:** as the reference places them, the stowed catapults' girders stand at the height of
  No. 3's barrels beside No. 4, and the catapult sponsons and girders flank No. 4. Below 6 degrees of elevation
  No. 3 trains only 27 degrees either side of astern; it clears the girders to the beam from 9 degrees. No. 4
  trains 45 degrees either side of astern at low elevation and 46 to 56 degrees at 10 to 30 degrees, reaching the
  beam only between about 6 and 9 degrees. Nos. 1 and 2 reach both beams at every elevation. The mount-rest test
  lists Ise among the presets that stop short of a beam.
- The displacement at the reference waterline (40,975 t, 9.42 m keel draft) is the reference's loading, heavier
  than the published full load for the class; the stated mass equals the loft's displacement.
- Superstructure blocks are stepped prisms at 10 cm in plan and 5 cm in height: sloped and curved faces step,
  small overhangs and window bands are filled, open galleries and tubs with bulwarks read as solid platforms, the
  lower bridge's forward director tub is solid, and fittings under 0.3 m (rails, ladders, lattice legs) are left to
  the recipe or replaced by posts. Thin plates high over open space whose brackets fall under that minimum (two
  yard platforms on the pagoda) are left out.
- The Kongō 1942 gunhouse stands in for the Ise-class one (0.9 m shorter at the base, 0.2 m more muzzle reach);
  its roof guard rail, which the reference's gunhouses lack, is why the superfiring Nos. 2 and 3 stand 0.15 m over
  their hardpoints (the rail then passes under the upper gunhouse's floor where the after overhangs cross) and why
  the forecastle dinghy sits on low chocks 0.33 m under the reference's (No. 1's after overhang sweeps over its
  stern). The turret roofs carry no rangefinders, as in the reference.
- The 25 mm singles reuse the Kongō single (its muzzle 15 cm lower at 30 degrees than the reference's `jga174`).
- The rocket launchers, catapults, cranes, masts, directors, radars, searchlights, boats, screws and rudders are
  simplified original constructions at the reference's positions and sizes; the catapults are empty. The flight
  deck's trolley tracks and turntables follow the reference's plan as bright 10 cm rails and rimmed plates; its
  three aircraft cradles, ready-use lockers and the recessed centre track are not modelled.
- Handling (25.3 kn), stability, mass distribution, flooding compartmentation and weapon values are shared game
  calibration, not historical measurements. Model fidelity and export checks do not certify historical accuracy.

Ise stands in the Japanese battleship line of the research tree after its Ise placeholder (1917, the class's year;
the type string carries the conversion).

```sh
bun run ship:reference pjsb526            # A hull, every component
bun run ship:lines ise --high 0.12,0.25,0.38,0.47,0.555,0.58,0.65,0.73,0.82,0.91,1 --out .build/ise/lines-a.json
bun run ship:lines ise --high 0.12,0.25,0.38,0.47,0.555,0.58,0.65,0.73,0.82,0.91,1 --deck-below 4.87 --out .build/ise/lines-b.json
bun assets/ships/ise/measure-plan.ts .build/ise/plan-cuts.json           # superstructure plan cuts
bun assets/ships/ise/measure-plan.ts --thin .build/ise/thin-cuts.json    # the towers' thin walls
python3 assets/ships/ise/measure-windows.py                             # writes ise_windows.py
python3 assets/ships/ise/author-blueprint.py --lines .build/ise/lines-a.json --lines-capped .build/ise/lines-b.json --plan .build/ise/plan-cuts.json
bun -e "import { writeLocalDamage } from './assets/ships/author-local-damage.ts'; await writeLocalDamage(['ise'])"   # first time only
bun assets/ships/author-flood-spaces.ts ise && bun assets/ships/author-stability.ts ise && bun assets/ships/author-damage-control.ts ise
bun run ship:build ise
bun run ship:review ise
bun run ship:check ise
```

Without measurement files `author-blueprint.py` keeps the blueprint's hull stations and structures and the
`ise_blocks.py` blocks. Keep the current fixed views in `generated/review/`. Reference downloads, measurements and
comparison captures stay in ignored `.build/`.
