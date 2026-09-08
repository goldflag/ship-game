# Shared merchant and corvette authoring

`geometry-v2.py` and `plans-v2.json` are the registered original geometry/measurement inputs for Liberty Cargo, Liberty Collier, Victory Cargo and Flower Corvette. Each ship keeps its own canonical blueprint and exports. The older `geometry-v1.py` supports preserved retired variants.

`author-blueprints-v2.ts` regenerates the current blueprints; the older authoring script describes revision 1. These commands overwrite authoring data and are not needed for normal model builds. Read their scope before deliberate regeneration. Build individual ships through `ship:build`; rebuild declared consumers after shared recipe changes.

`review-headless.ts` exercises an isolated development browser and writes diagnostics in `.build/ships/convoy/`. Research scans and historical reports have been removed. Inspect GameModels3D or War Thunder as the primary visual reference for new geometry work, corroborate with historical plans, and keep any downloads/captures in ignored `.build/`. Summarize lasting limitations in the relevant ship README.
