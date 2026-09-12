# Admiral Hipper · GameModels3D A fit

## Approved brief

User approved [GameModels3D Admiral Hipper pgsc108](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pgsc108): A hull, matching A/AB equipment, and the displayed plain gray upperworks/hull, timber decks and red underwater finish. GameModels3D is the sole external reference. The underlying asset is labeled `hipper_1943`; acceptance targets its displayed configuration, not independent certification of a historical date. Geometry and textures are authored independently.

Priority: closely match the hull outline from above and the superstructure, including bow taper, stern curvature, deckhouse footprints, bridge tiers and funnel profile. Review source and original model at a common uniform scale.

Approved limitation: the source lacks its left-hand propeller asset; construct an original approximation guided by the visible opposite-hand propeller. Source loading/waterline is unverified. Gameplay values and internal arrangement absent from the visual source use explicitly provisional game conventions.

## Status

The playable preset uses the approved A/AB exterior fit, eight 203 mm guns, the matching secondary/AA variants and four triple torpedo launchers. Original authoring inputs provide the hull, superstructure, physical equipment supports, articulated assemblies and provisional damage/flooding layout.

Build with `bun run ship:build admiral-hipper`; inspect the current five fixed views with `bun run ship:review admiral-hipper` and compare the published model in `bun run model:viewer`. Model review covers attachments, matched hull/turret/bridge proportions, exposed gun mechanisms and combined traverse/elevation/recoil with independently moving neighbors. Gameplay calibration and the internal arrangement retain the limitations in the approved brief above.

When revising the original layout, run `authoring/define.py`, then `authoring/equipment.py`, followed by `bun assets/ships/author-local-damage.ts admiral-hipper` and `bun assets/ships/author-damage-control.ts admiral-hipper`. The definition helper replaces structures and modules; the later steps restore their equipment and gameplay profiles before building.
