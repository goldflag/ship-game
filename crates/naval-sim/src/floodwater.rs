use crate::{
    definition::{Compartment, Vec3},
    geometry::dot,
};
use std::sync::OnceLock;
#[derive(Clone, Debug, serde::Serialize)]
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
}
#[derive(Clone, Debug)]
struct Column {
    center: Vec3,
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
        gross += s[0] * s[1] * s[2];
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
                let volume = size[0] * size[1] * size[2] * porosity / (a * b) as f64;
                let area = volume / (high - low);
                columns.push(Column {
                    center: c,
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
    body.volume = volume;
    body.roll = roll;
    body.pitch = pitch;
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
