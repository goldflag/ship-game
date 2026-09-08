# Response to Claude Fable's multiplayer critique

Date: 2026-09-07. This is the coordinating agent's assessment, not a second Fable review or an implementation change.

Read the [original proposal](rust-multiplayer-plan.md) alongside the [independent Fable critique](rust-multiplayer-critique-fable.md). The reviewed proposal is preserved unchanged at SHA-256 `0ed1f96485eeddbfb64246e6baadbdd033424805081285422abe35ea1c9498c4`. Orca launched Claude with requested/effective model `fable`; the worker reported session model `claude-fable-5-1`.

## Decisions retained

**Rust is a settled user requirement.** Fable's recommendation to ship a TypeScript authority first is independent dissent, not an accepted change or a question the user needs to answer again. Keep a Rust simulation/server and the native/WASM reuse path. Use the existing TypeScript engine as migration evidence and a test oracle while porting.

Keep the user's 1v1 fleet caps, full afloat-tonnage scoring, 30-minute limit and application of ending rules to custom battles. Do not adopt a rule that destroys an afloat fleet merely because it has no usable surface weapons: that would reintroduce the capability-based loss semantics we are replacing. Boundaries, extra anti-stall rules, tie-breakers and new spotting mechanics are separate product changes, not implicit fixes.

The draft's rounding, draws, 10% night chance, direct-control switching and reconnect grace are still proposed defaults. Custom conditions retain existing controls under the stated assumption; no user answer to the optional randomization clarification arrived during this review.

## Findings to carry into implementation

1. **Physical survival must reach every consumer.** The plan already calls for this audit; Fable identifies concrete targeting, aircraft, helm, scoring and HUD sites. An afloat disarmed ship remains an eligible target and contributes tonnage. Specify threat-versus-finishing target priority and prove it with behavioral tests rather than only replacing the winner predicate.
2. **Make control state per ship in the first Rust slice.** Preserve AI memory across direct-control handoffs; scope ammunition, held fire, damage-control orders and carrier orders correctly. Players must be able to issue air orders to any owned carrier. The current single-player singleton structure is not a usable multiplayer contract.
3. **Exercise aviation transport before fixing the protocol.** Use recorded carrier-heavy presentation frames to test encoding and interpolation during the early network experiment, even while aviation physics is still being ported. Specify bandwidth and transfer-cost budgets, per-entity update rates, reliable event delivery and bounded resynchronization behavior.
4. **Measure periodic simulation work explicitly.** Preserve the tick-phase benchmark. Test native Rust before deciding whether hydrostatics needs staggering or amortization; either scheduling change affects update timing and needs fresh behavioral evidence. Define overload in accumulated backlog, with bounded catch-up, rather than treating one long tick as failure.
5. **Retain migration evidence beyond snapshots.** Port the intent of existing behavior tests, validate native/WASM numeric and schema boundaries, keep content hashes opaque, and test CPU terrain against visible terrain. Keep the early real-renderer/WASM transfer experiment and the separate custom-battle rollout gate.

The next implementation milestone remains a bounded Rust slice: compiled content, per-ship ownership/input, physical-survival rules and a real browser presentation/transport seam. It does not require completing the whole engine before two browsers connect. Carrier transport can be tested with recorded state before the full carrier simulation port is ready.

## Limits and corrections to the critique

- The benchmark is one seeded scenario on one development machine, with a scripted player and a 600-second loop that does not stop when victory occurs. Its mean can include cheaper post-combat ticks. It is not evidence for multiple matches per core, a 16-core host's capacity, a fully busy 30-minute match, or a Rust speedup. Those claims need dedicated sustained concurrency measurements.
- The measured hydrostatics burst is useful evidence about the current TypeScript engine. The claim that the 8 ms p99 target is unreachable regardless of language is not established without measuring Rust.
- The approximately 41 KB JSON snapshot demonstrates a payload worth optimizing. It is an ad hoc full snapshot, not a measurement of the proposed delta/binary protocol or a proof that WebSockets cannot carry carrier battles.
- Four current carrier air groups contain 192 aircraft in total, but deck/active-flight limits constrain simultaneous airborne aircraft (`src/simulation/aircraft.ts`, `launchSquadron`). Size and test transport against reachable states, including deck mechanisms; do not equate total inventory with an airborne peak.
- A deep submarine can force a timeout against an opponent lacking effective anti-submarine capability. The critique's blanket claim that any fleet containing a submarine cannot be destroyed is too broad: it may be attacked before diving, and equipment and tactical circumstances matter. Treat this as a concrete playtest case under the requested survival rules, not proof that those rules are contradictory.
- The draft already puts the first two-browser experiment in stage 4, before full mechanics and offline migration in stages 5–6. Fable's claim that all those stages precede two-human play overstates the proposed dependency. Its narrower point—test carrier presentation and bandwidth earlier—is sound.

No game code was changed. The critique contains its benchmark scripts and raw results; the planning documents are not a claim that the Rust engine, networking, new rules or performance targets have been implemented or validated.
