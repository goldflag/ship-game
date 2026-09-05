# Naval combat HUD studies

Question: which HUD makes this game feel like a familiar naval combat game while keeping the ship and ocean central?

Run `bun run dev` and open [the interactive comparison](http://localhost:5173/?variant=A). Use the bottom switcher or left/right arrows. These are development-only, throwaway mockups over the existing live Bismarck scene. The normal `/` route keeps the sea-trial interface.

| Study | Direction | Main tradeoff |
| --- | --- | --- |
| [A — Fleet action](http://localhost:5173/?variant=A) | World of Warships-inspired arrangement: ship health and engine at lower left, ammunition and consumables below the sight, minimap at lower right, team scores above. | Strongest familiarity; more permanently visible combat information. |
| [B — Gunnery station](http://localhost:5173/?variant=B) | War Thunder-inspired attention to range, individual guns, crew and compartment damage. Three instrument stations separate handling, weapons and the tactical picture. | More information to master and more ocean covered by panels. |
| [C — Open sea](http://localhost:5173/?variant=C) | A quieter interpretation of the same combat language. Compact ship status, reduced weapon strip, smaller circular chart, readiness next to the sight. | Best view of the ship; less tactical detail available at a glance. |

Recommendation: A is the strongest starting point for the stated preference for familiarity. C's lighter ammunition strip could be incorporated after choosing a direction. B is useful if compartment damage and manual gunnery become central mechanics.

## Try the combat states

- Click Cruising to preview fire damage and reduced health; click again to reset.
- Click ammunition or press 1 / 2 to select HE / AP.
- Click Fire salvo or press Enter with focus on the scene to preview a 12-second reload.
- Press R / T or click the repair controls to restore the sample ship state.
- Click × or press the backtick key to hide the review controls. Press backtick again to restore them.
- Add `&clean` to a variant URL to start with the instruments at the screen edges and the review controls hidden.
- The scene retains its existing camera and sailing controls. Navigation numbers in the mockups stay illustrative.

All health, speeds, bearings, reload durations, crew counts, combat contacts, gun statuses, scores and map geography are sample data. Target markers do not track real enemy models. The prototype demonstrates presentation and local UI states; it does not add enemies, shooting, collision or damage simulation. Mobile previews scale the desktop composition for comparison; these are desktop combat HUD concepts, not a finished touch interface.

## Reference research

Reviewed September 4, 2026. The references inform familiar placement and visual language; these concepts are not copies of either game's complete rules or current HUD.

- [World of Warships official game guide](https://steamcdn-a.akamaihd.net/steam/apps/552990/manuals/WoWS_Guide_EN.pdf): battle-screen arrangement, ammunition/consumables, ship status and minimap.
- [World of Warships: Gunnery and Aiming](https://wiki.worldofwarships.com/Ship:Gunnery_and_Aiming): crosshair, target lead and shell flight time. In particular, range and flight time belong near the aiming task.
- [World of Warships gameplay screenshot](https://www.greenmangaming.com/free-to-play/wp-content/uploads/2019/03/Warships-1.jpg): visual reference for Bismarck's combat interface.
- [War Thunder naval gameplay screenshot](https://forum-en-cdn.warthunder.com/original/3X/0/3/038a31332fdff9f8caa97b3f028f731731da02e5.jpeg): visual reference for ship status, weapon selection and the tactical map.
- [War Thunder: Hornet's Sting official changelog](https://warthunder.com/en/game/changelog/current/1716): its March 2025 update changed Arcade aiming and removed the shell-impact marker and FCS calculation progress bar from Arcade. B's detailed optics concept draws from realistic gunnery, not the obsolete Arcade aiming UI.

## Decision

Pending the owner's visual comparison. No replacement of the durable game design system has been chosen. Once a direction is selected, capture the choice here, implement it against actual simulation/combat data, then remove the losing variants and prototype switcher.

## Captured previews

- [A — Fleet action](a-fleet-action.png)
- [B — Gunnery station](b-gunnery-station.png)
- [C — Open sea](c-open-sea.png)

Validation: production build and TypeScript passed; all three desktop variants rendered without horizontal overflow; HE selection updated the selected slot and loaded-ammunition label; firing started the countdown and disabled repeat fire; incoming damage changed health and the fire warning; repair restored health. The landscape comparison controls were checked at 844 × 390 and the desktop views at 1600 × 900.
