# IJN Mogami

## Approved brief

User approved the inspected proposal on 8 September 2026: IJN Mogami in
[GameModels3D's World of Warships configuration `pjsc009`](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pjsc009),
`A_Hull` with `AB2_Artillery` (five twin 203 mm turrets), `A_AirDefense`,
`AB_ATBA`, `AB_Torpedoes` and the corresponding shared fittings. This is the
source game's configuration, with no exact historical year asserted. Its internal
year labels do not establish a consistent historical refit.

GameModels3D-only external visual references. Match the inspected weathered gray
upperworks, brown decks and green-brown underwater hull; no additional camouflage
or flags. Side, top, front and turret/bridge/fitting previews were inspected and
approved. Source loading/waterline and historical accuracy remain unverified.
Gameplay values absent from the visual reference use provisional repository
conventions; they are not independently researched historical measurements.

Author independently through `blueprint.json`, the component catalog and `build.py`.
Reference geometry/textures are comparison-only and never authoring inputs.
Downloads, captures and diagnostics stay in ignored `.build/`.

Fitted outfit: five twin 203 mm mounts, four shielded twin 127 mm mounts,
six triple and six twin 25 mm mounts, and four trainable quadruple 610 mm
launchers. The 127 mm and 25 mm stocks are HE-only; select HE for manual use.
Catapults and service boats are visual fittings; no operational air wing is fitted.

The original recipes include the station hull, continuous raised central deck with
sloping ends and torpedo openings, tapered bridge tiers and observation wings,
swept funnel jackets with sloping mouths, and curved E/E3 gunhouses with recessed
ports and articulated canvas bags. `guns.py`, `main_guns.py` and `superstructure.py`
are declared recipe inputs. The runtime preset includes magazines, machinery,
directors, launcher equipment, armor, local damage regions and connected flood spaces.

September 2026 accuracy pass against `pjsc009` A_Hull + AB2_Artillery (compare with
`bun run ship:overlay mogami --reference pjsc009-ab2`; the default `pjsc009` cache holds
the 15.5 cm triples): the hull is 148 stations of 24 points measured from the reference
(cut-up shallow stern, anti-torpedo bulge, flared bow and forefoot, centreline skeg);
flood spaces and stability were re-derived for it. The foremast tripod, the A-frame
mainmast with its king post and box-girder crane, the catapults on hull sponsons, the
boats, the after control house and director platform, the bridge wings, searchlight
towers, twin rudders, screws, shaft brackets, bilge keels, deck fittings and torpedo-bay
openings follow the reference's measured positions.

Appearance follows the [shared material rules](../../../docs/ship-appearance.md).
`appearance.json` retains the approved palette and assigns shared matte finishes,
original metric surface variation, subtle runoff and waterline staining. Wear is
an independent restrained interpretation, not a copy of the reference textures.

Known limitations: internal layouts, armor distribution, loading, ballistics and
mechanical stops are provisional game authoring. Rigging and minor fittings
remain simplified. The reference places No. 2 turret at No. 1's deck height with
its muzzles at No. 1's rear face, so No. 2 rests at 16° elevation and a
`mountClearance` installation profile interlocks the main-1/2, main-2/3 and
main-4/5 pairs; the bridge-front 25 mm mounts stand 0.31 m forward of the reference
hardpoints so their seats clear the bridge. The E/E3 gun barrels (shared
`ijn-main-guns` geometry) sit about 0.25 m higher than the reference's; launcher
extremes can still contact the bay sides. The 12 m and 15 m boats, catapult
fittings and bridge detail are original simplifications of the reference shapes.
**Visual acceptance remains incomplete.**

Follow [the ship pipeline](../../../docs/ship-pipeline.md).

Build: `bun run ship:build mogami`
Review: `bun run ship:review mogami`
