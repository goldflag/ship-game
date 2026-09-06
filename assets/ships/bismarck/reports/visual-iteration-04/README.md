# Bismarck fourth correction · 5 September 2026

The six 15 cm gunhouses now have a rear roof ridge, falling forward roof, clipped nose and near-vertical side walls. Their original 24-facet component also supplies moving armor, replacing the uniform inspection boxes. Thinner barrel jackets, pleated blast bags, rear access hatches, ladders, periscopes and the middle pair’s rangefinder fittings follow the preserved yaw/elevation/recoil joints. Main turret geometry and all ten mounting axes are retained.

The navigation wheelhouse is now forward of a separate conning enclosure, with glazing fitted to the actual chamfered walls. The conning crown is narrower; the upper galleries have recessed centers and projecting wings, with distinct bulwark heights, supported overhangs, stairs and navigation fittings. Their major volumes remain in the blueprint for both Blender and CPU structural hits.

The six transverse bulkheads previously used constant-width rectangles. Forward lower corners extended about 1.94 m beyond the reconstructed shell, and the aft lower plate reached below its local keel. The blueprint now contains convex polygons fitted at both faces of each physical plate, with 25 mm inward clearance. IDs and thickness families remain intact. A regression exercises actual inspection geometry, including edge samples, and checks that centerline shots still encounter every layer. A separate sampled trace against the triangulated structural hull confirms at least 24.8 mm clearance.

| Area | Before | After |
| --- | --- | --- |
| Bridge in-game | [Before](browser/bridge-before.png) | [After](browser/bridge-after.png) |
| Secondary gunhouse in-game | [Before](browser/secondary-before.png) | [After](browser/secondary-after.png) |
| Forward transverse armor | [Reported image](armor-reported.png), [reproduced](browser/armor-before.png) | [Fitted armor](browser/armor-after.png) |
| Aft transverse armor | Original lower edge at −7.60 m; local keel about −7.085 m | [Fitted armor](browser/aft-armor-after.png) |
| Fixed orthographic bridge | [Before](bridge-before.png) | [Current](../../generated/comparison/authored/bridge.png) |

These are direct game-canvas captures and fixed Blender review views. Screenshots are qualitative evidence; camera positions, build hashes and articulation errors accompany the browser images. [Geometry record](geometry-review.json), [edge clearances](armor-edge-clearances.txt), [fixed review views](../../generated/review/), and [matched historical/game comparisons](../../generated/comparison/index.html) retain the evidence.

The fit remains 24 May 1941 at a separate 9.33 m standard draft. Original topology and fittings interpret the retained [24 May reconstruction](https://www.kbismarck.com/24-may-drawing.html), BArch RM 25/231 image 0004, and the retained [secondary protection schematic](https://www.kbismarck.com/proteccioni.html). GameModels3D raster views were comparison material. No game meshes, textures or attachment transforms were used. Gunhouse dimensions, bridge contours and fitting placements still need original measured drawings; the conning enclosure still uses provisional structural plating rather than its historical armor schedule. See the [discrepancy register](../discrepancies.md).

Durable inputs are `blueprint.json`, `build.py`, the original gun catalog and `fit-transverse-armor.py`. The fitter is an explicit authoring tool to rerun after hull changes; it writes the blueprint before compilation. Local Blender 5.2 performed the builds. Blender MCP tools were unavailable in this session.

## Validation

Final content hash: `957a349026ab6dfccb0b6caa5469c6899066fe034d3e9563940ad0b8e336037b`.

`ship:build bismarck`, `ship:check bismarck`, `ship:review bismarck` and `bun run build` passed. The export has 368,428 triangles, 98 mesh nodes, 286 material primitives and 21,897,784 bytes. All six dimension checks pass; the watertight hull, 39 contained compartment envelopes and ten mounting axes remain intact. The blueprint compiles to 509 armor facets and 24 major structures. Only Bismarck uses the changed secondary component, so no other preset requires a geometry rebuild.

The full suite passed **184 tests, 0 failures, 26,744 assertions across 29 files**, including the new transverse containment and secondary facet regressions. After the final stairs, supports and turret access-fitting refinement, all four actual GLB hierarchy tests passed again (47 assertions), and the production build passed all four preset checks, TypeScript and Vite. [Test log](tests.txt), [production build](production-build.txt).

Inspected the final five fixed review views, bridge and turret close views, and both corrected transverse regions in the actual WebGPU game. Both traverse extremes, minimum/maximum elevation and full recoil passed, with maximum muzzle discrepancy **0.002166 m**. [Articulation checks](browser/articulation-checks.json), [positive pose](browser/articulation-positive.png), [negative pose](browser/articulation-negative.png).

A 1 km Bismarck custom battle was launched through the game UI, then exercised with fixed CPU ticks in that same live game while bot AI remained enabled. The bow-on secondaries correctly remained obstructed; after a helm turn exposed their firing arcs, the player fired **28 secondary shells**, in addition to **8 main shells**. Hits damaged the enemy and included stops against the fitted forward transverse armor. The replay reached tick **4,200**, with maximum muzzle discrepancy **0.002168 m**. This is a functional replay, not a performance measurement. [Both batteries](browser/combat-checks.json), [underway](browser/underway.png). Returning through the normal port control reset tick to 0, ammunition to 2,760, hull integrity to 100%, water to 0 and combat events to empty. [Reset diagnostics](browser/return-to-port.json).
