use crate::{definition::Vec3, geometry::Pose};
use serde::{Deserialize, Serialize};
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(optional_fields)]
pub struct HelmCommand {
    pub throttle: f64,
    pub rudder: f64,
    pub depth_m: Option<f64>,
    pub emergency_blow: Option<bool>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct ShipState {
    pub id: String,
    #[ts(type = "number")]
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
    /// The hull's rotation basis, for a caller that rotates more than one point
    /// through the same attitude. Identical to `pose()` fed to `rotate`.
    pub fn basis(&self) -> crate::geometry::Basis {
        crate::geometry::Basis::of(self.pose())
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
/// Shared authoritative movement entry point for battles and native trials.
pub fn step_ship(
    ship: &mut crate::vessel::Vessel,
    command: HelmCommand,
    environment: Option<SeaHandling>,
) {
    let compiled = ship.compiled.clone();
    crate::maneuvering::step(
        ship,
        &compiled.definition,
        &compiled.maneuvering,
        command,
        environment,
    );
}
