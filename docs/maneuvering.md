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
interpolations, artificial turn-speed penalties or gameplay yaw caps. The 20%
rudder-shift boost remains; former acceleration/turn multipliers only inform
legacy calibration. Submarines retain their authored submerged power calibration
and separate depth controls.

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
trials, and constructed estimates do not receive the old acceleration/yaw boosts.

## Validation

`crates/naval-sim/tests/maneuvering.rs` covers signed leverage, area, asymmetric and
angled thrust, wash, immersion, shape resistance, disconnected power, dry/flooded
inertia, exact water moments, stopping/reverse, small-hull stability and replay
repeatability. Navigation, mission and carrier tests run the same force solver.

For reproducible movement-only timing and 180-second ahead/half/turn/coast/astern
trials, run:

```sh
cargo run --release --locked -p naval-sim --example maneuvering_trial -- public/models/fletcher.json public/models/bismarck.json public/models/valiant.json
```

The diagnostic reports preparation time and microseconds per ship tick separately.
It excludes flooding, weapons, collision detection, rendering and match scheduling;
it must not be presented as a whole-game frame-rate measurement.
