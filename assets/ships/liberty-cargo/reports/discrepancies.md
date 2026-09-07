# Discrepancy register — revision 2

- Resolved — This is the standard EC2-S-C1 design only; cosmetic deck cargo/troop shelters are no longer separate active ships.
- Measured, limited — USMC/Gibbs & Cox inboard profile controls proportions; Thomas Sully's midship section supplies molded beam, depth, flat floor and tight bilge. The faded/scanned drawings have skew and seams. End sections and small deck gear are independently interpolated.
- Open — 1941 original plan and 1943 as-built section do not certify every exterior detail or a dated defensive fit. Aft 5-inch, bow 3-inch and eight Oerlikons are representative armed-Liberty hardware.
- Open — Neutral gray, cargo-derrick working angles, rigging, lifeboat covers, ground tackle and rudder shape are simplified. No cargo manifest is claimed.
- Open — 14,478,000 kg, chosen draft and estimated 1.25 m initial GM are gameplay loading assumptions, not named-vessel stability data.
- Open — Room envelopes, flood-cell permeability, bulkheads, pumps, machinery bounds, immersion limits, CG, GM, load state and uniform buoyancy calibration are gameplay estimates, not certified watertight or stability plans. See `stability.json`.
- Open — Ordinary shell/deckhouse steel is estimated, not an armored citadel. Gun protection uses the common nominal mounting proxy.
- Open — Gun ballistics, ammunition, AP/HE, reload, traverse/elevation and damage are provisional game calibration.
- Reviewed — Functional guns retain independent yaw, elevation, recoil and muzzle sockets. Hull sections and CPU hit/flood geometry share the versioned blueprint. Screw and rudder retain separate pivot empties.
- Scope — Cargo handling, sonar, depth-charge attacks and minesweeping are not implemented. Small fittings are visual-only; surface combat uses the shared renderer-free simulation.

## Attachment repair, 2026-09-06 Pacific

Shared open-gun stands, carriages and shoulder controls; locally seated winch beds; yards aligned to raked masts; screw roots entering hubs; deck rail seating and funnel recess closure.

The retained USMC/Gibbs & Cox profile and Thomas Sully section remain the hull/layout evidence. Defensive armament is still representative, not a certified named-vessel/date inventory. OP 909 supports the Oerlikon mounting mechanism; exact pedestal/bracket fabrication and cargo gear dimensions remain interpreted.

Stable assembly, joint and socket IDs are retained. Original recipes own these changes; the preserved baselines are untouched. Exact-hash mesh reports, review views and game articulation evidence are collected in [the fleet attachment record](../../attachment-audit/README.md). Physical attachment and successful export checks do not close the historical discrepancies above.

Outboard gun-platform columns now rake inward to the actual weather-deck edge; their heels no longer hang beside the narrowing hull. Column and brace dimensions remain reconstructed.

## Local damage and fire calibration — 2026-09-06

Local regions, generator and director proxies, combustible loads and smoke outlets are independently authored gameplay estimates from the existing layout. They are not historically measured structural subdivisions, generator schedules or ventilation plans. Electrical supply is aggregated with manual gun fallback; directors share a targeting penalty. Breach overlap uses bounded aperture sampling. See `assets/ships/author-local-damage.ts`.
