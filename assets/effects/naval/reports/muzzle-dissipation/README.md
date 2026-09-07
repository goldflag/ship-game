# Progressive muzzle smoke — 2026-09-07

Cannon smoke held its dense silhouette while its final transparency decreased. In the isolated overlapping-salvo replay, 380 mm and 460 mm smoke still retained 87–89% of peak integrated screen opacity at 3.5 seconds. The opacity concentrated in overlapping lobes, leaving most visible dissipation until the end. The replay stayed below particle capacity; expiry itself removed already transparent particles.

The muzzle recipe now uses a narrower trailing lobe and faster, broader leading gas, with less initial density. After the flash cools, a smooth density curve also reduces local shadow absorption and erodes thin edges. Each lobe has its own thinning time. The smoke becomes faint around 2.5–3 seconds, ahead of its 3.3–4.2 second storage lifetime. This remains an authored visual approximation.

Only muzzle particles opt into density dissipation. Funnel exhaust, damage smoke and water retain their recipes. Lifetime and density progress share one instance buffer, keeping the shader within WebGPU's eight-buffer limit. Volume counts, ray steps and texture sample counts are unchanged.

## Review

The actual Game was reviewed in Orca using WebGPU, Medium quality and a fixed 1920 × 1080 camera. Images are lossless encodings of unedited renderer captures, with adjacent camera/combat JSON. [Exact source hashes and horizon measurement](review.json) identify this version.

- [Revised firing clip](after.webm): 156 actual renderer frames at 30 fps, with firing after the initial half-second. [Capture metadata](after.capture.json) and [decoded playback/seek check](video-check.json) are retained.
- At 2 seconds: [before](before-2.webp), [after](after-2.webp).
- Old dense tail at [3.5 seconds](before-3.5.webp).
- Revised progression at [1 second](after-1.webp), [2 seconds](after-2.webp), and [2.7 seconds](after-2.7.webp).

The [GPU fade replay](fade.json) measures summed alpha in a transparent 256 × 256 target through the actual muzzle-event/material path, including tightly overlapping barrels. These are screen-opacity measurements, not physical smoke mass. The new regression failed on the original recipe and passes with the revision.

| Replay | Old opacity at 2.5 s | Revised opacity at 2.5 s |
| --- | ---: | ---: |
| One 127 mm barrel | 90.7% | 0.4% |
| Eight 380 mm barrels | 98.9% | 5.3% |
| Nine 460 mm barrels | 99.3% | 7.2% |

Percentages use each replay's peak. All revised cases reach zero visible alpha by 3.5 seconds and expire by 4.2 seconds. Sampling every 0.1 seconds found no drop above 12% of peak after the initial blast.

Validation: 50 relevant simulation, effects, wind and render-order tests pass, as does `bun run build`. [Volume visibility checks](volume-checks.json) pass outside, inside, behind opaque geometry, in front of distant transparent water, and after reset, for both smoke and water with standard and reversed depth. The actual 5 km horizon check passes all 38 rows at 2.5 seconds (minimum contribution 0.067, threshold 0.02). Full scene review used WebGPU.

To repeat, open `/scripts/diagnostics/combat-effects.html` on the local Vite server and wait for `window.reviewReady`:

```js
const checks = await import('/scripts/tests/combat-effects-browser.ts');
await checks.checkCombatSmokeDissipation();
await checks.checkCombatSmokeHorizon(window.review);
await review.still('smoke', 2);
```

The review page's wake update was also brought up to date with the fleet-view API so the original firing scenario can be replayed.
