# Type VIIC · 1941

Original early-war Type VIIC preset, informed by the captured U-570 survey. Surface and submerged operation share the same CPU combat simulation. Select **Type VIIC** in port or in either fleet in Custom battle. The model, guns, fixed tube sockets and internal volumes use the shared blueprint pipeline.

- Four bow tubes and one stern tube; fourteen torpedoes total.
- Press **3** for torpedoes, **1** for the 8.8 cm deck gun, **2** for the 2 cm platform gun. Bindings remain configurable.
- Aim within 15° of the bow or stern. A click / Q / Fire launches one loaded tube; holding fires the other eligible tubes at 0.7 second intervals. Each tube reloads in 45 seconds.
- G7a fast run: 44 kn, 5 km maximum, 300 m arming distance, fixed 2 m depth. Manual aim needs target lead; **G → Aim at → Target waterline** supplies a constant-speed intercept. No homing.
- Surface wakes mark shallow running torpedoes; contact produces a water plume, hull damage and local flooding. Allies and sinking wrecks remain physical targets. Magazine damage disables linked tubes. Return to port resets ammunition, torpedoes and damage.

Use the **Depth** instrument in battle: Surface, Periscope (7 m), Dive 50 m, and 10 m adjustments. **Z** orders deeper, **X** shallower, and **B** makes an emergency blow. Ballast fills/blows gradually and remains separate from compartment floodwater. Hydroplanes, rudders and screws animate on their original pivot IDs. Depth hold works at rest and underway; plane authority increases with speed. The combined main-ballast/trim controller, 120 m³ capacity, 85% submerged neutral fill and rates are game tuning.

Diesels power surface movement; electric motors power submerged movement at a tuned 7.6 kn maximum. Damaging one system affects its own mode. Guns are secured below 0.5 m; tubes work down to 12 m. Torpedoes settle from the actual tube position onto their existing 2 m run. **C** switches chase to the raised periscope; **Shift** magnifies. At 7 m the 8.4 m eye is above water; deeper orders take it underwater. The chase camera follows below the sea, and surface wake generation fades out as the casing goes under.

Orders stop at 150 m. Damage can force the boat below that limit, where pressure costs HP; deep breaches flood faster. Flooded or destroyed boats cannot be rescued by resetting ballast. Battery endurance, compressed-air reserves, oxygen, sonar and depth charges are not modeled. Bots retain a periscope approach for at least 40 seconds, then surface while the tubes facing their opponent reload. Contacts remain visible on the tactical chart.

The nominal hull is 67.1 × 6.2 m, with 4.74 m draft and 769 tonne surfaced displacement. Its 450 structural HP follows the same displacement curve as every ship. Bow/stern fittings and silhouettes are approximate original geometry.

Rebuild: `bun run ship:build type-viic`. Review: `bun run ship:review type-viic`. Validate: `bun run ship:check type-viic`.

See [source register](references/sources.json), [discrepancies](reports/discrepancies.md), and [validation](reports/validation.md). Generated Blender/GLB assets are outputs; edit the blueprint, catalog or original recipe to change this ship.
