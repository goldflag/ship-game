//! Point-mass linear-drag mechanics, ported from simulation/ballistics.ts.
use crate::{
    definition::Vec3,
    geometry::{add, cross, normalize, scale},
    rules::mix32,
};
pub const GRAVITY: f64 = 9.81;
pub fn travel_factor(seconds: f64, drag: f64) -> f64 {
    if drag > 1e-8 {
        -(-drag * seconds).exp_m1() / drag
    } else {
        seconds
    }
}
fn gravity_drop(seconds: f64, drag: f64, factor: f64) -> f64 {
    if drag * seconds < 1e-4 {
        GRAVITY * seconds.powi(2) * (0.5 - drag * seconds / 6.0 + (drag * seconds).powi(2) / 24.0)
    } else {
        GRAVITY * (seconds - factor) / drag
    }
}
pub fn ballistic_step(p: Vec3, v: Vec3, dt: f64, drag: f64) -> (Vec3, Vec3) {
    let f = travel_factor(dt, drag);
    let decay = (-drag * dt).exp();
    let drop = gravity_drop(dt, drag, f);
    (
        [
            p[0] + v[0] * f + 0.0,
            p[1] + v[1] * f - drop,
            p[2] + v[2] * f + 0.0,
        ],
        [
            v[0] * decay + 0.0,
            v[1] * decay - GRAVITY * f,
            v[2] * decay + 0.0,
        ],
    )
}
#[derive(Clone, Copy, Debug, serde::Serialize, serde::Deserialize)]
pub struct Arc {
    pub direction: Vec3,
    pub time: f64,
}
pub fn solve_drag_arc(from: Vec3, target: Vec3, speed: f64, drag: f64) -> Option<Arc> {
    let dx = target[0] - from[0];
    let dy = target[1] - from[1];
    let dz = target[2] - from[2];
    let range2 = dx * dx + dz * dz;
    if range2.sqrt() * drag >= speed {
        return None;
    }
    let mut estimate = (range2 + dy * dy).sqrt() / speed;
    for _ in 0..8 {
        if estimate <= 0.0001 || estimate >= 180.0 {
            break;
        }
        let factor = travel_factor(estimate, drag);
        let vertical = dy + gravity_drop(estimate, drag, factor);
        let speed2 = speed * speed;
        let travel2 = factor * factor;
        let residual = range2 + vertical * vertical - speed2 * travel2;
        let slope = 2.0 * factor * (GRAVITY * vertical - speed2 * (-drag * estimate).exp());
        if slope >= 0.0 || !slope.is_finite() {
            break;
        }
        if residual.abs() <= speed2 * travel2 * 1e-13 {
            return Some(Arc {
                direction: normalize([dx / factor, vertical / factor, dz / factor]),
                time: estimate,
            });
        }
        estimate -= residual / slope;
    }
    let error = |t: f64| {
        let f = travel_factor(t, drag);
        let v = dy + gravity_drop(t, drag, f);
        (range2 + v * v) / (f * f) - speed * speed
    };
    let (mut a, mut b) = (0.0001, 180.0);
    for _ in 0..24 {
        let left = (2.0 * a + b) / 3.0;
        let right = (a + 2.0 * b) / 3.0;
        if error(left) < error(right) {
            b = right;
        } else {
            a = left;
        }
    }
    let (mut low, mut high) = (0.0001, (a + b) / 2.0);
    if error(high) > 0.0 {
        return None;
    }
    for _ in 0..36 {
        let mid = (low + high) / 2.0;
        if error(mid) > 0.0 {
            low = mid;
        } else {
            high = mid;
        }
    }
    let time = (low + high) / 2.0;
    let factor = travel_factor(time, drag);
    Some(Arc {
        direction: normalize([
            dx / factor,
            (dy + gravity_drop(time, drag, factor)) / factor,
            dz / factor,
        ]),
        time,
    })
}
fn random(seed: u32) -> f64 {
    mix32(seed) as f64 / 4294967296.0
}
pub fn dispersed_speed(speed: f64, sigma: f64, seed: u32, shot: u32) -> f64 {
    if sigma == 0.0 {
        return speed;
    }
    let first = seed ^ shot.wrapping_add(1).wrapping_mul(0x9e3779b9) ^ 0x4cf5ad43;
    let normal = (-2.0 * random(first).max(1e-12).ln()).sqrt()
        * (2.0 * std::f64::consts::PI * random(first ^ 0x7f4a7c15)).cos();
    speed * (1.0 + normal.clamp(-3.0, 3.0) * sigma)
}
pub fn velocity_penetration(budget: f64, before: f64, after: f64) -> f64 {
    if before > 1e-8 {
        budget * (after / before).powf(1.4)
    } else {
        0.0
    }
}
pub fn dispersed_direction(direction: Vec3, spread: f64, seed: u32, shot: u32) -> Vec3 {
    if spread == 0.0 {
        return direction;
    }
    let first = seed ^ shot.wrapping_add(1).wrapping_mul(0x9e3779b9);
    let radius = (-2.0 * random(first).max(1e-12).ln()).sqrt().min(3.0) * spread;
    let angle = 2.0 * std::f64::consts::PI * random(first ^ 0x68bc21eb);
    let side = normalize(if direction[1].abs() < 0.99 {
        [direction[2], 0.0, -direction[0]]
    } else {
        [0.0, direction[2], -direction[1]]
    });
    normalize(add(
        add(direction, scale(side, radius * angle.cos())),
        scale(cross(side, direction), radius * angle.sin()),
    ))
}
