# Air gunnery and panic review

2026-09-07. Gameplay tuning retains 100 HP aircraft, sharply reduces normal aim precision, raises hit damage and adds temporary poor fire discipline to automatic AA and fighters. See [current tuning](../../../docs/air-operations.md#air-gunnery-tuning-and-panic).

Validated 94 tests across air gunnery, aircraft accuracy/flight/operations, AA and candidate selection, AI levels, aircraft gunfire rendering and combat effects. The payload collision/scoring fixture disables defensive AA so it tests payload outcomes independently of ingress survival. The affected aircraft suite passed after that fixture adjustment. `bun run build` passed ship/aircraft checks, TypeScript and Vite; Vite retained its large-chunk advisory.

The in-game WebGPU review used the actual Game/CombatSimulation and renderer through Orca's embedded browser. A controlled 60-second incoming-target sample produced 3,826 barrel events, including 373 panic events, and 620 damage against a target whose HP was refreshed each tick. The final view contained 214 active tracers and 36 flak puffs. This is a controlled behavior/rendering check, not a dogfight benchmark or historical hit rate. [Runtime measurements and source hashes](runtime.json) identify the reviewed code.

[Captured firing view](panic-fire.png) shows scattered tracers and flak around the aircraft, including bursts far from its position. The capture was read from the rendered canvas after the browser screenshot command timed out.

During review, corrected the AA endpoint to use the lead-point solution's flight time and drag; previously the current-target range time and drag-free flight could prevent hits on incoming aircraft. The renderer now uses the same ballistic step, verified at the heavy-burst endpoint with inherited ship velocity and drag.
