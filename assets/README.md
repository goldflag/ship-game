# Ship source assets

All original ship models, recipes and references belong here. Runtime exports live in `public/models`.

- [Pipeline and Blender MCP workflow](../docs/ship-pipeline.md)
- [Bismarck source](ships/bismarck/README.md)
- [Reusable gun catalog](parts/guns.json)

Start a new ship with `bun run ship:new <ship-id>`. Existing directories are never overwritten by the scaffolder. Referenced third-party art is retained for comparison and credited in each source register; it is not a runtime texture or geometry source.
