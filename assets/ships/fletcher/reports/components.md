# Fletcher turret and propeller correction — revision 4

All five Mk 30 housings and both screws were rebuilt as original geometry. The previous revision 3 sources, catalog part, fixed views, matching closeups and reports are preserved under `baseline/revision-3/`.

The [closeup review](../generated/comparison/index.html#components) shows previous / corrected / reference with identical cameras and the unchanged whole-model registration. No individual part was scaled or repositioned in the comparison images. The production geometry is independently authored; no game vertices, topology, UVs, textures or attachment transforms enter its recipe.

## Changed geometry

- The Mk 30 catalog part now has an asymmetrical 4.18 × 2.96 m enclosure, 3.20 m roof height above its training pivot, a gently sloping roof, shoulder corners and steep upper front. Its original 48 vertices / 92 triangles define both the rendered enclosure and yaw-local CPU armor. A real central recess clears the gun, and a separate curved shield follows elevation while the sleeve and barrel also follow recoil. Rear doors, side grab rails, sight shutters, an open captain's sight and base steps replace generic roof hatches and side doors.
- The blueprint positions use the revised forward-of-enclosure training axis. Stable `gun-1` through `gun-5` IDs and their yaw, elevation, recoil and muzzle socket IDs are retained. The original part generator is `assets/parts/author-mk30.py`; the versioned catalog is `assets/parts/guns.json`.
- Each screw now has three broad rounded blades, finite thickness, a cambered section and radial pitch variation. The paired lofts are handed, with a 4.2 m nominal diameter and ogival hubs. Shaft spacing, inclination and bearings were revised, and flared foil-section brackets terminate inside our authored hull surface. The six blades are closed solids. The two independent propeller pivots remain; sailing animation is still static.

## Evidence actually inspected

[GameModels3D Fletcher pasd021](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pasd021) supplies comparison rasters. Seventeen views are retained, including seven new turret/propeller views. They use one global 15 m/viewer-unit registration, without component fitting; the source waterline and later AA fit remain unverified.

The US Navy's [OP 1112 (2nd revision), p.288](https://www.navweaps.com/Weapons/WNUS_5-38_mk12_30-18_pic.jpg), reproduced by NavWeaps and credited to HNSA, shows the Mk 30 Mod 18 single base-ring arrangement. The actual plan and side drawing were inspected. It supports the general form and asymmetrical arrangement, but does not establish exact DD-445 Mod 0 dimensions or fittings. [Preserved drawing](../references/historical/op1112-mk30-mod18.jpg).

The US Navy's [All Hands, October 1952, printed p.3](https://thenavycwo.com/the-archives/all-hands-magazine/send/16-all-hands-magazine/308-all-hands-october-1952) shows a broad three-bladed screw being fitted to USS Lewis Hancock (DD-675). The actual photograph and caption were inspected. This is a postwar sister-ship reference, not a July 1942 Fletcher propeller plan. [Preserved page](../references/historical/all-hands-1952-propeller-extract.pdf).

Exact Mod 0 plate curvature, outfit details, propeller diameter/pitch distribution, section offsets and shaft alignment remain estimated. The 3.8 m nominal pitch is an authoring control, not a sourced engineering dimension. Existing gunhouse armor thickness and combat performance remain gameplay values. See the [discrepancy register](discrepancies.md).

## Verification

Final model: `21547dc10500b4bf4ce24f8709a5276f6db3f05958261afedcd6f1f5914ea62e` — 302,822 triangles, 86 meshes, 12,572,908 bytes.

The shared `ship:build`, `ship:check` and `ship:review` pipeline passed. All five fixed views and the matching side/front/top/quarter turret and stern/side/quarter propeller views were inspected. Local Blender 5.2 was used; no Blender MCP tools were exposed.

The geometry-authoring pass had 297 passing tests (34,346 assertions); current master integration is recorded in [merge-validation.md](merge-validation.md). The final GLB passed 18 articulation poses in isolated Chromium/WebGPU; maximum gun muzzle disagreement was 0.683 mm and torpedo disagreement 0.00261 mm. Ten torpedoes launched and hit; eight depth charges launched and detonated. No page errors were reported by the isolated browser.

Additional closeups show neutral, -15° and +85° elevation with recoil, plus both loaded propellers. Propeller inspection temporarily hides sea and other ship meshes; manually rotating the two pivots by opposite 60° about their shaft axes preserves their origins and axes. This verifies independent geometry, not new sailing animation. Orca passed an initial articulation review of this geometry before the final metadata update. Its embedded tab became unavailable during capture; the remaining images were taken in a fresh isolated Chromium instance, not by attaching to Orca's browser.

`check-components.py` additionally verifies six manifold blade solids with positive volume and conservative barrel clearance against our original enclosure at eight elevation/recoil combinations. The minimum sampled clearance is 0.1599 m; this is not an all-fittings collision proof. Successful exports and these checks do not certify historical accuracy.
