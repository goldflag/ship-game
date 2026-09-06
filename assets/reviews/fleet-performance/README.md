# Large-fleet performance review

2026-09-05. Fixed workload: 24 Bismarcks per side, 5 km deployment. Measurements ran on the user's busy computer; these are component costs, not an FPS promise. No other applications were stopped.

## Changes and evidence

- Reject shell segments whose world-space bounds cannot reach a hull before transforming them into that hull's local coordinates. The bounding radius contains the original collision box at every heading, roll and pitch. Surviving candidates retain their precise collision checks and distance ordering.
- Build armor/internal inspection meshes on first inspection. Previously each Bismarck eagerly built 450 hidden volume groups, which still participated in scene matrix traversal.
- Clone each source material once per ship instead of once per mesh. Inspection opacity remains independent between ships.

[Raw measurements](measurements.json) contain three alternating before/after simulation comparisons. Each run warms up for 120 ticks and measures the next 3,600 ticks. Median tick times were 3.15–3.61 ms before and 2.03–2.48 ms after, a 31–35% reduction in each pair. All six runs produced the identical final hash of actors, shells and events, with 256 live shells.

The CPU scene benchmark loads the real exported geometry and materials without textures or a GPU. For 48 ships, node count fell from 89,041 to 22,369 and material count from 58,704 to 672. Median world-matrix update time fell from 24.59 to 2.91 ms in this run. Fleet-view creation fell from 3,465 to 86 ms. These timings exclude loading/decoding assets, shader compilation, ocean updates and GPU work. The node count includes the benchmark's common parent group.

A live WebGPU review loaded all 48 ships. GPU timing was noisy under concurrent load, and a paired browser before/after measurement could not be retained reliably across development reloads; no GPU or overall FPS improvement is claimed. Geometry, triangles, gun articulation and visual quality are unchanged. Drawing thousands of meshes and shading ocean/smoke remain costs that these changes do not remove.

## Repeat

```sh
bun scripts/diagnostics/fleet-performance.ts 24 3600
bun scripts/diagnostics/fleet-scene-performance.ts
```

The scene benchmark optionally accepts a module URL relative to the script that exports a baseline `ShipView`. Retain baseline modules in an ignored local directory with their dependencies before making changes. Run before and after sequentially, alternate their order, and compare state hashes as well as timings.

For a fixed 1280×720 medium-quality browser scene, open `/scripts/diagnostics/fleet-performance.html` on the development server. Once its status says Ready, call `window.review.measure()` from the console. It alternates the same frozen scene with the fleet shown/hidden and reports submission time, GPU timestamps when supported, draw calls and triangles. It stops the regular animation loop to avoid running an unattended battle. Reload or close the page after use. The optional `?team=24` sets ships per side.

Regression coverage includes swept segments crossing rotated/listing/sinking hulls, boundary corners, exported gun articulation, deferred inspection creation and per-ship material isolation. The full tests and `bun run build` are required; allow a longer test timeout when the machine is heavily loaded.
