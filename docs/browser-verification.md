# Browser verification

Use the account-free harness to see a change in the real game. Do not write a temporary diagnostics page or a new Playwright launcher; extend `scripts/browser/harness.ts` instead.

## One command, one image

```sh
bun run harness:designs                                   # once per machine: cache the test account's saved designs
bun run ui:shot -- --help                                 # every flag, before anything is built
bun run ui:shot -- --list                                 # saved designs, their battle ids, or why one cannot launch
bun run ui:shot -- --state port --design "Fletcher design"
bun run ui:shot -- --state editor --design "Fletcher design" --out .build/shots/editor.png
bun run ui:shot -- --state editor --design "Fletcher design" --settle
bun run ui:shot -- --state battle --battle "Battleship design;fletcher;bismarck:easy,yamato" --range 8000 --param bearing=90 --wait 6
bun run ui:shot -- --design Scharnhorst --camera bowQuarter --freeze 60 --hud off --out .build/shots/a.png   # repeatable frame
bun run ui:shot -- --state battle --battle "fletcher;;bismarck" --battery main --camera broadside --hud off
```

`--settle` (editor only) waits for the editor's in-browser design check to finish before capturing, then prints the chip's own status (`No warnings`, `1 block · 2 warnings`), the block and warning counts, every finding, and the ledger as it reads on screen. Without it the image can show the previous revision's readings while the check is still running — about 30 s on the dev WASM build for a large design. The checks panel is opened to read the findings and closed again, so the capture shows the editor as it was. `designCheck(page)` in `scripts/browser/harness.ts` is the same wait for a script.

Images land in ignored `.build/shots/`. `--viewport WxH` defaults to 1728x1030, `--eval "<js>"` runs in the page before the capture (`review.game` is the live `Game`), `--param key=value` passes any page parameter, and `--url http://127.0.0.1:5200` reuses a running dev server instead of starting one on a free port. Flags are read before `multiplayer:prepare:dev` runs, so `--help` and a mistyped flag cost nothing; `--no-prepare` skips the prepare step when content and the dev WASM are current.

The game view (port and battle) takes a held camera and a frozen scene:

| Flag | Effect |
| --- | --- |
| `--camera <preset>` | `bow`, `bowQuarter`, `broadside`, `sternQuarter`, `astern` or `top`, at distances in hull lengths, or `azimuth,elevation[,metres]` (degrees clockwise from the bow and above the horizon) about the hull's centre |
| `--eye x,y,z --target x,y,z` | An eye and target in the hull's own frame: metres, +X starboard, +Y up, −Z bow, about her waterline and heading. The camera does not heave, roll or pitch with her |
| `--fov <deg>`, `--ship <id>` | The held camera's lens, and the ship it is held on (a motion id; default the player's) |
| `--freeze <s>`, `--history <s>` | Hold the berth's ride, the waves, clouds, funnel smoke and the battle at that sea time, after replaying `--history` seconds (default 30) of foam, wake and smoke with every hull held where it stands. Two port runs frozen at the same time render the same frame (two runs differed by at most 3 of 255 levels in any channel): master against a branch differ only where the code does. In a battle the hulls stay where the simulation had them when it froze, which differs run to run |
| `--hud off` | Hide instruments, port panels and labels, and the torpedo sheets drawn on the sea |
| `--battery <name>` | The weapon group the battle opens on. Destroyers otherwise open on torpedoes, whose arc sheets cover the sea |

Every capture waits for the camera to arrive first: an optics glide takes about 0.42 s, and a read taken mid-glide sees the wrong camera. With `--design` the command prints which revision the cache holds and how old the cache is; past 12 h it says so, and `bun run harness:designs` fetches the latest.

`ui:shot` exits 1 on a page error or a WebGPU validation error (`--allow-gpu-errors` reports them without failing), and past `--deadline` seconds (default 900) it kills its browser and exits.

## The page

`/scripts/diagnostics/app.html` renders the real `<App/>` without `AccountGate`. With no account the ship library is IndexedDB, which the page seeds from the cache written by `bun run harness:designs` (`.build/harness/designs.json` in the main checkout, shared by every worktree and served at `/__harness/designs.json`). Nothing on the page talks to the accounts service. Rerun `harness:designs` after saving new designs in the real game. It needs `NAVAL_TEST_EMAIL` and `NAVAL_TEST_PASSWORD` in the main checkout's `.env.local`.

| Parameter | Meaning |
| --- | --- |
| `designs` | `all` (default), `none`, `keep` (leave the local library as it is) or a comma list of names or source ids |
| `battle` | `player;friend,friend;enemy,enemy`. Each ship is a preset id, a saved design's name or a `local-…` id; `:easy`, `:normal` or `:hard` sets a bot's AI. The page drives the real battle dialog and replaces only the roster |
| `range`, `bearing` | Spawn distance in metres (default 5000) and the enemy line's bearing in degrees clockwise from the player's bow (default 0, dead ahead, which is outside most torpedo arcs) |
| `map`, `time`, `weather`, `hours`, `cloud`, `wind`, `formation` | Passed to `BattleSetup` |
| `seed` | The battle's seed, and so its combat sea; random when absent. `ui:shot` and the effects review fix it at 1941 |
| `battery` | The weapon group the battle opens on: `main`, `secondary`, `torpedo`… |
| `hud=off` | Hide everything over the 3D view once the port or battle is ready. A script that still clicks the UI calls `review.setHud(false)` afterwards instead |
| `focus=real`, `pointerlock=real`, `sortie=board` | Turn off the defaults: blur and visibility changes are swallowed so a background window does not pause the game, pointer lock is faked so battle input arms under automation, and the sortie board is skipped |

`window.review` holds `ready`, `inBattle`, `game`, `errors`, `designs` (`name`, `sourceId`, `shipId` or `issue`), the effective `battle` setup and `stage`, what the page is doing now (a loading-screen stage or a battle-dialog step). It also offers:

| Member | Use |
| --- | --- |
| `placeCamera(pose?)` | Hold the camera on a hull: a preset name, `{ preset, ship?, target?, fov? }`, `{ eye, target?, fov?, ship? }` or `{ azimuth, elevation, distance?, target?, fov?, ship? }` (`scripts/browser/cameraPoses.ts`). No pose gives it back to the rig. The game side is `Game.placeCamera`; do not reach into the rig's private fields |
| `freezeScene({ time, history })` | `Game.freezeScene`: hold every presentation clock at `time` seconds of sea after a `history`-second replay; `false` lets them run. Place the camera first, since smoke detail follows it. Underway, the replay fades the wakes astern; `history: 0` keeps them and whatever foam the sea had |
| `settle({ frames })` | Resolve once no camera glide, zoom or orbit is easing (`Game.cameraSettled`), then after `frames` rendered frames |
| `setHud(visible)` | Show or hide everything drawn over the 3D view |
| `three`, `tsl` | The game's own `three/webgpu` and `three/tsl`. `page.evaluate(() => import('three/webgpu'))` does not resolve |

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
import { berth, freezeScene, placeCamera, shot, withHarness } from '../browser/harness';
await withHarness({ params: { designs: 'fletcher' } }, async ({ page }) => {
  await berth(page, 'Fletcher design');
  await placeCamera(page, 'bowQuarter'); await freezeScene(page, { time: 60 });
  await shot(page, '.build/shots/fletcher.png');
});
```

`withHarness` launches, runs the callback, closes and exits the process: 1 when anything threw or the page recorded errors, 0 otherwise. Finished scripts used to linger for hours on a browser or dev server that would not close; use it rather than `launchHarness` with your own `try`/`finally`. Its `deadline` (seconds, default 900, `Infinity` for a server) kills the browser and exits past that time whatever the callback is waiting on, and `exit: false` returns instead of exiting.

Every launch stage has a deadline (`DEADLINES`: dev server and browser 90 s, page load 180 s, port or battle ready 300 s, close 30 s; `deadlines` overrides them). The driver prints a line per stage with elapsed seconds, and what the page is doing every 15 s while it waits. On expiry, or any other launch failure, it closes what it started (killing a browser that will not close) and throws with the stage, where the page was, and the latest page and console errors. Playwright's per-action timeout is 60 s (`timeout`), so a stalled click fails in a minute instead of looking like a hang.

`launchHarness` options and the returned harness:

| Option or member | Meaning |
| --- | --- |
| `args` | Extra Chromium switches |
| `uncapped` | Launch with `--disable-gpu-vsync --disable-frame-rate-limit`, for frame timing |
| `hmr: false` | Drop Vite's hot updates and full reloads, so a source edit does not restart the page (and a battle that takes minutes to reach speed); `harness.reload()` picks edits up |
| `allowGpuErrors` | Report WebGPU errors in `gpuErrors` without adding them to `errors` |
| `errors`, `gpuErrors` | The current document's page errors, game errors and WebGPU errors. A reload starts a new list, so an error from a half-saved edit does not fail every later run |
| `console` | Console errors and warnings from the first navigation on, across reloads |
| `ready()`, `reload()` | Wait for the port (or battle) again; load the page afresh and wait. `reload()` works while Vite is itself reloading the page |

WebGPU validation errors (`GPUValidationError`, "used in a submit", `[Invalid …]`, WGSL compile failures, device loss) reach the page only as console messages, so a shadow map destroyed while a submit still used it shipped twice. The driver treats them as errors: they fail the launch, `designCheck`, `ui:shot` and `withHarness`, and the first few print as they happen.

`placeCamera(page, pose)`, `freezeScene(page, options)`, `settleCamera(page)` and `setHud(page, visible)` wrap the `review` members, and `resize(page, width, height)` changes the viewport and waits for frames at the new size, to capture several sizes in one session.

### Measuring frame cost

`measureFrameCost(page, toggle, { rounds, flipSeconds })` flips a feature every 0.6 s over 20 on-off pairs, alternating which goes first, and compares median `requestAnimationFrame` intervals pair by pair. It returns the on and off medians, the median difference and the interquartile spread of the differences: a cost inside the spread is not resolved. Launch with `uncapped: true`, or vsync quantizes every frame to the display refresh and hides any difference below it. `toggle(on)` runs in the page and must not close over script variables.

```ts
await withHarness({ uncapped: true }, async ({ page }) => {
  console.log(await measureFrameCost(page, on => { const game = window.review.game!; game.applyGraphics({ ...game.graphics, renderScale: on ? 100 : 50 }); }));
});
```

The WebGPU timestamp routes mislead on this machine. `trackTimestamp` stalls the pipeline to about 9 fps. A single awaited frame's `resolveTimestampsAsync` overstates the cost, because Apple GPUs clock down between awaited frames. Timestamps summed over a batch of frames overlap into impossible totals. The `measure` and `effectsCost` helpers in `effectsStage.ts` read timestamps and are only good for relative readings within one run.

### Effects review

`bun scripts/browser/effects-review.ts --scene hit,fire` renders scripted combat-effect sequences (`effectsScenes.ts`) as frames and contact sheets. The battle has a fixed seed, the sea is held at `--sea-time` (default 60 s) and every hull rides it to that time as the berth does, so master and a branch draw the same ships and water; what still differs between two runs is a few cloud pixels and, now and then, a frame a few levels brighter while the sky refreshes. `--serve <port>` keeps the battle open: `curl 'localhost:<port>/run?scene=hit&out=.build/effects/try1'` renders against the current source, `/reload` loads the page afresh, and `/stop` turns away queued runs, closes the browser and exits. A run first checks that every ship of the roster has a view and a model, so frames of an empty sea fail instead of passing. In `--serve` mode Vite reloads the page after every source edit and the next run waits for the new battle; `--no-hmr` keeps the page through edits until `/reload`. The server stops after `--idle` minutes without a request (default 60).

What the driver already handles, so a script need not:

- Headless Chromium reaches the port but its WebGPU frame loop stalls. The driver launches headed. `chrome-headless-shell` may also never run the page's Web Workers, silently.
- `page.screenshot()` blurs a headed window, which cancels editor drags, ghosts and tooltips. `shot()` captures through CDP.
- Each run starts its own Vite server on a free port, so it cannot collide with another worktree's dev server.
- Other sessions' test browsers share the GPU: frame timings swing 20–90 ms and launches slow down while they draw. The driver names them at launch (and says which are orphaned) but never kills them. Run one harness at a time, including across worktrees.
- Judge a running battle by simulation ticks, not the FPS readout; a paused game still reports 120 FPS.
- A ship accelerates for minutes: `definition.handling.forwardSpeed` is her calm-water speed, not what she reaches in a seaway, so wait for the speed to plateau rather than for that number.

## Known-red tests and checks

`bun run test` prints only failing files (bounded to 160 lines, 400 columns) and one summary line. Its exit status reflects failures that are not in `scripts/tests/known-failures.json`, so a failure you see is yours. `bun run test -- --known` lists the ledger, `--verbose` restores full output and `--record-known` rewrites the ledger from a run on a clean master. Fix and remove entries rather than adding to them; the runner names entries that no longer fail.

`bun run ship:browser:check` runs every registered check even after one fails, and reports checks listed in `scripts/construction/known-browser-failures.json` as known red. `--list` shows registered and unregistered checks, and `--only <name>` or `--only <file>#<export>` runs one.
