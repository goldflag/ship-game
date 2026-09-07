# Compact carrier controls follow-up

Implemented September 6, 2026 in response to the requested smaller controls, action hotkeys, angled camera, grid/text removal and actual aircraft images.

- Squadron cards are 90 px wide with 76×34 px images, 13 px headings and 10 px activity. The row is centered in map view and scrolls internally at narrow widths. The previous large selected-squadron heading, whole-wing totals, instructions and ready/launch explanation are removed. Mission/condition/endurance information remains in hover titles and Aircraft inspection.
- L Loiter, A Strike, D Defend, I Intercept and E Escort select a target action. Click a compatible water/ship/squadron target to issue it. R returns the selection, X recalls all, V toggles aircraft details. Buttons show their contextual map hotkeys. Esc cancels a pending target action first. Right-click retains contextual commands when no action is pending.
- The real scene camera tilts 20° from vertical. Sea hit conversion, ship targets, airborne route origins and loiter radius use the matching perspective projection. There is no grid.
- Wildcat, Dauntless and Devastator card images were baked and visually inspected from their actual original GLBs with **local Blender 5.2.0 LTS**; Blender MCP was unavailable. The durable recipe is `assets/aircraft/thumbnail.py`. Per-model camera/model/recipe/image hashes are retained beside each aircraft under `generated/thumbnail/render.json`. Three PNGs total about 111 KiB. Existing model geometry and authored joints are unchanged.

## Checks

`bun test src/simulation/airOperations.test.ts src/simulation/squadronCommands.test.ts src/game/AirOperations.test.tsx src/game/BattlefieldCamera.test.ts src/game/GameFrame.test.ts src/game/InputController.test.ts scripts/aircraft`: **59 pass, 0 fail**. See [compact-tests.txt](compact-tests.txt).

Camera tests compare the UI sea projection against independent Three.js ray/plane intersections at the corners and center at 1440×900, 700×550 and 390×844. They also verify airborne projection, cursor-anchored zoom, drag anchoring, the 20° tilt and restoring the ship optics. Command regressions cover incompatible target rejection, launch/loiter/strike orders and the 24-plane recovery cycle. Static component checks confirm the removed instructional/grid elements, action key labels and all three baked model image paths.

`bun run build`: **pass**, including all ship and aircraft checks, thumbnail hash validation, TypeScript and production Vite build. See [compact-build.txt](compact-build.txt). `git diff --check` passes.

The embedded-browser preview was revisited, but the hidden Orca window prevented a valid final visual/keyboard run. Screenshot capture timed out; Computer Use reported no accessibility window even after a restore attempt. The earlier screenshots and browser-command records in this directory describe the previous UI. No new desktop/mobile pixel review or end-to-end action-hotkey validation is claimed for this follow-up.
