# Battle status rules: narrow HUD extension review

Disposition: **ship within the isolated component review scope**. A fresh finish reviewer found no material fixes in the active and timeout renders; the review reached its quality ceiling for this scope. This does not establish full-game or multiplayer completion.

The reviewed surface is [BattleStatus.tsx](../../src/ui/BattleStatus.tsx) and the appended clock and tonnage rules in [FleetHud.css](../../src/ui/FleetHud.css). It extends the existing direction in [PRODUCT.md](../../PRODUCT.md) and [DESIGN.md](../../DESIGN.md): transparent naval instruments, compact Barlow labels and Barlow Condensed numerical readings, and space for the ship and sea. No new visual system decision is recorded here.

The clock pairs an explicit remaining-time label with a tabular numerical reading. Afloat tonnage labels Friendly and Enemy separately and includes tonnes (`t`). The timeout state retains these totals, shows the result and `00:00`, explains “30-minute limit reached,” and provides the return-to-port hint. The compact material treatment and these displayed states matched the intended extension in the reviewed renders.

| Evidence | Viewport | Observed state |
| --- | --- | --- |
| [Active](../../assets/reviews/battle-status-rules/active.png) | 1440 × 1000 | Time remaining `30:00`; Friendly 43,978 t and Enemy 769 t; collapsed fleet rows |
| [Timeout](../../assets/reviews/battle-status-rules/timeout.png) | 1024 × 768 | Victory; 30-minute limit reached; `00:00`; retained tonnage and collapsed fleet rows; Esc hint |

These are actual component renders on a plain maritime background. The retained screenshots are UI evidence, not ship model acceptance evidence. Reported DOM checks found no overflow at either size, with a 260 px battle-status width and inherited text color `rgb(240, 245, 243)`.

The actual GPU game remained in harbor loading in the isolated headless browser, and the Orca runtime was unavailable. Full-game composition over moving ship and sea, mobile layouts, expanded rosters and maximum tonnage totals remain unverified. The screenshots establish visual fidelity for the supplied component states; they do not verify battle timing, result calculation, runtime interaction or networking.
