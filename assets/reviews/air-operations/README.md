# Enterprise air operations validation

Implemented Enterprise's versioned air group using the existing F4F-4, SBD-3 and TBD-1 models. See `docs/air-operations.md` for mechanics and limitations.

- `bun test --timeout 30000`: 438 passed, 0 failed. The larger timeout accommodates existing hydrostatic/geometry tests on this shared machine. Earlier simultaneous Blender/test runs encountered timeouts and temporary published-model mismatches; final runs use completed assets.
- After final runtime edits, focused aircraft, fleet-loading and frame tests: 28 passed, 0 failed.
- `bun run build`: passed all five ship checks, thirteen aircraft asset checks, TypeScript and Vite. Vite retains a large game-bundle warning.
- `ship:build`: all five presets rebuilt because the shared definition compiler changed. Local Blender was used; no Blender MCP tool was exposed. Aircraft geometry/textures and Bismarck baseline inputs were not modified. Enterprise reference comparisons refreshed after the discrepancy-register update.
- Inspected Enterprise's fixed plan/profile/bow/stern/quarter views and actual in-game mount articulation; maximum muzzle discrepancy was 0.000031 m. Export success does not certify historical accuracy.
- Actual browser custom battle: Enterprise versus Enterprise, nine player aircraft ordered in three groups. Both fleets launched; fighter losses and returning strike aircraft were observed. `runtime-flight.json` retains a sampled diagnostic. The integration test also confirms actual bomb/torpedo ship hits, flooding and score credit.
- `desktop.png`: actual battle with the flight panel, live inventory and aircraft contacts. `enterprise-articulation.png`: actual development port at maximum mount articulation.
- `narrow-hud.png`: the actual HUD DOM/styles in a 390×844 iframe at the left of the desktop capture. This checks responsive control layout, not touch gameplay or mobile GPU performance. Final flight panel bounds: x=207..380, y=260..569; horizontal document overflow is zero. The panel scrolls for Recall/flight details and leaves the central sight and existing left-side target selector clear.
- UI detector: six advisory findings, no failures. Colors and compact type sizes intentionally extend the existing naval instruments; advisory details are retained.

Claude review requested in the workspace's “Claude aircraft review” terminal after implementation and validation. Review findings are separate from these implementation checks.

## Pre-merge review follow-up

Claude's required findings were addressed: gear follows the published forward/spanwise axis and fixed-joint metadata (tail travel is halved), bot strikes skip lost/submerged targets before choosing a fallback, and README/air-operations docs explicitly identify the initial AA coverage gap (only Enterprise and Type VIIC have eligible light mounts). No unresearched AA batteries were added.

Also raised the torpedo-release floor to 650 m, separated usable/recoverable air capability and excluded fighter-only survival from ship-battle victory, disabled strike launch controls for combat-lost targets, hid empty instance batches and bounded the tracer buffer. Added regression coverage for wreck-target fallback and fighter-only defeat. Other tuning/performance/mobile-layout suggestions in Claude's report remain follow-up work; this note does not recast the original review as unconditional approval.

## Integration with master

Merged the newer U-570/Type VIIC reconstruction from master. Regenerated its GLB, Blender source, thumbnail and comparison outputs with the shared compiler; the other four assets already match. Preserved the prior submarine runtime evidence with an explicit historical-export registration rather than changing its recorded hashes.

Production build passes on the combined tree. The full post-merge run passed 438 tests and hit two fleet-loading version mismatches because it started before the Type VIIC publication completed. After publication, all six tests in `src/game/Game.test.ts` pass, including those two cases. The two new review regression tests also pass. This is a resolved test/publication race, not a relaxed version check.

Fresh in-game Type VIIC review loaded export `f38b819172189b7a8f3119a214ed6111e192ba06d5888198657440a435aa2106`; maximum muzzle discrepancy at the articulation preview is 0.00000154 m. `merge-gear.json` records the actual aircraft renderer driving the published Wildcat main gear about its forward/Z axis and tail about its authored spanwise/X axis with half travel.
