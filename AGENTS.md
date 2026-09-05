# Working on this game

Read `README.md` and `docs/ship-pipeline.md` before changing ships or combat. The accepted direction is one versioned blueprint/definition format for historical presets and future player-built ships.

- Keep original model sources, recipes, source registers, reference images and reports under `assets/`. The Bismarck baseline is preserved under `assets/ships/bismarck/baseline/`.
- Ship authoring starts with the blueprint and component catalog. Generated Blender/GLB files are build outputs; record durable changes in the recipe or a versioned original component asset.
- Use the shared pipeline (`ship:new`, `ship:compile`, `ship:build`, `ship:check`, `ship:review`). Discover available Blender MCP tools for inspection and scripted authoring; use local Blender when MCP is unavailable and describe that accurately.
- Preserve stable assembly/joint/socket IDs and the documented coordinate conversion. Do not merge independent moving parts or remove pivot empties.
- Keep the simulation renderer-free. CPU simulation owns combat poses, firing, hits, modules and flooding; GPU ocean samples are visual-only.
- Do not claim historical accuracy from successful export checks. Record approximations and unresolved evidence in the ship's discrepancy register. GameModels3D is a comparison reference; keep our geometry and textures independently authored.
- Run relevant simulation tests and `bun run build`. Model changes additionally require `ship:build` and inspection of fixed review views and articulation in-game. Shared recipe changes require rebuilding affected assets.
- Extend the existing naval instrument styling for controls. Keep the ship and sea visible and make damage feedback inspectable.
