//! Gameplay response tuning; keep in sync with src/simulation/mobility.ts.
pub const ACCELERATION: f64 = 1.25;
pub const BRAKING: f64 = 1.25;
pub const RUDDER_RATE: f64 = 1.2;
pub const MAX_YAW_RATE: f64 = 1.1;
pub const YAW_RESPONSE: f64 = 1.2;
pub fn torpedo_speed(authored_speed: f64) -> f64 { authored_speed * 1.1 }
