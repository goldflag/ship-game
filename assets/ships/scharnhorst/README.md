# Scharnhorst (1939 refit, Atlantic bow)

Construction-backed design authored through the agent tooling (`ship:apply` batches, `ship:place`, `ship:view`, `ship:trial`) with the
GameModels3D World of Warships model `pgsb507` (`gsb003_scharnhorst_1939`) as the only geometric reference. It is a player-style design: it is not
registered in `src/ships/presets.ts` and has no published build. The same source is saved to the test account's design library as "Scharnhorst".

Deep load as compiled: 38,280 t at a 9.9 m draft, level trim and list, GM 2.4 m, 120 MW of turbines (70.6 MW at the screws, 26.9 kn estimated because the
generic screws are 60 % efficient; the ship's real 31 kn is out of reach with the catalog screws), 72 hull pieces, 80 equipment rows, 14 loads, 11 bulkheads, 3 custom fittings.

## Method

- **Hull**: one adjustable `custom-hull` (`hull`), 235.15 m × 30 m, 24 stations × 17 outline points, lofted from cross-sections of the reference hull mesh
  (waterline y = 0, keel −9.93; displacement within 2 % of the mesh). The compiler needs every span star-shaped about the mean of its outline points, so the
  outline points are clustered toward the deck in the reference's hourglass bow.
- **Superstructure**: 71 freeform 8-corner blocks and platforms read off reference plan slices and profile silhouettes (forward deckhouse and tower, funnel deckhouse,
  hangar, aft deckhouses). The funnel and the 1939 mainmast collide as one bounding box each, so the hangar and aft house stop short of the mast envelope and the
  mast stands on a 0.6 m pad.
- **Armament and fittings** (catalog parts at the reference hardpoints): 3 × 28 cm SK C/34 triple, 4 × 15 cm twin, 7 × 10.5 cm twin AA, 8 × 3.7 cm twin, 10 × 2 cm single,
  2 × triple 533 mm launchers, four SL 8 domes, two 10.5 m and two smaller rangefinders, catapult, boats, cranes, searchlights, anchors, the Scharnhorst funnel and mainmast.
  Parts the catalog lacks are design-local custom fittings (`construction.fittings`): the four single 15 cm wing mounts, the three 2 cm Flakvierling mounts and the
  foremast are **visual only** (they do not fire). The forward pair of 10.5 cm directors (`HP_GD_1/2`), the aircraft and the windows and doors are not modelled.
- **Machinery**: three 40 MW geared turbines, three 4.2 m screws (wing screws outboard as in the reference), twin rudders.
- **Protection**: 350 mm citadel belt at the waterline, 170 mm lower belt and belt ends, 45 mm upper belt, 105 mm deck over the citadel (50 mm to the ends), 25 mm citadel
  bottom. Fuel and stores are box loads sized and trimmed so the ship floats on its lines.

Edit: `bun run ship:edit scharnhorst`. This is not a certified historical model: the four model acceptance checks were not run.
