# Movable follow camera and squadron role icons

Implemented September 6, 2026.

Aircraft and shell follow share independent orbit angles and a 12–800 m camera distance. Locked mouse movement or an unlocked mouse/touch drag orbits; the wheel changes distance. The target remains centered and its translation is followed without frame-dependent lag. Follow input leaves ship aiming angles and saved binocular magnification unchanged. Mouse clicks do not fire or toggle optics during follow. Return, impact completion, loss and port keep the existing exit behavior; each new follow starts at the default offset. Sea and terrain clearance remains active.

The existing naval SVG icon family now includes a propeller fighter, finned bomb and horizontal torpedo. Squadron cards and airborne tags select the appropriate icon from the authored role and retain accessible role names. The baked aircraft card images remain present. The compact servicing readout reserves space for the icon and countdown.

Validation: **57 tests pass** across CameraRig, ShellFollow, AircraftFollow, GameFrame and AirOperations. Tests exercise locked mouse, left/right drag, touch, zoom bounds, vertical/stationary trajectories, terrain clearance, disabled input, exact target translation and restoring optics/ship aim. The production build, including all ship/aircraft checks and TypeScript, passes. No new in-game screenshot is claimed; the embedded preview's hidden-window limitation is recorded in the previous follow-up.
