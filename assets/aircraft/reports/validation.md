# Aircraft validation — schematic rebuild

Reviewed 5 September 2026. All thirteen aircraft were rebuilt through **Blender MCP**, published at three detail levels and inspected in the repository's Three.js viewer. The final authoring hash is `a6c5b1fd623c6a92224f3295ab05b19bb2b4e58e51d3551b886315003bae4844`. Machine-readable quantities and evidence hashes are in [validation.json](validation.json).

## Shape and visual review

The retained three-view drawings were individually registered and measured into thirteen versioned shape files. They replace the first pass's shared silhouette parameters. The original [source register](../references/sources.json) identifies primary Navy/manufacturer sheets, credited published drawings and variant limitations. The previous recipe and overview sheets remain in [baseline-v1](../baseline-v1/).

The actual exported GLBs were independently projected over fixed reference datums in side and plan views. All 26 final overlays were inspected. The review corrected the Corsair's gull break and tail span, curved fin-root triangulation, type-specific cowling taper, Val wheel-fairing outline and Judy chin-radiator volume. The exported outer-wing stations differ from the retained sampled drawing stations by less than 0.030 m; that is a fit-to-reference observation, not an accuracy claim for the drawings or reconstructed cross sections. [Comparison index](schematic-comparisons.json) and [completed visual review](schematic-visual-review.md).

All six fixed review sheets were inspected: [quarter](quarter-sheet.jpg), [top](top-sheet.jpg), [side](side-sheet.jpg), [front](front-sheet.jpg), [rear](rear-sheet.jpg) and [articulated](articulated-sheet.jpg). Full-size images remain under each aircraft's `generated/review/`. Close views also checked transparent cockpit glazing, seat containment, open engine fronts, wing-root junctions, marking visibility and perforated SBD/Helldiver brakes. [Blender MCP viewport](blender-mcp-viewport.png).

## Export and runtime checks

| Detail | Triangles per aircraft | Color / roughness maps | Total GLBs for all 13 |
| --- | ---: | --- | ---: |
| LOD0 | 28,252–38,429 | 2048² / 512² | 15.35 MiB |
| LOD1 | 12,700–17,275 | 1024² / 256² | 7.52 MiB |
| LOD2 | 5,616–7,799 | 512² / 128² | 3.87 MiB |

- `mcp_author.py all --validate` completed all thirteen through the actual discovered MCP authoring tool and validated each aircraft immediately after export. Per-aircraft `authoring.json` and export reports bind the source, shapes, retained rasters, Blender file, textures, three GLBs and fixed views.
- The production `aircraft:check all` passes actual binary bounds, coordinate conversion, hierarchy, stable joint IDs, independently moving descendants, UVs, embedded textures, normals, strict LOD reduction and retained/runtime file checks.
- An [independent geometry audit](geometry-audit.json) checked all 39 files: **zero degenerate or near-zero triangles**, zero invalid normals and finite geometry/UVs. Opaque materials cull back faces; only glazing remains double-sided. Parametric poles and collapsed caps are removed, including after reduction and coordinate conversion.
- [Browser diagnostics](browser-articulation.json) record **39 successful model loads** with matching final source hashes. Propeller, flight-control and gear poses were exercised at every detail level, including the Val's fixed-gear exception and the dive bombers' separate upper/lower brakes. Actual canvas captures retain every LOD in neutral pose and all thirteen LOD0 articulated poses under [browser/](browser/). [Corsair browser view](browser-corsair.png). All thirteen browser quarter views were visually inspected, along with full SBD/Helldiver articulated views and six representative LOD0/LOD2 pairs. Silhouettes, glazing, markings, wheels and propellers remain legible at the lower level; expected small-tip faceting is visible at inspection zoom. These are canvas captures through Orca CLI, not full-page or mobile screenshots.
- A fresh Blender 5.2 background process independently rebuilt the Corsair with the same frozen recipe into `.build/aircraft/fallback-verification-v2`. All three resulting GLBs passed binary validation. [Fallback report](local-fallback-check.json). The retained MCP-authored files were not replaced by that check.
- `bun test --timeout 30000`: **197 passed, 0 failed, 12,482 assertions** across 28 files, including simulation and asset checks.
- `bun run build`: **passed**, including all existing ship checks, all aircraft checks, TypeScript and the production Vite build. The existing main game bundle still triggers Vite's 7000 kB chunk-size advisory. `git diff --check` passes.

## Scope and remaining approximations

These are prepared visual assets for later air-combat integration. The game does not spawn them on the carrier or run aircraft simulation. Wings remain extended; cockpit equipment, finish, small fittings and mechanism travel are simplified. Gear retraction is an inspection pose, and fleet-scale memory/performance still needs profiling during integration. Suggested 120/400 m LOD switches are metadata; the viewer selects them manually. The [discrepancy register](discrepancies.md) records the source/variant uncertainties, including the SBD-5/6 drawing used for the SBD-3's common airframe and the D4Y2-C drawing used for the inline Judy exterior.
