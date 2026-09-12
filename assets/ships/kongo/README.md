# IJN Kongō — 1944

## Approved brief

The user approved this brief on 2026-09-08: Kongō herself in the 1944 fit represented by [GameModels3D's War Thunder model](https://gamemodels3d.com/games/warthunder/vehicles/jp-battlecruiser-kongo), vehicle `jp-battlecruiser-kongo`, default textured appearance. This is the sole external visual reference. Geometry and textures are authored independently.

Match the shown dark gray finish, wooden decks, red underwater hull and restrained weathering. The source flag is unreadable; the user accepted the game's existing Japanese naval ensign. Acceptance targets fidelity to the approved model, not independently established historical accuracy. No sister-ship substitution or additional reference set is approved.

The source configuration lists four twin 356 mm mounts, eight single 152 mm casemates, six twin 127 mm mounts, and 18 triple, eight twin and 30 single 25 mm AA mounts.

## Authoring status and limits

Original reconstruction in progress; not visually accepted or game-ready. The blueprint contains all 74 fitted mounts. Registered original variants provide the 356 mm twins, 152 mm casemates, Type 89 twins and Type 96 AA. Four 25 mm mounts ride on the second and third main turrets with independent train, elevation and recoil. Original boats, ground tackle, catapult and a static twin-float aircraft are included; the aircraft is ship equipment, not a flyable catalog entry.

The forward hull uses independently authored sections for the narrow waterline entry, rounded lower stem, deck crown and connected raised tip. Foredeck fittings follow the crown; the first magazine space has a tapered forward flood cell, and the forward void fits the narrower shell. The aft weather-deck breadth now follows the approved upper-shell run, carrying its railings outboard of the single AA foundations. Aft sheer/camber, gun shields and hull-side trim, openings and surface finish still require reconstruction.

Rendering and CPU contact geometry share original recipes for the pagoda's solid rooms, roofs and framing, pierced director supports, forward and side AA galleries, casemate belt, turret roof platforms, deck rails, aviation fittings and capstans. Open galleries, support holes, gun ports and rail bays remain open. Main gunhouse facets and declared aperture loops also supply physical armor. Flexible casemate covers follow elevation while recoil slides within their collars.

Versioned per-mount `travelClearance` surfaces constrain the main and casemate barrel envelopes against authored hull, structures and the covered fittings. Carried AA barrels use surfaces in their parent turret's frame. Rust/WASM combat and development-port articulation share this resolver; the TypeScript reference and displayed interpolation retain the same contract. A mount cannot simultaneously use this encoding and the fleet's `mountClearance` encoding. Catalog travel is unchanged: full-recoil envelopes and 1 mm separation provide original functional collision stops, not sourced mechanical limits.

Coverage is limited to the declared barrel envelopes and surfaces. Whole gunhouses, rangefinders, other moving mechanisms, independently posed neighbors and remaining decorative fittings still require safe-travel review. Whole-mount sampling still exposes clashes between the aft Type 89 mounts and boats, main turrets and adjacent independently moving AA, bridge-side single AA and glazing, funnel-gallery guns and shields, and casemate mechanisms and the central deck. Unrestricted catalog poses expose additional clashes. The source model itself also clips at some provisional combined game angles; that does not establish that those angles are mechanically permitted. The fourth turret's wireless mast terminates on its yaw axis at the fixed antenna endpoint; the intended tip contact is excluded from clipping failures.

Source-matched priority proportions, including the bridge, gunhouse upper contours, hull and bow, still require acceptance. Fine fittings, rear framing, rigging/sensors, exposed mechanisms, complete physical attachments, surface finish and full in-game acceptance remain unfinished. Completed export checks and sampled barrel sweeps do not certify any outstanding model acceptance gate.

Interior rooms, four-shaft machinery routing, magazines, armor thicknesses, structural plating, directors, damage control, reserve flood spaces and loading use provisional game conventions. Room widths and reserve spaces fit the authored hull; buoyancy calibration does not establish a historical loading condition. Hollow barbette supports and closed main-gun recoil pans are original internal construction rather than measurements of the reference interior. Director-foot seats and several small support outlines remain provisional.

Shared maintained finishes retain the original recipe's interpreted colors. Aviation linoleum has a separate material from the identically colored underwater coating. Original wood surfaces use longitudinal planking at a provisional 3 m × 0.15 m scale with 3 mm seams; these are texture conventions, not measurements of the approved model. Surface finish remains subject to visual acceptance.

## Updating original inputs

Run the applicable synchronization before `bun run ship:compile kongo` and a clean `bun run ship:build kongo`. Python scripts below are under `assets/ships/kongo/authoring/` unless another path is shown. Blender scripts run with `--background --factory-startup --python-exit-code 1 --python <path>`.

| Changed input | Required synchronization |
| --- | --- |
| Foundations, superstructure, aft tower or forward high AA gallery | `python3 .../sync_superstructure.py` |
| Fixed AA galleries | Blender `.../sync_galleries.py`, then `bun .../sync_gun_clearance.ts` |
| Deck rails, aviation fittings, capstans, weather-deck crown, hull sections or casemate openings | Blender `.../sync_fixed_fittings.py`, then `bun .../sync_gun_clearance.ts` |
| Main-turret roof platforms | `python3 .../sync_turret_roof.py` |
| Casemate belt | Blender `.../sync_casemate_belt.py` |
| Hull protection | `python3 .../sync_hull_armor.py` |
| Hull or internal rooms | `bun assets/ships/author-stability.ts kongo`; after hull changes also `bun .../sync_loading.ts` |
| Hull, structures or 356/152 mm barrel recipes | `bun .../sync_gun_clearance.ts` |
| Main gunhouse facets | Blender `assets/parts/ijn-356/sync_shape.py` |

The fitting synchronizers execute the original primitive recipes without reading a generated scene or reference geometry. Clearance pruning uses conservative reach, height and traverse bounds. Preserve recipe dependencies in `recipe-inputs.json`, stable assembly IDs and the published joint hierarchy. Review the exact rebuilt model using the shared pipeline; temporary captures and measurements belong in ignored `.build/`.
