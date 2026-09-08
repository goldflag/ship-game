use crate::{
    definition::{Compartment, Vec3},
    geometry::dot,
};
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WaterBody {
    pub volume: f64,
    pub level: f64,
    pub area: f64,
    pub center: Vec3,
    pub roll: f64,
    pub pitch: f64,
    #[serde(skip)]
    shape: WaterGeometry,
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
#[derive(Clone, Debug)]
struct WaterGeometry {
    axis: usize,
    sign: f64,
    columns: Vec<Column>,
    surface: Vec<Surface>,
}
fn geometry(room: &Compartment, roll: f64, pitch: f64) -> WaterGeometry {
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
    let other: Vec<_> = (0..3).filter(|i| *i != axis).collect();
    let cells: Vec<(Vec3, Vec3)> = if let Some(cells) = &room.cells {
        cells.iter().map(|c| (c.center, c.size)).collect()
    } else {
        vec![(room.center, room.size)]
    };
    let gross: f64 = cells.iter().map(|(_, s)| s[0] * s[1] * s[2]).sum();
    let porosity = room.capacity_m3 / gross;
    let mut columns = Vec::new();
    let mut events = Vec::<(f64, f64)>::new();
    for (center, size) in cells {
        let divisions: Vec<_> = other
            .iter()
            .map(|i| {
                if normal[*i].abs() < 1e-12 {
                    1
                } else if room.cells.is_some() {
                    (size[*i] / 2.5).ceil().clamp(1.0, 4.0) as usize
                } else {
                    4
                }
            })
            .collect();
        let (a, b) = (divisions[0], divisions[1]);
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
    let mut surface = Vec::new();
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
    WaterGeometry {
        axis,
        sign: normal[axis].signum(),
        columns,
        surface,
    }
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
    pub fn level_at_volume(&self, volume: f64) -> f64 {
        if volume == self.volume {
            self.level
        } else {
            surface_at(&self.shape.surface, volume).0
        }
    }
}
pub fn water_body(room: &Compartment, volume: f64, roll: f64, pitch: f64) -> WaterBody {
    let volume = volume.clamp(0.0, room.capacity_m3);
    let shape = geometry(room, roll, pitch);
    let (level, mut area) = surface_at(&shape.surface, volume);
    let (mut center, mut measured) = ([0.0; 3], 0.0);
    if volume == 0.0 {
        center = room.center;
        area = room.capacity_m3 / (shape.surface.last().unwrap().level - shape.surface[0].level);
    } else {
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
    }
    WaterBody {
        volume,
        roll,
        pitch,
        level,
        area,
        center,
        shape,
    }
}
