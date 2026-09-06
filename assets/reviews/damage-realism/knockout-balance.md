# Faster combat knockouts

**Historical experiment, superseded:** the primary-armament knockout rule from `67f5fc3` was subsequently removed at the user's request. Stronger AP damage remains. Surviving secondary guns keep fighting and no replacement status was added. The measurements below describe that earlier rule only; see [current behavior](disabled-turrets.md).

AP equipment strikes now spend 75% of nominal damage, up from 25%, across one shared projectile path. For Bismarck's 70-damage AP, that changes direct equipment damage from 17.5 to 52.5. Two clean penetrations can disable a 100-HP turret before burst damage or crew repairs. Entry and exit contacts do not multiply this budget. Armor, fuze timing, protected bursts, physical breaches and the flooding solver retain their existing rules.

Afloat defeat now requires permanent loss of the authored primary armament: main guns and torpedoes, including their magazine supply or usable ammunition. Secondaries cannot prolong a battleship's participation after that loss. A custom ship with only secondary guns uses those guns as its primary armament. Enough AP or HE for a complete mount salvo counts, regardless of which type is currently loaded. Temporary magazine flooding remains recoverable. Immobilization alone still allows fighting.

Knockout latches until reset. The ship stops firing, receives neutral helm orders, and remains afloat, solid and subject to damage control and subsequent sinking. Fleet counts, victory and frag attribution recognize that loss. Later hits cannot add score or steal the frag. HUD labels explicitly show `knocked out`; remaining equipment HP does not keep the ship in battle.

## Controlled before/after measurement

Baseline simulation: commit `43662ad` (combat code unchanged from `dd73d1b`). The same harness was run against an extracted baseline source snapshot and the changed simulation. Published definitions were identical.

Each engagement uses Bismarck firing main-battery AP at a stationary broadside target 5 km away, with normal dispersion, armor, crews and flooding. There is no return fire. Runs stop at knockout/sinking or 300 simulated seconds. Seeds: `12345`, `42`, `2026`. Turret aim follows the first surviving mount with available magazine supply. Hull aim uses the existing target-waterline point. Hit counts are distinct projectiles contacting the target, including ineffective hits; they are not shots fired or equipment contacts.

| Target / aim | Before: result in three runs | After: result in three runs |
| --- | --- | --- |
| Bismarck / turrets | No knockout after 300 s and 65–87 hits | Knockout after 81.7–121.7 s and 18–24 hits |
| Baltimore / turrets | No knockout after 300 s and 52–57 hits | Knockout after 41.6–101.7 s and 11–20 hits |
| Yamato / turrets | Knockout after 201.6–261.6 s and 41–47 hits | Knockout after 61.4–61.6 s and 13–16 hits |
| Bismarck / waterline | No knockout after 300 s and 66–78 hits | No knockout after 300 s and 66–78 hits |
| Baltimore / waterline | No knockout after 300 s and 59–72 hits | No knockout after 300 s and 59–72 hits |

The original seed-12345 Bismarck turret comparison improves from still fighting after 120 shells fired / 65 hits / 300 seconds to knocked out after 48 fired / 24 hits / 121.7 seconds. Eight projectiles actually damage equipment in the new run. The ship remains afloat, with 87.4% aggregate equipment condition and its secondary battery physically intact.

These changes reward hits on important equipment. Waterline fire still often crosses empty space or stops at internal protection; increasing equipment damage cannot make those paths hit machinery. Sinking has not been accelerated artificially. All gun mounts currently share 100 HP, so turret count and authored protection strongly affect these results; this is not a historical ranking of the ships. Moving targets, range, return fire and player accuracy will change battle duration. Three seeds are a focused balance check, not a fleet-battle distribution.

Reproduce the current measurements from the repository root:

```sh
bun scripts/diagnostics/combat-lethality.ts 12345 42 2026
```

The script emits JSONL with shot counts, hit counts, damage, ship state, minute checkpoints and stopping surfaces. Raw evidence: [before](knockout-before.jsonl), [after](knockout-after.jsonl).

## Validation

Regression coverage includes main-gun and magazine knockouts, intact secondaries ceasing fire, neutral helm orders, friendly ships continuing battle, single-turret survival while immobile, temporary magazine flooding and recovery, usable HE ammunition, incomplete mixed-ammunition salvos, secondary-only custom ships, torpedo capability, one-frag attribution through later sinking, reset and visible HUD status. Existing AP tests retain protection and shared damage-budget checks.

Bot observation tests now hold guns in reload to silence them. Their former zero-ammunition setup now correctly knocks the bot out and stops its controller.

No ship definitions, geometry or recipes changed; asset rebuilds are unnecessary. Production build includes checks of all five published ships and the aircraft assets.

`bun run test`: 382 passed, 0 failed across 49 files. `bun run build`: passed (all ship/aircraft checks, TypeScript and Vite); the existing large-bundle warning remains.
