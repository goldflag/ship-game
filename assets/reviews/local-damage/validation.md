# Validation — 2026-09-06

## Automated checks

- `bun run test --timeout 30000`: **611 passed, 0 failed**, 282,111 assertions across 84 files, 110.82 seconds. The extended per-test allowance covers the existing long flooding replays under concurrent rendering/build load.
- `bun run build`: passed, including ship/aircraft asset checks, TypeScript and the production Vite build. Vite retains a large-chunk warning for the approximately 11.7 MB preload bundle.
- `git diff --check`: passed.
- `bun scripts/diagnostics/local-damage.ts`: [isolated calibration](calibration.json), including diminishing structural damage, aperture overlap and finite fire fuel.

## Assets and loaded articulation

All ten presets were rebuilt through `ship:build` with local Blender; no Blender MCP was available. `ship:review` produced profile, plan, bow, stern and quarter views for every ship. All 50 fixed views were inspected in the [first fleet sheet](fixed-views/fleet-1.jpg) and [second fleet sheet](fixed-views/fleet-2.jpg). Exterior silhouettes and retained moving assemblies show no new geometry regressions from these simulation proxies.

The actual game loaded each rebuilt preset and checked both training limits, maximum elevation and maximum recoil. CPU and rendered gun muzzle positions agree within **2.75 mm**; torpedo sockets agree within **0.003 mm**. Every loaded content hash matches its export report. Full hashes and measurements are in [fleet-validation.json](fleet-validation.json) and [articulation.json](articulation.json).

| Ship | Content hash prefix | Gun error (mm) | Torpedo error (mm) |
| --- | --- | ---: | ---: |
| bismarck | `85df3663a0d6` | 2.1660 | 0.0000 |
| yamato | `a3d0c030bb1c` | 2.7461 | 0.0000 |
| baltimore | `a69bf8e180ac` | 1.3164 | 0.0000 |
| enterprise-cv6 | `25e2d2fa0abe` | 0.0323 | 0.0000 |
| type-viic | `8e44accca801` | 0.0015 | 0.0026 |
| liberty-cargo | `646a5d9ff837` | 0.0162 | 0.0000 |
| liberty-collier | `2d3d8cd5f09c` | 0.0095 | 0.0000 |
| victory-cargo | `8ca1159f172a` | 0.0162 | 0.0000 |
| flower-corvette | `369a429bb919` | 0.0026 | 0.0000 |
| fletcher | `b33a7820f949` | 0.6806 | 0.0005 |

## Live battle check

The development-only [browser fixture](../../../scripts/tests/local-damage-browser.ts) ran in the mounted WebGPU game with real React telemetry. Sixteen same-location shell contacts reduced target hull damage from 45.5 HP on the first hit to 0.0075 HP on the last, totaling 145 HP. It also ignited an engine room and gunhouse on each ship, verified fire/threat/fuel readings and the Focus crews action, and opened the target inspector. The fixture freezes motion to make these effects inspectable; it is not an FPS benchmark or normal ballistic duel.

- [Browser measurements](browser-review.json): crew-focus command accepted, fire status and threatened magazines present, support readings present, destroyed-section explanation present, no horizontal viewport overflow at 1085 × 836 CSS pixels, 192 active smoke particles within the existing bounded effects pools.
- [Exterior smoke](exterior.png), [structural inspection](inspection.png), [gunnery inspection](hud.png), and [fire controls](fire-hud.png) were visually inspected. The screenshots preserve the sea and ship with the inherited transparent instrument styling. The final small UI pass moved active fires to the top of Own damage control, updated the inspection legend and gave crew-focus buttons the existing transparent brass control styling. Those final presentation changes pass the production build; the captures precede that pass. A later repeated preview reload stalled during harbor loading, so no replacement captures are claimed.

The region capacities, combustible loads, generator/director placement and smoke outlets are declared gameplay approximations in each ship's discrepancy register. These export and gameplay checks do not establish historical accuracy. The breach-union estimate is bounded and becomes approximate after clustering or partial shoring; this is not mesh fracture or a fluid-dynamics solver.

## Independent review and master integration — 2026-09-06

A second reviewer (Claude) read the full implementation before publication. The shell accounting was traced by hand for depleted, partially depleted and fresh entry regions followed by interior equipment hits, delayed AP bursts and exit plates: actual hull HP per victim never exceeds one shell's ceiling, each region keeps one nominal ceiling per shell, and a depleted entry leaves the interior's opportunity intact. Fire fuel exhaustion, closed-boundary containment, magazine ignition, crew preemption and the generator/director fallbacks behave as documented. Two corrections were made:

- Incremental pressure-hull growth previously merged into the nearest existing breach even when that hole was on a different face many metres away, which would have slowly migrated a shell hole's position. It now widens only an opening within 0.1 m of its own location and otherwise records its own breach. A regression test covers this.
- Hit labels now keep "Destroyed" for destroyed equipment, adding "Through wreckage" as context, instead of replacing the outcome with a structural explanation.

Not changed, recorded for balance review: fixed generators sit low in their engine rooms with the shared immersion rule, so a partly flooded engine room removes electrical supply for every fixed pump on the ship. This is the intended dependency but it is a strong feedback loop; portable pumps remain independent.

Master `1e469d3e` (33 commits, including HMS King George V, AI levels, spawn planning, funnel smoke and HUD scaling) was merged. The five reference ships' comparison artifacts were stale after the merge and were regenerated with `ship:compare` using local Blender. King George V was added to the local-damage recipe (59 regions, two generators in boiler 1.1 and turbine 4 spaces, director in the port upper reserve space near the bridge) and rebuilt with `ship:build`; its discrepancy register carries the same estimate note. `bun run ship:check all` passes for all eleven presets.

- `bun run test --timeout 60000`: **674 passed, 1 failed** of 675 across 92 files. The failure is `BattleEnvironment.test.ts` ("weather drives live waves…"), which fails identically on a clean `origin/master` checkout because master's test fixture lacks the new funnel-smoke object; it is unrelated to this branch and left for master.
- `bun run build`: passed (eleven ship checks, aircraft checks, TypeScript, Vite). The large-chunk warning remains.
- Live game on the merged tree, HMS King George V as player against Bismarck (headed Chromium through Playwright, real React telemetry): loaded content hash `4c5915250aad…` matches the export report, muzzle error **1.74 mm** at both train limits with full elevation and recoil. Sixteen same-spot contacts tapered **45.5 → 0.007 HP** (145 HP total, matching the displayed Damage counter); crew focus accepted; boiler-room and A-turret fires with fuel and threatened-magazine readings; electrical supply 99% after fire damage to a generator; no horizontal overflow at 1280 × 800; 192 bounded smoke particles. See [kgv-merged-check.json](kgv-merged-check.json), [gunnery capture](kgv-hud.jpg), [target inspection](kgv-inspection.jpg), [exterior smoke](kgv-exterior.jpg) and the [King George V fixed views](fixed-views/king-george-v.jpg) rendered by `ship:review`.
- The browser fixture now opens the gunnery instrument through the fleet HUD, which master changed to mount that panel on demand.

Origin history was rewritten for the large-file cleanup (PR #54) while this branch was being reviewed, so the branch shares no ancestry with the new master. The reviewed content was re-applied onto the rewritten master as one patch. Under the new pipeline no review ZIPs or duplicate GLBs are produced and `public/ship-reference/` is not tracked. Regenerated Blender renders (fixed review views, thumbnails and comparison sheets) were pixel-compared with master's and master's bytes were kept wherever identical; only the runtime GLB/JSON pairs, blueprints, reports, source `.blend` files and changed JSON records carry new bytes.

On the re-applied tree (master `a9f528f6`): `bun run ship:check all` passes for all eleven presets, `bun run test --timeout 60000` passes **676 of 676** across 92 files (master's funnel-smoke fixture failure was fixed upstream in the meantime) and `bun run build` passes. The simulation, UI and asset content is identical to the tree exercised in the live King George V check above, apart from master's wind-driven smoke flag now also applied to room-fire smoke.
