use crate::definition::Vec3;
use serde::{Deserialize, Serialize};
pub fn clamp(n: f64, min: f64, max: f64) -> f64 {
    n.max(min).min(max)
}
pub fn radians(n: f64) -> f64 {
    n * std::f64::consts::PI / 180.0
}
pub fn add(a: Vec3, b: Vec3) -> Vec3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
pub fn sub(a: Vec3, b: Vec3) -> Vec3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
pub fn scale(a: Vec3, s: f64) -> Vec3 {
    [a[0] * s, a[1] * s, a[2] * s]
}
pub fn length(a: Vec3) -> f64 {
    a[0].hypot(a[1]).hypot(a[2])
}
/// Range queries need a comparison, not a correctly rounded distance. Avoid
/// WASM's software hypot/FMA path away from the boundary, retaining the original
/// calculation in its rounding band and for extreme/non-finite inputs.
pub fn within_distance(a: Vec3, b: Vec3, radius: f64) -> bool {
    let delta = sub(a, b);
    let squared = dot(delta, delta);
    let limit = radius * radius;
    if radius >= 0.0 && squared.is_finite() && limit.is_normal() {
        let uncertainty = 16.0 * f64::EPSILON * squared.max(limit);
        if (squared - limit).abs() > uncertainty {
            return squared < limit;
        }
    }
    length(delta) <= radius
}
pub fn normalize(a: Vec3) -> Vec3 {
    let n = length(a);
    scale(a, 1.0 / if n == 0.0 { 1.0 } else { n })
}
pub fn dot(a: Vec3, b: Vec3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
pub fn cross(a: Vec3, b: Vec3) -> Vec3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
pub fn wrap_angle(a: f64) -> f64 {
    (a + std::f64::consts::PI).rem_euclid(std::f64::consts::TAU) - std::f64::consts::PI
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Pose {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub heading: f64,
    pub roll: f64,
    pub pitch: f64,
}
/// The six trigonometric values a pose resolves to, plus its origin, computed
/// once for a pose that serves more than one rotation. A ship holds one attitude
/// for the whole tick, and `rotate` was called from the module, mount, muzzle,
/// sensor and hull paths, each recomputing the same three sines and cosines.
///
/// Every product below is the expression the free functions evaluate, operand
/// for operand and in the same order, so a basis is bit-identical to them:
/// `rotate`, `local_to_world` and `world_to_local` are now thin wrappers that
/// build a basis and apply it.
#[derive(Clone, Copy, Debug)]
pub struct Basis {
    cr: f64,
    sr: f64,
    cp: f64,
    sp: f64,
    ch: f64,
    sh: f64,
    origin: Vec3,
}
impl Basis {
    pub fn of(p: Pose) -> Self {
        Self {
            cr: p.roll.cos(),
            sr: p.roll.sin(),
            cp: p.pitch.cos(),
            sp: p.pitch.sin(),
            ch: p.heading.cos(),
            sh: p.heading.sin(),
            origin: [p.x, p.y, p.z],
        }
    }
    pub fn rotate(&self, v: Vec3) -> Vec3 {
        let (cr, sr, cp, sp, ch, sh) = (self.cr, self.sr, self.cp, self.sp, self.ch, self.sh);
        let x = cr * v[0] - sr * v[1];
        let y = sr * v[0] + cr * v[1];
        let yy = cp * y - sp * v[2];
        let z = sp * y + cp * v[2];
        [ch * x - sh * z, yy, sh * x + ch * z]
    }
    pub fn local_to_world(&self, v: Vec3) -> Vec3 {
        add(self.rotate(v), self.origin)
    }
    pub fn world_to_local(&self, v: Vec3) -> Vec3 {
        let p = sub(v, self.origin);
        let (ch, sh, cp, sp, cr, sr) = (self.ch, self.sh, self.cp, self.sp, self.cr, self.sr);
        let x = ch * p[0] + sh * p[2];
        let zz = -sh * p[0] + ch * p[2];
        let y = cp * p[1] + sp * zz;
        let z = -sp * p[1] + cp * zz;
        [cr * x + sr * y, -sr * x + cr * y, z]
    }
}
pub fn rotate(v: Vec3, p: Pose) -> Vec3 {
    Basis::of(p).rotate(v)
}
pub fn local_to_world(v: Vec3, p: Pose) -> Vec3 {
    Basis::of(p).local_to_world(v)
}
pub fn world_to_local(v: Vec3, pose: Pose) -> Vec3 {
    Basis::of(pose).world_to_local(v)
}
#[derive(Clone, Copy, Debug)]
pub struct SegmentHit {
    pub t: f64,
    pub exit: f64,
    pub normal: Vec3,
    pub point: Vec3,
}
pub fn segment_box(from: Vec3, to: Vec3, center: Vec3, size: Vec3) -> Option<SegmentHit> {
    let epsilon = 1e-9;
    let (mut enter, mut exit) = (0.0_f64, 1.0_f64);
    let mut normal = [0.0; 3];
    let delta = sub(to, from);
    for axis in 0..3 {
        let (low, high) = (
            center[axis] - size[axis] / 2.0,
            center[axis] + size[axis] / 2.0,
        );
        if delta[axis].abs() < 1e-10 {
            if from[axis] < low - epsilon || from[axis] > high + epsilon {
                return None;
            }
            continue;
        }
        let (mut a, mut b) = (
            (low - from[axis]) / delta[axis],
            (high - from[axis]) / delta[axis],
        );
        let mut sign = -1.0;
        if a > b {
            std::mem::swap(&mut a, &mut b);
            sign = 1.0;
        }
        if a >= enter - epsilon {
            enter = enter.max(a);
            normal = [0.0; 3];
            normal[axis] = sign;
        }
        exit = exit.min(b);
        if enter > exit + epsilon {
            return None;
        }
    }
    enter = clamp(enter, 0.0, 1.0);
    exit = clamp(exit, enter, 1.0);
    Some(SegmentHit {
        t: enter,
        exit,
        normal,
        point: add(from, scale(delta, enter)),
    })
}
pub fn contains(center: Vec3, size: Vec3, p: Vec3) -> bool {
    (0..3).all(|i| (p[i] - center[i]).abs() <= size[i] / 2.0)
}
pub fn segment_overlaps_box(from: Vec3, to: Vec3, center: Vec3, size: Vec3) -> bool {
    segment_box(from, to, center, size.map(|s| s + 2e-5)).is_some()
}
#[cfg(test)]
mod tests {
    use super::*;
    /// A pseudo-random stream, so the comparison covers the pose space without
    /// a dependency. The comparison is bit-for-bit: a rounded one would not
    /// prove the hoisted basis leaves the simulation's arithmetic alone.
    fn sample(state: &mut u64) -> f64 {
        *state = state
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        ((*state >> 11) as f64 / (1u64 << 53) as f64) * 2.0 - 1.0
    }
    #[test]
    fn a_basis_reproduces_the_free_rotation_bit_for_bit() {
        let mut state = 0x5eed_1234_9abc_def0;
        for _ in 0..20_000 {
            let pose = Pose {
                x: sample(&mut state) * 9000.0,
                y: sample(&mut state) * 40.0,
                z: sample(&mut state) * 9000.0,
                heading: sample(&mut state) * std::f64::consts::PI,
                roll: sample(&mut state) * 1.2,
                pitch: sample(&mut state) * 0.6,
            };
            let v = [
                sample(&mut state) * 300.0,
                sample(&mut state) * 300.0,
                sample(&mut state) * 300.0,
            ];
            let basis = Basis::of(pose);
            let bits = |v: Vec3| v.map(f64::to_bits);
            assert_eq!(bits(rotate(v, pose)), bits(basis.rotate(v)));
            assert_eq!(bits(local_to_world(v, pose)), bits(basis.local_to_world(v)));
            assert_eq!(bits(world_to_local(v, pose)), bits(basis.world_to_local(v)));
        }
    }
}
