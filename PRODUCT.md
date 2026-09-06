# Product

<!-- impeccable:product-schema 1 -->

## Platform
web

## Stack
TypeScript, React, Three.js WebGPU, Bun, Vite. Local Three.js Water Pro 3.5.1 and Sky Pro 2.2.0.

## Users
The owner wants to inspect and command the existing ship presets in singleplayer fleet battles in a desktop browser.

## Product Purpose
A playable naval game foundation. The current scope includes port inspection, sailing and gunnery in custom singleplayer fleet battles, and a reproducible original ship asset pipeline. Future scope includes multiplayer combat and player-built ships.

## Capabilities and Constraints
Render the existing authored ship models on the supplied water and sky. CPU simulation owns movement, gun and torpedo-launcher poses, firing, torpedo motion, depth-charge flight and blasts, hits, module damage, flooding and sinking independently of React, rendering and local input. GPU ocean samples remain visual-only. Historical presets and future player-built ships share one versioned blueprint/definition format, including optional trainable torpedo mounts and depth-charge stations.

Start in the Fleet harbor garage. Custom battle replaces Set sail and the sea trial: choose the player's ship, zero to 29 friendly bots and one to 30 enemy bots. Bismarck, Yamato, Baltimore, Enterprise, Type VIIC and Fletcher can occupy any slot, including duplicates. Spawn distance selects 1–20 km between formation lines in 0.5 km steps, defaulting to 5 km. Start battle deploys both teams facing each other, with 650 m between adjacent ships. Return to port resets every ship, ammunition, shells, torpedoes, depth charges and flooding. Fleet selections and spawn distance are retained during the page session. Currency, commander skills, research, daily orders and refits remain authorized mock content, clearly labeled as progression previews and kept in memory.

Type VIIC is an original generic 1941 submarine preset with surface and submerged operation, with four bow tubes, one stern tube and 14 torpedoes. Keyboard 3 selects torpedoes; 1/2 select the 8.8 cm deck gun and 2 cm platform gun. Q or left mouse launches one eligible loaded tube per press; holding launches tubes in sequence. Torpedoes launch within ±15° of the bow or stern and run straight at 44 kn for up to 5 km. Target waterline in Gunnery supplies a constant-speed lead for the selected target. Arming at 300 m, 45 second tube reloads, damage and flooding are provisional gameplay values. Wakes and contact plumes visualize the CPU simulation. The Depth instrument orders Surface, Periscope (7 m), 50 m and 10 m adjustments; Z/X adjust depth and B makes an emergency ballast blow. Ballast fills/blows over time, planes gain authority with speed, and damage flooding remains separate. Electric motors supply submerged movement at up to 7.6 kn; diesels power the surface mode. Guns are secured below 0.5 m and tubes launch down to 12 m. The operating order limit is 150 m, with pressure damage beyond it. Chase follows the hull underwater; bridge/binocular views use the periscope eye, which remains above water at 7 m. Bots dive during torpedo approaches and surface while tubes reload. Battery endurance, finite air, oxygen, sonar, depth charges and homing are not implemented.

Fletcher is an independently authored early-war 1942-inspired destroyer with five articulated single 127 mm guns, one twin 40 mm mount and six single 20 mm mounts. Keyboard 3 selects two trainable quintuple torpedo mounts carrying ten Mk 15 rounds with no spare reloads. The mounts turn toward the sight; launch requires alignment within either broadside sector, 40–140° from the bow. Torpedoes run straight at about 45 kn for 5.5 km, settle to 2 m depth and arm after 300 m. The same press/hold launch controls and Target waterline lead apply.

Keyboard 4 selects Fletcher's depth charges: two stern racks and six side throwers carrying 28 charges. Q or left mouse releases one ready station per press; holding lays a spaced pattern independently of sight aim. Charges enter the water, sink at 2.5 m/s and burst at 10 m with damage falling off within a 32 m radius. Make a close pass and keep moving clear; the launching ship and allies can be damaged. Readiness, ammunition, target damage and flooding remain inspectable in the weapon instrument and Gunnery. The shallow burst and broad radius adapt the weapon to the current surface combat, including the surfaced Type VIIC; selectable burst depth, sonar and detailed shock propagation are absent. Fletcher's hull, fittings, protection and internal layout remain approximations, and its weapon performance and stocks are provisional gameplay tuning.

Team-aware bots select living opponents, navigate, lead targets and fire main and secondary guns within caliber-based engagement ranges. They also launch fitted torpedoes within their range and firing arcs, and release depth charges on predicted close passes when the blast clears friendly hulls. They avoid friendly firing lanes and steer away from nearby ships; shells, torpedoes and depth-charge blasts can still damage allied hulls. The battle HUD shows surviving fleet counts, enemy target selection, target range and equipment condition, and victory, defeat or draw. Friendly bots keep fighting if the player sinks. The chart distinguishes friendly and enemy contacts and marks the selected enemy. Target damage inspection uses each ship's own definition, including in mixed fleets.

Overhead labels on friendly and enemy bots show the ship name, live equipment-condition bar, percentage and vessel status without a background box or visible team/slot text. The player's own ship has no overhead label. Mint and salmon bars distinguish friendly and enemy ships. Labels follow the displayed hull poses directly and may overlap each other or the HUD. They hide outside the camera view, with the HUD or in port. Sinking labels retain the remaining equipment condition; buoyancy and stability determine sinking independently.

The port offers Statistics, Armor and Internals views for the loaded ship preset. Statistics prints category scores and a detailed sheet (survivability, armor, batteries, fitted torpedoes and depth charges, mobility, dimensions and model basis) read from the compiled combat definition. Torpedo statistics distinguish trainable mounts and carried reloads; depth-charge statistics show stocks, release stations, detonation depth, sink speed and blast radius. The inspection list and 3D volumes share the combat definition, including gunhouse armor and flooding compartments. Selecting a space isolates it and shows its dimensions. Layouts remain provisional gameplay data, and inspection does not change the ship or advance combat.

Bot tactics, firing ranges and approximate armor/module damage are provisional gameplay tuning. Enterprise fights with its authored guns; aircraft operations and physical ship-to-ship collision response are not implemented. Networking and an in-game ship editor remain future work.

## Evidence on Hand
`assets/ships/bismarck/baseline/Bismarck_1941.blend`, model README and dimensions; licensed Pro packages in Downloads. Model is 250.5 meters long, bow +X, waterline Z=0 in Blender.

Fletcher's original blueprint, recipe, source register and discrepancy report live under `assets/ships/fletcher/`. Sources support the class identity, principal dimensions and main weapon counts; the preset is not a certified reconstruction of a specific date. Export checks establish the model/blueprint contract without establishing historical accuracy.

## Product Principles
The ship and sea lead. Controls respond predictably. Preserve the original model. Make the singleplayer experience work before expanding the scope.
