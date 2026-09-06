# Yamato · fidelity 01

Reviewed 5 September 2026 Pacific (runtime timestamps use UTC). Fit: **7 April 1945 exterior**, separately declared **10.4 m trial draft**. Content hash: `e386fddd3669bac5b108603829564e96773463d4255fd37bac444015edf8db0a`.

## Visible and structural changes

The original loft now carries the recurved stem and bulb, explicit air above the bulb and recessed stern boat bays. A first-iteration centerline sheet and asymmetric stern diagonal were reproduced, corrected in the common loft/CPU surface code and regression-tested. Tapered bridge tiers, open lookouts, curved hollow funnel, AA galleries and pierced supports replace simpler surfaces. Access stairs, ladders, doors/louvers, windlasses and chains, reels, crane mechanisms and hollow launches add recognizable service detail.

Main and secondary gunhouses use independently authored closed facets with sloped faces, shoulders and planar roofs; pleated bucklers meet the actual housings. All five mounts and fifteen barrel chains retain their sockets and independent motion. Full hull ends and major structures now share visible, aiming, inspection and swept-hit surfaces. Nominal hull/structure steel is explicitly estimated at 25/8 mm. Separate fixed belt/deck/barbette plates replace the old broad citadel proxy. Lower powder stores, upper shell rooms, four turbine rooms, twelve boiler rooms and end spaces replace the earlier coarse internal layout without changing existing magazine IDs.

## Evidence and checks

- [Twelve matched views](matched-views.png), [five fixed material views](fixed-views.png), [interactive comparison / ZIP](../../generated/comparison/index.html), and the preserved [before blueprint](before/blueprint.json). All fixed/neutral views were visually inspected after iteration.
- [Export](../export.json): 264,906 triangles, 110 mesh nodes, 343 primitives, 11,623,044 bytes. All joints and 15 muzzle chains pass the shared export checks.
- [Dimensions](../dimensions.json): 263 m overall, 38.9 m extreme beam, 256 m waterline length, 36.9 m waterline beam, 10.4 m draft and 18.915 m depth pass. [Components](../components.json): 28 selected source-mesh checks pass. [Decoded hull/protection](../measurements.json): 44,642 hull triangles, watertight, zero degenerates/nonmanifold edges, all 27 room envelopes contained.
- [Independence](../independence.json): complete build and comparison with the raw game cache unavailable. Local Blender 5.2.0 LTS; no Blender MCP was exposed.
- [Live exact-hash record](runtime/review.json): twelve traverse/elevation/recoil combinations, maximum muzzle error 0.002746864 m; [positive](runtime/articulation-positive.png) and [negative](runtime/articulation-negative.png) limits. [Armor hover](runtime/armor-hover.png) identifies the 8 mm air-defense structure; [internal selection](runtime/internal-selection.png) isolates the port engine.
- Real UI launch and both battery controls consumed main 900→891 and secondary 900→894 rounds. The retained mixed-fleet series tests bow/stern/bridge entries and exits, air misses and valid descending waterline shots against Yamato, Baltimore and Enterprise. All high structural hits caused damage without flooding; valid waterline crossings admitted water on each hull. Actual target effects and damage inspection were exercised. Return to port restored tick 0, Exterior and zero water.

The [shared review](../../../fleet-fidelity/README.md) documents the seed-vs-UI distinction, exact test method, capture limitations, uncontrolled frame-rate observations and all-four-ship rebuild. The repository suite passed 247 tests / 30,803 assertions and production build.

## Historical limits

The Alexpl 1945 reconstruction supplies uniform-scale side/top registration at 15.404 px/m, approximately ±1 m interpretation uncertainty; it is not an as-built primary plan. O-45 and S-06-2 provide qualified section/component evidence. The unchanged Alexpl art and transformed overlays retain CC BY-SA 3.0 credit; museum photographs remain local and excluded from downloads.

Exact body offsets, bridge levels, 650/660 mm face-thickness disagreement, lower-belt/end schedules, barbette limits, secondary armor, AA placements, fitting inventories, bulkheads and usable flooding volumes remain unresolved or estimated. The six scalar dimensions do not close those discrepancies. See [source register](../../references/sources.json), [specification](../../modeling-spec.json) and [discrepancy register](../discrepancies.md). The historical older opening-salvo fixture is preserved explicitly; current above-water impacts are no longer required to flood this revised hull.
