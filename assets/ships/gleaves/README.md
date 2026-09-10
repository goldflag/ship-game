# Hsienyang — Gleaves-class destroyer

## Approved brief

Approved by the user on 2026-09-08: reproduce **Hsienyang (ex-USS Rodman), Hull A** from [GameModels3D, vehicle pzsd108](https://gamemodels3d.com/games/worldofwarships/vehicles/pzsd108), using **GameModels3D-only** external visual references.

- **Configuration:** stock Hsienyang (A), `PZUH702_D8_HULL_A`; four single 127 mm/38 Mk.12 guns on Mk.30 mod.0 mounts, two quintuple 533 mm Mk14 torpedo banks, six single Mk4 and two twin Mk24 20 mm Oerlikons, and the source's fitted directors, radar and depth-charge equipment.
- **Appearance:** the shown default weathered blue-grey vertical surfaces, dark reddish-brown decks, dark funnel caps and rust-red bottom. No added hull numbers, camouflage or cloth flags absent from the approved source.
- **Date limitation:** Hsienyang is the ship's post-transfer identity; the source's underlying asset name includes “1945.” The exact historical refit date is unverified and that limitation is accepted. This preset targets fidelity to the approved source model, not independently certified historical accuracy.
- **Authoring:** geometry and textures are independently authored. Source meshes/textures are inspection-only and never enter the recipe or runtime asset. Gameplay and internal arrangements use provisional game conventions where the visual reference supplies no evidence.
- **Sensors:** the approved A-model's SC2 and SG search radars use separate rotating joints on modeled mast platforms. Their 6/15 RPM visual animation follows existing game conventions; these are not verified historical operating rates.
- **Technical-reference exception (2026-09-09):** the user approved consulting technical references for gun travel stops after the upper forward gun collided with the lower gunhouse at −15° depression. This exception does not broaden the visual reference policy. [NAVPERS 10111, Mk30 manual](https://www.eugeneleeslover.com/US-NAVY-GUNS/Navpers_10111.php) and the [1943 Navy gun-crew instructions](https://www.maritime.org/doc/destroyer/fiveinch/index.php) are the starting references; installed Hsienyang travel limits remain unverified. A firing cutout alone is not a mechanical clearance solution.

## Installed configuration and limitations

The original exterior and gameplay fit are implemented. Installed gameplay stops are `gun-1` traverse ±130° and depression −12°, `gun-2` depression −3°, `gun-4` traverse ±150°, and twin Oerlikons −9°/+78°. These clearance-derived approximations are applied in the shared blueprint contract; they are not verified Hsienyang stop-cam profiles. Catalog family capabilities remain separate so installed limits do not split weapon selection groups.

The Oerlikons use measured aft-offset trunnions, raked forks, variant-specific controls and stationary external barrels. Their independently modeled fabric catchers have fixed carriage and moving cradle attachments, with elevation-driven morphs that fold around the mechanism. The 30° silhouette follows the inspected source; cloth deformation between poses is a visual approximation. See the [original component limitations and Navy references](../../parts/us-oerlikon/README.md).

The aft casing and shared AA deck follow measured sections of the approved model: a 4.748 m wide casing beneath the flared deck, deck top at 4.579 m, and twin-AA mounting datums at 4.554 m. The independent blueprint footprint uses chamfered aft sides and curved AA overhangs, with modeled knees, columns and raised lookout platforms.

The aft life floats follow the approved model's 3.108 × 1.719 × 0.342 m outline, stacked with a 9.28° outboard tilt. Their original lattice, paddles and lashed supplies sit on an outer X-frame with bearers attached beneath the deck edge. Bridge and boat-side installations reuse that original float with the source’s inclined datums and modeled cradles. The forecastle roof is at 7.37 m; the lower bridge has the source’s flat front and rounded aft corners.

The pilothouse now uses measured rounded ends, with narrower bridge wings and open rails aft. The original Mk37 mod.2 reconstruction includes the wider pedestal, two front slopes, open roof hatches, rangefinder covers and optical sight; its principal dimensions were compared with the source at a common orthographic scale. The lower bridge, aft walkway, beam supports, light shelves, navigation fittings, flying-deck platforms, lookout seats and separate access ladders have been revised against the source. Halyards terminate on modeled racks and the forward shrouds on deck outriggers.

The machinery trunk aft of the second funnel now has a separate blueprint footprint: 3.18 m wide along its sides, a 4.794 m roof, and an aft wall tapering from the lower 13.329 m station to 13.0275 m at the roof. These inspected source dimensions replace the oversized rectangular extension beside the deck-level AA. Funnel and torpedo foundations bridge to their existing datums; the stair, doors, portlights, ventilation and fire fittings remain physically attached to the revised casing. CPU obstruction bounds include the tapered wall's lower footprint. The stair's short grab rails terminate below the upper landing, following the source and clearing the aft torpedo bank.

Build: `bun run ship:build gleaves`
Review: `bun run ship:review gleaves`

Follow [the pipeline](../../../docs/ship-pipeline.md) and [model review](../../../docs/ship-model-review.md). Temporary references and diagnostics stay in ignored `.build/`.
