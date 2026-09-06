# USS Baltimore · fidelity 01

Reviewed 5 September 2026 Pacific (runtime timestamps use UTC). Fit: **October 1943**, separately declared **24 ft 2 in limiting keel draft**; not the 26 ft 10 in navigational draft. Content hash: `0079ff92853af02a9f22fae2001babdc8a4d65940d79fe4eae9beb946b006887`.

## Visible and structural changes

The cruiser keeps all 120 original stations, thirteen cross-section anchors and retained Baltimore bridge polygons, with monotone fairing between anchors. Original closed 8-inch and twin 5-inch gunhouse facets give the weapons distinct faces, shoulder/roof breaks and fore/aft dimensions while preserving all nine mounts and 21 muzzle chains. Raked funnel jackets, pierced supports, stairs, ladders, doors/louvers, curved boats, chain/windlass gear, reels, crane winches/hooks and catapult rollers improve characteristic equipment detail.

The visible hull, broad transom and major structures now also supply CPU swept hits, sight picking and inspection. The shared hull-cap correction closes the previously unhittable transom, with a dedicated regression. Estimated 16/6 mm hull/structure steel is separate from provisional belt, protective-deck, barbette and moving gunhouse protection. Forward/after machinery and boiler-unit envelopes are separated, end flooding spaces added and existing magazine/module bindings retained.

## Evidence and checks

- [Twelve matched views](matched-views.png), [five fixed material views](fixed-views.png), [interactive comparison / ZIP](../../generated/comparison/index.html), and preserved [before blueprint](before/blueprint.json). All fixed/neutral views were visually inspected.
- [Export](../export.json): 260,522 triangles, 126 mesh nodes, 370 primitives, 8,587,524 bytes. All nine mounts / 21 independent barrel chains pass export/articulation checks.
- [Dimensions](../dimensions.json): 205.2574 m overall, 202.3872 m waterline length, 21.59 m beam and 7.366 m keel draft pass the 5 mm computational tolerance. [Decoded hull/protection](../measurements.json): 19,656 hull triangles, watertight, zero degenerates/nonmanifold edges, all ten room envelopes contained.
- [Independence](../independence.json): complete build and comparison with raw game cache unavailable. Local Blender 5.2.0 LTS; no Blender MCP was exposed.
- [Live exact-hash record](runtime/review.json): twelve traverse/elevation/recoil combinations; maximum muzzle error 0.001317078 m. [Positive](runtime/articulation-positive-canvas.png) / [negative](runtime/articulation-negative-canvas.png) poses, [armor](runtime/armor-canvas.png), [internal selection](runtime/internal-selection-canvas.png) and [mixed-fleet target inspection](runtime/mixed-fleet-inspection-canvas.png) are actual WebGPU captures, not neutral Blender views. Hover identified the estimated 6 mm after funnel; the forward engine was isolated.
- Actual UI launch against three mixed enemies, main firing 1350→1344 rounds, secondary 4320→4312, damage inspection and return to port passed. Blocked/out-of-arc mounts did not spend ammunition. Reset restored tick 0, Exterior and zero water. The [mixed live shot record under Yamato](../../../yamato/reports/fidelity-01/runtime/review.json) identifies Baltimore as victim: bow/stern/bridge AP enters/exits caused damage while dry, air missed, and the valid descending waterline entry damaged machinery and admitted water.

The [shared report](../../../fleet-fidelity/README.md) explains deliberately seeded shots versus UI firing, canvas-only captures, and the non-benchmark frame-rate observations. Full repository verification passed 247 tests / 30,803 assertions and production build, including Bismarck regressions and all preset checks.

## Historical limits

Navy 80-G-109723, dated 30 December 1943, supplies side/top registration at 6.260432 px/m. Its camouflage is not applied to the October model. Scan stretch, inferred vertical origin and loading differences give roughly ±1–2 m registration uncertainty. OP 1112 supports main-turret section dimensions, not every roof/width detail. The later 1944 photograph is housing evidence only, not permission to import a later AA refit. Restricted bridge-plan previews remain local.

CA-68 as-built offsets, missing BGP sheets, Mk 32 shield geometry, AA placements, detailed paint, exact belt taper, local protection and room boundaries remain open. The 152.4 mm belt / 63.5 mm deck families are provisional; Ships' Data 1945 is not an armor schedule. See [sources](../../references/sources.json), [specification](../../modeling-spec.json) and [discrepancies](../discrepancies.md). Numerical/export passes do not certify those historical details.
