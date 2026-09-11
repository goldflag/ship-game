//! Continuous barrel motion against original, base-local installation surfaces.
//! Full recoil is reserved before moving, independently of the firing path.
use crate::{
    definition::{MountDefinition, Vec3},
    geometry::*,
    protection::segment_plate,
    weapons::{barrel_height, barrel_offset},
};

fn squared(p: Vec3) -> f64 {
    dot(p, p)
}
fn point_segment(p: Vec3, a: Vec3, b: Vec3) -> f64 {
    let ab = sub(b, a);
    let t = clamp(dot(sub(p, a), ab) / squared(ab).max(1e-20), 0.0, 1.0);
    squared(sub(p, add(a, scale(ab, t))))
}
fn point_triangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3) -> f64 {
    let n = cross(sub(b, a), sub(c, a));
    let nn = squared(n);
    let distance = dot(sub(p, a), n);
    let q = sub(p, scale(n, distance / nn));
    if [(a, b), (b, c), (c, a)]
        .iter()
        .all(|&(u, v)| dot(cross(sub(v, u), sub(q, u)), n) >= -1e-12)
    {
        return distance * distance / nn;
    }
    point_segment(p, a, b)
        .min(point_segment(p, b, c))
        .min(point_segment(p, c, a))
}
fn segment_distance(p: Vec3, q: Vec3, a: Vec3, b: Vec3) -> f64 {
    let u = sub(q, p);
    let v = sub(b, a);
    let w = sub(p, a);
    let aa = dot(u, u);
    let bb = dot(u, v);
    let cc = dot(v, v);
    let dd = dot(u, w);
    let ee = dot(v, w);
    let det = aa * cc - bb * bb;
    let mut s = if det > 1e-20 {
        clamp((bb * ee - cc * dd) / det, 0.0, 1.0)
    } else {
        0.0
    };
    let mut t = (bb * s + ee) / cc.max(1e-20);
    if t < 0.0 {
        t = 0.0;
        s = clamp(-dd / aa.max(1e-20), 0.0, 1.0);
    } else if t > 1.0 {
        t = 1.0;
        s = clamp((bb - dd) / aa.max(1e-20), 0.0, 1.0);
    }
    squared(sub(add(p, scale(u, s)), add(a, scale(v, t))))
}
pub fn segment_triangle_distance(p: Vec3, q: Vec3, a: Vec3, b: Vec3, c: Vec3) -> f64 {
    if segment_plate(p, q, &[a, b, c]).is_some() {
        return 0.0;
    }
    point_triangle(p, a, b, c)
        .min(point_triangle(q, a, b, c))
        .min(segment_distance(p, q, a, b))
        .min(segment_distance(p, q, b, c))
        .min(segment_distance(p, q, c, a))
        .max(0.0)
        .sqrt()
}
pub fn gun_clearance(m: &MountDefinition, train: f64, elevation: f64) -> f64 {
    let Some(c) = &m.travel_clearance else {
        return f64::INFINITY;
    };
    let w = &m.weapon;
    let (ct, st, ce, se) = (train.cos(), train.sin(), elevation.cos(), elevation.sin());
    let mut distance = f64::INFINITY;
    for barrel in 0..w.barrel_count.unwrap_or(2.0) as usize {
        for capsule in &c.barrels {
            let x = barrel_offset(w, barrel);
            let up = barrel_height(w, barrel) + capsule.height_m;
            let point = |along: f64| {
                let forward = w.trunnion_forward + along * ce - up * se;
                [
                    ct * x + st * forward,
                    w.pivot_height + along * se + up * ce,
                    st * x - ct * forward,
                ]
            };
            let from = point(capsule.from_m - if capsule.recoils { w.recoil_m } else { 0.0 });
            let to = point(capsule.to_m);
            for ids in &c.surface.triangles {
                let [a, b, d] = ids.map(|i| c.surface.vertices[i as usize]);
                let threshold = distance + capsule.radius_m;
                let mut gap = 0.0;
                for i in 0..3 {
                    gap += 0.0_f64
                        .max(a[i].min(b[i]).min(d[i]) - from[i].max(to[i]))
                        .max(from[i].min(to[i]) - a[i].max(b[i]).max(d[i]))
                        .powi(2);
                }
                if threshold <= 0.0 || gap > threshold * threshold {
                    continue;
                }
                distance =
                    distance.min(segment_triangle_distance(from, to, a, b, d) - capsule.radius_m);
            }
        }
    }
    distance
}
/// Distance is Lipschitz with respect to the bounded motion of either segment
/// endpoint. Each accepted step therefore clears the whole curved interval.
pub fn clear_gun_motion(
    m: &MountDefinition,
    train: f64,
    elevation: f64,
    next_train: f64,
    next_elevation: f64,
) -> f64 {
    let Some(c) = &m.travel_clearance else {
        return 1.0;
    };
    let dt = next_train - train;
    let de = next_elevation - elevation;
    let w = &m.weapon;
    if dt == 0.0 && de == 0.0 {
        return 1.0;
    }
    let mut reach: f64 = 0.0;
    for p in &c.barrels {
        reach = reach.max(
            (p.from_m - if p.recoils { w.recoil_m } else { 0.0 })
                .abs()
                .max(p.to_m.abs())
                .hypot(p.height_m.abs() + w.barrel_vertical_spacing.unwrap_or(0.0) / 2.0),
        );
    }
    let speed = dt.abs() * (w.trunnion_forward.abs() + reach + barrel_offset(w, 0).abs())
        + de.abs() * reach;
    let mut t = 0.0;
    for _ in 0..80 {
        if t >= 1.0 {
            break;
        }
        let distance = gun_clearance(m, train + t * dt, elevation + t * de);
        if distance <= 0.0 {
            return t;
        }
        // A 1 mm skin avoids becoming numerically stuck at a previous stop.
        // Inside the skin, each step is still bounded by actual separation.
        let near = distance <= 0.001001;
        let step = (1.0 - t).min(
            (if near {
                0.5 * distance
            } else {
                0.8 * (distance - 0.001)
            }) / speed,
        );
        if step < 1e-12 {
            return t;
        }
        if near
            && gun_clearance(m, train + (t + step) * dt, elevation + (t + step) * de)
                < distance - 1e-10
        {
            return t;
        }
        t += step;
    }
    t
}

/// Keep each snapshot interval a single swept-safe line in joint coordinates.
pub fn advance_gun_motion(
    m: &MountDefinition,
    train: f64,
    elevation: f64,
    next_train: f64,
    next_elevation: f64,
) -> (f64, f64, bool) {
    let fraction = clear_gun_motion(m, train, elevation, next_train, next_elevation);
    let dt = next_train - train;
    let de = next_elevation - elevation;
    let (mut x, mut y) = (dt * fraction, de * fraction);
    if fraction < 1.0 - 1e-9 && dt != 0.0 && de != 0.0 {
        for (a, b) in [(dt, 0.0), (0.0, de)] {
            let f = clear_gun_motion(m, train, elevation, train + a, elevation + b);
            if (a * f).hypot(b * f) > x.hypot(y) {
                x = a * f;
                y = b * f;
            }
        }
    }
    (
        train + x,
        elevation + y,
        (x - dt).abs() > 1e-9 || (y - de).abs() > 1e-9,
    )
}
