use crate::{
    definition::{Hull, Vec3},
    geometry::{Pose, rotate},
    hull::hull_section,
    hydro_table::HydrostaticTable,
};
#[derive(Clone, Debug)]
struct Slice {
    z: f64,
    dz: f64,
    polygon: Vec<[f64; 2]>,
}
#[derive(Clone, Debug)]
struct PolyCell {
    shape: crate::definition::ConvexVolume,
    density: f64,
    full: crate::construction_geometry::Moments,
    vertices: Vec<Vec3>,
}
/// Immutable precomputed geometry belongs to compiled content, shared by all matches.
#[derive(Clone, Debug)]
pub struct HullHydrostatics {
    cells: Option<Vec<PolyCell>>,
    slices: Vec<Slice>,
    bound: f64,
    /// A player-built hull: exact polyhedral cells and no published table.
    constructed: bool,
    /// Authored waterplane area, the first slope guess of a warm-started solve.
    waterplane: f64,
    full: Hydrostatics,
    /// Published content. Absent only for a hull the catalog has no table for,
    /// which then falls back to the mesh solver the table was solved from.
    table: Option<HydrostaticTable>,
}
#[derive(Clone, Copy, Debug, serde::Serialize)]
pub struct Hydrostatics {
    pub volume: f64,
    pub center: Vec3,
}
#[derive(Clone, Copy, Debug, serde::Serialize)]
pub struct Flotation {
    pub volume: f64,
    pub center: Vec3,
    pub y: f64,
    pub afloat: bool,
}
impl HullHydrostatics {
    pub fn new(h: &Hull, table: Option<&HydrostaticTable>) -> Self {
        let mut stations: Vec<f64> = vec![0.0, h.length];
        stations.extend(h.half_breadths.iter().map(|p| p[0]));
        if let Some(ss) = &h.sections {
            stations.extend(ss.iter().map(|s| s.station));
        }
        stations.extend((0..49).map(|i| h.length * i as f64 / 48.0));
        stations.sort_by(f64::total_cmp);
        stations.dedup();
        let mut result = Self {
            cells: if let Some(proxy) = &h.buoyancy {
                Some(
                    proxy
                        .cells
                        .iter()
                        .map(|c| {
                            let shape = crate::construction_geometry::box_cell(c.center, c.size);
                            let mut full = crate::construction_geometry::moments(&shape);
                            let density = c.volume_m3 / full.volume;
                            full.volume *= density;
                            full.first = full.first.map(|v| v * density);
                            let vertices = shape
                                .faces
                                .iter()
                                .flat_map(|f| f.vertices.iter().copied())
                                .collect();
                            PolyCell {
                                shape,
                                full,
                                vertices,
                                density,
                            }
                        })
                        .collect(),
                )
            } else {
                h.volume.as_ref().map(|v| {
                    v.cells
                        .iter()
                        .map(|c| PolyCell {
                            shape: c.clone(),
                            density: 1.,
                            full: crate::construction_geometry::moments(c),
                            vertices: c
                                .faces
                                .iter()
                                .flat_map(|f| f.vertices.iter().copied())
                                .collect(),
                        })
                        .collect()
                })
            },
            slices: stations
                .windows(2)
                .map(|p| Slice {
                    z: h.length / 2.0 - (p[1] + p[0]) / 2.0,
                    dz: p[1] - p[0],
                    polygon: hull_section(h, (p[1] + p[0]) / 2.0),
                })
                .collect(),
            bound: h.length + h.beam + h.draft + h.depth,
            constructed: h.volume.is_some(),
            waterplane: h.waterplane_area_m2,
            full: Hydrostatics {
                volume: 0.0,
                center: [0.0; 3],
            },
            table: if h.volume.is_some() {
                None
            } else {
                table.cloned()
            },
        };
        result.full = match &result.table {
            Some(t) => Hydrostatics {
                volume: t.full_volume,
                center: t.full_center,
            },
            None => result.mesh_sample(-result.bound, 0.0, 0.0),
        };
        result
    }
    pub fn sample(&self, y: f64, roll: f64, pitch: f64) -> Hydrostatics {
        if let Some(t) = &self.table {
            let (volume, center) = t.sample(y, roll, pitch);
            return Hydrostatics { volume, center };
        }
        self.mesh_sample(y, roll, pitch)
    }
    /// Clips every hull section at the given immersion. The published table is
    /// solved from and measured against this; it stays the reference, not the
    /// path a battle takes.
    pub fn mesh_sample(&self, y: f64, roll: f64, pitch: f64) -> Hydrostatics {
        self.mesh_sample_within(None, y, roll, pitch)
    }
    /// Each cell's lowest and highest vertex along the water normal. A flotation
    /// bisects immersion at one attitude, so it measures the cells once.
    fn cell_extents(&self, roll: f64, pitch: f64) -> Option<Vec<(f64, f64)>> {
        let n = [
            roll.sin() * pitch.cos(),
            roll.cos() * pitch.cos(),
            -pitch.sin(),
        ];
        Some(
            self.cells
                .as_ref()?
                .iter()
                .map(|cell| {
                    cell.vertices
                        .iter()
                        .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), &p| {
                            let d = crate::geometry::dot(n, p);
                            (lo.min(d), hi.max(d))
                        })
                })
                .collect(),
        )
    }
    fn mesh_sample_within(
        &self,
        extents: Option<&[(f64, f64)]>,
        y: f64,
        roll: f64,
        pitch: f64,
    ) -> Hydrostatics {
        let nx = roll.sin() * pitch.cos();
        let ny = roll.cos() * pitch.cos();
        let nz = -pitch.sin();
        if let Some(cells) = &self.cells {
            let n = [nx, ny, nz];
            let mut m = crate::construction_geometry::Moments::default();
            for (k, cell) in cells.iter().enumerate() {
                // A vertex is under water when its height along the normal is at
                // most -y, so the extremes decide what the vertex scan decided.
                let (inside, outside) = match extents {
                    Some(extents) => (extents[k].0 <= -y, extents[k].1 > -y),
                    None => {
                        let (mut inside, mut outside) = (false, false);
                        for &p in &cell.vertices {
                            if crate::geometry::dot(n, p) <= -y {
                                inside = true;
                            } else {
                                outside = true;
                            }
                        }
                        (inside, outside)
                    }
                };
                if !inside {
                    continue;
                }
                if !outside {
                    m.add(cell.full);
                } else if let Some(mut part) =
                    crate::construction_geometry::clipped_centre(&cell.shape, n, -y)
                {
                    if cell.density != 1. {
                        part.volume *= cell.density;
                        part.first = part.first.map(|v| v * cell.density);
                    }
                    m.add(part);
                }
            }
            return Hydrostatics {
                volume: m.volume,
                center: m.center(),
            };
        }
        let (mut volume, mut x, mut cy, mut z) = (0.0, 0.0, 0.0, 0.0);
        for s in &self.slices {
            let (area, mx, my) = clipped_moment(&s.polygon, nx, ny, -y - nz * s.z);
            let v = area * s.dz;
            volume += v;
            x += mx * v;
            cy += my * v;
            z += s.z * v;
        }
        Hydrostatics {
            volume,
            center: if volume > 1e-9 {
                [x / volume, cy / volume, z / volume]
            } else {
                [0.0; 3]
            },
        }
    }
    /// Volume alone, for the flotation bisection. The area accumulation is the
    /// same expression on the same floats in the same order as `sample`, so the
    /// volume is bit-identical; only the unused x and y moments are dropped.
    fn sampled_volume(&self, extents: Option<&[(f64, f64)]>, y: f64, roll: f64, pitch: f64) -> f64 {
        if self.cells.is_some() {
            return self.mesh_sample_within(extents, y, roll, pitch).volume;
        }
        let nx = roll.sin() * pitch.cos();
        let ny = roll.cos() * pitch.cos();
        let nz = -pitch.sin();
        let mut volume = 0.0;
        for s in &self.slices {
            let area = clipped_area(&s.polygon, nx, ny, -y - nz * s.z);
            let v = area * s.dz;
            volume += v;
        }
        volume
    }
    pub fn full_volume(&self) -> f64 {
        self.full.volume
    }
    pub fn flotation(&self, volume: f64, roll: f64, pitch: f64) -> Flotation {
        if let Some(t) = &self.table {
            if volume >= t.full_volume {
                return Flotation {
                    volume: t.full_volume,
                    center: t.full_center,
                    y: -self.bound,
                    afloat: false,
                };
            }
            let (y, center) = t.flotation(volume, roll, pitch);
            return Flotation {
                volume,
                center,
                y,
                afloat: true,
            };
        }
        self.mesh_flotation(volume, roll, pitch)
    }
    /// `flotation` for a hull already floating near immersion `near`, as the
    /// stability solve knows from half a second earlier. Published tables and
    /// authored hulls answer exactly as `flotation` does. A constructed hull has
    /// only its mesh, where every trial immersion clips each waterline cell, so
    /// it replaces the 27 bisections from the hull's bounding distance with a
    /// bracketed secant from `near`: three or four trials, to within 0.01 mm.
    pub fn flotation_near(&self, volume: f64, roll: f64, pitch: f64, near: f64) -> Flotation {
        if self.table.is_some() || !self.constructed || volume >= self.full.volume {
            return self.flotation(volume, roll, pitch);
        }
        let Some(extents) = self.cell_extents(roll, pitch) else {
            return self.flotation(volume, roll, pitch);
        };
        let (lowest, highest) = extents
            .iter()
            .fold((f64::INFINITY, f64::NEG_INFINITY), |a, e| {
                (a.0.min(e.0), a.1.max(e.1))
            });
        // The water plane sits at height -y along the normal. At the hull's top
        // everything is immersed, at its bottom nothing: the excess displacement
        // falls from `full - volume` to `-volume` as y rises between them.
        let (mut deep, mut shallow) = (-highest, -lowest);
        if !(deep < shallow) || volume <= 0.0 {
            return self.flotation(volume, roll, pitch);
        }
        let area = if self.waterplane.is_finite() && self.waterplane > 1.0 {
            self.waterplane
        } else {
            self.full.volume / (shallow - deep)
        };
        const TOLERANCE_M: f64 = 1e-8;
        let inside = |y: f64, deep: f64, shallow: f64| y.is_finite() && y > deep && y < shallow;
        let mut y = if inside(near, deep, shallow) {
            near
        } else {
            (deep + shallow) / 2.0
        };
        let mut previous: Option<(f64, f64)> = None;
        let mut trial = 0;
        // The answer is the last immersion actually sampled, so its displaced
        // volume and centre come from the trial itself.
        let sample = loop {
            let s = self.mesh_sample_within(Some(&extents), y, roll, pitch);
            let g = s.volume - volume;
            if g > 0.0 {
                deep = y;
            } else {
                shallow = y;
            }
            if g == 0.0 || shallow - deep < TOLERANCE_M || trial >= 96 {
                break s;
            }
            // Displacement falls by the waterplane area per metre of rise.
            let secant = match previous {
                Some((py, pg)) if pg != g => y - g * (y - py) / (g - pg),
                _ => y + g / area,
            };
            previous = Some((y, g));
            // A few secant trials settle any smooth hull; past that, or when a
            // trial leaves the bracket, halve it so the solve always ends.
            let next = if trial < 8 && inside(secant, deep, shallow) {
                secant
            } else {
                (deep + shallow) / 2.0
            };
            if (next - y).abs() < TOLERANCE_M {
                break s;
            }
            y = next;
            trial += 1;
        };
        Flotation {
            volume: sample.volume,
            center: sample.center,
            y,
            afloat: true,
        }
    }
    /// Find a stable loaded attitude near upright without advancing simulation.
    /// Re-solve immersion at each attitude so the Jacobian includes waterplane
    /// changes. Reject unstable/singular or extreme solutions; callers can keep
    /// the upright draft and let the ordinary simulation handle those designs.
    pub fn equilibrium(&self, volume: f64, gravity: Vec3) -> Option<Pose> {
        let sample = |roll, pitch| {
            let f = self.flotation(volume, roll, pitch);
            (f, righting_arms(f.center, gravity, roll, pitch))
        };
        let (mut roll, mut pitch) = (0., 0.);
        for _ in 0..24 {
            let (f, arm) = sample(roll, pitch);
            if !f.afloat {
                return None;
            }
            let eps = 0.0001;
            let (_, r) = sample(roll + eps, pitch);
            let (_, p) = sample(roll, pitch + eps);
            let (a, b) = ((r.0 - arm.0) / eps, (p.0 - arm.0) / eps);
            let (c, d) = ((r.1 - arm.1) / eps, (p.1 - arm.1) / eps);
            let det = a * d - b * c;
            if !det.is_finite() || det <= 1e-9 || a >= 0. || d >= 0. {
                return None;
            }
            if arm.0.hypot(arm.1) < 1e-6 {
                return Some(Pose {
                    y: f.y,
                    roll,
                    pitch,
                    ..Pose::default()
                });
            }
            let dr = (b * arm.1 - d * arm.0) / det;
            let dp = (c * arm.0 - a * arm.1) / det;
            let mut scale = (0.05 / dr.abs().max(dp.abs())).min(1.);
            let mut accepted = false;
            for _ in 0..10 {
                let next_roll = roll + dr * scale;
                let next_pitch = pitch + dp * scale;
                if next_roll.abs() <= 0.35 && next_pitch.abs() <= 0.35 {
                    let (_, next) = sample(next_roll, next_pitch);
                    if next.0.hypot(next.1) < arm.0.hypot(arm.1) {
                        roll = next_roll;
                        pitch = next_pitch;
                        accepted = true;
                        break;
                    }
                }
                scale *= 0.5;
            }
            if !accepted {
                return None;
            }
        }
        None
    }
    /// Bisects the mesh solver for the immersion that displaces `volume`.
    pub fn mesh_flotation(&self, volume: f64, roll: f64, pitch: f64) -> Flotation {
        // At y = -bound the clip limit is at least bound - length / 2, which is
        // beyond every |n . vertex| a section polygon can reach (half breadth
        // plus depth plus draft), so `clipped_moment` keeps every vertex and
        // never interpolates: the sample does not depend on roll or pitch and
        // equals the fully immersed sample taken once in `new`.
        let full = self.full;
        if volume >= full.volume {
            return Flotation {
                volume: full.volume,
                center: full.center,
                y: -self.bound,
                afloat: false,
            };
        }
        let extents = self.cell_extents(roll, pitch);
        let extents = extents.as_deref();
        let (mut low, mut high) = (-self.bound, self.bound);
        for _ in 0..27 {
            let y = (low + high) / 2.0;
            if self.sampled_volume(extents, y, roll, pitch) > volume {
                low = y;
            } else {
                high = y;
            }
        }
        let y = (low + high) / 2.0;
        let s = self.mesh_sample_within(extents, y, roll, pitch);
        Flotation {
            volume: s.volume,
            center: s.center,
            y,
            afloat: true,
        }
    }
}
fn clipped_moment(polygon: &[[f64; 2]], nx: f64, ny: f64, limit: f64) -> (f64, f64, f64) {
    let (mut area, mut x, mut y, mut count, mut first, mut last) =
        (0.0, 0.0, 0.0, 0, [0.0, 0.0], [0.0, 0.0]);
    let mut append = |p: [f64; 2]| {
        if count == 0 {
            first = p;
        } else {
            let cross = last[0] * p[1] - p[0] * last[1];
            area += cross;
            x += (last[0] + p[0]) * cross;
            y += (last[1] + p[1]) * cross;
        }
        count += 1;
        last = p;
    };
    for i in 0..polygon.len() {
        let a = polygon[i];
        let b = polygon[(i + 1) % polygon.len()];
        let da = nx * a[0] + ny * a[1] - limit;
        let db = nx * b[0] + ny * b[1] - limit;
        if da <= 0.0 {
            append(a);
        }
        if da < 0.0 && db > 0.0 || da > 0.0 && db < 0.0 {
            let t = da / (da - db);
            append([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        }
    }
    if count > 0 {
        let cross = last[0] * first[1] - first[0] * last[1];
        area += cross;
        x += (last[0] + first[0]) * cross;
        y += (last[1] + first[1]) * cross;
    }
    if area.abs() < 1e-12 {
        (0.0, 0.0, 0.0)
    } else {
        (area.abs() / 2.0, x / (3.0 * area), y / (3.0 * area))
    }
}
/// `clipped_moment` with the moment accumulation removed. Every operation that
/// feeds `area` is unchanged and in the same order, so the result is the same
/// f64 as `clipped_moment(..).0`.
fn clipped_area(polygon: &[[f64; 2]], nx: f64, ny: f64, limit: f64) -> f64 {
    let (mut area, mut count, mut first, mut last) = (0.0, 0, [0.0, 0.0], [0.0, 0.0]);
    let mut append = |p: [f64; 2]| {
        if count == 0 {
            first = p;
        } else {
            let cross = last[0] * p[1] - p[0] * last[1];
            area += cross;
        }
        count += 1;
        last = p;
    };
    for i in 0..polygon.len() {
        let a = polygon[i];
        let b = polygon[(i + 1) % polygon.len()];
        let da = nx * a[0] + ny * a[1] - limit;
        let db = nx * b[0] + ny * b[1] - limit;
        if da <= 0.0 {
            append(a);
        }
        if da < 0.0 && db > 0.0 || da > 0.0 && db < 0.0 {
            let t = da / (da - db);
            append([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        }
    }
    if count > 0 {
        let cross = last[0] * first[1] - first[0] * last[1];
        area += cross;
    }
    if area.abs() < 1e-12 {
        0.0
    } else {
        area.abs() / 2.0
    }
}
pub fn righting_arms(b: Vec3, g: Vec3, roll: f64, pitch: f64) -> (f64, f64) {
    let pose = Pose {
        roll,
        pitch,
        ..Pose::default()
    };
    let b = rotate(b, pose);
    let g = rotate(g, pose);
    (b[0] - g[0], g[2] - b[2])
}
