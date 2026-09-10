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

Appearance follows the [shared material rules](../../../docs/ship-appearance.md).
`appearance.json` retains the approved palette and assigns shared matte finishes,
original metric surface variation, subtle runoff and waterline staining. Wear is
an independent restrained interpretation, not a copy of the reference textures.

Known limitations: internal layouts, armor distribution, loading, ballistics and
mechanical stops are provisional game authoring. Rigging and minor fittings
remain simplified. Independent main-2/main-3 and main-4/main-5 poses can intersect
at the current main traverse limits. The bridge-mounted aa-03/aa-04 mounts can
contact the bridge at extreme train; launcher extremes can contact the bay sides.
**Visual acceptance remains incomplete.** The earlier trial turret restrictions
were not accepted and are not part of the published definition.

Follow [the ship pipeline](../../../docs/ship-pipeline.md).

Build: `bun run ship:build mogami`
Review: `bun run ship:review mogami`
