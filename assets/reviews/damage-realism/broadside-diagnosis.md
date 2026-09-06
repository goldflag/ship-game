# Broadside damage diagnosis — 2026-09-06

Baseline commit: `0a567e06934f2e8cfe260b42d1f3c3d70f316165`. Bismarck definition hash: `1c26659502b076b6eb2e2d45f6e124393542bfe67d38eb7ed446843683a71f1b`.

## Reproduction

Run `bun scripts/diagnostics/broadside-damage.ts`. Eight incoming 38 cm AP shells hit a stationary Bismarck broadside, distributed along its middle. They use the published 70 damage and AP fuze profile, 550 mm penetration budget and an approximately 5 km incoming velocity. Impact placement is controlled; it removes dispersion to isolate landed hits. The full CPU combat loop handles collision, fuzes, bursts, crews, flooding and score.

All eight shells penetrate; equipment damage is **0 points**, equipment remains **100%**, and floodwater remains **0 m³**. The recorded [impact ledger](broadside-diagnosis.json) includes the incoming-side blast correction described below. That correction alone does not fix the broadside case.

The existing `bun scripts/diagnostics/combat-lethality.ts 12345` also reproduced the issue before the correction with normal dispersion and repeated fire at 5 km. After 300 seconds, 120 shells had fired, 72 hit, and 69 penetrated. Only two shells damaged equipment, destroying one secondary mount. Bismarck retained 96.86% equipment condition and full propulsion, with 11.38 m³ of water. This is a controlled stationary target measurement, not a moving battle duration or historical survivability claim.

## Cause

The condition meter and damage score summarize only equipment HP. The main belt can be penetrated while the turtleback and armored deck protect the machinery. An armed burst in the outboard or upper hull has no hull/compartment condition to damage. The exterior opening is only caliber-squared in area; a wholly above-water opening stays dry. The direct equipment damage coefficient therefore cannot change these zero-damage shell paths.

The accepted realism roadmap explicitly called for consequences in outboard spaces after an inner plate stops a shell, and for working alternatives before removing universal HP sinking. The current implementation has a gap in those consequences. A broader correction needs a combat-model decision: introduce local hull/compartment damage and its consequences, or retain equipment-only condition and expand the physically modeled burst/flooding consequences.

## Corrected blast bug

An armed AP shell lodged exactly on an armor surface. Fresh blast rays then intersected that surface at zero distance in either direction. The stopping plate wrongly shielded equipment and watertight boundaries on the incoming side too.

The lodged burst origin now sits 0.1 mm back along the incoming direction. The impact ledger retains the original collision point. The lodged point is retained in the hull or articulated mount frame, so it follows subsequent movement. The stopping armor still protects targets on its far side.

A regression first reproduced the failure with equipment behind the shell's starting point, preventing any direct equipment strike. It now receives the expected exposed burst damage. Existing tests retain the protected far-side case and attachment to a moving hull. No ship assets, definitions or armor thicknesses changed.

## Validation

`bun run build` passed all five ship checks, aircraft checks, TypeScript and Vite. The existing bundle-size warning remains. The first full test run passed 443 tests and reached the default five-second timeout in four longer simulation cases. `bun test src/simulation --timeout 60000` then passed all 274 simulation tests, including those four cases, with no assertion failures. The other 173 tests passed in the initial run. No browser combat playtest was performed for this CPU-only correction.
