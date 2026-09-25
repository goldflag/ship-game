# IJN Takao

Takao · 1944 exterior after the GameModels3D pjsc708 default fit (Takao-class 1944 hull) · reference design waterline

Open `/?ship=takao` or select this ship in port or Custom battle.

This is a legacy Blender-recipe preset (like Alaska, Hood, Kongō and Mogami), by explicit request, rather than a
construction ship. `blueprint.json` (written by `author-blueprint.py`), `build.py`, `takao_kit.py` (shared vocabulary:
materials, primitives, barbettes, merged rails and wires), `takao_fittings.py` (torpedo rooms and mounts, masts and
crane, catapults, directors, rangefinders, radars, searchlights, boats, deck gear and underwater gear) and
`takao_windows.py` (bridge glazing) are the durable inputs; the guns come from `assets/parts/`. Generated Blender
scenes and runtime models are build outputs.

## Approved brief

- **Vessel and fit:** IJN Takao as she stood about 1944. GameModels3D offers Takao only as the World of Warships
  collaboration premium "ARP Takao",
  [`pjsc708`](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pjsc708); its default configuration (not the
  Fleet of Fog skins, whose hull is `jsc507_takao_1944_arpeggio`) is the historical Takao-class 1944 model, geometry
  `jsc038_atago_1944`, the same hull and fit as Atago (`pjsc038`). The model is Atago's; Takao and Atago were sister
  ships in near-identical 1944 fits, and no Takao-named 1944 geometry exists on GameModels3D, so that fit is taken as it
  stands: five twin 20.3 cm/50 Model E turrets (Nos. 2 and 4 with the roof rangefinder, No. 3 trained aft), four open
  twin 12.7 cm/40 Type 89, 25 mm Type 96 in six triple, six twin and thirty single mounts, four quadruple 610 mm torpedo
  mounts, two Type 94, two Type 91 and two Type 95 directors, 6 m, 4.5 m and 1.5 m rangefinders, Type 21, Type 22 and
  Type 13 radars, two catapults (empty) with the aircraft crane on the mainmast, four searchlights and five boats.
- **Paint:** the reference's plain (default) scheme: one grey over hull and upperworks, darker grey steel roofs and
  platforms, red-brown linoleum over the weather decks and the aircraft deck (steel at the forecastle head and the stern),
  black funnel caps and a red-oxide bottom without boot topping; the gold chrysanthemum on the stem. The fleet's IJN
  ensign flies from the mainmast gaff.
- **Reference policy:** GameModels3D only; no historical photographs, plans or other models. Armour zones and
  thicknesses come from the reference's armour model (`jsc038_atago_1944` armour); other gameplay values are provisional
  game calibration.

## Model and simulation basis

The hull is an original authored-stations loft: 241 stations of 41 points, cut from the reference's hull shell and
bulges (bilge keels, shafts, brackets and rudder left out; the shelter deck over the torpedo rooms is a block, not hull),
sampled by arc length from the keel to the weather-deck edge and faired along the length (jitter only, at most 5 cm).
At the reference's y = 0 design waterline it is 203.96 m overall (201.4 m on the waterline), 20.2 m over the bulges,
19.2 m on the waterline, 7.14 m to the keel and 16,970 t. The flared, raked stem and forefoot, the sheer from 7.0 m at
the stem head down to 3.83 m amidships and 3.0 m at the stern, the anti-torpedo bulges, the skeg and the cruiser stern
follow the reference.

Superstructure blocks were traced from plan cuts of the reference every 5 cm, region by region (bridge, funnels,
midships platforms, aircraft deck) with each region's components on their own, and followed up through the levels:
a block ends where its outline changes abruptly (a roof, a platform, an overhang); one whose walls stand still is a
prism, one whose walls taper (the bridge's sloped faces, the raked forward funnel and its uptake trunk) is lofted
straight between its measured bottom and top rings (and a middle ring where the wall knuckles). The funnels follow a
dynamic-time-warping correspondence with extra rings every metre; the other lofts are rebuilt from their own rings
with small attached features (ladders, lockers, pipes) opened and closed out, and, where every ring is star-shaped
about a common centre, sampled at one set of bearings through all their corners, so each band is a run of near-planar
facets. The compass bridge and the upper bridge are thin-walled rooms whose window rows are real openings
and whose backs open onto the passages round the tower, so a filled plan cut cannot see them: their outlines are the
tight hulls of the walls' cut points, closed along the open back. The shelter deck, the torpedo casing and the after
shelter blocks are traced outlines of the hull shell's upper part. A tier that begins a few centimetres over the roof
below it (a level lost between tracks) reaches down to that roof, so no slot shows through the upperworks. Where a
light gun stood inside a traced tub or under a platform slab, the gun's working circle is cut out of the block (for
the 25 mm twins, whose gunners' seats and footrests sweep a 1.36 m radius, a 1.44 m radius through the carriage's
height), and out of any block rising beside it; where a roof stood over its base, the block stops under the gun and its upper part stands
round it. Tops that would share a plane with a neighbour are resolved as `ship:check` asks (a thin slab gives
up the part the other block covers). Blocks are shaded smooth with corners over 30° kept sharp.
`author-blueprint.py` rebuilds the blueprint from the measurement files (`--loft`, `--structures`), which live in
ignored `.build/takao/` with the scripts that make them.

The bridge's windows and portholes were read off orthographic renders of the reference's painted textures, with the
depth of the wall each lies on; `takao_windows.py` keeps that table and glazes each opening on this model's own wall
where that wall stands within 35 cm of the reference's and faces the view, once per opening.

Mounts sit at the reference's hardpoint datums: the Model E twins are the catalog's `type3-203-furutaka-twin` and
`-rf` (built against Furutaka's `jgm146`/`jgm147`, the same meshes as this reference's `jgm025`/`jgm024`), the 12.7 cm
twins `type89-127-a1-twin` (the reference's `jgs009`), the 25 mm triples `type96-25-triple` (`jga173`), the twins
`type96-25-mogami-2` and the singles `type96-25-kongo-single`. No. 3 turret rests trained aft at 7° elevation: at
the horizontal its muzzles meet the bridge-base face (the reference's touch it), and 7° lifts them over its top edge. The two after triples stand on the deck 5 cm above the reference's shallow wells.
Every mount carries a `mountClearance` envelope (barrels with recoil and a carriage box) against the blocks it can reach
and against neighbouring mounts whose working circles overlap. The torpedo mounts train on the upper deck inside the
shelter block, which the recipe draws with its three rounded openings a side; their tubes are authored at zero train,
so the after pair rests trained forward.

Barbettes are measured (5.94 m, the superfiring pair on a 4.98 m trunk to 6.5 m). Masts (tripod foremast with its
yards, platforms and Type 21 stand; tripod mainmast with its lattice bracing, topmast, gaff and the aircraft crane's
lattice jib), catapults, directors, rangefinders, radars, searchlights on lattice pedestals, boats, davits, ground
tackle, bollards, fairleads, winches, vents, rails, the four screws, shafts and brackets, the rudder and the bilge keels
are simplified original constructions at the reference's positions and sizes.

Machinery (three boiler rooms under the funnels and four engine rooms, four shafts), magazines, flood spaces,
stability (GM 7% of beam) and damage-control values are game estimates; the visual reference does not establish internal
plans. The 127 mm (magazines) and 102 mm (machinery) inclined citadel belt behind the bulges, 58 and 38 mm lower
citadel sides, 35 and 47 mm citadel decks, 63-89 mm bulkheads, 27 mm upper side, bulge and weather-deck plating, 76 mm
barbettes and the steering-gear box read their zones and thicknesses from the reference's armour model and are fitted
to the authored loft; hull and superstructure plating are 25 and 16 mm.

## Accepted approximations

- The reference model is Atago's (`jsc038_atago_1944`), shown under the ARP Takao vehicle; Takao-specific differences
  in 1944, if any, are not represented.
- Displacement at the reference waterline (16,970 t, 7.14 m keel draft) is the reference's loading, heavier than
  published full-load figures for the class; the stated mass equals the loft's displacement.
- Superstructure blocks are measured prisms and straight lofts: small overhangs step and curved faces are faceted.
  Only the bridge's windows and portholes are glazed; doors, scuttles on the hull and other painted texture detail
  are not modelled, and openings whose wall here stands away from the reference's are left out.
- Ventilators that a turret's gunhouse sweeps over stand 6 cm under its sole, a little shorter than the reference's.
- Railings, masts, lattice pedestals, the crane and the catapults are simplified; the catapults are empty, as in the
  reference. Rails stay out of the gun arcs.
- The after torpedo mounts rest trained forward (the reference stows them trained aft).
- Handling (34.25 kn), stability, mass distribution, flooding compartmentation and weapon values are shared game
  calibration, not historical measurements. Model fidelity and export checks do not certify historical accuracy.

Takao takes the placeholder's place in the Japanese cruiser line of the research tree.

```sh
python3 assets/ships/takao/author-blueprint.py   # add --loft/--structures only to re-measure from .build/takao
bun -e "import { writeLocalDamage } from './assets/ships/author-local-damage.ts'; await writeLocalDamage(['takao'])"
bun assets/ships/author-flood-spaces.ts takao && bun assets/ships/author-stability.ts takao && bun assets/ships/author-damage-control.ts takao
bun run ship:build takao
bun run ship:review takao
bun run ship:check takao
```

Keep the current fixed views in `generated/review/`. Reference downloads, measurements and comparison captures stay
in ignored `.build/`.
