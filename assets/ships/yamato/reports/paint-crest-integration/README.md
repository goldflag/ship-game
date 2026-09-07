# Yamato bow crest: integrated model review

This review covers the model rebuilt after integrating master `89fd9850380f5d836b7261b931f07b8128a0981d` into the paint/crest branch. Model content hash: `18e762f1354f7f5b2036b7fc94b4c149c6762b704b1df30a524de85f796bf7b5`. The earlier [appearance/source review](../bow-crest/README.md) and its captures retain their original hashes from commit `eef61636b851192ff3f29d7fb42c18ab219e758b`.

Scope: The bow-crest and bow-crest-support assemblies, plus forepeak rail termination. The merged inputs preserve master’s flagstaff/radar rigs and ballistic definitions. Generated conflicts were resolved by rebuilding both ships; no binary side or model hash was used as a substitute for a rebuild.

![Current model in the WebGPU development port](in-game-crest-quarter.png)

| Required affected-model check | Result |
| --- | --- |
| Physical attachment | Pass: closed positive-volume petals overlap the backing; five contact probes confirm seating on the curved bulwark, which meets the existing deck. |
| Priority proportions | Crest diameter is 1.000 m in both axes. The existing hull, bridge and turret geometry match master; only forepeak rail objects are changed or removed. Historical mounting/bulwark interpretations remain unresolved. |
| Exposed weapon detail | Original weapon mechanisms and joint ownership match master. This change adds no weapon variant or placeholder mechanism. |
| Articulation and clearance | Pass for the added fittings: conservative enclosing spheres prove at least 47.695 m separation from every registered gun mount through arbitrary yaw, independent elevation and full recoil. Current in-game poses also pass. |

[geometry.json](geometry.json) compares the generated source against the master scene retained from the base commit. [articulation.json](articulation.json) records 15 combined poses at train fractions −1, −0.43, 0, 0.57 and 1 and elevation fractions 0, 0.48 and 1, with partial/full recoil. Maximum CPU/rendered muzzle difference is 0.002748 m. [independent-neighbors.json](independent-neighbors.json) and [its image](independent-neighbors.png) record different allowed poses for neighboring mounts, with maximum difference 0.002744 m. These measurements do not certify pre-existing whole-ship collision clearance or close the historical gaps in the discrepancy register.

Both `ship:compile`, `ship:build` and `ship:review` commands passed. The five fixed views are retained in [generated/review](../../generated/review/). Local Blender 5.2 was used because no Blender MCP tools were exposed. Live review used Orca and the game’s WebGPU renderer on the exact model hash above.

The integrated seven-file simulation/rendering run passed **47 tests and 6,037 assertions**. `bun run build` passed all published ship/aircraft checks, TypeScript and production bundling. Commands, logs, image hashes and the GLB SHA-256 are in [manifest.json](manifest.json).

The final exported-hull audit also passes all six documented dimensions. [Front](crest-front.png), [quarter](crest-quarter.png) and [side](crest-side.png) studio views were rendered from this GLB with [the retained recipe](render-closeups.py).
