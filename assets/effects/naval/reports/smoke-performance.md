# Smoke rendering performance — 2026-09-05

Firing smoke spent GPU time calculating sunward lighting for empty density samples. The shader now skips lighting and extinction when density is exactly zero and ends a ray when transmittance drops below 0.001. Both smoke and aerated water use these guards. Their existing view samples, two shadow samples, density texture, turbulence, cooling and particle recipes remain intact.

All effect planes use `forceSinglePass`: separate front/back submissions are redundant for a single plane. This reduces the seven effect batches from 13 draw calls to 7, including empty startup, growing salvos and resets. Fixed instance capacities remain unchanged so Three r185 still compiles the complete matrix buffers at startup.

## Measurements

The user's machine had substantial concurrent work. Whole-scene timings fluctuated enough to swamp some comparisons, so these results use alternating shader revisions on identical CPU-fired particle buffers, at 1920×1080 with the game's four-sample MSAA. Each case discards six warmup pairs and measures 60 pairs using WebGPU timestamp queries. This isolates smoke rendering; it excludes the ocean, ships, CPU simulation and frame scheduling. Other GPU activity can still affect the timestamps. These are smoke GPU costs, not promised gameplay FPS gains.

Baseline source: `2b9da7431dbe024084b47a82a286c5bb13d61dbd:src/game/EffectVolume.ts`. [Raw results and checks](smoke-performance.json).

| View | Before median | After median | Reduction |
| --- | ---: | ---: | ---: |
| Muzzle fire, 0.2 s | 1.64 ms | 1.51 ms | 8.0% |
| Close smoke, 2.5 s | 2.42 ms | 2.10 ms | 13.5% |
| Dispersing smoke, 8 s | 3.08 ms | 2.49 ms | 19.1% |
| Binocular horizon, 2.5 s | 1.97 ms | 1.57 ms | 20.0% |
| Camera inside smoke, 2.5 s | 11.27 ms | 8.19 ms | 27.3% |

The dense inside-cloud case saves approximately 3.1 ms of GPU work. Earlier alternating runs also favored the optimized mature smoke, though the absolute times and percentage changed with background load. The short muzzle-fire comparison varied in sign between runs, so its small improvement in this final run is inconclusive. An extra branch around out-of-volume density samples was tested and removed because it slowed the shader. Half-resolution rendering was explored but is not used in the final change.

## Appearance and validation

All five shader comparisons have a maximum RGBA difference of one 8-bit level, with no pixels differing by more than two levels. Hot gas, mature smoke, late thinning, the horizon and an entirely smoke-filled viewport retain their existing appearance. This numerical comparison uses an isolated linear RGBA8 target; it does not establish a universal error bound for arbitrary particle recipes or HDR emission.

The original and optimized shaders were also inspected in the actual ocean/sky composition: [before](../review/performance-before.png), [after](../review/performance-after.png), [fixed scene and combat diagnostics](../review/performance.json). These screenshots switch only the smoke material in the current Game; the isolated pixel comparison above is the numerical reference.

- `bun test src/simulation src/game/CombatEffects.test.ts`: 70 passing tests, 4,882 assertions. Simulation outcomes, bounded pools, pause/reset, cooling, spray motion and shell capacity pass.
- `bun run build`: passes all four published ship checks, TypeScript and Vite.
- `checkCombatVolumeRendering()`: WebGPU pixel checks pass outside, at an oblique reverse view and inside a volume, behind an opaque blocker, and after reset. The smoke batch requires one draw call. The original two-pass material exceeds that budget.
- `checkCombatSmokeHorizon(review)`: 38 rows pass, minimum contrast 0.09836 against the 0.04 threshold.
- `checkCombatEffects()` and `checkCombatEffects(true)`: projectile occupancy and the seven-draw budget pass on WebGPU and WebGL2 for empty startup, 1–256 shells, shrinking salvos and resets.

The additional WebGL2 volume probe found an existing depth-copy/clipping problem: the opaque blocker fails to hide smoke. Repeating it with the original shader and original two-pass setting produces the same result (15,102 visible pixels behind the blocker). This predates the optimization and is left open. The full ocean/sky composition is validated on WebGPU only.

## Master integration

The smoke change was applied without conflicts on top of `3ab15b1`, retaining the newer Bismarck geometry, structural hit coverage and custom battle deployment changes. The combined version passes all 170 tests (12,286 assertions) and `bun run build`, including the four published ship checks. The timing measurements and screenshots above were captured before those upstream model changes; they remain evidence for the smoke shader comparison, not a benchmark of the newer complete scene.

## Repeat

Run `bun run dev` and open `/scripts/diagnostics/combat-effects.html` in Orca's browser. After `window.reviewReady`, run:

```js
const checks = await import('/scripts/tests/combat-effects-browser.ts');
await checks.checkCombatVolumeRendering();
await checks.checkCombatEffects();
await checks.checkCombatEffects(true); // WebGL2 projectile/batch check
await checks.checkCombatSmokeHorizon(window.review);
```

For an alternating benchmark, retain the baseline under ignored build output:

```sh
mkdir -p .build/smoke-perf
git show 2b9da7431dbe024084b47a82a286c5bb13d61dbd:src/game/EffectVolume.ts > .build/smoke-perf/EffectVolume-before.ts
```

Then run in the review browser:

```js
const { compareSmokeMaterials, measureSmoke } = await import('/scripts/diagnostics/smoke-performance.ts');
const { effectVolumeMaterial: before } = await import('/.build/smoke-perf/EffectVolume-before.ts');
await review.still('smoke', 2.5);
await compareSmokeMaterials(review, before, 60);
// Optional whole-scene smoke on/off probe; interpret its timings cautiously.
await measureSmoke(review);
```

The benchmark freezes frame scheduling while measuring and restores it afterward. GPU timing queries are enabled only during diagnostics. No profiling readbacks are added to the game loop.
