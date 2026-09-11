# Admiral Hipper · GameModels3D A fit

## Approved brief

User approved [GameModels3D Admiral Hipper pgsc108](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pgsc108): A hull, matching A/AB equipment, and the displayed plain gray upperworks/hull, timber decks and red underwater finish. GameModels3D is the sole external reference. The underlying asset is labeled `hipper_1943`; acceptance targets its displayed configuration, not independent certification of a historical date. Geometry and textures are authored independently.

Priority: closely match the hull outline from above and the superstructure, including bow taper, stern curvature, deckhouse footprints, bridge tiers and funnel profile. Review source and original model at a common uniform scale.

Approved limitation: the source lacks its left-hand propeller asset; construct an original approximation guided by the visible opposite-hand propeller. Source loading/waterline is unverified. Gameplay values and internal arrangement absent from the visual source use explicitly provisional game conventions.

## Status

Authoring and acceptance review are in progress. The ship is registered as a playable candidate. Final geometry, attachments and whole-ship articulation checks remain outstanding.

Known review gap: underwater inspection suggests some propeller-shaft support ends are not seated against the hull. Correct and verify those attachments, review remaining fittings, and complete matched views and independent-neighbor articulation on the exact published model before acceptance.

Build with `bun run ship:build admiral-hipper`; inspect with `bun run ship:review admiral-hipper` and `bun run model:viewer` after registration.

When revising the original layout, run `authoring/define.py`, then `authoring/equipment.py`, followed by `bun assets/ships/author-local-damage.ts admiral-hipper` and `bun assets/ships/author-damage-control.ts admiral-hipper`. The definition helper replaces structures and modules; the later steps restore their equipment and gameplay profiles before building.
