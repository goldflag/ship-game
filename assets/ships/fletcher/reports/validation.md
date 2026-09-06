# Fletcher validation — revision 4

The current turret and propeller correction is documented in [components.md](components.md). The hull/superstructure correction remains recorded in [shape-correction.md](shape-correction.md); revision 3 reports are preserved in `../baseline/revision-3/reports/`.

- `ship:build fletcher`, `ship:check fletcher`, `ship:review fletcher`: passed.
- Model `21547dc10500b4bf4ce24f8709a5276f6db3f05958261afedcd6f1f5914ea62e`: 302,822 triangles, 86 meshes, 12,572,908 bytes.
- All five fixed review views and seventeen matched views inspected.
- All twelve retained ship assets were rebuilt through the shared pipeline after integrating master, including the ten playable presets and two retired convoy aliases.
- `bun test --timeout 60000`: 514 pass, zero failures, 231,219 assertions across 63 files. See [merge-tests.txt](merge-tests.txt). The earlier geometry-authoring test record remains in [tests.txt](tests.txt).
- `bun run typecheck`: passed. `bun run build`: passed all ten playable ship checks, aircraft checks, TypeScript and Vite. See [production-build.txt](production-build.txt). Vite reported its existing large-chunk advisory.
- Actual loaded GLB: 18 gun/torpedo poses, ten torpedo launches/hits, eight depth-charge launches/blasts. See [runtime summary](runtime-review/summary.json).
- Turret elevation closeups and paired axial propeller pivot checks: [component runtime record](runtime-review/component-closeups.json). Propeller views isolate submerged parts; the scene is restored afterward.
- Six closed positive-volume blade solids and sampled barrel/enclosure clearance: [geometry checks](component-geometry-check.json).
- Authoring read guard: [authoring-reads.json](authoring-reads.json). No reference cache or external geometry is read by the authoring recipe.

Local Blender 5.2; no Blender MCP tools available. Orca completed an earlier articulation check before its embedded tab became unavailable. The final integrated model and combat code were reviewed using fresh isolated Chromium 151 / WebGPU. No browser page errors. Exact historical dimensions, pitch distribution and outfit remain qualified in the discrepancy register. See [merge-validation.md](merge-validation.md) for the integration behavior.
