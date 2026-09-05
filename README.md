# Fleet Command — Custom Battles

A playable singleplayer foundation using **Bun, TypeScript, React, Three.js WebGPU, Water Pro 3.5.1, and Sky Pro 2.2.0**. Includes an original Bismarck model, a reproducible Blender asset pipeline, articulated main and secondary guns, and custom singleplayer fleet battles.

```sh
bun install
bun run dev
```

Open http://localhost:5173. Current Chrome or Edge with hardware acceleration is recommended. WebGPU is selected by Three.js when available; its WebGL2 backend is the compatibility fallback. Initial startup compiles the ocean and cloud shaders, which can take a moment.

You start in port with the Bismarck moored. Drag to inspect the ship, then choose **Custom battle** to configure both fleets. Choose your own ship, add up to four friendly bots, and select one to five enemy bots. All four registered presets can appear on either team, including duplicates. **Start battle** loads the chosen models and deploys two parallel formations 5 km apart, with 650 m between adjacent ships. **Return to port** in the pause menu ends the battle and resets every ship. The selected [Fleet harbor garage](docs/garage-mockups/README.md) uses compact panels and a transparent top bar. The fleet carousel lists the registered ship presets: Bismarck, Yamato, Baltimore, and Enterprise. Select a card to switch ships in place for inspection and sailing; the harbor stays loaded and your camera position, angle, and zoom are preserved. Currency, refits, and commanders are illustrative, with temporary state only.

Each ship's carousel card uses a baked image of its actual model. `bun run ship:thumbnail <ship-id>` regenerates it with local Blender; `ship:build` also refreshes it.

Use **Exterior / Armor / Internals** above the port's detail panel to inspect the loaded ship. Armor shows hull and gunhouse protection with thicknesses and material/provenance where recorded. Plates and list swatches share a fixed thickness scale: green at 0 mm, yellow at 200 mm, and red at 400 mm and above; teak backing is gray. Port armor is opaque, without edge lines, over the faded actual ship model. Hover a visible plate to highlight it and read its name, thickness, material, dimensions and recorded basis. Internals shows machinery, magazines, steering and flooding compartments. Filter the list and select a row to isolate that space against the ghosted exterior and read its dimensions; this also reveals armor layers hidden behind outer plates. **Clear selection** restores the complete layout. Drag/scroll still orbits and zooms; **Exterior** or Esc returns to the normal model. These are the same provisional volumes used by combat. Inspection does not advance combat or modify the ship.

Choose **Create schematic** beneath the ship’s name in port to preview a reference sheet from the actual Bismarck model. Choose Standard, Four views, or Showcase, light/charcoal/ink paper, metric or imperial dimensions, and HD or 4K output. **Save image** downloads PNG or WebP; **Copy image** copies PNG where the browser permits image clipboard access. Orthographic views share a scale; the general arrangement view has its own scale. Dimensions describe the model, including the submerged hull. Sheet preferences are remembered locally, and exports use the exact drawing shown in the preview.

## Controls

| Control | Action |
| --- | --- |
| W / S or up / down | Raise / lower engine order; tap for each notch |
| A / D or left / right | Hold port / starboard rudder; release to center |
| Space | Stop engine; the ship coasts down |
| Mouse | Aim the centered sight while sailing; drag to orbit in port or inspection |
| Shift / right mouse | Toggle binocular aiming |
| Scroll | Adjust camera distance, or 2×–12× binocular magnification |
| Hold Ctrl | Release cursor to use HUD controls; release Ctrl to return to aiming |
| 1 / 2 | Select main / secondary AP battery |
| − / + | Decrease / increase minimap size (numpad keys also work) |
| G | Open / close gunnery and target damage |
| C | Cycle chase, bridge, and tactical cameras |
| R | Recenter camera |
| Esc | Pause / resume; open Settings or close the game |
| H | Hide / show instruments |
| F | Fullscreen |
| Hold left mouse / Q / Fire button | Fire the selected battery as guns become ready |
| Aim at selector | Track a target module; moving the mouse returns to manual aim |
| Inspect target | View armor, compartments, modules and floodwater |

**Esc → Settings** opens graphics, sea conditions, and **Keybindings** in a separate dialog. Select a primary or alternate binding and press a key; changes apply immediately and are saved in this browser. Esc cancels capture, Delete clears a binding, and Reset restores the defaults. Esc, Tab and Enter remain reserved for menus; Shift binoculars and Ctrl cursor release remain fixed controls. The HUD and control hints follow your bindings. Graphics and sea changes reload the scene in port. **Close game** closes the tab when permitted by the browser.

Starting a battle captures the mouse for centered aiming. If the browser declines capture, click the sea to engage it. Esc releases the mouse and pauses; Resume battle captures it again. The third-person sight stays small; the numbered aiming scale and range readout appear in binoculars. The scope preserves the aimed position when entering or leaving it, and mouse sensitivity follows magnification.

The throttle stays where you set it. Going from ahead to astern takes time. Handling is tuned for a battleship feel rather than an engineering-accurate maneuvering model. Four navigational buoys provide nearby reference points; they are markers, not collision obstacles. Enemy ships start 5 km across the sea. Point the sight at a ship, select a battery with 1/2, then hold left mouse or Q to fire. Loaded guns can fire while traversing or when the reticle is outside their aiming limits; shells follow the barrels’ current direction. Guns remain blocked when the ship obstructs their firing path. The ammunition bar shows live shell counts, mount readiness and reload seconds. Hold Ctrl to select an enemy in the upper-left battle instrument; its range and hull condition update live. G opens that ship’s damage and internal inspection. The transparent chart starts at an 8 km radius and shows friendly ships in mint, enemies in salmon, and a ring around the selected enemy, plus your trail and viewing direction. Use −/+ to resize it, or click its kilometer readout to cycle chart range. Changing graphics or sea settings returns you to port. Losing browser focus pauses singleplayer.

Every visible battle ship has an overhead name and live hull HP bar. Mint labels identify friendly ships, salmon labels identify enemies, and **You** marks your ship; numbered ally/enemy slots distinguish duplicate presets. Nearby labels separate into rows with stems pointing to their ships. Labels follow the displayed hull poses, hide outside the camera view, and follow the H instrument toggle. A sinking ship keeps its remaining structural HP reading and shows **Sinking**, since flooding can sink a hull before its structure reaches zero.

Bots acquire living opponents, close at an angle, bring their batteries to bear, and lead moving targets using the same ballistic solver and authoritative gun poses as the player. Main and secondary mounts fire independently when aligned, unobstructed, loaded and in range. Bots hold fire through friendly hulls and steer away from nearby ships; shell collisions still apply to all hulls, including allies. Propulsion, steering, magazines, ammunition, flooding and sinking affect every ship. Sink the opposing fleet to win; friendly bots keep fighting if your ship sinks. Esc opens the return-to-port action after victory or defeat.

Bot tactics and caliber-based engagement limits are provisional gameplay tuning. Enterprise fights with its authored guns; aircraft operations are not implemented. There is no physical ship-to-ship collision response yet. Fleet selection is retained during this page session; progression remains illustrative.

Gunfire uses caliber-scaled ignition and large fireballs that cool over roughly 0.6–0.8 seconds into drifting propellant smoke. The smoke uses local raymarched 3D density, erosion and sunward light absorption inspired by the vendored Sky Pro clouds. Broad folds settle into slower motion as the plume expands, staying connected before gradually thinning. Shells follow CPU ballistics with short motion streaks. Armor strikes produce directional sparks and smoke; water impacts form aerated columns that separate into small round droplets and mist, followed by foam shaded on the ocean surface. Magazine detonations have a separate effect. Pause freezes the effects and returning to port clears them. Visual scales are gameplay approximations; see the [effects review record](assets/effects/naval/reports/validation.md).

## Architecture

Sound uses an [original ElevenLabs-generated naval set](assets/audio/naval/README.md): mechanical UI clicks, engine telegraph and reload cues, a departure horn, caliber-based gunfire, armor hits, ricochets, splashes and magazine explosions. Click or press a key to enable browser audio. **Esc → Settings → Sound** adjusts master, effects and interface levels or mutes everything; changes apply immediately and persist without restarting the battle. Pause stops combat tails; background tabs are silent. `bun run audio:build` rebuilds the processed assets locally from the retained originals and prompts.

- `src/ships/blueprint.ts`: validated, versioned JSON blueprints and compiled ship definitions.
- `assets/`: original Blender sources, reusable gun recipes, references, source registers and generated review images.
- `scripts/ships/`: portable build, export, independent GLB validation, starter and review commands.
- `src/simulation/battle.ts` and `bots.ts`: bounded fleet setup, deployment, team-aware controllers and ballistic target leading.
- `src/simulation/`: serializable movement, weapons, swept collisions, armor, modules and flooding at a fixed 60 Hz. No browser, React, Three.js or GPU dependency.
- `src/game/ShipView.ts`: binds simulation state to exported joints. `ShipInspection.ts` renders shared armor/module/compartment inspection geometry; `src/ships/inspection.ts` supplies both its geometry and the port list. `CombatEffects.ts` uses bounded pools for shells and effects.
- `src/game/Game.ts`: scene, licensed Water/Sky integration and lifecycle. Combat ship poses come from CPU simulation; GPU waves animate the sea and buoys.
- `src/game/HarborBackdrop.ts`, `ShipWake.ts` and `WakeFoam.ts`: illustrative port and sailing wake effects retained from master. See [ocean configuration](docs/ocean-configuration.md).
- `src/ui/`: the selected [Fleet action HUD](docs/hud-mockups/README.md), port, helm instruments, live battery readiness, targeting and damage feedback. Telemetry updates at 10 Hz; **Custom battle** configures fleets in port, and **Gunnery** exposes damage inspection at sea.
- `src/schematic/`: orthographic model rendering and image export. Projection and filenames use the loaded preset and the pipeline's runtime axes.
- `vendor/`: supplied proprietary Pro runtime bundles and licenses. Their original terms remain in force.

Combat is an accessible simulation prototype: approximate AP penetration through physical plates (Bismarck) or legacy armor volumes, internal module failures, magazine events, compartment flooding, and sinking. The internal layout and performance values are provisional gameplay data. Networking, player shipbuilding, aircraft, crew, full physical hydrostatics, detailed HE/AP fuzes, and hull fracture remain future work. Fittings outside the compiled mount catalog, propellers and rudders remain visual.

The shared simulation is ready to host outside the browser, but multiplayer transport and server command validation are not implemented. The gameplay sea is flat; GPU waves do not move combat hulls independently of their hitboxes.

## Model pipeline

Bismarck is independently rebuilt for the 24 May 1941 fit, displayed at a separately stated 9.33 m standard draft. Its new original hull, four main turrets, superstructure, 277 armor plates and 39 internal envelopes are driven by the blueprint and component catalog. All sources are under `assets/ships/bismarck/`; the earlier original model remains untouched in `baseline/`. No build depends on `/Users/bill/models`.

**Reference review** in port opens the [local comparison page](public/ship-reference/bismarck/index.html): 25 neutral views, historical drawing registration, overlays, dimensions, landmarks, protection sections and downloadable GLB/ZIP. The [modeling specification](assets/ships/bismarck/modeling-spec.json) distinguishes documented dimensions from reconstructed sections and room envelopes. The game model is comparison evidence only; the original ship rebuild passes with the raw reference cache unavailable.

Yamato is available at `?ship=yamato`. Its original recipe targets the April 1945 exterior with a separately stated 10.4 m trial draft. Three triple 46 cm and two triple 15.5 cm mounts share the same simulation and articulation contract. The [Yamato source notes](assets/ships/yamato/README.md) distinguish measured dimensions from unresolved historical proportions and fittings.

```sh
bun run ship:reference bismarck   # Optional: refresh the isolated GameModels3D raster pack
bun run ship:build bismarck       # Also regenerates comparison artifacts
bun run ship:independence bismarck
bun run ship:check bismarck
bun run ship:review bismarck
bun run ship:build yamato
bun run ship:review yamato
bun assets/ships/yamato/check-dimensions.ts
bun run ship:new my-ship
```

Set `BLENDER_BIN` for a custom Blender executable. Builds retain independent mounts, elevation/recoil joints, muzzle sockets and assembly IDs. The export is already in runtime coordinates: meters, bow -Z, up +Y, waterline Y=0.

Read the [ship pipeline and Blender MCP workflow](docs/ship-pipeline.md), [source asset index](assets/README.md), and [Bismarck discrepancy register](assets/ships/bismarck/reports/discrepancies.md). The [original systems plan](docs/ship-systems-plan.md) describes the longer roadmap. The GameModels3D WoWS EU 15.7.0.0 reference pack is retained under the ship’s references. Passing export checks validates authored targets, not historical accuracy.

## Validation

```sh
bun test
bun run build
bun run preview
```

Tests cover mixed-fleet deployment and loading, bot fire/reloads/damage/retargeting, friendly firing lanes, battle results and resets, fleet determinism, blueprint validation, reusable component compilation, movement, ballistic solutions, swept hits, armor before modules, conserved flood transfer, reload/ammunition, propulsion damage, magazine detonation, sinking, reset behavior, and identical combat outcomes at different frame rates. A renderer adapter test loads the actual exported joint hierarchy and checks rear-turret rotation, elevation and recoil against authoritative muzzle positions. The build checks that the GLB matches its compiled definition and measures actual exported hull/pivot/muzzle geometry. Browser validation is also needed for rendering and controls.

The [implementation validation record](docs/ship-validation.md) lists the tested build, browser observations and remaining accuracy/visual checks.

Three.js renderer reference: https://threejs.org/manual/en/webgpurenderer
