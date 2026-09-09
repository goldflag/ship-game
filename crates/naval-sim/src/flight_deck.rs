//! Validation of the shared authored deck geometry. Operating rules do not
//! manufacture additional parking locations or larger elevator platforms.
use crate::definition::{FlightDeckLayout, ShipDefinition, Vec3};
use std::collections::BTreeSet;

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AircraftDeckGeometry {
    pub version: u32,
    pub model_hash: String,
    /// Fitted hook stop above the nominal deck, baked from the published rig.
    pub hook_deck_fraction: f64,
    pub parked: Envelope,
    pub spread: Envelope,
    pub sweep: Envelope,
    pub support: Vec<Vec3>,
    /// Lower tyre triangles in unposed aircraft coordinates, baked from GLB.
    pub tyres: std::sync::Arc<Vec<Vec<[Vec3; 3]>>>,
    /// Quarter-metre height bands clipped from actual triangles. Broad overall
    /// bounds alone incorrectly block wings passing above low deck fittings.
    pub layers: Vec<Envelope>,
}

/// Bounds relative to the tyre datum, with landing gear down and the authored
/// ground pitch applied. These are baked from vertices, not guessed by role.
#[derive(Clone, Copy, Debug, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Envelope {
    pub min: Vec3,
    pub max: Vec3,
}
impl AircraftDeckGeometry {
    pub fn valid(&self) -> bool {
        self.version == 1
            && self.hook_deck_fraction.is_finite()
            && (0.0..=1.0).contains(&self.hook_deck_fraction)
            && !self.layers.is_empty()
            && self.layers.len() <= 200
            && self.layers.iter().all(|b| {
                (0..3).all(|i| {
                    b.min[i].is_finite()
                        && b.max[i].is_finite()
                        && b.min[i] <= b.max[i]
                        && b.min[i] >= self.parked.min[i] - 1e-6
                        && b.max[i] <= self.parked.max[i] + 1e-6
                })
            })
            && self.tyres.len() == 3
            && self.tyres.iter().all(|patches| {
                !patches.is_empty()
                    && patches.len() <= 500
                    && patches
                        .iter()
                        .flatten()
                        .all(|p| p.iter().all(|v| v.is_finite() && v.abs() <= 25.0))
            })
            && self.support.len() == 3
            && self.support.iter().all(|p| {
                p.iter().all(|v| v.is_finite())
                    && p[1].abs() < 0.1
                    && p[0].abs() < 25.0
                    && p[2].abs() < 25.0
            })
            && self.model_hash.len() == 64
            && self.model_hash.bytes().all(|b| b.is_ascii_hexdigit())
            && [self.parked, self.spread, self.sweep].iter().all(|b| {
                (0..3).all(|i| {
                    b.min[i].is_finite()
                        && b.max[i].is_finite()
                        && b.min[i] < b.max[i]
                        && b.max[i] - b.min[i] <= 50.0
                }) && b.min[1] >= -0.25
                    && b.min[1] < 0.25
            })
            && [self.parked, self.spread].iter().all(|b| {
                (0..3).all(|i| b.min[i] >= self.sweep.min[i] && b.max[i] <= self.sweep.max[i])
            })
    }
}

#[derive(Clone, Copy, Debug)]
pub struct DeckPose {
    pub position: Vec3,
    pub heading: f64,
}
impl Envelope {
    pub fn corners(self, pose: DeckPose, margin: f64) -> [[f64; 2]; 4] {
        let (s, c) = pose.heading.sin_cos();
        [
            [self.min[0] - margin, self.min[2] - margin],
            [self.max[0] + margin, self.min[2] - margin],
            [self.max[0] + margin, self.max[2] + margin],
            [self.min[0] - margin, self.max[2] + margin],
        ]
        .map(|[x, z]| {
            [
                pose.position[0] + c * x - s * z,
                pose.position[2] + s * x + c * z,
            ]
        })
    }
    pub fn overlaps(self, pose: DeckPose, other: Self, other_pose: DeckPose, margin: f64) -> bool {
        if pose.position[1] + self.max[1] < other_pose.position[1] + other.min[1]
            || other_pose.position[1] + other.max[1] < pose.position[1] + self.min[1]
        {
            return false;
        }
        let a = self.corners(pose, margin * 0.5);
        let b = other.corners(other_pose, margin * 0.5);
        // Separating axes from both rectangles, including intermediate headings.
        for shape in [&a, &b] {
            for i in 0..2 {
                let axis = [shape[i + 1][1] - shape[i][1], shape[i][0] - shape[i + 1][0]];
                let range = |points: &[[f64; 2]; 4]| {
                    points
                        .iter()
                        .map(|p| p[0] * axis[0] + p[1] * axis[1])
                        .fold((f64::INFINITY, f64::NEG_INFINITY), |(low, high), n| {
                            (low.min(n), high.max(n))
                        })
                };
                let (al, ah) = range(&a);
                let (bl, bh) = range(&b);
                if ah < bl || bh < al {
                    return false;
                }
            }
        }
        true
    }
    /// Sample translation and rotation with a small spatial bound. The matching
    /// safety margin covers the unsampled travel of any corner between samples.
    pub fn swept_overlap(
        self,
        from: DeckPose,
        to: DeckPose,
        other: Self,
        obstacle: DeckPose,
    ) -> bool {
        let turn = crate::geometry::wrap_angle(to.heading - from.heading);
        let radius = self.min[0]
            .abs()
            .max(self.max[0].abs())
            .hypot(self.min[2].abs().max(self.max[2].abs()));
        let travel = crate::geometry::length(crate::geometry::sub(to.position, from.position));
        let samples = ((travel + turn.abs() * radius) / 0.1).ceil().max(1.0) as usize;
        if !travel.is_finite() || !turn.is_finite() || samples > 10000 {
            return true;
        }
        (0..=samples).any(|i| {
            let t = i as f64 / samples as f64;
            let position = std::array::from_fn(|axis| {
                from.position[axis] + (to.position[axis] - from.position[axis]) * t
            });
            self.overlaps(
                DeckPose {
                    position,
                    heading: from.heading + turn * t,
                },
                other,
                obstacle,
                0.15,
            )
        })
    }
}

pub fn inside(polygon: &[[f64; 2]], x: f64, z: f64) -> bool {
    let mut result = false;
    if polygon.len() < 3 {
        return false;
    }
    let mut previous = polygon[polygon.len() - 1];
    for &point in polygon {
        if (point[1] > z) != (previous[1] > z)
            && x < (previous[0] - point[0]) * (z - point[1]) / (previous[1] - point[1]) + point[0]
        {
            result = !result;
        }
        previous = point;
    }
    result
}
pub fn validate(definition: &ShipDefinition, layout: &FlightDeckLayout) -> Result<(), String> {
    let structures = definition.structures.as_deref().unwrap_or_default();
    let surface = structures
        .iter()
        .find(|s| s.id == layout.surface_id)
        .ok_or("Missing flight-deck surface")?;
    let on_deck = |p: Vec3| {
        p.iter().all(|v| v.is_finite())
            && inside(&surface.footprint, p[0], p[2])
            && (p[1] - surface.base_y - surface.height).abs() <= 0.5
    };
    if layout.version != 1.0
        || layout.spots.is_empty()
        || layout.spots.len() > 100
        || layout.elevators.is_empty()
        || layout.elevators.len() > 8
        || ![
            layout.launch_start,
            layout.launch_end,
            layout.recovery_touchdown,
            layout.recovery_stop,
        ]
        .into_iter()
        .all(on_deck)
        || layout.launch_end[2] >= layout.launch_start[2] - 30.0
        || layout.recovery_stop[2] >= layout.recovery_touchdown[2] - 10.0
    {
        return Err("Invalid flight-deck geometry".into());
    }
    let mut ids = BTreeSet::new();
    for spot in &layout.spots {
        if spot.id.is_empty()
            || !ids.insert(&spot.id)
            || !on_deck(spot.position)
            || !matches!(
                spot.preferred_role.as_str(),
                "fighter" | "dive-bomber" | "torpedo-bomber"
            )
        {
            return Err("Invalid flight-deck parking position".into());
        }
    }
    ids.clear();
    for elevator in &layout.elevators {
        let platform = structures
            .iter()
            .find(|s| s.id == elevator.id)
            .ok_or("Missing fitted elevator")?;
        if !ids.insert(&elevator.id)
            || !on_deck(elevator.position)
            || !elevator.hangar_y.is_finite()
            || !(0.0..=elevator.position[1] - 2.0).contains(&elevator.hangar_y)
            || ![elevator.width_m, elevator.length_m]
                .into_iter()
                .all(|n| n.is_finite() && (3.0..=30.0).contains(&n))
        {
            return Err("Invalid elevator geometry".into());
        }
        for (axis, size) in [(0, elevator.width_m), (1, elevator.length_m)] {
            let min = platform
                .footprint
                .iter()
                .map(|p| p[axis])
                .fold(f64::INFINITY, f64::min);
            let max = platform
                .footprint
                .iter()
                .map(|p| p[axis])
                .fold(f64::NEG_INFINITY, f64::max);
            if size > max - min + 0.001 {
                return Err("Elevator capacity exceeds its fitted platform".into());
            }
        }
    }
    Ok(())
}
