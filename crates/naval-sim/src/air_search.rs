//! Bounded, deterministic search geometry; no world or target access.
use crate::{
    aircraft::{SearchAltitude, SearchProgress},
    definition::Vec3,
    geometry::{length, sub},
};

pub fn valid_area(center: [f64; 2], radius_m: f64) -> bool {
    center.iter().all(|n| n.is_finite() && n.abs() <= 40000.0)
        && radius_m.is_finite()
        && (1000.0..=6000.0).contains(&radius_m)
}
/// Chords leave turning room inside the selected area. Higher searches use
/// wider spacing; actual acquisition still depends on weather and line of sight.
pub fn sweep(
    center: [f64; 2],
    radius_m: f64,
    altitude: SearchAltitude,
    start: Vec3,
) -> SearchProgress {
    let spacing = match altitude {
        SearchAltitude::Low => 1000.0,
        SearchAltitude::Medium => 1800.0,
        SearchAltitude::High => 2400.0,
    };
    let rows = ((1.5 * radius_m / spacing).ceil() as usize).clamp(3, 10);
    let mut route = Vec::with_capacity(rows * 2);
    for row in 0..rows {
        let across = radius_m * (-0.75 + 1.5 * row as f64 / (rows - 1) as f64);
        let along = (radius_m.powi(2) - across.powi(2)).sqrt() * 0.82;
        let direction = if row.is_multiple_of(2) { 1.0 } else { -1.0 };
        for side in [-direction, direction] {
            route.push([
                center[0] + across,
                altitude.metres(),
                center[1] + side * along,
            ]);
        }
    }
    if length(sub(start, *route.last().unwrap())) < length(sub(start, route[0])) {
        route.reverse();
    }
    let distance = length(sub(start, route[0]))
        + route
            .windows(2)
            .map(|p| length(sub(p[0], p[1])))
            .sum::<f64>();
    SearchProgress {
        entry_position: start,
        route,
        waypoint: 0,
        elapsed_seconds: 0.0,
        deadline_seconds: distance / 65.0 + 180.0,
        shadow_seconds: 0.0,
        trail: Vec::new(),
    }
}
