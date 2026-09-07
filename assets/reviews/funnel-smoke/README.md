# Funnel exhaust review

The renderer derives outlets from the existing versioned ship structures, without changing blueprints or model geometry. One fleet particle batch produces light idle exhaust, thicker underway trails, buoyant rise and map-wind drift. Released smoke remains in world space. Aggregate propulsion loss or a submerged outlet stops emission; old puffs dissipate. Pause freezes the effect, inspection hides it, binoculars hide own-ship exhaust, and replacing a ship or resetting its damage clears the old trail.

Browser review used Orca's embedded browser with WebGPU on the actual development game at port 5175. The [pause check](paused-check.json) retained 91 particles and unchanged simulation tick/outlet diagnostics across 30 paused display frames. Images are captures of the game canvas, without HUD overlays:

- [Bismarck in port](bismarck-port.png): one plume begins at the slanted funnel rim.
- [Fletcher in port](fletcher-port.png): independent plumes at both raked funnels after switching from Bismarck.
- [Fletcher underway](fletcher-underway.webp): stronger exhaust trails behind the moving hull and drifts sideways. A custom battle against Bismarck also registered the enemy's funnel. The development advance hook accelerated the sailing setup; ordinary displayed frames then produced the trail.

Validation passed: TypeScript, `bun run build` (all published ship/aircraft checks and production bundle), and 45 targeted tests across `ShipFunnelSmoke`, `CombatEffects`, `ShipView`, ship motion and machinery. The existing Yamato flooding test exceeded Bun's default five-second timeout; it passed on rerun with `--timeout 30000` at about 10.5 seconds. New tests cover all registered presets, angled/offset outlets, world-space drift without combat mutation, pause, optics hiding, reset, machinery loss, immersion, sinking, display-rate emission timing, and a bounded 60-ship/twin-funnel pool. The branch was subsequently rebased onto current master for the PR, and outlet coverage includes both King George V funnels.

Exhaust color, density, lifetime and propulsion response are visual approximations. Individual boilers are not routed to individual uptakes. Surface ships without a recognized authored funnel structure emit no exhaust; Type VIIC has no funnel emitter. Geometry export checks and these screenshots establish placement and runtime behavior, not historical exhaust accuracy.
