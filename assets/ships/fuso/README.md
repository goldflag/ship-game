# Fusō

Scaffolded starter · replace with the approved vessel, year and fit

Open `/?ship=fuso` or select this ship in port or Custom battle once it is registered.

This is a legacy Blender-recipe preset (like Alaska, Hood and Yamato), by explicit request, rather than a
construction ship. `blueprint.json` (written by `author-blueprint.py`) and `build.py` are the durable inputs;
reusable guns come from `assets/parts/`. Generated Blender scenes and runtime models are build outputs.

## Approved brief

- **Vessel and fit:** TODO: vessel, year and configuration as the approved reference shows her; main, secondary and
  light armament; directors, radars, aircraft and boats.
- **Paint:** TODO: the approved scheme (hull, upperworks, decks, bottom, boot topping, markings).
- **Reference policy:** TODO: which sources count (for example GameModels3D only), with links and the accepted
  model or configuration ID.
- **Accepted approximations and open limits:** TODO.

## Model and simulation basis

TODO once measured: how the hull stations and deckhouse prisms were sampled and at what waterline; where the mounts
and armour come from; which fittings are simplified original constructions. Machinery, magazines, flood spaces,
stability and damage-control values are game estimates unless the brief says otherwise.

## Accepted approximations

- TODO.

```sh
python3 assets/ships/fuso/author-blueprint.py
bun run ship:build fuso
bun run ship:review fuso
bun run ship:check fuso
```

Reference downloads, measurements and comparison captures stay in ignored `.build/`.
