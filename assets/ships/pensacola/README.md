# USS Pensacola (CA-24)

CA-24 · 1942 exterior after the GameModels3D pasc106 A hull (asc043_pensacola_1942) · reference design waterline

Open `/?ship=pensacola` or select this ship in port or Custom battle once it is registered.

This is a legacy Blender-recipe preset (like Takao, Alaska, Hood and Mogami), by explicit request, rather than a
construction ship. `blueprint.json` (written by `author-blueprint.py`) and `build.py` are the durable inputs;
reusable guns come from `assets/parts/`. Generated Blender scenes and runtime models are build outputs.

## Approved brief

- **Vessel and fit:** USS Pensacola (CA-24) in the GameModels3D 1942 fit: World of Warships vehicle
  [`pasc106`](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pasc106), configuration `A_Hull`, hull
  `asc043_pensacola_1942` (chosen by the owner over the 1944 hull). Two twin 8-inch/55 Mk 14 Mod 2 turrets (low,
  Nos. 1 and 4) and two triple 8-inch/55 Mk 14 Mod 1 turrets (superfiring, Nos. 2 and 3), eight single 5-inch/25
  Mk 19, four 1.1-inch/75 quadruple mounts, eight single 20 mm Oerlikon Mk 4, two catapults (fitted empty), four Mk 44,
  two Mk 19, one Mk 18 and one Mk 22 director, a 2.7 m rangefinder and a CXAM radar.
- **Paint:** the reference's default (plain) scheme as `bun run ship:reference pasc106 --render` shows it; no
  permoflage or camouflage.
- **Reference policy:** GameModels3D only: no photographs, plans, War Thunder, Sketchfab or other models. Armour zones
  and thicknesses come from the reference's armour model; other gameplay values are provisional game calibration.
  The reference's fit is taken as it stands even where it looks unhistorical; such points are noted below.

## Model and simulation basis

In progress.

## Accepted approximations

- In progress.

```sh
python3 assets/ships/pensacola/author-blueprint.py
bun run ship:build pensacola
bun run ship:review pensacola
bun run ship:check pensacola
```

Reference downloads, measurements and comparison captures stay in ignored `.build/`.
