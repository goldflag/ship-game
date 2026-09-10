//! Three-contact resting poses from the authored flight-deck and flush platforms.
//! Geometry is compiled once; the simulation never queries renderer meshes.
use crate::{
    aircraft_deck::GroundPose,
    definition::{AuthoredStructure, ShipDefinition, Vec3},
    flight_deck::DeckPose,
    geometry::{Pose, add, cross, dot, rotate, scale, sub},
};
use std::collections::BTreeMap;

const CELL: f64 = 8.0;
// Admission budgets bound both cache construction and an individual height query.
// Current carrier surfaces use fewer than 1,300 triangles within 150 metres.
const MAX_COORDINATE_M: f64 = 10_000.0;
const MAX_SURFACE_VERTICES: usize = 65_536;
const MAX_INPUT_TRIANGLES: usize = 16_384;
const MAX_TRIANGLE_CELLS: usize = 4_096;
const MAX_CELL_REFERENCES: usize = 262_144;
const MAX_TRIANGLES_PER_CELL: usize = 4_096;
const MAX_QUERY_CELLS: usize = 65_536;
const MAX_QUERY_CANDIDATES: usize = 262_144;
fn valid_coordinate(value: f64) -> bool {
    value.is_finite() && value.abs() <= MAX_COORDINATE_M
}
#[derive(Clone, Debug)]
struct Triangle {
    points: [Vec3; 3],
    denominator: f64,
}
#[derive(Clone, Debug, Default)]
pub struct DeckSurface {
    triangles: Vec<Triangle>,
    cells: BTreeMap<(i32, i32), Vec<usize>>,
    input_triangles: usize,
    cell_references: usize,
}
#[derive(Clone, Copy, Debug)]
pub struct ContactPose {
    pub root: Vec3,
    pub attitude: Pose,
}
impl DeckSurface {
    pub fn new(ship: &ShipDefinition) -> Option<Self> {
        let layout = ship.air_wing.as_ref()?.deck_layout.as_ref()?;
        let structures = ship.structures.as_ref()?;
        let deck = structures.iter().find(|s| s.id == layout.surface_id)?;
        let mut result = Self::default();
        for s in structures
            .iter()
            .filter(|s| s.id == deck.id || s.material == "elevator")
        {
            result.structure(s)?;
        }
        (!result.triangles.is_empty()).then_some(result)
    }
    fn structure(&mut self, structure: &AuthoredStructure) -> Option<()> {
        let before = self.triangles.len();
        if let Some(surface) = &structure.surface {
            if surface.vertices.len() < 3
                || surface.vertices.len() > MAX_SURFACE_VERTICES
                || surface
                    .vertices
                    .iter()
                    .flatten()
                    .any(|&v| !valid_coordinate(v))
                || surface.triangles.is_empty()
                || surface.triangles.len() > MAX_INPUT_TRIANGLES - self.input_triangles
            {
                return None;
            }
            for indices in &surface.triangles {
                if indices.iter().any(|&i| {
                    !i.is_finite()
                        || i.fract() != 0.0
                        || i < 0.0
                        || i >= surface.vertices.len() as f64
                }) {
                    return None;
                }
                self.triangle(indices.map(|i| surface.vertices[i as usize]))?;
            }
        } else {
            // Plain authored slabs have a horizontal upper cap. A fan is valid
            // for the convex elevator footprints accepted by the ship pipeline.
            if structure.footprint.len() < 3
                || structure.footprint.len() - 2 > MAX_INPUT_TRIANGLES - self.input_triangles
                || structure
                    .footprint
                    .iter()
                    .flatten()
                    .any(|&v| !valid_coordinate(v))
                || !valid_coordinate(structure.base_y)
                || !valid_coordinate(structure.height)
                || !valid_coordinate(structure.base_y + structure.height)
            {
                return None;
            }
            for pair in structure.footprint[1..].windows(2) {
                let points = [structure.footprint[0], pair[0], pair[1]];
                self.triangle(points.map(|p| [p[0], structure.base_y + structure.height, p[1]]))?;
            }
        }
        (self.triangles.len() > before).then_some(())
    }
    fn triangle(&mut self, points: [Vec3; 3]) -> Option<()> {
        // Count vertical/degenerate authored triangles too, so repeated unusable
        // input cannot bypass the construction-work budget.
        if self.input_triangles >= MAX_INPUT_TRIANGLES {
            return None;
        }
        self.input_triangles += 1;
        let [a, b, c] = points;
        let denominator = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
        if denominator.abs() < 1e-9 {
            return Some(());
        }
        let min_x = (a[0].min(b[0]).min(c[0]) / CELL).floor() as i32;
        let max_x = (a[0].max(b[0]).max(c[0]) / CELL).floor() as i32;
        let min_z = (a[2].min(b[2]).min(c[2]) / CELL).floor() as i32;
        let max_z = (a[2].max(b[2]).max(c[2]) / CELL).floor() as i32;
        let cells = (max_x - min_x + 1) as usize * (max_z - min_z + 1) as usize;
        if cells > MAX_TRIANGLE_CELLS || cells > MAX_CELL_REFERENCES - self.cell_references {
            return None;
        }
        let index = self.triangles.len();
        for x in min_x..=max_x {
            for z in min_z..=max_z {
                let entries = self.cells.entry((x, z)).or_default();
                if entries.len() >= MAX_TRIANGLES_PER_CELL {
                    return None;
                }
                entries.push(index);
            }
        }
        self.cell_references += cells;
        self.triangles.push(Triangle {
            points,
            denominator,
        });
        Some(())
    }
    pub fn height(&self, x: f64, z: f64) -> Option<f64> {
        if !valid_coordinate(x) || !valid_coordinate(z) {
            return None;
        }
        let indices = self
            .cells
            .get(&((x / CELL).floor() as i32, (z / CELL).floor() as i32))?;
        indices
            .iter()
            .filter_map(|&i| {
                let Triangle {
                    points: [a, b, c],
                    denominator,
                } = &self.triangles[i];
                let u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / denominator;
                let v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / denominator;
                (u >= -1e-8 && v >= -1e-8 && u + v <= 1.0 + 1e-8)
                    .then_some(u * a[1] + v * b[1] + (1.0 - u - v) * c[1])
            })
            .max_by(f64::total_cmp)
    }
    /// Keep the routing datum independent of mesh root offsets, preventing
    /// repeated fitting from accumulating height or shifting a planned route.
    pub fn fit(
        &self,
        ship: &ShipDefinition,
        ground: &GroundPose,
        at: DeckPose,
    ) -> Option<ContactPose> {
        let model = ground.deck_geometry.as_ref()?;
        let layout = ship.air_wing.as_ref()?.deck_layout.as_ref()?;
        // A transferring aircraft rides its lowered platform. Fit to that
        // platform's shape, translated by its current handling datum.
        let lift_offset = layout
            .elevators
            .iter()
            .find(|e| {
                (at.position[0] - e.position[0]).abs() < 1e-5
                    && (at.position[2] - e.position[2]).abs() < 1e-5
                    && at.position[1] < e.position[1]
            })
            .map_or(0.0, |e| at.position[1] - e.position[1]);
        if !model.valid() || !ground.pitch.is_finite() || !ground.clearance.is_finite() {
            return None;
        }
        if !at.position.iter().all(|v| v.is_finite()) || !at.heading.is_finite() {
            return None;
        }
        // A point tangent can have no solution exactly at a raised platform
        // edge. Permit a small physical root displacement within the existing
        // 15 cm traffic margin; the route datum itself never moves. This is a
        // bounded contact approximation, not a deformable/rolling tyre model.
        if let Some(fit) = self.solve(&model.tyres, ground, at, lift_offset, [0.0; 2]) {
            return Some(fit);
        }
        for radius in [0.01, 0.025] {
            for angle in [
                0.0,
                std::f64::consts::PI,
                std::f64::consts::FRAC_PI_2,
                -std::f64::consts::FRAC_PI_2,
            ] {
                let (sin, cos) = (at.heading + angle).sin_cos();
                if let Some(fit) = self.solve(
                    &model.tyres,
                    ground,
                    at,
                    lift_offset,
                    [radius * sin, -radius * cos],
                ) {
                    return Some(fit);
                }
            }
        }
        None
    }
    /// Minimum vertical separation over overlapping triangle interiors, not
    /// merely vertex rays: a wheel can bridge a raised platform edge.
    pub fn tyre_gap(&self, patches: &[[Vec3; 3]], root: Vec3, attitude: Pose) -> Option<f64> {
        if patches.is_empty()
            || patches.len() > 500
            || root.iter().any(|&v| !valid_coordinate(v))
            || [attitude.heading, attitude.pitch, attitude.roll]
                .iter()
                .any(|v| !v.is_finite())
            || patches
                .iter()
                .flatten()
                .flatten()
                .any(|v| !v.is_finite() || v.abs() > 25.0)
        {
            return None;
        }
        let mut query_cells = 0;
        let mut query_candidates = 0;
        let mut minimum = f64::INFINITY;
        let right = rotate([1.0, 0.0, 0.0], attitude);
        let up = rotate([0.0, 1.0, 0.0], attitude);
        let back = rotate([0.0, 0.0, 1.0], attitude);
        for patch in patches {
            let p = patch.map(|p| {
                std::array::from_fn(|i| root[i] + right[i] * p[0] + up[i] * p[1] + back[i] * p[2])
            });
            if p.iter().flatten().any(|&v| !valid_coordinate(v)) {
                return None;
            }
            let min_x =
                (p.iter().map(|p| p[0]).fold(f64::INFINITY, f64::min) / CELL).floor() as i32;
            let max_x =
                (p.iter().map(|p| p[0]).fold(f64::NEG_INFINITY, f64::max) / CELL).floor() as i32;
            let min_z =
                (p.iter().map(|p| p[2]).fold(f64::INFINITY, f64::min) / CELL).floor() as i32;
            let max_z =
                (p.iter().map(|p| p[2]).fold(f64::NEG_INFINITY, f64::max) / CELL).floor() as i32;
            let cells = (max_x - min_x + 1) as usize * (max_z - min_z + 1) as usize;
            if cells > MAX_QUERY_CELLS - query_cells {
                return None;
            }
            query_cells += cells;
            for x in min_x..=max_x {
                for z in min_z..=max_z {
                    for &i in self.cells.get(&(x, z)).into_iter().flatten() {
                        if query_candidates >= MAX_QUERY_CANDIDATES {
                            return None;
                        }
                        query_candidates += 1;
                        let triangle = &self.triangles[i];
                        if [0, 2].iter().any(|&axis| {
                            p.iter().map(|p| p[axis]).fold(f64::INFINITY, f64::min)
                                > triangle
                                    .points
                                    .iter()
                                    .map(|p| p[axis])
                                    .fold(f64::NEG_INFINITY, f64::max)
                                || p.iter().map(|p| p[axis]).fold(f64::NEG_INFINITY, f64::max)
                                    < triangle
                                        .points
                                        .iter()
                                        .map(|p| p[axis])
                                        .fold(f64::INFINITY, f64::min)
                        }) {
                            continue;
                        }
                        let mut polygon = [[0.0; 3]; 9];
                        polygon[..3].copy_from_slice(&p);
                        let mut count = 3;
                        for edge in 0..3 {
                            let a = triangle.points[edge];
                            let b = triangle.points[(edge + 1) % 3];
                            let side = |p: Vec3| {
                                ((b[0] - a[0]) * (p[2] - a[2]) - (b[2] - a[2]) * (p[0] - a[0]))
                                    * triangle.denominator.signum()
                                    + 1e-9
                            };
                            let mut clipped = [[0.0; 3]; 9];
                            let mut next = 0;
                            for j in 0..count {
                                let a = polygon[j];
                                let b = polygon[(j + 1) % count];
                                let da = side(a);
                                let db = side(b);
                                if da >= 0.0 {
                                    *clipped.get_mut(next)? = a;
                                    next += 1;
                                }
                                if (da >= 0.0) != (db >= 0.0) {
                                    *clipped.get_mut(next)? =
                                        add(a, scale(sub(b, a), da / (da - db)));
                                    next += 1;
                                }
                            }
                            polygon = clipped;
                            count = next;
                            if count == 0 {
                                break;
                            }
                        }
                        let [a, b, c] = triangle.points;
                        for p in &polygon[..count] {
                            let u = ((b[2] - c[2]) * (p[0] - c[0]) + (c[0] - b[0]) * (p[2] - c[2]))
                                / triangle.denominator;
                            let v = ((c[2] - a[2]) * (p[0] - c[0]) + (a[0] - c[0]) * (p[2] - c[2]))
                                / triangle.denominator;
                            minimum =
                                minimum.min(p[1] - (u * a[1] + v * b[1] + (1.0 - u - v) * c[1]));
                        }
                    }
                }
            }
        }
        minimum.is_finite().then_some(minimum)
    }
    fn solve(
        &self,
        tyres: &[Vec<[Vec3; 3]>],
        ground: &GroundPose,
        at: DeckPose,
        lift_offset: f64,
        shift: [f64; 2],
    ) -> Option<ContactPose> {
        let mut attitude = Pose {
            heading: at.heading,
            pitch: ground.pitch,
            ..Default::default()
        };
        let mut root = add(at.position, [shift[0], ground.clearance, shift[1]]);
        let residual = |attitude: Pose, root: Vec3| -> Option<Vec3> {
            let mut result = [0.0; 3];
            for (i, patches) in tyres.iter().enumerate() {
                result[i] = self.tyre_gap(patches, root, attitude)? - lift_offset;
            }
            Some(result)
        };
        for _ in 0..8 {
            let r = residual(attitude, root)?;
            if r.iter().all(|v| v.abs() < 0.0001) {
                return Some(ContactPose { root, attitude });
            }
            let epsilon = 0.00001;
            let pitch = scale(
                sub(
                    residual(
                        Pose {
                            pitch: attitude.pitch + epsilon,
                            ..attitude
                        },
                        root,
                    )?,
                    r,
                ),
                1.0 / epsilon,
            );
            let roll = scale(
                sub(
                    residual(
                        Pose {
                            roll: attitude.roll + epsilon,
                            ..attitude
                        },
                        root,
                    )?,
                    r,
                ),
                1.0 / epsilon,
            );
            let up = [1.0; 3];
            let determinant = dot(up, cross(pitch, roll));
            if determinant.abs() < 1e-6 {
                return None;
            }
            root[1] -= dot(r, cross(pitch, roll)) / determinant;
            attitude.pitch -= dot(up, cross(r, roll)) / determinant;
            attitude.roll -= dot(up, cross(pitch, r)) / determinant;
            if !root[1].is_finite()
                || (attitude.pitch - ground.pitch).abs() > 0.12
                || attitude.roll.abs() > 0.12
            {
                return None;
            }
        }
        None
    }
}
