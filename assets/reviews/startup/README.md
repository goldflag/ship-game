# Startup delivery review — 2026-09-07

Production startup now downloads losslessly compressed ship models and extracts the ocean/sky libraries' embedded image literals into independently cached assets. Original GLBs, model hashes, textures, geometry and rendering settings are unchanged. Development continues to load the authoring GLBs and the supplied vendor bundles directly.

The timing and visual captures below use baseline `3fe185cb` and predate the PR's rebase onto `f3820a54`. They retain evidence for that model hash and water palette. After rebasing, the full build and all 13 targeted tests passed again; see [PR build output](pr-build.txt). Performance has not been remeasured against the newer combat data and water palette.

## Measurements

Installed Chrome, headless WebGPU, 1280 × 720, default high graphics, Bismarck in port. Each sample uses a fresh browser context. CDP simulates 50 Mbps download, 10 Mbps upload and 40 ms latency against Vite's production preview. The baseline retains the loading information change but uses original asset delivery. The browser observes the appearance of the harbor UI; measurements include file transfer, model processing and graphics preparation.

| Measurement | Before | After |
| --- | --- | --- |
| Harbor visible, sample 1 | 18.875 s | 15.209 s |
| Harbor visible, sample 2 | 18.344 s | 14.703 s |
| Mean | 18.610 s | 14.956 s |
| Recorded transfer volume | 70.7 MiB | 52.1 MiB |
| Largest JavaScript chunk, build-reported gzip | 5.48 MB | 1.17 MB |
| Bismarck model transfer | 23.64 MB | 3.96 MB |

The measured mean improves by 19.6%. Two samples establish a local comparison, not a guarantee for other hardware, browsers or hosting. Transfer totals sum the captured resources larger than 10 KiB and include port thumbnails. Raw stages and request timing are in [before.json](before.json) and [after.json](after.json); [before.png](before.png) and [after.png](after.png) show the unchanged harbor composition. Animated clouds and water advance independently.

Parallel harbor downloads were also measured, but did not reliably improve startup, so that experiment was removed. Terrain/scenery downloads and graphics compilation still account for much of the remaining wait.

## Reproduce

Build with `bun run build`, then run `bun run preview --port 5298`. `scripts/diagnostics/measure-startup.mjs` requires installed Chrome and `playwright-core` in a tools directory; point `PLAYWRIGHT_MODULE` at that package's absolute `index.mjs` path. Run:

```sh
THROTTLE=1 STARTUP_URL=http://localhost:5298/ node scripts/diagnostics/measure-startup.mjs after
```

The script writes two samples to `/tmp/startup-after.json` and screenshots beside it. Omit `THROTTLE` for an unthrottled local measurement. Use the same build mode, browser, viewport and fresh-context policy for a comparison.

## Validation

- `bun run build`: passed, including ship/aircraft freshness checks and TypeScript. The existing large-chunk warning remains because compiled ship definitions are still bundled for synchronous access. [Build output](build.txt).
- `bun test scripts/build/vendor-textures.test.ts src/game/loadShipModel.test.ts src/game/Game.test.ts`: 13 passed. Coverage includes asset byte preservation, model hierarchy/poses, already-decoded server responses, corrupt/failed transfers, ship switching and battle loading/retry.
- Every emitted `.glb.gz` was decompressed and compared byte-for-byte with its original `public/models/*.glb`. Every extracted vendor image was compared by SHA-256 with its original embedded bytes.
- Reviewed the before/after harbor screenshots and observed no browser exceptions or failed requests in either final timing sample.
- A separate `/naval/` production build passed an injected ship-download failure and retry, switching to Yamato, launching against Bismarck and returning to port. [Lifecycle results](lifecycle.json), [battle screenshot](battle.png). Audio requests belonging to the failed session were canceled during retry cleanup; no browser exceptions were reported.

Bismarck GLB SHA-256: `caab2597dd6e0d92b4e77ea140be9271c0afa51de620d00728fd86cdd39ef7bb`.
