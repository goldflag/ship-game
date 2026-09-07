# Flooding and sinking motion — 2026-09-06

The live hull-stability solver already supported listing, trim, recovery and capsize with HP remaining. Hull exhaustion set `sunk` before that solver ran, and the solver returned immediately for sunk actors. Every subsequent tick lowered the frozen pose at 0.45 m/s, stopping at -50 m for surface ships. A capsizing hull also froze at its angle of loss.

The solver now continues water-centroid and righting-moment updates after loss, evaluating the actual submerged hull instead of looking for an afloat equilibrium. A separate bounded CPU descent gathers speed; pumps stop on loss. Existing water loads determine direction. Symmetric loading does not receive a random list. The first sinking cause and score attribution remain intact. Hull-size-based clearance replaces the surface wreck depth that could leave an upright bow above water.

Gunnery → Own damage control shows list toward port/starboard, trim toward bow/stern, water and draft change. Target readouts use the same direction labels. The existing transparent naval instrument layout wraps these values inside the narrow panel.

## Checks

`bun test --timeout 20000 src/simulation src/game/ShipView.test.ts src/game/FleetHud.test.tsx src/game/GameFrame.test.ts`: **378 passed**. The 20-second timeout accommodates the existing 600-second Yamato flooding replay (about 11 seconds on this machine). The first run also encountered missing dependencies; `bun install --frozen-lockfile` restored them without changing the lockfile.

`bun run build`: **passed**, including all published ship and aircraft checks, TypeScript and Vite. The existing large-bundle warning remains.

New regression cases cover normal underwater damage with damage control operating, listing while alive and recovery after draining, mirrored port/starboard sinking, bow/stern trim, continuing capsize, preserved original loss cause, increasing descent speed, wreck clearance, reset and serialized replay. Existing frame tests caught retained optional vertical velocity after reset; initializing it to zero resolves that mismatch.

| Controlled Bismarck case | Result |
| --- | --- |
| Three 320-HP underwater blasts, 3 m² openings at port z=-35/0/35 m; normal pumps and crews, 120 s | 490 HP remaining, 5.7° port list, about 1,283 m³ water; afloat |
| Port spaces outboard of x=-5 m loaded to 5%, pumps off, 60 s | 1,450 HP, 8.4° port list, 0.29 m deeper; afloat |
| Same prescribed load, HP exhausted at the start, 30 s | 89.4° port roll, about 9.15 m down; original hull-failure cause retained |

Fixed bow views: [afloat with full HP](afloat.png) · [30 seconds after hull failure](hull-loss.png). Matching CPU/render measurements are retained in `afloat.json` and `hull-loss.json`; full check output is in `tests.txt` and `build.txt`.

`replay.ts` is an explicit development-only fixture for the mounted game. In a Bismarck battle, import it through Vite and call `reviewFlooding('afloat', 60)`, `reviewFlooding('hull-loss', 30)` or `reviewFlooding('capsize', 120)`. It advances prescribed floodwater with pumps disabled and freezes a fixed bow view. Reload afterward to restore the preset. These prescribed loads demonstrate motion; they are not ordinary salvo balance measurements.

Orca's embedded browser verified the live 8.4° list, matching CPU/render roll and a maximum gun-socket error of about 0.0022 m. The own-ship readout reported the same list and water, with no horizontal overflow at the reviewed desktop width. Whole-page screenshot capture timed out in the embedded browser, so retained PNGs use the game's own canvas export and do not contain the HTML HUD. The UI detector found existing stylesheet advisories; the changed readout adds no new colors, fonts or animations.

## Limits

This remains bounded gameplay hydrostatics. Hull HP loss is still an immediate combat loss, followed by a gradual visible descent. There is no new hole geometry, downflooding aperture model, trapped air, hull fracture, counterflooding command or seabed contact. Fletcher and Type VIIC retain their existing profile-free, capped water-moment approximation rather than finite-angle hydrostatics. Existing blueprints and published models were unchanged; no Blender rebuild was needed. These checks do not establish historical stability or sinking times.
