# Compact shell cycle

The owner selected **C — Cycle control** from the three layout studies. The production HUD now places the selected AP/HE type, cycle arrows and the rebindable shortcut beside the weapon slots. It removes the separate shell cards and permanent help line while retaining the existing naval instruments.

Hover or keyboard focus exposes both stocks and the full reload cost. Escape dismisses that tooltip without pausing the game. Empty or unsupported alternatives cannot be selected, but the control stays focusable for stock inspection. Enter and Space activate the focused control. Mouse activation releases focus so normal ship shortcuts resume. On macOS, Ctrl + primary click is handled as the same action when the browser emits `contextmenu` instead of `click`.

Main and secondary choices still use `Game.selectAmmunition`. Changing type retains its full reload, switching back cannot skip loading, and returning to port restores AP. Gunnery retains direct AP/HE buttons and shell descriptions. The cycle control is absent for torpedoes and depth charges. Keeping it beside the existing weapon row preserves Fletcher's four-column layout at intermediate widths.

The throwaway comparison components, variant switcher and development entry hook have been removed. The choice is implemented directly in `FleetHud` and `ShellCycle`; no combat balance, simulation or ship definition changed.

## Evidence

| Capture | Provenance |
| --- | --- |
| [Desktop battle](cycle-desktop.png) | Actual WebGPU Bismarck battle at 1440 × 900, showing HE selected. |
| [Mobile battle](cycle-mobile.png) | Same game at 390 × 844, using the automatic HUD scale. |
| [Stock tooltip](cycle-tooltip.png) | Actual battle after Ctrl-clicking to HE, with the control focused. |
| [Fletcher intermediate](fletcher-medium.png) | Real production HUD in a labeled layout fixture at 600 × 750. Preserves the weapon grid and AP-only gun state. |
| [Fletcher mobile](fletcher-mobile.png) | Production HUD fixture at 390 × 844 with all weapon choices. |
| [Fletcher short landscape](fletcher-short.png) | Production HUD fixture at 844 × 390. |
| [Depth charges](fletcher-depth.png) | Fixture verifies that selecting depth charges removes the shell cycle control. |
| [Empty HE](empty-he.png) | Fixture with HE exhausted: selection is unavailable and stocks remain keyboard-inspectable. |
| [Chosen C study](C-desktop.png) | Archived prototype, with a frozen Bismarck background and native browser chrome. Predates production implementation. |
| [Previous layout study](current-desktop.png) | Archived comparison baseline from the same prototype window. |

Layout fixtures reuse the unmodified [sky-daylight sea image](../sky-daylight/sea-after.png); the background is Bismarck even when the HUD fixture selects Fletcher. These images verify HUD layout, not the rendered hull or live combat. The isolated browser checks assert that weapon controls remain inside the viewport and do not overlap. Orca's browser-tab and desktop captures were unreliable during production review, so final captures use a separate headless Chromium instance without the user's browser profile.

## Validation

Integrated with `master` at `b2a58055`, preserving its wider optics view and wind-driven smoke. The short-landscape CSS conflict retains both the optics rules and the shared weapon-slot height.

- **93 tests passed**, 4,882 assertions across game state, HUD, input, keybindings, HUD scaling, ammunition, combat, weapon capability, combat effects and battle environments.
- **`bun run build` passed**, including all roster ship and aircraft checks, TypeScript and Vite. The existing oversized vendor-bundle warning remains.
- Actual-game checks cover macOS Ctrl-click to HE, tooltip stock values, Escape dismissal without pause, the E shortcut and independent battery choices.
- Production-component fixture checks cover Enter/Space cycling, disabled selection with keyboard stock inspection, and medium, mobile and short-landscape weapon layout.
- The mechanical design scan's marker-border findings and compact-type advisories were reviewed against the incumbent HUD. The new control uses its existing colors, typography and square instrument style.

No model assets were authored or rebuilt. AP/HE balance and historical approximations retain their existing status.
