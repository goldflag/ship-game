# Battle sessions

`BattleSession` is the renderer/intent seam. `SnapshotSession` keeps actor, motion and damage identities stable, supplies read-only aiming/telemetry, maps stable teams to the local friendly/enemy perspective, and translates UI intents to generated Rust commands.

`LocalBattleSession` schedules bounded batches on `local.worker.ts`; `LocalRuntime` uses the same Rust `Session` as online match workers. The browser main thread never resolves combat for custom battles. The legacy TypeScript `CombatSimulation` remains the port fixture and frozen migration reference.

Fleet UI selection and camera follow are independent of `controlledShipId`. `releaseHelm` clears held input and resumes the Rust captain's saved movement and weapons policy. Addressed routes, escort, focus and weapons commands do not transfer helm ownership. Aircraft group IDs resolve their friendly owning carrier rather than the camera subject. Local snapshots include only the player's acknowledged `fleetOrders`; route-planning caches and another team's orders stay private.

The local `CommandQueue` bounds pending intent at 128 commands and retains explicit queued/sent/accepted/rejected/superseded receipts. A new movement order supersedes pending movement for that ship; route appends and separate weapon priorities preserve their order. Local tactical pause stops tick dispatch while still accepting commands. On resume the worker validates every queued command in sequence through Rust. Remote sessions continue on server time.

The local worker parses and normalizes snapshots before sending ordered, lossless
changes. The receiver checks the preceding tick and copies changed paths, keeping
earlier snapshots intact for interpolation. This transport relies on one owned
worker with serialized requests; it is separate from reconnectable online deltas.
Scalar changes travel directly and object patches use keyed fields to avoid
per-value wrappers and key/value tuple allocations during structured cloning.
Explicit `undefined` replacements remain wrapped, and prototype-named fields are
written as own data properties. Unchanged subtrees retain their identity.
`localSnapshotDelta.test.ts` compares transferred carrier battles against the
complete Rust snapshots, including combat events and renderer identity updates.

`MatchConnection` handles admission, per-tab reconnect tokens, socket replacement, bounded decompression and match metadata. `RemoteBattleSession` publishes addressed commands and interpolates snapshots while the server owns time. The load-ready message is sent after model loading and initial scene rendering, not when the socket connects.

`SnapshotSession.test.ts` executes real WASM and validates renderer identities, telemetry, selection, carrier commands and movement precedence. `scripts/multiplayer/headless-session.ts` uses that same WASM authority with synchronous scheduling for GPU-independent scene-binding tests.
