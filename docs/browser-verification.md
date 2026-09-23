# Browser verification

Use the account-free harness to see a change in the real game. Do not write a temporary diagnostics page or a new Playwright launcher; extend `scripts/browser/harness.ts` instead.

## One command, one image

```sh
bun run harness:designs                                   # once per machine: cache the test account's saved designs
bun run ui:shot -- --list                                 # saved designs, their battle ids, or why one cannot launch
bun run ui:shot -- --state port --design "Fletcher design"
bun run ui:shot -- --state editor --design "Fletcher design" --out .build/shots/editor.png
bun run ui:shot -- --state editor --design "Fletcher design" --settle
bun run ui:shot -- --state battle --battle "Battleship design;fletcher;bismarck:easy,yamato" --range 8000 --param bearing=90 --wait 6
```

`--settle` (editor only) waits for the editor's in-browser design check to finish before capturing, then prints the chip's own status (`No warnings`, `1 block · 2 warnings`), the block and warning counts, every finding, and the ledger as it reads on screen. Without it the image can show the previous revision's readings while the check is still running — about 30 s on the dev WASM build for a large design. The checks panel is opened to read the findings and closed again, so the capture shows the editor as it was. `designCheck(page)` in `scripts/browser/harness.ts` is the same wait for a script.

Images land in ignored `.build/shots/`. `--viewport WxH` defaults to 1728x1030, `--eval "<js>"` runs in the page before the capture (`review.game` is the live `Game`), `--param key=value` passes any page parameter, and `--url http://127.0.0.1:5200` reuses a running dev server instead of starting one on a free port.

## The page

`/scripts/diagnostics/app.html` renders the real `<App/>` without `AccountGate`. With no account the ship library is IndexedDB, which the page seeds from the cache written by `bun run harness:designs` (`.build/harness/designs.json` in the main checkout, shared by every worktree and served at `/__harness/designs.json`). Nothing on the page talks to the accounts service. Rerun `harness:designs` after saving new designs in the real game. It needs `NAVAL_TEST_EMAIL` and `NAVAL_TEST_PASSWORD` in the main checkout's `.env.local`.

| Parameter | Meaning |
| --- | --- |
| `designs` | `all` (default), `none`, `keep` (leave the local library as it is) or a comma list of names or source ids |
| `battle` | `player;friend,friend;enemy,enemy`. Each ship is a preset id, a saved design's name or a `local-…` id; `:easy`, `:normal` or `:hard` sets a bot's AI. The page drives the real battle dialog and replaces only the roster |
| `range`, `bearing` | Spawn distance in metres (default 5000) and the enemy line's bearing in degrees clockwise from the player's bow (default 0, dead ahead, which is outside most torpedo arcs) |
| `map`, `time`, `weather`, `hours`, `cloud`, `wind`, `formation` | Passed to `BattleSetup` |
| `focus=real`, `pointerlock=real`, `sortie=board` | Turn off the defaults: blur and visibility changes are swallowed so a background window does not pause the game, pointer lock is faked so battle input arms under automation, and the sortie board is skipped |

`window.review` holds `ready`, `inBattle`, `game`, `errors`, `designs` (`name`, `sourceId`, `shipId` or `issue`) and the effective `battle` setup.

### Horizon rendering check

This checks the Sky Pro comparison's local horizon patch, so it needs the Sky Pro renderer: switch it
first (Shift-D, **Switch sky renderer**, which rebuilds the port), or start the harness with saved
graphics `skyRenderer: 'skypro'`. On the ready battle harness page, run
`await (await import('/scripts/browser/sky-horizon-check.ts')).checkSkyHorizon(review.game)`
to read back Sky Pro's real GPU sky LUT. It checks increasing horizon lift, an unchanged
upper sky and palette, dusk/night preservation, and restoration after switching.
The game uses a 0.8 attenuation correction, tapered across the lowest 6° of
daylight sky. The check restores the scene's weather and correction afterward.

## Driving it from a script

```ts
import { launchHarness, openEditor, shot } from '../browser/harness';
const harness = await launchHarness({ params: { designs: 'fletcher' } });
try { await openEditor(harness.page, 'Fletcher design'); await shot(harness.page, '.build/shots/editor.png'); }
finally { await harness.close(); }
```

`launchHarness` also takes `args` (extra Chromium switches, such as `--disable-gpu-vsync --disable-frame-rate-limit` to time frames past the display refresh), and the returned `console` collects console errors and warnings from the first navigation on, including WGSL compile failures that never throw.

What the driver already handles, so a script need not:

- Headless Chromium reaches the port but its WebGPU frame loop stalls. The driver launches headed.
- `page.screenshot()` blurs a headed window, which cancels editor drags, ghosts and tooltips. `shot()` captures through CDP.
- Each run starts its own Vite server on a free port, so it cannot collide with another worktree's dev server.
- Judge a running battle by simulation ticks, not the FPS readout; a paused game still reports 120 FPS.

## Known-red tests and checks

`bun run test` prints only failing files (bounded to 160 lines, 400 columns) and one summary line. Its exit status reflects failures that are not in `scripts/tests/known-failures.json`, so a failure you see is yours. `bun run test -- --known` lists the ledger, `--verbose` restores full output and `--record-known` rewrites the ledger from a run on a clean master. Fix and remove entries rather than adding to them; the runner names entries that no longer fail.

`bun run ship:browser:check` runs every registered check even after one fails, and reports checks listed in `scripts/construction/known-browser-failures.json` as known red. `--list` shows registered and unregistered checks, and `--only <name>` or `--only <file>#<export>` runs one.
