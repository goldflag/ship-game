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
