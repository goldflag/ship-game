# Product

<!-- impeccable:product-schema 1 -->

## Platform
web

## Stack
TypeScript, React, Three.js WebGPU, Bun, Vite. Local Three.js Water Pro 3.5.1 and Sky Pro 2.2.0.

## Users
The owner wants to drive their existing Bismarck model in singleplayer in a desktop browser.

## Product Purpose
A playable naval game foundation. The current scope includes free sailing, a singleplayer gunnery/damage trial, and a reproducible original ship asset pipeline. Future scope includes multiplayer combat and player-built ships.

## Capabilities and Constraints
Render the supplied ship on the supplied water and sky. Keep the simulation independent of React, rendering, and local input so future controllers can provide bot or network commands. Main and secondary guns, approximate armor/module damage and compartment flooding are implemented in the trial. Networking and an in-game ship editor remain future work.

Start in a home-port garage before sailing. The selected Fleet harbor layout lets the player inspect Bismarck and choose Set sail; returning to port resets the sea trial. Currency, commander skills, research, daily orders and refits are authorized mock content, clearly labeled as progression previews and kept in memory.

The port offers Exterior, Armor and Internals views for the loaded ship preset. The inspection list and 3D volumes share the combat definition, including gunhouse armor and flooding compartments. Selecting a space isolates it and shows its dimensions. Layouts remain provisional gameplay data, and inspection does not change the ship or advance combat.

## Evidence on Hand
`assets/ships/bismarck/baseline/Bismarck_1941.blend`, model README and dimensions; licensed Pro packages in Downloads. Model is 250.5 meters long, bow +X, waterline Z=0 in Blender.

## Product Principles
The ship and sea lead. Controls respond predictably. Preserve the original model. Make the singleplayer experience work before expanding the scope.
