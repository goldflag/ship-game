# Simulation performance plan

Draft, September 10, 2026. Follows the fleet-command profiling after PR #161
(see [fleet command speed](pve-speed-performance.md) for the harness). The
question this answers: which of the fleet-command findings carry over to custom
battles and the multiplayer server, and in what order to land them.

## One step, three consumers

Every battle mode runs the same `Battle::step` in `crates/naval-sim`. The port
free-sail uses the TypeScript mirror in `src/simulation` and is not affected.

| Consumer | Where it runs | Publication | Mission rules | What limits it today |
| --- | --- | --- | --- | --- |
| PvE fleet command | WASM worker, `LocalRuntime` | team projection, 20 Hz wall, 12 to 24 ticks per batch at 4× | Some | worker step time; ticks are dropped when a batch exceeds 100 ms |
| Custom battle | WASM worker, `LocalRuntime` | full-knowledge streaming snapshot **every tick** (60 Hz, one tick per frame) | None | worker step plus per-tick JSON round trip; frame-coupled |
| Multiplayer | `naval-server` native, one thread per match | tree projection (`presentation_value`) + JSON delta + compression every 50 ms | None | step time per match sets matches per core |

Native runs about 3× faster than WASM for the same work. The step is
allocation-bound (about 45% of native time is malloc, free, memcpy and memcmp),
so WASM's dlmalloc and x86 machines both suffer more than the M5 numbers show.

The publication cadence decides what dominates. Measured with the worker-only
diagnostic on the carrier scenario (M5 Pro, WASM):

| Batch size | Mode it approximates | Step | Serialize | Decode | Delta | Worker ms per tick |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 12 ticks | PvE at 4× (20 Hz) | 85% | 7% | 4% | 4% | 3.4 |
| 1 tick | custom battle at 1× (60 Hz) | 35 to 42% | 29 to 32% | 17 to 20% | 12 to 14% | 5.8 to 7.4 |

At custom battle's cadence the worker needs 35 to 45% of one M5 core just to
hold 1×, and more than half of that is the JSON round trip. For custom battles
the transport phase matters more than the step phase; for PvE it is the
reverse; for the server only the step and its own projection matter.

## Which findings apply where

| Finding | PvE | Custom | Server | Changes results |
| --- | :-: | :-: | :-: | --- |
| Flooding dry-compartment fast path, skip unchanged, cached full sample | yes | yes | yes | no |
| Flotation bisection bracket 622 m to 25 m, 27 to 12 iterations | yes | yes | yes | draft within mm; regenerate goldens |
| Per-tick `PlaneView` snapshot instead of cloning `Aircraft` | yes | yes | yes | no |
| String to enum for aircraft `role`/`phase`/`attack_stage`, `FireState.trend`, mount/tube `status` | yes | yes | yes | no, JSON identical |
| Module and compartment index maps in `CompiledShip` | yes | yes | yes | no |
| AA observer filter once per ship, not per mount | yes | yes | yes | no |
| Split borrows instead of `actors.remove/insert`; `MountState` in place; tube aims by index; `VecDeque` events; records reuse; `ProjectileEnd::as_str` | yes | yes | yes | no |
| Sea-state and rotation trig hoisting | yes | yes | yes | no if expression order kept |
| Precomputed hydrostatic (draft, heel, trim) table per class | yes | yes | yes | tolerance test vs mesh; regenerate goldens |
| Compartment downsampling (strips 40 m × 3 m, 8 reserve cells) | yes | yes | yes | pump re-tune; regenerate goldens |
| Pipelined batch dispatch from the worker reply | yes | yes | n/a | no |
| Snapshot narrowing (damage-control rooms and connections only for the helm ship) | yes | yes | maybe | no |
| Rust-emitted delta instead of parse + diff in JS | yes | yes | n/a | no |
| Pilot decisions on the `think` timer (0.65 s, as the TS twin) | yes | yes | yes | yes, rebaseline air tests |
| AA target selection every 6 ticks, fire every tick | yes | yes | yes | yes, rebaseline air tests |
| Legacy stability path, capability once per tick, fire trend every 30 ticks, drop dead telemetry | yes | no | no | PvE only, gated on mission rules |
| `ShipRenderProxy` visibility cache, air-map projection at 20 Hz | yes | yes | n/a | no |

Two facts make the gating safe. The server never sets `mission_rules`
(`crates/naval-server/src/hub.rs`), so `mission_rules.is_some()` is a
rules-level PvE switch, not a client flag. Cadence changes key off `tick`, never
wall time, so 1× and 4× stay identical and multiplayer stays deterministic.

## Targets

| Mode | Machine | Target |
| --- | --- | --- |
| PvE fleet command | Core i7-12700K, Chrome | honest 4× through a full 15-minute carrier battle, no dropped ticks |
| Custom battle | same | worker under 40% of one core at 1× with the 15-ship roster, 60 FPS |
| Multiplayer | current server | 2× the matches per core at the same tick rate |

## Phases

Each PR starts from master, includes before and after numbers from the
harnesses, and runs the full `naval-sim` test suite. Phases 1 and 2 are
independent and can run in parallel. If custom battle is the priority, start
with phase 2; if fleet command or the server is, start with phase 1.

### Phase 0. Harnesses and gates

Done in this plan's first PR.

- `crates/naval-wasm/examples/pve_speed.rs` runs the browser worker's own
  `PvePlanner`/`LocalRuntime` natively. Scenarios: `surface` and `carrier`
  (fleet command, 12-tick batches), `custom` (the 15-ship-per-side roster from
  [custom battle performance](custom-battle-performance.md), full snapshot
  every tick) and `server` (same battle, tree projection plus baseline delta
  every 3 ticks, gzip excluded). `--dump PATH` writes the complete final state.
  Build with `CARGO_PROFILE_RELEASE_DEBUG=true` and record with
  `samply record` for a symbolized profile; `atos -i` on the binary resolves
  inlined frames.
- `scripts/diagnostics/sim-step-gate.sh capture <label>` runs every scenario
  and stores state plus timings under `.build/sim-gate/<label>/`;
  `compare <a> <b>` prints the timing change and whether the final state is
  byte-identical. Capture master from a temporary worktree first. Bit-exact
  PRs must show `identical` for every scenario; behaviour PRs must say which
  scenarios differ and why. The native step is deterministic run to run.
- Report early and late windows separately. The cost per simulated minute
  grows about 2.7× over a battle, and early-battle numbers hide the problem.
  The custom roster is far heavier than the fleet-command scenarios: 30 ships
  with four carriers cost about 10 ms per tick natively and a 2.2 MB
  full-knowledge snapshot per tick.

### Phase 1. Bit-exact step fixes (all modes)

| PR | Content | Expected saving (surface / carrier) |
| --- | --- | --- |
| 1a flooding | dry-compartment fast path; skip rebuild when roll, pitch and volumes unchanged; cached full sample; area-only clip for bisection samples; scratch buffer reuse | 20 to 27 pts / 11 to 15 pts |
| 1b aviation | `PlaneView` per-tick snapshot; enums for `role`, `phase`, `attack_stage`, formation kind; borrow `ground` and flight state; reuse fighter-coordination buffers | 7 pts / 20 to 24 pts |
| 1c ship loop | `FireState.trend` and status enums; module and compartment index maps; AA observer filter hoisted; split borrows; `MountState` in place; `update_mount` by index; tube aims by index; records reuse; `VecDeque` events; `ProjectileEnd::as_str` | 15 to 20 pts / 12 to 15 pts |
| 1d trig | precomputed wave constants in `SeaState`; one rotation basis per ship per tick | 2 to 3 pts |

Gate: equality over 600 s in all three scenarios, all `naval-sim` tests,
`damage_migration` goldens untouched. Expected result: step time roughly
halved in every mode.

### Phase 2. Transport (local modes)

| PR | Content | Why |
| --- | --- | --- |
| 2a dispatch | post the next batch from `worker.onmessage`, allow one batch in flight while the frame renders; carry bounded tick debt instead of clamping at 0.4 s; step the displayed speed down on sustained overrun | removes 15 to 24 ms of frame latency per batch; sim speed stops depending on FPS; 4× stops silently meaning 3.6× |
| 2b narrowing | send damage-control rooms, pumping and connections only for the helm or followed ship; drop `shell_history` and the unread presentation fields in PvE | compartment-derived fields are 52% of a 650 KB snapshot; custom battle sends one every tick |
| 2c delta | emit the delta from Rust against the previous frame, or a columnar binary frame, and skip `JSON.parse` plus the two structural walks | 12 to 13% of worker time and most of its GC in PvE; proportionally more in custom battle at 60 Hz |

2c is done, as a Rust-side structural delta (`crates/naval-sim/src/frame_delta.rs`).
The columnar binary frame was not needed: once the frame is diffed where it is
produced, what is left on the JavaScript side is a parse of a few kilobytes, and
a binary hot path would still need the same walk plus reassembly work in the
worker. A serializer compares each leaf against a shadow of the last published
frame and writes only what moved. Two things make that shadow cheaper than the
JSON tree the first prototype used: fields sit in emission order behind a cursor
instead of in a map, and numbers are unboxed. Patch text is written lazily, so an
unchanged field costs one comparison and no formatting.

Worker-only measurements (M5 Pro, WASM, carrier scenario, second minute,
`scripts/diagnostics/pve-speed.ts --transport json|delta`):

| Batch | Path | Step | Serialize | Decode | Delta | Apply | Bytes/min | Throughput |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | complete frames | 4636 | 5319 | 3817 | 2756 | 19 | 2118 MB | 3.6× |
| 1 | Rust patches | 4289 | 6431 | 81 | 214 | 34 | 36 MB | 5.4× |
| 12 | complete frames | 4088 | 453 | 312 | 226 | 2 | 176 MB | 11.8× |
| 12 | Rust patches | 4169 | 591 | 10 | 23 | 4 | 3.5 MB | 12.5× |

The Rust walk costs about 25% more than plain serialization, and removes
everything after it: at the custom-battle cadence the transport drops from 11.9 s
to 6.7 s per simulated minute and the worker's throughput ceiling rises by half.
Payload falls by 98%, which is also 98% less structured cloning per frame.

The native harness, paired runs of 120 simulated seconds with
`--full-snapshot` for the old path, shows the same trade with the narrowing of
2b applied:

| Scenario | Snapshot ms | Bytes |
| --- | ---: | ---: |
| surface | 288 → 317 | 250.5 MB → 7.5 MB |
| carrier | 643 → 799 | 270.7 MB → 7.7 MB |
| custom | 10375 → 12910 | 10249 MB → 943 MB |

In the browser (M5 Pro, Chrome, WebGPU, 1280 × 800, High): fleet command holds an
honest 4× on the carrier scenario at 120 FPS with the worker spending 19.6 s
stepping, 2.9 s emitting patches and 52 ms parsing them over 60 s. A custom
battle with the default diagnostic roster holds 119 FPS with no frame over
50 ms, and the transport is 1.6% of the worker's time — that battle is now
entirely step-bound, which is phase 1's problem. The equality gate is
`identical` for all four scenarios: the step is untouched.

Server: measure `presentation_value` plus delta cost per match first; the tree
projection is slower than the streaming one, but the delta needs the tree.
Decide after the measurement whether to move the server to a streamed baseline
plus patch generation. `FrameDelta` is projection-agnostic and could serve it,
but the server publishes against an immutable match baseline, not the previous
frame, so it is a separate decision.

### Phase 3. Content resolution (all modes)

**3a hydrostatic table — landed.** `bun run ship:hydrostatics` publishes
`assets/gameplay/hydrostatics.v1.json`: per class, the immersion, displacement
and buoyancy centroid over 16 heels × 27 trims × 33 displacements, 371 KB of
base64 f32. Both simulations read it — TypeScript through a `Hull`-keyed
registration in `src/ships/presets.ts`, Rust out of the manifest — so they
cannot drift apart, and the mesh solver stays as the reference both are
measured against.

Two things the plan did not anticipate. Trilinear interpolation is not enough:
at a fixed displacement the buoyancy centroid travels along an arc whose radius
is the metacentric height, several hundred metres longitudinally on a
battleship, so a chord between tabulated trims misses by metres. Cubic Hermite
over heel and trim follows the arc and keeps the grid small. And the table
cannot live in the compiled definition, whose hash is baked into the model
file: publishing it there would invalidate every GLB.

Accuracy against the mesh solver, every catalog hull, heel to 60°, trim to 20°,
displacement from a third of the hull to nine tenths: draft within 74 mm, roll
arm within 11 cm, pitch arm within 46 cm — a fifth of a degree of settled list
and a twentieth of a degree of settled trim. Flotation plus the two slope
probes cost 7538 µs across the fleet and now cost 6.3 µs.

| Scenario | Step before | after | Snapshot before | after |
| --- | ---: | ---: | ---: | ---: |
| surface, 600 s | 43.9 s | 19.1 s | 3.8 s | 2.7 s |
| carrier, 600 s | 46.4 s | 23.5 s | 6.2 s | 4.5 s |
| custom, 150 s | 180.5 s | 94.7 s | 27.2 s | 17.4 s |

Result-changing, as expected: every scenario differs. Final states stay
recognisable — the same ships afloat, drafts within centimetres — because the
change is a resolution change, not a model change. Goldens regenerated from the
TypeScript twin.

**3b flood spaces.** Regenerate consistently: strips at 40 m × 3 m, eight
reserve cells, and apply the same generator to every ship (six ships have
strips today, the rest do not). Re-tune pump rates, recapture
`assets/gameplay/migration/damage.v1.json`. Halves snapshot bytes as a side
effect. Note the cost: compartments are part of the compiled definition, whose
hash is stamped into every baked model, so this one does require rebuilding the
fleet's GLBs.

### Phase 4. PvE-only rules

Add a versioned cadence entry to the mission rules asset, in the style of
`visual-sensors.v2.json`:

- stability model: legacy linear path when the table from phase 3 is not enough
- `capability::update` once per tick or every 6 ticks
- fire spread on a 30-tick accumulator
- dead telemetry omitted from the team projection

### Phase 5. Behaviour changes worth doing everywhere

Owner decision. Both are balance changes and need the air tests rebaselined:

- honour `pilot.think` (0.65 s) so pilots stop re-deciding 60 times a second
- AA target selection every 6 ticks with firing and damage still per tick

### Phase 6. Main thread (all modes)

- `ShipRenderProxy.update` and `sourceVisible`: cache visibility per frame,
  skip proxies whose source did not change (11% of main-thread time).
- `AirOperations` map projection at the 20 Hz snapshot cadence instead of every
  frame.

## Also noticed

Collisions and grounding are simulated every tick but raise no map alert in
fleet command. Not a performance item, but worth a ticket.
