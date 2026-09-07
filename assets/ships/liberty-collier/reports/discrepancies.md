# Discrepancy register — EC2-S-AW1

- Evidenced — ABS documents aft machinery, raised boilers, a long poop, five holds and ten hinged steel lids. The dated Delta launch photograph and Jagger Seam underway show the detached bridge and lifting-post arrangement.
- Open — A complete original collier builder GA or body plan has not been located. The reproduced Krueger-Kopiske profile is a postwar interpretation. It supports arrangement comparison, not builder-certified offsets or a wartime paint/gun inventory.
- Open — Deckhouse dimensions, hatch spacing, lifting gear and boat types are reconstructed. Hatch covers do not currently animate. No cosmetic coal pile is used to distinguish the ship.
- Open — Published length and draft bases conflict. The model declares 135.2296 m (443 ft 8 in), 17.32915 m molded beam and 8.7196 m reference draft; 14,967,000 kg and 1.45 m initial GM are estimated, not a certified Jagger Seam load condition.
- Open — Aft 5-inch, forward 3-inch and six Oerlikons are a representative armed fit; exact 1945 battery is unresolved. Postwar Mystic funnel logo is omitted.
- Open — Room envelopes, flood-cell permeability, bulkheads, pumps, machinery bounds, immersion limits, CG, GM, load state and uniform buoyancy calibration are gameplay estimates, not certified watertight or stability plans. See `stability.json`.
- Open — Ordinary shell/deckhouse steel is estimated, not an armored citadel. Gun protection uses the common nominal mounting proxy.
- Open — Gun ballistics, ammunition, AP/HE, reload, traverse/elevation and damage are provisional game calibration.
- Reviewed — Functional guns retain independent yaw, elevation, recoil and muzzle sockets. Hull sections and CPU hit/flood geometry share the versioned blueprint. Screw and rudder retain separate pivot empties.
- Scope — Cargo handling, sonar, depth-charge attacks and minesweeping are not implemented. Small fittings are visual-only; surface combat uses the shared renderer-free simulation.

## Attachment repair, 2026-09-06 Pacific

Shared open-gun supports; winches seated on the actual local hull/deck surface; raked-mast yards; screw blade roots, deck rails and funnel recess closure.

The retained Jagger Seam contract plan remains the layout basis, with the original discrepancies about draft, later service changes and the representative armed fit. The repairs do not assert a measured 1945 gun inventory or detailed cargo-gear fabrication.

Stable assembly, joint and socket IDs are retained. Original recipes own these changes; the preserved baselines are untouched. Exact-hash mesh reports, review views and game articulation evidence are collected in [the fleet attachment record](../../attachment-audit/README.md). Physical attachment and successful export checks do not close the historical discrepancies above.

Outboard gun-platform columns now rake inward to the actual weather-deck edge; their heels no longer hang beside the narrowing hull. Column and brace dimensions remain reconstructed.

## Local damage and fire calibration — 2026-09-06

Local regions, generator and director proxies, combustible loads and smoke outlets are independently authored gameplay estimates from the existing layout. They are not historically measured structural subdivisions, generator schedules or ventilation plans. Electrical supply is aggregated with manual gun fallback; directors share a targeting penalty. Breach overlap uses bounded aperture sampling. See `assets/ships/author-local-damage.ts`.

## Ensign and radar animation

The version-1 blueprint rig selects a period national ensign and a retained or original flagstaff hoist. Flag dimensions and stern/bridge placement are gameplay approximations; harbor/underway flag etiquette and halyard handling are not modeled. See `assets/parts/ensigns-sources.md` for design references. Radar rates and director sector sweeps are visual calibration, not verified operating procedures or combat tracking. Existing aerial shapes retain their prior evidence limitations. Cloth uses gravity, apparent wind and constrained fabric; it does not simulate cloth tearing, rigging collisions or fluid dynamics.
