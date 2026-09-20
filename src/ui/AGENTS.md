# Working on the HUD, port and battle UI

- Read the quick reference at the top of [DESIGN.md](../../DESIGN.md) before styling. Extend the naval instrument
  styling, keep the ship and sea visible, and use the controls in [components/](components/README.md) before
  writing a new button, select or dialog.
- Files: `App.tsx` owns phases (port, battle, editor) and the `Game` instance. `Garage.tsx` is the port. `battle/`
  is the battle board (custom battle, fleet command, 1v1). `FleetHud.tsx`, `FleetCommand.tsx` and `fleet/` are the
  in-battle fleet UI. `AirOperations.tsx`, `FlightLine.tsx` and `CarrierDeck.tsx` are carrier UI. Battle key
  bindings live in `src/game/keybindings.ts` (`INPUT_ACTIONS`), not in components.
- The HUD reads telemetry at 10 Hz from `src/game/session/telemetry.ts`. Components do not reach into the
  simulation or the renderer; add a telemetry field instead.
- A new DOM layer drawn over the sea must join the `--hud-scale` rule in `styles.css`
  (`.hud-viewport, .ocean-viewport :is(...)`), or it will sit in the wrong place at any HUD size but 100%.
- CSS is one file per component beside it. Global rules in `styles.css` leak: `.primary-button, .secondary-button`
  set `width: 100%`, and `.shipbuilder button` rules outrank component classes. Check computed styles in a capture.
- `overflow: hidden` on text inside a scroll container drops wheel events in the live app; use `overflow: clip`.
- Tests render with `renderToStaticMarkup` beside the component. Historical ship names render in capitals
  (`shipTitle`); player designs keep their case.
- See the change in the real game with `bun run ui:shot` ([browser verification](../../docs/browser-verification.md)).
  A passing unit test is not a visual check.
