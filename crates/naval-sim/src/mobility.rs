//! Shared native/WASM gameplay response tuning.
// Legacy fitting/power calibration stays fixed so existing top speeds are retained.
pub const ACCELERATION: f64 = 1.25;
pub const MAX_YAW_RATE: f64 = 1.1;
// Compress the response to planar forces, including braking and yaw damping,
// without changing displacement, flotation, fitted power or steady ahead speed.
pub const FORCE_RESPONSE: f64 = 2.5;
// Ramp fitted rudder authority with deflection, up to this factor at hard over.
// Area, position, water flow and damage still determine the resulting force.
pub const RUDDER_AUTHORITY: f64 = 4.;
pub const RUDDER_RATE: f64 = 1.2;
pub fn torpedo_speed(authored_speed: f64) -> f64 {
    authored_speed * 1.1
}
