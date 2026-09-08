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
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
pub struct Pose {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub heading: f64,
    pub roll: f64,
    pub pitch: f64,
}
pub fn rotate(v: Vec3, p: Pose) -> Vec3 {
    let (cr, sr, cp, sp, ch, sh) = (
        p.roll.cos(),
        p.roll.sin(),
        p.pitch.cos(),
        p.pitch.sin(),
        p.heading.cos(),
        p.heading.sin(),
    );
    let x = cr * v[0] - sr * v[1];
    let y = sr * v[0] + cr * v[1];
    let yy = cp * y - sp * v[2];
    let z = sp * y + cp * v[2];
    [ch * x - sh * z, yy, sh * x + ch * z]
}
pub fn local_to_world(v: Vec3, p: Pose) -> Vec3 {
    add(rotate(v, p), [p.x, p.y, p.z])
}
pub fn world_to_local(v: Vec3, pose: Pose) -> Vec3 {
    let p = sub(v, [pose.x, pose.y, pose.z]);
    let (ch, sh, cp, sp, cr, sr) = (
        pose.heading.cos(),
        pose.heading.sin(),
        pose.pitch.cos(),
        pose.pitch.sin(),
        pose.roll.cos(),
        pose.roll.sin(),
    );
    let x = ch * p[0] + sh * p[2];
    let zz = -sh * p[0] + ch * p[2];
    let y = cp * p[1] + sp * zz;
    let z = -sp * p[1] + cp * zz;
    [cr * x + sr * y, -sr * x + cr * y, z]
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
