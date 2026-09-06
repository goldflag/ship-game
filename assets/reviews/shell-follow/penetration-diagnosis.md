# Superstructure hits followed by a water splash

Investigated 2026-09-05 at commit `8d56b9249f55e1dc7ccf22c5fdfad6fced2facf8`, using the published Bismarck definition with content hash `957a349026ab6dfccb0b6caa5469c6899066fe034d3e9563940ad0b8e336037b`.

**Fixed:** shell follow now holds at the first recorded ship strike for 1.1 seconds, including when AP penetrates and continues flying. Previously it followed a surviving shell through the ship and held at its eventual splash, making a damaging superstructure hit look like a miss. AP penetration and damage resolution remain authoritative in the simulation.

## Deterministic reproduction

Run `bun assets/reviews/shell-follow/penetration-diagnosis.ts`. The harness uses the actual `CombatSimulation`, `ShellFollow`, and `CombatEffects` classes and asserts the corrected camera behavior. It injects one Bismarck main-battery AP shell 30 m to port of an idle target, traveling starboard at 820 m/s with a downward component of 20 m/s. Damage, caliber and penetration budget come from the published weapon catalog. Only the starting height and fore/aft position change between cases.

| Aim region | Recorded combat result | HP lost | Previous camera hold | Corrected camera hold |
| --- | --- | --- | --- | --- |
| Lower bridge, starting Y=15 m / Z=-18 m | Enters port wall at 0.033 s; exits starboard wall at 0.050 s; splashes at 0.650 s | 7 | Water at X=500.743 m | Entry wall at X=-6 m |
| Armored midship hull, starting Y=0.5 m / Z=0 | Penetrates main belt/support; stops at turtleback at 0.033 s | 14 | Inside hull at X=-13.451 m | Entry belt at X=-16.920 m |
| Unarmored bow, starting Y=4 m / Z=-115 m | Crosses hull shell; splashes at 0.200 s | 7 | Water at X=126.647 m | Entry hull at X=-2.281 m |

Positions use the documented runtime axes, with the target centered at X=Z=0. Times are measured from injection near the target, not gun discharge. The hull result depends on which protection the shell crosses; unarmored hull sections can also allow passage.

## Cause and scope

- `src/simulation/damage.ts`: successful structural penetration subtracts plating resistance, applies 10% of the shell's catalog damage once per structural surface, and permits continued flight. Bismarck's ordinary deckhouse plating is a provisional 8 mm; this shell retains about 534 mm of its original 550 mm penetration budget after both bridge walls. Penetrating plating does not itself consume the shell. AP fuzes are not implemented.
- `src/game/ShellFollow.ts`: the camera now checks the tracked shell's first non-shot event before following its live position. This also selects entry over exit/internal damage/splash when several events arrive between rendered frames. The existing hold timer prevents later events from moving the impact view, and the shell selection watermark prevents reattaching to that shell after the hold ends.
- `src/game/CombatEffects.ts`: shell mesh positions come directly from the surviving simulation shells. The harness verifies all 50 live-tick mesh positions with error below 0.1 mm and verifies removal at the terminal event. Camera assertions now require the first contact position after a strike.

The single-shell case excludes following a different round in the salvo. The adapter checks exclude a shell-position mismatch in this reproduction. These checks do not establish collision coverage for every ship or fitting.

## Live review

The same injected bridge shot was run through the actual game frame loop in Orca's browser using WebGPU. At entry, the shell remained alive, the target lost 7 HP, and shell follow entered `impact` at `[-6, 14.410181, -18]`. After the shell splashed at X=500.743 m, both the follow position and camera position remained at the entry view. Pause preserved the hold; resuming completed it and restored the ship camera with shell follow `ready`.

![Shell-follow camera holding on the bridge strike](penetration-hold.png)

This image is a direct canvas capture of the entry impact, including the ship and sea. Orca's full screenshot timed out, so the canvas was captured and inspected separately; HTML instruments are not included. The browser-only review used an injected shell and manually advanced real game frames for deterministic capture. No review hooks were added to runtime source.

## Validation

- Seven new regression cases failed before the fix and passed afterward: bridge, unarmored bow and armored hull at 60/10 fps, plus entry/exit/splash ordering and prevention of reattaching to a surviving shell.
- The complete suite passed: 258 tests across 38 files, zero failures, using `bun test --timeout 20000`. The first run during concurrent browser/build work exceeded Bun's default five-second limit in the existing bot endurance test; the rerun completed with assertions intact.
- `bun run build` passed all four ship checks, all aircraft checks, TypeScript and production bundling. Vite reported its existing large-chunk advisory.
- No models, blueprints or damage rules changed. Camera behavior and its documented impact semantics were updated.
