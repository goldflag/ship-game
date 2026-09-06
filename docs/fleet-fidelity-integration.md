# Fleet fidelity integration — 2026-09-05 Pacific

Integrates fidelity implementation `3def0ef` with master `d04f69e` in the fidelity worktree before advancing master. The original fidelity milestone is retained in [its authoring record](../assets/ships/fleet-fidelity/README.md); its hashes, live captures and test counts describe that earlier snapshot, not this merged export.

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
