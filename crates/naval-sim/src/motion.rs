use crate::mobility;
use crate::{
    definition::{Handling, Vec3},
    geometry::{Pose, clamp},
    rules::DT,
};
use serde::{Deserialize, Serialize};
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HelmCommand {
    pub throttle: f64,
    pub rudder: f64,
    pub depth_m: Option<f64>,
    pub emergency_blow: Option<bool>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShipState {
    pub id: String,
    pub tick: u64,
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub roll: f64,
    pub pitch: f64,
    pub heading: f64,
    pub speed: f64,
    pub sway_speed: f64,
    pub rudder: f64,
    pub yaw_rate: f64,
    pub distance: f64,
    pub vertical_speed: f64,
    pub wave_heave: f64,
    pub drift_x: f64,
    pub drift_z: f64,
}
#[derive(Clone, Copy, Debug, Deserialize)]
pub struct SeaHandling {
    pub resistance: f64,
    pub drift: [f64; 2],
}
impl ShipState {
    pub fn new(id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            ..Self::default()
        }
    }
    pub fn pose(&self) -> Pose {
        Pose {
            x: self.x,
            y: self.y,
            z: self.z,
            roll: self.roll,
            pitch: self.pitch,
            heading: self.heading,
        }
    }
    pub fn mean_y(&self) -> f64 {
        self.y - self.wave_heave
    }
    pub fn depth(&self) -> f64 {
        (-self.mean_y()).max(0.0)
    }
    pub fn velocity(&self) -> Vec3 {
        let (sin, cos) = (self.heading.sin(), self.heading.cos());
        [
            sin * self.speed + cos * self.sway_speed + self.drift_x,
            self.vertical_speed,
            -cos * self.speed + sin * self.sway_speed + self.drift_z,
        ]
    }
}
fn finite(n: f64) -> f64 {
    if n.is_finite() { n } else { 0.0 }
}
fn approach(n: f64, target: f64, amount: f64) -> f64 {
    n + clamp(target - n, -amount, amount)
}
fn sign(n: f64) -> f64 {
    if n == 0.0 { 0.0 } else { n.signum() }
}
pub fn step_ship(
    s: &mut ShipState,
    c: HelmCommand,
    h: &Handling,
    power: f64,
    steering: f64,
    environment: Option<SeaHandling>,
) {
    let throttle = clamp(finite(c.throttle), -1.0, 1.0);
    let rudder = clamp(finite(c.rudder), -1.0, 1.0) * clamp(finite(steering), 0.0, 1.0);
    let power = clamp(finite(power), 0.0, 1.0);
    let turn_loss = 0.22 * s.rudder.powi(2) * clamp(s.speed.abs() / h.forward_speed, 0.0, 1.0);
    let target = throttle
        * if throttle < 0.0 {
            h.reverse_speed
        } else {
            h.forward_speed
        }
        * power.sqrt()
        * (1.0 - turn_loss)
        * (1.0 - environment.map_or(0.0, |e| e.resistance));
    s.rudder = approach(s.rudder, rudder, h.rudder_rate * mobility::RUDDER_RATE * DT);
    let braking = target.abs() < s.speed.abs() || sign(target) != sign(s.speed);
    s.speed = approach(
        s.speed,
        target,
        if braking {
            h.braking * mobility::BRAKING
        } else {
            h.acceleration * mobility::ACCELERATION * power
        } * DT,
    );
    let authority = clamp(s.speed / h.forward_speed, -0.4, 1.0);
    let yaw = s.rudder * h.max_yaw_rate * mobility::MAX_YAW_RATE * authority;
    s.yaw_rate += (yaw - s.yaw_rate)
        * (1.0 - (-DT * mobility::YAW_RESPONSE / clamp(2.4 * 0.019 / h.max_yaw_rate.max(0.001), 0.8, 6.0)).exp());
    s.heading = (s.heading + s.yaw_rate * DT + std::f64::consts::TAU) % std::f64::consts::TAU;
    s.sway_speed += (-s.yaw_rate * s.speed * 1.5 - s.sway_speed) * (1.0 - (-DT / 4.0).exp());
    if let Some(e) = environment {
        let blend = 1.0 - (-DT / 20.0).exp();
        s.drift_x += (e.drift[0] - s.drift_x) * blend;
        s.drift_z += (e.drift[1] - s.drift_z) * blend;
    }
    let v = s.velocity();
    s.x += v[0] * DT;
    s.z += v[2] * DT;
    s.distance += s.speed.hypot(s.sway_speed) * DT;
    s.tick += 1;
}
