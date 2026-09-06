# Ship pipeline and combat validation — 2026-09-05

Latest: [fleet fidelity / five-preset master integration](fleet-fidelity-integration.md). The dated milestones below retain their original hashes, test totals and review scope.

The implemented milestone is a local ship asset pipeline and singleplayer gunnery/damage trial. Historical accuracy approval, a construction UI and networked PvP are separate future milestones.

## Asset evidence

- Bismarck build hash: `bf448cc42b37a2e7b6ce512db4338842858f33c352152ca2ff2dfb59bd2d4b96`.
- Local Blender 5.2 built and exported the retained original recipe. Blender MCP was not exposed in this session; no MCP operation is claimed.
- Export validation passed for a 250.5 m length, 36 m beam and 9.33 m draft, ten mount pivots, and twenty muzzle sockets at three angular configurations each.
- Runtime export: 164,322 triangles, 50 meshes, 148 primitives, 7,302,940 bytes. See the [machine report](../assets/ships/bismarck/reports/export.json).
- The five [orthographic review images](../assets/ships/bismarck/generated/review/) were rendered and visually inspected. Camera settings and the matching build hash are stored alongside them. Profile and end views fit the complete model height.
- `ship:new pipeline-smoke` followed by `ship:build pipeline-smoke` successfully produced a separate original starter: 100 m × 14 m hull, one articulated twin mount, 1,800 triangles. Temporary starter assets were then removed; the reusable scaffolder and recipe remain.
- Original baseline Blender source, generator scripts, dimensional notes, reference images and renders are retained in `assets/ships/bismarck/`.

## Behavior evidence

`bun run test`: **21 passed, 0 failed, 70 assertions**. Tests exercise blueprint validation/reuse, movement, ballistic aiming, swept collisions, armor before modules, conserved flood transfer, ammunition/reload, propulsion failures, magazine detonation and mount disablement, sinking/reset, and identical combat outcomes at 30/60/144 input frames per second.

The renderer adapter regression loads the actual exported joint hierarchy. It reproduces and guards against a rear-turret bug caused by retaining alternate Euler axes from an imported 180-degree quaternion. Complete joint rotation replacement keeps simulation and renderer muzzles aligned through traverse, elevation, ship pose and recoil. The live browser diagnostic measured a maximum error of approximately 0.00212 m, below the 0.025 m export tolerance.

`bun run build` passed the compiled-definition/GLB check, TypeScript validation and Vite production build. The final additional test cases also passed TypeScript validation.

Live browser controls fired both batteries, changed the battery, reset the target and entered/exited target inspection. A main salvo reduced target integrity to 77.6%, disabled both machinery modules and initiated flooding. A secondary salvo consumed ammunition in four clear mounts while two obstructed mounts remained blocked; the citadel stopped those shells before machinery damage. These observations validate the current gameplay rules, not historical weapon performance.

## Interface review

Reviewer disposition: **fix**. The remaining item is visual confirmation; no additional code defect was identified from the available evidence.

| Prior finding | Final status | Evidence |
| --- | --- | --- |
| Instrument overlaps | Resolved | Desktop capture separates gunnery, chart and camera controls. At 390 × 844, live DOM puts the expanded panel bottom at 412 px, camera controls at 516–554 px and helm below 583 px. |
| Mobile ship visibility and inspection | Partial | Live behavior confirms collapse to 154–272 px during inspection and suppresses the sailing hint. Fresh mobile pixel confirmation remains pending. |
| Collapse discoverability | Resolved | Desktop capture shows the rotating disclosure chevron; mobile DOM confirms a 44 px toggle target. |

Both viewport and full-page browser captures repeatedly timed out during the final mobile pass. Orca subsequently reported no visible desktop window. Earlier desktop captures and live DOM/interaction checks succeeded. Repeat visual inspection of the expanded and inspecting states at 390 × 844 when the preview can be captured.

The UI detector also recorded an inherited loading-bar width transition; this milestone did not change that animation. Durable controls and responsive behavior are recorded in [DESIGN.md](../DESIGN.md).

## Accuracy still open

No War Thunder or World of Warships ship geometry was imported or copied. Comparison against the user's specific GameModels3D references remains pending. The exterior retains the original reconstruction's approximations; armor, internals, penetration and hydrostatics remain provisional gameplay data. Track outstanding accuracy work in the [discrepancy register](../assets/ships/bismarck/reports/discrepancies.md).

## Master integration and port inspection — 2026-09-05

The worktree was fast-forwarded to master/origin/master `577b4a9` (ship schematic preview and image export), then the existing asset pipeline, authored ships and combat work were restored. Merge conflicts were resolved; the pre-integration stash was retained as a backup. Fleet harbor, the compact Fleet action HUD, ocean configuration, wake effects and schematic export remain integrated.

- `bun run test`: **37 passed, 0 failed, 227 assertions** across eight files. Added checks cover the registered presets' inspection data, selected-volume isolation and clearing, moving gunhouse orientation, non-mutating inspection and full trial reset without breaking renderer bindings. The integrated suite also retains movement, combat and schematic projection tests.
- `bun run build`: passed asset checks, TypeScript and Vite production build. `git diff --check` passed, with no unresolved merge paths.
- Live port checks at **1440 × 900** and **390 × 844** exercised Exterior, Armor and Internals, isolated the citadel and port machinery, and verified scrollable lists with pinned selection details. Diagnostics retained `tick: 0` in port and reported the selected volume ID. All-space and selected-space overlays were visually inspected.
- Launching restored the exterior and advanced combat. A live main-battery shot consumed ammunition in the ready fore mounts, reduced target integrity to **88.8%**, disabled both machinery modules and initiated flooding. Target inspection rendered correctly at desktop and mobile sizes. Returning to port restored `tick: 0`, Exterior mode and a fresh trial.
- The schematic preview generated a **2560 × 1440** image with the correct bow/stern, starboard profile and deck orientation for the pipeline's -Z bow convention. Its dimensions measure the complete rendered model, including protruding fittings, rather than just the compiled hull envelope.

Captures and command logs are retained locally under `.build/master-integration/`. This pass obtained the mobile pixel evidence unavailable during the earlier interface review; those earlier capture limitations apply to the pre-master HUD, not the integrated port and trial captured here. Armor and internal layouts remain provisional as described in the accuracy section above.

Interface layout review disposition: **ship (interface layout only)**. The single documentation finding—DESIGN.md's stale secured-armament description—was resolved. That review assessed controls, layout and documentation; it did not establish that the armor or internal models were ready for players. Reporting its verdict as feature readiness overstated the result.

## Armor and internals model assessment — incomplete

Direct review of the Bismarck definition and inspection captures found development collision proxies, not a finished armor or internal model:

- Hull protection consists of a 35 × 11 × 172 m citadel box with one 320 mm value and a 36 × 15 × 242 m hull-plating box with one 25 mm value. There are no independently defined armored decks, sloped protection, armored bulkheads or barbette protection. Each gunhouse also uses one uniform armor value.
- The internal layout contains twelve identical 14 × 12 × 36 m compartment boxes, two machinery boxes, one steering box and four magazine boxes. The compartment arrangement does not follow the tapering hull or establish a researched arrangement of decks, machinery rooms and ammunition spaces.
- These proxies are used directly by collision, penetration and flooding. Geometry defects therefore affect gameplay as well as appearance. Passing tests confirms consistency with the current definitions, not physical or historical correctness.
- The inspection presentation exposes these raw boxes against a faint exterior. Functional selection and readable labels do not make this a finished ship cutaway.

Readiness requires a source-backed reference layout, protection surfaces with appropriate local thickness and orientation, internal spaces contained by the actual hull, and damage checks at representative locations and approach angles. The simplified representation must remain useful for future editing and share authoritative geometry with the inspection view. The present pipeline and controls can support that work, but armor/internals model readiness is **not approved**.

## Merge to master verification — 2026-09-05

Integrated the completed worktree snapshot with master's newer harbor/camera update (`920ebce`). Conflict resolution preserves the CPU combat poses, articulated ship bindings, per-preset bridge viewpoints and port inspection together with the detailed harbor, terrain-aware port camera, sheltered sea conditions, lighting and FXAA. The ship uses the new harbor berth in port and returns to the trial origin when sailing.

The merged tree passed **46 tests, 392 assertions**, including the harbor geometry suite, and `bun run build` checked all four ship assets before TypeScript and production bundling. Browser checks confirmed the new harbor renders, internal selection leaves combat frozen, launch restores the exterior and expected target range, and returning to port resets the trial at the harbor berth. This merge does not change the unfinished armor/internals assessment above.

## High-speed movement jitter — 2026-09-05

The renderer displayed completed 60 Hz simulation ticks directly. At 15.43 m/s and 120 display frames per second, alternate frames held still then jumped 0.257 m. World-space camera damping also varied the follow distance with frame duration. ShipView now interpolates CPU hull/joint poses between ticks, and the camera follows ship translation before applying orbit/zoom damping. Camera focus, inspection transforms and wake sampling use the displayed ship pose. Combat still runs at its original fixed rate.

- **70 tests passed** after integration with the current HUD, daylight and port ship-switching updates. The real Game frame loop loads exported joints at 30/59/60/120/144 fps and irregular frame intervals. Coverage includes heading wrap, underway target inspection, pause/resume, port/launch reset, camera target changes, manual aiming/binoculars and unchanged authoritative combat state.
- `bun run build` passed all four asset checks, TypeScript and production bundling.
- An Orca browser WebGPU replay at full speed exercised chase, bridge and tactical cameras with alternating 6.94/21.28/13.89/43 ms frame intervals. Each measured 55 frames after warmup: maximum travel error below 1e-12 m and zero measured variation in the camera's longitudinal follow offset. Disabling only interpolation reproduced eight stationary frames and up to 0.214 m of travel error in the same replay.
- Full-speed turning and pause were exercised in WebGPU; pausing held the displayed pose. Exported muzzle alignment remained within 0.00212 m. A direct canvas capture was inspected for ship/sea visibility and wake attachment; temporary evidence is under `.build/ship-jitter-review/`.

The browser's normal animation loop was throttled while its window lacked focus, so the timing comparison used explicit frame replays through the live WebGPU renderer. These measurements validate movement continuity, not a hardware frame-rate guarantee. Temporary browser probes were removed after review.

## Missing salvo projectiles — 2026-09-05

The simulation spawned every barrel's shell, but the effects pool set its instance count to zero before the first render. Three's instancing shader sized its matrix buffer from that count, retaining only one matrix when later salvos grew the draw count. A browser pixel test reproduced eight simulated shell positions rendering as one visible shell after an empty frame.

The projectile mesh now retains its full 256-instance capacity and collapses unused slots to zero scale. Removed shells and trial resets clear previously occupied slots. The browser pixel test passes on both WebGPU and WebGL2 through counts `0 → 8 → 0 → 1 → 8 → 54 → 256 → 2 → 0 → 8`. The automated adapter test also checks actual Bismarck salvo positions and reset/reuse behavior. **85 tests passed**, and `bun run build` passed all four asset checks, TypeScript and production bundling.

To repeat the GPU regression with `bun run dev` running, evaluate this in the game's browser console (pass `true` for the WebGL2 fallback):

```js
await import('/scripts/tests/combat-effects-browser.ts').then(m => m.checkCombatEffects());
```

## Fleet fidelity 01 — 2026-09-05 Pacific

Implemented the Yamato / Baltimore / Enterprise fidelity handoff from assigned master base `8e0be03`, preserving newer fleet, contact, shell-follow, audio and aircraft work. The [shared authoring/verification record](../assets/ships/fleet-fidelity/README.md) links per-vessel changes, exact hashes, source qualifications, twelve neutral matched views, five fixed views, decoded geometry and live evidence. This milestone supersedes earlier implementation-status notes for these ships, not their historical accuracy caveats.

All three now share authored hull/deckhouse surfaces between rendering, CPU swept collision, sight picking and inspection. Original gunhouse facets, characteristic equipment, separately qualified protection and contained internal envelopes replace the earlier sparse/proxy portions. Corrections include Yamato's recurved bow air gap and port/starboard diagonals, Baltimore's broad transom cap and Enterprise's open hangar/elevator surfaces. Bismarck was rebuilt for shared recipe changes without editing its blueprint, exterior recipe or preserved baseline.

- `bun test --timeout 20000`: **247 passed, 0 failed, 30,803 assertions across 36 files**. The new fleet structural regressions cover posed end/bridge hits, AP exits, air misses, dry high hits, inside-hull waterline traversal, breaches/flooding, effective armor and mixed-definition world-space effects. An HTTP regression reproduces and fixes review directory URLs falling through to Vite's game SPA; all four port links now use explicit `index.html`.
- `bun run build`: all four asset/evidence and aircraft checks, TypeScript and Vite production build passed. The supplied large-bundle advisory remains. Local command logs are under `.build/fleet-fidelity/`.
- All four `ship:compile`, `ship:build`, `ship:review` and `ship:compare` runs passed. All three upgraded presets passed full `ship:independence` builds with raw game references unavailable. Per-vessel dimensional audits and Yamato's selected component measurements pass. All models stay within 500k triangles / 30 MiB; Bismarck's historical ZIP remains close to the 100 MiB individual-file limit.
- Current-hash WebGPU sweeps covered twelve train/elevation/recoil combinations for all four ships. Maximum muzzle discrepancy: Yamato 2.747 mm, Baltimore 1.317 mm, Enterprise 0.0324 mm and Bismarck 2.167 mm. All fixed and matched views were visually inspected; original before snapshots remain in assets.
- Each target launched as player against a mixed three-ship enemy fleet, fired both batteries through the UI, used armor hover/internal selection and returned to tick 0 / Exterior / zero water. Separate, labeled live seeded trajectories exercised each definition's bow, stern, bridge, misses and valid waterline damage/flooding through the normal CPU/effects path. Enterprise's offset bridge camera remained correct. Exact events, ammo changes, seeds, captures and limitations are in the per-vessel records.

Local Blender 5.2.0 LTS was used because no callable Blender MCP was available. Orca controlled only the assigned worktree's browser/terminal. Restricted historical scans were excluded from public packs. Direct canvas captures omit the HTML HUD and are distinguished from full UI screenshots and Blender renders. Roughly 20–54 port / 10–33 four-actor frame readings varied with desktop load, occlusion and effects: functional usability was exercised, but no controlled performance or maximum-fleet certification is claimed. Exact hull offsets, fitting locations, armor boundaries, rooms, capacities and hydrostatics remain qualified estimates in each discrepancy register.

### Final evidence packaging

The final production build passed after regenerating all four comparison packs. ZIP CRC checks and every published individual-file size check pass. Explicit historical redistribution allowlists pass for all three new packs; Bismarck retains its existing comparison policy. All new per-ship Markdown evidence links resolve locally.

| Portable archive | Bytes | MiB |
| --- | ---: | ---: |
| Yamato | 45,964,184 | 43.83 |
| Baltimore | 40,264,828 | 38.40 |
| Enterprise CV-6 | 43,518,366 | 41.50 |
| Bismarck | 104,061,929 | 99.24 |

Orca verified the corrected explicit port link and Yamato's twelve before/after controls, two historical overlays, five sections and opacity values 0 / 0.25 / 0.75 / 1. The regenerated Yamato page also exposed its current runtime records/captures in the accessibility snapshot. A subsequent extra browser pass over lazy-loaded runtime images and the other two review pages could not finish: the desktop connection closed, and targeted tab recovery repeated the same error. The shared Orca app was not restarted. This limits the final interactive-page recheck, not the already completed exact-hash in-game articulation, firing, damage, inspection and reset trials. All four published review URLs additionally pass the real Vite HTTP regression, and final archive/freshness checks cover their files. The read-only review-control helper is retained under `assets/ships/fleet-fidelity/review-page.js` for repetition when the desktop host is available.
