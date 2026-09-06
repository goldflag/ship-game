# Fletcher validation — revision 4

The current turret and propeller correction is documented in [components.md](components.md). The hull/superstructure correction remains recorded in [shape-correction.md](shape-correction.md); revision 3 reports are preserved in `../baseline/revision-3/reports/`.

- `ship:build fletcher`, `ship:check fletcher`, `ship:review fletcher`: passed.
- Model `76f1404e1846501996245cade4b0c6081c1c4bbfdf21ea20eeadaaece516a918`: 302,822 triangles, 86 meshes, 12,572,908 bytes.
- All five fixed review views and seventeen matched views inspected.
- `bun test --timeout 15000`: 297 pass, zero failures, 34,346 assertions. See [tests.txt](tests.txt).
- `bun run build`: passed all six ship checks, aircraft checks, TypeScript and Vite. See [production-build.txt](production-build.txt).
- Actual loaded GLB: 18 gun/torpedo poses, ten torpedo launches/hits, eight depth-charge launches/blasts. See [runtime summary](runtime-review/summary.json).
- Turret elevation closeups and paired axial propeller pivot checks: [component runtime record](runtime-review/component-closeups.json). Propeller views isolate submerged parts; the scene is restored afterward.
- Six closed positive-volume blade solids and sampled barrel/enclosure clearance: [geometry checks](component-geometry-check.json).
- Authoring read guard: [authoring-reads.json](authoring-reads.json). No reference cache or external geometry is read by the authoring recipe.

Local Blender 5.2; no Blender MCP tools available. Orca completed the first articulation check and neutral screenshot before the final metadata update. The tab subsequently became unavailable, so remaining capture used fresh isolated Chromium 151 / WebGPU. No browser page errors. Exact historical dimensions, pitch distribution and outfit remain qualified in the discrepancy register.
