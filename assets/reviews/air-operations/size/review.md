SUPERSEDED: the 0.8 scale experiment below was removed in favor of authored dimensions and wing folding. These images are retained as comparison history.

# Aircraft presentation size

Same-camera captures from `scripts/diagnostics/carrier-deck.html`, using the published Enterprise and aircraft GLBs with the combat AircraftView renderer. Before: unit scale. After: uniform 0.8 visual scale. All 18 parked aircraft remain visible; no GPU validation error was reported. This diagnostic scene omits the ocean.

The source exports already measure wingspans of 11.58 m (Wildcat), 12.65 m (Dauntless), and 15.24 m (Devastator). The reduction is gameplay presentation, not a correction to historical asset dimensions. Tyre-datum anchoring and the individual follow camera account for the visual offset in every phase. Wings remain extended.

Validation: 18 aircraft simulation, renderer and follow-camera tests passed; `bun run build` passed, including published ship and aircraft checks. The renderer test checks tyre contact on a translated, pitched and rolled carrier.
