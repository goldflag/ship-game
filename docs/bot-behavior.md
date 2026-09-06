# Bot behavior

Friendly and enemy bots share the same controller and physical weapon/damage rules as the player. Their crew model is provisional gameplay tuning. It adds imperfect information and deliberate variation without changing projectile physics, player aiming, armor or ship assets.

## Fire control

- The first target requires 8–14 seconds to acquire, plus 0–2 seconds per mount before it can fire. Changing targets requires a new 3–6 second solution and mount delays. Turret traversal, obstruction, ammunition and reload still gate every shot.
- Target position and heading are observed every 0.9–1.8 seconds. Velocity estimates blend observations and extrapolate between them. The controller does not read the player's helm or predict future course changes.
- Tracking settles over about 45 seconds on a steady target. Observed velocity changes reduce tracking quality. This approximates a crew establishing a solution; it does not analyze splash locations or implement historical ranging doctrine.
- Crews choose forward, middle or aft hull areas and change areas every 18–30 seconds. Each mount has its own longitudinal offset and aim height. Secondary guns aim somewhat higher. No internal module or magazine location is consulted.
- Each mount retains a range/bearing error between shots and revises it after firing. Error scales with range and decreases as tracking settles, retaining residual error. At 5 km the maximum range error falls from roughly 76 m to 19 m; maximum cross-range error is 60% of that. These are aim-solution errors, not random per-shell dispersion.
- A loaded main mount pauses an additional 0.8–3.5 seconds after its physical reload; secondary mounts add 0.2–1.4 seconds. Friendly firing-lane checks and caliber engagement caps remain in force.
- Fitted torpedoes obey the same opening/reacquisition delay and lead the delayed observed track. They then use their own tube reload, launch interval, bearing arc, arming/range limits and predicted friendly-lane check. Torpedoes do not use the gun crews' per-mount aim errors or additional gun-reload pauses.

## Helm and targeting

Nearest-opponent selection retains its 25% hysteresis. Bots do not have fleet coordination, threat scoring or a visibility/spotting system.

Ships with guns of at least 300 mm choose a preferred distance of 4.2–5.8 km; others choose 3.2–4.6 km. Bots approach beyond that distance, bring a broadside to bear nearby, and open the range when too close. Each crew chooses a side and small course offset, holds course/speed decisions for 22–38 seconds, and occasionally changes broadside. Hull avoidance still overrides the desired course near other ships.

A loss of more than 15 structural HP between observations prompts an 8–14 second turn away at 85% throttle. Below 35% structural HP, the preferred engagement distance increases by 35%. These reactions are tactical heuristics, not incoming-shell prediction or coordinated retreat.

Ships with functioning torpedo tubes and ammunition bring the nearest bow or stern tube bearing toward the observed intercept. Evasive turns and nearby-hull avoidance take precedence; without torpedo ammunition the controller returns to the gun engagement course.

## Reproduction and validation

`BattleFleet.seed` accepts an unsigned 32-bit integer; renderer-free callers default to seed 1. Every bot stores serializable crew memory and its own generator state in `FleetActor.bot`. Aim queries do not advance randomness. Simulation ticks alone advance observation and decision timers, so pausing and display frame rate do not change the outcome.

The browser chooses a fresh seed when preparing a battle. Development diagnostics expose it as `window.shipTrialDiagnostics().battleSeed`. `CombatSimulation.reset()` restores the initial seed and crew state. A new prepared battle receives a new seed.

`bots.test.ts` covers opening grace, varied aim, observation delay after a course change, target reacquisition, seeded variation/replay and damage reactions. Fleet tests exercise actual fire, ammunition, reloads, damage, team rules and identical outcomes at different display frame rates. Worst-case magazine damage remains a separate accurately aimed firing test, independent of bot accuracy.
