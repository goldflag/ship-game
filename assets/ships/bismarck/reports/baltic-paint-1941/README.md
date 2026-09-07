# Bismarck Baltic paint review

Reviewed 7 September 2026. Model content hash: `22842aace5e10d3bd2d5b384a83252eb6a2751b5ecca56f922e30859f18ba288`.

The existing May 1941 equipment reconstruction now carries the requested March–May Baltic paint: three black/white hull bands, continuous black diagonals on fixed upperworks, dark ends and false waves, dark turret roofs, and both deck recognition banners. The paint is generated from original metric polygons in [paint-scheme.json](../../paint-scheme.json) by [paint.py](../../paint.py). Both are registered recipe inputs. The supplied drawing remains credited reference material; its pixels are never used in a game texture.

## Appearance and evidence

![Bismarck in the development port](quarter.png)

[Starboard](starboard.png), [port](port.png), [overhead](top.png), [bow banner](bow-deck.png) and [stern banner](stern-deck.png) are captures of the published GLB in the game's WebGPU renderer. Each has a JSON sidecar recording the exact model hash and camera in authoring coordinates. The five standard views and camera record are in [generated/review](../../generated/review/); those neutral Workbench views establish geometry, while the game captures establish the textured appearance.

The source is Manuel P. González López's credited March–May 1941 sheet, retained in [references/paint](../../references/paint/) and registered as `kb-baltic-user-reference`. Its [author's paint-scheme index](https://www.kbismarck.com/drawings.html) corroborates the dated Baltic scheme. Paint locations were interpreted at a uniform whole-ship scale, with roughly ±0.5 m placement uncertainty. RGB values are visual estimates. The unseen opposite side repeats the supplied profile pending separate dated evidence. This earlier paint on the retained equipment is not a claim about the Denmark Strait paint configuration. These limits remain open in the [discrepancy register](../discrepancies.md).

## Four affected-model checks

| Check | Result and retained evidence |
| --- | --- |
| Physical attachment | Pass for the change. Paint uses the existing faces; there are no decal meshes or new floating parts. [geometry.json](geometry.json) compares all 18,525 original objects and finds no vertex, topology, transform, parent or stable-ID changes. |
| Turret, bridge and bow proportions | Preserved exactly by the same geometry audit. Existing historical uncertainties remain unresolved; this finish does not certify the underlying reconstruction. |
| Exposed gun detail | Existing variant geometry and joint ownership are preserved. Articulated gun mechanisms retain their original finish; new side projections apply to fixed painted surfaces. |
| Articulation and clearance | No changed geometry can introduce a new intersection. The exact published GLB was exercised in-game at 15 combined poses, including intermediate angles and partial recoil, with maximum CPU/rendered muzzle difference 0.002168 m. Independently positioned neighboring mounts are recorded separately. This is a regression review of the paint change, not a new certification of all pre-existing clearances. |

[articulation.json](articulation.json) records train fractions −1, −0.43, 0, 0.57 and 1, each at elevation fractions 0, 0.48 and 1; intermediate elevation uses half recoil and the others use full recoil. Fractions are relative to each weapon's existing catalog limits. The existing joint tests also cover rest poses.

[independent-neighbors.json](independent-neighbors.json) records different allowed train/elevation/recoil poses for adjacent mounts, with maximum muzzle difference 0.002168 m; [the game capture](in-game-independent.png) shows that arrangement. [inspection.json](inspection.json) records selection of the forward battery deckhouse in Armor, Internals and return to Statistics with the exterior restored.

[battle.json](battle.json) records a custom battle against the same Bismarck definition: opponent gunfire, penetrations and ricochets, 96 rendered impact marks on the player and 108.166 m³ of flooding at the retained sample. Own-ship manual firing was not established in this capture; weapon simulation tests supply separate evidence. [return-to-port.json](return-to-port.json) confirms a fresh port state at tick zero, full integrity, zero water and no impact marks on the same model hash.

## Build and validation

No Blender MCP tool was exposed. Local Blender 5.2 built the source and exported model. `ship:compile bismarck`, `ship:build bismarck`, `ship:review bismarck`, the relevant simulation/rendering tests and the final `bun run build` passed. The latter checks the complete published ship and aircraft rosters, TypeScript and the production bundle.

The focused seven-file test run passed 47 tests with 6,001 assertions. The final exported-model/Yamato regression run passed 17 tests with 371 assertions after the associated Yamato rail correction. Exact command logs and file hashes are indexed by [manifest.json](manifest.json). The model retains 142 meshes, 441 primitives and 404,956 triangles; its two packed original paint images bring the GLB to 26,594,900 bytes.

[review-models.py](review-models.py) is the source-scene audit for both ship changes. It requires the task's ignored before-build snapshots under `.build/`; the resulting measured records are retained here and in the Yamato report. `baseline/` was not read by production authoring or modified.
