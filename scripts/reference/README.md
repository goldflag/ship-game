# Raster reference and original-geometry review

Install the Python image dependency with `python3 -m pip install -r scripts/reference/requirements.txt`. Use the repository's Bun dependencies and local Blender (`BLENDER_BIN` override supported).

`bun run ship:reference <ship>` downloads the registered `gm-<vehicle>` source into ignored `.build/reference-cache/<ship>`, renders the per-ship capture plan, and indexes the raster pack. Only this command reads game vertices and attachment transforms. The reference importer assumes GameModels3D WoWS format 4 and its hull/component scheme; other providers need a separate isolated importer.

`bun run ship:compare <ship>` measures the published original GLB, renders it through the same cameras, and builds the portable comparison page and ZIP. `ship:build` calls this automatically when `modeling-spec.json` exists. `ship:check` verifies every retained and published artifact against its inputs.

`bun run ship:independence <ship>` temporarily moves the entire raw reference cache away and runs the real ship build, including comparisons. It restores the cache in `finally` and records the resulting model hash. Python authoring reads also reject raw model files, cache paths, the preserved Bismarck baseline and network connections. This audit is evidence about the recipe's actual inputs, not a security sandbox for arbitrary native Blender extensions.

For another historical vessel, begin with `ship:new`, author the source register and a reviewed `modeling-spec.json`, and provide `references/capture-plan.json`. Use Bismarck's specification as the schema example: principal acceptance targets, provenance groups, landmarks, probe rays, section frames, frame origin, historical raster registration and review captions are vessel data. The comparison layout expects the standard `starboard`, `port` and `top` camera IDs and a plan image with whole-sheet registration and separate crops. Do not reuse Bismarck's dimensions, frame offsets, room positions or registration for another ship. Its original exterior recipe remains vessel-specific; the compilation, capture, GLB measurement, protection probing, export and review machinery are shared.

The comparison stage reads raster images and reviewed parameters only. Never import game offsets, UVs, transforms or reconstructed game sections into a blueprint or production recipe. Preserve original historical images and their credits; tight build tolerances are not historical accuracy certificates.
