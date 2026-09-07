# Yamato bow ornament review

Reviewed 7 September 2026. Final model content hash: `b32c7aeedcf0fbacc2314d51a1030deee640e551686bcab15ea71ad16ac76c24`.

The original [build recipe](../../build.py) now constructs a forward-facing gold chrysanthemum with sixteen raised petals, sixteen recessed tips and a central boss. A seated backing connects it to a solid curved bow bulwark, whose bottom overlaps the forecastle deck. The original open guard wires terminate inside the bulwark returns. The stable new assembly IDs are `bow-crest` and `bow-crest-support`.

## Appearance and historical basis

![The bow crest in the game's WebGPU renderer](in-game-crest-quarter.png)

[In-game front](in-game-crest-front.png), [studio front](crest-front.png), [studio quarter](crest-quarter.png) and [studio side](crest-side.png) show the exact final GLB. The studio views use local Blender 5.2 / Cycles through [render-closeups.py](render-closeups.py); [cameras.json](cameras.json) records their hash and imported coordinate convention. The standard five views are in [generated/review](../../generated/review/).

The 1 m diameter follows Kure City's April 2026 newsletter, printed page 5, which describes the museum's correction from 1.5 m using the 2016 underwater survey. This is registered as `kure-crest-survey-correction`, with the [official PDF URL](https://www.city.kure.lg.jp/uploaded/attachment/108945.pdf). The web reader returned its text; direct PDF/screenshot retrieval failed, as recorded in the source register.

The retained [museum bow photograph](../../references/museum-bow-crest.jpg) supports the forward-facing placement and curved support qualitatively; the older museum ornament's superseded size was not used. The [preserved Mikasa crest photograph](../../references/mikasa-crest-detail.jpg) supplies qualitative relief evidence, not Yamato dimensions. Petal depth, local bulwark contours and attachment offsets remain photographic interpretations, with no original mounting drawing available. See the [source register](../../references/sources.json) and [open discrepancies](../discrepancies.md).

## Four affected-model checks

| Check | Result and retained evidence |
| --- | --- |
| Physical attachment | Pass. [geometry.json](geometry.json) records five backing-to-bulwark contact probes. All sixteen front petals are closed solids with outward winding and positive volume; their roots overlap the backing. The solid bulwark enters the existing deck and its rolled lip follows its top edge. Front, side and quarter views confirm seating. |
| Turret, bridge and bow proportions | The existing hull surface, bridge, turrets and all non-rail original geometry/transforms are preserved. The crest measures exactly 1.000 m across both axes. The six published-GLB hull dimensions pass [the dimensional audit](../dimensions.json). Local bulwark shape and mounting details remain unresolved historical interpretations, not a 100% accuracy claim. |
| Exposed gun detail | Original mechanisms, geometry, assembly ownership, pivots and muzzle sockets are unchanged. No new weapon variant is introduced. Existing weapon-detail uncertainties stay in the discrepancy register. |
| Articulation and clearance | Pass for the added fittings. Conservative enclosing spheres over every added support/ornament vertex and every registered moving mount prove at least 47.695 m separation, including arbitrary independent yaw, elevation and full recoil. The exact GLB also passed 15 in-game combined poses and a separate independent-neighbor arrangement. This does not certify every pre-existing gun-to-ship clearance. |

[articulation.json](articulation.json) records train fractions −1, −0.43, 0, 0.57 and 1 at elevation fractions 0, 0.48 and 1. Intermediate elevation uses half recoil and the others full recoil. Maximum CPU/rendered muzzle difference was 0.002749 m. [independent-neighbors.json](independent-neighbors.json) records each mount's different allowed train/elevation/recoil pose, with maximum difference 0.002744 m; [the game capture](in-game-independent.png) retains the resulting arrangement. [inspection.json](inspection.json) records Armor, Internals and return to Statistics on the final hash.

The audit compares 10,183 original scene objects by name. Only the forepeak rail family is changed or removed; changed/renumbered rail names are listed rather than silently ignored. It finds 51 new ornament/support objects. All other original vertex coordinates, topology, transforms, parents and IDs match the before-build source.

## Build and validation

No Blender MCP tool was exposed; local Blender 5.2 was used. `ship:compile yamato`, `ship:build yamato`, `ship:review yamato`, `bun assets/ships/yamato/check-dimensions.ts` and the final `bun run build` passed. The latter checks the complete ship/aircraft rosters, TypeScript and production bundling. Logs and file hashes are indexed by [manifest.json](manifest.json).

The seven-file simulation/rendering test run passed 47 tests with 6,001 assertions. After correcting the forepeak rail termination, the final exported-model and Yamato simulation tests passed 17 tests with 371 assertions. The final GLB has 150 meshes, 400 primitives, 283,214 triangles and 12,104,764 bytes.

The [first-pass](first-pass/) evidence deliberately retains its earlier hash `75aa0a83fe9a59e29767e908437e16614c455b1026d4d7cca7586cd6384a808f`. That version had guard wires crossing the ornament support; it is superseded by the final recipe and review above.
