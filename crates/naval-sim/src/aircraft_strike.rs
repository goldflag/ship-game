//! Stable stand-off guidance uses reported motion and the two travel speeds.
use crate::{definition::Vec3, geometry::*};

/// Aim where a steady target will be after the remaining aircraft leg, drop,
/// and a nominal 700 m torpedo run. Omitting the aircraft leg makes the aim
/// slide across a moving target throughout the approach, preventing wings-level
/// release. The final release still checks the actual drop/intercept solution.
pub fn torpedo_approach_point(
    position: Vec3,
    aircraft_speed: f64,
    target: Vec3,
    target_velocity: Vec3,
    torpedo_speed: f64,
) -> Vec3 {
    let speed = aircraft_speed.clamp(45.0, 110.0);
    let drop_time = (-3.0 + (9.0_f64 + 19.62 * 26.0).sqrt()) / 9.81;
    let run_distance = 700.0;
    let mut point = target;
    for _ in 0..12 {
        let distance = (point[0] - position[0]).hypot(point[2] - position[2]);
        let aircraft_time = ((distance - run_distance) / speed - drop_time).max(0.0);
        let time = aircraft_time + drop_time + run_distance / torpedo_speed.max(1.0);
        point = add(target, scale(target_velocity, time));
    }
    point[1] = 26.0;
    point
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn straight_motion_has_a_stable_approach_point() {
        let position = [3000.0, 26.0, 0.0];
        let target = [0.0, 0.0, 0.0];
        let velocity = [0.0, 0.0, -15.0];
        let point = torpedo_approach_point(position, 70.0, target, velocity, 25.3);
        let direction = normalize([point[0] - position[0], 0.0, point[2] - position[2]]);
        let next = torpedo_approach_point(
            add(position, scale(direction, 70.0)),
            70.0,
            add(target, velocity),
            velocity,
            25.3,
        );
        assert!(
            length(sub(next, point)) < 0.01,
            "the intercept must not sweep sideways during the run"
        );
    }
}
