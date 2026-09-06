# VIIC diving and visibility · master integration

Integrated diving and underwater visibility from `898306e` with master `5487d76` on 2026-09-06. Master’s fleet fidelity, damage control, ammunition, cameras and ocean settings are retained.

Diving now uses the active diesel/electric group through shared machinery availability, including reversible immersion failures. Excess operating depth creates a persistent keel opening through the shared flooding solver; the retired universal hull-HP deduction is removed. An optional stability profile evaluates damage loads without pulling intentional dives back to the waterline. Regression tests cover flooded electric machinery, optional stability, pressure openings and shallow torpedo hits under the current damage rules. The frame-loop test fixture includes the water absorption state used by the real renderer.

## Validation

- `bun test --timeout 60000`: **428 passed, 0 failed**, 54 files, 167,132 assertions. The longer command timeout accommodates the existing Yamato flooding scenario; its assertions are unchanged.
- `bun run build`: passed all five ship checks, aircraft checks, TypeScript and Vite production bundling. Vite retains its large-chunk advisory.
- `ship:build` passed for Bismarck, Yamato, Baltimore, Enterprise CV-6 and Type VIIC using local Blender. No Blender MCP was available. `geometry-continuity.json` records current definition hashes and confirms that every GLB binary payload matches master’s geometry. Bismarck’s baseline is unchanged.
- `ship:review type-viic`: regenerated and inspected profile, plan, bow, stern and quarter views. Stable tube sockets and eight independent appendage pivots remain validated. In-game gun articulation at both catalog limits had maximum muzzle error below 0.000002 m.
- High-quality WebGPU visibility checks passed at 7, 50 and 150 m. The readable hull occupied approximately 12.6% of each frame, above the 2% threshold. Periscope and surface views restored the original absorption exactly.
- The actual Custom battle HUD ordered 50 m, then 7 m, through the real fixed-step simulation. At 50 m the camera was 46.50 m underwater and the boat remained clearly visible. The player had approximately 31.55 m³ of combat floodwater, so depth hold used 58.7% ballast rather than the dry 85%. At periscope depth, 40 m³ of floodwater required 51.7% ballast; the boat held 7 m without false sinking, with the Bridge camera 1.402 m above mean sea level. Tubes reported the deep-launch restriction at 50 m.

`runtime.json` retains the GPU checks and gameplay diagnostics. `dive.png` and `scope.png` are direct captures of the actual game canvas; HUD readings are retained as text in the diagnostics. The earlier diving and visibility reports remain dated evidence of the original implementation. Gameplay approximations are documented in the Type VIIC discrepancy register.
