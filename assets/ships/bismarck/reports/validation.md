# Bismarck exterior and collision validation · 5 September 2026

The latest merged export is tracked in the [fleet integration report](../../../../docs/fleet-fidelity-integration.md). The milestone hashes and live captures below are retained history, not re-labeled evidence for that new export.

## Fleet branch rebuild before master integration (retained evidence)

Pre-integration content hash: `ef5c6fefab2763a1ee2669c7a46c8afcc9f3df4bf625d8dcb47bc68b5f086068`. The [fleet fidelity pass](../../fleet-fidelity/README.md) changed shared build inputs, so Bismarck was recompiled/rebuilt and its fixed views, comparison pack and thumbnail refreshed. Bismarck's blueprint, original exterior recipe and preserved baseline were not edited on that branch. That export has 364,170 triangles, 96 mesh nodes, 284 primitives and 21,566,248 GLB bytes, with ten mounts / twenty barrel chains. The later fourth-iteration master changes below are preserved during integration; this earlier hash is not silently relabeled as their runtime evidence.

The shared CPU hull-surface cap/diagonal corrections preserve Bismarck's structural regressions. The full suite passed **247 tests, 0 failures, 30,803 assertions across 36 files**, followed by all-preset checks, TypeScript and Vite production build. Five current [fixed views](fidelity-01/fixed-views.png) were inspected. A fresh exact-hash WebGPU sweep exercised twelve train/elevation/recoil combinations, maximum muzzle error **0.002166616 m**; [runtime record](fidelity-01/runtime/review.json) and [positive-limit canvas](fidelity-01/runtime/articulation-positive-canvas.png). This pass did not repeat Bismarck's full historical battle trial; that earlier evidence remains separately identified below. Its historical approximations are unchanged.

## Fourth iteration from master (retained evidence)
The fourth iteration revises all six secondary gunhouses and the bridge, and fits the six transverse armor bulkheads inside the actual hull at both plate faces. Durable changes live in the component catalog, blueprint and recipe; the original baseline remains preserved. The reviewed fit is **24 May 1941**, at a separately stated **9.33 m standard draft**. Shape and fitting estimates remain recorded in the [discrepancy register](discrepancies.md).

Fourth-iteration content hash: `957a349026ab6dfccb0b6caa5469c6899066fe034d3e9563940ad0b8e336037b`.

| Verification | Fourth iteration evidence |
| --- | --- |
| Playable asset | Local Blender 5.2 build, export and review passed: 368,428 triangles, 98 mesh nodes, 286 primitives, 21,897,784 bytes. Ten mount chains and twenty independent barrels retain their stable axes and IDs. [Export](export.json). Blender MCP was unavailable. |
| Geometry | All six principal dimensions pass; 16,248 hull triangles, zero degenerates/nonmanifold welded edges, 39 contained compartment envelopes. The new gunhouses compile to moving armor; total armor facets 509, major structures 24. [Measurements](measurements.json). |
| Transverse armor | Regression reproduced 40 solid vertices outside the old hull boundary. Fitted polygons now pass vertex and edge containment checks and remain hittable. Independent edge traces against the triangulated hull confirm at least 24.8 mm clearance. [Geometry](visual-iteration-04/geometry-review.json), [clearances](visual-iteration-04/armor-edge-clearances.txt). |
| Tests and production | 184 tests passed, 0 failures, 26,744 assertions across 29 files. Final exported-hierarchy checks passed again after the last fitting refinement. `bun run build` passed all four preset checks, TypeScript and Vite. [Test log](visual-iteration-04/tests.txt), [build log](visual-iteration-04/production-build.txt). |
| Visual and articulation | Inspected all five fixed review views and final WebGPU bridge, secondary and armor close views. Both traverse extremes, elevation limits and recoil passed; maximum muzzle discrepancy 0.002166 m. [Before/after and articulation](visual-iteration-04/README.md). |
| Combat and reset | Live-game fixed-tick replay with bot AI reached tick 4,200: 8 player main shells and 28 secondary shells, enemy damage and hits against the fitted transverse armor. Maximum muzzle discrepancy 0.002168 m. Normal return to port reset tick, damage, water, ammunition and events. [Replay and reset evidence](visual-iteration-04/README.md#validation). |

All comparison views and the [portable review ZIP](../generated/comparison/bismarck-review.zip) were regenerated. Only Bismarck uses the changed secondary component; the shared compiler and Blender helpers are unchanged. Export checks establish pipeline consistency, not historical accuracy.

## Third iteration and master integration (retained history)

The following records describe the previous model. Their hashes, counts and browser captures are retained for comparison. Current merged hashes and validation are recorded in the fleet integration report.

The third independent iteration corrects the bow profile and main gunhouses on top of the detailed second iteration. It also makes the complete hull and 22 major superstructure surfaces hittable, aimable and inspectable. The reviewed fit remains **24 May 1941**, at the separately stated **9.33 m standard draft**.

Content hash: `45b7cc0110d0262b177a0e3aeb4df43d0682de8b52f1cc4f18cd5ab0fcddc9a5`.

| Verification | Current evidence |
| --- | --- |
| Build and independence | `ship:independence bismarck` passed the complete asset build and comparison pipeline with the raw game cache unavailable, then restored it. Local Blender 5.2 performed authoring, export and rendering; Blender MCP was unavailable. [Independence](independence.json), [authoring read audit](authoring-reads.json). |
| Playable export | **364,170 triangles**, 96 mesh nodes, 284 material primitives, **21,566,248 bytes (20.57 MiB)**. Within the existing 500k triangle / 30 MiB guardrails. Ten main/secondary mounts and twenty independent barrel chains retain their joint/socket IDs. [Export checks](export.json). |
| Dimensions and geometry | All six principal dimension targets pass actual GLB measurements: 250.50 m overall, 241.55 m waterline length, 36 m maximum/waterline beam, 9.33 m draft and 15 m midship depth. The hull has 198 authored stations, 16,248 triangles, zero degenerates and zero nonmanifold welded edges. All 39 compartment envelopes are contained. [Measurements](measurements.json). |
| Simulation before master integration | `bun test`: **98 passed, 0 failed**, 4,041 assertions across 18 files. Eleven structural regression tests cover fixed-tick shots through bow, stern and bridge, posed sweeps, AP exits, air misses, breaches, waterline crossing, aiming, inspection and main turret facets. `bun run build` passed all four preset/evidence checks, TypeScript and Vite. |
| Shared changes | All four presets were rebuilt because the common compiler and component recipe changed. The other three presets retain their prior geometry and legacy collision behavior; their hashes/build outputs were refreshed. The original Bismarck baseline is preserved. |
| Fixed visual review | Inspected five regenerated review views and matched comparison views, including the final faired bow and both forward gunhouses. Before/after crops preserve camera and scale. [Third iteration](visual-iteration-03/README.md), [second iteration](visual-iteration-02/README.md), [current comparisons](../generated/comparison/index.html). |
| In-game model and articulation | Actual final GLB inspected in WebGPU, including hull and bridge plating selections. Both traverse extremes, maximum/minimum elevation and recoil were exercised; maximum observed muzzle discrepancy was **0.002166 m**. Launched through tick 108 and returned to port at tick 0. [Exterior](browser/exterior.png), [hull](browser/hull-plating.png), [bridge](browser/bridge-plating.png), [positive pose](browser/articulation-positive.png), [negative pose](browser/articulation-negative.png), [underway](browser/underway.png), [diagnostics](browser/checks.json). |

The [standalone review ZIP](../generated/comparison/bismarck-review.zip) contains reference/own/historical comparisons, overlays, sections, measurements, source register, specification, original authoring snapshot and playable GLB. Extract it and open `index.html`; the port's Reference review opens `/ship-reference/bismarck/`.

The curved upper bow stem and lower forefoot replace the former straight wedge. Main gunhouses now use original closed triangular facets shared by visible geometry and moving armor: a longer aft overhang, narrower lower walls, sloped shoulders and a planar roof. Turret axes and muzzle offsets remain stable. See the [discrepancy register](discrepancies.md) for uncertainties in body offsets, load datum, gallery contours and fitting placement. Successful exports and triangle counts do not establish historical accuracy.

Structural collision is separate from the researched armor schedule. **20 mm hull and 8 mm superstructure plating are explicit gameplay estimates**, not verified historical thicknesses. AP can damage and pass through thin structures; only hull penetrations create sea breaches. Nearby exterior armor replaces nominal hull plating at the same location. The 365 compiled armor plates, six legacy secondary gunhouse entries and 23 structural entries produce 394 inspection entries. Small fittings and light AA remain primarily visual; the ten existing main/secondary mounts are the simulated weapons.

Current browser images are direct captures of the game's WebGPU canvas via Orca browser evaluation, excluding the separate HTML HUD. No image retouching or model substitution was used. They are qualitative camera views, not controlled performance measurements. The earlier iteration's captures and validation are preserved under `visual-iteration-02/`.

## Validation with current master

Integrated master `d58af64` while preserving mixed fleet battles, audio/effects, current port lighting/loading and opaque armor colors/hover. The hull inspection skin now exposes the exterior belt where it replaces ordinary plating, using the same documented 1.5 m allowance as combat. Regression tests preserve belt picking and bow coverage, verify mixed-vessel swept hits and waterline crossing, and check structural impact evidence and nearest fleet sight targets.

**146 tests passed, 0 failed, 9,303 assertions across 24 files.** `bun run build` passed every preset/evidence check, TypeScript and Vite. The existing large bundle advisory remains. `ship:compare bismarck` regenerated the complete review; its portable ZIP is **104,041,996 bytes (99.22 MiB)**. All page views/downloads, GLB and original authoring inputs remain included. The generated Blender scene and unlinked authored overview remain in assets instead of being duplicated in the ZIP.

The merged WebGPU game was inspected in [Armor view](browser/integration/armor.png), at [positive](browser/integration/positive.png) and [negative](browser/integration/negative.png) articulation limits, and [underway](browser/integration/underway.png) against a Baltimore bot. The mixed battle reached tick 1,957; maximum observed muzzle error was **0.002168 m**. Return to port reset the simulation to tick 0. [Integration checks and diagnostics](browser/integration/checks.json).
