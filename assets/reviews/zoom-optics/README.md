# Zoom optics

The zoom HUD uses a wide rounded rectangular eyepiece, an opaque surround and a recessed glass rim, following the [user's reference](reference.png). The horizontal lead ruler spans the clear lens from edge to edge. Its marks and numbers retain their size as the lens widens, and remain aligned with the lens when HUD scaling changes. The central sight stays compact. Range, estimated shell flight time and magnification sit below the sight, or above it on short instrument layouts to clear the weapon controls. The scroll instruction has been removed.

The camera overlay is independent of the instrument toggle. It clears for chase, inspection, shell/aircraft follow and air operations. The central scene is not blurred or distorted, and the overlay does not intercept input. Reduced motion disables its entry animation.

Run `bun run dev`, open `/scripts/diagnostics/zoom-optics.html`, and call `reviewView({ width: 1440, height: 900 })` in that page to reproduce the paused Bismarck target at 5 km. `scope: false` checks chase, `hidden: true` checks hidden instruments, and `hudScale: 1.5` checks larger instruments. The scene uses the real game, CPU simulation and HUD with a fixed ocean tick.

Validation: 71 tests passed across ballistics, combat, FleetHud, CameraRig and HUD settings; `bun run build` passed. Timing checks compare the HUD source against the actual ballistic flight of a moving mount and verify reload time is excluded. The follow-up changes affect only the sight presentation and review harness.

## Captured layout evidence

[Desktop](desktop.png) · [Wide reference aspect](wide.png) · [Portrait](portrait.png) · [Short landscape](landscape.png) · [150% HUD](large-hud.png) · [75% HUD](small-hud.png) · [Hidden instruments](hidden.png) · [Chase](chase.png)

These captures render the actual React components, instrument scaling container and CSS in isolated headless Chrome over a static crop of the game's harbor image. The CPU fixture supplies 5 km / 6.4 s telemetry; the backdrop's apparent ship size does not correspond to that range. They verify composition and responsive fit, not live combat or GPU rendering. [Layout measurements](checks.json) show no horizontal overflow; assertions confirm the ruler meets both inner lens edges within one pixel, the readout stays inside the lens, and it clears the weapon controls at every captured size.

Independent finish review: **Pass** for this bounded refinement, with no material findings across the source, supplied reference and all eight captures. Live camera transitions and combat visuals remain unverified in this follow-up. The prior session's paused GPU review did not finish initializing in headless WebGL.
