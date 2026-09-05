# Bismarck — Sea Trials

A playable singleplayer foundation using **Bun, TypeScript, React, Three.js WebGPU, Water Pro 3.5.1, and Sky Pro 2.2.0**. Uses the supplied Bismarck Blender model at its original meter scale.

```sh
bun install
bun run dev
```

Open http://localhost:5173. Current Chrome or Edge with hardware acceleration is recommended. WebGPU is selected by Three.js when available; its WebGL2 backend is the compatibility fallback. The pause menu reports the actual backend. Initial startup compiles the ocean and cloud shaders, which can take a moment.

You start in port with the Bismarck moored. Drag to inspect the ship, then choose **Set sail** to enter the playable sea trial. **Return to port** in the pause menu ends the current trial. The selected [Fleet harbor garage](docs/garage-mockups/README.md) uses compact panels and a transparent top bar. Currency, refits, commanders, and future ships are illustrative, with temporary state only.

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

The throttle stays where you set it. Going from ahead to astern takes time. Handling is tuned for a battleship feel rather than an engineering-accurate maneuvering model. Four navigational buoys provide nearby reference points; they are markers, not collision obstacles. The chart follows your ship and displays its trail. Changing settings reloads the scene in port. Losing browser focus pauses sailing.

See [Ocean configuration](docs/ocean-configuration.md) for the water/sky settings, differences from the supplied Black Flag preset, and the reasoning behind the initial look.

## HUD

The Fleet action HUD uses compact naval combat instruments: live ship handling at lower left, secured armament below the sight, a local chart at lower right, and a live FPS counter beside pause/settings. The main instruments are about 15% smaller than the selected design mockup. Chart +/− buttons change its radius; Controls opens the sailing shortcuts. Combat controls remain secured until weapons and damage systems are implemented.

## Architecture

- `src/simulation/ship.ts`: plain serializable state and commands; fixed 60 Hz movement. No browser, React, Three.js, or GPU dependency.
- `src/game/InputController.ts`: converts local keyboard and touch input into helm commands.
- `src/game/Game.ts`: scene, Pro package integration, lifecycle, and a serialized asynchronous render loop. GPU buoyancy is a visual transform, separate from authoritative X/Z movement.
- `src/game/CameraRig.ts`: camera behavior, independent of simulation.
- `src/game/ShipWake.ts`, `WakeFoam.ts`: spreading bow/stern waves and a widening foam trail that follows the ship's historical course, breaks into patches, and fades with age.
- `src/ui/`: React instruments and settings. Telemetry updates at 10 Hz; React does not drive animation frames.
- `vendor/`: supplied Pro runtime bundles, declarations, data, and their license files. These are proprietary dependencies; their original license terms remain in force.
- `public/models/bismarck.glb`: exported ship, approximately 7 MB. Collection boundaries and materials are retained; static fittings are batched. Blender's procedural teak is baked into an embedded repeating texture.

Future multiplayer should run the shared simulation in an authoritative Bun server, accept per-player tick-stamped commands, and send ship snapshots for interpolation/reconciliation. Bot controllers can issue the same `HelmCommand`. Do not use GPU wave samples as authoritative gameplay state across clients: they can differ between GPU vendors. Networking, bots, weapons, damage, collisions, persistence, and matchmaking are **not implemented** in this first sea trial.

## Model export

The original `/Users/bill/models/bismarck/Bismarck_1941.blend` is never modified. To regenerate the runtime asset on this Mac:

```sh
bun run export:ship
```

`scripts/export-bismarck.py` also runs with any Blender executable via `blender --background --python scripts/export-bismarck.py`; set `BISMARCK_SOURCE` to override the input file. Export removes studio objects, applies curves/modifiers, merges static objects per collection, and writes GLB. The Blender source is bow +X, up +Z, waterline Z=0. The game rotates the GLB to bow -Z, up +Y, waterline Y=0. One world unit is one meter.

## Validation

```sh
bun test
bun run build
bun run preview
```

The simulation tests cover throttle, reverse, rudder direction, speed limits, invalid commands, tab-resume clamping, and identical state at different rendering frame rates. Browser validation is also needed for GPU rendering.

Three.js renderer reference: https://threejs.org/manual/en/webgpurenderer
