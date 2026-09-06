# USS Enterprise CV-6 · fidelity 01

Reviewed 5 September 2026 Pacific (runtime timestamps use UTC). Fit: **June 1942 / Midway, pre-bulge and pre-enlargement**, separately declared **25 ft 11½ in reference draft**. Content hash: `e968df81e5fbf119177548826b2dc4377f4a8e6ef3611b75984dadbe0d89e52d`.

## Visible and structural changes

The fifty retained hull stations now use the same 48-point arc-length sampling in the original blueprint and renderer. This preserves the preceding rendered loft rather than asserting every corner of the raw offset transcription is exact. The CSV and unsampled before blueprint remain intact. Cambered flight-deck and elevator surfaces are original versioned triangles, with genuine holes in the surrounding slab and no second collision skin over the lift platforms.

Open hangar portals/frames, supported galleries, pierced webs and end cantilevers, island stairs/ladders/doors/louvers, funnel service pipes, director optics, mooring reels, hollow boats and arrestor/deck machinery add legible carrier-specific detail. Hull ends, deck, island, funnel and substantial galleries share visible geometry with CPU hits, aiming and inspection; hangar air remains air. Estimated hull/structure steel is 15.875/6 mm. Separate belt bands approximate the lower taper; internals gain end spaces and a steering envelope inside the rising counter. All 42 mounts / 54 barrel chains, three elevator IDs and the starboard bridge viewpoint remain independent.

## Evidence and checks

- [Twelve matched views](matched-views.png), [five fixed material views](fixed-views.png), [interactive comparison / ZIP](../../generated/comparison/index.html), and preserved [before blueprint](before/blueprint.json). All fixed/neutral views were inspected, including hull ends, island and stern equipment.
- [Export](../export.json): 206,818 triangles, 222 mesh nodes, 419 primitives, 7,512,012 bytes; eight single 5-inch, four quadruple 1.1-inch and thirty single 20 mm mounts retain all original joint/socket IDs.
- [Dimensions](../dimensions.json) independently measures actual hull, flight deck/camber, elevators, island elevations, belt breadth and rudder. Principal 246.7356 m steel length, 7.9121 m draft and 24.384 m flight-deck centerline height above baseline are retained. The documented molded/over-plating beam differences remain explicit. [Decoded hull/protection](../measurements.json): 10,842 hull triangles, watertight, zero degenerates/nonmanifold edges, all eight room envelopes contained.
- [Independence](../independence.json): complete asset build/comparison with raw game cache unavailable. Local Blender 5.2.0 LTS; no Blender MCP was exposed.
- [Live exact-hash record](runtime/review.json): twelve traverse/elevation/recoil combinations, maximum muzzle error 0.000032351 m; [positive](runtime/articulation-positive-canvas.png) / [negative](runtime/articulation-negative-canvas.png) limits. [Armor](runtime/armor-canvas.png) exposes the estimated 6 mm funnel casing; [internal selection](runtime/internal-selection-canvas.png) isolates steering. The [bridge camera](runtime/bridge-view-canvas.png) remains on the starboard island.
- Actual UI launch against the mixed fleet, main fire 2880→2876, secondary fire 66800→66788, and return to port passed. The secondary count is the combined authored AA ammunition pool; only aligned/clear barrels fired. Reset restored tick 0, Exterior and zero water. The [mixed live shot record under Yamato](../../../yamato/reports/fidelity-01/runtime/review.json) identifies Enterprise as victim: bow/stern/island AP entries/exits caused damage while dry, air missed and a valid descending waterline crossing admitted water. Automated regressions separately verify open hangars and elevator skin replacement.

See the [shared report](../../../fleet-fidelity/README.md) for seed-vs-UI methodology, direct canvas capture limitations and uncontrolled frame-rate observations. Full repository verification passed 247 tests / 30,803 assertions and production build. Flight operations were outside this ship-detail pass; existing master features were preserved.

## Historical limits

Primary March 1942 Navy island photographs are included and credited. Discontinuous 1934 contract sheets and qualified 1940 CV-5 class evidence cannot establish a registered whole-ship Midway overlay; the pack explicitly supplies matched original before/after cameras, sections, scalar measurements and source links instead. Restricted contract scans stay local.

Exact CV-6 as-built offsets, island-height conflicts, deck shoulders/camber, AA locations, remaining boat inventory, markings, shell allowances and internal boundaries remain open. The lower four-foot belt taper uses four one-foot midpoint bands (up to 4.763 mm local thickness approximation); frame 35–162 limits are qualified class evidence and the 38.1 mm deck family/closures remain provisional. See [sources](../../references/sources.json), [specification](../../modeling-spec.json) and [discrepancies](../discrepancies.md). A matching export is not a historical accuracy certificate.
