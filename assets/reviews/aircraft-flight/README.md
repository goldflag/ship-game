# Aircraft flight revision review

September 2026. Shared CPU flight/tactics and the production aircraft renderer; no mesh, texture, recipe, blueprint or published model changes.

- Finite roll, pitch and throttle response; coordinated bank-driven turns; descent/pullout control; separate fighter, dive-bomber and torpedo-bomber envelopes.
- Persistent fighter targets with inbound strike priority, shared target pressure, lead pursuit, speed matching, breakaway turns, narrow aimed bursts and friendly-aircraft firing-lane checks.
- Staggered bomber staging, dive releases and gradual split brakes; low beam approaches for torpedoes with airborne travel included in the intercept; bounded retries after an aborted run.
- Patrol/holding circuits, extended centerline capture, moving-deck lead, go-arounds and sequential recovery.
- CPU mechanism state for gradual gear/hook/brakes and control inputs; interpolated flight attitude shared with the follow camera. Paused presentation does not advance mechanism state.

Validation:

- `regression-tests.txt`: 472 simulation, ship and game tests passed, no failures. This broader run preceded the final moving-deck lead correction.
- `focused-tests.txt`: all 25 aircraft/flight/view/follow tests passed after that correction, including moving/rotated-carrier touchdown, deterministic replay, safe pullout, angle-wrap interpolation, targeting priority and friendly gun lanes.
- `build.txt`: all nine ship checks, thirteen aircraft checks, TypeScript and production build passed after the final runtime change. The existing Vite large-chunk advisory remains.
- `banked-flight.png`: actual game canvas captured while following the first Wildcat in an Enterprise-versus-Bismarck battle. The aircraft banks with its path; another aircraft and the sea remain visible. `runtime-flight.json` is a subsequent live state sample, not a frame-exact registration of the image.
- `pause-check.json`: actual game paused while following a Dauntless; a later read confirmed the entire aircraft state (poses, controls and pilot memory) stayed identical.
- Orca embedded browser reviewed the current worktree on port 5289. Its full-window screenshot timed out; the retained image was read directly from the production game canvas. The initial port 5187 was already occupied, so it was not used to validate these changes.

Repeat the stationary, renderer-free flight measurements with:

```sh
bun assets/reviews/aircraft-flight/measure.ts vb-6
bun assets/reviews/aircraft-flight/measure.ts vt-6
bun assets/reviews/aircraft-flight/measure.ts vf-6
```

These step aircraft and their deck/AA context, without advancing ships or resolving released weapons. Retained sortie logs confirm all three launched survivors recover and rearm. The separate combat integration test advances the complete simulation and confirms bomb/torpedo hits, flooding and carrier damage credit. Longer test windows cover the new approach paths and traffic; no release, impact or recovery assertions were removed.

The role envelopes and pilot behavior remain game approximations. See [the ship's runtime flight discrepancy register](../../ships/enterprise-cv6/reports/flight-discrepancies.md). Export success and these checks are not historical certification.

## Visibility and launch follow-up

The later [visibility/launch review](visibility-launch/README.md) records the distant-silhouette fix, faster carrier launch cycle, new pixel measurements and final checks. Earlier launch and sortie timings on this page are retained as the prior revision.
