# Damage realism — master integration, 2026-09-05

Integrated the damage-realism branch and its eight reviewed bug fixes (`e1cf7db`) with master `8d56b92`, then included master's first-strike shell-follow correction (`02008e4`) and surfaced Type VIIC/torpedo update (`d04f69e`). The original findings and their failing-before/passing-after evidence are in [code-review.md](code-review.md).

The combined game preserves master's ship geometry, gunhouse facets, structural collision surfaces, ship collisions, delayed bot decisions, aiming indicators, shell-follow camera, impact marks, damage feedback and fleet controls. Integration corrections include:

- One kinetic equipment-damage budget across a projectile's path, with continued physical flight and AP fuze timing after that budget is spent.
- Separate impact-ledger and renderer-attachment evidence. Stopped shells retain their incoming direction; articulated impact marks remain in the struck gunhouse's local frame.
- Drag-aware aiming, inherited velocity, bot lead and aiming-circle predictions. Player and bot guns require actual alignment; bot acquisition and cadence delays remain in force.
- Equipment-condition percentages and proportional damage feedback. The displacement-based points scale supports scoring, while flooding, stability and permanent weapon loss determine defeat. Friendly damage and post-loss overkill cannot claim score or steal a frag.
- Deterministic shell IDs across battle resets, preserving exact damage/breach replays alongside seeded bot behavior.
- Machinery hover remains accessible through compound residual spaces; ordinary room boundaries still limit deeper module picks. Port statistics now describe the implemented AP/HE, damage-control and flotation behavior.
- Torpedo hits use positional flood openings and actual local module damage. They cannot reintroduce universal HP sinking, automatic magazine-HP explosions, post-loss scoring or frag theft. Loaded tubes preserve fighting strength after gun loss, and flooded supply rooms disable tubes until drained. Three additional regressions cover these interactions. Type VIIC modules use the existing provisional 0.3 m immersion cutoff; its six isolated rooms retain the legacy reserve-buoyancy model pending a separate authored stability profile.

Regenerated Bismarck's estimated wing/end rooms, residual cells and loading against the revised hull. Complete structural plating replaces obsolete partial end-closure proxies. Rebuilt all four ships through the shared pipeline because the component catalog and compiler changed. Historical accuracy and remaining approximations are documented in each ship's discrepancy register; successful export checks are not historical certification.

## Validation

- `bun run test`: **339 passed, 0 failed**, across 47 files. Includes the original twelve added review regressions, fixed-rate replays, AP/HE, flooding, damage control, scoring, bots, collision coverage, inspection and renderer behavior.
- After including `02008e4`, the affected ShellFollow, Game and GameFrame suites passed **28 tests, 0 failed**, including seven new camera regressions. Camera assertions now verify unchanged simulation state and physical penetration rather than the retired universal hull-HP deductions.
- After integrating torpedoes, the full suite ran **373 tests**: 372 passed and one long hydrostatic integration test exceeded the default five-second timeout during concurrent Blender builds (5.16 seconds). Its assertions were retained with a 15-second timeout; the complete stability and statistics suites then passed **19 tests, 0 failed**. Torpedo-specific coverage passed **24 tests, 0 failed**, including the three new integration regressions. All 373 cases are verified across those runs.
- Final `bun run build`: passed all five ship checks, aircraft checks, TypeScript and production bundling. The existing large application-chunk warning remains.
- `ship:build` and `ship:review`: passed for Bismarck, Yamato, Baltimore and Enterprise. Inspected all five refreshed fixed views for each ship. Used local Blender; no Blender MCP tool was available.
- Mounted-game articulation passed at both traverse limits, full elevation and recoil for all four rebuilt models. Maximum CPU/socket position errors: Bismarck **2.166 mm**, Yamato **2.746 mm**, Baltimore **1.317 mm**, Enterprise **0.033 mm**. The fixture restored normal articulation afterwards.
- Rebuilt all five ships again after the torpedo compiler integration. [Binary comparison](master-integration-models.json) confirms every model's meshes, textures, hierarchy and transforms are identical to its previously inspected version; only the GLB definition hash changed. Inspected all five retained Type VIIC fixed views. Its freshly mounted articulation passed both traverse limits, full elevation and recoil with a maximum error of **0.002 mm**, then restored normal articulation ([diagnostics](master-integration-submarine-articulation.json)).
- The mounted Bismarck flooding fixture produced **440.58 m³** of water after 600 simulated seconds, disabled the forward port and starboard boiler rooms, and reduced propulsion to **66.67%** while remaining afloat. The HUD showed 440.6 m³ and 67% propulsion. This deliberately overpenetrating 380 mm shot used 10,000 mm penetration, a single point of kinetic equipment damage and disabled pumps to isolate flooding; it is not a normal-shell or historical calibration result. [Recorded diagnostics](master-integration-flooding.json).

## CPU timing

The existing seeded mixed 5v5 benchmark ran for 70 simulated seconds, excluding the first ten from timing. Mean tick: **1.917 ms**; p95: **2.980 ms**; p99: **4.517 ms**; worst: **45.528 ms**. One Yamato accumulated 371.14 m³ of water; most ships stayed dry. This is observational CPU evidence, excluding renderer time, and does not establish worst-case flooded-fleet performance or a speedup over a different master revision.
