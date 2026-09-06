# Baltimore discrepancy register

## Damage-model integration, 2026-09-05 Pacific

The fidelity geometry and ten named room envelopes are retained while integrating master's damage model. Residual spaces and finite-angle buoyancy regions were regenerated around this hull and these rooms: 120 total spaces, 255 closed connections and 142 buoyancy regions. The two equal combined-drive groups retain the forward/after machinery equipment IDs. Room boundaries, machinery aggregation, permeability, capacities, reference loading and mass distribution remain estimated gameplay inputs, not an as-built damage-control or stability plan.

An independent containment audit exposed eight-decimal serialization drift at the terminal hull station: forty cell corners extended approximately five nanometres beyond it. The measurement now tolerates only endpoint rounding; a regression still rejects a ten-micrometre longitudinal overhang. No hull or room geometry was moved to conceal the discrepancy. Original runtime captures below retain their original hashes; current integration evidence is recorded in `docs/fleet-fidelity-integration.md`.

## Fidelity 01, 2026-09-05

Current build evidence is in `export.json`, `measurements.json` and `fidelity-01/README.md`; older numerical logs below retain their own build context.

- All 120 original hull stations and 13 cross-section anchors are retained, with monotone fairing between anchors. Cruiser sheer, broad transom and retained bridge trace polygons remain vessel-specific. The missing CA-68 as-built offsets are not replaced with a claim of precision.
- Original closed 8-inch and twin 5-inch gunhouse facets replace simple enclosures, preserving all nine mounts and 21 muzzle chains. OP 1112 supports the main section's trunnion and fore/aft dimensions; width, roof-plan details, Mark 32 shield dimensions and plate schedules remain qualified estimates. The later 1944 photo is used for housing details, not backdated AA changes.
- Raked funnel jackets, pierced bridge/AA supports, access stairs and ladders, doors, louvers, curved boats, chain gear, reels, catapult rollers and crane winches/hooks improve readable detail. Fitting placement and exact October 1943 inventory still require reconciliation.
- Estimated 16 mm hull / 6 mm structure steel now participates in CPU hits, aiming and armor inspection, including the entire transom and unarmored ends. Physical 152.4 mm belt, 63.5 mm protective deck, barbette sectors and moving gunhouse facets replace broad protection boxes. Those are provisional thickness families: Ships' Data 1945 does not document that armor schedule. Exact tapered belt, conning and local end thicknesses remain unresolved.
- Forward/after machinery units are separated from boiler-unit envelopes, with new end flooding spaces. IDs and magazine bindings are preserved. These are coarse internal arrangements and gameplay capacities, not a complete damage-control plan.
- Twelve identical-camera before/after views, uniform-scale Navy profile/top overlays and dated primary photos are retained. Scan stretch and the later camouflage sheet's vertical/load datum are explicitly qualified. Restricted bridge-plan previews remain local.

The broad transom was found to be missing from CPU hull caps; the shared cap correction has its own swept-hit regression. Thin bridge hits, AP exits, waterline behavior, flooding and mixed-definition effects are also covered.

Configuration: USS Baltimore CA-68, October 1943 exterior, normalized to the documented 24 ft 2 in limiting keel-draft datum. Status: **not approved for historical accuracy**.

| ID | Status | Discrepancy and next evidence needed |
| --- | --- | --- |
| BAL-001 | Verified exported envelope | Decoded GLB vertices measure LOA 205.2574005 m, beam 21.5900011 m and keel draft 7.3660002 m. Independent 5 mm-tolerance checks pass; see dimensions.json. |
| BAL-002 | Verified length; endpoints open | Hull-triangle intersection with runtime Y=0 measures 202.3871994 m. Corrected the previous 0.358629 m shortfall. Transom and bow endpoint stations are still an interpretation; a matched length does not certify the waterline shape. |
| BAL-003 | Class drawing obtained; Baltimore confirmation open | Keel draft is 7.366 m, tabulated navigation draft 8.1788 m. The new rudder follows Quincy’s documented 20 7/8 in projection below keel and balanced silhouette. That sister-ship projection is not equated with Baltimore’s differently tabulated navigational draft/loading condition. |
| BAL-004 | Class sections incorporated; offsets open | 120 retained sections use original fairing informed by Quincy docking sections and Canberra hull outlines. Corrected the forward keel, rounded bilge and afterbody. Half-breadths, interpolated frames, camber, individual waterline endpoints and asymmetry remain unresolved. These are not Baltimore as-built offsets. |
| BAL-005 | Partly measured | Main turret longitudinal axes measured from the dated camouflage drawing with approximately ±0.65 m scan/interpretation uncertainty. Obtain dimensioned frame/station placements. |
| BAL-006 | Partly documented | Main turret section dimensions/trunnion heights from OP1112 p.517. Gunhouse width, top footprint, armor variation, rangefinder details and exact barrel contour await companion sheets and GA. The shared barrel recipe remains an approximation. |
| BAL-007 | Open | Secondary Mk 32 mount exterior dimensions and placements need primary Mk 32 drawings. Related Mk 29 drawing is explicitly not treated as a variant match. |
| BAL-008 | Bridge outlines incorporated; configuration details open | Baltimore BGP sheet 5 of 6 is available at 20,003 × 10,081 px. Traced forward bridge decks and enclosures, corrected flag/navigation bridge order, used the printed open-bridge datum, and replaced faceted director supports with round footprints. Raw points and assumptions are in references/bridge-study.json. One-sided traces are reflected; wall changes beneath later annotations, deck camber, remaining heights and detailed 1943 fittings need reconciliation. Five other BGP sheets are missing. |
| BAL-009 | Open | 12 quadruple 40 mm and 24 single 20 mm visual fittings have provisional stations/tubs. Reconcile all positions against the October 1943 fit. Avoid importing 1944 overhaul changes. |
| BAL-010 | Open | Twin cranes/catapults are supported in early fit; their lattice dimensions, launch carriages, rails and hangar opening need equipment/GA drawings. OS2U shapes are indicative original assets. |
| BAL-011 | Director order corrected; detail open | The original BGP, Navy camouflage projection and commissioning photograph agree that 8-inch directors occupy lower outward stations and 5-inch directors occupy higher inward stations. Corrected the reversed arrangement. Antenna variants, platform geometry, mast rake and rigging remain under review. |
| BAL-012 | Open | Measure 21 appearance is represented with original plain materials; exact paint reflectance, weathering, markings, deck finish and boot topping have not been certified. |
| BAL-013 | Deliberately provisional | Internal boxes, armor interactions, hydrostatics, damage, flooding and performance are gameplay approximations. No historical internal arrangement or full ballistic certification is claimed. |
| BAL-014 | Current functional review passed; historical certification open | Current 0079ff92853a export: five fixed and twelve matched views inspected; 247 repository tests, production build and independence build pass. Twelve WebGPU pose combinations stay within 0.001318 m. Both UI batteries fired, armor hover/internal selection and mixed-fleet inspection worked, and return to port reset tick/water. Seeded bow/stern/bridge hits, misses and a valid flooding waterline entry are recorded against Baltimore's definition in the Yamato mixed-fleet series. See fidelity-01/README.md; earlier hashes retain their separate context. |
| BAL-015 | Pending optional reference | No GameModels3D reference was accessed. Any future comparison must keep that geometry and textures out of our authored model. |

The first pipeline export briefly used the restored starter recipe during another operation's stash/merge integration. Hash `f4ada9e1d1f80d078919bd50c6f3668eb25a9f9d561c223a448693791f700a8a` is **not** evidence for the authored Baltimore exterior. The original recipe was recovered from this task's own tool history; subsequent builds must supersede that export.

Current dimensional study: `references/class-hull-study.json`. The high-resolution Canberra sheet visibly contains missile-conversion and helicopter-platform changes, and the Baltimore bridge sheet has later 3-inch/50 and radar annotations. Their archive entry dates are not blanket configuration certification.


## 2026-09-05 — provisional flooding and machinery extension

The versioned blueprint now records machinery dependencies, immersion thresholds, hull-side flood regions and additional outer spaces authored by `assets/ships/author-flood-spaces.ts`. New room boxes fit the reconstructed hull and exclude retained room envelopes; these tests do not establish historical subdivision. The strips, 72% floodable volume, pump rates, closed partition locations and nominal 5 mm unmeasured partitions are gameplay estimates. Existing physical protection is reused where it crosses a boundary; no initial open connection is asserted. Side coverage currently spans roughly -6 to +3 m, leaving end, upper-deck and deeper-bottom mapping incomplete. Exact steam routing, machinery vulnerability, free-surface stability and full damaged-hull flotation remain unresolved. See the damage-realism implementation record for validation and review status.

### Step 2 review corrections — 2026-09-05

Two retained combined-drive envelopes represent the cruiser machinery plant with equal provisional power shares; individual boilers and shafts remain aggregated. Original equipment and room IDs are retained, including Enterprise’s legacy engine-port ID for forward boilers.

70 rooms, 118 exterior mapping regions, 164 closed boundaries (0 linked to existing plates; 159 estimated 5 mm partitions). Wing spaces now extend to neighboring retained room envelopes; the prior 2 m strip cap disconnected Yamato’s interior. Small centreline end pockets are conservative hull-inscribed flood volumes, not historical end-compartment plans. Their mapping regions approximate the surrounding end shell; full end volume, upper-deck and deep-bottom coverage remain required before replacing the sinking fallback.

## 2026-09-05 — stability and residual flood coverage (supersedes the gameplay gaps above)

The original `assets/ships/author-stability.ts` recipe preserves prior IDs and adds conservative compound flood cells excluding retained rooms. Adaptive cells approximate the remaining hull volume; cells grouped into a named space share a waterplane. Estimated 85% permeability and access partitions do not constitute historical subdivision. A CPU hull-shell query covers missing deck/bottom/end plating with provisional 12 mm steel and defers to nearby explicit exterior protection. The port overlay still displays explicit plates; fallback contacts are inspectable in the impact ledger.

`stability.json` records modeled reference/full displacement, the stated mass mismatch, the uniform buoyancy scale, estimated CG and initial GM target (7% beam). Numerical station integration, sixteen-column water surfaces in box rooms, up to sixteen columns per compound cell, 2 Hz force updates and heuristic angular inertia/damping bound runtime cost. Capsize requires sustained inversion beyond 100 degrees with an outward/neutral arm. These are reproducible game approximations, not recovered loading or stability curves. No trapped air, detailed downflooding openings, free-surface waves, dynamic ocean forces, underwater shock or hull fracture is modeled. Finite local fire fuel, abstract crew rates and magazine flash protection are likewise provisional.
