//! Installation motion envelopes shared with the TypeScript port preview.
//! These are explicit game interlocks; renderer meshes never enter the CPU kernel.
use crate::{
    definition::{
        AuthoredStructure, MountClearanceProfileMountsItem as Entry, MountDefinition,
        ShipDefinition, Vec3,
    },
    geometry::*,
    mount_clearance::{ClearanceMode, clearance_mode},
    weapons::{MountState, barrel_height, barrel_offset},
};
use std::collections::HashSet;

pub(crate) fn validate_profile(d: &ShipDefinition) -> Result<(), String> {
    let profile = d
        .mount_clearance
        .as_ref()
        .ok_or("Missing clearance profile")?;
    if clearance_mode(profile)? != ClearanceMode::Installation {
        return Err("Expected installation clearance encoding".into());
    }
    let entries = profile
        .mounts
        .as_deref()
        .expect("validated installation encoding");
    let structures = profile
        .structures
        .as_deref()
        .expect("validated installation encoding");
    let neighbors = profile
        .neighbors
        .as_deref()
        .expect("validated installation encoding");
    if entries.is_empty() || entries.len() > 128 || structures.len() > 128 || neighbors.len() > 128
    {
        return Err("Invalid installation clearance entry count".into());
    }
    let mut selected = HashSet::new();
    for entry in entries {
        let Some(mount) = d.mounts.iter().find(|m| m.id == entry.mount_id) else {
            return Err("Unknown installation clearance mount".into());
        };
        if mount.parent_mount_id.is_some()
            || !selected.insert(entry.mount_id.as_str())
            || !entry.barrel_radius_m.is_finite()
            || !(0.01..=2.0).contains(&entry.barrel_radius_m)
        {
            return Err("Invalid installation clearance mount".into());
        }
        if let Some(body) = &entry.body
            && (body.center.iter().any(|v| !v.is_finite())
                || body
                    .size
                    .iter()
                    .any(|v| !v.is_finite() || !(0.01..=30.0).contains(v)))
        {
            return Err("Invalid installation clearance body".into());
        }
    }
    let mut seen_structures = HashSet::new();
    for entry in structures {
        if !d
            .structures
            .as_deref()
            .unwrap_or_default()
            .iter()
            .any(|s| s.id == entry.structure_id)
            || !seen_structures.insert(entry.structure_id.as_str())
            || !entry.top_extension_m.is_finite()
            || !(0.0..=5.0).contains(&entry.top_extension_m)
        {
            return Err("Invalid installation clearance structure".into());
        }
    }
    let mut pairs = HashSet::new();
    for pair in neighbors {
        let mut key = [pair[0].as_str(), pair[1].as_str()];
        key.sort_unstable();
        if key[0] == key[1] || !key.iter().all(|id| selected.contains(id)) || !pairs.insert(key) {
            return Err("Invalid installation clearance neighbor pair".into());
        }
    }
    Ok(())
}
#[derive(Clone, Copy)]
struct Capsule {
    a: Vec3,
    b: Vec3,
    radius: f64,
}
type Angles = (f64, f64);
fn norm2(a: Vec3) -> f64 {
    dot(a, a)
}
fn segments(a: Vec3, b: Vec3, c: Vec3, d: Vec3) -> f64 {
    let (u, v, w) = (sub(b, a), sub(d, c), sub(a, c));
    let (aa, bb, cc, dd, ee) = (dot(u, u), dot(u, v), dot(v, v), dot(u, w), dot(v, w));
    let mut s = if aa > 1e-12 {
        clamp(-dd / aa, 0.0, 1.0)
    } else {
        0.0
    };
    let mut t = 0.0;
    if cc > 1e-12 {
        let den = aa * cc - bb * bb;
        if den > 1e-12 {
            s = clamp((bb * ee - cc * dd) / den, 0.0, 1.0)
        }
        t = (bb * s + ee) / cc;
        if t < 0.0 {
            t = 0.0;
            s = if aa > 1e-12 {
                clamp(-dd / aa, 0.0, 1.0)
            } else {
                0.0
            }
        } else if t > 1.0 {
            t = 1.0;
            s = if aa > 1e-12 {
                clamp((bb - dd) / aa, 0.0, 1.0)
            } else {
                0.0
            }
        }
    }
    norm2(sub(add(a, scale(u, s)), add(c, scale(v, t))))
}
fn in_triangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3) -> bool {
    let (u, v, w) = (sub(b, a), sub(c, a), sub(p, a));
    let (uu, uv, vv, wu, wv) = (dot(u, u), dot(u, v), dot(v, v), dot(w, u), dot(w, v));
    let den = uu * vv - uv * uv;
    if den < 1e-15 {
        return false;
    }
    let (s, t) = ((vv * wu - uv * wv) / den, (uu * wv - uv * wu) / den);
    s >= -1e-10 && t >= -1e-10 && s + t <= 1.0 + 1e-10
}
fn point_triangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3) -> f64 {
    let n = cross(sub(b, a), sub(c, a));
    let (nn, h) = (norm2(n), dot(sub(p, a), n));
    if nn > 1e-15 && in_triangle(sub(p, scale(n, h / nn)), a, b, c) {
        return h * h / nn;
    }
    segments(p, p, a, b)
        .min(segments(p, p, b, c))
        .min(segments(p, p, c, a))
}
fn capsule_triangle(cap: Capsule, a: Vec3, b: Vec3, c: Vec3) -> bool {
    let n = cross(sub(b, a), sub(c, a));
    let delta = sub(cap.b, cap.a);
    let den = dot(n, delta);
    if den.abs() > 1e-12 {
        let t = dot(n, sub(a, cap.a)) / den;
        if (0.0..=1.0).contains(&t) && in_triangle(add(cap.a, scale(delta, t)), a, b, c) {
            return true;
        }
    }
    point_triangle(cap.a, a, b, c)
        .min(point_triangle(cap.b, a, b, c))
        .min(segments(cap.a, cap.b, a, b))
        .min(segments(cap.a, cap.b, b, c))
        .min(segments(cap.a, cap.b, c, a))
        <= cap.radius * cap.radius
}
fn inside(x: f64, z: f64, poly: &[[f64; 2]]) -> bool {
    let mut yes = false;
    let mut j = poly.len() - 1;
    for i in 0..poly.len() {
        let (a, b) = (poly[i], poly[j]);
        if (a[1] > z) != (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0] {
            yes = !yes
        }
        j = i;
    }
    yes
}
fn capsule_prism(c: Capsule, s: &AuthoredStructure, extension: f64) -> bool {
    let (low, high) = (s.base_y, s.base_y + s.height + extension);
    let poly = &s.footprint;
    let mut min = [f64::INFINITY, low, f64::INFINITY];
    let mut max = [f64::NEG_INFINITY, high, f64::NEG_INFINITY];
    for p in poly {
        min[0] = min[0].min(p[0]);
        max[0] = max[0].max(p[0]);
        min[2] = min[2].min(p[1]);
        max[2] = max[2].max(p[1]);
    }
    let center = std::array::from_fn(|i| (min[i] + max[i]) / 2.0);
    let size = std::array::from_fn(|i| max[i] - min[i] + 2.0 * c.radius);
    if segment_box(c.a, c.b, center, size).is_none() {
        return false;
    }
    for p in [c.a, c.b] {
        if inside(p[0], p[2], poly) && p[1] >= low - c.radius && p[1] <= high + c.radius {
            return true;
        }
    }
    for y in [low, high] {
        let t = (y - c.a[1]) / (c.b[1] - c.a[1]);
        if (0.0..=1.0).contains(&t)
            && inside(
                c.a[0] + t * (c.b[0] - c.a[0]),
                c.a[2] + t * (c.b[2] - c.a[2]),
                poly,
            )
        {
            return true;
        }
    }
    for i in 0..poly.len() {
        let ([x, z], [xx, zz]) = (poly[i], poly[(i + 1) % poly.len()]);
        let (a, b, c0, d) = ([x, low, z], [xx, low, zz], [xx, high, zz], [x, high, z]);
        if capsule_triangle(c, a, b, c0) || capsule_triangle(c, a, c0, d) {
            return true;
        }
    }
    false
}
fn frame(m: &MountDefinition, p: Angles) -> Pose {
    Pose {
        x: m.position[0],
        y: m.position[1],
        z: m.position[2],
        heading: radians(m.bearing_deg) + p.0,
        pitch: 0.0,
        roll: 0.0,
    }
}
fn barrels(m: &MountDefinition, p: Angles, e: &Entry, margin: f64) -> Vec<Capsule> {
    let w = &m.weapon;
    let f = frame(m, p);
    let (cs, sn) = (p.1.cos(), p.1.sin());
    let point = |forward: f64, i: usize| {
        let row = barrel_height(w, i);
        let travel = forward - w.trunnion_forward;
        local_to_world(
            [
                barrel_offset(w, i),
                w.pivot_height + travel * sn + row * cs,
                -w.trunnion_forward - travel * cs + row * sn,
            ],
            f,
        )
    };
    (0..w.barrel_count.unwrap_or(2.0) as usize)
        .map(|i| Capsule {
            a: point(w.trunnion_forward - 0.65 - w.recoil_m, i),
            b: point(w.muzzle_forward + 0.05, i),
            radius: e.barrel_radius_m + margin,
        })
        .collect()
}
fn capsule_body(c: Capsule, m: &MountDefinition, p: Angles, e: &Entry, margin: f64) -> bool {
    let Some(body) = &e.body else { return false };
    let f = frame(m, p);
    segment_box(
        world_to_local(c.a, f),
        world_to_local(c.b, f),
        body.center,
        body.size.map(|s| s + 2.0 * (c.radius + margin)),
    )
    .is_some()
}
fn bodies(
    a: &MountDefinition,
    ap: Angles,
    ae: &Entry,
    b: &MountDefinition,
    bp: Angles,
    be: &Entry,
    margin: f64,
) -> bool {
    let (Some(ab), Some(bb)) = (&ae.body, &be.body) else {
        return false;
    };
    let (af, bf) = (frame(a, ap), frame(b, bp));
    let (ac, bc) = (local_to_world(ab.center, af), local_to_world(bb.center, bf));
    if (ac[1] - bc[1]).abs() > (ab.size[1] + bb.size[1]) / 2.0 + margin {
        return false;
    }
    let axis = |h: f64| [[h.cos(), h.sin()], [-h.sin(), h.cos()]];
    let (aa, ba) = (axis(af.heading), axis(bf.heading));
    let delta = [bc[0] - ac[0], bc[2] - ac[2]];
    aa.iter().chain(ba.iter()).all(|n| {
        let projection = |axes: [[f64; 2]; 2], size: Vec3| {
            (n[0] * axes[0][0] + n[1] * axes[0][1]).abs() * size[0] / 2.0
                + (n[0] * axes[1][0] + n[1] * axes[1][1]).abs() * size[2] / 2.0
        };
        (n[0] * delta[0] + n[1] * delta[1]).abs()
            <= projection(aa, ab.size) + projection(ba, bb.size) + margin
    })
}
fn pose_clear(
    d: &ShipDefinition,
    index: usize,
    pose: Angles,
    states: &[MountState],
    extra_margin: f64,
) -> bool {
    let Some(profile) = &d.mount_clearance else {
        return true;
    };
    let m = &d.mounts[index];
    let entries = profile
        .mounts
        .as_deref()
        .expect("validated installation encoding");
    let Some(entry) = entries.iter().find(|e| e.mount_id == m.id) else {
        return true;
    };
    let margin = profile.margin_m + extra_margin;
    let own = barrels(m, pose, entry, margin);
    if own.iter().any(|c| {
        profile
            .structures
            .as_deref()
            .unwrap_or_default()
            .iter()
            .any(|p| {
                capsule_prism(
                    *c,
                    d.structures
                        .as_ref()
                        .unwrap()
                        .iter()
                        .find(|s| s.id == p.structure_id)
                        .unwrap(),
                    p.top_extension_m,
                )
            })
    }) {
        return false;
    }
    for pair in profile.neighbors.as_deref().unwrap_or_default() {
        let id = if pair[0] == m.id {
            &pair[1]
        } else if pair[1] == m.id {
            &pair[0]
        } else {
            continue;
        };
        let j = d.mounts.iter().position(|m| &m.id == id).unwrap();
        let other = &d.mounts[j];
        let op = states
            .get(j)
            .map_or((0.0, radians(1.0)), |s| (s.train, s.elevation));
        let oe = entries.iter().find(|e| &e.mount_id == id).unwrap();
        let their = barrels(other, op, oe, margin);
        if own.iter().any(|a| {
            their
                .iter()
                .any(|b| segments(a.a, a.b, b.a, b.b) <= (a.radius + b.radius).powi(2))
                || capsule_body(*a, other, op, oe, margin)
        }) || their
            .iter()
            .any(|c| capsule_body(*c, m, pose, entry, margin))
            || bodies(m, pose, entry, other, op, oe, margin)
        {
            return false;
        }
    }
    true
}

/// Inspect one installation pose; swept-body profiles use `MountClearance`.
pub fn mount_pose_clear(
    d: &ShipDefinition,
    index: usize,
    pose: Angles,
    states: &[MountState],
    extra_margin: f64,
) -> bool {
    let Some(profile) = &d.mount_clearance else {
        return true;
    };
    match clearance_mode(profile) {
        Ok(ClearanceMode::SweptBodies) => true,
        Ok(ClearanceMode::Installation) => {
            index < d.mounts.len()
                && pose.0.is_finite()
                && pose.1.is_finite()
                && extra_margin.is_finite()
                && extra_margin >= 0.0
                && validate_profile(d).is_ok()
                && pose_clear(d, index, pose, states, extra_margin)
        }
        Err(_) => false,
    }
}
/// Subdivide rotation and enclose the intervening arc, including large preview/test steps.
pub fn move_mount_with_clearance(
    d: &ShipDefinition,
    index: usize,
    s: &mut MountState,
    target: Angles,
    states: &[MountState],
) -> bool {
    let installation = match d.mount_clearance.as_ref().map(clearance_mode).transpose() {
        Ok(Some(ClearanceMode::Installation)) => true,
        Ok(_) => false,
        Err(_) => return false,
    };
    if installation
        && (index >= d.mounts.len()
            || !target.0.is_finite()
            || !target.1.is_finite()
            || validate_profile(d).is_err())
    {
        return false;
    }
    if !installation
        || !d
            .mount_clearance
            .as_ref()
            .unwrap()
            .mounts
            .as_deref()
            .unwrap()
            .iter()
            .any(|e| e.mount_id == d.mounts[index].id)
    {
        s.train = target.0;
        s.elevation = target.1;
        return true;
    }
    let w = &d.mounts[index].weapon;
    let (train, elevation) = (target.0 - s.train, target.1 - s.elevation);
    // Roundoff at exact quarter-degree boundaries must not add a subdivision:
    // that changes the padding and can strand the following escape motion.
    // Padding below still encloses the actual angle of every accepted step.
    let steps = (train.abs().max(elevation.abs()) / radians(0.25) - 1e-9)
        .ceil()
        .max(1.0) as usize;
    let start = (s.train, s.elevation);
    let reach = w
        .gunhouse_size
        .iter()
        .fold(w.muzzle_forward.abs() + w.recoil_m + 1.0, |a, b| a.max(*b));
    let margin = reach * (train.abs() + elevation.abs()) / steps as f64;
    for i in 1..=steps {
        let next = (
            start.0 + train * i as f64 / steps as f64,
            start.1 + elevation * i as f64 / steps as f64,
        );
        if !pose_clear(d, index, next, states, margin) {
            return false;
        }
        s.train = next.0;
        s.elevation = next.1;
    }
    true
}
