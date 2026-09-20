# Fable implementation follow-up

Requested read-only review of `fb295e68` against `364fe08f`. Returned by `claude --model fable`, reported model `claude-fable-5-1`. Verbatim review follows; subsequent fixes are recorded in [the disposition](rust-multiplayer-review-disposition.md).

Follow-up review of fb295e68 against 364fe08f, read-only from the committed diff. Same session and model as before: Claude Fable 5.1, model ID `claude-fable-5-1`. I did not run the native or client suites; pass claims are yours.

**Disposition of findings 1 to 8**

| # | Status | Evidence in fb295e68 |
| --- | --- | --- |
| 1 Proxy IP | Resolved, with one regression below | `client_ip` at `crates/naval-server/src/main.rs:466-493` trusts only configured peers and walks XFF right to left; `NAVAL_TRUSTED_PROXIES` parsed at `main.rs:81-86`; proxy test at `main.rs:497-510`; per-IP test at `hub.rs:502-520` |
| 2 Baseline handshake | Resolved | `matched()` at `main.rs:218-241` gzips metadata, prefixes a zero byte, 15 s deadline, 8 MB cap; client splits handshake from deltas at `RemoteBattleSession.ts:55` and decodes handshake first; protocol bumped to 3; mocked-socket test covers handshake, reconnect epoch, and Ready resend |
| 3 Ghost tickets | Resolved | Socket leases via `attach`/`TicketSocket` at `hub.rs:234-248, 412-438`; `pair()` at `hub.rs:249-367` requires both sides live; lease pruning at 15 s and ticket drop 10 s after last socket at `hub.rs:384-395`; queued sockets pinged at `main.rs:322`; ghost test at `hub.rs:472-500` |
| 4 Slot leak, catalog panic | Resolved | `CompletionGuard` at `worker.rs` sets `finished` on any exit and submits a worker-panic abort; guard dropped after `rx` so the finished fallback sees the final frame; `map_ids`/`weather_ids` validated at load and every map/weather pair resolved, `catalog.rs`; `pair()` uses the validated accessors; tests for guard and malformed catalogs |
| 5 Sunk-ship input spam | Resolved | Gate at `SnapshotSession.ts:149`; declines shown for 3 s only, `RemoteBattleSession.ts:118-124, 139`; test asserts no input while sunk and that taking another helm still works |
| 6 Local failures invisible | Resolved, with one regression below | `LocalBattleSession.fail()` clears busy, disposes, and calls `onFailure`; Game routes it to the error callback; status line shown for any status or cancelled phase, `BattleStatus.tsx:43`; render test added |
| 7 Exit label | Resolved | `battleExitLabel` in `BattleSession.ts`; `surrender()` only sends in loading, countdown, running; label test covers all phases |
| 8 Commands as liveness | Resolved | `worker.rs` refreshes `last_seen` on epoch-valid input from an online player; test drives input only past a 100 ms heartbeat timeout |

The additional fixes also hold up: `CancelLoading` closes the pairing-before-metadata race without letting an HTTP cancel forfeit a running match, and the action loop now stops at the first terminal transition so a later surrender or shutdown cannot overwrite the reason.

**Concrete remaining issues**

1. **Global admission budget is consumed by per-IP-rejected attempts.** `crates/naval-server/src/hub.rs:144-161` increments the global counter before the per-IP check runs. Trigger: any single address, or a script without an Origin header, posts more than 256 joins in ten seconds. Impact: every other player gets "Global admission limit reached" for the rest of the window, and the attacker can repeat indefinitely. This is a new denial-of-service path introduced by the fix. Fix: run the per-IP check first and count only attempts that pass it toward the global budget. Test: exhaust one address with several hundred rejected joins, then assert a second address still joins. I consider this a should-fix before the PR merges, since it is a three-line change.

2. **Declined local orders now pin the status line for the whole custom battle.** `src/game/session/LocalBattleSession.ts:31` stores "Order declined" with no expiry, and the widened condition at `src/ui/BattleStatus.tsx:43` now renders it. Trigger: "Attack selected enemy" after the HUD target has sunk, or taking the helm of a ship that sank between click and processing. Impact: the banner stays until the battle ends. Fix: reuse the three-second notice from `RemoteBattleSession`, ideally by moving it into `SnapshotSession`. Low severity.

Non-blocking notes:

- If the server is ever bound dual-stack, loopback peers appear as IPv4-mapped IPv6 and will not match `127.0.0.1`; the fallback is safe but returns to the shared bucket. Worth one line in the deployment doc.
- The panic-guard test exercises the guard in isolation rather than a panicking worker thread. Acceptable, given the guard is declared before `session` and `rx` so drop order is correct.
- `Action::Surrender` still requires `online`, so a player past the heartbeat timeout cannot surrender until the next heartbeat; input now refreshes liveness, so this is unlikely in practice.
- Catalog load now resolves twenty environments, including inside the WASM worker per custom battle. I read `resolve_environment`; it is JSON lookups and island struct construction with no terrain work, so the cost is negligible.
- Protocol 3 rejects any previously deployed browser build. Expected, and the doc notes matching builds.

**PR suitability**

Suitable for a PR with the documented launch limitations, provided the global rate ordering in `hub.rs:144-161` is corrected first. The scope decisions you listed are consistent with the code and now documented: Ready-based grace, durable retry, blur and menu expiry behaviour, and owned-carrier orders via switching. Nothing in this patch changes outcome scoring, ownership, or result immutability.

Not verified: I did not build or run the Rust or Bun tests, did not exercise the browser, and did not observe the live socket checks you have running.
