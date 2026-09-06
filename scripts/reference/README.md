# Raster reference and original-geometry review

Install the Python image dependency with `python3 -m pip install -r scripts/reference/requirements.txt`. Use the repository's Bun dependencies and local Blender (`BLENDER_BIN` override supported).

`bun run ship:reference <ship>` downloads the registered `gm-<vehicle>` source into ignored `.build/reference-cache/<ship>`, renders the per-ship capture plan, and indexes the raster pack. Only this command reads game vertices and attachment transforms. The reference importer assumes GameModels3D WoWS format 4 and its hull/component scheme; other providers need a separate isolated importer.

`bun run ship:compare <ship>` measures the published original GLB, renders it through the same cameras, and builds the portable comparison page and ZIP. `ship:build` calls this automatically when `modeling-spec.json` exists. `ship:check` verifies every retained and published artifact against its inputs.

`bun run ship:independence <ship>` temporarily moves the entire raw reference cache away and runs the real ship build, including comparisons. It restores the cache in `finally` and records the resulting model hash. Python authoring reads also reject raw model files, cache paths, the preserved Bismarck baseline and network connections. This audit is evidence about the recipe's actual inputs, not a security sandbox for arbitrary native Blender extensions.

For another historical vessel, begin with `ship:new`, author the source register and a reviewed `modeling-spec.json`, and provide `references/capture-plan.json`. Use Bismarck's specification as the schema example: principal acceptance targets, provenance groups, landmarks, probe rays, section frames, frame origin, historical raster registration and review captions are vessel data. The comparison layout expects the standard `starboard`, `port` and `top` camera IDs and a plan image with whole-sheet registration and separate crops. Do not reuse Bismarck's dimensions, frame offsets, room positions or registration for another ship. Its original exterior recipe remains vessel-specific; the compilation, capture, GLB measurement, protection probing, export and review machinery are shared.

The comparison stage reads raster images and reviewed parameters only. Never import game offsets, UVs, transforms or reconstructed game sections into a blueprint or production recipe. Preserve original historical images and their credits; tight build tolerances are not historical accuracy certificates.

## Historical-only and before/after packs

Set `comparisonMode: "historical-before-after"` in a vessel's modeling specification when there is no registered GameModels3D raster pack. Yamato, Baltimore and Enterprise demonstrate this mode. Preserve the original blueprint/recipe/definition and neutral camera manifest under `reports/fidelity-01/before/` before editing. The pack rejects mismatched before/after camera hashes.

Specify `historicalRegistrations` as whole-sheet affine registrations (uniform pixels/metre, crop and original pixel origin), and `evidence` records with explicit `redistribute` flags. Only opted-in raster evidence is published. Restricted scans remain under assets with links and limitations in the review. Do not invent a continuous historical overlay when a split sheet or different configuration cannot support one.

`ship:compare` produces twelve matched views, historical overlays where supported, original hull/protection/room sections, exported dimensions/axes and CPU structural probes, a keyboard-operable review page and a portable ZIP below 100 MiB. It reuses the existing naval review styling. The input hash covers source references, the complete `reports/fidelity-01/` evidence folder, shared fidelity authoring helpers, recipes, catalog, discrepancy/specification records and structural collision code. Finish evidence reports/captures before the final comparison build; edits to those inputs deliberately invalidate the pack.

When `reports/fidelity-01/runtime/review.json` exists, the historical review validates every row's ship ID/content hash and includes its direct live-game PNGs and raw records. These are explicitly separate from neutral Blender renders. UI battery firing is distinguished from seeded CPU collision trajectories; canvas-only images omit the HTML HUD, and uncontrolled desktop frame readings are not performance certification. Restricted historical rasters still require an explicit redistribution opt-in; runtime screenshots do not relax that rule.

Open `/ship-reference/<ship-id>/index.html` explicitly in development. A bare directory URL can hit Vite's SPA fallback and show the game; port links and their HTTP regression use the explicit filename. Extracted ZIPs open directly with their included `index.html` and relative assets.

`ship:independence` still performs a complete production build with the raw game cache unavailable. Run independence tests serially because they move the shared reference cache. Bismarck retains its existing game-raster comparison mode and preserved baseline.
