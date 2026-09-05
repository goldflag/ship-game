# Step 3b review — shared drag flight/aiming, seeded dispersion, gun calibration (basslet, base 94de7f3 + working tree)

Reviewer: Claude Fable, read-only CPU review. Diff from 94de7f3: `ballistics.ts` (new), `weapons.ts`, `combat.ts`, `bots.ts`, `damage.ts`, `blueprint.ts`, `guns.json`, `Game.ts`, `measure.ts`, `PortInspection.tsx`, tests. Log: `/tmp/basslet-step3b-tests.log` 150 pass / 0 fail. Probes: `scratchpad/probe7.ts` … `probe10.ts` (base-commit comparison via `git archive`, no shared staging touched).

## Verdict: **accepted. No blockers.** One medium performance item with a concrete fix, four nits.

## Verified
- **Closed-form linear drag is exact and self-consistent.** `ballisticStep` position/velocity match the analytic linear-drag solution (series branch for k·t < 1e-4 is the correct expansion). `solveDragArc` reproduces targets to 1e-7…1e-9 m at 1 km–28 km, above (+500 m at 2 km, +2000 m at 500 m), below (−300 m), and at 1.5 m range; returns null beyond reach (38 cm max solvable 28 250 m; 5-inch 11 100 m; 20 mm 2 500 m). Cost 1.9 µs per solve.
- **Provisional k gives plausible flight**: 38 cm at 20 km → 33 s, 468 m/s impact, 18° descent; at 5 km 731 m/s, 2.6°. Drag vs vacuum flight time at 5 km 6.46 vs 6.10 s.
- **Inherited velocity and moving mounts**: with dispersion disabled, barrel 0 passes within 0.04–0.6 m of a fixed aim point at 5 km and 15 km whether the shooter is stationary or at full speed; barrel 1 is offset by exactly its 3.75 m spacing (solution is per barrel 0, pre-existing and correct). `botAim`/`aimAt` subtract inherited × travelFactor only to converge time and return the pure lead point, so `updateMount` applies the correction once (no double subtraction).
- **Determinism**: with fixed inputs, 30 / 60 / 144 fps produce identical serialized state over 40 s of a fleet battle; seed 7 ≠ seed 8; interleaved `telemetry()` calls do not perturb state (dispersion is stateless per shot index); `reset()` replays byte-identical physics for the same seed (only shell/event ids continue, see N1). Dispersion bounded at 3σ and unbiased (test).
- **Calibration schema**: optional `ballistics` validated (k ≤ 0.5, σ ≤ 0.02 rad, basis required); omitting it restores vacuum/no-spread (test).
- **Sea/armor regressions**: underwater-outside-hull guard covered by test; protected engine-port fixture retained; split-conservation test isolated from the seeded Baltimore scenario. Armor heading says "surfaces"; reference probes state caliber and basis.
- **Consequence in stock scenarios (seed 11, bots idle, Bismarck vs Bismarck):** dispersion and drag finally produce flooding from stock gunnery — 850 m: 1.5 m³; 5 km: 3.0 m³; 15 km: 21 m³ + 3 modules destroyed; 22 km: 928 m³, 6.7° list, 8 modules destroyed (deck penetrations at ~22° descent). Time to the still-active fallback defeat rose from 186 s to 306 s at 5 km and 762–778 s at 15–22 km. Baltimore stern aim at 5 km: 52 m³.

## Findings

### P1 · Solver calls dominate the tick — medium (performance; fix recommended before 3c)
5v5 mixed fleet 60 s: 1.98–2.07 ms/tick on my host (1.27–1.34 at 3a; your 1.69 vs 0.85–1.34). The solver itself is cheap; the volume is not: `updateMount` runs 3 solves per mount per tick and `botAim` 3 more, so ~142 mounts × 6 ≈ 850 solves/tick ≈ 1.6 ms. Concrete fixes, in order of payoff: (1) keep the last flight time in `MountState` and run one warm-started solve per tick (the solution moves slowly; the 3-iteration loop was only needed from a cold guess); (2) compute the bot lead point once per actor/target from the ship centre instead of per mount; (3) skip solving for bot mounts whose target is beyond `botGunRange` or that are disabled/empty. Expect ≈1 ms.

### N1 · `reset()` does not reset shell/event sequences — nit
Physics replays identically but ids continue (first shell id after reset was 51), so raw diagnostics of two runs of the same seed differ. Reset `shellSequence`/`eventSequence` in `clearCombat` for byte-identical replays.

### N2 · Dispersion is circular angular only — calibration nit for a later slice
σ = 0.75 mrad gives 3.75 m radial σ at 5 km, 15 m at 20 km. Real patterns are range-dominated by muzzle-velocity variation; a seeded per-shot speed σ (same stateless hash, second channel) would give elliptical patterns cheaply and keep determinism. Suggest bundling with the velocity/material penetration slice.

### N3 · Seed is random and only visible in diagnostics — nit
`Game.ts` draws a fresh seed per battle. Add a dev-only way to set it (URL param or settings) so a reported battle can be replayed with the CPU fixture.

### N4 · Range guards — nit
`solveBallistic` still returns null beyond 30 km before consulting drag; 38 cm's drag limit (28.25 km) is inside that, but larger guns (Yamato 46 cm, k = 0.0136) may have a drag solution beyond 30 km that the guard hides. Either derive the guard from the drag limit or state the 30 km cap as a rule.

### Pre-existing, observed (not 3b)
- Turrets pinned at their traverse stop still fire, 14–15° off the solution (Cäsar/Dora at −145° while the ship turned); identical on 94de7f3 and consistent with the documented "fire at the current bearing" rule. Consider requiring alignment for the aft/forward stops in a gunnery UX pass.
- Defeat in every stock scenario is still `structural-fallback` (step 5).

## Scope check
No blueprint or model changes; catalog gains optional validated fields with per-part basis text; `Shell.dragPerSecond` optional; shell expiry 60 → 180 s appropriate for drag arcs; `GRAVITY` re-exported from `weapons.ts` keeps callers compatible. Nothing here pre-empts velocity/material penetration, grazing-resistance calibration or fuzes/bursts in 3c.
