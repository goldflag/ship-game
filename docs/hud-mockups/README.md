# Fleet action HUD

The owner selected **A — Fleet action** and subsequently supplied World of Warships and War Thunder references for the armament strip and helm instruments. The live HUD extends that direction with captured mouse aiming, binoculars and clearer instruments around the ship and sea.

Run `bun run dev` and open the game, then choose **Set sail**. The controls are listed in the [project README](../../README.md).

## Current implementation

`src/ui/FleetHud.tsx` and `FleetHud.css` contain the sailing instruments. The lower-left group combines ship condition, compass, gun marks, speed, vertical engine telegraph and rudder. The centered armament strip shows live mount readiness, ammunition for both AP batteries, binoculars, gunnery and firing controls. G opens target damage and detailed mount status. The upper-left mission text and the toolbar above the minimap have been removed.

The sailing sight stays at the exact viewport center. Mouse movement turns the view while the cursor is captured; Shift or right mouse opens binoculars and the wheel selects 2×–12× magnification. Only binoculars show the numbered aiming scale. The CPU simulation receives the center sight's target-surface or sea-plane aim point.

The minimap uses a 40% opaque background and sits flush with the bottom and right viewport edges. −/+ keys or its internal buttons select five sizes, nominally 240–400 px with 320 px initially selected. Each size scales proportionally on smaller screens so every step changes the visible size. The kilometer button changes chart range independently; NORTH UP is a static orientation label.

Desktop instruments are 292 px wide at lower left and 410 px wide at bottom center. Narrow portrait screens move armament below the top compass to keep the center sight clear. Short landscape screens compact the weapon row and retain gun-status access in the helm and gunnery details.

## Current review captures

- [Desktop, 1600 × 900](../../assets/hud/review/desktop.png)
- [Binoculars, 1600 × 900](../../assets/hud/review/binoculars.png)
- [Landscape, 844 × 390](../../assets/hud/review/landscape.png)
- [Portrait, 390 × 844](../../assets/hud/review/portrait.png)
- [Controls and validation report](../../assets/hud/reports/controls-review.md)
- [Supplied references and provenance](../../assets/hud/README.md)

## Archived studies

These screenshots preserve the original comparison. Their sample combat states were design studies; the live HUD now uses simulation telemetry and only implemented weapon actions.

| Study | Direction |
| --- | --- |
| [A — Fleet action](a-fleet-action.png) | Selected: familiar corner instruments, a centered armament strip and a square minimap. |
| [B — Gunnery station](b-gunnery-station.png) | Archived: more persistent gun, crew and compartment information. |
| [C — Open sea](c-open-sea.png) | Archived: quieter ship status and a circular chart. |

The prototype switcher and alternate studies are retired. [DESIGN.md](../../DESIGN.md) records the current instrument styling and behavior.
