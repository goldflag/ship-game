# USS Atlanta (CL-51)

CL-51 · 1942 exterior after the GameModels3D pasc006 A hull · reference design waterline

Open `/?ship=atlanta` or select this ship in port or Custom battle once it is registered.

This is a legacy Blender-recipe preset (like Takao, Alaska, Hood and Mogami), by explicit request, rather than a
construction ship. `blueprint.json` (written by `author-blueprint.py`) and `build.py` are the durable inputs;
reusable guns come from `assets/parts/`. Generated Blender scenes and runtime models are build outputs.

## Approved brief

- **Vessel and fit:** USS Atlanta (CL-51) as she stood in 1942, the only configuration GameModels3D offers: World of
  Warships vehicle [`pasc006`](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pasc006), hull
  `asc006_atlanta_1942`, configuration `A_Hull`. Eight twin 5-inch/38 Mk 32 Mod 12 mounts (six on the centreline in
  superfiring groups fore and aft, two in the waist), four 1.1-inch/75 quadruple mounts, eight single 20 mm Oerlikon
  Mk 4, two quadruple 21-inch Mk 14 torpedo-tube mounts, six depth-charge throwers and two stern roller tracks, two
  Mk 37 and four Mk 44 directors, two torpedo directors, a 2.5 m rangefinder and an SC-1 radar. Catapults are not part
  of this fit.
- **Paint:** the reference's default (plain) scheme as `bun run ship:reference pasc006 --render` shows it; no
  permoflage or camouflage.
- **Reference policy:** GameModels3D only: no photographs, plans, War Thunder, Sketchfab or other models. Armour zones
  and thicknesses come from the reference's armour model; other gameplay values are provisional game calibration.
  The reference's fit is taken as it stands, even where it looks unhistorical.

## Model and simulation basis

TODO once measured.

## Accepted approximations

- TODO.

```sh
python3 assets/ships/atlanta/author-blueprint.py
bun run ship:build atlanta
bun run ship:review atlanta
bun run ship:check atlanta
```

Reference downloads, measurements and comparison captures stay in ignored `.build/`.
