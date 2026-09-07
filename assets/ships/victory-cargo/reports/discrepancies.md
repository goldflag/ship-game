# Discrepancy register — VC2-S-AP2

- Evidenced — HAER CA-345 sheets 2, 3 and 6 establish a separate 455 ft 3 in × 62 ft Victory hull, raised forecastle, paired kingposts, deck arrangement and turbine machinery. This is not a Liberty cargo variant.
- Open — HAER is a documented 2010 reconstruction from historical material, not a complete original 1945 builder package. Our finite station loft interprets its body plan; no complete digitized table of offsets is claimed.
- Open — Deckhouse refinements, exact funnel rake, cargo-gear dimensions, boom working positions, lifeboats, rigging and fittings remain simplified. Visible structural arrangements are plan-led, not a certified named-ship replica.
- Open — 6,000 shp / 15 kn denotes AP2; 17 kn AP3 data is deliberately not mixed into this fit. 15,500,000 kg, 8.6868 m draft and 1.20 m initial GM are provisional operating/stability assumptions.
- Open — Guns depict a representative historical armed arrangement, not the laid-up 2010 ship; gray paint is not a traced camouflage plan.
- Open — Room envelopes, flood-cell permeability, bulkheads, pumps, machinery bounds, immersion limits, CG, GM, load state and uniform buoyancy calibration are gameplay estimates, not certified watertight or stability plans. See `stability.json`.
- Open — Ordinary shell/deckhouse steel is estimated, not an armored citadel. Gun protection uses the common nominal mounting proxy.
- Open — Gun ballistics, ammunition, AP/HE, reload, traverse/elevation and damage are provisional game calibration.
- Reviewed — Functional guns retain independent yaw, elevation, recoil and muzzle sockets. Hull sections and CPU hit/flood geometry share the versioned blueprint. Screw and rudder retain separate pivot empties.
- Scope — Cargo handling, sonar, depth-charge attacks and minesweeping are not implemented. Small fittings are visual-only; surface combat uses the shared renderer-free simulation.

## Attachment repair, 2026-09-06 Pacific

Shared open-gun carriages and shoulder controls; locally seated winch beds; correctly attached yards; screw blade roots, deck rail seating and funnel recess closure.

HAER CA-345 remains qualified reconstruction evidence for the VC2-S-AP2 arrangement. OP 909 informs the Oerlikon mechanism; a generic armed Victory fit and exact support dimensions remain interpretations, not a surveyed wartime named-ship fit.

Stable assembly, joint and socket IDs are retained. Original recipes own these changes; the preserved baselines are untouched. Exact-hash mesh reports, review views and game articulation evidence are collected in [the fleet attachment record](../../attachment-audit/README.md). Physical attachment and successful export checks do not close the historical discrepancies above.

Outboard gun-platform columns now rake inward to the actual weather-deck edge; their heels no longer hang beside the narrowing hull. Column and brace dimensions remain reconstructed.

The two after bridge gun sponsons also have transverse beams and diagonal knees into the upper accommodation wall. The sponson surfaces alone were not a structural connection. Exact scantlings remain interpreted.

## Local damage and fire calibration — 2026-09-06

Local regions, generator and director proxies, combustible loads and smoke outlets are independently authored gameplay estimates from the existing layout. They are not historically measured structural subdivisions, generator schedules or ventilation plans. Electrical supply is aggregated with manual gun fallback; directors share a targeting penalty. Breach overlap uses bounded aperture sampling. See `assets/ships/author-local-damage.ts`.
