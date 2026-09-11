# Battle sessions

`BattleSession` is the renderer/intent seam. `SnapshotSession` keeps actor, motion and damage identities stable, supplies read-only aiming/telemetry, maps stable teams to the local friendly/enemy perspective, and translates UI intents to generated Rust commands.

`LocalBattleSession` schedules bounded batches on `local.worker.ts`; `LocalRuntime` uses the same Rust `Session` as online match workers. The browser main thread never resolves combat for custom battles. The legacy TypeScript `CombatSimulation` remains the port fixture and frozen migration reference.

Fleet UI selection and camera follow are independent of `controlledShipId`. `releaseHelm` clears held input and resumes the Rust captain's saved movement and weapons policy. Addressed routes, escort, focus and weapons commands do not transfer helm ownership. Aircraft group IDs resolve their friendly owning carrier rather than the camera subject. Local snapshots include only the player's acknowledged `fleetOrders`; route-planning caches and another team's orders stay private.

The local `CommandQueue` bounds pending intent at 128 commands and retains explicit queued/sent/accepted/rejected/superseded receipts. A new movement order supersedes pending movement for that ship; route appends and separate weapon priorities preserve their order. Local tactical pause stops tick dispatch while still accepting commands. On resume the worker validates every queued command in sequence through Rust. Remote sessions continue on server time.

Ordered, lossless changes travel from the worker, and the receiver checks the
preceding tick and copies changed paths, keeping earlier snapshots intact for
interpolation. This transport relies on one owned worker with serialized
requests; it is separate from reconnectable online deltas. Scalar changes travel
directly and object patches use keyed fields to avoid per-value wrappers and
key/value tuple allocations during structured cloning. Explicit `undefined`
replacements remain wrapped, and prototype-named fields are written as own data
properties. Unchanged subtrees retain their identity.

Rust produces those changes. `LocalRuntime.snapshot_delta` walks the live
simulation once against a shadow of the frame it published last and writes only
what moved, in the shape `applyLocalDelta` consumes, so the worker parses a few
kilobytes rather than parsing a whole frame, stripping its nulls and diffing it
structurally — two full walks it no longer makes. The shadow is normalized the
way the old decoder normalized: a field whose value turns null is reported as
removed, because the frame the renderer holds has no such key. It keeps fields in
emission order behind a cursor rather than in a map, and holds numbers unboxed,
so an unchanged field costs a comparison; patch text is written lazily, and keys
and container headers reach the buffer only once something below them moves.
Numbers are compared as the client would read them, integers apart from floats
and floats bit for bit. Each frame carries the baseline tick the client must be
holding; a runtime with no baseline — after init, deploy or restart — sends a
complete frame. `detailShipIds` narrowing works unchanged: the fields it adds and
removes travel as ordinary additions and removals.
`localSnapshotDelta.test.ts` applies real Rust patches through a carrier battle
whose detail list changes mid-stream and compares each rebuilt frame against the
complete Rust snapshot, including combat events and renderer identity updates;
`crates/naval-sim/tests/frame_delta.rs` does the same natively for the
full-knowledge and team projections.

`MatchConnection` handles admission, per-tab reconnect tokens, socket replacement, bounded decompression and match metadata. `RemoteBattleSession` publishes addressed commands and interpolates snapshots while the server owns time. The load-ready message is sent after model loading and initial scene rendering, not when the socket connects.

`SnapshotSession.test.ts` executes real WASM and validates renderer identities, telemetry, selection, carrier commands and movement precedence. `scripts/multiplayer/headless-session.ts` uses that same WASM authority with synchronous scheduling for GPU-independent scene-binding tests.

Local fleet command batches routine presentation at 20 Hz of wall time, including
fast-forward. Authoritative combat remains at 60 ticks per simulated second.
Queued orders and manual helm retain a 60 Hz dispatch opportunity; a batch stays
bounded at six ticks per speed step and never exceeds 24. One batch is in flight
at a time, and the next one is posted from the worker's reply rather than the
following render frame: the worker keeps stepping while the frame draws, a round
trip that overruns a frame no longer costs the next one, and simulation speed
stops depending on frame rate. Unspent simulated time is carried as debt up to
one simulated second instead of being discarded at the old 0.4 s clamp, so a slow
round trip is repaid rather than dropped. `achievedSpeed` reports the simulated
seconds per wall second actually reached over the last two-second window; the
speed control shows it when the worker cannot hold the requested setting, leaving
the choice to step down with the player. Tests cover 1×/2×/4× equivalence, 120 Hz
displays, pause/restart, prompt orders, taking the helm, dispatch from the reply
and debt carried across a round trip longer than the old clamp.

Live PvE snapshots stream owned hull fields through the shared presentation
serializer, remapping target IDs through the team boundary. Contacts, effects,
aircraft and scores retain the existing team projection, and finished missions
retain their debrief path. Native differential tests compare every field against
the original tree projection for both teams, including unavailable targets and
finished battles.

Compartment-derived damage is half of a fleet-command frame, and most of it has
one reader. The `advance` message names the hulls whose damage-control panel can
be on screen: the followed or helm ship, plus the fully known target whose fire
report a custom battle shows. `LocalRuntime.detailed_snapshot` narrows both the
team projection and the full-knowledge streaming projection to that list; an
empty list keeps every ship's, which is what the server, the migration checks and
the first frame after init, deploy or restart use.

Only portable pumping and flood connections leave a narrowed hull entirely. Its
rooms keep their compartment positions and carry `heat` and `intensity`, because
hull fire effects and the inspection view read every ship's room fires by index;
the six fields behind the panel's fire report (fuel, initial fuel, ignition heat,
heat per damage, trend and suppression) do not travel. Compartments stay whole
for every ship: the fleet HUD places fire markers at their centres and flooding
is drawn from their water volumes. The differential tests compare the narrowed
tree and streaming projections field for field. See [fleet speed measurements](../../../docs/pve-speed-performance.md).
