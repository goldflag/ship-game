# Gameplay damage balance — 2026-09-06

The requested pacing is more than one eight-shell broadside of survivability, with a decisive exchange taking a handful of good volleys. The earlier equipment-only meter allowed many penetrating hits to remove almost no displayed condition. Hull penetrations now remove finite gameplay durability even when their paths miss all local equipment.

This calibration supersedes the equipment-only scoring/sinking behavior described in the earlier damage reviews. It does not claim historical shell-hit tolerance or simulate structural fracture. Ship definitions, armor schedules, geometry, reload, dispersion and flooding aperture sizes are unchanged.

## Calibration

Shared displacement HP: Yamato 1,750; Bismarck 1,450; Enterprise 1,180; Baltimore 1,020; Type VIIC 450. The existing displacement curve now sets actual hull durability, independently of local equipment health.

| Contact | Hull damage from Bismarck's 70-point 38 cm AP |
| --- | ---: |
| Miss, ricochet or armor rejection | 0 |
| Thin through-shot | 10.5 |
| Substantial penetration / burst inside penetrated hull | 45.5 |
| Direct equipment strike | Up to 59.5 |

Entry, exit, internal layers and delayed burst share one ceiling per shell per victim, including across ticks. A burst damaging exposed equipment can still hurt the hull even when the projectile itself is stopped; intervening heavy armor blocks that damage. AP uses its authored fuze arming resistance to distinguish thin plating from substantial penetrations. Local AP kinetic damage remains 75% of nominal; armor-protected bursts retain their separate local effects.

HE contact penetrating light plate removes 35% of its nominal damage; exposed equipment burst damage can upgrade that to at most 50%. HE cannot transmit damage through heavy protection. Armed torpedoes remove their listed hull damage once, alongside existing module damage and positional breaches: a 340-point G7a takes five hits to exhaust Bismarck's hull HP and two for Type VIIC, absent earlier flooding or combat loss. Duds do no damage.

Hull exhaustion starts the existing CPU sinking pose with cause `hull-failure`. Flooding, capsize and permanent loss of all usable weapons remain independent loss paths. Surviving secondary guns keep fighting while the ship retains hull HP. Equipment repairs do not restore hull durability. HUD bars and Damage scoring track actual hull HP removed; Gunnery has separate Hull and Equipment readings and separate impact values. Overkill and damage after loss earn no additional score; each loss awards one frag at most.

## Measurements

`bun scripts/diagnostics/broadside-damage.ts` produces [the controlled impact record](gameplay-broadside.json): eight landed waterline rounds, eight penetrations, **364 hull damage (25.1%)**, **100% equipment remaining**. The fixed-tick regression repeats this pattern and sinks Bismarck on the fourth eight-shell broadside. All eight initial hits are survivable.

`bun scripts/diagnostics/combat-lethality.ts 12345 42 2026` produces [all 15 seeded runs](gameplay-balance.jsonl). Bismarck fires its main battery at a stationary broadside target at 5 km, using normal dispersion, reload, armor, crews and flooding; the target does not return fire. Time includes initial gun training and shell travel. Turret aiming selects the next surviving usable gun.

| Target / aim | Volleys fired | Landed hits | Time to loss | Result |
| --- | ---: | ---: | ---: | --- |
| Bismarck / waterline | 7–8 | 36–42 | 142–162 s | Hull failure |
| Bismarck / turrets | 7–8 | 33–40 | 141–162 s | Hull failure |
| Baltimore / waterline | 7–9 | 34–44 | 142–182 s | Hull failure |
| Baltimore / turrets | 6–8 | 25–27 | 121–162 s | Hull failure |
| Yamato / turrets | 7–9 | 29–40 | 141–181 s | All weapons lost, 15–39% hull remaining |

Light plating can let battleship AP pass through for reduced damage, so lower-HP Baltimore does not always fall sooner when firing at its waterline. Armor angle, range, evasive movement and return fire will change battle duration; these are controlled gunnery measurements rather than a guarantee for every match.

## Validation

Regression coverage includes broadside survivability and eventual sinking, armor rejection, thin plating, per-shell damage caps across layers/ticks/bursts, separate hull/equipment telemetry, HE protection, torpedo arming, secondary-gun survival, scoring, friendly fire, kill attribution, flooding, reset and bot evasive reactions. - `bun run test --timeout 60000`: **450 passed, 0 failed** across 57 files. The longer timeout accommodates existing CPU-heavy flooding and bot tests.
- `bun run build`: **passed**, including all five ship checks, aircraft checks, TypeScript and Vite. The existing large-chunk warning remains.
- Orca browser using this worktree's Vite server: one landed broadside displayed **Damage 364, Hull 75%, Equipment 100%, Frags 0**. Four displayed **Damage 1,450, Hull 0%, Frags 1, Victory**, with the target marked sunk. See [desktop HUD evidence](gameplay-hud-browser.json) and [sinking result](gameplay-sinking-browser.json).
- At **1137×906** and **390×844**, the separate condition readings and Return to ship control fit the viewport, with no horizontal page overflow. See [narrow-viewport evidence](gameplay-hud-mobile.json). Full-page screenshot capture timed out in the embedded browser, so these UI checks use live DOM text and geometry rather than a completed screenshot review. The browser also emitted a Three.js depth-format warning; renderer code was unchanged.
- `git diff --check`: passed.

## Master integration

Merged master `3e58102` into the balance branch, preserving its convoy presets, carrier deck operations, shell visibility and smoke fixes. The combined tree passes **494 tests across 61 files** with `bun run test --timeout 60000`, and `bun run build` passes all registered ship/aircraft checks, TypeScript and Vite. The existing large-chunk warning remains. The controlled broadside, armor, scoring and separate hull/equipment regressions pass in this combined tree.
