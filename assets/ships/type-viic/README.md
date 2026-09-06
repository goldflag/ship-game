# Type VIIC · 1941

Original early-war Type VIIC preset, informed by the captured U-570 survey. Surface operation only in this update. Select **Type VIIC** in port or in either fleet in Custom battle. The model, guns, fixed tube sockets and internal volumes use the shared blueprint pipeline.

- Four bow tubes and one stern tube; fourteen torpedoes total.
- Press **3** for torpedoes, **1** for the 8.8 cm deck gun, **2** for the 2 cm platform gun. Bindings remain configurable.
- Aim within 15° of the bow or stern. A click / Q / Fire launches one loaded tube; holding fires the other eligible tubes at 0.7 second intervals. Each tube reloads in 45 seconds.
- G7a fast run: 44 kn, 5 km maximum, 300 m arming distance, fixed 2 m depth. Manual aim needs target lead; **G → Aim at → Target waterline** supplies a constant-speed intercept. No homing.
- Wakes mark running torpedoes; contact produces a water plume, hull damage and local flooding. Allies and sinking wrecks remain physical targets. Magazine damage disables linked tubes. Return to port resets ammunition, torpedoes and damage.

The nominal hull is 67.1 × 6.2 m, with 4.74 m draft and 769 tonne surfaced displacement. Its 450 structural HP follows the same displacement curve as every ship. Bow/stern fittings and silhouettes are approximate original geometry.

Rebuild: `bun run ship:build type-viic`. Review: `bun run ship:review type-viic`. Validate: `bun run ship:check type-viic`.

See [source register](references/sources.json), [discrepancies](reports/discrepancies.md), and [validation](reports/validation.md). Generated Blender/GLB assets are outputs; edit the blueprint, catalog or original recipe to change this ship.
