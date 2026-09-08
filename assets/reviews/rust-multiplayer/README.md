# Rust multiplayer validation

Local implementation evidence on `goldflag/rust-fleet-multiplayer`. The [implementation guide](../../../docs/rust-multiplayer-implementation.md) describes architecture, setup and the remaining public-launch performance gates. [identity.json](identity.json) records the exact simulation/content identity and SHA-256 of each capture. This is runtime evidence, not historical model acceptance.

## Correctness and integration

- [Native/WASM checks](native-wasm-check.txt): native tests, Clippy, frozen motion/projectile/complete-battle comparisons, including 18,000 battle ticks. [Additional server tests](server-tests.txt) cover committed persistence flush and restart handling.
- [TypeScript suite](typescript-tests.txt): 132 test files, zero failures. [Final session checks](session-tests.txt) cover real WASM adapters, actor identity, owned commands and labels.
- [Production build](production-build.txt): ship and aircraft checks, TypeScript and Vite pass. The existing bundle budget emits a 7.6 MB shared-chunk warning.
- [TCP smoke](socket-smoke.txt): load barrier, hostile ownership rejection, movement acknowledgement, replacement epochs, forfeit and immutable final-result reconnect. The printed `replaced` error is the expected rejection of the old connection.
- [Subpath smoke](subpath-smoke.txt): the same HTTP/WebSocket checks through Vite at `/naval/api/*` passed.
- [Concurrency](concurrent-sockets.txt): a dedicated server with cap two sustained approximately 20 Hz to four clients in two 16-vessel carrier-containing matches for 30 seconds. Queue cancellation and admission refusal at capacity passed. This is a short concurrency check, not production host qualification.

## Actual browser

Chromium headless shell with WebGPU and `--use-angle=metal`, 1280 × 900 viewport, medium graphics and 0.65 resolution scale. Two independent browser instances ran the full game. The [network log](browser-network.txt) records an invite, matching, 150 ms CDP latency, a three-second forced game-socket outage, a higher reconnect epoch, ship switching and forfeit/victory. The two unsafe-port console messages are the deliberately injected outage; no application page errors occurred. CDP latency is the configured browser-network parameter, not a separately measured round-trip time.

| Capture | Observed state |
| --- | --- |
| [Player one](online-player-one.png) | Reconnected; two friendly Fletchers, one enemy; 29:48 remaining and 5,848/2,924 t |
| [Player two](online-player-two.png) | Same battle and conditions, opposite heading and correctly reversed friendly/enemy totals |
| [Result](online-result.png) | Opponent victory by forfeit, retained clock and tonnage |
| [Custom battle](custom-rust.png) | Full GPU game running the Rust custom-battle worker, ship/sea visible and shared clock/tonnage rules |
| [Eight vessels per side](online-eight-vessels.png) | Two carriers per side, 16 ships, visible aircraft launches and shell salvos after reconnect |
| [Eight-vessel result](online-eight-vessels-result.png) | Victory after the opponent switched to a carrier and forfeited; full fleet totals retained |

The [eight-vessel browser log](browser-eight-vessels.txt) repeats the full two-browser latency/outage/reconnect/switch/forfeit flow with maximum vessel and carrier counts on each side. Each fleet totals 124,969.367 t. Aircraft labels overlap around distant launching squadrons in this stress view; this capture does not establish label legibility in crowded carrier formations.

The instruments retain the existing naval styling and leave the ship and sea visible. Enemy human-controlled ships have visible labels; the current owned ship is excluded. These captures cover desktop composition, not all mobile viewports or every weather/time combination visually.

[Browser worker measurement](browser-worker.json) ran 60 ships for 300 ticks through the actual `LocalBattleSession` Web Worker, independently of GPU scene rendering: 561 ms initial load, 3.51 s wall time for five simulated seconds, 50 snapshot applications, p99 main-thread application 0.70 ms. Application timing excludes JSON decoding and rendering; the wall time includes worker simulation, serialization and transfer. This short opening-state test does not establish sustained performance after aircraft and damage accumulate.

## Sustained native performance

[capacity.json](capacity.json) retains full release measurements from an Apple M5 Pro, 18 logical CPUs, 48 GiB RAM, macOS 26.6.2. The host was not isolated from other development activity. Two runs each accumulated 1,800 active simulation seconds, restarting completed battles with the same setup/seed. They completed three/four whole battles respectively, plus a partial battle, with 72 peak airborne aircraft. All [20 map/weather combinations](map-weather-sweep.txt) also completed 300 ticks each.

Mean simulation ticks were 1.35/1.27 ms, p99 11.09/10.56 ms; update encoding averaged 13.06/12.04 ms. Compressed payloads averaged 184/181 kB at 20 Hz, about 3.7/3.6 MB/s **per player**, excluding metadata and framing. Peak process RSS was approximately 118 MiB. The 60-vessel custom stress run reached 288 airborne aircraft over 60 simulated seconds and approximately 280 MiB RSS; its p99 tick was 54 ms. That native benchmark includes online compression unused by local custom battles.

These measurements do not meet the proposal's p99 complete-tick target below 8 ms. Further bandwidth reduction and sustained capacity/network qualification on the intended host are public-launch work. No deployment or cloud capacity claim accompanies this evidence.

## Reproduction

Run the documented toolchain setup, then `bun run multiplayer:check`, `bun run test` and `bun run build`. Start a release server for `bun run multiplayer:smoke`. Use a dedicated idle server with `NAVAL_MAX_MATCHES=2` for `bun run multiplayer:capacity-smoke`; `NAVAL_TEST_SECONDS` controls its active duration (1–1800).

`bun run multiplayer:benchmark 1800` measures complete Rust simulation and actual update encoding. Select `NAVAL_BENCH_SEED`, `NAVAL_BENCH_MAP` and `NAVAL_BENCH_WEATHER`; `NAVAL_BENCH_CUSTOM=1` selects 30 ships per side. Use `/usr/bin/time -l target/release/benchmark 1800` on macOS for RSS. Benchmark durations count active simulation ticks, restarting at a completed outcome.
