# Incoming-hit directions

The requested HUD marker extends the existing salmon damage signals with an arc and outward tip around the sight. It uses the incoming shell's horizontal velocity and the actual active camera bearing, including binocular and shell-follow views. Stops, ricochets, penetrations and module hits count; layered reports from one shell count once. Nearby directions combine, with six simultaneous cues maximum. Cues hold for 1.2 seconds, fade over one second, and freeze on pause. Presentation reads combat events without changing simulation state.

The center stays clear and markers do not intercept input. The overlay is a sibling of the ocean viewport above ordinary instruments, so the narrow-screen target selector cannot hide a direction. Port and H hide it.

## Validation

- After integrating the latest master health and fleet-performance changes: **204 tests passed, 0 failed** across 33 files, and `bun run build` passed.
- `bun run test --timeout 20000`: 192 passed, 0 failed. The first run had 191 passes and one existing bot endurance test exceed Bun's default five-second timeout while the build ran concurrently. No assertions failed; the complete rerun passed.
- `bun run build`: passed, including all four ship checks and TypeScript. The existing large-bundle warning remains.
- After the layering adjustment, the build and 23 focused game/frame/hit-direction tests passed again.
- New tests exercise actual stopped shells from four directions with unchanged hull HP, camera rotation and wrap, projectile deduplication, salvo merging, crossfire bounds, pause, expiry, reset and filtering of unrelated events.
- The detector reported only two advisory palette entries. Both colors already occur in `FleetHud.css`: salmon `#ee9b86` and dark underlay `#07131b`.

## Browser evidence and limits

[Initial desktop capture](desktop-initial.png) shows the production overlay driven by four controlled real simulation hits over the live WebGPU battle. The fixture holds simulation time; this is not a claim of four simultaneous live enemy hits. The desktop sight and overlay center were (720, 450), including a measured 12× view. At 390 × 844 and 12× they were (195, 422), without document overflow; markers scaled to approximately 250 px across.

[Initial interaction capture](interactions-initial.json) verifies east-facing camera labels, H hiding/restoring the layer, unchanged opacity at a paused tick, expiry and hidden visibility. These checks preceded the layering adjustment.

Initial mobile inspection showed the left arc partly covered by the target selector. The final code attaches the marker layer beside the viewport at z-index 2 and extends H's visibility selector to that sibling. The subsequent screenshot attempt returned a port view after hot reload, then Orca reported `runtime_unavailable` during reload. Those port captures were discarded. Final layering is covered by source review and a passing build, but a current screenshot confirmation is unavailable.
