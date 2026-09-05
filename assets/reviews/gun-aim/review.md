# Current gun aim review

The selected battery has numbered aiming circles separate from the white command sight. They project the actual barrel trajectory to sight range, or to sea level when a shot falls short. The calculation uses the firing simulation's muzzle transforms, direction, inherited ship velocity and gravity. It does not predict intervening collisions.

## Verification

- `bun run test`: 175 passed, 0 failed. New coverage checks traversal convergence, predictions against actual short-shot splashes while moving, battery selection, screen projection including points behind the camera, visibility through shell-follow/port transitions, and readable distinct readiness/countdowns at converged aim positions.
- `bun run build`: passed (ship checks, TypeScript and Vite). Existing large bundle warning remains.
- Actual WebGPU battle at 1440 × 900: [desktop.png](desktop.png) shows forward turrets 1–2 aligned and rear turrets 3–4 still turning aft. The circles leave the ship and sea visible.
- Live UI interactions: [interactions.json](interactions.json) records firing changing labels to reload countdowns, visible circles in binocular view, and the H instrument toggle hiding/restoring them.
- At 390 × 844, live label rectangles were x=169.81–220.45 / y=441–460 (aligned) and x=292.04–363.16 / y=441–460 (aft), within the viewport. Mobile screenshot capture failed twice with Orca's `Page.captureScreenshot` timeout; mobile evidence is limited to DOM geometry.
- Impeccable detector: advisory findings only, for existing HUD shadow/status colors and a compact 10 px mobile label. No blocking findings.

## Finish review corrections

The independent review identified overlapping labels for nearby guns in different states and misleading shared countdowns when loaded and reloading guns were both turning. Groups now require matching readiness and displayed reload seconds; label placement stacks conflicting readings without moving the true aim circles.

[mixed-states.json](mixed-states.json) records final DOM rectangles at both viewports for five deliberately converged fixture mounts: loaded/turning, turning with 5 s and 12 s reloads, aligned/loaded, and disabled. All five readings remain separate and nonoverlapping. This fixture exercises the production overlay with controlled input; it is not a recorded battle salvo. Mobile screenshot capture remained unavailable. The final desktop capture returned a stale port framebuffer, so it was discarded; final mixed-state validation uses DOM geometry and the regression test.

Final independent disposition: **ship**.

| Material fix | Verdict |
| --- | --- |
| Conflicting labels overlap | Resolved |
| Grouped countdown misrepresents loaded guns | Resolved |

No material fixes remain in the bounded review. Final appearance could not be recaptured; the original desktop screenshot is the visual baseline, supplemented by final source, tests and rendered DOM measurements.

No ship models, combat rules or shell-follow camera behavior changed.
