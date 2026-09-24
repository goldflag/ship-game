# Films

A film is a battle staged through the [account-free harness](browser-verification.md) and filmed shot by shot: the real
simulation fights it, a script gives the orders on both sides, and each shot's camera is directed frame by frame. The battle
is rendered on a manual clock, one tick a frame, so every film is smooth at 60 fps however slow the machine draws.

```sh
bun run film -- carrier-strike --scout-only     # watch the battle once and report what happened (.build/film/<name>/scout.json)
bun run film -- carrier-strike --stills         # first, middle and last frame of every shot as PNGs, to review camera work
bun run film -- carrier-strike                  # render every shot, lay the soundtrack and cut .build/film/<name>/<name>.mp4
bun run film -- carrier-strike --only dive,impact   # film these shots again; the cut keeps every shot rendered so far
bun run film -- carrier-strike --sound-only     # lay the soundtrack again from the rendered shots and recut
```

`--help` lists every flag. Output lands in ignored `.build/film/<name>/`: `scout.json`, `shots/NN-<shot>.mp4` with the
frames' sounds in `shots/NN-<shot>.events.json`, `picture.mp4`, `<name>.wav` and the finished `<name>.mp4`. The window is laid
out at the output size (`--size`, default 1920x1080) and drawn at twice it, then scaled down. `--rate 30` blends each pair of
frames, a film camera's shutter blur. Capture runs at about 4 frames a second on this Mac, so a 100 s film takes about half
an hour; other sessions' test browsers slow it further.

## How a film runs

1. **Scout.** The film's battle (`battle`: harness page parameters with a fixed `seed`) launches on the manual clock
   (`clock=manual`) and is skipped through six ticks a frame for `seconds` of battle, the film's `orders` running at every whole
   battle second. Every event but gunfire and a once-a-second sample of every ship and aircraft go to `scout.json`.
2. **Plan.** Each shot's `start` is a battle second or a function of the scout's log (`scripts/film/scouting.ts`: `first`,
   `before`, `phaseFrom`, `sampleAt`), so shots follow the battle when its staging changes. Shots that overlap in battle time are
   filmed in further replays.
3. **Take.** A replay launches the same battle, skips to each shot's first tick and draws it a tick a frame, capturing each frame
   through CDP into ffmpeg, along with what the frame heard.
4. **Cut.** The shots join in the film's order, the soundtrack is laid (`scripts/film/soundtrack.ts`) and the two are muxed.

Replays play out the same battle as the scout because nothing reaches the simulation but the film's orders, at the same ticks:

- The player's helm is released before the first tick, so no sight or helm input reaches the battle; every ship sails under its
  captain and the film's orders.
- `orders` runs at every whole battle second, in the scout and in every take, and reads the battle only through its `stage`.
  Skipping steps up to six ticks a frame and filming one, but no batch crosses a whole second, so the orders always see the
  state at that exact tick.
- `stage.order` lands 12 ticks later in the worker whatever the batch sizes (`LocalBattleSession.direct` →
  `LocalRuntime::direct`).

A take that differs from the scout (a shot's moment is missing, or a subject is gone) means something broke that rule.

## Writing a film

A film is a module in `scripts/film/films/` exporting a `Film` (`scripts/film/types.ts`); `carrier-strike.ts` is the worked
example.

- **`battle`**: the roster (`player;friends;enemies` of preset ids with `:easy|normal|hard`), `range` (at most 20 km), `map`,
  `time`, `weather`, `wind`, `seed`. Ships are `player`, `friendly-N` and `enemy-N`.
- **`graphics`**: the preset the battle launches on (default `ultra`) and any live rows over it.
- **`orders(stage)`**: staging. `stage.order(shipId, command)` orders any ship on either side as its owner would, under the same
  validation as the owner's own commands (`Session::direct`): a `route`, `hold-area`, `escort`, `focus`, `weapons` policy, or an
  `air` or `deck` order for a carrier's flights (`<carrier>/<squadron>/squadron-N`). `stage.once(key, action)` gives an order
  once; conditions read `stage.ships()`, `stage.aircraft()` and `stage.seconds`.
- **`shots`**: in cut order. Each has a `name`, a `start`, `seconds`, an optional `speed` (below 1 is slow motion), `title`
  (a caption faded in over the picture) and `fade`, and a `camera(stage, scout)` that returns the director placing the camera
  every frame.

Camera work (`scripts/film/camera.ts`) is world metres, headings clockwise from −Z, and subject frames of x starboard, y up,
z ahead:

| Rig | Use |
| --- | --- |
| `ride(stage, id, { offset, look, attitude, fov, lag, sway })` | A camera travelling with a ship or aircraft; `attitude` pitches and banks with an aircraft. Smoothing works on the offset, so a fast subject is never trailed |
| `watch(stage, { eye, from, target, fov, lag })` | A camera at a point (in a subject's frame as it stood at the shot's first frame, with `from`) turning to follow a target |
| `orbit(stage, id, { radius, height, from, to, look, fov })` | A camera circling a subject between two bearings |
| `about`, `aim`, `aboveSea`, `sway`, `ease`, `lerp`, `Follow`, `Track` | The pieces the rigs are built from, for a shot none of them fits |

Every option may be a function of the shot's `t` (0 → 1) for a dolly, crane or zoom. Keep low cameras over the swell with
`clearSea`.

Review camera work with `--stills` before a full render: a still set takes a few minutes where the film takes half an hour.

## The soundtrack

Each frame records the game's own combat cues (`CombatAudioEvents` in `src/game/audio.ts`) and they play the game's clips from
`public/audio/naval` through its own `spatialMix`. What the game leaves silent is synthesized: radial engines and propellers for
every aircraft within 3 km (blade-pass and firing harmonics, Doppler and air absorption by distance), light anti-aircraft rounds,
fighter bursts, bomb whistles, flak bursts where heavy shells burst, and a bed of sea and wind. The track is deterministic and is
laid again from the saved frames with `--sound-only`.

## The harness controls films use

These are on the harness page for any script (`docs/browser-verification.md`):

| Control | Use |
| --- | --- |
| `clock=manual`, `review.clock.manual(on)`, `review.clock.step(frames, dt)` | Stop the display-driven loop and draw frames of exactly `dt` battle seconds once the simulation has answered the batch before (`Game.setManualClock`, `Game.stepFrame`) |
| `review.directCamera(director)` | Place the camera every frame in world space after the rig (`Game.directCamera`) |
| `review.command(shipId, command, tick?)` | Order any ship on either side at a battle tick (`LocalBattleSession.direct`) |
| `graphics=ultra` | Launch on a graphics preset (the ocean tier and renderers are fixed at launch) |
| `Game.subjectPose(id)`, `Game.seaSurface(x, z)` | Where a ship or aircraft is drawn this frame; the long-wave sea's height |
| `Game.setBuoysVisible(false)`, `Game.gpuIdle()` | Hide the berth's channel buoys; wait until the GPU has finished what was submitted |

## Gotchas

- The first CDP capture after frames drawn without one returns the compositor's stale frame; the driver throws one away after
  each cue. Capture waits for the GPU and two animation frames after drawing.
- In custom battles an anti-aircraft near miss or a fighter within 1.4 km turns a strike aircraft away until it has committed to
  its dive or torpedo run, and a carrier's strikes rarely complete under fire. `carrier-strike` holds each side's fire until the
  first attacker commits (`weapons` orders), then opens it; see `crates/naval-sim/src/aviation/aircraft_defense.rs`.
- Air orders need the flight ids the battle groups a wing into, not the squadron ids.
- A bot carrier launches every squadron in its first seconds; retask its flights with `air` orders once they are airborne.
