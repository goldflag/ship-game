# Bot behavior review

Reviewed 2026-09-05 using the renderer-free combat simulation. This is gameplay calibration, not historical fire-control validation. No live browser playtest was performed for this change.

## Reproduction

A stationary Yamato versus one Bismarck bot at the default 5 km produced a first shot at 0.133 seconds in two identical runs. The old bot aimed every mount at the same point, 0.8 m above the target's local waterline. Both forward Yamato main mounts were disabled within ten seconds.

Regression tests reproduced both immediate fire and identical aim points before the change. An additional target-loss check caught a shorter reacquisition bypassing the opening delay; the opening deadline now survives target changes.

## Behavior checks

The new controller delays acquisition, samples target observations, estimates velocity, retains imperfect aim between shots, changes hull aim areas and holds varied maneuver orders. Taking damage can prompt a turn away. Each bot has serializable memory and an independent seeded generator. See [behavior and tuning](../../../docs/bot-behavior.md).

Six seeded 90-second runs used a stationary, non-firing Yamato against one Bismarck bot at 5 km:

| Seed | First shot (s) | Yamato HP at 10 s | Yamato HP at 90 s | Bot shells fired |
| --- | ---: | ---: | ---: | ---: |
| 1 | 11.9 | 1,750 | 1,130 | 58 |
| 2 | 12.4 | 1,750 | 1,432 | 64 |
| 3 | 12.1 | 1,750 | 1,069 | 62 |
| 4 | 12.3 | 1,750 | 1,186 | 64 |
| 5 | 8.7 | 1,750 | 1,186 | 58 |
| 6 | 13.7 | 1,750 | 989 | 58 |

All six Yamatos survived the 90-second sample. The bots remained capable of dealing damage, and opening timing, courses and damage outcomes varied. This small sample does not establish balance for every matchup or fleet size.

Automated checks cover the first eight seconds at 1 and 5 km, later firing by every bot, different aim points across mounts and time, delayed response to a course change, target reacquisition, early target loss, damage reactions, and exact replay after reset. Existing fleet coverage retains physical reload/ammunition, shared damage, team targeting, firing-lane checks and identical outcomes at 30/60/144 display FPS. Worst-case magazine damage is tested with controlled accurate player fire so it stays independent of bot accuracy.

Final validation: `bun test --timeout 15000` passed 235 tests across 35 files; `bun run build` passed all ship/aircraft checks, TypeScript and production bundling. The longer test timeout accommodates the 90-second fleet simulation; its assertions are unchanged. The build retains the bundle-size warning. `git diff --check` passed.
