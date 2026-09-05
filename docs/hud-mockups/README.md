# Naval combat HUD studies

Question: which HUD makes this game feel like a familiar naval combat game while keeping the ship and ocean central?

The owner selected **A — Fleet action**, with instruments about 15% smaller and a live FPS counter at the upper right. Run `bun run dev` and open [the game](http://localhost:5173/). The prototype switcher and losing variants have been removed; the screenshots below preserve the original comparison.

| Study | Direction | Main tradeoff |
| --- | --- | --- |
| [A — Fleet action](a-fleet-action.png) | World of Warships-inspired arrangement: ship health and engine at lower left, ammunition and consumables below the sight, minimap at lower right, team scores above. | Strongest familiarity; more permanently visible combat information. |
| [B — Gunnery station](b-gunnery-station.png) | War Thunder-inspired attention to range, individual guns, crew and compartment damage. Three instrument stations separate handling, weapons and the tactical picture. | More information to master and more ocean covered by panels. |
| [C — Open sea](c-open-sea.png) | A quieter interpretation of the same combat language. Compact ship status, reduced weapon strip, smaller circular chart, readiness next to the sight. | Best view of the ship; less tactical detail available at a glance. |

Recommendation: A is the strongest starting point for the stated preference for familiarity. C's lighter ammunition strip could be incorporated after choosing a direction. B is useful if compartment damage and manual gunnery become central mechanics.

## Implementation

`src/ui/FleetHud.tsx` and `FleetHud.css` implement the selected visual layout. The ship widget is 251 px wide (was 295), the weapon strip 421 px (was 495), the map 202 px (was 238), and the sight 459 px (was 540). Instruments sit at the screen edges and keep text readable rather than scaling the entire viewport.

Speed, engine order, rudder, heading, ship bearing, distance, chart position/trail/buoys, camera mode and FPS come from the game. Engine buttons, camera controls, map zoom, pause/settings, fullscreen, HUD visibility and touch steering remain functional. Combat is not implemented yet, so weapon slots are secured and sample enemies, scores, health values, damage counters, capture zones and reload timers are omitted from the live HUD.

## Reference research

Reviewed September 4, 2026. The references inform familiar placement and visual language; these concepts are not copies of either game's complete rules or current HUD.

- [World of Warships official game guide](https://steamcdn-a.akamaihd.net/steam/apps/552990/manuals/WoWS_Guide_EN.pdf): battle-screen arrangement, ammunition/consumables, ship status and minimap.
- [World of Warships: Gunnery and Aiming](https://wiki.worldofwarships.com/Ship:Gunnery_and_Aiming): crosshair, target lead and shell flight time. In particular, range and flight time belong near the aiming task.
- [World of Warships gameplay screenshot](https://www.greenmangaming.com/free-to-play/wp-content/uploads/2019/03/Warships-1.jpg): visual reference for Bismarck's combat interface.
- [War Thunder naval gameplay screenshot](https://forum-en-cdn.warthunder.com/original/3X/0/3/038a31332fdff9f8caa97b3f028f731731da02e5.jpeg): visual reference for ship status, weapon selection and the tactical map.
- [War Thunder: Hornet's Sting official changelog](https://warthunder.com/en/game/changelog/current/1716): its March 2025 update changed Arcade aiming and removed the shell-impact marker and FCS calculation progress bar from Arcade. B's detailed optics concept draws from realistic gunnery, not the obsolete Arcade aiming UI.

## Decision

Selected: A — Fleet action. Preserve its familiar corner arrangement and reduce the primary instruments by about 15%. Keep the archived screenshots as design references for future combat states; B, C and the review switcher are retired.

## Captured previews

- [A — Fleet action](a-fleet-action.png)
- [B — Gunnery station](b-gunnery-station.png)
- [C — Open sea](c-open-sea.png)

Validation: production build and TypeScript passed; all three desktop variants rendered without horizontal overflow; HE selection updated the selected slot and loaded-ammunition label; firing started the countdown and disabled repeat fire; incoming damage changed health and the fire warning; repair restored health. The landscape comparison controls were checked at 844 × 390 and the desktop views at 1600 × 900.

## Live HUD validation

The production build and TypeScript checks pass. Browser checks verified the live FPS counter, engine orders and changing speed, starboard rudder, map zoom and its limits, camera cycling, pause/resume, help, and hiding/restoring the HUD. The desktop and small-screen layouts were checked at 1600 × 900, 844 × 390 and 390 × 844. The narrow-screen weapon/camera overlap was corrected. [Current desktop HUD](fleet-action-live.png).
