# Rust multiplayer implementation review disposition

Claude Fable 5.1 (`claude-fable-5-1`) reviewed implementation `184d90f4` and then reviewed fixes `fb295e68` against integration commit `364fe08f`. Both reviews were read-only, requested through the Orca-managed Claude terminal. Fable inspected code; the implementing agent ran validation. Retained reviews: [initial](rust-multiplayer-fable-implementation.md), [follow-up](rust-multiplayer-fable-followup.md).

## Findings and fixes

| Finding | Final disposition |
| --- | --- |
| Reverse proxies share the peer-IP admission bucket | Explicit trusted-proxy IP configuration, right-to-left forwarding-chain validation, per-client budgets and separate global limit. Untrusted or malformed forwarding headers cannot choose the rate key. |
| Large metadata times out before loading | Protocol 3 compresses metadata, gives it a 15-second write deadline, and preserves it separately from replaceable deltas. A regression holds an old decode across reconnect and verifies the new metadata, epoch, Ready resend and following delta survive. |
| Unconnected/closed tickets consume opponents | Pair only tickets with live socket leases; ping queued sockets, expire stale leases, release closed tickets and invite reservations. |
| Panic cleanup leaks worker capacity; malformed catalog poisons lobby | Completion guard releases capacity on unwind and submits an abort through the result writer. Catalog map/weather IDs and all environment combinations are validated before admission. Storage failure still blocks new admission; abort persistence cannot be guaranteed when storage is unavailable. |
| Selected sunk ships spam commands/rejections | Stop continuous input after physical loss while preserving selection of another owned ship. |
| Local worker errors hidden | Visible local status and game error callback, terminal worker cleanup, and return-to-port path. |
| Cancelled battle offers forfeit | Exit text requires an active online running battle; cancelled/finished sessions return to port. |
| Valid input does not refresh liveness | Epoch-valid input from an online player refreshes the activity deadline. |
| Rust prerequisite/tool paths | Tool scripts find executables on PATH with the standard Cargo directory as fallback. Rust remains an explicit prerequisite for dev/test/build because custom battles and tests execute the real WASM authority. |
| Follow-up: rejected per-IP attempts exhaust global limit | Apply the per-IP check before consuming the global budget. Test sends 300 rejected requests from one address and verifies a second address can still join. |
| Follow-up: declined custom orders persist forever | Share the three-second order notice in SnapshotSession. Expiry works while paused and preserves any later connection or worker failure. |

Also fixed cancellation between pairing and metadata, and stopped processing queued actions after the first terminal transition so later actions cannot change a result. Added the real HTTP/WebSocket smoke to CI.

Fable’s follow-up judged the PR suitable with documented launch limitations, conditional on correcting the global rate ordering. That final correction and the local notice correction were implemented afterward and covered by regression tests; they were not submitted for a third Fable review.

## Validation

Native workspace tests and Clippy with warnings denied passed. Native/WASM migration fixtures compare 28,800 full-battle ticks, 36 motion checks and 48 projectile cases, including current Shōkaku weapons and torpedo protection. All 135 TypeScript test files and `bun run build` passed before final master integration. Master `8495e905` retired the comparison archives and two test files; the resulting 133-file suite, five overlay tests/typecheck and production build passed again. Ship/aircraft checks passed; the six stale comparison packs were rebuilt with local Blender through the pipeline, with no geometry edits. The build retains its documented large JavaScript chunk warning.

Live protocol-3 HTTP/WebSocket smoke passed cancellation after pairing, loading barrier, ownership, movement, epoch replacement, forfeit and frozen result reconnect. See [retained logs](../../assets/reviews/rust-multiplayer-fable/README.md) and PR CI checks. Earlier long benchmarks remain labeled under their original build in the implementation report and are not new performance qualifications.

## Scope decisions and launch limits

Reconnect grace clears only after Ready, preventing reconnecting clients from keeping an unusable seat alive indefinitely. While menus are open or held input expires, the server continues the battle and bots follow standing orders; selected gun input expires. Owned-carrier orders use the existing Take helm flow. Permanent storage errors retain retry/drain behavior rather than silently discarding results. There are no ratings or competitive rewards to exploit through self-pairing.

Main-thread decoding, full-duration concurrency, extended loss/jitter and stalled writes still need qualification on the intended public host. Previous carrier-heavy measurements used roughly 3.6–3.7 MB/s per player and exceeded the proposed 8 ms p99 complete-tick target. This PR does not claim public capacity qualification or deploy infrastructure.
