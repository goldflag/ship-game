# Bismarck Baltic paint: integrated model review

This review covers the model rebuilt after integrating master `89fd9850380f5d836b7261b931f07b8128a0981d` into the paint/crest branch. Model content hash: `25429e7ad048aada681f0dc250d25f0a07bd93d7cc93f34c1e94692f2150052b`. The earlier [appearance/source review](../baltic-paint-1941/README.md) and its captures retain their original hashes from commit `eef61636b851192ff3f29d7fb42c18ab219e758b`.

Scope: Paint and UVs on the existing hull, deck and fixed upperworks. The merged inputs preserve master’s flagstaff/radar rigs and ballistic definitions. Generated conflicts were resolved by rebuilding both ships; no binary side or model hash was used as a substitute for a rebuild.

![Current model in the WebGPU development port](quarter.png)

| Required affected-model check | Result |
| --- | --- |
| Physical attachment | Pass: no new objects or geometry changes among all 18,529 original objects; paint uses existing faces. |
| Priority proportions | Hull, turret and bridge geometry, transforms, IDs and parents match the integrated master scene exactly. Existing historical uncertainties remain open. |
| Exposed weapon detail | Original weapon mechanisms and joint ownership match master. This change adds no weapon variant or placeholder mechanism. |
| Articulation and clearance | No changed geometry can create a new intersection. The current exported GLB passed the combined and independent-neighbor poses recorded below. |

[geometry.json](geometry.json) compares the generated source against the master scene retained from the base commit. [articulation.json](articulation.json) records 15 combined poses at train fractions −1, −0.43, 0, 0.57 and 1 and elevation fractions 0, 0.48 and 1, with partial/full recoil. Maximum CPU/rendered muzzle difference is 0.002168 m. [independent-neighbors.json](independent-neighbors.json) and [its image](independent-neighbors.png) record different allowed poses for neighboring mounts, with maximum difference 0.002167 m. These measurements do not certify pre-existing whole-ship collision clearance or close the historical gaps in the discrepancy register.

Both `ship:compile`, `ship:build` and `ship:review` commands passed. The five fixed views are retained in [generated/review](../../generated/review/). Local Blender 5.2 was used because no Blender MCP tools were exposed. Live review used Orca and the game’s WebGPU renderer on the exact model hash above.

The integrated seven-file simulation/rendering run passed **47 tests and 6,037 assertions**. `bun run build` passed all published ship/aircraft checks, TypeScript and production bundling. Commands, logs, image hashes and the GLB SHA-256 are in [manifest.json](manifest.json).
