# Runtime memory checks — 2026-09-07

An intermittent browser Out of Memory report prompted these changes:

- Prepare fleet models sequentially, including parsing, palette conversion, batching and LOD generation. Duplicate ships still share one prepared template. Failed loads preserve the port and allow retry; disposal stops subsequent loads.
- Store only bounds and triangle ranges in `SurfaceChunks`. Previously each 128-triangle range retained a Mesh and BufferGeometry. A query now uses one temporary proxy sharing source attributes. Original face indices, transforms and material behavior remain covered by raycast and impact-mark tests.

On Windows with Bun 1.3.14, loading and palette/batch preparation of Bismarck, Yamato and Enterprise produced 7,310 surface chunks. Comparing Bun's `heapStats()` before and after warming the cache, with `Bun.gc(true)` at both boundaries:

| Cache allocation | Before | After |
| --- | ---: | ---: |
| Additional heap bytes | 19,099,755 | 1,568,719 |
| Additional objects | 307,124 | 29,320 |

This is a 92% reduction in this cache's measured heap allocation, not total game memory. The Bun geometry measurement cannot decode browser image textures; it measures only the hit cache. The geometry-allocation regression test fails against the old implementation.

Chrome headless, WebGPU, 1280×720, default High graphics: loaded port, launched ten ships (two each of Bismarck, Yamato, Enterprise, Baltimore and Fletcher), ran 30 wall-clock seconds of battle, then returned to port and switched to Type VIIC. No page errors or crash occurred. CDP backing storage measured 403 MB in initial port, 696 MB on fleet load, 697 MB after the battle sample, and 351 MB after switching back. This short smoke test does not reproduce or rule out the user's intermittent crash or validate maximum-size fleets.

Validation: loading, surface queries, impact marks and all-preset render assembly tests pass; TypeScript and the Vite production bundle pass. The full build is blocked by stale ship comparison records, also present in the untouched main checkout. Its frame tests have 22 existing failures because the sky fixture lacks `timeOfDay`; no frame-loop behavior changed here. Combat tests require a longer timeout on this machine.
