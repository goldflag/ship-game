# Bismarck — May 1941

An original, dimension-constrained exterior reconstruction with articulated main and secondary batteries and a simplified gameplay interior. The unchanged original Blender model, dimensions, notes and renders are in `baseline/`.

Build with `bun run ship:build bismarck`; render comparison views with `bun run ship:review bismarck`. Open `generated/source.blend` for Blender/MCP inspection. The pipeline no longer uses files outside this repository.

`blueprint.json` owns the interpreted hull station tables, ten gun mount placements, provisional handling, armor volumes, machinery, magazines and compartments. `build.py` retains the existing original superstructure and fitting recipes and uses the shared gun generator. The main turret placements and hull envelope remain constrained to the baseline. Secondary placement and gun housing details retain the original reconstruction's approximations.

Reveal the Blender collection `14 Simulation volumes` to inspect the authoring proxies. In the game, use **Inspect target** to see armor outlines, compartments, module condition and floodwater. AA mounts, rudders and propellers remain visual fittings in this milestone; main and secondary guns articulate and fire.

The internal layout, armor volumes, weapon performance and hydrostatic coefficients are provisional gameplay approximations. No historical interior accuracy claim is made. The GameModels3D discrepancy review is pending specific reference access/configuration. See [sources](references/sources.json), [open discrepancies](reports/discrepancies.md), and the [pipeline](../../../docs/ship-pipeline.md).
