# Hull feedback, score and binocular smoke

Review date: 2026-09-05. Runtime-only change; ship models and recipes are unchanged.

- Added overhead HP-loss numbers and gold health-loss segments, player hull-hit number and red perimeter cue, and actual enemy damage / frag counters.
- Removed the bottom Follow shells row and Ctrl/Shift/Esc hints. Weapon keycaps and the configurable T shortcut remain.
- Binoculars hide own-ship propellant, impact and detonation smoke. Hidden particles keep aging; other ships' smoke stays visible.

Validation:

- `bun test src/simulation src/game`: 162 passing tests. A subsequent regression test also passed for multiple shells reaching a destroyed hull in the same lethal tick (the later shell cannot steal the frag).
- `bun run build`: passes ship export checks, TypeScript and Vite. Vite reports the existing large runtime chunk warning.
- Actual development game in Orca, custom battle with two enemy Bismarcks: controlled shell sweeps through the real simulation yielded player HP 928, enemy HP 904 and a second enemy sunk at 0 HP. Live DOM showed Damage 1,096 / Frags 1 and confirmed both removed HUD rows were absent.
- Unit coverage checks salvo aggregation, hold/fade timing, paused feedback, reset/replacement behavior, actual HP damage, overkill, hostile credit, friendly fire, delayed flooding, duplicate frag prevention, and existing/new smoke suppression, restoration and expiration.

Limit: full visual screenshots and narrow-viewport inspection could not be completed. Orca's screenshot request timed out; its runtime subsequently returned `runtime_timeout`. The first controlled browser reset also reset presentation timing before the cue was sampled, so its expired gold segment does not establish an in-game animation check. Gold timing and smoke ownership are covered by automated tests; visual acceptance remains unverified.
