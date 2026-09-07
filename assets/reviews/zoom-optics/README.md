# Zoom optics

The zoom HUD uses an opaque eyepiece surround, a recessed glass rim and horizontal/vertical reticle markings. Range, estimated shell flight time and magnification sit below the center sight. The scroll instruction has been removed.

The camera overlay is independent of the instrument toggle. It clears for chase, inspection, shell/aircraft follow and air operations. The central scene is not blurred or distorted, and the overlay does not intercept input. Reduced motion disables its entry animation.

Run `bun run dev`, open `/scripts/diagnostics/zoom-optics.html`, and call `reviewView({ width: 1440, height: 900 })` in that page to reproduce the paused Bismarck target at 5 km. `scope: false` checks chase and `hidden: true` checks hidden instruments. The scene uses the real game, CPU simulation and HUD with a fixed ocean tick.

Validation: 62 tests passed across ballistics, combat, FleetHud and CameraRig; `bun run build` passed; overlay rendering checks confirmed every suppression condition. Timing checks compare the HUD source against the actual ballistic flight of a moving mount and verify reload time is excluded.
