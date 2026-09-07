# Aircraft combat effects

Bombs now have an original olive body, nose band and thin box-tail fins, with a distinct torpedo payload shape. Released bombs retain their release attitude, interpolate the CPU ballistic path and settle into the falling velocity. The artillery renderer excludes them, so no luminous shell streak overlays a falling bomb.

Fighter gunfire uses two wing streams of separated moving tracer exposures: a pale hot core, wider amber envelope, compact tip and brief muzzle flash. Events retain gun direction, aircraft velocity and attitude; later aircraft/target movement cannot drag a tracer around. Pools keep fixed GPU allocations and clear inactive matrices.

A shot-down aircraft leaves the fighting strength immediately but keeps an unpowered CPU pose. Forward momentum, drag, gravity and a deterministic roll take it to a single Y=0 sea impact. Dark expanding smoke and small engine flames mark its actual descent; a water column, forward spray, lingering mist, surface foam and splash audio mark the impact. Smoke remains after the airframe disappears. Endurance losses descend without smoke/fire; lost carrier inventory does not create airborne wrecks.

The original procedural ordnance recipe is [aircraft-ordnance.ts](../../effects/naval/aircraft-ordnance.ts). Published ship/aircraft GLBs, their Blender recipes and all articulation IDs are unchanged. No Blender build was needed for these runtime effects.

## Fixed in-game views

The retained diagnostic [aircraft-effects.html](../../../scripts/diagnostics/aircraft-effects.html) uses the real Game, AircraftView, CombatEffects and ocean pipeline. Run the development server and open `/scripts/diagnostics/aircraft-effects.html`. Its buttons sample the same fixed fixtures, and `window.aircraftEffectsReview.sample(kind, seconds)` returns the CPU state and effect counts. The bomber pullout is scripted for repeatable composition; the bomb and wreck trajectories use production CPU code.

Captured through Orca's embedded browser on the WebGPU backend at medium quality, Fair seas, 1200 × 800 CSS pixels / 1800 × 1200 canvas pixels:

- [Bomb release, 0.8 s](bomb.png): one finned bomb, separating from the bomber; zero artillery bodies/glows.
- [Fighter burst, 0.24 s](tracers.png): six short moving tracer samples in two wing streams.
- [Descent, 3 s](descent.png): one rolling airframe and continuous expanding smoke, with no water spray before impact.
- [Sea impact, 5.9 s](impact.png): airframe removed, smoke retained, water plume and directional spray at the CPU crossing. The fixture crosses at tick 319 at `[298.397, 0, -983.629]`.

[Browser records](browser.json) retain the sampled states and counts. [Confirmation](confirmation.json) records an unchanged paused effect state over six rendered frames; the final browser console contained no warnings or errors.

## Validation

- New CPU coverage: momentum/gravity/roll, immediate combat exclusion, pause, exact surface crossing including a very low pass, one impact per loss, stationary retired wrecks, inventory losses, and reset.
- Effect coverage: separate traveling bursts, bounded trail lengths and GPU allocations, pause/no mutation, fading/reset, ballistic bomb interpolation without artillery glow, persistent smoke, event-driven water impact, and splash audio without spurious armor-hit sounds.
- Final effects tests: **23 passed** across AircraftView, AircraftGunfire, CombatEffects and audio.
- Broad simulation/game run: **504 passed**, with two tests exceeding Bun's default five-second timeout. Both passed with a 30-second timeout: bot opening-fire delay and Yamato wing-space flooding. No assertion failures remained.
- `bun run build`: **passed**, including all ten ship checks, all thirteen aircraft checks, TypeScript and Vite. Vite retains its large bundle advisory.
- `git diff --check`: passed. The design detector reported only six advisory palette entries on pre-existing naval effect materials.

Concise command results are retained in [validation.txt](validation.txt).

## Approximation register

These are gameplay/visual refinements, not a historical accuracy claim. Bomb dimensions/finish and wing muzzle placements are original approximations. Fighter hits remain the existing instantaneous burst damage rule; visible tracer travel does not add delayed bullet hit simulation. Wreck aerodynamics use simplified drag/gravity/roll and terminate at the flat gameplay sea, without terrain/ship collision, impact damage, airframe breakup, rescue, or sinking debris. Smoke and spray are bounded visual particles; GPU waves never control combat. Existing aircraft-follow behavior still returns to the ship when the tracked aircraft is lost.

## Integration before PR

Merged master `4ffbffe`, retaining its aircraft paint/rigid-component batching, single particle publication per frame, and hull-damage event evidence. `bun test src/simulation src/game --timeout 30000` passed **550 tests across 77 files** with zero failures. `bun run build` passed after integration. The 30-second test timeout accommodates the longer flooding/AI fixtures.

Repeated all four fixtures in WebGPU: one bomb without artillery glow, six moving tracer samples, the visible smoking descent, and one sea impact with persistent smoke/spray. The browser console contained no warnings/errors. See [merged browser records](merge-browser.json) and the [merged impact capture](merge-impact.png).
