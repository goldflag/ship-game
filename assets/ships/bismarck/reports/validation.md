# Bismarck implementation validation · 5 September 2026

Completed one independent 24 May 1941 iteration and the reusable reference/capture/comparison workflow in the `crinoid` worktree. The display draft is separately fixed at 9.33 m standard loading. The model is not certified historically accurate.

Model content hash: `6884ac0c339ca9e88662880a7886c66fa5bcc64c47d7f8b8bdf70c8a9b1c0039`.

| Check | Result |
| --- | --- |
| Original asset build | `ship:build bismarck` passed using local Blender 5.2. Blender MCP tools were not exposed. |
| Raw-cache independence | `ship:independence bismarck` passed the actual full build and comparison with `.build/reference-cache` unavailable. Cache restored afterward. Python authoring audit recorded only our definition, recipe and shared component code. See [independence record](independence.json) and [retained read audit](authoring-reads.json). |
| Export | 59,194 triangles, 64 meshes, 147 primitives; 1,425,652-byte GLB. All ten mount pivots and twenty barrel chains passed the common exported joint/socket checks. |
| Principal dimensions | Actual GLB hull intersections meet 250.50 m overall length, 241.55 m waterline length, 36 m maximum/waterline beam, 9.33 m draft and 15 m midship depth. Tight build tolerances verify these chosen targets, not the historical evidence. |
| Geometry and spaces | Hull: 806 triangles, zero degenerates and zero nonmanifold welded edges. All 39 compartment-envelope corners pass containment against the reconstructed hull. Six exported landmarks meet their reviewed tolerances. See [measurements](measurements.json). |
| Protection | 277 physical plates plus six legacy secondary gunhouse inspection volumes. Meaningful regressions cover bidirectional, sloping and moving plates; belt/backing/support/turtleback and spaced decks; shared seams; tick boundaries; internal versus exterior breaches; malformed surfaces; sight interception. |
| Simulation and project tests | `bun test`: **87 passed, 0 failed**, 3,996 assertions across 17 files. Includes deterministic combat, flooding, magazine/propulsion damage, exported articulation and other ship presets. |
| Production build | `bun run build` passed preset/evidence checks, TypeScript and Vite. Other presets were rebuilt because the shared blueprint compiler contributes to their content hashes. Their geometry recipes were not redesigned. |
| Fixed visual review | Inspected all five `ship:review` views and the 25-view authored contact sheet, with detailed profile/top comparisons against GameModels3D and the historical drawing. Model, source/camera hashes, sheets and archive are checked for staleness. |
| In-game review | Actual exported Bismarck inspected with WebGPU in port. Positive traverse/elevation/recoil pose visually confirmed; both traverse extremes checked through live CPU/render diagnostics. Maximum observed muzzle difference: 0.002166 m. Armor filtering/isolation, internal turbine selection, search reset on mode change, launch and return to port confirmed. See [browser checks](browser/checks.json), [exterior](browser/exterior.png) and [articulation](browser/articulation-positive.png). |
| Reference page | Matched source/own images load; historical top selection, opacity adjustment, structural-frame switching and perspective labeling work. At 390 × 844 the comparison pair stacks with no document overflow; desktop also has no document overflow. Additional screenshots timed out on hidden Orca tabs, including after attempted window restoration; those UI checks use live DOM/diagnostics. |
| Source boundary and originals | Review ZIP/runtime directories contain no raw `.model` or `.geometry` reference files. No Bismarck baseline file changed; no build reads the owner's original Blender file. No asset generation occurred in `starfish`. |

The [review page](../generated/comparison/index.html) and [standalone ZIP](../generated/comparison/bismarck-review.zip) include 25 matched views, reference/camera manifests, historical originals/crops, overlays, five hull/protection sections, dimensions, landmark deviations, source register, editable blueprint/specification, original Blender/catalog snapshot and GLB. The ZIP is approximately 93 MiB and works offline after extraction. **Reference review** in port opens the served copy at `/ship-reference/bismarck/`.

The new commands are `ship:reference`, `ship:compare` and `ship:independence`; ordinary `ship:build` and `ship:check` integrate the evidence stages. See [ship instructions](../README.md), [shared pipeline](../../../../docs/ship-pipeline.md) and [reference-stage setup](../../../../scripts/reference/README.md).

Original hull offsets and a measured full arrangement remain missing. Hull sections, gunhouse details, internal boundaries/capacities and small fittings are explicit reconstructions. The game reference retains its own proportions and unknown load datum. Read the [discrepancy register](discrepancies.md) and [source register](../references/sources.json) for specific evidence and limitations before treating this as an as-built historical model.
