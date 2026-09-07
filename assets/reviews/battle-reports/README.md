# Minimal battle reports HUD

Damage / Frags has a transparent damage history beneath it: three single-line entries on desktop, two on compact screens. Each shows the weapon, other ship and signed damage. Hold Ctrl to scroll the latest 40 entries; hover for time, direction and hit count. The log has no heading, frame, background or empty-state message. It groups actual hostile hull damage by weapon, source and target within one second, counts projectiles once across damage surfaces, and resets with the battle.

Two small Friendly / Enemy rows show in-action/starting ships, damaged survivors and permanent losses. Selecting a team replaces the target selector with a short inline roster showing individual hull percentages and vessel status. Enemy names select targets. Rosters are mutually exclusive and scroll within a fixed footprint.

Sailing panels, buttons, keycaps, chart and aiming labels have transparent backgrounds, including selected and hover states. Screen-edge shading and the damage vignette are removed. Text shadows, instrument outlines and quantitative meters remain. Port and pause dialogs retain their own surfaces.

## Validation

- Full simulation suite: `bun test src/simulation --timeout 20000`, 333 passed. The existing Yamato wing-space flooding fixture needs more than Bun's default five seconds on this machine; no assertions or test thresholds were changed. Simulation code did not change during the minimal UI revision.
- Initial focused simulation and HUD suite: 69 passed, covering weapon attribution, score reconciliation, overkill, bombs, torpedoes, depth charges, grouping, bounds, resets and team state.
- Minimal revision: `bun test src/game/FleetHud.test.tsx src/simulation/damageLog.test.ts src/simulation/score.test.ts`, 14 passed.
- `bun run build`: passed asset checks, TypeScript and Vite. Vite retains its large-chunk warning.
- Live browser checks exercised real battle setup, incoming main/secondary damage, damage-history scrolling and enemy roster target selection. No browser errors were recorded. Computed-style checks found no filled HUD surfaces in the captured views.
- Desktop damage history is 54 px tall and the default team readout is 71 px tall. Mobile history is 36 px tall. Measurements and interaction results are retained in `browser.json`.
- `desktop.png` and `desktop-roster.png`: 1440 × 900; `mobile.png`: 390 × 844; `landscape.png`: 844 × 390. These show a live Bismarck battle with a friendly Bismarck against Bismarck and Yamato.

Orca's embedded browser supported live checks but its screenshot capture timed out. Captures used a separate headless Chrome process on port 5179. They cover the Bismarck HUD; carrier and depth controls received transparent styling but were not separately captured. Existing overhead ship labels may overlap one another. No models, combat damage rules or renderer ownership changed.
