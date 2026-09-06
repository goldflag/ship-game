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
Render the existing authored ship models on the supplied water and sky. CPU simulation owns movement, gun poses, firing, torpedo motion, hits, module damage, flooding and sinking independently of React, rendering and local input. GPU ocean samples remain visual-only. Historical presets and future player-built ships share one versioned blueprint/definition format.

Start in the Fleet harbor garage. Custom battle replaces Set sail and the sea trial: choose the player's ship, zero to four friendly bots and one to five enemy bots. Bismarck, Yamato, Baltimore, Enterprise and Type VIIC can occupy any slot, including duplicates. Spawn distance selects 1–20 km between formation lines in 0.5 km steps, defaulting to 5 km. Start battle deploys both teams facing each other, with 650 m between adjacent ships. Return to port resets every ship, ammunition, shells, torpedoes and flooding. Fleet selections and spawn distance are retained during the page session. Currency, commander skills, research, daily orders and refits remain authorized mock content, clearly labeled as progression previews and kept in memory.

Type VIIC is an original generic 1941 submarine preset for surface operation, with four bow tubes, one stern tube and 14 torpedoes. Keyboard 3 selects torpedoes; 1/2 select the 8.8 cm deck gun and 2 cm platform gun. Q or left mouse launches one eligible loaded tube per press; holding launches tubes in sequence. Torpedoes launch within ±15° of the bow or stern and run straight at 44 kn for up to 5 km. Target waterline in Gunnery supplies a constant-speed lead for the selected target. Arming at 300 m, 45 second tube reloads, damage and flooding are provisional gameplay values. Wakes and contact plumes visualize the CPU simulation. Diving and homing are not implemented.

Team-aware bots select living opponents, navigate, lead targets and fire main and secondary guns within caliber-based engagement ranges. They also launch fitted torpedoes within their range and firing arcs. They avoid friendly firing lanes and steer away from nearby ships; shells and torpedoes can still hit allied hulls. The battle HUD shows surviving fleet counts, enemy target selection, target range and hull condition, and victory, defeat or draw. Friendly bots keep fighting if the player sinks. The chart distinguishes friendly and enemy contacts and marks the selected enemy. Target damage inspection uses each ship's own definition, including in mixed fleets.

Overhead labels on friendly and enemy bots show the ship name, live structural HP bar and current HP number without a background box or visible team/slot text. The player's own ship has no overhead label. Mint and salmon bars distinguish friendly and enemy ships. Labels follow the displayed hull poses directly and may overlap each other or the HUD. They hide outside the camera view, with the HUD or in port. Sinking labels retain the remaining structural HP, since flooding can sink a ship before its structure reaches zero.

The port offers Statistics, Armor and Internals views for the loaded ship preset. Statistics prints category scores and a detailed sheet (survivability, armor, batteries, mobility, dimensions and model basis) read from the compiled combat definition. The inspection list and 3D volumes share the combat definition, including gunhouse armor and flooding compartments. Selecting a space isolates it and shows its dimensions. Layouts remain provisional gameplay data, and inspection does not change the ship or advance combat.

Bot tactics, firing ranges and approximate armor/module damage are provisional gameplay tuning. Enterprise fights with its authored guns; aircraft operations and physical ship-to-ship collision response are not implemented. Networking and an in-game ship editor remain future work.

## Evidence on Hand
`assets/ships/bismarck/baseline/Bismarck_1941.blend`, model README and dimensions; licensed Pro packages in Downloads. Model is 250.5 meters long, bow +X, waterline Z=0 in Blender.

## Product Principles
The ship and sea lead. Controls respond predictably. Preserve the original model. Make the singleplayer experience work before expanding the scope.
