# Product

<!-- impeccable:product-schema 1 -->

## Platform
web

## Stack
TypeScript, React, Three.js WebGPU, Bun, Vite. Local Three.js Water Pro 3.5.1 and Sky Pro 2.2.0.

## Users
The owner wants to drive their existing Bismarck model in singleplayer in a desktop browser.

## Product Purpose
A playable naval game foundation. The current scope is free sailing; future scope includes multiplayer combat with bots and players.

## Capabilities and Constraints
Render the supplied ship on the supplied water and sky. Keep the simulation independent of React, rendering, and local input so future controllers can provide bot or network commands. Combat and networking are not part of this first build.

Start in a home-port garage before sailing. The selected Fleet harbor layout lets the player inspect Bismarck and choose Set sail; returning to port resets the sea trial. Currency, commander skills, research, daily orders and refits are authorized mock content, clearly labeled as progression previews and kept in memory.

## Evidence on Hand
`/Users/bill/models/bismarck/Bismarck_1941.blend`, model README and dimensions; licensed Pro packages in Downloads. Model is 250.5 meters long, bow +X, waterline Z=0 in Blender.

## Product Principles
The ship and sea lead. Controls respond predictably. Preserve the original model. Make the singleplayer experience work before expanding the scope.
