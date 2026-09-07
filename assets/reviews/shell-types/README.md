# Shell types HUD review

The battle HUD now exposes the existing AP and HE ammunition system above the weapon slots. The selectors extend the incumbent naval instruments: transparent controls, thin borders, condensed numerals and a mint selected state keep the ship and sea visible.

- Choose **AP — Armor piercing** or **HE — High explosive**, or use the rebindable **E** action. Hold Ctrl to click during mouse capture.
- Main and secondary batteries retain independent selections. Changing type starts a full reload, including switching back during loading; switching does not consume or create ammunition.
- Each selector shows its separate finite stock. Weapon and mount counters show rounds available for their current load, including AP fallback for guns without HE.
- Empty or unsupported choices are disabled. The HUD explains the reload cost, marks exhausted stock and exposes selection through `aria-pressed` and keyboard focus.
- Returning to port restores ammunition and AP selection. Existing custom keybindings survive addition of the new action.

On narrow screens, the gun controls omit the separate turret row and battery heading; **G** still opens detailed readiness. Reload countdowns have been reduced and separated from ammunition counts after the first mobile review identified an overlap.

## Evidence

| Capture | Provenance and status |
| --- | --- |
| [Desktop](desktop.png) | Actual WebGPU Bismarck battle; 1200 × 750 CSS viewport, captured at 1440 × 900. |
| [Mobile reload fixture](mobile.jpg) | Corrected production HUD at approximately 390 × 844 CSS pixels, captured at 427 × 924. Uses the real FleetHud component and simulation telemetry with a fixed 12 s HE reload; explicitly labeled as a layout fixture. |
| [Mobile before correction](mobile-before.jpg) | Actual battle at 390 × 844 and 1.2 scale; retained to show the original reload/count overlap. |

## Validation

The relevant game, input, HUD, wake and simulation tests passed: **112 tests across 14 files, 4,155 assertions, zero failures**. Coverage includes independent battery selection, finite stocks and reload behavior, AP fallback, selected-load telemetry, unavailable choices, input guards, keybinding migration, HUD scaling and fleet wakes.

`bun run build` passed, including checks for all eleven ships and thirteen aircraft, TypeScript and the production bundle. The existing warning about the oversized vendored bundle remains.

PR integration against `master` at `975ce251` passes the focused suite and build. The mobile gun-controls conflict preserves container-relative sizing for automatic HUD scaling and the compact shell-selector layout. A duplicate funnel-smoke test adapter introduced by the merge was removed. The screenshots above predate this integration; no new visual capture was made for the conflict resolution.

Final visual verdict: **pass**. The original reload/count overlap is resolved. The correction was checked in the labeled fixture because live preview contexts repeatedly reloaded during capture; earlier WebGPU images establish in-game composition. No final DOM bounds verification is claimed.

| Contract | Verdict |
| --- | --- |
| Thesis | Pass — shell selection stays immediately accessible. |
| Own-world | Pass — incumbent naval styling preserved. |
| Story | Pass — shell names, stocks and reload cost are legible. |
| First viewport | Pass — selector preserves the established clear layout. |
| Form | Pass — bounded HUD extension with the identified overlap fixed. |

The ship definitions, shell balance and AP/HE damage simulation are unchanged. No model assets were authored or rebuilt for this HUD extension. HE fill, fragment budget and stock split remain provisional gameplay calibration; this review makes no historical-accuracy claim.
