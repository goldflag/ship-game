# Squadron formation review — 2026-09-07

CPU formation guidance reviewed on the source hashes in `source-hashes.json`, based on `b990a226`. Existing aircraft/ship models are unchanged.

- 54 tests passed across aircraft, aircraftFlight, aircraftFormation, aircraftStrike, aircraftAccuracy, airOperations and squadronCommands. Coverage includes launch assembly, sustained banked patrol spacing for all three roles, continuous movement, seeded variation, leader loss, recall, coordinated releases, moving/close targets, physical misses and complete recovery/rearm cycles.
- `bun run build` passed ship/aircraft freshness checks, TypeScript and the production bundle. Vite retains its existing large-chunk warning.
- Orca embedded browser, actual Game renderer, WebGPU: `patrol.png` shows the six Dauntlesses in a separated V at 90 seconds. Measured slot error is at most 2.34 m in `patrol.json`.
- `torpedo-attack.png` shows the low approach at 90 seconds. Final corrections widen one arm; this is deliberately not a rigid attachment during weapon aiming. All six torpedoes release between 107.62 and 110.47 seconds (2.85-second wave), and all planes are returning at 150 seconds. See `torpedo-attack.json`.

Reproduce with `/scripts/diagnostics/aircraft-formation.html` and `?squadron=vt-6&attack`. `formationReview.advance(seconds)` advances the renderer-free aircraft simulation and renders a fixed overview. These visual fixtures disable enemy combat to isolate formation behavior; combat/AA and accuracy remain covered by the simulation regressions. Individual final aiming, evasive combat and landing circuits may break the formation. This is gameplay choreography, not historical formation or aerodynamic validation.
