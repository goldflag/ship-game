# Fleet Command — Custom Battles

A playable singleplayer foundation using **Bun, TypeScript, React, Three.js WebGPU, Water Pro 3.5.1, and Sky Pro 2.2.0**. Includes an original Bismarck model, a reproducible Blender asset pipeline, articulated main and secondary guns, and custom singleplayer fleet battles.

```sh
bun install
bun run dev
```

Open http://localhost:5173. Current Chrome or Edge with hardware acceleration is recommended. WebGPU is selected by Three.js when available; its WebGL2 backend is the compatibility fallback. Initial startup compiles the ocean and cloud shaders, which can take a moment.

You start in port with the Bismarck moored. Drag to inspect the ship, then choose **Custom battle** to configure both fleets. Choose your own ship, add up to 29 friendly bots, and select one to 30 enemy bots, for up to 30 ships per side. All five registered presets can appear on either team, including duplicates. **Spawn distance** sets the separation between formations from 1–20 km in 0.5 km steps (5 km by default). **Start battle** loads the chosen models and deploys both teams facing each other, with 650 m between adjacent ships. **Return to port** in the pause menu ends the battle and resets every ship. The selected [Fleet harbor garage](docs/garage-mockups/README.md) uses compact panels and a transparent top bar. The fleet carousel lists the registered ship presets: Bismarck, Yamato, Baltimore, Enterprise, and Type VIIC. Select a card to switch ships in place for inspection and sailing; the harbor stays loaded, your orbit direction is preserved, and camera distance adjusts to keep the same relative zoom for the new hull. Currency, refits, and commanders are illustrative, with temporary state only.

Each ship's carousel card uses a baked image of its actual model. `bun run ship:thumbnail <ship-id>` regenerates it with local Blender; `ship:build` also refreshes it.

Port camera distance, aim point, height offsets and zoom limits scale with the selected hull's length, including small boats. Switching ships preserves your orbit direction and relative zoom; water and terrain clearance still apply.

Use **Exterior / Armor / Internals** above the port's detail panel to inspect the loaded ship. Armor shows hull and gunhouse protection with thicknesses and material/provenance where recorded. Plates and list swatches share a fixed thickness scale: green at 0 mm, yellow at 200 mm, and red at 400 mm and above; teak backing is gray. Port armor is opaque over the faded actual ship model, with soft directional shading to distinguish slopes and plate edges and an outline only on the hovered plate. Hover a visible plate to highlight it and read its name, thickness, material, dimensions and recorded basis. Internals shows machinery, magazines, steering and flooding compartments. Filter the list and select a row to isolate that space against the ghosted exterior and read its dimensions; this also reveals armor layers hidden behind outer plates. **Clear selection** restores the complete layout. Drag/scroll still orbits and zooms; **Exterior** or Esc returns to the normal model. These are the same provisional volumes used by combat. Inspection does not advance combat or modify the ship.

Choose **Create schematic** beneath the ship’s name in port to preview a reference sheet from the actual Bismarck model. Choose Standard, Four views, or Showcase, light/charcoal/ink paper, metric or imperial dimensions, and HD or 4K output. **Save image** downloads PNG or WebP; **Copy image** copies PNG where the browser permits image clipboard access. Orthographic views share a scale; the general arrangement view has its own scale. Dimensions describe the model, including the submerged hull. Sheet preferences are remembered locally, and exports use the exact drawing shown in the preview.

## Controls

In port, upward dragging stops at the lowest orbit and keeps the camera aimed at the ship. While sailing, upward tilt is limited to 30°. All camera modes maintain at least 12 m of clearance above sea level, including during sinking; the port also preserves clearance above terrain.

| Control | Action |
| --- | --- |
| W / S or up / down | Raise / lower engine order; tap for each notch |
| A / D or left / right | Hold port / starboard rudder; release to center |
| Space | Stop engine; the ship coasts down |
| Mouse | Aim the centered sight while sailing; drag to orbit in port or inspection |
| Shift / right mouse | Toggle binocular aiming |
| Scroll | Adjust camera distance, or 2×–24× binocular magnification |
| Hold Ctrl | Release cursor to use HUD controls; release Ctrl to return to aiming |
| 1 / 2 / 3 | Select main / secondary battery / torpedoes (when fitted) |
| − / + | Decrease / increase minimap size (numpad keys also work) |
| G | Open / close gunnery and target damage |
| T | Toggle automatic shell-follow camera; press again to return early |
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

Press **T** to ride behind a shell from your next salvo along its actual ballistic path. Enabling it with your shells already airborne follows the latest one. The camera holds briefly at the first ship strike or water impact, then restores your previous view and binocular magnification; the option stays on for subsequent salvos. A penetrating shell can continue through the ship while the camera stays on the strike. Your aim stays in place during flight. Press T again to turn it off and return early. Camera, recenter, binocular and inspection controls can also return you to the ship. Esc pauses both the flight and impact view. The option starts off for each battle, and its shortcut can be changed in Keybindings.

**Numbered gun-aim circles** show the selected battery's current barrel aim at the sight's range, including gravity and ship motion. A round that would fall short is marked at sea level. Amber dashed circles mean the guns are still turning; solid mint circles marked **On aim** mean aligned and loaded. Reloading mounts keep their aim circle with a countdown; blocked, empty and disabled guns have crossed circles. Guns outside their traverse/elevation limits show **Out of arc**, and unreachable distances show **Out of range**. These unavailable guns never show a turning countdown; displayed seconds are explicitly labeled **Reload**. Numbers match the turret row, and converging circles combine their numbers. Arrows indicate guns pointing outside the view, with **Aft** for guns pointing behind the camera. The white center sight remains your commanded aim. These are aiming references, not guaranteed hits: intervening hulls and armor still resolve normally. Circles update every frame in chase and binocular views, and hide during shell follow, inspection, sinking or hidden instruments.

The throttle stays where you set it. Going from ahead to astern takes time. Handling is tuned for a battleship feel rather than an engineering-accurate maneuvering model. Four navigational buoys provide nearby reference points; they are markers, not collision obstacles. Enemy ships start at the distance chosen in custom battle setup (5 km by default). Point the sight at a ship, select a battery with 1/2, then hold left mouse or Q to fire. A click fires only aligned, loaded and unobstructed turrets in the selected battery. Holding left mouse or Q admits each turret as it lines up or finishes reloading; releasing stops the request, and an unsuccessful click is never saved for later. Guns outside their aiming limits keep their ammunition and remain loaded. Guns remain blocked when the ship obstructs their actual firing path. The **can fire** count and green aiming circles use the same simulation eligibility check. The ballistic solver and aiming circles share the center of each turret’s barrels, keeping trained circles centered on the sight at every binocular magnification. The ammunition bar shows live shell counts, mount readiness and reload seconds. Hold Ctrl to select an enemy in the upper-left battle instrument; its range and hull condition update live. G opens that ship’s damage and internal inspection. The transparent chart starts at an 8 km radius and shows friendly ships in mint, enemies in salmon, and a ring around the selected enemy, plus your trail and viewing direction. Use −/+ to resize it, or click its kilometer readout to cycle chart range. Changing graphics or sea settings returns you to port. Losing browser focus pauses singleplayer.
Friendly and enemy bots have an overhead name, equipment-condition percentage and vessel status. Mint bars identify friendly ships and salmon bars identify enemies. Labels follow the displayed hull poses and hide outside the camera view, in port or with the H instrument toggle. Your own ship has no overhead label. Equipment damage appears in gold beside the name and briefly highlights the lost bar segment. Hits arriving together combine into a salvo number; own-ship damage also produces a readout above the helm and a red screen-edge cue. Feedback freezes while paused.

The Damage counter records actual hostile equipment damage on a displacement-based points scale: **Yamato 1,750; Bismarck 1,450; Enterprise 1,180; Baltimore 1,020; Type VIIC 450** at full condition. The scale is `300 + 1,450 × sqrt(displacement tonnes / 70,000)`, rounded to the nearest 10. These are provisional scoring values. Flooding and stability determine sinking; permanent weapon or ammunition loss can defeat an afloat ship. The last hostile projectile to damage equipment or open a breach earns one frag on permanent combat loss or later sinking. Friendly damage and hits after loss do not add score or steal attribution. Returning to port resets the counters.

Bots spend 8–14 seconds acquiring their first firing solution, with small additional delays between gun crews. They observe targets intermittently, lead an estimated course, and alternate their aim between forward, middle and aft areas of the hull. Range and bearing errors shrink during steady tracking; changes in speed or course spoil the solution. Main and secondary mounts fire independently when aligned, unobstructed, loaded and in range, with brief crew delays after reload. Each bot has its own engagement distance and sustained course/speed choices. Taking damage can prompt an evasive turn; heavily damaged bots seek more distance. New battles vary these decisions, while a recorded seed reproduces them. See [bot behavior and tuning](docs/bot-behavior.md).

Bots hold fire through friendly hulls and steer away from nearby ships; shell collisions still apply to all hulls, including allies. Propulsion, steering, magazines, ammunition, flooding and sinking affect every ship. Sink or knock out the opposing fleet to win; friendly bots keep fighting if your ship is lost. Esc opens the return-to-port action after victory or defeat.

Aim AP at main turrets or magazines for a faster knockout. AP now applies 75% of its listed damage on a direct equipment strike, up from 25%, with a separate protected burst after its fuze delay. Permanently losing every main gun and torpedo supply, or exhausting their usable ammunition, **knocks a ship out while afloat**. Surviving secondary guns do not keep it in battle; ships fitted only with secondary guns use those guns instead. Knocked-out ships cease fire and coast to a stop. Temporary magazine flooding can recover, and a ship with working primary weapons can keep fighting without propulsion. Armor still protects machinery; waterline hits are not guaranteed to disable a battleship. Flooding and stability continue to determine sinking. See the [controlled balance measurements](assets/reviews/damage-realism/knockout-balance.md).

Ships collide with friendly and enemy hulls. Contact slows and pushes the ships according to their mass; glancing impacts slide along the hull, and off-center hits can turn it. You can reverse or steer away after contact. Sinking wrecks remain solid until they descend below the other ship's keel. Collision shapes follow a simplified convex envelope of each blueprint's hull stations; ramming damage is not implemented.

**Type VIIC** is an early-war 1941 submarine preset for surface combat. It has an articulated 8.8 cm deck gun, a 2 cm platform gun, four bow tubes and one stern tube, with 14 torpedoes. Select **3** for torpedoes (selected initially on this preset), aim within ±15° of the bow or stern, then click / Q / Fire for one tube or hold to launch loaded tubes in sequence. The torpedo instrument shows each tube’s readiness, remaining rounds and reload, plus range and arming distance. G → Aim at → Target waterline supplies a lead; manual aiming requires you to lead moving ships. G7a torpedoes run straight at 44 kn, at 2 m depth, for up to 5 km; they arm after 300 m and tubes reload in 45 seconds. A water wake shows each run; hull contact creates a water plume, damage and flooding. Allies and sinking wrecks can be hit. Bots use the same tubes, lead solver and damage rules. Hull HP is 450 under the shared displacement curve. Diving, sonar and depth charges are not implemented in this first version. See [Type VIIC configuration and limitations](assets/ships/type-viic/README.md).

Bot tactics and caliber-based engagement limits are provisional gameplay tuning. Enterprise fights with its authored guns; aircraft operations are not implemented. Fleet selection is retained during this page session; progression remains illustrative.

Gunfire uses caliber-scaled ignition and large fireballs that cool over roughly 0.6–0.8 seconds into drifting propellant smoke. The smoke uses local raymarched 3D density, erosion and sunward light absorption inspired by the vendored Sky Pro clouds. Broad folds settle into slower motion as the plume expands, staying connected before gradually thinning. While binoculars are active, smoke from your ship is hidden, including existing propellant and impact smoke; it keeps aging and returns at its current state when you leave the scope. Smoke from other ships and splash effects remain visible. Shells follow CPU ballistics with short motion streaks. Armor strikes produce directional sparks and smoke; water impacts form aerated columns that separate into small round droplets and mist, followed by foam shaded on the ocean surface. Magazine detonations have a separate effect. Pause freezes the effects and returning to port clears them. Visual scales are gameplay approximations; see the [effects review record](assets/effects/naval/reports/validation.md).

When your ship is hit, a salmon arc around the sight points toward the incoming shell relative to your camera, including hits from behind. Nearby hits share a cue; separate directions can appear together. Armor stops and ricochets count too. The markers hold briefly, fade over 2.2 seconds total, freeze on pause, and follow the H instrument toggle.

Shell strikes also leave lasting marks on the ship itself: penetrations have dark punctures and torn paint, stopped AP rounds leave steel dents, and ricochets score a scrape along the incoming direction. Larger calibers leave larger marks. Scars conform to the visible mesh and follow hull movement, sinking and turret rotation. They persist while paused, hide in Armor/Internals inspection, and clear when the ship resets or returns to port. Each ship retains its latest 96 marks, batched by struck mesh. Current guns fire AP; the visual adapter also supports broader HE scorch marks for future ammunition types. These are surface decals and gameplay approximations, not holes cut through the model or a new HE damage simulation.

## Architecture

Sound uses an [original ElevenLabs-generated naval set](assets/audio/naval/README.md): mechanical UI clicks, engine telegraph and reload cues, a departure horn, caliber-based gunfire, armor hits, ricochets, splashes and magazine explosions. Click or press a key to enable browser audio. **Esc → Settings → Sound** adjusts master, effects and interface levels or mutes everything; changes apply immediately and persist without restarting the battle. Pause stops combat tails; background tabs are silent. `bun run audio:build` rebuilds the processed assets locally from the retained originals and prompts.

- `src/ships/blueprint.ts`: validated, versioned JSON blueprints and compiled ship definitions.
- `assets/`: original Blender sources, reusable gun recipes, references, source registers and generated review images.
- `scripts/ships/`: portable build, export, independent GLB validation, starter and review commands.
- `src/simulation/battle.ts` and `bots.ts`: bounded fleet setup, deployment, team-aware controllers and ballistic target leading.
- `src/simulation/collisions.ts`: hull contact separation and mass-based linear/angular impulses for every fleet actor.
- `src/simulation/`: serializable movement, weapons, swept collisions, armor, modules and flooding at a fixed 60 Hz. No browser, React, Three.js or GPU dependency.
- `src/game/ShipView.ts`: binds simulation state to exported joints. `ShipInspection.ts` renders shared armor/module/compartment inspection geometry; `src/ships/inspection.ts` supplies both its geometry and the port list. `CombatEffects.ts` uses bounded pools for shells and effects.
- `src/game/Game.ts`: scene, licensed Water/Sky integration and lifecycle. Combat ship poses come from CPU simulation; GPU waves animate the sea and buoys.
- `src/game/HarborBackdrop.ts`, `ShipWake.ts` and `WakeFoam.ts`: illustrative port and sailing wake effects retained from master. See [ocean configuration](docs/ocean-configuration.md).
- `src/ui/`: the selected [Fleet action HUD](docs/hud-mockups/README.md), port, helm instruments, live battery readiness, targeting and damage feedback. Telemetry updates at 10 Hz; **Custom battle** configures fleets in port, and **Gunnery** exposes damage inspection at sea.
- `src/schematic/`: orthographic model rendering and image export. Projection and filenames use the loaded preset and the pipeline's runtime axes.
- `vendor/`: supplied proprietary Pro runtime bundles and licenses. Their original terms remain in force.

Combat uses velocity-aware AP penetration and delayed fuzes, protected AP/HE bursts, finite ammunition, local fires, machinery failures, timed damage-control teams and compartment flooding. Flotation and righting moments come from the authored hull and a declared provisional loading calibration. Floodwater moves under heel and trim; seawater can enter or leave openings. Ships can be immobile, disarmed, disabled afloat, sinking or capsized. Equipment condition replaces the former universal hull HP counter. The internal layouts, fuel, crew performance, loading and protection values remain game approximations. Networking, player shipbuilding, aircraft, individual crew, detailed spall and hull fracture remain future work. Fittings outside the compiled mount catalog, propellers and rudders remain visual.

The shared simulation is ready to host outside the browser, but multiplayer transport and server command validation are not implemented. The gameplay sea is flat; GPU waves do not move combat hulls independently of their hitboxes.

## Model pipeline

Bismarck is independently rebuilt for the 24 May 1941 fit, displayed at a separately stated 9.33 m standard draft. Its new original hull, four main turrets, superstructure, 509 armor plates and 39 internal envelopes are driven by the blueprint and component catalog. All sources are under `assets/ships/bismarck/`; the earlier original model remains untouched in `baseline/`. No build depends on `/Users/bill/models`.

The latest correction replaces the secondary gunhouses' tapered boxes with ridged and sloping roof facets, separates the navigation wheelhouse from the conning tower, and reshapes the tower galleries. All six transverse armor sections now fit inside the local hull, including their physical thickness. See the [fourth correction report](assets/ships/bismarck/reports/visual-iteration-04/README.md). Bismarck's full hull and major deckhouses register hits even outside armored areas; Armor inspection also shows their provisional structural plating.

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

## Aircraft model collection

Thirteen original Japanese and American WWII carrier aircraft are available as standalone Blender sources and GLBs: Zero (A6M2/A6M5), Val, Kate, Judy, Jill, Wildcat, Dauntless, Devastator, Hellcat, Helldiver, Avenger and Corsair. Open **`/aircraft-review.html`** to select, orbit and articulate them. They are visual assets for future air combat; carrier operations and aircraft simulation remain unimplemented.

The models were rebuilt through Blender MCP from individually measured three-view schematics, with transparent cockpits, original textured finishes, separate moving parts and three mesh/texture detail levels. Retained drawing overlays and variant caveats accompany the editable sources. Run `bun run aircraft:check all` to validate them, or `bun run aircraft:build all` for the reproducible local Blender build. See the [aircraft source index](assets/aircraft/README.md), [pipeline](docs/aircraft-pipeline.md), and [model overview](assets/aircraft/reports/quarter-sheet.jpg).

## Validation

```sh
bun test
bun run build
bun run preview
```

Tests cover mixed-fleet deployment and loading, bot fire/reloads/damage/retargeting, friendly firing lanes, battle results and resets, fleet determinism, blueprint validation, reusable component compilation, movement, ship contacts (ramming, reversing, sliding, mass, turning, pile-ups, sinking and close passes), ballistic solutions, swept hits, armor before modules, conserved flood transfer, reload/ammunition, propulsion damage, magazine detonation, sinking, reset behavior, and identical combat outcomes at different frame rates. A renderer adapter test loads the actual exported joint hierarchy and checks rear-turret rotation, elevation and recoil against authoritative muzzle positions. The build checks that the GLB matches its compiled definition and measures actual exported hull/pivot/muzzle geometry. Browser validation is also needed for rendering and controls.

The [implementation validation record](docs/ship-validation.md) lists the tested build, browser observations and remaining accuracy/visual checks.

Three.js renderer reference: https://threejs.org/manual/en/webgpurenderer

Gunnery now supports finite AP and HE stocks. Changing shell type takes a full reload. HE contact bursts affect locally exposed equipment through the same armor queries; its fill, fragment budget and stock split are provisional game calibration.

In Gunnery, **Own damage control** lets you prioritize fires, flooding or repairs and focus crews on a space or gun mount. Crews take time to set up, shore small accessible holes, close intact open boundaries and use portable pumps. Repairs consume finite supplies, stop at 60% condition and cannot revive destroyed equipment. Target damage shows active fires, list, trim, draft change and loss cause.
