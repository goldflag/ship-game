# Bismarck — Sea Trials

A playable singleplayer foundation using **Bun, TypeScript, React, Three.js WebGPU, Water Pro 3.5.1, and Sky Pro 2.2.0**. Includes an original Bismarck model, a reproducible Blender asset pipeline, articulated main and secondary guns, and a singleplayer damage trial.

```sh
bun install
bun run dev
```

Open http://localhost:5173. Current Chrome or Edge with hardware acceleration is recommended. WebGPU is selected by Three.js when available; its WebGL2 backend is the compatibility fallback. The pause menu reports the actual backend. Initial startup compiles the ocean and cloud shaders, which can take a moment.

You start in port with the Bismarck moored. Select a fleet card to change ships in place; the harbor stays loaded and your camera angle and zoom are preserved. Drag to inspect the ship, then choose **Set sail** to enter the playable sea trial. **Return to port** in the pause menu ends the current trial. The selected [Fleet harbor garage](docs/garage-mockups/README.md) uses compact panels and a transparent top bar. Currency, refits, commanders, and future ships are illustrative, with temporary state only.

Use **Exterior / Armor / Internals** above the port's detail panel to inspect the loaded ship. Armor shows hull and gunhouse volumes with thicknesses; Internals shows machinery, magazines, steering and flooding compartments. Select a row to isolate that space against the ghosted exterior and read its dimensions. **Clear selection** restores the complete layout. Drag/scroll still orbits and zooms; **Exterior** or Esc returns to the normal model. These are the same provisional volumes used by combat. Inspection does not advance the trial or modify the ship.

Choose **Create schematic** beneath the ship’s name in port to preview a reference sheet from the actual Bismarck model. Choose Standard, Four views, or Showcase, light/charcoal/ink paper, metric or imperial dimensions, and HD or 4K output. **Save image** downloads PNG or WebP; **Copy image** copies PNG where the browser permits image clipboard access. Orthographic views share a scale; the general arrangement view has its own scale. Dimensions describe the model, including the submerged hull. Sheet preferences are remembered locally, and exports use the exact drawing shown in the preview.

## Controls

| Control | Action |
| --- | --- |
| W / S or up / down | Raise / lower engine order; tap for each notch |
| A / D or left / right | Hold port / starboard rudder; release to center |
| Space | Stop engine; the ship coasts down |
| Drag / scroll | Orbit / zoom camera |
| C | Cycle chase, bridge, and tactical cameras |
| R | Recenter camera |
| Esc | Pause / resume and sea trial settings |
| H | Hide / show instruments |
| F | Fullscreen |
| Hold Q / Fire button | Fire the selected battery as guns become ready |
| Double-click the sea | Aim at a sea position |
| Aim at selector | Track a target module at the waterline |
| Inspect target | View armor, compartments, modules and floodwater |

The throttle stays where you set it. Going from ahead to astern takes time. Handling is tuned for a battleship feel rather than an engineering-accurate maneuvering model. Four navigational buoys provide nearby reference points; they are markers, not collision obstacles. A Bismarck trial target starts about 850 meters away. Guns initially train on its port machinery; select the main or secondary battery, wait for readiness and hold Q to fire. Inspect the target for module condition and floodwater. Enable Target underway to observe propulsion damage, or reset the target for another trial. The chart follows your ship and displays its trail. Changing settings restarts the sea trial. Losing browser focus pauses singleplayer.

## Architecture

- `src/ships/blueprint.ts`: validated, versioned JSON blueprints and compiled ship definitions.
- `assets/`: original Blender sources, reusable gun recipes, references, source registers and generated review images.
- `scripts/ships/`: portable build, export, independent GLB validation, starter and review commands.
- `src/simulation/`: serializable movement, weapons, swept collisions, armor, modules and flooding at a fixed 60 Hz. No browser, React, Three.js or GPU dependency.
- `src/game/ShipView.ts`: binds simulation state to exported joints. `ShipInspection.ts` renders shared armor/module/compartment inspection geometry; `src/ships/inspection.ts` supplies both its geometry and the port list. `CombatEffects.ts` uses bounded pools for shells and effects.
- `src/game/Game.ts`: scene, licensed Water/Sky integration and lifecycle. Combat ship poses come from CPU simulation; GPU waves animate the sea and buoys.
- `src/game/HarborBackdrop.ts`, `ShipWake.ts` and `WakeFoam.ts`: illustrative port and sailing wake effects retained from master. See [ocean configuration](docs/ocean-configuration.md).
- `src/ui/`: the selected [Fleet action HUD](docs/hud-mockups/README.md), port, helm instruments, live battery readiness, targeting and damage feedback. Telemetry updates at 10 Hz; open **Gunnery** for target controls.
- `src/schematic/`: orthographic model rendering and image export. Projection and filenames use the loaded preset and the pipeline's runtime axes.
- `vendor/`: supplied proprietary Pro runtime bundles and licenses. Their original terms remain in force.

Combat is an accessible simulation prototype: approximate AP penetration, uniform armor volumes, internal module failures, magazine events, compartment flooding, and sinking. The internal layout and performance values are provisional gameplay data. Networking, player shipbuilding, target AI, crew, full physical hydrostatics, detailed HE/AP fuzes, and hull fracture remain future work. AA guns, propellers and rudders are currently visual fittings.

The shared simulation is ready to host outside the browser, but multiplayer transport and server command validation are not implemented. The gameplay sea is flat; GPU waves do not move combat hulls independently of their hitboxes.

## Model pipeline

All Bismarck sources are now under `assets/ships/bismarck/`. The original model is preserved in `baseline/`. No build depends on `/Users/bill/models`.

Yamato is available at `?ship=yamato`. Its original recipe targets the April 1945 exterior with a separately stated 10.4 m trial draft. Three triple 46 cm and two triple 15.5 cm mounts share the same simulation and articulation contract. The [Yamato source notes](assets/ships/yamato/README.md) distinguish measured dimensions from unresolved historical proportions and fittings.

```sh
bun run ship:build bismarck
bun run ship:check bismarck
bun run ship:review bismarck
bun run ship:build yamato
bun run ship:review yamato
bun assets/ships/yamato/check-dimensions.ts
bun run ship:new my-ship
```

Set `BLENDER_BIN` for a custom Blender executable. Builds retain independent mounts, elevation/recoil joints, muzzle sockets and assembly IDs. The export is already in runtime coordinates: meters, bow -Z, up +Y, waterline Y=0.

Read the [ship pipeline and Blender MCP workflow](docs/ship-pipeline.md), [source asset index](assets/README.md), and [Bismarck discrepancy register](assets/ships/bismarck/reports/discrepancies.md). The [original systems plan](docs/ship-systems-plan.md) describes the longer roadmap. GameModels3D comparison remains pending specific reference access; passing export checks is not a historical accuracy claim.

## Validation

```sh
bun test
bun run build
bun run preview
```

Tests cover blueprint validation, reusable component compilation, movement, ballistic solutions, swept hits, armor before modules, conserved flood transfer, reload/ammunition, propulsion damage, magazine detonation, sinking, reset behavior, and identical combat outcomes at different frame rates. A renderer adapter test loads the actual exported joint hierarchy and checks rear-turret rotation, elevation and recoil against authoritative muzzle positions. The build checks that the GLB matches its compiled definition and measures actual exported hull/pivot/muzzle geometry. Browser validation is also needed for rendering and controls.

The [implementation validation record](docs/ship-validation.md) lists the tested build, browser observations and remaining accuracy/visual checks.

Three.js renderer reference: https://threejs.org/manual/en/webgpurenderer
