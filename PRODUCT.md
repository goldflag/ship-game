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
Render the existing authored ship models on the supplied water and sky. CPU simulation owns movement, gun poses, firing, hits, module damage, flooding and sinking independently of React, rendering and local input. GPU ocean samples remain visual-only. Historical presets and future player-built ships share one versioned blueprint/definition format.

Start in the Fleet harbor garage. Custom battle replaces Set sail and the sea trial: choose the player's ship, zero to four friendly bots and one to five enemy bots. Bismarck, Yamato, Baltimore and Enterprise can occupy any slot, including duplicates. Start battle deploys two parallel formation lines 5 km apart, with 650 m between adjacent ships. Return to port resets every ship, ammunition, shells and flooding. Fleet selections are retained during the page session. Currency, commander skills, research, daily orders and refits remain authorized mock content, clearly labeled as progression previews and kept in memory.

Team-aware bots select living opponents, navigate, lead targets and fire main and secondary guns within caliber-based engagement ranges. They avoid friendly firing lanes and steer away from nearby ships; shells can still hit allied hulls. The battle HUD shows surviving fleet counts, enemy target selection, target range and hull condition, and victory, defeat or draw. Friendly bots keep fighting if the player sinks. The chart distinguishes friendly and enemy contacts and marks the selected enemy. Target damage inspection uses each ship's own definition, including in mixed fleets.

Overhead labels show the ship name, live structural HP bar and current HP number without a background box or visible team/slot text. Mint and salmon bars distinguish friendly and enemy ships. They follow the displayed hull poses, make room for the instruments and aiming sight, and hide outside the camera view, when no clear placement fits, with the HUD or in port. Sinking labels retain the remaining structural HP, since flooding can sink a ship before its structure reaches zero.

The port offers Exterior, Armor and Internals views for the loaded ship preset. The inspection list and 3D volumes share the combat definition, including gunhouse armor and flooding compartments. Selecting a space isolates it and shows its dimensions. Layouts remain provisional gameplay data, and inspection does not change the ship or advance combat.

Bot tactics, firing ranges and approximate armor/module damage are provisional gameplay tuning. Enterprise fights with its authored guns; aircraft operations and physical ship-to-ship collision response are not implemented. Networking and an in-game ship editor remain future work.

## Evidence on Hand
`assets/ships/bismarck/baseline/Bismarck_1941.blend`, model README and dimensions; licensed Pro packages in Downloads. Model is 250.5 meters long, bow +X, waterline Z=0 in Blender.

## Product Principles
The ship and sea lead. Controls respond predictably. Preserve the original model. Make the singleplayer experience work before expanding the scope.
