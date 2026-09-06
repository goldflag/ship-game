# Fleet fidelity integration — 2026-09-05 Pacific

Integrates fidelity implementation `3def0ef` with successive master checkpoints in the fidelity worktree before advancing master. The original fidelity milestone is retained in [its authoring record](../assets/ships/fleet-fidelity/README.md); its hashes, live captures and test counts describe that earlier snapshot, not subsequent merged exports.

## Conflict decisions

- Preserve master's fourth Bismarck detail pass, transverse armor fit and independent secondary gunhouse facets. The original Bismarck baseline is unchanged.
- Preserve the surfaced Type VIIC preset, torpedoes, statistics and bot acquisition, along with master's imperfect/delayed bot aiming, impact rendering, shell-follow behavior and shared inspection hover.
- Preserve the three fidelity blueprints, independently authored equipment and renderer-free structural collision improvements. Rebuild all five presets because the merged shared schema and export inputs changed.
- Keep both Yamato damage regressions: explicitly frozen legacy geometry for the magazine damage budget, and current geometry for damaging but dry above-water strikes. Accurately aimed player fire at an idle target isolates damage from the newer intentionally imperfect bot controller.
- Publish reference links only for the four actual review packs; Type VIIC does not yet have one.
- Preserve original runtime evidence with an explicitly registered reviewed hash. The regenerated pages visibly distinguish those historical captures from the new export; earlier runs are not silently certified under a different hash.
- Remove trailing whitespace in the original export script and bundled font licenses before rebuilding their generated copies. License wording is unchanged.

## Validated integration checkpoint: master d04f69e

Master advanced to `22ee7b2` while this checkpoint was being validated, adding the damage-realism integration and proportional port camera. The results below apply to `d04f69e` plus fleet fidelity; they do not certify the subsequent integration.

- `bun test --timeout 20000`: **303 passed, 0 failed, 33,242 assertions across 41 files**. An earlier run overlapped Type VIIC asset publication and caught two version mismatches; both the focused ship-switch suite and complete suite passed after all five assets finished publishing, without weakening the version checks.
- `bun run build`: five ship/evidence checks, all aircraft checks, TypeScript and production bundling passed. The existing large-bundle advisory remains.
- All five `ship:build` and `ship:review` runs passed; Yamato, Baltimore and Enterprise used full cache-independent rebuilds. Their dimensional audits and Yamato's component audit also passed.
- Visually inspected all five fixed-view contact sheets. The three fidelity ships retain their prior geometry counts; Bismarck retains master's fourth-iteration geometry and Type VIIC its surfaced submarine geometry. These [contact sheets](../assets/reviews/fleet-integration/) carry the checkpoint hashes below and preserve the earlier milestone's images.
- Four portable archives passed CRC, individual-file size and historical redistribution checks. ZIP bytes: Yamato 45,964,115; Baltimore 40,268,174; Enterprise 43,526,348; Bismarck 104,306,998 (99.47 MiB, close to the 100 MiB limit).
- WebGPU loaded the new Bismarck hash in port, tick 0, with a 2.161 mm muzzle discrepancy. The additional five-preset articulation sweep lost its Orca connection; no completed sweep or new battle review is claimed for this checkpoint. Earlier completed live trials retain their own original hashes.
- No unresolved merge paths remained. Whitespace checks relative to the integrated master passed. Raw Type VIIC HTML references inherited from master retain their original whitespace.

| Preset | Checkpoint content hash | Triangles | GLB bytes |
| --- | --- | ---: | ---: |
| Bismarck | `4ac65c704256b0b3473887b4d377cfe13cf2e06e1cc11685eea8a8669bb80a22` | 368,428 | 21,897,784 |
| Yamato | `dbb974b5b53a372340a739cc5dc79c5230540720328cacbc8de61ccadb624933` | 264,906 | 11,623,044 |
| Baltimore | `92a035d25954da79bdd212a7aef2b19770d661362abc255f83a151a3116e0461` | 260,522 | 8,587,524 |
| Enterprise CV-6 | `5449db2f2a955b2eb33ef52a4ee32ece530a65528db760007f37fcc016522c68` | 206,818 | 7,512,012 |
| Type VIIC | `010f58b8ad5a443b63caf110d533ce521ef753efda3ff6972788db5b05530644` | 23,486 | 1,477,376 |

Local Blender 5.2.0 LTS is used. Export success establishes dimensional, hierarchy and freshness consistency, not historical accuracy; each vessel's discrepancy register still applies.

## Damage-model integration: master 22ee7b2

The preceding checkpoint was committed as `31a84b5`. The next integration preserves master's local AP/HE damage, finite ammunition, crew repair, explicit machinery roles, closed watertight boundaries, compound flood spaces, finite-angle hydrostatics and condition-derived loss rules. Empty plating impacts consume penetration without manufacturing equipment damage. Above-water hull holes remain available for later immersion but stay dry; deckhouse strikes do not create sea openings.

The versioned one-time recipe `assets/ships/fleet-fidelity/integrate-damage.ts` combines the retained original geometry/IDs with the incoming ballistics, equipment and boundary data. Existing flood-space and stability recipes regenerate dependent regions against the revised hulls and rooms. Bismarck's blueprint/exterior recipe and Type VIIC's blueprint match the integrated master; the Bismarck baseline remains untouched.

| Preset | Named rooms retained | Total flood spaces | Closed connections | Buoyancy regions |
| --- | ---: | ---: | ---: | ---: |
| Yamato | 27 | 195 | 440 | 174 |
| Baltimore | 10 | 120 | 255 | 142 |
| Enterprise CV-6 | 8 | 135 | 261 | 153 |

Yamato's four turbine equipment envelopes supply four equal combined-drive groups. Twelve boiler-room envelopes do not imply twelve separately damageable boiler modules; steam supply and shafts remain aggregated. The discrepancy registers qualify that approximation and all regenerated capacities, loading and mass distribution. These are not recovered historical damage-control or stability plans.

### Integration regressions

- Baltimore's first full build exported successfully but failed the independent space-clearance measurement: eight-decimal cell serialization placed forty terminal corners about five nanometres beyond the hull station. A targeted regression failed before the fix. The measurement now clamps only 0.1-micrometre endpoint drift and still rejects a real ten-micrometre overhang. Both regression tests (7,716 assertions), the original measurement and a fresh full Baltimore build pass. No hull/room geometry or ordinary clearance allowance was changed. Boundary-focused serialized-data tests would have prevented this numerical false rejection.
- The first complete test run had 397 passes and one Yamato flooding timeout during concurrent rendering. Running the case alone exposed its obsolete shot station: `z=5` crosses boiler rooms, not the retained forward turbines at `z=34`. The fixture now derives the turbine station from its stable room ID. Its ten simulated minutes pass six assertions: damaged boundaries reach both forward rooms, both receive water, and both undamaged aft rooms remain dry. No production flooding rule was weakened. ID-relative test deployments avoid stale absolute coordinates after authoring changes.
- Legacy and current Yamato salvo regressions remain separate; current structural-hit tests require local penetration evidence, dry above-water holes and intact empty-structure equipment condition. Historical runtime logs retain their originally reviewed hashes.

### Current asset evidence

All five full ship builds and fixed reviews pass, including Baltimore's post-fix rebuild. All four comparison packs are regenerated; section drawings depict individual compound cells rather than their enclosing bounding boxes. The three dimensional audits and Yamato component audit pass. All five new [fixed-view contact sheets](../assets/reviews/fleet-integration/damage-integration/) were visually inspected, preserving the previous checkpoint images. Geometry counts and GLB sizes are unchanged from the table above; shared damage metadata changes the content hashes below.

| Preset | Damage-integration content hash |
| --- | --- |
| Bismarck | `0f7119971b043e76bfed1f972912c36593ab1e72198b65c1820ed49e7392a558` |
| Yamato | `b0bed026943cfd57d1dfc133c6d6703dfbf1ed477ec95cc83cf54b0ba8651aa4` |
| Baltimore | `161a0051b7b1cf58ba13baaabaa7c518efdfdb743cf5ff3efac262acf65c8154` |
| Enterprise CV-6 | `ef914897ea8fdf958676af212c4e32b83d3f78ea1cbac1a46f22d620ce994094` |
| Type VIIC | `2d15f3220ddd6d8456cbd80f79076f5c5905a928eb2473c94e7a70aa90425667` |

All four ZIP CRC, individual-file size and historical redistribution checks pass. Archive bytes: Yamato 46,054,640; Baltimore 40,335,109; Enterprise 43,609,194; Bismarck 104,382,302 (99.55 MiB, still close to the 100 MiB limit).

`bun test --timeout 60000`: **398 passed, 0 failed, 166,718 assertions across 51 files** after all models finished publishing. `bun run build` passes all five ship/evidence checks, all thirteen aircraft checks, TypeScript and production bundling. The existing large-bundle advisory remains. Command logs are retained under `.build/fleet-fidelity/merge-damage/verified-*.log`.

The [geometry continuity audit](../assets/reviews/fleet-integration/damage-integration/geometry-continuity.json) compares each final GLB with `31a84b5`: all five binary chunks are identical, and every JSON field is identical except the scene's definition-hash metadata. This checks meshes, materials, hierarchy, sockets and transforms, not just counts. New CPU damage definitions are covered by the current tests above.

At this checkpoint, twelve-frame-stepped WebGPU articulation checks completed for Bismarck and Yamato at the new hashes (maximum discrepancies 2.167 mm and 2.747 mm). A native Baltimore port screenshot was inspected with the new 120-space data visible. An extra forced-canvas capture hit a WebGPU texture-initialization error; subsequent Orca connections dropped and the game tab closed. No successful forced capture, Baltimore articulation sweep, or new mixed battle is claimed here. An HMR-stale helper returned a duplicate Yamato record during a Baltimore attempt; that incorrectly named temporary output was discarded, not certified as Baltimore evidence. Original completed trials retain their original hashes and scope.

## HUD/optics checkpoint: master 43662ad

The damage integration was committed as `71d71c5`. Master's two later committed HUD/optics updates merge cleanly: 16×/24× binocular settings and current/maximum equipment-derived HP display are retained. This does not restore universal hull-HP sinking. No asset inputs change.

The complete suite passes again: **398 tests, 0 failures, 166,728 assertions across 51 files**, using `bun test --timeout 60000`. The full production build passes five ship/evidence checks, thirteen aircraft checks, TypeScript and bundling; the existing bundle-size advisory remains. Logs are `.build/fleet-fidelity/merge-damage/latest-*.log`.

After restarting only this worktree's preview server to clear its stale public-JSON HMR state and opening a fresh game tab, twelve loaded-game joint combinations pass for Baltimore (maximum discrepancy 1.317 mm), Enterprise (0.0324 mm) and Type VIIC (0.0020 mm). These follow-ups explicitly check synchronous mounted transforms; they do not claim a rendered frame between every pose. Each JSON identifies the current export and this method separately from the frame-stepped Bismarck/Yamato checks. All five current exports therefore have loaded-game joint evidence, with the review methods qualified individually.

## Camera/knockout checkpoint: master 1cf301c

The HUD/optics checkpoint was committed as `edd4231`. Master then committed its pending work and became clean. Both newer commits merge without conflicts: `67f5fc3` makes direct AP equipment hits spend one shared 75%-nominal-damage budget and latches permanent primary-armament knockout; `1cf301c` retains ship-focused port elevation limits, reversed floating-point depth, sky/cirrus depth compatibility and impact marks behind transparent smoke.

The 42 focused battle, fleet-structure, score and knockout tests pass without further changes to the fidelity damage fixtures (15,081 assertions). No definitions, geometry, recipes or comparison inputs changed, so another model rebuild is unnecessary. The merged pipeline documentation now correctly describes the current/maximum HP display. The incoming knockout balance measurements retain their original definitions and are not presented as new timing measurements on the fidelity fleet.

A fresh WebGPU Type VIIC port instance after the depth change loads its current hash at tick 0, with maximum traverse/elevation/recoil preview error 0.00194 mm. No additional live mixed-battle or controlled performance result is claimed for this integration.

`bun test --timeout 60000` passes **405 tests, 0 failures, 166,800 assertions across 52 files**. The complete production build passes all five ship/evidence checks, thirteen aircraft checks, TypeScript and bundling. Logs are `.build/fleet-fidelity/merge-damage/final-master-*.log`. The additional Type VIIC native screenshot still shows the loading screen, so it is retained as a loading-state capture, not visual acceptance of the depth change.

## Landing with master eccd076

The tested fleet branch (`0b2fc35`) merges cleanly into master `eccd076`, retaining its subsequent disabled-turret and ocean-scale changes. All surviving guns and torpedoes count toward fighting strength again; main-battery loss alone does not silence secondaries. Disabled train/elevation stop at their authoritative angles while hull motion and recoil remain independent. The AP path budget remains 75%. The shorter/lower visual ocean spectrum and dirty-spectrum refresh are retained without feeding GPU waves into simulation. The preceding primary-knockout observations describe their checkpoint, not these final rules.

No additional ship asset inputs change in this landing. The existing per-hash asset checks and qualified joint evidence remain applicable; combined-tree verification is run after committing the local merge. No push is part of this task.
