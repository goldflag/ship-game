# New Orleans

Scaffolded starter · replace with the approved vessel, year and fit

Open `/?ship=new-orleans` or select this ship in port or Custom battle once it is registered.

This is a legacy Blender-recipe preset (like Alaska, Hood and Yamato), by explicit request, rather than a
construction ship. `blueprint.json` (written by `author-blueprint.py`) and `build.py` are the durable inputs;
reusable guns come from `assets/parts/`. Generated Blender scenes and runtime models are build outputs.

## Approved brief

- **Vessel and fit:** USS New Orleans (CA-32) in 1944, as GameModels3D World of Warships vehicle
  [`pasc107`](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pasc107) shows her: hull
  `asc014_new_orlean_1944` (the only New Orleans hull on GameModels3D) with the later anti-aircraft fit of
  configuration `B_Hull` (cached as `pasc107-b` with `bun run ship:reference pasc107 --hull B_Hull --name pasc107-b`;
  the default `pasc107` cache loads the A anti-aircraft fit instead). Three triple 8-inch/55 turrets of the CA-32
  pattern, eight single 5-inch/25 Mk 19, six quadruple 40 mm Bofors Mk 2, seventeen twin 20 mm Oerlikon (Mk 20) and
  nine single 20 mm Oerlikon Mk 4, two catapults (fitted empty), six Mk 51, two Mk 28 and two Mk 31 directors, and
  SG (two), SK and SM radars. The reference's fit is taken as it stands, even where it looks unhistorical.
- **Paint:** the reference's default (plain) scheme, as `bun run ship:reference pasc107-b --render` shows it; no
  permoflage or camouflage.
- **Reference policy:** GameModels3D only: no photographs, plans, War Thunder, Sketchfab or other models. Armour
  zones and thicknesses come from the reference's armour model (`asc014_new_orlean_1944` armour); other gameplay
  values are provisional game calibration.

## Model and simulation basis

TODO once measured: how the hull stations and deckhouse prisms were sampled and at what waterline; where the mounts
and armour come from; which fittings are simplified original constructions. Machinery, magazines, flood spaces,
stability and damage-control values are game estimates unless the brief says otherwise.

## Accepted approximations

- TODO.

```sh
python3 assets/ships/new-orleans/author-blueprint.py
bun run ship:build new-orleans
bun run ship:review new-orleans
bun run ship:check new-orleans
```

Reference downloads, measurements and comparison captures stay in ignored `.build/`.
