# Funnel smoke review

Four original billow shapes, slow internal deformation, sun/moon shading and gradual edge erosion replace the static pre-lit exhaust texture. The moving plume stays attached at the authored funnel rim and drifts independently after emission. Emission rates, lifetimes and the 6,144-particle fleet limit are retained; a 0.12-second fade softens new puffs.

[Watch the 6-second underway capture](after.webm). [Capture settings and hashes](manifest.json).

| View | Before | After |
| --- | --- | --- |
| Close underway | [Original](before-close.webp) | [Updated](after-close.webp) |
| At rest | [Original](before-idle.webp) | [Updated](after-idle.webp) |
| Night | [Original](before-night.webp) | [Updated](after-night.webp) |

Additional checks: [underway](after-underway.webp), [binoculars](after-binocular.webp), [dusk](after-dusk.webp), [overcast](after-overcast.webp).

![Updated exhaust underway](after-close.webp)

## Performance

**Baseline: original funnel smoke on master commit `365a6f446c04bfa25c73f4a71e3266f42be7c538`.** Both recipes run in the same renderer with identical ships, clocks, wind, cameras and resolution. These results compare funnel exhaust, not cannon smoke. Host: Apple M5 Pro, Orca Chromium WebGPU, Medium, 1920×1080, 4× MSAA. Each case alternates A/B order over 120 measured pairs after warmup. Raw GPU timestamp and CPU update samples are in [performance.json](performance.json).

| Isolated exhaust | Particles, both versions | Before median GPU ms | After median GPU ms | Before / after p95 ms |
| --- | ---: | ---: | ---: | ---: |
| underway | 48 | 0.131 | 0.131 | 0.459 / 0.524 |
| close funnel | 48 | 0.066 | 0.131 | 0.197 / 0.262 |
| idle | 22 | 0.131 | 0.131 | 0.262 / 0.262 |
| binocular | 48 | 0.066 | 0.066 | 0.131 / 0.131 |
| 60 ship fleet | 5,760 | 0.197 | 0.197 | 0.262 / 0.262 |
| 16 overlapping plumes | 768 | 0.655 | 0.918 | 0.721 / 0.983 |

The complete frozen Game scene, including ocean, sky and postprocessing, measures **21.43 → 21.43 ms median**, with p95 **22.41 → 22.81 ms**. Both versions submit **248 scene draws**. The exhaust itself remains **one draw and one texture sample per pixel**. Fleet CPU update median is approximately 1.7 ms in both versions. The 16-ship overlap is a deliberately crowded stress fixture with intersecting hull positions, not a normal formation.

GPU timestamps on this host have a 0.065536 ms quantum; small differences and p95 vary with concurrent GPU activity. This is a bounded visual upgrade with a small added cost in close overlaps, not an FPS improvement claim. The new atlas adds about 256 KiB of mipmapped texture storage and the animated instance state adds 96 KiB. No per-puff raymarch or additional pass is introduced.

## Validation and reproduction

- `bun test src/game/ShipFunnelSmoke.test.ts src/game/BattleEnvironment.test.ts src/game/CombatEffects.test.ts src/game/renderOrder.test.ts --timeout 30000`: 27 pass.
- `bun run build`: passes ship/aircraft checks, TypeScript and Vite. Existing large-bundle advisory remains.
- Actual WebGPU [render checks](render-checks.json): empty first compilation, lighting direction, immediate paused lighting changes, pause, own optics hiding/restoration, machinery stop and reset. Every state stays in one batch.
- [Shared volume checks](shared-volume-checks.json): cannon volumes still render with normal and reversed depth, including inside views and opaque occlusion.

Retain the original baseline with `python3 scripts/diagnostics/retain-funnel-baseline.py 365a6f446c04bfa25c73f4a71e3266f42be7c538`, start `bun run dev`, and open `/scripts/diagnostics/funnel-smoke.html`. Wait for `window.reviewReady` before running:

```js
const { ShipFunnelSmoke: Baseline } = await import('/.build/funnel-smoke/baseline/ShipFunnelSmoke.ts');
const { compareFunnels, compareFunnelGameFrames } = await import('/scripts/diagnostics/funnel-performance.ts');
const isolated = await compareFunnels(window.review, Baseline, 120);
const wholeScene = await compareFunnelGameFrames(window.review, Baseline, 120);
```

Keep preview videos paused and avoid builds or edits during the measurements. For captures, use `review.baseline(Baseline)`, `review.variant('before' | 'after')`, then `review.still(scene, 12)` or `review.record('close', 6)`. `scripts/diagnostics/capture-combat.py` saves this page's stills and VP9 video as well; set `NAVAL_REVIEW_PAGE` to its Orca page ID. The runtime source, model hash and exact capture setup are retained in the manifest.
