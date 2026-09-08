use crate::{
    definition::{Hull, Vec3},
    geometry::{Pose, rotate},
    hull::hull_section,
};
#[derive(Clone, Debug)]
struct Slice {
    z: f64,
    dz: f64,
    polygon: Vec<[f64; 2]>,
}
/// Immutable precomputed geometry belongs to compiled content, shared by all matches.
#[derive(Clone, Debug)]
pub struct HullHydrostatics {
    slices: Vec<Slice>,
    bound: f64,
    full: f64,
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
    pub fn new(h: &Hull) -> Self {
        let mut stations: Vec<f64> = vec![0.0, h.length];
        stations.extend(h.half_breadths.iter().map(|p| p[0]));
        if let Some(ss) = &h.sections {
            stations.extend(ss.iter().map(|s| s.station));
        }
        stations.extend((0..49).map(|i| h.length * i as f64 / 48.0));
        stations.sort_by(f64::total_cmp);
        stations.dedup();
        let mut result = Self {
            slices: stations
                .windows(2)
                .map(|p| Slice {
                    z: h.length / 2.0 - (p[1] + p[0]) / 2.0,
                    dz: p[1] - p[0],
                    polygon: hull_section(h, (p[1] + p[0]) / 2.0),
                })
                .collect(),
            bound: h.length + h.beam + h.draft + h.depth,
            full: 0.0,
        };
        result.full = result.sample(-result.bound, 0.0, 0.0).volume;
        result
    }
    pub fn sample(&self, y: f64, roll: f64, pitch: f64) -> Hydrostatics {
        let nx = roll.sin() * pitch.cos();
        let ny = roll.cos() * pitch.cos();
        let nz = -pitch.sin();
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
    pub fn full_volume(&self) -> f64 {
        self.full
    }
    pub fn flotation(&self, volume: f64, roll: f64, pitch: f64) -> Flotation {
        let full = self.sample(-self.bound, roll, pitch);
        if volume >= full.volume {
            return Flotation {
                volume: full.volume,
                center: full.center,
                y: -self.bound,
                afloat: false,
            };
        }
        let (mut low, mut high) = (-self.bound, self.bound);
        for _ in 0..27 {
            let y = (low + high) / 2.0;
            if self.sample(y, roll, pitch).volume > volume {
                low = y;
            } else {
                high = y;
            }
        }
        let y = (low + high) / 2.0;
        let s = self.sample(y, roll, pitch);
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
