# Yamato

Original reconstruction targeting the 7 April 1945 exterior, authored through the shared versioned ship pipeline. Historical accuracy is still under review; see the [discrepancy register](reports/discrepancies.md) and [source register](references/sources.json).

The model uses 263 m overall length, 38.9 m extreme beam, 256 m waterline length, 36.9 m waterline beam and a 10.4 m trial draft. Midship depth is 18.915 m. The equipment date does not assert an exact sinking/departure displacement. Three triple 46 cm and two triple 15.5 cm mounts have independent yaw, elevation, recoil and muzzle joints. The original recipe also includes AA, bridge, funnel, masts, radar, aircraft handling gear, boats, shafts, four 5 m screws and tandem centreline rudders.

```sh
bun run ship:compile yamato
bun run ship:build yamato
bun run ship:check yamato
bun run ship:review yamato
bun assets/ships/yamato/check-dimensions.ts
bun test
bun run build
```

Open the game with `?ship=yamato`, for example `http://localhost:5173/?ship=yamato`. Bismarck remains available with `?ship=bismarck`. The same renderer-free simulation and renderer adapter handle both.

`blueprint.json`, `build.py` and `assets/parts/guns.json` are authoring sources. `generated/source.blend`, review images and `public/models/yamato.*` are generated outputs. Local Blender was used because no Blender MCP tool was exposed.

For a read-only check of the retained Blender component meshes, run Blender with `--background --factory-startup --python-exit-code 1 --python assets/ships/yamato/check-components.py`. This measures the three main roller races, bore spacing, trunnion locations, optical baselines and nominal screw diameters and six 150 cm searchlight reflectors, and writes `reports/components.json`.

Reference PDFs and images remain under `references/`; none are used as game textures. The Alexpl image is unchanged CC BY-SA 3.0 reference art, credited in the source register. All model geometry and the plank material are independently authored.

The dimensional audit measures the published GLB triangles independently of the recipe. It checks six scalar dimensions; it does not close the outstanding hull-lines, bridge, gunhouse, AA-fit or fittings discrepancies. The museum itself reports missing original plans and disagreements between surviving bridge drawings, so a blanket claim of 100% historical accuracy is not supportable.

For four repeatable close views of the bridge, superstructure, forward battery and stern, run local Blender with `--background --factory-startup --python-exit-code 1 --python assets/ships/yamato/review-details.py` after the shared review. Results are in `generated/review/details/`. See [validation evidence](reports/validation.md) for measured values and the limits of the browser observations.
