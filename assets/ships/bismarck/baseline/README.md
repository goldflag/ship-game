# Bismarck — May 1941

Editable Blender exterior model, built with historical proportions as the first priority.

Open **Bismarck_1941.blend**. The model is at full size: **1 Blender unit = 1 metre**. Bow is +X, port is +Y, and the design waterline is Z = 0. The saved view shows the complete ship; the four named cameras include an orthographic profile and deck plan. Collections separate the hull, batteries, superstructure, fittings and underwater appendages. Studio objects are hidden in the working viewport but remain available for rendering.

## Dimensional basis

| Constraint | Model value |
| --- | ---: |
| Overall hull length | 250.50 m |
| Maximum beam | 36.00 m |
| Design draught | 9.33 m |
| Hull depth amidships, keel to deck edge | 15.00 m |
| Main turret stations, aft to forward | 46.15 / 64.35 / 174.35 / 192.55 m |
| Separation within each main turret pair | 18.20 m |

These dimensions follow [KBismarck technical characteristics](https://www.kbismarck.com/genedata.html). Some summaries round the overall length to 251 m. The draught is a design reference, rather than a claim about the exact fuel/load state on a particular day. The main battery stations follow the [armament documentation](https://www.kbismarck.com/armament.html). The historical station origin is mapped to model X = −122.50 m, using an approximately 2.75 m stern overhang interpretation.

The four 38 cm twin turrets, six 15 cm twin turrets, eight 10.5 cm twin mounts, eight 3.7 cm twin mounts, twelve single 2 cm guns and two quadruple 2 cm mounts are represented. The underwater arrangement has three screws and two rudders. Anton lacks the rangefinder ears fitted to the other main turrets.

## Reference and accuracy

The primary visual reference is Manuel P. González López's [24 May 1941 profile and deck plan](https://www.kbismarck.com/drawings.html), locally retained in `references/profile.gif` for inspection. It supports the major plan arrangement, Atlantic bow, deck sheer, superstructure silhouette, single funnel, masts, boat positions and transverse catapult. Reference art remains the work of its credited author; it is not used as a model texture.

**This is a proportion-focused exterior reconstruction, not a certified shipyard model.** Hull sections are smooth interpolated interpretations of the available views, not transcribed original hull offsets. Deckhouse outlines, secondary mount positions, turret housings, fittings, underwater stern lines, shaft supports and propeller blades are approximations. Small fittings are simplified. Aircraft are presumed stowed in the hangars; interior machinery is omitted. Gray paint and teak are visual interpretations of the May 1941 appearance, with no exact paint-color claim. Fine weathering and residual camouflage traces are omitted.

The principal envelope is checked automatically at build time. `dimensions.json` records the measured hull bounds, turret stations and inventory. Cameras are orthographic so perspective does not obscure proportions. `renders/` contains the three-quarter, starboard profile and deck-plan views.

## Rebuilding

Built with Blender 5.2. Run:

```sh
blender --background --python build_bismarck.py
```

Set `BISMARCK_SKIP_RENDER=1` to generate only the model. The generator and these notes are also embedded as Blender text blocks. Objects use descriptive names and separate materials; the result remains editable without running the script.

The scene is an assembly of exterior parts, not a single watertight mesh prepared for 3D printing.
