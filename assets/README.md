# Source assets

Original ship blueprints, geometry recipes and components belong here. Runtime exports live in `public/models`.

- [Ship pipeline](../docs/ship-pipeline.md)
- [Ship build and file layout](../docs/ship-build-reference.md)
- [Reusable gun catalog](parts/guns.json)
- [Carrier aircraft pipeline](aircraft/README.md)

Start a ship with `bun run ship:new <ship-id>`. Existing directories are never overwritten. Keep concise ship configuration, inspected primary-model links and lasting limitations in the ship README. Ship reports and reference archives are removed. Use ignored `.build/` for research downloads, logs and extra review captures; do not commit them elsewhere.
