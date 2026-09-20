use crate::{
    definition::{Compartment, Vec3},
    geometry::dot,
};
use std::{cell::RefCell, sync::OnceLock};
#[derive(Clone, Debug, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct WaterBody {
    pub volume: f64,
    pub level: f64,
    pub area: f64,
    pub center: Vec3,
    pub roll: f64,
    pub pitch: f64,
    /// Empty for a dry compartment until a connection asks for the level at a
    /// non-zero volume; never serialized, so snapshots do not see the cache.
    #[serde(skip)]
    shape: OnceLock<WaterGeometry>,
    #[serde(skip)]
    exact_moments: Option<crate::construction_geometry::Moments>,
    /// Constructed rooms: immutable moments of each cell in ship coordinates.
    /// Kept across attitude changes; only partial-cell moments depend on water.
    #[serde(skip)]
    full_moments: OnceLock<Vec<crate::construction_geometry::Moments>>,
    /// Constructed rooms: each cell's span along this attitude, paired with its
    /// cached full moments. Shared until the attitude changes.
    #[serde(skip)]
    oriented: OnceLock<Vec<OrientedCell>>,
    /// Constructed rooms: volume against level at this attitude, filled in where
    /// queries land. Flooding asks for a room's level at a slightly different
    /// fill for every module, opening and portal, every tick; never serialized.
    #[serde(skip)]
    levels: RefCell<Option<LevelTable>>,
    /// Constructed rooms: a sphere around each cell, which no attitude changes.
    /// Every refresh needs the room's floor and ceiling along the new water
    /// normal, and only cells that can reach past the running extremes are read.
    #[serde(skip)]
    spheres: OnceLock<Vec<(Vec3, f64)>>,
}
#[derive(Clone, Copy, Debug)]
struct OrientedCell {
    bottom: f64,
    top: f64,
    full: crate::construction_geometry::Moments,
}
#[derive(Clone, Debug)]
struct Column {
    center: Vec3,
    size: Vec3,
    low: f64,
    high: f64,
    volume: f64,
    extent: f64,
}
#[derive(Clone, Debug)]
struct Surface {
    level: f64,
    volume: f64,
    area: f64,
}
#[derive(Clone, Debug, Default)]
struct WaterGeometry {
    axis: usize,
    sign: f64,
    columns: Vec<Column>,
    surface: Vec<Surface>,
}
/// Per-ship buffers reused across compartments and rebuilds; never serialized.
#[derive(Clone, Debug, Default)]
pub struct Scratch {
    events: Vec<(f64, f64)>,
}
fn orientation(roll: f64, pitch: f64) -> ([f64; 3], usize) {
    let normal = [
        roll.sin() * pitch.cos(),
        roll.cos() * pitch.cos(),
        -pitch.sin(),
    ];
    let mut axis = 0;
    for i in 1..3 {
        if normal[i].abs() > normal[axis].abs() {
            axis = i;
        }
    }
    (normal, axis)
}
fn other_axes(axis: usize) -> [usize; 2] {
    match axis {
        0 => [1, 2],
        1 => [0, 2],
        _ => [0, 1],
    }
}
fn cell_count(room: &Compartment) -> usize {
    room.cells.as_ref().map_or(1, |c| c.len())
}
fn cell(room: &Compartment, i: usize) -> (Vec3, Vec3) {
    match &room.cells {
        Some(cells) => (cells[i].center, cells[i].size),
        None => (room.center, room.size),
    }
}
fn cell_volume(room: &Compartment, i: usize, size: Vec3) -> f64 {
    room.cells
        .as_ref()
        .and_then(|c| c[i].volume_m3)
        .unwrap_or(size[0] * size[1] * size[2])
}
fn divisions(room: &Compartment, size: Vec3, normal: [f64; 3], other: [usize; 2]) -> [usize; 2] {
    std::array::from_fn(|k| {
        let i = other[k];
        if normal[i].abs() < 1e-12 {
            1
        } else if room.cells.is_some() {
            (size[i] / 2.5).ceil().clamp(1.0, 4.0) as usize
        } else {
            4
        }
    })
}
fn geometry(
    dst: &mut WaterGeometry,
    room: &Compartment,
    roll: f64,
    pitch: f64,
    work: &mut Scratch,
) {
    let (normal, axis) = orientation(roll, pitch);
    let other = other_axes(axis);
    let count = cell_count(room);
    let mut gross = 0.0;
    for k in 0..count {
        let (_, s) = cell(room, k);
        gross += cell_volume(room, k, s);
    }
    let porosity = room.capacity_m3 / gross;
    let columns = &mut dst.columns;
    let events = &mut work.events;
    columns.clear();
    events.clear();
    for k in 0..count {
        let (center, size) = cell(room, k);
        let (a, b) = {
            let d = divisions(room, size, normal, other);
            (d[0], d[1])
        };
        for i in 0..a {
            for j in 0..b {
                let mut c = center;
                c[other[0]] += ((i as f64 + 0.5) / a as f64 - 0.5) * size[other[0]];
                c[other[1]] += ((j as f64 + 0.5) / b as f64 - 0.5) * size[other[1]];
                let y = dot(c, normal);
                let extent = size[axis];
                let half = normal[axis].abs() * extent / 2.0;
                let (low, high) = (y - half, y + half);
                let volume = cell_volume(room, k, size) * porosity / (a * b) as f64;
                let area = volume / (high - low);
                let mut column_size = size;
                column_size[other[0]] /= a as f64;
                column_size[other[1]] /= b as f64;
                columns.push(Column {
                    center: c,
                    size: column_size,
                    low,
                    high,
                    extent,
                    volume,
                });
                events.push((low, area));
                events.push((high, -area));
            }
        }
    }
    events.sort_by(|a, b| a.0.total_cmp(&b.0));
    let surface = &mut dst.surface;
    surface.clear();
    let (mut volume, mut area, mut previous, mut i) = (0.0, 0.0, events[0].0, 0);
    while i < events.len() {
        let level = events[i].0;
        volume += area * (level - previous);
        loop {
            area += events[i].1;
            i += 1;
            if i >= events.len() || events[i].0 != level {
                break;
            }
        }
        area = area.max(0.0);
        surface.push(Surface {
            level,
            volume,
            area,
        });
        previous = level;
    }
    surface.last_mut().unwrap().volume = room.capacity_m3;
    dst.axis = axis;
    dst.sign = normal[axis].signum();
}
/// The two values an empty compartment needs: `surface[0].level` and
/// `surface.last().level`. Every column spans `low < high`, so those are the
/// minimum `low` and the maximum `high` over exactly the floats the full build
/// computes, and taking a min or a max never rounds.
fn dry_bounds(room: &Compartment, roll: f64, pitch: f64) -> (f64, f64) {
    let (normal, axis) = orientation(roll, pitch);
    let other = other_axes(axis);
    let (mut lowest, mut highest) = (f64::INFINITY, f64::NEG_INFINITY);
    for k in 0..cell_count(room) {
        let (center, size) = cell(room, k);
        let (a, b) = {
            let d = divisions(room, size, normal, other);
            (d[0], d[1])
        };
        let half = normal[axis].abs() * size[axis] / 2.0;
        for i in 0..a {
            for j in 0..b {
                let mut c = center;
                c[other[0]] += ((i as f64 + 0.5) / a as f64 - 0.5) * size[other[0]];
                c[other[1]] += ((j as f64 + 0.5) / b as f64 - 0.5) * size[other[1]];
                let y = dot(c, normal);
                lowest = lowest.min(y - half);
                highest = highest.max(y + half);
            }
        }
    }
    (lowest, highest)
}
fn surface_at(surface: &[Surface], volume: f64) -> (f64, f64) {
    if volume <= 0.0 {
        return (surface[0].level, surface[0].area);
    }
    let last = surface.last().unwrap();
    if volume >= last.volume {
        return (last.level, 0.0);
    }
    let (mut low, mut high) = (1, surface.len() - 1);
    while low < high {
        let mid = (low + high) >> 1;
        if surface[mid].volume < volume {
            low = mid + 1;
        } else {
            high = mid;
        }
    }
    let start = &surface[low - 1];
    (
        start.level + (volume - start.volume) / start.area,
        start.area,
    )
}
impl WaterBody {
    /// A body whose fields are all sentinel: `refresh` always rebuilds it.
    fn pending() -> Self {
        Self {
            volume: f64::NAN,
            level: f64::NAN,
            area: f64::NAN,
            center: [f64::NAN; 3],
            roll: f64::NAN,
            pitch: f64::NAN,
            shape: OnceLock::new(),
            exact_moments: None,
            full_moments: OnceLock::new(),
            oriented: OnceLock::new(),
            levels: RefCell::new(None),
            spheres: OnceLock::new(),
        }
    }
    fn shape(&self, room: &Compartment) -> &WaterGeometry {
        self.shape.get_or_init(|| {
            let mut built = WaterGeometry::default();
            geometry(
                &mut built,
                room,
                self.roll,
                self.pitch,
                &mut Scratch::default(),
            );
            built
        })
    }
    pub fn level_at_volume(&self, room: &Compartment, volume: f64) -> f64 {
        if room.volumes.is_some() && volume != self.volume {
            return ExactRoom::new(
                room,
                self.roll,
                self.pitch,
                &self.oriented,
                &self.levels,
                &self.spheres,
                &self.full_moments,
            )
            .level(volume);
        }
        if volume == self.volume {
            self.level
        } else {
            surface_at(&self.shape(room).surface, volume).0
        }
    }
}
/// Rebuild `body` in place for the given fill and attitude, keeping the
/// previous geometry's allocations. Unchanged inputs leave it untouched:
/// `geometry` depends only on the compartment and the attitude, and the fill is
/// applied afterwards.
pub fn refresh(
    body: &mut WaterBody,
    room: &Compartment,
    volume: f64,
    roll: f64,
    pitch: f64,
    work: &mut Scratch,
) {
    let volume = volume.clamp(0.0, room.capacity_m3);
    if body.volume == volume && body.roll == roll && body.pitch == pitch {
        return;
    }
    if body.roll != roll || body.pitch != pitch {
        body.oriented = OnceLock::new();
        *body.levels.get_mut() = None;
    }
    body.volume = volume;
    body.roll = roll;
    body.pitch = pitch;
    if room.volumes.is_some() {
        let (level, area, center, moments) = ExactRoom::new(
            room,
            roll,
            pitch,
            &body.oriented,
            &body.levels,
            &body.spheres,
            &body.full_moments,
        )
        .water(volume);
        body.exact_moments = Some(moments);
        body.level = level;
        body.area = area;
        body.center = center;
        return;
    }
    let mut shape = body.shape.take().unwrap_or_default();
    if volume == 0.0 {
        let (lowest, highest) = dry_bounds(room, roll, pitch);
        body.level = lowest;
        body.area = room.capacity_m3 / (highest - lowest);
        body.center = room.center;
        return;
    }
    geometry(&mut shape, room, roll, pitch, work);
    let (level, area) = surface_at(&shape.surface, volume);
    let (mut center, mut measured) = ([0.0; 3], 0.0);
    for c in &shape.columns {
        let fraction = ((level - c.low) / (c.high - c.low)).clamp(0.0, 1.0);
        let water = fraction * c.volume;
        for (i, coordinate) in center.iter_mut().enumerate() {
            *coordinate += (c.center[i]
                - if i == shape.axis {
                    shape.sign * c.extent * (1.0 - fraction) / 2.0
                } else {
                    0.0
                })
                * water;
        }
        measured += water;
    }
    if measured > 0.0 {
        for c in &mut center {
            *c /= measured;
        }
    } else {
        center = room.center;
    }
    body.level = level;
    body.area = area;
    body.center = center;
    let _ = body.shape.set(shape);
}
pub fn water_body_with(
    room: &Compartment,
    volume: f64,
    roll: f64,
    pitch: f64,
    work: &mut Scratch,
) -> WaterBody {
    let mut body = WaterBody::pending();
    refresh(&mut body, room, volume, roll, pitch, work);
    body
}
pub fn water_body(room: &Compartment, volume: f64, roll: f64, pitch: f64) -> WaterBody {
    water_body_with(room, volume, roll, pitch, &mut Scratch::default())
}
impl WaterBody {
    /// Water inertia about a ship-local origin: exact clipped moments for
    /// constructed rooms, weighted column moments for legacy/experimental rooms.
    pub fn inertia_m3(&self, origin: Vec3) -> Vec3 {
        if let Some(m) = self.exact_moments {
            let second: Vec3 = std::array::from_fn(|i| {
                (m.second[i] - 2. * origin[i] * m.first[i] + origin[i] * origin[i] * m.volume)
                    .max(0.)
            });
            return [
                second[1] + second[2],
                second[0] + second[2],
                second[0] + second[1],
            ];
        }
        let Some(shape) = self.shape.get() else {
            // Mixed experimental profiles may retain an exact water volume.
            // Its center still contributes point-mass inertia; only intrinsic
            // water inertia is unavailable without the column geometry.
            let d: Vec3 = std::array::from_fn(|i| self.center[i] - origin[i]);
            return [
                d[1] * d[1] + d[2] * d[2],
                d[0] * d[0] + d[2] * d[2],
                d[0] * d[0] + d[1] * d[1],
            ]
            .map(|v| v * self.volume.max(0.));
        };
        let mut second = [0.; 3];
        for c in &shape.columns {
            let fraction = ((self.level - c.low) / (c.high - c.low)).clamp(0., 1.);
            let mut center = c.center;
            let mut size = c.size;
            center[shape.axis] -= shape.sign * c.extent * (1. - fraction) * 0.5;
            size[shape.axis] *= fraction;
            for a in 0..3 {
                second[a] += c.volume
                    * fraction
                    * ((center[a] - origin[a]).powi(2) + size[a] * size[a] / 12.);
            }
        }
        [
            second[1] + second[2],
            second[0] + second[2],
            second[0] + second[1],
        ]
    }
}
/// Volume under a plane rising through a room's convex cells is one cubic
/// between consecutive vertex heights: every cross-section edge moves linearly
/// until the plane passes a vertex. So a level query is a search over those
/// heights for the interval holding the volume, then the root of that
/// interval's cubic, fitted through four exact clipped volumes. Both are kept,
/// and a room's fill moves little from tick to tick, so after the first query
/// at an attitude most answers cost no clipping at all.
#[derive(Clone, Debug)]
struct LevelTable {
    /// Distinct vertex heights along the water normal, ascending.
    heights: Vec<f64>,
    /// Exact volume under each height; NaN until a search needs it.
    volumes: Vec<f64>,
    /// Fitted intervals by lower height index: volumes at 0, 1/3, 2/3 and 1.
    cubics: Vec<(usize, [f64; 4])>,
}
/// Below this an interval is narrower than the clip tolerance can resolve.
const THIN_INTERVAL_M: f64 = 1e-6;
impl LevelTable {
    fn new(cells: &[crate::definition::ConvexVolume], normal: [f64; 3]) -> Self {
        let mut heights: Vec<f64> = cells
            .iter()
            .flat_map(|c| c.faces.iter().flat_map(|f| f.vertices.iter()))
            .map(|p| dot(*p, normal))
            .collect();
        heights.sort_by(f64::total_cmp);
        heights.dedup();
        Self {
            volumes: vec![f64::NAN; heights.len()],
            heights,
            cubics: Vec::new(),
        }
    }
    /// Level holding `volume`, strictly between empty and full. `under` is the
    /// exact clipped volume below a level.
    fn solve(&mut self, volume: f64, capacity: f64, under: impl Fn(f64) -> f64) -> f64 {
        let last = self.heights.len() - 1;
        self.volumes[0] = 0.;
        self.volumes[last] = capacity;
        // `volumes[low] < volume <= volumes[high]` holds throughout.
        let (mut low, mut high) = (0, last);
        while high - low > 1 {
            let mid = (low + high) / 2;
            if self.volumes[mid].is_nan() {
                self.volumes[mid] = under(self.heights[mid]);
            }
            if self.volumes[mid] < volume {
                low = mid;
            } else {
                high = mid;
            }
        }
        let (base, width) = (self.heights[low], self.heights[high] - self.heights[low]);
        let (v0, v3) = (self.volumes[low], self.volumes[high]);
        if width < THIN_INTERVAL_M {
            return base + width * (volume - v0) / (v3 - v0);
        }
        let v = match self.cubics.iter().find(|c| c.0 == low) {
            Some(c) => c.1,
            None => {
                let v = [
                    v0,
                    under(base + width / 3.),
                    under(base + width * 2. / 3.),
                    v3,
                ];
                self.cubics.push((low, v));
                v
            }
        };
        // Newton's forward differences over s = 3t.
        let (d1, d2, d3) = (
            v[1] - v[0],
            v[2] - 2. * v[1] + v[0],
            v[3] - 3. * v[2] + 3. * v[1] - v[0],
        );
        let at = |t: f64| {
            let s = 3. * t;
            v[0] + s * (d1 + (s - 1.) / 2. * (d2 + (s - 2.) / 3. * d3))
        };
        let (mut a, mut b) = (0.0_f64, 1.0_f64);
        for _ in 0..52 {
            let mid = (a + b) * 0.5;
            if at(mid) < volume {
                a = mid;
            } else {
                b = mid;
            }
        }
        base + width * (a + b) * 0.5
    }
}
/// One constructed room at one attitude: the exact clipped-cell integrals behind
/// every level and water-body query.
struct ExactRoom<'a> {
    room: &'a Compartment,
    cells: &'a [crate::definition::ConvexVolume],
    normal: [f64; 3],
    oriented: &'a OnceLock<Vec<OrientedCell>>,
    levels: &'a RefCell<Option<LevelTable>>,
    spheres: &'a OnceLock<Vec<(Vec3, f64)>>,
    full_moments: &'a OnceLock<Vec<crate::construction_geometry::Moments>>,
}
impl<'a> ExactRoom<'a> {
    fn new(
        room: &'a Compartment,
        roll: f64,
        pitch: f64,
        oriented: &'a OnceLock<Vec<OrientedCell>>,
        levels: &'a RefCell<Option<LevelTable>>,
        spheres: &'a OnceLock<Vec<(Vec3, f64)>>,
        full_moments: &'a OnceLock<Vec<crate::construction_geometry::Moments>>,
    ) -> Self {
        Self {
            room,
            cells: room.volumes.as_ref().unwrap(),
            normal: orientation(roll, pitch).0,
            oriented,
            levels,
            spheres,
            full_moments,
        }
    }
    /// Lowest and highest vertex along the water normal: the room's floor and
    /// ceiling at this attitude.
    fn span(&self) -> (f64, f64) {
        if let Some(table) = self.levels.borrow().as_ref() {
            return (table.heights[0], *table.heights.last().unwrap());
        }
        let spheres = self.spheres.get_or_init(|| {
            self.cells
                .iter()
                .map(|c| {
                    let vertices = || c.faces.iter().flat_map(|f| f.vertices.iter().copied());
                    let center = crate::structure::bounds(vertices()).0;
                    let radius = vertices()
                        .map(|v| crate::geometry::length(crate::geometry::sub(v, center)))
                        .fold(0., f64::max);
                    (center, radius)
                })
                .collect()
        });
        // The extremes are the same minimum and maximum over the same heights:
        // a cell is skipped only when its sphere, with room for rounding, lies
        // between extremes already found, so none of its heights could move them.
        let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
        for (cell, (center, radius)) in self.cells.iter().zip(spheres) {
            let (middle, reach) = (dot(*center, self.normal), radius * 1.000001 + 1e-9);
            if middle - reach >= lo && middle + reach <= hi {
                continue;
            }
            for p in cell.faces.iter().flat_map(|f| f.vertices.iter()) {
                let y = dot(*p, self.normal);
                lo = lo.min(y);
                hi = hi.max(y);
            }
        }
        (lo, hi)
    }
    fn full_moments(&self) -> &[crate::construction_geometry::Moments] {
        self.full_moments.get_or_init(|| {
            self.cells
                .iter()
                .map(crate::construction_geometry::moments)
                .collect()
        })
    }
    fn oriented(&self) -> &[OrientedCell] {
        let n = self.normal;
        self.oriented.get_or_init(|| {
            self.cells
                .iter()
                .zip(self.full_moments())
                .map(|(cell, &full)| {
                    let (bottom, top) = cell.faces.iter().flat_map(|f| &f.vertices).fold(
                        (f64::INFINITY, f64::NEG_INFINITY),
                        |(lo, hi), p| {
                            let y = dot(*p, n);
                            (lo.min(y), hi.max(y))
                        },
                    );
                    OrientedCell { bottom, top, full }
                })
                .collect()
        })
    }
    /// Match the full integration's comparisons, cell order and volume sum.
    /// Thirty level probes and the two area probes need no other moments.
    fn submerged_volume(&self, level: f64) -> f64 {
        use crate::construction_geometry::{EPS, clipped_volume};
        let mut volume = 0.;
        for (cell, o) in self.cells.iter().zip(self.oriented()) {
            if o.top - level <= EPS {
                volume += o.full.volume;
            } else if o.bottom - level < -EPS
                && let Some(part) = clipped_volume(cell, self.normal, level)
            {
                volume += part;
            }
        }
        volume
    }
    /// A wholly submerged cell retains its moments for the lifetime of the
    /// body. Only cells crossing the waterline need clipping and integration.
    fn submerged(&self, level: f64) -> crate::construction_geometry::Moments {
        use crate::construction_geometry::{EPS, Moments, clipped_moments};
        let mut total = Moments::default();
        for (cell, o) in self.cells.iter().zip(self.oriented()) {
            // Match clip's comparisons exactly, including epsilon-thin cells.
            if o.top - level <= EPS {
                total.add(o.full);
            } else if o.bottom - level < -EPS
                && let Some(part) = clipped_moments(cell, self.normal, level)
            {
                total.add(part);
            }
        }
        total
    }
    /// Level at a fill strictly between empty and full.
    fn solve(&self, volume: f64) -> f64 {
        let mut levels = self.levels.borrow_mut();
        levels
            .get_or_insert_with(|| LevelTable::new(self.cells, self.normal))
            .solve(volume, self.room.capacity_m3, |level| {
                self.submerged_volume(level)
            })
    }
    fn level(&self, volume: f64) -> f64 {
        let volume = volume.clamp(0., self.room.capacity_m3);
        if volume <= 0. {
            self.span().0
        } else if volume >= self.room.capacity_m3 {
            self.span().1
        } else {
            self.solve(volume)
        }
    }
    /// The body a refresh publishes: level, waterplane area, centre and moments.
    /// This is the reference solve, bit for bit: thirty bisections of the clipped
    /// volume and a finite-difference area. It runs once per wet room per
    /// stability solve; the per-tick queries in between go through `level`.
    fn water(&self, volume: f64) -> (f64, f64, Vec3, crate::construction_geometry::Moments) {
        let volume = volume.clamp(0., self.room.capacity_m3);
        let (mut lo, mut hi) = self.span();
        if volume <= 0. {
            return (lo, 0., self.room.center, Default::default());
        }
        if volume >= self.room.capacity_m3 {
            let mut m = crate::construction_geometry::Moments::default();
            for &full in self.full_moments() {
                m.add(full);
            }
            return (hi, 0., m.center(), m);
        }
        for _ in 0..30 {
            let mid = (lo + hi) * 0.5;
            if self.submerged_volume(mid) < volume {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        let level = (lo + hi) * 0.5;
        let m = self.submerged(level);
        let e = 0.0001;
        let area = (self.submerged_volume(level + e) - self.submerged_volume(level - e)) / (2. * e);
        (level, area.max(0.), m.center(), m)
    }
}
