# Ship maneuvering

The authoritative Rust simulation uses planar force/torque integration for every
ship, in native matches and browser WASM. `motion::step_ship` and the battle tick
use the same `maneuvering` solver. Vertical motion, heel and trim remain owned by
the hydrostatic/submarine solvers; this is not a fully coupled six-axis fluid model.

## Design consequences

- Each propeller applies thrust at its module center and fitted bearing. Opposite
  screws balance when healthy; damage or exposure creates asymmetric thrust and
  yaw. One broken screw no longer disables healthy screws sharing its engine.
  Engine/funnel availability still limits connected power. Independent player
  shaft orders are not added: the existing telegraph commands all engines.
- Rudder force depends on catalog area, actual immersion, angle and local water
  velocity, including sway and rotation at the fitting. Signed distance to loaded
  CG determines leverage: a bow rudder does not inherit a stern rudder's sign.
  Propeller wash reaches only downstream, nearby, aligned rudders, so correct
  placement provides steerage from rest. Reverse flow reverses rudder response.
- Submerged exposed hull surfaces determine wetted area and projected bluntness.
  Volume, length, beam and draft supply hull fullness and a smooth wave-resistance
  term. Twelve longitudinal strips apply sideways drag and yaw damping. Fine
  entries can reduce drag; broad/blunt hulls require more power. Multihull wetted
  surfaces are retained, but wave interference between hulls is not resolved.
- Dry loading uses authored/constructed mass, CG and diagonal inertia. Flooding
  refreshes these properties with the existing hydrostatic cadence, reusing
  clipped water moments, including intrinsic yaw inertia. Legacy ships without a
  stability profile use box-room water estimates every half second. Flooding also
  increases a bounded draft/resistance approximation through displacement ratio.
  Extra mass slows acceleration; mass near the ends increases turning inertia.

## Contract and calibration

`ShipBlueprint.maneuvering` is an optional version-1 extension shared by historical
presets and constructed ships. `propellers` retain `moduleId`, `bearingDeg` and
`diameterM`; `rudders` retain `moduleId`, `bearingDeg` and `areaM2`. Positions come
from the corresponding module envelopes. Both native admission and TypeScript
blueprint compilation validate dimensions, version, uniqueness and matching roles.
Construction copies diameter/area from the equipment catalog, normalizes bearing,
and derives handling estimates only after final hull/loading/support geometry.

Older presets lack actual propeller/rudder data: their steering-room and shaft
volumes are damage envelopes, not measured blades. The fallback infers effective
power from authored acceleration, normalizes resistance to authored ahead speed,
and estimates effective rudder area from authored turning calibration. An astern
advance-efficiency curve preserves the authored reverse speed while allowing
crash-back thrust during forward motion. Missing shaft geometry uses an explicitly
estimated centerline screw. Explicit physical profiles bypass rudder-area inference;
constructed ships bypass authored speed/power calibration entirely. These legacy
estimates are gameplay compatibility, not historical measurements.

Engine order represents a normalized shaft-speed request; effective power varies
with the cube of its magnitude. Thrust is power divided by an advance-speed and
induced-flow estimate, which remains finite at rest. Rudder normal force includes
both turning force and longitudinal resistance. There are no target speed/yaw
interpolations, artificial turn-speed penalties or gameplay yaw caps. Shared
gameplay tuning in `mobility.rs` applies a ×2 response to all planar forces and
torques, up to ×2 rudder force authority at hard over, and ×1.2 authored rudder
shift. These moderated boosts retain heavier acceleration, braking and helm
response while keeping course changes practical during a fight. Rudder authority
is a gameplay coefficient, not a claim of physical blade performance; area, signed
leverage, flow, exposure and equipment damage still govern its force.
The authority boost ramps with actual rudder deflection; an amidships blade keeps
its ordinary passive drag so it cannot overpower angled propeller thrust.
The implicit force solver bounds the response on small/light hulls.

Response scaling uses effective mass/inertia only inside planar integration.
Actual displacement, CG, flooded loading, resistance and fitted power remain
unchanged, preserving straight-line equilibrium speed and the penalty for added
mass. Navigation's braking estimate uses the same response scale. The former
acceleration/turn multipliers only inform legacy calibration. Submarines retain
their authored submerged power calibration and separate depth controls.

## World pace

`SHIP_PACE` (×1.5, mirrored in `src/ships/mobility.ts`) makes ships cover ground
faster without changing their physics or readouts. `ShipState.speed`,
`sway_speed` and `yaw_rate` stay physical: hydrodynamics, speed orders, the HUD,
fleet chart and port statistics all show the authored/physical figure (a 30 kn
ship reads 30 kn). Pose integration advances position and heading by
`SHIP_PACE`, so a ship crosses the sea at 45 kn and keeps the same turning
circle. `ShipState::velocity()` / `motionVelocity` return this world velocity
(sea drift is not paced), and every world consumer — gun and torpedo leads,
sensors, shell inheritance, carrier decks — reads it. `physical_velocity()`
serves ship-to-ship and grounding contacts, whose impulses change the physical
body speed; `world_yaw_rate()` serves anything that rotates with the hull.
Navigation compares world distances with physical speeds by converting at the
boundary: look-aheads and arrival radii multiply by the pace, station
velocities divide by it before `throttle_for_speed`, and the braking estimate is
expressed per world metre.

Aircraft share the pace, so air-to-sea motion is unchanged: a strike closes, a
fighter intercepts and a plane lands exactly as before. `Aircraft.velocity` is
paced world motion and `Aircraft::airspeed()` is the real airspeed, which is what
`fly` integrates, what requested speeds mean and what airframe limits bound.
World turn rates (a bombing run's aim rate, a carrier's helm) convert to the
physical rate the airframe banks for. Air-combat cadence — gun cooldowns, pilot
re-assessment, aim and evasion timers — runs at the pace as well, so a pass
carries the same fire and the same decisions as before.

Gun shells run on their own pace; see the [runtime contract](ship-runtime-contract.md#mobility-tuning).

Hull resistance is the ITTC-57 friction line for the hull's Reynolds number with
form factor `0.2` and roughness allowance `0.0004`, a wave term that rises through
Froude `0.32` and levels off past the hump (plateau `0.0075 * sqrt(B/L)`), and
projected frontal coefficient `0.18`. The wave and friction constants are
calibrated so that preset hulls carrying their ships' historical machinery reach
their trial speeds: Bismarck, King George V, Admiral Hipper, Baltimore, Fletcher
and Kagero all land within 0.7 kn (0.5 kn RMS). Legacy authored ships are
unaffected, because their drag is normalized to their authored ahead speed. These
remain simple engineering/game estimates, not CFD or measured performance curves. Forces are reduced to surge, sway and yaw; roll/pitch
moments from thrust, cavitation, detailed rudder stall, propeller swirl, shaft RPM
inertia, unsteady wake flow and dynamic changes in dry ammunition/fuel mass are
not modeled. Floodwater mass changes do not model inflow momentum exchange.

## Cost and controls

`CompiledShip` caches immutable resistance coefficients, appendages, wash links and
a speed/power lookup shared by all instances. Hull clipping happens during content
compilation/admission, never at movement ticks. Per-tick work scales with fittings,
propulsion groups and twelve strips; fixed scratch buffers avoid heap allocation.
Exact floodwater moments reuse the existing clipping solve. Implicit directional
drag prevents small/light hulls from numerically reversing velocity in one step.

Autopilots use the cached speed/power curve, compensate for sideslip, apply astern
thrust when braking, and use sternway to rejoin nearby stopped formation stations.
A lost leader causes local braking rather than a pursuit of its last location.
Torpedo evasion allows twelve seconds for an inertial dodge; aircraft corrections
retain eight. Port acceleration/turning readings are references, not measured sea
trials; constructed estimates describe the underlying physical calibration before
the shared runtime response and rudder-authority boosts.

## Validation

`crates/naval-sim/tests/maneuvering.rs` covers signed leverage, area, asymmetric and
angled thrust, wash, immersion, shape resistance, disconnected power, dry/flooded
inertia, exact water moments, stopping/reverse, small-hull stability and replay
repeatability. Navigation, mission and carrier tests run the same force solver.
`maneuvering_response.rs` exercises published legacy and constructed ships through
the battle movement entry point: time to cruise, crash stopping, turns in both
directions, countersteering, preserved top speed and navigation braking estimates.

### Handling trial and gate

`bun run ship:trial <id>` runs 180-second ahead/half/turn/coast/astern trials on any
preset, Blender-recipe or construction, and prints a table: top speed, time to 90%
speed, hard-turn speed and its share of top speed, hard-turn rate, time to turn 90°,
steady turning circle, crash stop, astern speed, plus the port's turning circle,
displacement, draft and wetted area for context. It compiles the working tree's
blueprint (no `ship:build` needed; `--published` reads `public/models/<id>.json`)
and builds the example on the `test-fast` profile (about 30 s cold, then instant).

`--vs [ref]` (default `origin/master`) runs the same trial on the definition published
at that ref (`git show <ref>:public/models/<id>.json`; no worktree) and prints both
columns with the change. The trial needs nothing else: the hydrostatic table serves
flotation and sea motion, not this planar solver. **The handling gate**
(`HANDLING_GATE` in `scripts/construction/trial.ts`): top speed, hard-turn speed as a
share of top, hard-turn rate and time to turn 90° stay within 10% of the baseline. A
row that gets worse beyond it fails (exit 1); a gain beyond it is reported and kept
when it follows from the corrected hull. Run it after any hull, draft, mass or
screw/rudder/steering-room change. Legacy ships infer a centreline screw at 0.6 × draft
that washes the steering-room rudder, so re-seating a hull can move the screw against
the steering room: King George V's re-seat cut her hard-turn speed from 71% to 27% of
top speed until the steering room was put back 3.3 m above the inferred screw.

Fix a regression in ship data, never by editing `handling.maxYawRate`: for a legacy
ship it sets the inferred rudder area and it also feeds the port's turning circle and
maneuverability score (`src/ships/statistics.ts`), so tuning it to pass the gate
shows players a worse turn than the ship makes. The table's "Port turning circle"
row shows that display value.

The raw example is still available for scripting:

```sh
cargo run --profile test-fast --locked -p naval-sim --example maneuvering_trial -- public/models/fletcher.json public/models/bismarck.json
```

It prints one JSON line per ship: time to half/90% ahead speed, a 90° course change
and a crash stop, plus speed/heading at 10, 30 and 60 seconds, preparation time and
microseconds per ship tick (use `--release` for timing).
It excludes flooding, weapons, collision detection, rendering and match scheduling;
it must not be presented as a whole-game frame-rate measurement.
