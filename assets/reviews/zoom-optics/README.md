# Zoom optics

The zoom HUD uses an opaque eyepiece surround, a recessed glass rim and horizontal/vertical reticle markings. Range, estimated shell flight time and magnification sit below the center sight. The scroll instruction has been removed.

The camera overlay is independent of the instrument toggle. It clears for chase, inspection, shell/aircraft follow and air operations. The central scene is not blurred or distorted, and the overlay does not intercept input. Reduced motion disables its entry animation.

Run `bun run dev`, open `/scripts/diagnostics/zoom-optics.html`, and call `reviewView({ width: 1440, height: 900 })` in that page to reproduce the paused Bismarck target at 5 km. `scope: false` checks chase and `hidden: true` checks hidden instruments. The scene uses the real game, CPU simulation and HUD with a fixed ocean tick.

Validation: 62 tests passed across ballistics, combat, FleetHud and CameraRig; `bun run build` passed; overlay rendering checks confirmed every suppression condition. Timing checks compare the HUD source against the actual ballistic flight of a moving mount and verify reload time is excluded.

## Captured layout evidence

[Desktop](desktop.png) · [Portrait](portrait.png) · [Short landscape](landscape.png) · [Hidden instruments](hidden.png) · [Chase](chase.png)

These captures render the actual React components and CSS in isolated headless Chrome over a static crop of the game's harbor image. The CPU fixture supplies 5 km / 6.4 s telemetry; the backdrop's apparent ship size does not correspond to that range. They verify composition and responsive fit, not live combat or GPU rendering. [Layout measurements](checks.json) show no horizontal overflow; the short landscape readout clears the weapon controls.

Independent finish review: no material issues in the supplied layouts or source. The desktop preview repeatedly lost its live page, and the paused GPU review did not finish initializing in headless WebGL. Live camera transitions and combat visuals remain unverified in this session.
