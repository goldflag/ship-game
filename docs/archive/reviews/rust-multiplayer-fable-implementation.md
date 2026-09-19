# Claude Fable implementation review

Requested review of `184d90f4` against `a3892524`; model usage reported `claude-fable-5-1`. Review was read-only and completed before fixes below. The reviewer did not run tests. See the separate resolution report for verification and disposition.

Review of commit 184d90f4 against parent a3892524, read-only from `git show`/`git diff`. This review was produced by Claude Fable 5.1, model ID `claude-fable-5-1`, in an unattended session. I did not build, run tests, or open a browser. Findings cite the committed contents, not the live working tree.

## Verified defects

Ordered by priority. Each item names the trigger, the impact, a fix, and a regression test.

1. **Per-IP join limiting breaks behind the documented reverse proxy.** `crates/naval-server/src/main.rs:166` takes the TCP peer address and `crates/naval-server/src/hub.rs:139-146` allows ten join attempts per ten seconds per address. The implementation doc tells operators to reverse-proxy `api/` on the same origin, so every browser arrives from the proxy's loopback address. Trigger: two players retry joins a few times, or one user scripts joins. Impact: every player on the site gets "Too many join attempts" for the next ten seconds, and one client can lock the lobby indefinitely. Fix: read `X-Forwarded-For` only from a configured trusted proxy address, otherwise fall back to the peer, and add a global admission counter as the backstop. Test: a hub unit test that joins from one socket address with distinct forwarded addresses and asserts independent budgets.

2. **The match baseline is sent as uncompressed JSON text under a two-second send timeout.** `main.rs:219-221` embeds `handle.baseline` in the `matched` message and `main.rs:192-201` gives every text send two seconds. The benchmark's retained late-state presentation snapshot on disk is about one megabyte uncompressed and about ninety kilobytes gzipped at level one. Trigger: any client whose link cannot move the baseline in two seconds, roughly below five megabits per second, or a reconnect over a congested link. Impact: the handshake times out, the client's `onclose` retries every second, each retry bumps the epoch and marks the player absent, and after ninety seconds the client reports "Could not reconnect". This is a hard connect loop rather than the documented degraded-bandwidth case, and the fix is cheap. Fix: gzip the baseline and send it as a binary frame, give the handshake a longer timeout than steady-state frames, and reserve the short timeout for the slow-consumer policy. Test: a server test with a throttled reader asserting the handshake completes and the baseline frame is compressed and bounded.

3. **Ghost tickets get paired with live players.** `hub.rs:165-198` pairs any unseated ticket younger than five minutes and nothing records whether its socket is alive. `serve_socket` never marks a ticket connected. Trigger: a tab crashes, a mobile browser is killed, or the keepalive cancel fetch fails after a queue or invite join. Impact: the live player is matched against nobody, sits on the sea for the full load timeout at `crates/naval-server/src/worker.rs:239-243`, and a match slot is consumed. Fix: track socket liveness on the ticket, pair only tickets with an open socket, and drop tickets whose socket has been closed for more than a few seconds. Test: a hub unit test where an unconnected waiting ticket is skipped in favour of a connected one.

4. **A match slot can leak permanently.** `worker.rs:305-329` sets `finished` only at the very end of the thread. If `session.finish` or the post-panic `publish` panics after the `catch_unwind` at `worker.rs:141`, the thread dies with `finished` false, the slot is held until restart, and the record stays in the loading state. Separately, `hub.rs:203-214` unwraps the catalog's `maps` and `conditions` structure while holding the registry mutex, and `crates/naval-sim/src/catalog.rs:69-82` never validates those two values. A manifest with an unexpected shape passes load, then the first pairing panics, poisons the mutex, and every later join returns "Lobby unavailable" while health reports full. Fix: a drop guard on the worker thread that sets `finished` and submits an abort record, validation of maps and conditions at catalog load, and no unwrap under the lock. Tests: a worker test that injects a panic and asserts `finished` plus a persisted abort; a catalog test that rejects malformed maps.

5. **A sunk controlled ship spams rejected input and pins the status line.** `src/game/session/SnapshotSession.ts:146-161` sends held input twenty times a second with no physical-loss gate, and `RemoteBattleSession.advance` at `src/game/session/RemoteBattleSession.ts:128-133` calls it unconditionally. The server rejects each with `Lost` at `crates/naval-protocol/src/lib.rs:262-264`. Impact: for the rest of the battle the network status line at `src/ui/BattleStatus.tsx:43` reads "Order declined: Ship has been lost" and hides reconnect status, and each rejected command costs an ack round trip inside `main.rs:364-378`, which blocks frame forwarding while it waits. Fix: gate `input()` on the player not being physically lost, and do not surface per-command rejections in the persistent status line. Test: a SnapshotSession test with a sunk player that asserts no input commands are emitted.

6. **Custom-battle failures are invisible.** `BattleStatus.tsx:43` renders `connectionStatus` only for networked sessions. When the worker posts an error mid-battle, `src/game/session/LocalBattleSession.ts:28-35` sets the phase to cancelled, disposes the worker, and leaves `busy` true, so the battle silently freezes. Rejected local orders are also never shown. Fix: show the status for any session with a non-empty status or a cancelled phase, and route worker failure through the game's error callback. Test: a FleetHud render test with a local session carrying a status.

7. **Cancelled online battles offer "Forfeit and return to port".** `src/ui/App.tsx` labels the exit by `result === 'active'`, and a cancelled or infrastructure-aborted match never sets a result. `Game.returnToPort` then sends a surrender on a closed connection. Harmless, but misleading. Fix: treat cancelled and finished phases as inactive for the label. Test: a render test for the pause menu with a cancelled remote session.

8. **Commands do not count as liveness.** `worker.rs:177-191` handles input without touching `last_seen`, which only heartbeats refresh at `worker.rs:207-211`. A player issuing orders whose pings are delayed past fifteen seconds is marked disconnected and absent. Fix: refresh `last_seen` on any epoch-valid action. Test: a worker test that sends only input for longer than the heartbeat window and asserts the player stays online.

9. **Every TypeScript task now requires the Rust toolchain.** `package.json` chains `multiplayer:prepare` in front of `dev`, `test`, `typecheck`, and `build`, and `scripts/multiplayer/check.ts` plus `build-wasm.ts` hard-code the cargo path under the home directory. This is an integration and contributor-workflow cost rather than a runtime defect. Suggest generating the version file without the WASM build for TypeScript-only tasks, and resolving cargo from the path.

## Suspicions, scope gaps and launch follow-ups

These are not confirmed bugs, but the code paths are real and worth a decision.

- **Input expiry hands your helm to the bot but silences your guns.** `crates/naval-protocol/src/session.rs:113-144` always builds gun orders for the selected ship, so with no held input `gunnery::operate` receives `aim: None` and marks every mount out of arc, while `helm` is `None` and `crates/naval-sim/src/battle.rs:313-329` runs the bot helm. `src/game/Game.ts:229-233` auto-pauses on window blur and tab hide even for online sessions, and a paused client sends no input. Result: alt-tabbing for half a second makes the AI steer your ship toward its target while your guns stop, and the pause dialog must be dismissed on return. The README says menus and blur do not pause online matches but not that the AI takes the helm. Decide the policy, either hold the last helm or explicitly document, and consider not auto-pausing networked sessions on blur. Test: a session test asserting helm behaviour thirty ticks after the last input.

- **Remote decode runs on the main thread at twenty hertz.** `MatchConnection.decode` clones the full baseline with `structuredClone`, applies patches, recursively normalizes, and parses the expanded delta. The retained browser measurement covers only the local worker path and excludes decoding. Carrier battles may hitch. Measure it, then move decoding into a worker or diff against the last acknowledged frame.

- **Air orders reach only the selected carrier.** `SnapshotSession.commandSquadron` always sends `this.ship.id`, although the protocol accepts any owned ship. The review response asked for orders to any owned carrier. Unselected owned carriers launch automatically under bot control via `crates/naval-sim/src/aviation_step.rs:408`.

- **Reconnect grace is cleared by Ready, not by Connect.** `worker.rs:146-167` keeps the original absence timestamp on Connect and clears it only on Ready, which the client sends after reloading every fleet model. A page refresh with a cold cache on a two-carrier fleet could exceed the remaining grace and forfeit despite reconnecting. Unmeasured. Consider clearing absence at Connect and relying on the load timeout separately.

- **Permanent storage failure hangs graceful shutdown.** `crates/naval-server/src/persistence.rs:48-60` retries a failing write forever, so `flush` never returns and SIGTERM never completes. Bounded retries with an explicit abort would be safer.

- **Queue self-pairing.** One client can queue twice and be matched against itself. Harmless without ratings.

Test-coverage gaps, checked against the retained logs rather than the prose:

- The hub and lobby have no unit tests, and the socket handler is exercised only by the smoke scripts against a live server, which CI does not run. An in-process axum test on an ephemeral port should cover join, cancel, invite reuse, replacement, and the finished-match fallback at `main.rs:315-321`.
- Worker tests cover the load barrier, epochs, forfeit, and load timeout only. Missing: lag-budget abort, both players absent producing abandoned, heartbeat timeout, shutdown producing infrastructure, surrender during loading producing cancelled, and input rejected before Ready.
- The delta encoder has one test; add key removal and type-change cases.
- No client tests for `MatchConnection` reconnect, cancel, or `RemoteBattleSession.reconnected`.
- The GitHub workflow has never run from this branch. It skips LFS smudge, which may break the ship checks in `bun run build`, and it compiles wasm-bindgen from source on every run.

Transport figures that drive the bandwidth items, from `assets/reviews/rust-multiplayer/capacity.json` and the on-disk benchmark output:

| Measure | Value |
| --- | --- |
| Mean compressed update, eight ships per side | 184 kB at 20 Hz |
| Late-state presentation snapshot, uncompressed | 998 kB |
| Same snapshot gzipped at level one | 94 kB |
| Handshake and per-frame send timeout | 2 s |

## Disposition, what checked out, and what I could not verify

Disposition: mergeable as a feature branch behind the documented launch gates once items 1 through 4 are fixed on the server and items 5 and 6 on the client. I found nothing that awards a wrong winner, lets a client forge tonnage or ownership, or mutates a frozen result.

Paths I traced and found correct: physical loss replaces combat loss consistently in bots, targeting, aviation, records, HUD, and spectator logic in both engines; displacement is frozen from the catalog in integer kilograms at match creation; the outcome is evaluated once per tick after all systems, the deadline is exact at tick 108000, ties and same-tick mutual loss draw; commands validate bounds, ownership, epochs, duplicates, selection gating, and enemy-survivor focus targets; held input expires after thirty ticks; replaced epochs reject stale sockets and disconnects; the first final result is immutable and restarts mark incomplete matches aborted; draining works; server time is authoritative; every update is self-contained against the immutable baseline; records, events, sockets, message sizes, and message rates are bounded.

Not verified: I did not compile or run the Rust or Bun suites, so pass claims rest on the retained logs. I did not exercise the browser flow. The baseline size is inferred from the benchmark's late-state snapshot rather than a fresh match. Numeric parity between TypeScript and Rust is taken from the fixture tests rather than re-executed. The unresolved merge markers in the working tree belong to the coordinator's integration and were not reviewed.
