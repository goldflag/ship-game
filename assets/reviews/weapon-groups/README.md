# Direct weapon groups — 2026-09-07

Player weapons now use direct, rebindable slots in fitted order. Main guns precede
secondary guns (descending caliber), torpedoes and depth charges. Matching firing
profiles share a group even when turret barrel counts differ; damage and ammunition
never remove or reorder slots. Existing definitions and authored models are unchanged.

Validation:

- `bun run build`: passed ship and aircraft asset checks, TypeScript, and Vite.
  Vite still reports its large-chunk advisory.
- Broader simulation and related game tests: 484 passed across 53 files.
- Focused game/HUD/input checks: 38 passed across four files.
- Final group regression tests: eight passed, including distinct same-caliber
  profiles, mixed main-turret layouts, isolated firing and AP/HE stocks, invalid
  selection, manual AA versus automatic neighbors, and torpedo/depth-charge types.
- Orca embedded browser, live Bismarck battle: dispatched keys 1, 2, 3, 4, 5, 3
  through browser keyboard events. The CPU reported the expected 4/6/8/8/12/8
  mounts and weapon names. See `live-key-selection.json`.
- Desktop capture: `bismarck-desktop.png`, 1189 × 916 CSS viewport. Captured while
  paused with the pause dialog temporarily hidden to avoid WebGPU screenshot
  timeouts, then restored. Weapon groups, selected 105 mm mounts, compass marks,
  ship and sea remain visible.
- Live Enterprise layout: all three gun groups are visible above the aircraft
  commands, without overlap; the center sight remains clear. See
  `carrier-bounds.json`.
- Narrow layout: at 390 × 844 CSS pixels all seven weapon/utility buttons fit
  within the viewport in two rows. Recorded `mobile-bounds.json`; mobile screenshot
  capture timed out in Orca, so visual appearance at that size is not certified.
- Impeccable's mechanical detector reported existing palette advisories and the
  existing compass triangle border styles; no new colors or border treatments
  were added by this change.

The first ten groups have default keys 1–9 and 0. Extra future groups remain
clickable in the HUD. Saved category shortcuts migrate to slots 1–4; other
custom keys are retained and new slots avoid conflicts. The same number can
represent different weapon types on different ships, as shown by the HUD.

## PR integration

Merged current remote master (`230c9974`) before opening the PR. Preserved its
queued shell changes and interpolated gun-aim markers. Shell orders and the
300 ms double-press window now belong to individual weapon groups; switching
groups clears the double-press window. Orders continue to apply to unselected
groups without changing their neighbors' stocks or reload progress.

After integration, `bun run build` passed all asset checks, TypeScript and Vite;
76 focused tests passed across the Game, GameFrame, FleetHud, ShipView, gunAim,
weaponGroups and ammunition suites. Prior browser evidence above predates this
integration; the integration-specific behavior is covered by those tests.
