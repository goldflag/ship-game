# Submarine controls and attack dives

Reviewed 2026-09-06 in Orca's embedded browser using WebGPU and this checkout's Vite server on port 5196. Ship geometry and compiled definitions are unchanged.

## Changes and causes

- Removed the Periscope depth preset. Underwater binocular/bridge cameras already use the authored periscope eye automatically; exterior chase remains available.
- Shallow-dive chase rays could meet the sea above the stern. Moving to the periscope then reversed the camera to retain that point. Entering underwater optics now extends such a nearby aim along the current viewing bearing, preserving forward and deliberately aft viewing.
- Keyboard and HUD depth adjustments share a 2 m step; keybinding labels and documentation match.
- Bot dives previously depended on loaded tubes facing the target and a short timer, producing surface orders during reloads. Combat bots now dive before torpedo range, retain attack depth through turns/reloads, and surface when outside the engagement range or without usable torpedoes. Entry/exit range hysteresis prevents boundary oscillation. Passive target modes remain surfaced.
- Shore avoidance previously rebuilt the helm command without its depth fields. It now preserves depth and emergency ballast orders while changing throttle/rudder.

## Validation

The three new initial regression tests failed before the fixes (near-vertical/reversed zoom, a surfaced approach bot, and a dropped depth order) and passed afterward.

127 tests passed across CameraRig, aiming, GameFrame, FleetHud, keybindings, InputController, submarine, bots, aiLevels, torpedoes and land. An additional bot test passed for turning, engagement boundary hysteresis and exhausted ammunition: 128 relevant tests total. `bun run build` passed fleet/aircraft export checks, TypeScript and Vite bundling. Vite retained its existing large-chunk warning.

Live review used Type VIIC versus a Normal Type VIIC at 5 km, North Atlantic. One Z press ordered 2 m; a Dive button press ordered 4 m. After a 30-second fixed-tick rehearsal, the player's depth was 3.85 m and the enemy's was 6.87 m. Recenter then Shift entered forward-facing optics: camera forward was approximately `[0, -0.0011, -1]`, with its eye at 5.91 m above sea level while the hull was at 3.94 m depth. See [periscope.png](periscope.png).

Leaving optics and pressing Z twice ordered 8 m. After another 45 seconds, the player held 8 m and the bot held 7 m. The underwater chase camera remained behind the hull at approximately Y=-4.5 m. See [chase.png](chase.png) and [browser.json](browser.json). These screenshots confirm rendering and controls, not a performance benchmark or historical fidelity.
