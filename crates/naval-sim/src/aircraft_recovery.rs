//! Guidance relative to a translating and rotating flight deck. A final approach
//! follows a moving line, rather than chasing a point that keeps sliding sideways.
use crate::{
    aircraft::Aircraft,
    aircraft_flight::{FlightOptions, fly},
    definition::Vec3,
    geometry::*,
    vessel::Vessel,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryProgress {
    pub stage: String,
    pub best_distance: f64,
    pub stalled_seconds: f64,
    pub go_arounds: u32,
    pub retry_seconds: f64,
    pub notice: Option<String>,
}

/// Restart a missed or non-converging leg without erasing the recovery request.
pub fn track_progress(p: &mut Aircraft, distance: f64, dt: f64) {
    let stage = p.pilot.recovery_stage.clone().unwrap_or_default();
    let r = p.pilot.recovery.get_or_insert_default();
    r.retry_seconds = (r.retry_seconds - dt).max(0.0);
    if r.stage != stage {
        if r.stage == "final" && stage == "marshal" {
            r.go_arounds += 1;
            if r.go_arounds.is_multiple_of(2) {
                r.retry_seconds = 20.0;
            }
        }
        r.stage = stage;
        r.best_distance = distance;
        r.stalled_seconds = 0.0;
    } else if distance < r.best_distance - 25.0 {
        r.best_distance = distance;
        r.stalled_seconds = 0.0;
    } else {
        r.stalled_seconds += dt;
    }
    if r.stalled_seconds > 90.0 && matches!(r.stage.as_str(), "downwind" | "base" | "final") {
        p.pilot.recovery_stage = Some("marshal".into());
        p.pilot.recovery_side = None;
        r.retry_seconds = 20.0;
        r.stalled_seconds = 0.0;
    }
}

/// Beyond this turn rate a stable recovery circuit is unavailable. Hold clear
/// and explain why; do not repeatedly attempt an unreachable final approach.
pub const MAX_RECOVERY_YAW_RATE: f64 = 0.012;

pub fn turn_delays_recovery(actor: &Vessel) -> bool {
    actor.motion.yaw_rate.abs() > MAX_RECOVERY_YAW_RATE
}

pub fn fly_final(p: &mut Aircraft, actor: &Vessel, datum: Vec3, landing: bool, dt: f64) {
    let pose = actor.motion.pose();
    let local = world_to_local(p.position, pose);
    let aft = local[2] - datum[2];
    let closing_speed = if landing { 40.0 } else { 38.0 };
    let height = if landing {
        aft * 0.06
    } else {
        (aft * 0.06).max(90.0)
    };
    let center = local_to_world([datum[0], datum[1] + height, local[2]], pose);
    let offset = sub(center, [pose.x, pose.y, pose.z]);
    let platform_velocity = add(
        actor.motion.velocity(),
        [
            -actor.motion.yaw_rate * offset[2],
            0.0,
            actor.motion.yaw_rate * offset[0],
        ],
    );
    let side = clamp((datum[0] - local[0]) * 0.28, -32.0, 32.0);
    let vertical = if landing || aft > 1500.0 {
        -closing_speed * 0.06
    } else {
        0.0
    };
    let relative = sub(
        local_to_world([side, vertical, -closing_speed], pose),
        local_to_world([0.0; 3], pose),
    );
    let mut velocity = add(platform_velocity, relative);
    velocity[1] += clamp((center[1] - p.position[1]) * 0.6, -12.0, 12.0);
    let speed = length(velocity);
    fly(
        p,
        add(p.position, scale(velocity, 3.0)),
        speed + p.pitch.sin() * 30.0 + p.bank.abs() * 3.0 + p.controls.brakes * 14.0,
        dt,
        FlightOptions {
            landing,
            turn_rate: actor.motion.yaw_rate,
            altitude_lookahead: Some(speed * 3.0),
            ..Default::default()
        },
    );
}
