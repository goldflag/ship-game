//! Validate a smaller battle-only displacement model against the authored hull.
use super::*;
use crate::{construction_geometry as cg, geometry::length};
mod hull;

const MAX_VOLUME_ERROR: f64 = 0.001;
const MAX_CENTER_ERROR_M: f64 = 0.05;

pub(super) fn compact(hull: &Hull, exact: &HullHydrostatics) -> Option<HullHydrostatics> {
    let cells = &hull.volume.as_ref()?.cells;
    if hull.buoyancy.is_some() || cells.len() <= 64 {
        return None;
    }
    let full = exact.full_volume();
    if !full.is_finite() || full <= 0. {
        return None;
    }
    // Validate throughout immersion and through large heel/trim, including
    // inversion. These are sampled acceptance limits, not a universal bound.
    let mut samples = vec![];
    for roll in [-180., -120., -60., -30., 0., 30., 60., 120.] {
        for pitch in [-20., 0., 20.] {
            let (roll, pitch) = (f64::to_radians(roll), f64::to_radians(pitch));
            let n = [
                roll.sin() * pitch.cos(),
                roll.cos() * pitch.cos(),
                -pitch.sin(),
            ];
            let (lo, hi) = cells
                .iter()
                .flat_map(|c| c.faces.iter())
                .flat_map(|f| &f.vertices)
                .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), &p| {
                    let y = crate::geometry::dot(n, p);
                    (lo.min(y), hi.max(y))
                });
            for fraction in [0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99] {
                let y = -(lo + (hi - lo) * fraction);
                samples.push((y, roll, pitch, exact.sample(y, roll, pitch)));
            }
        }
    }
    let compact = hull::compact(cells);
    if compact.len() >= cells.len() {
        return None;
    }
    let mut candidate = exact.clone();
    candidate.cells = Some(
        compact
            .into_iter()
            .map(|(shape, full)| {
                let measured = cg::moments(&shape).volume;
                // An unchanged zero-volume clipping remnant keeps the source
                // density; it must not introduce 0/0 into a partial sample.
                let density = if measured == 0. {
                    1.
                } else {
                    full.volume / measured
                };
                let vertices = shape
                    .faces
                    .iter()
                    .flat_map(|f| f.vertices.iter().copied())
                    .collect();
                PolyCell {
                    displacement: CellDisplacement::new(&shape, full.volume),
                    shape,
                    full,
                    vertices,
                    density,
                }
            })
            .collect(),
    );
    let valid = samples.iter().all(|&(y, roll, pitch, before)| {
        let after = candidate.sample(y, roll, pitch);
        (after.volume - before.volume).abs() <= full * MAX_VOLUME_ERROR
            && (before.volume < full * 0.01
                || length(crate::geometry::sub(after.center, before.center)) <= MAX_CENTER_ERROR_M)
    });
    valid.then_some(candidate)
}
