# Research progression

Players unlock historical ship classes with XP earned in battle. There are four nation trees (United States, Japan,
Germany, United Kingdom) of one column per line, oldest class at the top. Locked ships can be previewed in port
but not sailed in the player's own fleet. Enemies and bots may be any ship.

## Where it lives

| Piece | File | Notes |
| --- | --- | --- |
| Tree data | `src/progression/techTree.ts` | Nations → lines → nodes. A node with `presetId` is a modelled ship; without one it is a placeholder ("not in the game yet"). Costs and starters are here |
| Unlock rules | `src/progression/rules.ts` | `ProgressProfile`, `nodeState`, `applyUnlock`, `applyAward`, `applyGrant`, `sanitizeProfile` |
| Battle XP | `src/progression/xp.ts` | `BattleSummary`, `awardFor`, `validateSummary`, tuning in `XP_RULES` |
| Browser store | `src/progression/store.ts`, `src/ui/useProgress.tsx` | Account store (API) or harness store (local); `canCommandPreset` is the one gating test |
| Battle summary | `src/progression/battleSummary.ts`, `src/ui/report/battleAward.ts` | Built from the settled debrief; claimed once per battle id |
| API | `services/api/progress.ts`, `services/db/migrations/003_progress.sql` | See [accounts](accounts.md#research-progress) |

`techTree.ts`, `rules.ts` and `xp.ts` are shared with the accounts API, which copies exactly those three files into
its image (`deploy/Dockerfile.api`, `.dockerignore`, `scripts/deploy-ships.sh`). They must import nothing outside
`src/progression/`.

## Rules

- **Ownership.** Starters are owned from the first visit; everything else is unlocked with XP. Unlocking a class owns
  it; there is no purchase step. Presets outside the trees (the fictional Valiant and Resolute, merchant ships) are
  enemy-only. Player designs are always allowed.
- **Prerequisites.** A node needs the nearest modelled node above it in its column. Placeholders never gate, so a
  column whose first modelled ship sits below placeholders can be unlocked directly (Iowa today).
- **Spending.** An unlock draws the node's nation XP first, then free XP. It is irreversible; the UI confirms first.
- **Earning.** Each decided Custom, Fleet command or 1v1 battle pays once. Sea trials and infrastructure or
  abandoned endings pay nothing. A 1v1's battle id is derived from its match and team, so reconnecting to a finished
  match cannot pay twice. For every enemy the award counts its value, `100·√(kilotonnes)`, times the enemy's
  weight: static and moving targets 0, Easy .6, Normal 1, Hard 1.3, a human 1.5. A sunk ship counts in full; a
  damaged one counts half its value times the share of hull lost. Time in battle adds 8 XP a minute at the enemies'
  average weight. The sum is scaled by √(enemy strength ÷ own strength), clamped to .3–1.5, so overwhelming force
  earns less, then by the outcome (victory 1.5, draw 1.15, defeat 1). An award is capped at 5,000. A tenth is free
  XP; the rest is split between nations by the share of the friendly fleet each fielded, and the share earned by
  player designs and ships outside the trees is free XP too.
- **Pacing (moderate).** A won destroyer duel against a Normal crew pays about 380 XP, a won cruiser battle about
  700 and Iowa sinking Yamato about 1,600. Destroyers cost 800–1,800, cruisers 1,500–3,000, battleships and carriers
  3,500–6,500.

## Where progress is kept

Signed-in players keep their profile on the accounts API. The server validates the reported summary and computes
the award itself, and a battle id pays once. The summary is still reported by the client, so XP is not proof of
play. If the API cannot be reached (for example, a development checkout proxying to a production that has not been
deployed yet), progress shows as unavailable and every tree ship stays sailable rather than locking players out.

The account-free harness owns every tree ship. `?progress=fresh` switches it to a local profile that starts with only
the starters and persists in the browser, so locked states can be tested
([browser verification](browser-verification.md)).

## Administration

Administrators change a player's research on the admin page, `/admin`: grant or remove XP in any pool, gift or
remove single ships, open every ship, or reset. Each change is logged. Promoting an account and the API are in
[accounts](accounts.md#administrators). In the harness, scripts change the local profile with
`window.harnessProgress.grant({ xp: 5000 })`, `{ unlockAll: true }` or `{ reset: true }`.

## Adding a ship to a tree

Give the placeholder node the new preset's id as its `id` and `presetId` (no player can own a placeholder, so the id
may change), check its year and cost, and run `bun test src/progression`: the tests require every roster preset to
be in exactly one tree or on the enemy-only list.
