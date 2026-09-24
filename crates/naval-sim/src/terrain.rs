//! Real-world battle terrain: one baked heightfield per map, shared with the renderer.
//!
//! `scripts/maps/bake-terrain.py` writes `public/maps/terrain/<map>.ntf` from surveyed
//! elevation data. The browser decodes the same bytes in `src/maps/heightfield.ts`, and
//! both sides sample them with the same bilinear rule, so the drawn coast, grounding,
//! shell hits and sight lines agree.
//!
//! NTF1, little-endian: `b"NTF1"`, u32 columns (along +x), u32 rows (along +z), f32 cell
//! size, f32 origin x and f32 origin z (chart metres of sample (0, 0)), f32 metres per
//! height quantum, u32 flags (0), u32 payload length, then a zlib stream of i16
//! residuals. Row-major; each residual is `q - (left + up - up_left)`, with zeros outside
//! the grid. A height is `q * step` metres; land is above zero.
//!
//! Every battle query reads a [`Terrain`]: the field placed in the battle's world.
//! `height` and `land_within` are the two expressions the browser mirrors; everything
//! else is simulation-only and built on them:
//!
//! - `first_hit` (shells, torpedoes) and `line_visible` (sensors, lookouts, flak)
//!   step a ray every [`RAY_STEP_M`] and skip whatever a max-height pyramid proves
//!   clear (`terrain/relief.rs`), so open water costs a lookup or two.
//! - `clearance`, `escape` and `segment_clear` (navigation, grounding, land
//!   avoidance) read a coarse distance-to-land grid (`terrain/clearance.rs`, whose
//!   notes give its error bound); `plan_path` routes over it (`terrain/route.rs`).
//!
//! The derived structures are built once per field, on first use, and shared by
//! every battle on that map; a catalog only ever builds them for maps in play.
use std::{
    io::Read,
    sync::{Arc, OnceLock},
};
mod clearance;
mod relief;
mod route;

/// Height of the open sea floor beyond a chart, and of a chart's falloff band.
pub const OPEN_SEA_M: f64 = -60.0;
/// No ship may deploy with a land sample within this many metres of its position
/// (`land_within`). Battle admission, mission placement and the client's deployment
/// charts share it.
pub const DEPLOYMENT_CLEARANCE_M: f64 = 300.0;
/// Horizontal spacing of the samples `first_hit` and `line_visible` take along a ray.
pub const RAY_STEP_M: f64 = 20.0;
/// Bisection steps `first_hit` refines the first solid sample with.
const HIT_BISECTIONS: usize = 16;
/// Radius for the sight-line drop of an observer's horizon.
const EARTH_RADIUS_M: f64 = 6_371_000.0;
const HEADER_BYTES: usize = 36;
/// Largest accepted grid, per side. The baked maps are 2401 samples on a side.
const MAX_SAMPLES: usize = 4097;

pub struct Heightfield {
    pub columns: usize,
    pub rows: usize,
    pub cell: f64,
    pub origin_x: f64,
    pub origin_z: f64,
    pub step: f64,
    quanta: Vec<i16>,
    relief: OnceLock<relief::Relief>,
    clearance: OnceLock<clearance::Clearance>,
}
impl std::fmt::Debug for Heightfield {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Heightfield")
            .field("columns", &self.columns)
            .field("rows", &self.rows)
            .field("cell", &self.cell)
            .field("bounds", &self.bounds())
            .field("step", &self.step)
            .finish_non_exhaustive()
    }
}

impl Heightfield {
    pub fn decode(bytes: &[u8]) -> Result<Self, String> {
        let invalid = |why: &str| format!("Invalid terrain: {why}");
        if bytes.len() < HEADER_BYTES || &bytes[..4] != b"NTF1" {
            return Err(invalid("not an NTF1 heightfield"));
        }
        let u32_at = |at: usize| u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap());
        let f32_at = |at: usize| f32::from_le_bytes(bytes[at..at + 4].try_into().unwrap()) as f64;
        let (columns, rows) = (u32_at(4) as usize, u32_at(8) as usize);
        let (cell, origin_x, origin_z, step) = (f32_at(12), f32_at(16), f32_at(20), f32_at(24));
        let (flags, payload) = (u32_at(28), u32_at(32) as usize);
        if !(2..=MAX_SAMPLES).contains(&columns) || !(2..=MAX_SAMPLES).contains(&rows) {
            return Err(invalid("grid size outside 2..=4097 samples"));
        }
        if ![cell, origin_x, origin_z, step]
            .iter()
            .all(|v| v.is_finite())
            || cell <= 0.0
            || step <= 0.0
            || flags != 0
        {
            return Err(invalid("bad cell size, origin, height step or flags"));
        }
        if bytes.len() != HEADER_BYTES + payload {
            return Err(invalid("payload length does not match the file"));
        }
        let mut raw = Vec::with_capacity(columns * rows * 2);
        flate2::read::ZlibDecoder::new(&bytes[HEADER_BYTES..])
            .take((columns * rows * 2 + 1) as u64)
            .read_to_end(&mut raw)
            .map_err(|e| invalid(&format!("payload does not inflate: {e}")))?;
        if raw.len() != columns * rows * 2 {
            return Err(invalid("payload does not hold one residual per sample"));
        }
        let mut quanta = vec![0i16; columns * rows];
        for j in 0..rows {
            for i in 0..columns {
                let at = j * columns + i;
                let residual = i16::from_le_bytes([raw[at * 2], raw[at * 2 + 1]]) as i32;
                let left = if i > 0 { quanta[at - 1] as i32 } else { 0 };
                let up = if j > 0 {
                    quanta[at - columns] as i32
                } else {
                    0
                };
                let up_left = if i > 0 && j > 0 {
                    quanta[at - columns - 1] as i32
                } else {
                    0
                };
                let value = residual + left + up - up_left;
                quanta[at] = i16::try_from(value).map_err(|_| invalid("height outside 16 bits"))?;
            }
        }
        Ok(Self::new(
            columns,
            rows,
            cell,
            [origin_x, origin_z],
            step,
            quanta,
        ))
    }
    fn new(
        columns: usize,
        rows: usize,
        cell: f64,
        origin: [f64; 2],
        step: f64,
        quanta: Vec<i16>,
    ) -> Self {
        Self {
            columns,
            rows,
            cell,
            origin_x: origin[0],
            origin_z: origin[1],
            step,
            quanta,
            relief: OnceLock::new(),
            clearance: OnceLock::new(),
        }
    }

    /// Test and tool seam: a grid sampled from `height(x, z)` in chart metres.
    pub fn from_fn(
        columns: usize,
        rows: usize,
        cell: f64,
        origin: [f64; 2],
        step: f64,
        height: impl Fn(f64, f64) -> f64,
    ) -> Self {
        let quanta = (0..rows)
            .flat_map(|j| (0..columns).map(move |i| (i, j)))
            .map(|(i, j)| {
                let h = height(origin[0] + i as f64 * cell, origin[1] + j as f64 * cell);
                (h / step).round().clamp(i16::MIN as f64, i16::MAX as f64) as i16
            })
            .collect();
        Self::new(columns, rows, cell, origin, step, quanta)
    }

    /// The stored height of sample (i, j), metres.
    pub fn sample(&self, i: usize, j: usize) -> f64 {
        self.quanta[j * self.columns + i] as f64 * self.step
    }
    /// Whether sample (i, j) is land. Exact: it reads the stored quantum.
    pub fn sample_is_land(&self, i: usize, j: usize) -> bool {
        self.quanta[j * self.columns + i] > 0
    }
    /// Chart extent, metres: [min x, min z, max x, max z].
    pub fn bounds(&self) -> [f64; 4] {
        [
            self.origin_x,
            self.origin_z,
            self.origin_x + (self.columns - 1) as f64 * self.cell,
            self.origin_z + (self.rows - 1) as f64 * self.cell,
        ]
    }
    /// Bilinear height at chart metres; `OPEN_SEA_M` beyond the grid. The browser's
    /// `Heightfield.height` evaluates the same expression in the same order.
    pub fn height(&self, x: f64, z: f64) -> f64 {
        let gx = (x - self.origin_x) / self.cell;
        let gz = (z - self.origin_z) / self.cell;
        if !(gx >= 0.0 && gz >= 0.0)
            || gx > (self.columns - 1) as f64
            || gz > (self.rows - 1) as f64
        {
            return OPEN_SEA_M;
        }
        let i = (gx.floor() as usize).min(self.columns - 2);
        let j = (gz.floor() as usize).min(self.rows - 2);
        let (u, v) = (gx - i as f64, gz - j as f64);
        let at = j * self.columns + i;
        let q = |k: usize| self.quanta[k] as f64;
        let top = q(at) * (1.0 - u) + q(at + 1) * u;
        let bottom = q(at + self.columns) * (1.0 - u) + q(at + self.columns + 1) * u;
        (top * (1.0 - v) + bottom * v) * self.step
    }
    /// Whether any land sample lies within `radius` metres of chart point (x, z). Exact
    /// and shared with the browser's deployment checks, sample for sample.
    pub fn land_within(&self, x: f64, z: f64, radius: f64) -> bool {
        if ![x, z, radius].iter().all(|v| v.is_finite()) {
            return false;
        }
        let span = |centre: f64, origin: f64, count: usize| {
            let low = ((centre - radius - origin) / self.cell).floor().max(0.0);
            let high = ((centre + radius - origin) / self.cell)
                .ceil()
                .min((count - 1) as f64);
            if high < low {
                0..0
            } else {
                low as usize..high as usize + 1
            }
        };
        for j in span(z, self.origin_z, self.rows) {
            let dz = self.origin_z + j as f64 * self.cell - z;
            for i in span(x, self.origin_x, self.columns) {
                let dx = self.origin_x + i as f64 * self.cell - x;
                if dx * dx + dz * dz <= radius * radius && self.sample_is_land(i, j) {
                    return true;
                }
            }
        }
        false
    }

    // Simulation-only queries in chart metres, built on the two mirrored ones above.

    fn relief(&self) -> &relief::Relief {
        self.relief.get_or_init(|| relief::Relief::build(self))
    }
    fn clearance_grid(&self) -> &clearance::Clearance {
        self.clearance
            .get_or_init(|| clearance::Clearance::build(self))
    }
    /// Build the derived structures now rather than on the first query that
    /// needs them. Battles call this at admission, so the cost lands in loading.
    pub fn prepare(&self) {
        self.relief();
        self.clearance_grid();
    }
    /// An upper bound on `height` anywhere in the chart rectangle spanned by
    /// the two corners: exact to the highest sample of the blocks it touches.
    pub fn highest(&self, x0: f64, z0: f64, x1: f64, z1: f64) -> f64 {
        self.relief()
            .highest(self, x0.min(x1), z0.min(z1), x0.max(x1), z0.max(z1))
    }
    /// Metres from chart point (x, z) to the nearest land sample, never more
    /// than the truth: exact on the clearance nodes, at most half a node
    /// diagonal short between them (see `terrain/clearance.rs`). Infinite on a
    /// chart without land.
    pub fn clearance(&self, x: f64, z: f64) -> f64 {
        self.clearance_grid().clearance(self, x, z)
    }
    /// Unit vector in chart x and z away from the nearest land sample: the way
    /// out of shoal water. Zero on a chart without land.
    pub fn escape(&self, x: f64, z: f64) -> [f64; 2] {
        self.clearance_grid().escape(self, x, z)
    }
    /// Whether every point of the chart segment keeps `margin` metres of
    /// clearance. Conservative: a false answer may be a segment too close to
    /// call, never a true one that grazes land.
    pub fn segment_clear(&self, from: [f64; 2], to: [f64; 2], margin: f64) -> bool {
        self.clearance_grid().segment_clear(self, from, to, margin)
    }
    /// A route of chart waypoints ending at `to` whose every leg keeps `margin`
    /// clearance, `[to]` when the straight leg does; None when either end is
    /// inside the margin or no route was found within the search bound.
    pub fn plan_path(&self, from: [f64; 2], to: [f64; 2], margin: f64) -> Option<Vec<[f64; 2]>> {
        route::plan(self, self.clearance_grid(), from, to, margin)
    }
}

/// A map's heightfield placed in one battle's world frame: world = chart + offset.
/// Custom and online battles centre the chart between the two default spawn lines,
/// `[0, -spawnDistance / 2]`; missions centre it on the mission area, `[0, 0]`. A map
/// without land has no field: every query sees open sea.
#[derive(Clone, Debug, Default)]
pub struct Terrain {
    pub field: Option<Arc<Heightfield>>,
    pub offset: [f64; 2],
}
/// Open sea, for callers that need a `&'static Terrain` (fixtures, tools).
pub static OPEN_SEA: Terrain = Terrain {
    field: None,
    offset: [0.0, 0.0],
};

impl Terrain {
    pub fn open_sea() -> Self {
        Self::default()
    }
    pub fn placed(field: Arc<Heightfield>, offset: [f64; 2]) -> Self {
        Self {
            field: Some(field),
            offset,
        }
    }
    pub fn has_land(&self) -> bool {
        self.field.is_some()
    }
    /// Terrain height at world (x, z), metres; the sea floor is negative.
    pub fn height(&self, x: f64, z: f64) -> f64 {
        self.field.as_ref().map_or(OPEN_SEA_M, |f| {
            f.height(x - self.offset[0], z - self.offset[1])
        })
    }
    pub fn is_land(&self, x: f64, z: f64) -> bool {
        self.height(x, z) > 0.0
    }
    /// Whether any land sample lies within `radius` metres of world (x, z).
    pub fn land_within(&self, x: f64, z: f64, radius: f64) -> bool {
        self.field
            .as_ref()
            .is_some_and(|f| f.land_within(x - self.offset[0], z - self.offset[1], radius))
    }
    fn chart(&self, p: [f64; 2]) -> [f64; 2] {
        [p[0] - self.offset[0], p[1] - self.offset[1]]
    }
    /// Build the field's derived structures now instead of on first use.
    pub fn prepare(&self) {
        if let Some(field) = &self.field {
            field.prepare();
        }
    }
    /// An upper bound on `height` anywhere in the world rectangle spanned by
    /// the two corners.
    pub fn highest(&self, x0: f64, z0: f64, x1: f64, z1: f64) -> f64 {
        self.field.as_ref().map_or(OPEN_SEA_M, |f| {
            let ([ax, az], [bx, bz]) = (self.chart([x0, z0]), self.chart([x1, z1]));
            f.highest(ax, az, bx, bz)
        })
    }
    /// Metres from world (x, z) to the nearest land sample, never more than
    /// the truth (see [`Heightfield::clearance`]); infinite over open sea.
    pub fn clearance(&self, x: f64, z: f64) -> f64 {
        self.field.as_ref().map_or(f64::INFINITY, |f| {
            f.clearance(x - self.offset[0], z - self.offset[1])
        })
    }
    /// Unit world vector (x, z) pointing away from the nearest coast; zero
    /// over open sea.
    pub fn escape(&self, x: f64, z: f64) -> [f64; 2] {
        self.field.as_ref().map_or([0.0; 2], |f| {
            f.escape(x - self.offset[0], z - self.offset[1])
        })
    }
    /// Whether every point of the world segment keeps `margin` metres from
    /// land. Conservative; always true over open sea.
    pub fn segment_clear(&self, from: [f64; 2], to: [f64; 2], margin: f64) -> bool {
        self.field
            .as_ref()
            .is_none_or(|f| f.segment_clear(self.chart(from), self.chart(to), margin))
    }
    /// World waypoints from `from` to `to` (the last one is `to`) whose legs
    /// keep `margin` from land; see [`Heightfield::plan_path`].
    pub fn plan_path(&self, from: [f64; 2], to: [f64; 2], margin: f64) -> Option<Vec<[f64; 2]>> {
        let Some(field) = &self.field else {
            return [from[0], from[1], to[0], to[1]]
                .iter()
                .all(|v| v.is_finite())
                .then(|| vec![to]);
        };
        let mut path = field.plan_path(self.chart(from), self.chart(to), margin)?;
        for p in &mut path {
            *p = [p[0] + self.offset[0], p[1] + self.offset[1]];
        }
        if let Some(last) = path.last_mut() {
            *last = to;
        }
        Some(path)
    }
    /// The first point of a straight world segment at or below the ground,
    /// as the fraction along it and the point: sampled every [`RAY_STEP_M`]
    /// horizontally from `from`, then bisected. Shells and torpedoes stop
    /// there. None over open sea.
    pub fn first_hit(&self, from: [f64; 3], to: [f64; 3]) -> Option<(f64, [f64; 3])> {
        let field = self.field.as_deref()?;
        let point = |t: f64| {
            [
                from[0] + (to[0] - from[0]) * t,
                from[1] + (to[1] - from[1]) * t,
                from[2] + (to[2] - from[2]) * t,
            ]
        };
        let solid = |p: [f64; 3]| p[1] <= self.height(p[0], p[2]);
        let steps = ((to[0] - from[0]).hypot(to[2] - from[2]) / RAY_STEP_M)
            .ceil()
            .max(1.0) as usize;
        if solid(from) {
            return Some((0.0, from));
        }
        let at = |i: usize| point(i as f64 / steps as f64);
        let i = self.first_step(
            field,
            steps,
            1,
            steps,
            &at,
            &|t0, t1| point(t0)[1].min(point(t1)[1]),
            &|i| solid(at(i)),
        )?;
        let (mut a, mut b) = ((i - 1) as f64 / steps as f64, i as f64 / steps as f64);
        for _ in 0..HIT_BISECTIONS {
            let mid = (a + b) / 2.0;
            if solid(point(mid)) {
                b = mid;
            } else {
                a = mid;
            }
        }
        Some((b, point(b)))
    }
    /// Whether the ground leaves a straight sight line between two world points
    /// open, the line dropping by the Earth's curvature between them. Sampled
    /// every [`RAY_STEP_M`]; always true over open sea.
    pub fn line_visible(&self, from: [f64; 3], to: [f64; 3]) -> bool {
        let Some(field) = self.field.as_deref() else {
            return true;
        };
        let distance = (to[0] - from[0]).hypot(to[2] - from[2]);
        let drop = distance * distance / (2.0 * EARTH_RADIUS_M);
        let steps = ((distance / RAY_STEP_M).ceil() as usize).max(1);
        let ray = |t: f64| {
            from[1] + (to[1] - from[1]) * t
                - distance * distance * t * (1.0 - t) / (2.0 * EARTH_RADIUS_M)
        };
        let at = |i: usize| {
            let t = i as f64 / steps as f64;
            [
                from[0] + (to[0] - from[0]) * t,
                ray(t),
                from[2] + (to[2] - from[2]) * t,
            ]
        };
        // The line sags into a parabola in t, lowest at its vertex.
        let lowest = |t0: f64, t1: f64| {
            let slope = to[1] - from[1] - drop;
            let t = if drop > 0.0 {
                ((drop - (to[1] - from[1])) / (2.0 * drop)).clamp(t0, t1)
            } else if slope < 0.0 {
                t1
            } else {
                t0
            };
            ray(t)
        };
        self.first_step(field, steps, 0, steps, &at, &lowest, &|i| {
            let p = at(i);
            self.height(p[0], p[2]) > p[1]
        })
        .is_none()
    }
    /// The first step index in `lo..=hi` satisfying `hit`, skipping every run
    /// of steps whose lowest ray height clears the relief under it.
    #[allow(clippy::too_many_arguments)]
    fn first_step(
        &self,
        field: &Heightfield,
        steps: usize,
        lo: usize,
        hi: usize,
        at: &impl Fn(usize) -> [f64; 3],
        lowest: &impl Fn(f64, f64) -> f64,
        hit: &impl Fn(usize) -> bool,
    ) -> Option<usize> {
        let (a, b) = (at(lo), at(hi));
        let ([ax, az], [bx, bz]) = (self.chart([a[0], a[2]]), self.chart([b[0], b[2]]));
        if lowest(lo as f64 / steps as f64, hi as f64 / steps as f64)
            > field.highest(ax, az, bx, bz)
        {
            return None;
        }
        if hi - lo < 4 {
            return (lo..=hi).find(|&i| hit(i));
        }
        let mid = lo + (hi - lo) / 2;
        self.first_step(field, steps, lo, mid, at, lowest, hit)
            .or_else(|| self.first_step(field, steps, mid + 1, hi, at, lowest, hit))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encode(columns: usize, rows: usize, quanta: &[i16]) -> Vec<u8> {
        let mut residuals = Vec::with_capacity(quanta.len() * 2);
        for j in 0..rows {
            for i in 0..columns {
                let at = j * columns + i;
                let q = |k: usize| quanta[k] as i32;
                let left = if i > 0 { q(at - 1) } else { 0 };
                let up = if j > 0 { q(at - columns) } else { 0 };
                let up_left = if i > 0 && j > 0 {
                    q(at - columns - 1)
                } else {
                    0
                };
                residuals.extend_from_slice(&((q(at) - left - up + up_left) as i16).to_le_bytes());
            }
        }
        let mut z = flate2::write::ZlibEncoder::new(vec![], flate2::Compression::best());
        std::io::Write::write_all(&mut z, &residuals).unwrap();
        let payload = z.finish().unwrap();
        let mut bytes = b"NTF1".to_vec();
        for v in [columns as u32, rows as u32] {
            bytes.extend_from_slice(&v.to_le_bytes());
        }
        for v in [40.0f32, -40.0, -80.0, 0.25] {
            bytes.extend_from_slice(&v.to_le_bytes());
        }
        bytes.extend_from_slice(&0u32.to_le_bytes());
        bytes.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        bytes.extend_from_slice(&payload);
        bytes
    }

    #[test]
    fn decodes_planar_residuals_and_samples_bilinearly() {
        // 3 columns x 4 rows, x from -40 to 40, z from -80 to 40.
        let quanta = [-8, -8, -8, -8, 400, -8, -8, 800, 1200, -8, -8, -8];
        let field = Heightfield::decode(&encode(3, 4, &quanta)).unwrap();
        assert_eq!((field.columns, field.rows), (3, 4));
        assert_eq!(field.sample(1, 1), 100.0);
        assert_eq!(field.height(0.0, -40.0), 100.0);
        assert_eq!(
            field.height(20.0, -20.0),
            (100.0 * 0.5 - 2.0 * 0.5) * 0.5 + (200.0 * 0.5 + 300.0 * 0.5) * 0.5
        );
        assert_eq!(field.height(41.0, 0.0), OPEN_SEA_M);
        assert_eq!(field.bounds(), [-40.0, -80.0, 40.0, 40.0]);
        assert!(field.land_within(0.0, -60.0, 20.0));
        assert!(!field.land_within(-40.0, -80.0, 39.0));
        assert!(field.land_within(-40.0, -80.0, 40.0 * 2f64.sqrt()));
        let placed = Terrain::placed(Arc::new(field), [0.0, -1000.0]);
        assert_eq!(placed.height(0.0, -1040.0), 100.0);
        assert!(placed.is_land(0.0, -1040.0));
        assert!(!Terrain::open_sea().land_within(0.0, 0.0, 1e6));
    }

    #[test]
    fn rejects_truncated_or_foreign_bytes() {
        let bytes = encode(3, 4, &[0; 12]);
        assert!(Heightfield::decode(&bytes[..bytes.len() - 1]).is_err());
        assert!(Heightfield::decode(b"PNG\0").is_err());
        let mut short = encode(2, 2, &[1, 2, 3, 4]);
        short[4] = 3; // three columns promised, four samples delivered
        assert!(Heightfield::decode(&short).is_err());
    }

    /// A 6 km chart of 20 m cells, placed off the world origin: a round island
    /// 600 m across the waterline at chart (-800, 0), a 60 m skerry at (900, 400)
    /// and an atoll ring (land 300..500 m from (1000, -1400)) around a closed
    /// lagoon, on a sea floor that shoals toward every coast like the baked charts.
    const OFFSET: [f64; 2] = [150.0, -250.0];
    fn fixture() -> Terrain {
        let field = Heightfield::from_fn(301, 301, 20.0, [-3000.0, -3000.0], 0.25, |x, z| {
            let island = 600.0 - (x + 800.0).hypot(z);
            let skerry = 60.0 - (x - 900.0).hypot(z - 400.0);
            let ring = 100.0 - ((x - 1000.0).hypot(z + 1400.0) - 400.0).abs();
            let inside = island.max(skerry).max(ring);
            if inside > 0.0 {
                1.0 + inside * 0.5
            } else {
                -(2.5 + 0.12 * -inside).min(160.0)
            }
        });
        Terrain::placed(Arc::new(field), OFFSET)
    }
    fn world(chart: [f64; 2]) -> [f64; 2] {
        [chart[0] + OFFSET[0], chart[1] + OFFSET[1]]
    }
    /// World positions of every land sample, for brute-force distances.
    fn land(t: &Terrain) -> Vec<[f64; 2]> {
        let f = t.field.as_ref().unwrap();
        let mut out = vec![];
        for j in 0..f.rows {
            for i in 0..f.columns {
                if f.sample_is_land(i, j) {
                    out.push([
                        f.origin_x + i as f64 * f.cell + t.offset[0],
                        f.origin_z + j as f64 * f.cell + t.offset[1],
                    ]);
                }
            }
        }
        out
    }
    fn nearest(land: &[[f64; 2]], p: [f64; 2]) -> f64 {
        land.iter()
            .map(|s| (s[0] - p[0]).hypot(s[1] - p[1]))
            .fold(f64::INFINITY, f64::min)
    }
    struct Random(u64);
    impl Random {
        fn next(&mut self) -> f64 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            (self.0 >> 11) as f64 / (1u64 << 53) as f64
        }
        fn between(&mut self, low: f64, high: f64) -> f64 {
            low + (high - low) * self.next()
        }
    }
    /// The stepped algorithms without the pyramid: what the pruned queries must
    /// reproduce bit for bit.
    fn stepped_first_hit(t: &Terrain, from: [f64; 3], to: [f64; 3]) -> Option<(f64, [f64; 3])> {
        t.field.as_ref()?;
        let point = |s: f64| {
            [
                from[0] + (to[0] - from[0]) * s,
                from[1] + (to[1] - from[1]) * s,
                from[2] + (to[2] - from[2]) * s,
            ]
        };
        let solid = |p: [f64; 3]| p[1] <= t.height(p[0], p[2]);
        let steps = ((to[0] - from[0]).hypot(to[2] - from[2]) / 20.0)
            .ceil()
            .max(1.0) as usize;
        if solid(from) {
            return Some((0.0, from));
        }
        for i in 1..=steps {
            if solid(point(i as f64 / steps as f64)) {
                let (mut a, mut b) = ((i - 1) as f64 / steps as f64, i as f64 / steps as f64);
                for _ in 0..16 {
                    let mid = (a + b) / 2.0;
                    if solid(point(mid)) {
                        b = mid;
                    } else {
                        a = mid;
                    }
                }
                return Some((b, point(b)));
            }
        }
        None
    }
    fn stepped_visible(t: &Terrain, from: [f64; 3], to: [f64; 3]) -> bool {
        if t.field.is_none() {
            return true;
        }
        let distance = (to[0] - from[0]).hypot(to[2] - from[2]);
        let steps = ((distance / 20.0).ceil() as usize).max(1);
        (0..=steps).all(|i| {
            let s = i as f64 / steps as f64;
            let y = from[1] + (to[1] - from[1]) * s
                - distance * distance * s * (1.0 - s) / (2.0 * 6_371_000.0);
            t.height(
                from[0] + (to[0] - from[0]) * s,
                from[2] + (to[2] - from[2]) * s,
            ) <= y
        })
    }

    #[test]
    fn open_sea_answers_every_query_with_water() {
        let sea = Terrain::open_sea();
        assert_eq!(sea.clearance(0.0, 0.0), f64::INFINITY);
        assert_eq!(sea.escape(0.0, 0.0), [0.0, 0.0]);
        assert!(sea.segment_clear([0.0, 0.0], [1e5, 0.0], 1e4));
        assert_eq!(
            sea.plan_path([0.0, 0.0], [5.0, 5.0], 300.0),
            Some(vec![[5.0, 5.0]])
        );
        assert_eq!(sea.first_hit([0.0, -500.0, 0.0], [10.0, -900.0, 0.0]), None);
        assert!(sea.line_visible([0.0, 0.0, 0.0], [1e5, 0.0, 0.0]));
        assert_eq!(sea.highest(-1e5, -1e5, 1e5, 1e5), OPEN_SEA_M);
    }

    #[test]
    fn the_relief_pyramid_bounds_every_height_in_a_rectangle() {
        let t = fixture();
        let mut r = Random(7);
        for _ in 0..20000 {
            let (x, z) = (r.between(-3400.0, 3600.0), r.between(-3600.0, 3200.0));
            let (w, h) = (r.between(0.0, 400.0).powi(2) / 40.0, r.between(0.0, 60.0));
            let top = t.highest(x - w, z - h, x + w, z + h);
            for _ in 0..4 {
                let (px, pz) = (r.between(x - w, x + w), r.between(z - h, z + h));
                assert!(t.height(px, pz) <= top, "({px}, {pz}) above {top}");
            }
        }
        // Beyond the chart the sea floor is all there is.
        assert_eq!(t.highest(5000.0, 5000.0, 6000.0, 6000.0), OPEN_SEA_M);
    }

    #[test]
    fn clearance_is_exact_at_nodes_and_a_lower_bound_between_them() {
        let t = fixture();
        let land = land(&t);
        let f = t.field.as_ref().unwrap();
        let grid = f.clearance_grid();
        for n in (0..grid.width * grid.height).step_by(97) {
            let p = grid.node_position(f, n);
            let exact = nearest(&land, world(p));
            assert!((grid.at_node(f, n) - exact).abs() < 1e-9, "node {n}");
        }
        let diagonal = grid.spacing * std::f64::consts::SQRT_2;
        let mut r = Random(11);
        let mut errors = vec![];
        for _ in 0..3000 {
            let p = [r.between(-3500.0, 3700.0), r.between(-3700.0, 3300.0)];
            let (bound, exact) = (t.clearance(p[0], p[1]), nearest(&land, p));
            assert!(bound <= exact + 1e-9, "{p:?}: {bound} over {exact}");
            // The error bounds hold on the chart; beyond it only the distance to
            // the chart's edge is promised.
            let chart = [p[0] - OFFSET[0], p[1] - OFFSET[1]];
            if chart.iter().all(|c| c.abs() <= 3000.0) {
                assert!(
                    exact - bound <= diagonal + 1e-9,
                    "{p:?}: {bound} under {exact}"
                );
                // Near land (within three node spacings of the corners' own
                // nearest samples) the local scan makes it exact.
                if exact < 3.0 * grid.spacing - diagonal {
                    assert!(
                        (exact - bound).abs() < 1e-9,
                        "{p:?}: {bound} is not {exact}"
                    );
                }
                errors.push(exact - bound);
            }
        }
        // The union of the corners' free disks is far tighter than its worst case.
        errors.sort_by(f64::total_cmp);
        let p95 = errors[errors.len() * 95 / 100];
        assert!(p95 < 20.0, "95th percentile error {p95} m");
    }

    #[test]
    fn escape_points_away_from_the_nearest_coast() {
        let t = fixture();
        let centre = world([-800.0, 0.0]);
        for k in 0..64 {
            let angle = k as f64 * std::f64::consts::TAU / 64.0;
            for reach in [650.0, 800.0, 950.0] {
                let p = [
                    centre[0] + reach * angle.cos(),
                    centre[1] + reach * angle.sin(),
                ];
                let away = t.escape(p[0], p[1]);
                assert!((away[0].hypot(away[1]) - 1.0).abs() < 1e-9);
                let radial = away[0] * angle.cos() + away[1] * angle.sin();
                assert!(radial > 0.95, "{p:?} escapes along {away:?}");
            }
        }
    }

    #[test]
    fn segment_clear_never_passes_a_segment_that_comes_inside_the_margin() {
        let t = fixture();
        let land = land(&t);
        let mut r = Random(23);
        let (mut passed, mut refused) = (0, 0);
        for _ in 0..600 {
            let a = [r.between(-3000.0, 3000.0), r.between(-3000.0, 3000.0)];
            let (angle, length) = (r.between(0.0, 6.3), r.between(0.0, 1500.0));
            let b = [a[0] + length * angle.cos(), a[1] + length * angle.sin()];
            let margin = r.between(0.0, 400.0);
            if t.segment_clear(a, b, margin) {
                passed += 1;
                let steps = (length / 5.0).ceil().max(1.0) as usize;
                for i in 0..=steps {
                    let s = i as f64 / steps as f64;
                    let p = [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s];
                    assert!(
                        nearest(&land, p) >= margin,
                        "{a:?}..{b:?} at {p:?} within {margin}"
                    );
                }
            } else {
                refused += 1;
            }
        }
        assert!(
            passed > 100 && refused > 100,
            "{passed} passed, {refused} refused"
        );
        let (west, east) = (world([-2000.0, 0.0]), world([1600.0, 0.0]));
        assert!(!t.segment_clear(west, east, 0.0), "the island lies between");
        assert!(t.segment_clear(world([-2000.0, 2000.0]), world([2000.0, 2000.0]), 300.0));
    }

    #[test]
    fn first_hit_and_line_visible_reproduce_the_stepped_rays_exactly() {
        let t = fixture();
        let mut r = Random(31);
        let (mut hits, mut blocked) = (0, 0);
        for _ in 0..6000 {
            let from = [
                r.between(-3200.0, 3500.0),
                r.between(-80.0, 420.0),
                r.between(-3500.0, 3200.0),
            ];
            let (angle, length) = (r.between(0.0, 6.3), r.between(0.0, 3000.0).powi(2) / 3000.0);
            let to = [
                from[0] + length * angle.cos(),
                r.between(-80.0, 420.0),
                from[2] + length * angle.sin(),
            ];
            let hit = t.first_hit(from, to);
            assert_eq!(hit, stepped_first_hit(&t, from, to), "{from:?} to {to:?}");
            hits += hit.is_some() as usize;
            let visible = t.line_visible(from, to);
            assert_eq!(visible, stepped_visible(&t, from, to), "{from:?} to {to:?}");
            blocked += !visible as usize;
        }
        assert!(
            hits > 300 && blocked > 300,
            "{hits} hits, {blocked} blocked"
        );
        // A shell ending in the island's slope stops on it; one over the sea flies on.
        let centre = world([-800.0, 0.0]);
        let (s, p) = t
            .first_hit(
                [centre[0] - 900.0, 40.0, centre[1]],
                [centre[0], 40.0, centre[1]],
            )
            .unwrap();
        assert!(s > 0.0 && s < 1.0 && t.height(p[0], p[2]) >= p[1] - 1e-3);
        assert!(
            t.first_hit(
                [centre[0] - 900.0, 400.0, centre[1]],
                [centre[0], 350.0, centre[1]]
            )
            .is_none()
        );
    }

    #[test]
    fn plan_path_detours_the_island_and_refuses_the_lagoon() {
        let t = fixture();
        let margin = 207.5;
        let (from, to) = (world([-2200.0, 0.0]), world([600.0, 100.0]));
        let path = t
            .plan_path(from, to, margin)
            .expect("a way round the island");
        assert!(path.len() > 1, "the direct leg crosses the island");
        assert_eq!(*path.last().unwrap(), to);
        let mut at = from;
        for p in &path {
            assert!(t.segment_clear(at, *p, margin), "leg {at:?} -> {p:?}");
            at = *p;
        }
        assert_eq!(t.plan_path(from, to, margin), Some(path), "deterministic");
        // The lagoon has no way in, and an end inside the margin has no plan.
        assert_eq!(t.plan_path(from, world([1000.0, -1400.0]), 100.0), None);
        assert_eq!(t.plan_path(world([-1250.0, 0.0]), to, margin), None);
        assert_eq!(t.plan_path(from, from, margin), Some(vec![from]));
    }
}
