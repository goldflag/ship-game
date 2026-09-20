//! Shared native/WASM gameplay response tuning.
// Legacy fitting/power calibration stays fixed so existing top speeds are retained.
pub const ACCELERATION: f64 = 1.25;
pub const MAX_YAW_RATE: f64 = 1.1;
// Compress the response to planar forces, including braking and yaw damping,
// without changing displacement, flotation, fitted power or steady ahead speed.
pub const FORCE_RESPONSE: f64 = 2.;
// Ramp fitted rudder authority with deflection, up to this factor at hard over.
// Area, position, water flow and damage still determine the resulting force.
pub const RUDDER_AUTHORITY: f64 = 2.;
pub const RUDDER_RATE: f64 = 1.2;
// World distance and heading covered per unit of physical ship motion. Ship and
// aircraft state stays physical for readouts, hydrodynamics and contacts; pose
// integration, world velocity and combat cadence carry the pace.
pub const SHIP_PACE: f64 = 1.5;
// Physical shell seconds elapsed per battle second: shells follow their
// physical arc and keep physical speeds, arriving sooner.
pub const SHELL_PACE: f64 = 1.25;
pub fn torpedo_speed(authored_speed: f64) -> f64 {
    authored_speed * 2.
}
