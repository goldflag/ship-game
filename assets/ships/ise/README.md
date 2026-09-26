# IJN Ise

Ise · 1944-45 hybrid battleship after the GameModels3D pjsb526 A hull · reference design waterline

Open `/?ship=ise` or select this ship in port or Custom battle.

This is a legacy Blender-recipe preset (like Alaska, Hood, Kongō and Takao), by explicit request, rather than a
construction ship. `blueprint.json` (written by `author-blueprint.py`), `build.py`, `ise_kit.py` (the shared
vocabulary, adapted from Kongō's kit), `ise_fittings.py` (directors, rangefinders and radars, masts, yards and
cranes, searchlights, boats, catapults, the rocket launchers, ground tackle and deck gear, screws, shafts and
rudders, rails) and `ise_blocks.py` (a generated table: measured blocks beyond the blueprint's 256-structure limit
and the posts under unsupported blocks) are the durable inputs; the guns come from `assets/parts/`. Generated
Blender scenes and runtime models are build outputs.

## Approved brief

Approved by the owner on 2026-09-25.

- **Vessel and fit:** IJN Ise as the aircraft-carrying hybrid battleship after her 1943 conversion, in the
  1944-45 fit the reference shows: GameModels3D World of Warships vehicle
  [`pjsb526`](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pjsb526), configuration A hull (the only
  one), visual model `jsb048_ise_hybrid_1945`, every component. Four twin 35.6 cm/45 Type 41 turrets (Nos. 1-4);
  the hangar and the after flight deck in place of Nos. 5 and 6, with two catapults (empty); eight open twin
  12.7 cm/40 Type 89; 25 mm Type 96 in twenty-seven triple and eleven single mounts; six 12 cm 28-tube AA rocket
  launchers on the after gallery (the reference carries them); a Type 94 director and 10 m rangefinder with the
  Type 21 mattress on the pagoda, Type 94 high-angle directors abreast it, 1.5 m and 4.5 m rangefinders, six 25 mm
  control positions, Type 22 radars on the pagoda and Type 13 on the after mast, the after tower's director,
  eight searchlights, the boat crane, the stern aircraft crane, and boats (a 17 m motor boat, two 12 m motor
  launches, five 9 m cutters, a 6 m dinghy and two 14 m landing craft).
- **Paint:** the reference's source ("default") paint: grey hull and upperworks, grey steel roofs and flight deck,
  natural wood weather decks, a black funnel cap and mast head, a red-oxide bottom without boot topping. Where the
  source shows nothing, the fleet's appearance conventions (`docs/ship-appearance.md`) apply; the fleet's IJN
  ensign flies from the after mast's gaff.
- **Reference policy:** GameModels3D only; no other models, photographs or plans. Armour zones and thicknesses come
  from the reference's public armour model (`jsb048_ise_hybrid_1945` armour and the `jgm191` turret armour); other
  gameplay values are provisional game calibration.
- **Gameplay:** a battleship (identity type `Battleship`). The flight deck, hangar, catapults and
  aircraft-handling gear are structure and fittings only: the blueprint carries no `airWing` (so no squadrons,
  deck layout, launch or recovery), and nothing else in the simulation reads the hangar or flight deck as
  aviation. The catapults are empty, as on the other presets.

## Model and simulation basis

The hull is an original authored-stations loft: 228 stations of 31 points from `bun run ship:lines` with dense
upper levels (0.12 to 1 of the height from 1.5 m to the deck, bracketing the old casemate ledge at 0.567), 215.0 m
overall, 33.82 m over the anti-torpedo bulges and 9.42 m to the keel at the reference's y = 0 design waterline,
40,975 t there. Between the hangar's ends (reference z 41.9 to 91.05) the hangar walls run flush with the hull, so
the loft there comes from a second run capped at 4.87 m and brought down to the upper deck (4.51 m forward, rising
to the quarterdeck's 4.85 m). The forecastle wall is a sawtooth in plan (each former 14 cm casemate embrasure is a
V-shaped recess with a rounded cap at its foot); it is sampled every 0.5 m at 5.6 m (the wall) and 5.1 m (the
caps) and written into the loft's upper levels. Stations where the tool followed deck-edge fittings (a ledge taken
for the deck over No. 1 turret, anchor bolsters and fairleads at the stern) are dropped.

Superstructure blocks are measured: plan cuts of the reference's hull group every 5 cm from 4.57 to 44 m (mirrored,
gaps up to 1.2 m bridged, features under 0.3 m dropped) are rasterised on a 10 cm grid; each grid column's solid
runs start and end at heights snapped to the levels where many columns start or end (decks, roofs, platforms) or
to 30 cm steps, and columns sharing a start and an end form a block traced back to an outline, split where it
would enclose a hole. The hull below its own deck, whole-hull cuts and each secondary and AA mount's working space
(the carriage circle, and for the 25 mm mounts the barrels' reach over their arc) are cleared first. The 232 blocks
with the most visible surface are blueprint structures (hits, supports, interlocks); the rest are drawn from
`ise_blocks.py`. The funnel's topmost block carries the exhaust datum (open top at 26.0 m, centred 3.55 m abaft
reference midships) and is painted black above 23 m. Blocks resting on nothing, whose lattice legs and knees are
under the plan cuts' minimum, stand on posts; posts within a turret's or 12.7 cm mount's reach are firing
obstructions too.

Mounts sit at the reference hardpoints. The main turrets are the Kongō 1942 twin (`type41-356-kongo-1942-twin`,
the Ise-class gunhouse is within 0.2 m of it in width and bore height, 14.15 against 14.34 m of muzzle reach), its
yaw datum 3.336 m under the hardpoint so the bore axes match, on 9.6 m barbettes measured from the reference. The
12.7 cm twins are `type89-127-yamato-open-twin` (built against `jgs158`, this reference's own visual); the 25 mm
triples `type96-25-triple` (built against `jga173`, whose datums match this reference's `jga181` to the
centimetre); the singles `type96-25-kongo-single` (the same shared single Takao uses; its ring sight is carried on
cross-wires as on Takao). The 12 cm rocket launchers are visual fittings in the recipe: the simulation has no rocket
weapon type, so they neither train nor fire. Every mount stands on a seat down to its platform.

Machinery (four boiler rooms between Nos. 2 and 3 turrets, four turbine rooms abaft No. 4, four shafts), magazines,
flood spaces, stability (GM 7% of beam) and damage-control values are game estimates; the visual reference does not
establish internal plans. Protection follows the reference's armour model, fitted to the loft: the 299 mm main
belt with its 200 mm lower edge and the 199 mm upper belt on the original shell inside the bulges, the 149 mm side
over the uptakes, the armoured deck at 0.72 m (167 mm over the forward magazines, 57 mm over the boilers, 152 mm
abaft No. 3 turret) with 32 mm slopes, 44 mm upper deck, the transverse bulkheads, 299 mm barbettes, the 265 mm
conning tower and the 100 mm after belt and 51 mm deck over the steering gear.

## Accepted approximations

- The displacement at the reference waterline (40,975 t, 9.42 m keel draft) is the reference's loading, heavier
  than the published full load for the class; the stated mass equals the loft's displacement.
- Superstructure blocks are stepped prisms at 10 cm in plan and 5 cm in height: sloped and curved faces step,
  small overhangs, open galleries and window bands under 1.2 m are filled, and fittings under 0.3 m (rails,
  ladders, lattice legs) are left to the recipe or replaced by posts. Thin plates high over open space whose
  brackets fall under that minimum (two yard platforms on the pagoda) are left out.
- The Kongō 1942 gunhouse stands in for the Ise-class one (0.9 m shorter at the base, 0.2 m more muzzle reach);
  the turret roofs carry no rangefinders, as in the reference.
- The 25 mm singles reuse the Kongō single (its muzzle 15 cm lower at 30 degrees than the reference's `jga174`).
- The rocket launchers, catapults, cranes, masts, directors, radars, searchlights and boats are simplified original
  constructions at the reference's positions and sizes; the catapults are empty.
- The superfiring turrets' interlock envelopes reach the lower turret's roof rails and the upper turret's blast
  bags, where the meshes meet; the catapult girders, the forecastle dinghy and the superfiring barbettes are firing
  obstructions for the turrets beside them.
- Handling (25.3 kn), stability, mass distribution, flooding compartmentation and weapon values are shared game
  calibration, not historical measurements. Model fidelity and export checks do not certify historical accuracy.

Ise stands in the Japanese battleship line of the research tree after its Ise placeholder (1917, the class's year;
the type string carries the conversion).

```sh
bun run ship:reference pjsb526            # A hull, every component
bun run ship:lines ise --high 0.12,0.25,0.38,0.47,0.555,0.58,0.65,0.73,0.82,0.91,1 --out .build/ise/lines-a.json
bun run ship:lines ise --high 0.12,0.25,0.38,0.47,0.555,0.58,0.65,0.73,0.82,0.91,1 --deck-below 4.87 --out .build/ise/lines-b.json
# plan cuts: ship:slice --plan <y> --sym --parts hull --close 0.6 every 5 cm from 4.57 to 44 m, one JSON keyed by level
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
