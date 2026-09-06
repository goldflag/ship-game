# Distant aircraft visibility and faster carrier launches

The distance regression was thin geometry failing to cover raster samples, rather than a missing LOD or an aircraft being removed from simulation. In the 1000×700 WebGPU fixture, the Wildcat contributed 377 visible pixels at 100 m, 37 at 401 m, 11 at 800 m, 3 at 1500 m and zero at 3000/6000 m. Forcing LOD0, LOD1 or LOD2 at 3000 m still produced zero pixels; the renderer retained one aircraft instance throughout. Fog was absent from this minimized reproduction.

The renderer now fades in a seven-pixel silhouette as projected wingspan falls below 14 pixels. It uses one instanced draw bounded by the airborne cap, with depth testing and normal scene fog. The real model remains present. Binocular zoom resolves the normal model and fades the supplement away. Deck/lost aircraft, port and inspection do not gain silhouettes. No ship/aircraft asset or simulation collision size changed.

- `distance-after.json`: the original WebGPU fixture now has visible coverage at 800, 1500, 3000, 6000 and 10000 m, while near views remain unchanged.
- `ocean-distance-after.json`: the production Game renderer, ocean, fog and postprocessing also retain coverage at those distances. Measurements use the 32×32 pixel region around the aircraft, with the plane toggled off/on in a paused scene. This avoids counting unrelated scene changes.
- `ocean-3km.png`: actual production canvas capture. The distant aircraft appears near the center of the horizon.
- `occlusion.json`: an opaque cloned ship placed between camera and aircraft reduced the difference to zero pixels, confirming that the silhouette does not show through geometry. The clone is a deliberate rendering fixture, not a combat scenario.

Carrier launch taxi is faster, the deck run lasts 3.6 seconds over 140 m, and the following taxi can start once the preceding aircraft has cleared the bow. The authored launch interval and airborne cap still apply. Return taxi retains its old speed. These are gameplay timings, not historical operating figures.

`launch-timing.json` records liftoff at **11.85, 24.18 and 36.02 seconds**, compared with approximately 20, 42 and 63 seconds before this follow-up. At most one plane occupied taxi/takeoff deck runs at a time. Reproduce with `bun assets/reviews/aircraft-flight/visibility-launch/launch-timing.ts`.

Validation: 27 aircraft/flight/view/follow tests and 24 game/frame/Enterprise integration tests passed. The production build passed all nine ship and thirteen aircraft checks, TypeScript and Vite; the existing large-bundle advisory remains. Logs are retained alongside this report.

Repeat pixel checks in `/scripts/diagnostics/aircraft-distance.html` using `aircraftDistanceReview.sample(range)`, or `/scripts/diagnostics/aircraft-visibility-ocean.html` using `oceanAircraftReview.sample(range)`. Both use real published aircraft and the production AircraftView. The ocean fixture waits for normal Game initialization before exposing its API.
