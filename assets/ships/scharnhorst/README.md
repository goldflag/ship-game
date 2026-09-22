# Scharnhorst (1939 refit, Atlantic bow)

Construction-backed design authored through the agent tooling (`ship:apply` batches, `ship:place --table`, `ship:ballast`, `ship:view`, `ship:trial`) with
the GameModels3D World of Warships model `pgsb507` (`gsb003_scharnhorst_1939`) as the only geometric reference, measured with `ship:reference`,
`ship:slice` and `ship:hardpoints`. It is a player-style design: it is not registered in `src/ships/presets.ts` and has no published build. The same
source is saved to the test account's design library as "Scharnhorst".

Full load as compiled: 38,320 t on the design waterline (9.93 m draft), level trim and list, GM 2.9 m, 120 MW of turbines (70.6 MW at the screws, 26.9 kn
estimated because the generic screws are 60 % efficient; the ship's real 31 kn is out of reach with the catalog screws), 75 hull pieces, 174 equipment rows,
40 custom-fitting instances, 32 loads and 11 bulkheads.

## Method

- **Hull**: one adjustable `custom-hull` (`hull`), 235.15 m × 30 m, 24 stations × 17 outline points, lofted from cross-sections of the reference hull mesh
  (waterline y = 0, keel −9.93). Deck height and deck-edge half-breadth agree with the reference to within a few centimetres and the 0.25 m probe step
  from the bow to the stern. The compiler needs every span star-shaped about the mean of its outline points, so the outline points are clustered toward
  the deck in the reference's hourglass bow.
- **Superstructure**: freeform blocks, balcony platforms and compound solids read off reference plan slices and profile silhouettes. The conning tower
  (round armoured tower plus the chamfered forward bridge house), the upper tower (a 3.9 × 6.3 m stadium) and the navigating bridge's rounded front are
  compound-solid prisms built from the measured plan rings. The boats ride on skid platforms at the reference heights: a U-shaped boat deck around the
  funnel casing on stanchions, and skids beside the hangar.
- **Armament** (catalog parts at the reference hardpoints, all firing): 3 × 28 cm SK C/34 triple, 4 × 15 cm twin, 4 × 15 cm single (`sk-c36-150-single`
  stands in for the MPL C/35 wing mounts), 7 × 10.5 cm twin AA, 8 × 3.7 cm twin, 10 × 2 cm single, 3 × 2 cm Flakvierling 38, 2 × triple 533 mm launchers.
  Directors: four SL 8 domes, two 10.5 m and two smaller rangefinders, six director optics.
- **Fittings**: catapult, three 11.7 m traffic boats, two 9 m pinnaces, two cutters, twelve Carley floats on the hangar roof and eight smaller floats,
  two boat cranes and two aircraft cranes, five searchlights, breakwater, capstans and anchor cables fore and aft, bitts, vent heads, accommodation
  ladders, 66 rimmed portholes, the Scharnhorst funnel and mainmast, and the foremast with its yards and the main aerials to the mainmast. Parts the
  catalog lacks are design-local custom fittings (`construction.fittings`): the foremast and aerials, breakwater, capstans, vent heads, floats and
  boat-deck stanchions. The forward pair of 10.5 cm directors (`HP_GD_1/2`), the aircraft, dinghies and the windows and doors are not modelled.
- **Machinery**: three 40 MW geared turbines, three 4.2 m screws (wing screws outboard as in the reference), twin rudders.
- **Protection**: 350 mm citadel belt at the waterline, 170 mm lower belt and belt ends, 45 mm upper belt, 105 mm deck over the citadel (50 mm to the ends),
  25 mm citadel bottom, 350 mm conning tower walls with a 200 mm roof; the turrets carry their catalog plates.
- **Loading**: fuel oil in the inner-bottom and wing tanks (wing tanks outboard of the machinery and magazines, inside the side protection) and stores
  holds fore and aft, plus outfit loads between the waterline and the main deck for the internal decks, bulkheads, auxiliaries, crew and stores the
  compiler does not model. `ship:ballast` filled them to the design waterline on an even keel.

Edit: `bun run ship:edit scharnhorst`. This is not a certified historical model: the four model acceptance checks were not run.
