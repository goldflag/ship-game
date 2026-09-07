# Claude Fable review disposition

Review: [original report](claude-fable-review.md). The report was written against the initial implementation; the final branch incorporates the fixes below and master through `d840e0c6`. Fable did not independently complete the full suite. The final implementation run passed 774 tests across 108 files on Bun 1.3.3 and `bun run build`.

## Blocking findings fixed

1. **Surfaced submarines classified as submerged in wave troughs.** `ShipState.waveHeave`, `meanHullY` and `hullDepth` separate transient wave displacement from mean immersion. Propulsion selection, engine availability, mount eligibility, sea forcing, AA, torpedo launch depth, periscope selection, depth and draft telemetry use the shared distinction. Actual world-space hull poses still drive collisions and hits. A 60-second storm regression asserts that a surfaced VIIC continues using diesel handling, keeps its mounts available and reports zero ballast depth through more than 100 trough ticks.
2. **Short hulls failed to settle.** A scratch probe isolated numerical energy injection from holding hydrostatic restoring torque constant between 2 Hz samples. Local roll/pitch arm derivatives now let the 60 Hz integrator update torque with attitude between expensive hydrostatic solves. This corrects the root cause without altering authored CG or suppressing sea forcing. A fleet regression disturbs every hull and checks mean height, roll and pitch after 60 seconds. Existing flooding, capsize and sinking tests also pass.

## Other corrections

- Underwater HE/AP bursts carry explicit surface-height metadata and use depth-attenuated water spray plus splash audio. Contact damage emits visible spray. Effect/audio regressions cover both paths.
- Ground contacts remove inward velocity while retaining tangential motion. A glancing coast test verifies continued travel; direct grounding, draft and backing-off tests remain covered.
- A ricochet that subsequently falls into the sea retains the ricochet outcome in shot history.
- Surface-ship mean flotation and wave heave are tracked separately; draft readouts exclude passing swell.
- Added a non-degenerate battleship-bow/destroyer-broadside ramming test that verifies damage and breaches on both ships.
- Reused one sea-response evaluation per actor/tick.
- Corrected outward turning heel in both turn directions, with a regression.
- Integrated master's whole-HP durability scale and its new AA mounts, then calibrated the two new placeholder drag profiles through the durable catalog recipe and rebuilt affected assets.

## Final integration validation

Master's new spectator-camera selection required adding the existing fleet-view state to three camera fixtures; all nine focused camera tests pass. The parallel runner now allows 30 seconds per test because long fleet simulations exceed Bun 1.3.3's five-second default under eight-worker CPU contention. The full pinned-version suite passes with that finite deadline.

## Intentional approximations retained

- The CPU long-wave envelope shares weather inputs with the GPU ocean but does not reproduce its individual crests. It remains renderer-independent and deterministic. This is an explicit limitation of the sea-state model.
- Ramming currently divides dissipated contact energy equally before localized hull damage and breach calculation. Bow-versus-side resistance and material crushing are not modeled; the damage constants and region caps remain provisional tuning.
- Previously unprofiled guns now use the calibrated fleet's at-range penetration convention. This intentionally increases their near-muzzle penetration budget while air drag reduces it along the flight. Historical proof would require weapon-specific reference data.
- Coasting uses the hull's authored deceleration rate; the handling model has no propeller/thrust or engine inertia solver.
- Instance pages retain peak allocated capacity until disposal and upload active transforms each frame. Launches no longer stop at global caps, but extreme populations still cost CPU/GPU time and memory.

These are disclosed game-model limits, not unaddressed occurrences of the two blocking bugs.
