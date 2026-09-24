# Battle sessions

`BattleSession` is the renderer/intent seam, declared on its own in `BattleSession.ts`: the state half is the generated frame's elements (`elements.ts`) held as stable presentation objects, the intent half the addressed commands below. `telemetry.ts` and `airTelemetry.ts` are the read-only instrument readouts over those elements; `battleSetup.ts`, `battleRules.ts` and `aiLevels.ts` are what the port composes and validates before asking for a session. `SnapshotSession` keeps actor, motion and damage identities stable, supplies read-only aiming/telemetry, maps stable teams to the local friendly/enemy perspective, and translates UI intents to generated Rust commands.

`LocalBattleSession` schedules bounded batches on `local.worker.ts`; `LocalRuntime` uses the same Rust `Session` as online match workers. The browser main thread never resolves combat for custom battles. The port is a `LocalBattleSession` too (`LocalBattleSession.port`): the same Rust authority compiles the hull on show, with an idle twin on the other side because a battle wants a hull per side, and nothing is ever dispatched to it, so port inspection, mount articulation and hydrostatics read what a battle would. Measured on the dev server with headed Chromium, port entry costs the worker's compile in parallel with the hull load: cold start unchanged (3.8 s → 3.7 s mean of two), ship switch +0.1 s, return to port +0.2 s.

Fleet UI selection and camera follow are independent of `controlledShipId`. `releaseHelm` clears held input and resumes the Rust captain's saved movement and weapons policy. Addressed routes, escort, focus and weapons commands do not transfer helm ownership. Aircraft group IDs resolve their friendly owning carrier rather than the camera subject. Local snapshots include only the player's acknowledged `fleetOrders`; route-planning caches and another team's orders stay private.

The local `CommandQueue` bounds pending intent at 128 commands and retains explicit queued/sent/accepted/rejected/superseded receipts. A new movement order supersedes pending movement for that ship; route appends and separate weapon priorities preserve their order. Local tactical pause stops tick dispatch while still accepting commands. On resume the worker validates every queued command in sequence through Rust. Remote sessions continue on server time.

The frame is declared once, in Rust: `naval_sim::snapshot::BattleFrame` is
what the battle emits (hulls, wings, projectiles, events, records, and a team
view's contacts and observations), and `naval_protocol::frame::SessionFrame`
flattens it and adds what only the session knows (helm seats, standing orders,
phase, connection state). ts-rs exports both to `src/multiplayer/generated/`
(`bun run multiplayer:types`), and `Snapshot` here is that generated type. The
eight collections whose element shapes are filtered views of simulation objects
(a hull without its bot, a shell without its damage ledger) are the frame's type
parameters; their elements are still the retired engine's types until they are
declared in Rust.

One codec carries that frame over both transports: `crates/naval-sim/src/frame_delta.rs`
encodes a `FrameUpdate` — the tick of the reference frame the receiver must be
holding, the tick reached, and a patch of what moved — and `frameDelta.ts`
decodes it by copying the changed paths onto the reference, keeping the frame
being interpolated intact and unchanged subtrees' identities. The worker's
reference is the frame it published last (ordered, lossless: one request, one
reply). The server's reference is the immutable baseline every client receives
with its match metadata, so a slow socket may skip any update; the server forks
its baseline encoder for each publication. An update against a reference the
session is not holding is a transport fault, never a silently wrong frame. The
codec also owns the null invariant: a null object field has no key on the
receiver, with one declared exception (`activeFlightLimit`, whose null is the
"unlimited" policy, declared on `DeckStatus`); nothing on the client strips
nulls, and the complete-frame path (`LocalRuntime.snapshot`) is the same
normalized text.

The encoder walks the live simulation once against a shadow of the reference
frame and writes only what moved. The shadow keeps fields in emission order
behind a cursor rather than in a map, and holds numbers unboxed, so an unchanged
field costs a comparison; patch text is written lazily, and keys and container
headers reach the buffer only once something below them moves. Numbers are
compared as the client would read them, integers apart from floats and floats
bit for bit. A runtime with no reference — after init, deploy or restart — sends
the frame whole. Collections whose elements come and go (the event window, shells
and torpedoes in flight, the shell record) are keyed (`frame_delta::keyed`): each
element is matched to its previous self by the unique field it leads with, the
patch carries runs of survivors to copy (`from`) and the new `length`, and only
arrivals and changes travel. Patched by index, one arrival shifted every later
element and a length change resent the whole collection; in the 30-ship custom
battle keying halves the mean update, from 363 to 188 KB.

The local worker's stream travels in a binary form of the same patch
(`FrameDelta::binary`, `LocalRuntime.snapshot_delta_binary`; the grammar is on
`FrameDelta::update_binary`): numbers as their eight bytes, keys as numbers from
a table the stream builds as it goes, and text in one small JSON array at the
end. The worker transfers the buffer rather than copying it, and
`BinaryFrameReader` applies the patch as it reads it, with `applyFramePatch`'s
copied paths, kept identities and key order, so the main thread neither parses
JSON text nor builds a patch tree to walk. In the 30-ship custom battle the mean
update falls from 184 KB of text to 62 KB, and in alternating blocks of one live
battle the worker message handler falls from 1.48 to 0.51 ms per update, with
main-thread GC from 0.37 to 0.28 ms a frame; updates arrive at about one a
frame. `LocalBattleSession.binaryStream = false` asks for the text form, for
comparison; a change of form starts the stream again, whole. The text form
stays the match server's wire format. A reader holds its stream's key table: an
update names the keys the reader must already hold, zero whenever the stream
starts again (init, deploy, restart, trial reset or action), and one against
another table is a transport fault like one against another reference.

Patching the received frame in place instead would save the copies too, but
presentation holds the applied frame's objects: hull mounts are the frame's own
array, an aircraft's previous position is the previous frame's array, and the
shell, torpedo and event lists are the frame's. `beforeStep` captures poses from
them before the next frame is applied, so every changed path is copied.

`detailShipIds` narrowing works unchanged: the fields it adds
and removes travel as ordinary additions and removals. `frameDelta.test.ts`
applies real Rust updates through a carrier battle whose detail list changes
mid-stream and compares each rebuilt frame against the complete Rust snapshot,
including combat events and renderer identity updates, and reads one update
through both the worker's reference and an immutable baseline; it also reads
twin sessions' text and binary streams side by side, frame for frame, leaves,
key order and kept subtrees included. `crates/naval-sim/tests/frame_delta.rs`
does the same natively for the full-knowledge and team frames, in both forms.

`MatchConnection` handles admission, per-tab reconnect tokens, socket replacement, bounded decompression and match metadata. `RemoteBattleSession` publishes addressed commands and interpolates snapshots while the server owns time; every binary frame is a `FrameUpdate` against the metadata's baseline. The load-ready message is sent after model loading and initial scene rendering, not when the socket connects.

`LocalWorkerOperation` owns one pending planner or initialization request and its
deadline. Completed requests can reuse or transfer the worker; timeout, abort
and worker failure retire it so a late reply cannot reach the next mission.
Placement rejection keeps the draft editable. A failed validation with a retired
worker returns the setup screen to fleet preparation so the same request can
regenerate its mission. The live session keeps its existing streaming snapshot
handler after initialization.

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
the choice to step down with the player. `simulationLoad` reports the worker's own cost over
the same window (step milliseconds per tick, snapshot milliseconds per batch and
the busy share of wall time); the in-game FPS counter shows it as `SIM` so a
worker-bound battle is distinguishable from a renderer-bound one. Tests cover 1×/2×/4× equivalence, 120 Hz
displays, pause/restart, prompt orders, taking the helm, dispatch from the reply
and debt carried across a round trip longer than the old clamp.

Live PvE snapshots stream owned hull fields through the shared presentation
filter, remapping target IDs through the team boundary. Contacts, effects,
aircraft and scores are the typed team frame, and a finished mission carries the
full-knowledge frame as its `debrief`. Native differential tests compare every
hull field against the original tree filter for both teams, including
unavailable targets and finished battles.

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
