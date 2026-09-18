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
gameplay tuning in `mobility.rs` applies a ×2.5 response to all planar forces and
torques, up to ×4 rudder force authority at hard over, and ×1.2 authored rudder
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

Hull coefficients are provisional: skin coefficient `0.004`, a fullness form
factor, projected frontal coefficient `0.18`, and a bounded Froude-dependent wave
term. These are deliberately simple engineering/game estimates, not CFD or
measured performance curves. Forces are reduced to surge, sway and yaw; roll/pitch
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

For reproducible movement-only timing and 180-second ahead/half/turn/coast/astern
trials, run:

```sh
cargo run --release --locked -p naval-sim --example maneuvering_trial -- public/models/fletcher.json public/models/bismarck.json public/models/valiant.json
```

The diagnostic reports time to half/90% ahead speed, a 90° course change and a
crash stop, plus speed/heading at 10, 30 and 60 seconds. It also reports preparation
time and microseconds per ship tick separately.
It excludes flooding, weapons, collision detection, rendering and match scheduling;
it must not be presented as a whole-game frame-rate measurement.
