use crate::{
    damage::{Breach, CompartmentState},
    definition::Vec3,
    geometry::*,
};
use std::f64::consts::PI;
fn axes(normal: Vec3) -> (Vec3, Vec3) {
    let u = normalize(cross(
        if normal[1].abs() < 0.9 {
            [0.0, 1.0, 0.0]
        } else {
            [0.0, 0.0, 1.0]
        },
        normal,
    ));
    (u, cross(normal, u))
}
/// Bounded aperture union, matching the authored simulation's 128 deterministic samples.
pub fn add_breach(
    state: &mut CompartmentState,
    position: Vec3,
    area: f64,
    shell_id: i64,
    radius: Option<f64>,
    normal: Option<Vec3>,
    incremental: bool,
) -> f64 {
    let radius = radius.unwrap_or_else(|| (area / PI).sqrt());
    if area <= 0.0 || radius <= 0.0 || !area.is_finite() || !radius.is_finite() {
        return 0.0;
    }
    let normal =
        normalize(normal.unwrap_or([if position[0] < 0.0 { -1.0 } else { 1.0 }, 0.0, 0.0]));
    let (u, v) = axes(normal);
    let width = area / (PI * radius);
    let candidates: Vec<_> = state
        .breaches
        .iter()
        .filter(|b| {
            !incremental
                && dot(normal, b.normal.unwrap_or(normal)).abs() > 0.95
                && dot(sub(position, b.position), normal).abs() < 0.05
                && length(sub(position, b.position))
                    < width.max(radius)
                        + b.radius_m
                            .max(b.footprint_area_m2.unwrap_or(b.area_m2) / (PI * b.radius_m))
        })
        .collect();
    let mut uncovered = 128;
    if !candidates.is_empty() {
        uncovered = 0;
        for ring in 0..8 {
            for sector in 0..16 {
                let r = ((ring as f64 + 0.5) / 8.0).sqrt();
                let angle = (sector as f64 + 0.5) * PI / 8.0;
                let point = std::array::from_fn(|i| {
                    position[i] + u[i] * width * r * angle.cos() + v[i] * radius * r * angle.sin()
                });
                let covered = candidates.iter().any(|b| {
                    let (bu, bv) = axes(b.normal.unwrap_or(normal));
                    let delta = sub(point, b.position);
                    let fraction = b.area_m2 / b.initial_area_m2.unwrap_or(b.area_m2);
                    let bw = b.footprint_area_m2.unwrap_or(b.area_m2) / (PI * b.radius_m);
                    (dot(delta, bu) / bw).powi(2) + (dot(delta, bv) / b.radius_m).powi(2)
                        <= fraction + 1e-9
                });
                if !covered {
                    uncovered += 1;
                }
            }
        }
    }
    let added = (area * uncovered as f64 / 128.0)
        .min(4.0 - state.breach_area_m2)
        .max(0.0);
    if added <= 0.0 {
        return 0.0;
    }
    let closest = state
        .breaches
        .iter()
        .enumerate()
        .min_by(|(_, a), (_, b)| {
            length(sub(a.position, position)).total_cmp(&length(sub(b.position, position)))
        })
        .map(|(i, _)| i);
    if let Some(i) = closest
        && ((incremental && length(sub(state.breaches[i].position, position)) < 0.1)
            || state.breaches.len() >= 64)
    {
        let b = &mut state.breaches[i];
        let total = b.area_m2 + added;
        b.position =
            std::array::from_fn(|i| (b.position[i] * b.area_m2 + position[i] * added) / total);
        b.footprint_area_m2 = Some(b.footprint_area_m2.unwrap_or(b.area_m2) + added);
        b.area_m2 = total;
        b.initial_area_m2 = Some(total);
        b.radius_m = b.radius_m.max(radius);
    } else {
        state.breaches.push(Breach {
            position,
            area_m2: added,
            radius_m: radius,
            shell_id,
            footprint_area_m2: Some(area),
            initial_area_m2: Some(added),
            normal: Some(normal),
        });
    }
    state.breach_area_m2 += added;
    added
}
