# Battle sessions

`BattleSession` is the renderer/intent seam. `SnapshotSession` keeps actor, motion and damage identities stable, supplies read-only aiming/telemetry, maps stable teams to the local friendly/enemy perspective, and translates UI intents to generated Rust commands.

`LocalBattleSession` schedules bounded batches on `local.worker.ts`; `LocalRuntime` uses the same Rust `Session` as online match workers. The browser main thread never resolves combat for custom battles. The legacy TypeScript `CombatSimulation` remains the port fixture and frozen migration reference.

`MatchConnection` handles admission, per-tab reconnect tokens, socket replacement, bounded decompression and match metadata. `RemoteBattleSession` publishes addressed commands and interpolates snapshots while the server owns time. The load-ready message is sent after model loading and initial scene rendering, not when the socket connects.

`SnapshotSession.test.ts` executes real WASM and validates renderer identities, telemetry, selection, carrier commands and movement precedence. `scripts/multiplayer/headless-session.ts` uses that same WASM authority with synchronous scheduling for GPU-independent scene-binding tests.
