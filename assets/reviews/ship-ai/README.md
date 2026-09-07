# Per-ship AI levels

Each bot row in Custom battle has an AI level selector and a short explanation. The player's ship remains manual. Duplicate hulls carry independent settings, and removing a roster entry removes its own setting. Plain ship IDs and definitions in older scenarios continue to select Normal.

| Level | Behavior |
| --- | --- |
| 1 · Static target | Stop engine and rudder; no target acquisition or attacks. |
| 2 · Moving target | Turn across the deployment lane and cruise at 55% throttle, avoiding nearby ships and shores; no attacks or intentional diving. |
| 3 · Easy | Slower observation and acquisition, twice Normal's aim error, longer crew firing delays. |
| 4 · Normal | Existing crew timing, aim and maneuver tuning. |
| 5 · Hard | Faster observation and acquisition, half Normal's aim error, shorter crew firing delays and earlier damage reactions. |

Passive modes also suppress automatic aircraft launch and the separate anti-aircraft damage envelope. All levels share ship health, weapon reloads, ammunition, projectile physics and damage rules. Physical collisions, flooding and sinking still apply to targets. Carrier launch timing varies by skill; aircraft pilots retain their existing tactics. These are gameplay tuning choices.

## Validation

- PR preparation: rebased cleanly onto `c214a12c` (current master). Re-ran the production build and AI/bot/battle/torpedo/aircraft/air-operations/fleet-loading tests: 83 tests and 20,847 assertions passed across 7 files. The screenshots below predate the added King George V catalog entry; the AI controls are unchanged.
- `bun test src/simulation/aiLevels.test.ts`: 7 tests, 95 assertions passed. Covers setup resolution, invalid levels, duplicates, defaults, all-mode resets, passive movement and ammunition, carrier/submarine behavior, anti-aircraft suppression, victory, skill differences, active firing and mixed-level frame-rate determinism.
- `bun run test`: 82 of 84 files passed; two existing Yamato flooding tests exceeded Bun's 5-second timeout. Both affected files passed with `bun test src/simulation/stability.test.ts src/simulation/machinery.test.ts --timeout 15000` (26 tests, 80,152 assertions).
- `bun test src/game/Game.test.ts`: 7 tests, 76 assertions passed after extending the real fleet-loading test to assert mixed levels on duplicate hulls and different models. The test loads exported joint hierarchies while omitting GPU startup.
- `bun run build`: passed ship/aircraft asset checks, TypeScript and Vite. Existing large-bundle advisory remains.
- Orca browser: actual BattleSetupDialog via the existing `/scripts/diagnostics/map-picker.html` review harness. Changed friendly and enemy levels, added duplicates and removed a middle duplicate; surviving selections were retained. Checked descriptive text, five choices, Normal default, accessible names and 44px select height. No dialog horizontal overflow at desktop or narrow widths.
- [Desktop roster](setup-desktop.png): 991 × 763 CSS viewport. [Mobile roster](setup-mobile.png): 388 × 759 CSS iframe. Both captures scroll to the controls. The standalone harness does not render the sea or launch a live GPU battle.
- Design detector: advisory palette/type-ramp drift already present in the incumbent dialog; the new 12px labels and descriptions use the existing row typography. No new hard findings or design-token changes.

## UI review

Disposition: **ship**. Independent finish review found no material fixes.

| Element | Verdict | Evidence |
| --- | --- | --- |
| TYPE | Match | Barlow controls and compact supporting text follow incumbent rows. |
| MATERIAL | Match | Navy fields, fine borders and brass interaction states preserve the existing interface. |
| Per-bot settings | Match | Each friendly/enemy bot has its own labeled selection and adjacent explanation. |
| Player distinction | Match | The manual player retains its brass marker without an AI control. |
| Five levels | Match | Source defines Static target, Moving target, Easy, Normal and Hard; Normal defaults. |
| Accessibility | Match | Native 44px selects have unique labels, linked descriptions and visible focus styling. |
| Responsive layout | Match | Desktop columns and mobile stacked rosters show complete labels, values and descriptions without visible horizontal clipping. |

Review covered supplied captures and source. The reviewer did not independently exercise keyboard interaction, screen-reader output or runtime behavior. No new visual world, design tokens, imagery or comp was required for this extension; DESIGN.md remains the incumbent authority.
