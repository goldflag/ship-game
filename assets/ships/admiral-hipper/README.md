# Admiral Hipper · GameModels3D A fit

## Approved brief

User approved [GameModels3D Admiral Hipper pgsc108](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pgsc108): A hull, matching A/AB equipment, and the displayed plain gray upperworks/hull, timber decks and red underwater finish. GameModels3D is the sole external reference. The underlying asset is labeled `hipper_1943`; acceptance targets its displayed configuration, not independent certification of a historical date. Geometry and textures are authored independently.

Priority: closely match the hull outline from above and the superstructure, including bow taper, stern curvature, deckhouse footprints, bridge tiers and funnel profile. Review source and original model at a common uniform scale.

Approved limitation: the source lacks its left-hand propeller asset; construct an original approximation guided by the visible opposite-hand propeller. Source loading/waterline is unverified. Gameplay values and internal arrangement absent from the visual source use explicitly provisional game conventions.

Finish: It wears In commission, drawn by the game like every ship's (plating, mottling, runoff, tide stain, funnel soot); Blender bakes only fine paint grain. The bare timber weather deck and the timber tops of the 10.5 cm and director platforms, as the recipe authors them, are planked by the game at 0.16 m with 3.4 m butts and 3 mm seams (`decking`); the plank sizes are interpretations.

## Status

The playable preset uses the approved A/AB exterior fit, eight 203 mm guns, the matching secondary/AA variants and four triple torpedo launchers. Original authoring inputs provide the hull, superstructure, physical equipment supports, articulated assemblies and provisional damage/flooding layout.

Build with `bun run ship:build admiral-hipper`; inspect the current five fixed views with `bun run ship:review admiral-hipper`, compare against the reference with `bun run ship:overlay admiral-hipper` and view the published model in `bun run model:viewer`. Model review covers attachments, matched hull/turret/bridge proportions, exposed gun mechanisms and combined traverse/elevation/recoil with independently moving neighbors. Gameplay calibration and the internal arrangement retain the limitations in the approved brief above.

## How it was made

- **Hull.** `authoring/lines.json` holds 154 control stations measured like a lines plan from pgsc108 in the runtime frame (fore-and-aft offset −0.19 m, the `ship:overlay` value): 24 points each, twenty from the keel to the belt knuckle at +1.35 m and four to the deck edge. The measurement drops thin appendages (bilge keels, shaft brackets, rudder, the centre skeg aft of its shaft boss) and bridges the anchor pockets. Bilge keels, screws, V brackets and the rudder are placed in `build.py` from the same reference. The deck is drawn flat at the deck-edge height.
- **Superstructure.** `authoring/define.py` (structures), `authoring/platforms.py` (platform floors and bulwarks) and `build.py` (fittings) were set from the reference's plan slices, top-height map and textured renders: funnel casing, collar, jacket and raked cap; funnel house and fillet; the full-width hangar and its low after section; the forward tower's base, core, 14.2 m platform and admiral's bridge house; the conning and navigating positions above the 11.7 m bridge deck; masts and yards; the mainmast searchlight tub.
- **Authoring order.** Run `authoring/define.py`, then `authoring/equipment.py`, then `bun run ship:build admiral-hipper`. The helpers carry forward the committed gameplay profiles (local damage, damage control, room and mount fires, support generators) by ID, so rerunning them does not reset calibration; `author-local-damage.ts` and `author-damage-control.ts` are not part of the loop.

## Accepted approximations

- Hull mass, waterplane area and reserve buoyancy remain the game's calibration constants (18,500 t); the measured loft displaces about 19,200 t at the 7.74 m draft. The ship has no `stability` or flood-region data, as before.
- The weather deck has no camber (the reference's centreline stands about 0.25 m above its deck edge); the measured deck edge is used across the beam, and deckhouse bases keep their authored heights.
- The reference omits its port wing screw and carries no centre screw; both are original, the wing screws mirrored from the reference's starboard screw.
- Turrets, guns and light AA are the shared catalog parts, unchanged. Forecastle gear, boat davits and small fittings follow the reference only approximately.
