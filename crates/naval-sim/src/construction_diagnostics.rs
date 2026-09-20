//! Measurements attached to failed fit checks. Failure path only: a fitting that
//! passes never reaches these searches, so valid compiles pay nothing for them.
use crate::{construction_geometry as cg, definition::*, geometry::*};

/// Where a failed attachment datum would find support.
pub(crate) struct Seat {
    /// Owning hull primitive; structural cells carry no source identity.
    pub support_id: Option<String>,
    /// Signed along the socket direction: positive floats clear, negative is buried.
    pub gap_m: f64,
    /// Equipment position that brings the datum onto the support.
    pub position: Vec3,
}

/// Source values read back to 0.1 mm.
pub(crate) fn rounded(x: f64) -> f64 {
    let r = (x * 1e4).round() / 1e4;
    if r == 0. { 0. } else { r }
}

/// Nearest closed skin patch under the socket line; failing that, the nearest one in
/// any direction. `facing` keeps only patches that oppose the socket direction.
/// `reach` is the fitting's footprint radius: its own installation well leaves a
/// hole in the deck exactly under the datum, so the line may miss the patch by that much.
pub(crate) fn seat_on_surfaces(
    surfaces: &[ConstructionSurface],
    position: Vec3,
    attachment: Vec3,
    direction: Vec3,
    facing: bool,
    reach: f64,
) -> Option<Seat> {
    let usable = |s: &&ConstructionSurface| {
        !s.open && s.vertices.len() >= 3 && (!facing || dot(s.normal, direction) <= -0.5)
    };
    let on_line = surfaces
        .iter()
        .filter(usable)
        .filter_map(|s| {
            let along = dot(direction, s.normal);
            if along.abs() < 1e-6 {
                return None;
            }
            let t = dot(sub(s.vertices[0], attachment), s.normal) / along;
            let hit = add(attachment, scale(direction, t));
            let (center, size) = crate::structure::bounds(s.vertices.iter().copied());
            if (0..3).any(|i| (hit[i] - center[i]).abs() > size[i] / 2. + reach + 1e-3) {
                return None;
            }
            let patch = cg::prism(&s.vertices, 0.001);
            let miss = length(sub(cg::closest_point(&patch, hit), hit));
            (miss <= reach + 1e-3).then_some((t, miss, s))
        })
        // The patch most nearly under the datum wins; camber makes farther ones lower.
        .min_by(|a, b| {
            (a.1 * 1e3)
                .round()
                .total_cmp(&(b.1 * 1e3).round())
                .then_with(|| a.0.abs().total_cmp(&b.0.abs()))
        });
    if let Some((t, _, s)) = on_line {
        return Some(Seat {
            support_id: Some(s.primitive_id.clone()),
            gap_m: rounded(t),
            position: add(position, scale(direction, t)).map(rounded),
        });
    }
    surfaces
        .iter()
        .filter(usable)
        .map(|s| {
            let nearest = cg::closest_point(&cg::prism(&s.vertices, 0.001), attachment);
            (length(sub(nearest, attachment)), nearest, s)
        })
        .min_by(|a, b| a.0.total_cmp(&b.0))
        .map(|(distance, nearest, s)| Seat {
            support_id: Some(s.primitive_id.clone()),
            gap_m: rounded(distance),
            position: add(position, sub(nearest, attachment)).map(rounded),
        })
}

/// Nearest structural material for an internal package.
pub(crate) fn seat_on_cells(cells: &[cg::Cell], position: Vec3, attachment: Vec3) -> Option<Seat> {
    cells
        .iter()
        .map(|cell| {
            let nearest = cg::closest_point(cell, attachment);
            (length(sub(nearest, attachment)), nearest)
        })
        .min_by(|a, b| a.0.total_cmp(&b.0))
        .map(|(distance, nearest)| Seat {
            support_id: None,
            gap_m: rounded(distance),
            position: add(position, sub(nearest, attachment)).map(rounded),
        })
}

impl Seat {
    /// Folds the measurement into the diagnostic and its message.
    pub(crate) fn describe(
        self,
        mut d: ConstructionDiagnostic,
        tolerance: f64,
    ) -> ConstructionDiagnostic {
        let support = self
            .support_id
            .as_deref()
            .map_or("the nearest structure".to_owned(), |id| {
                format!("hull piece {id}")
            });
        let state = if self.gap_m < 0. {
            format!("is buried {:.3} m in", -self.gap_m)
        } else {
            format!("is {:.3} m clear of", self.gap_m)
        };
        d.message = format!(
            "{}. Its attachment datum {state} {support} (tolerance {tolerance:.3} m); position [{}, {}, {}] seats it",
            d.message.trim_end_matches('.'),
            self.position[0],
            self.position[1],
            self.position[2]
        );
        let fit = d.fit.get_or_insert_default();
        fit.nearest_support_id = self.support_id;
        fit.gap_m = Some(self.gap_m);
        fit.tolerance_m = Some(tolerance);
        fit.seat_position = Some(self.position);
        d
    }
}

/// Names the other instance and the shallowest extent of the shared volume.
pub(crate) fn overlap(
    mut d: ConstructionDiagnostic,
    other: &str,
    shared: Option<&cg::Cell>,
) -> ConstructionDiagnostic {
    d.related_source_ids = Some([other.to_owned()].into());
    if let Some(shared) = shared {
        let (center, size) = cg::bounds(shared);
        let depth = rounded(size.iter().copied().fold(f64::INFINITY, f64::min));
        d.fit.get_or_insert_default().penetration_m = Some(depth);
        d.message = format!(
            "{}. The overlap with {other} is {depth:.3} m deep near [{:.3}, {:.3}, {:.3}]",
            d.message, center[0], center[1], center[2]
        );
    } else {
        d.message = format!("{}. The other instance is {other}", d.message);
    }
    d
}
