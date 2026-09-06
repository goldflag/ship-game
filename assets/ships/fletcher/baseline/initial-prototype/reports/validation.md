# Fletcher validation

Validated 2026-09-05. Export content hash: `4d62de645ac3cfe900ed56f85aa4ffbcb5908728de932a8de00c58fd09e3c574`.

## Build and simulation

- Shared `ship:new`, `ship:compile`, `ship:build`, `ship:check` and `ship:review` pipeline used. Local Blender authored/exported the original recipe; Blender MCP was unavailable.
- Export checks passed: 44,182 triangles, 2,559,188-byte GLB, 12 gun mounts / 13 muzzles, two trainable torpedo assemblies / ten muzzles and eight depth-charge release sockets. See [export.json](export.json).
- Rebuilt Bismarck, Yamato, Baltimore, Enterprise and Type VIIC after changing the shared component catalog, compiler and single-barrel enclosure builder. Original Bismarck baseline sources remain preserved.
- `bun test --timeout 15000`: **297 passed, zero failed**, across 40 files, with 34,336 assertions. The default five-second limit timed out one existing large bot-battle test; that file passed independently and the complete suite passed with the larger limit. No test assertions were weakened.
- `bun run build`: passed all six ship checks, aircraft checks, TypeScript and Vite. Vite retains its existing large-chunk advisory. Full outputs are retained in [tests.txt](tests.txt) and [production-build.txt](production-build.txt).

The new tests exercise blueprint validation, both torpedo broadsides, exact rotated launch origins, ammunition exhaustion, ballistic charge entry, timestep consistency, three-dimensional blast distance, flooding, friendly/self damage, scoring, bot release conditions, disabled magazines, projectile limits, reset, exported-model articulation and keybinding migration.

## Rendered checks

- Inspected all five fixed Blender review views in `../generated/review/`, then the production model in the Orca embedded browser with WebGPU. Harbor selection, statistics, Armor and Internals work; the forward engine can be isolated.
- Inspected both articulation extremes in [articulation-high.png](articulation-high.png) and [articulation-low.png](articulation-low.png). Fletcher gun muzzle error remains below 0.00060 m and torpedo muzzle error below 0.000003 m in the retained runtime captures.
- The development [weapon fixture](../../../../scripts/diagnostics/fletcher.html) uses the production simulation, model, ocean, effects and Fleet HUD. Main and secondary weapons fire and resolve armor impacts. Ten deck torpedoes train, launch, enter the sea and hit a surfaced Type VIIC; score caps at its 450 HP with one frag. Eight held-fire depth charges consume eight rounds, splash, sink and burst at 10 m. A close-pass blast damages the target and produces continuing flooding; all eight projectiles expire.
- Normal Custom battle launch and the Drop button exercised. A synthetic `Digit4` browser event verified the production keyboard handler; native CLI key presses did not reach the review tab reliably. At tick 340, ammo is 27 and one charge is active. Pausing holds both tick and projectile; Return to port restores tick zero, 28 charges and empty effect pools. See the `runtime-ui-*.json` captures.

## UI finish review

Desktop, 390 × 844 phone, 768 × 900 tablet and 844 × 390 landscape captures are retained alongside the runtime reports. A fresh reviewer found intermediate-width overlap, resolved by two rows between the helm and chart. The final verdict was **ship**:

| Finding | Final status |
| --- | --- |
| R1: expanded weapon controls overlap helm/chart | Resolved; both new captures show separation and key labels remain clear. |
| Remaining material findings | Clear. |

The single detector pass reported incumbent palette/type documentation advisories and existing CSS throttle-pointer triangles. The fixed review camera may crop ships at narrow aspect ratios; these captures verify the HUD layout, not a new mobile camera.

These checks establish gameplay and pipeline consistency. Historical fit, geometry and gameplay approximations remain recorded in [discrepancies.md](discrepancies.md).
