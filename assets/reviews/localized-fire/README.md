# Localized ship fire review

Reviewed on 2026-09-07 in the production Game/WebGPU renderer and FleetHud, through Orca 1.4.193 on macOS. Work began in the separate Orca `cownose` worktree at remote master `d0967a7de11702b39e758801e1ab8ff2e6a09ffe`, then rebased onto `cfdb2010` for the spectator HUD and fleet-loading changes. [PR #94](https://github.com/goldflag/ship-game/pull/94) was checked before implementation: merged at 20:20:09 UTC that day and already in the starting base. This pass adds no dependency on an unmerged equipment branch.

No ship geometry, blueprint, fuel, ignition or suppression calibration changed. Bismarck's reviewed definition hash is `fcc33f028b242f738e3beeddf0ab62e84567abdc99417e514ec6824dcb928e09`. Baltimore's ordinary-combat replay hash is in [combat.json](combat.json). [sources.json](sources.json) records reviewed source digests. These are effects/controls checks, not a new historical-model acceptance claim.

## Reproduction and diagnosis

The [ordinary combat replay](../../../scripts/diagnostics/localized-fire-combat.ts) uses seed 1941, Bismarck versus Baltimore at 3 km, 180 seconds each of AP and HE, real shell trajectories/bursts and automatic crews. The player holds main-battery fire, tracks a target-local aim point and uses half throttle. No heat or damage is injected.

| Run | Fires observed | Duration |
| --- | --- | --- |
| AP | Baltimore port upper reserve space; Bismarck steering room | 40.18 s; 12.63 s before replay cutoff |
| HE | Baltimore port upper reserve space; port forward Bofors | 88.60 s; 23.10 s |

The HE reserve fire exhausts its 80-unit combustible load. Up to two locations burn simultaneously in this short replay. [Before](combat-before.json) and [after](combat.json) results match exactly as data, including damage-event counts and fuel consumed. This is evidence that ignition and finite-fire duration already work; it is not a fleet-wide estimate of ignition probability.

The visibility problem has three presentation causes: old mount flames were small, transient round particles at the roof; internal smoke had low opacity and competed with gun/impact smoke in a shared 192-particle pool; the sailing HUD had removed the old crew-control panel. The first 32 burning locations also exhausted the effect source budget in actor order, irrespective of what the camera could see. The matched captures below show the resulting small smoke puffs and barely visible flame bases.

A separate gameplay reproduction found that changing priority/focus cleared **every** crew assignment. A crew with one second of setup left returned to five seconds after a focus order. The [failing regression](crew-focus-before-fix.txt) was recorded before the fix. Orders now re-score existing jobs; only crews that actually move pay setup again. Rates, supplies, finite fuel, local equipment damage, spread and magazine ignition retain their existing accounting.

## Visual and interaction results

The matched normal/8× pairs use the same frozen six-second fire state, ship poses, camera and game environment. `CombatEffects.ts` and FleetHud from the starting base were temporarily imported under separate filenames, swapped into that scene, then removed. The baseline data includes the new readout's extra labels; heat, intensity and fuel are unchanged. No mock image renderer or generated artwork was used.

| Check | Evidence and result |
| --- | --- |
| Normal battle view, three fires per ship | [Before](before-normal.png), [after](after-normal.png), corresponding JSON. Sustained yellow/orange flames identify Anton and Dora; smoke identifies the authored aft boiler outlet. Ship and sea remain legible. |
| Binoculars, enemy ship at 8× | [Before](before-optics.png), [after](after-optics.png). Enemy flames/smoke remain visible; own-ship effects are hidden and continue aging. |
| Narrow 390 × 844 game viewport | [Open panel](after-narrow.png), [layout/controls](narrow-layout.json). Actual same-origin iframe dimensions, not a resized desktop screenshot. No horizontal overflow; priority, scrolling fire list, focus and close controls are reachable. Dark space outside the iframe belongs to the review host. |
| Focus during firefighting | [UI focus result](focus-state.json). Clicking Focus crews on Anton changes the real order to fires/Anton; at seven seconds existing crews are suppressing with zero setup remaining. Release/reassignment/reset have simulation regression coverage. |
| Cooling and extinction | At 20 seconds all three flames are out, with 77 previously emitted smoke particles remaining: [canvas](after-cooling.png), [state](cooling-state.json). At 37 seconds there are no flames, smoke or fire readout entries: [HUD](after-extinguished.png), [canvas](after-extinguished-canvas.png), [state](extinguished-state.json). About 79% mount and 92% boiler fuel survives suppression. |
| Spread through a damaged boundary | [Runtime image](after-spread.png), [state](spread-state.json). In an explicitly unattended fixture, an existing damaged boiler-room boundary passes heat to the adjacent room, which reaches intensity 1 and consumes its own fuel. No compartments or fuel stores are added. |
| Motion, heel, trim and pause | Ships move under simulation throughout the replay. [Heeled runtime canvas](after-heeled.png), [pause state](heel-state.json): flames remain on mount roofs at roll .12, pitch .04 and heading .7 radians. Existing smoke stays in world space. Repeated paused production frames leave damage, tick and flame matrices identical. Adapter tests also exercise interpolated poses and 30/60 Hz emissions. |
| Return to port/reset | [State](reset-state.json): tick 0, no fire entries or effects, balanced priority and empty focus. |
| Fleet saturation | [60-ship runtime canvas](after-fleet.png), [state](fleet-state.json). 120 actual mount fires; 32 camera-relevant sources displayed within fixed pools. Tests put the nearest ship last in actor order and verify it receives effects. |
| Spectator integration | The observed ship supplies fire locations and readout. Crew orders are read-only; the dead player's orders cannot control a teammate. The integrated FleetHud regression covers an observed Fletcher inside a Bismarck context. |

All images were inspected. Normal, optics, narrow and spread are Orca browser screenshots; cooling, heeled, final extinction and fleet canvases were exported directly from the running WebGPU canvas when browser screenshot capture intermittently lost window focus. Canvas exports intentionally omit the HTML HUD. The six-second HUD shows a rounded one-second deployment label for a near-zero floating-point setup remainder; the next simulation tick starts suppression. The diagnostic HUD's FPS field is a fixed fixture value and must not be read as a performance measurement.

## Cost and bounds

The new effects have fixed capacity: 96 anchored flame tongues and 512 smoke particles, separate from transient battle effects. Selection scans the fleet but stores/sorts at most 32 sources, ranked by apparent size/intensity and camera distance with an offscreen margin. Internal rooms emit smoke only at authored above-water outlets. Flames follow live intensity and stop immediately at extinction; residual smoke lives at most six seconds. Own-ship effects obey the binocular rule. No per-fire lights or volumetric raymarch are added.

| Measurement | Baseline | After |
| --- | --- | --- |
| Adapter CPU median, 60 ships / 13,740 artificially burning locations | 0.073 ms | 1.651 ms |
| Adapter CPU p90, same synthetic saturation | 0.105 ms | 1.994 ms |
| Whole-scene draw calls, 60 actual hulls / 120 mount fires | 6,536 | 6,538 |
| Whole-scene GPU median with fires, 1783 × 1374 canvas | 88.01 ms | 90.31 ms |
| Whole-scene GPU p90 with fires | 102.63 ms | 101.45 ms |

See [CPU before](before-cpu-cost.json), [CPU after](after-cpu-cost.json), [GPU/draw calls before](before-fleet-performance.json) and [after](after-fleet-performance.json). CPU timings use Bun 1.3.3, 120 warmup frames and 600 samples. GPU timings use production WebGPU timestamp queries and alternating fire-visible/fire-hidden passes, six warmup pairs and 24 measured pairs. The clear-scene medians were about 100 ms, slower than the fire-visible samples: the desktop GPU measurements are noisy and do **not** establish a speedup or a reliable incremental GPU cost. The scene was already slow before this pass. What is established is two additional fixed draw calls and about 1.58 ms extra CPU work in the deliberately extreme all-locations fixture. The source budget intentionally omits less relevant distant fires under saturation; their simulation continues.

## Validation

- Repository-pinned **Bun 1.3.3**; frozen-lockfile install.
- `bun run build`: pass after integration, including `ship:check all`, `aircraft:check all`, TypeScript and Vite. [Log](build.txt). The large bundle warning also occurs in the [baseline build](baseline-build.txt). No model outputs needed rebuilding.
- `bun run test`: **872 pass, 22 fail**, 125 files. [Log](tests.txt). All failures are the pre-existing `GameFrame.test.ts` sky mock missing `timeOfDay`, throwing on `moon.skyDarkness`. Exact starting-base Game and frame tests reproduce all 22: [baseline log](baseline-frame-tests.txt). This pass leaves that unrelated harness unchanged; it does not claim a green full suite.
- Relevant damage-control, local-damage, effects, new readout/pose/extinction/cadence tests and integrated spectator HUD tests pass: [64 tests, zero failures](focused-tests.txt). Original focused baseline: [46 passing tests](baseline-focused-tests.txt).
- Impeccable mechanical review: no blocking design errors; advisory fire palette/type additions reviewed against the existing naval instrument styling. Runtime layout and controls were reviewed at 390 × 844.

## Repeat the review

```sh
bun install --frozen-lockfile
bun scripts/diagnostics/localized-fire-combat.ts
bun scripts/diagnostics/localized-fire-cost.ts
bun run dev --port 5184
```

Open `/scripts/diagnostics/localized-fire.html` in Orca's browser and wait for `window.reviewReady`. It runs the production renderer and HUD, freezes ordinary game scheduling, seeds finite heat in existing locations, then exposes `window.fireReview`. Reload between independent fixtures. In the browser console:

```js
await fireReview.prepare();                       // six-second, two-ship fire state
fireReview.camera('optics'); await fireReview.render();
fireReview.camera(); await fireReview.advance(14); // twenty seconds: cooling
await fireReview.advance(17);                     // thirty-seven: extinguished
await fireReview.spread();                        // explicitly unattended spread
await fireReview.fleet(30);                       // 30 versus 30, 120 mount fires
await fireReview.measure();                       // alternating fire-only visibility
```

The narrow page `/scripts/diagnostics/localized-fire-narrow.html` embeds that same game at 390 × 844. Use View crews, change priority, focus/release a location, and switch to the target report. For a CPU baseline, extract `git show d0967a7:src/game/CombatEffects.ts` into `src/game/CombatEffects.baseline.ts`, run the cost script with `--baseline`, then remove the temporary file. Baseline browser comparisons can swap the corresponding temporary class instance into `fireReview.game.effects` and its scene, using the same camera and stepping as the final class; `useHud` accepts the original FleetHud for matched controls captures. Baseline imports must remain temporary and are absent from this commit.
