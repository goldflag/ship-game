# Discrepancy register — revision 2

- Resolved — The unsourced extended-forecastle/museum-fit mixture is replaced by the dated Port Arthur Cobalt GA. Aft mast, short forecastle, compass bridge, funnel and gun-platform positions now follow that arrangement. Cover-photo 1944 equipment, Type 271 lantern and Hedgehog are excluded.
- Measured, limited — LOA, beam, deck/counter trace and principal landmarks are registered to the scan. Folds/skew limit reading to roughly 0.3 m for large landmarks. See plan comparison; export success does not verify those readings.
- Open — No body/offsets plan is included in the GA. Transverse shape, flare, underwater end-section fullness and bilge-keel projection are interpolated. Funnel rake, deck camber, detailed plating, stern aperture and small fittings remain simplified.
- Open — 4-inch mark, 2-pounder and twin Lewis are representative early-war hardware, not a certified 19-Nov-1941 Cobalt inventory. Lewis nominal 1 mm protection is the catalog's minimum ordinary-metal proxy, not armor. Four-inch shield is visibly open aft; gameplay uses the shared mount hit proxy.
- Open — Neutral gray paint is not a measured dated camouflage plan. No museum color scheme or postwar markings were copied.
- Open — The 3.5052 m waterline and 1,170,000 kg mass are a declared gameplay operating condition, not a verified Cobalt displacement/draft pair. Published light/standard/load values are not interchangeable.
- Open — Room envelopes, flood-cell permeability, bulkheads, pumps, machinery bounds, immersion limits, CG, GM, load state and uniform buoyancy calibration are gameplay estimates, not certified watertight or stability plans. See `stability.json`.
- Open — Ordinary shell/deckhouse steel is estimated, not an armored citadel. Gun protection uses the common nominal mounting proxy.
- Open — Gun ballistics, ammunition, AP/HE, reload, traverse/elevation and damage are provisional game calibration.
- Reviewed — Functional guns retain independent yaw, elevation, recoil and muzzle sockets. Hull sections and CPU hit/flood geometry share the versioned blueprint. Screw and rudder retain separate pivot empties.
- Scope — Cargo handling, sonar, depth-charge attacks and minesweeping are not implemented. Small fittings are visual-only; surface combat uses the shared renderer-free simulation.

## Attachment repair, 2026-09-06 Pacific

Shared gun carriages; boat-platform pillars/knees; Carley racks; wireless spreaders; depth charges seated on their sloping rails; screw roots, deck rails and funnel recess closure.

The retained Port Arthur Cobalt general arrangement dated 19 November 1941 shows the short forecastle, platform/boat arrangement and stern gear. Support dimensions remain interpreted from the scan. The representative 4-inch/2-pounder/Lewis inventory and gray paint remain open rather than being certified by attachment checks.

Stable assembly, joint and socket IDs are retained. Original recipes own these changes; the preserved baselines are untouched. Exact-hash mesh reports, review views and game articulation evidence are collected in [the fleet attachment record](../../attachment-audit/README.md). Physical attachment and successful export checks do not close the historical discrepancies above.

Final close-up review also found the depth-charge tracks intersecting the rising counter deck. The tracks now clear the original hull surface on short supports, with a lower aft discharge end; all ten drums sit on the tracks. Track fabrication and exact height remain reconstructed from the GA.

## Local damage and fire calibration — 2026-09-06

Local regions, generator and director proxies, combustible loads and smoke outlets are independently authored gameplay estimates from the existing layout. They are not historically measured structural subdivisions, generator schedules or ventilation plans. Electrical supply is aggregated with manual gun fallback; directors share a targeting penalty. Breach overlap uses bounded aperture sampling. See `assets/ships/author-local-damage.ts`.

## Ensign and radar animation

The version-1 blueprint rig selects a period national ensign and a retained or original flagstaff hoist. Flag dimensions and stern/bridge placement are gameplay approximations; harbor/underway flag etiquette and halyard handling are not modeled. See `assets/parts/ensigns-sources.md` for design references. Radar rates and director sector sweeps are visual calibration, not verified operating procedures or combat tracking. Existing aerial shapes retain their prior evidence limitations. Cloth uses gravity, apparent wind and constrained fabric; it does not simulate cloth tearing, rigging collisions or fluid dynamics.
