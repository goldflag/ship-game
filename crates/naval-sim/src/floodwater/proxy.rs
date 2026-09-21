//! Bounded hydraulic geometry for fragmented construction rooms.
//!
//! Authoring and impact geometry retain their exact solids. The water model
//! groups nearby pieces into weighted boxes with the same total capacity,
//! centroid and diagonal second moments. Partial fills deliberately approximate
//! small obstructions inside one room; room boundaries and connections remain.
use crate::{
    construction_geometry::{self as cg, Moments},
    definition::{Compartment, CompartmentCellsItem},
};

pub(super) const MAX_CELLS: usize = 64;

struct Piece {
    shape: cg::Cell,
    moments: Moments,
    low: [f64; 3],
    high: [f64; 3],
}
impl Piece {
    fn new(shape: cg::Cell) -> Self {
        let moments = cg::moments(&shape);
        let (mut low, mut high) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
        for p in shape.faces.iter().flat_map(|f| &f.vertices) {
            for i in 0..3 {
                low[i] = low[i].min(p[i]);
                high[i] = high[i].max(p[i]);
            }
        }
        Self {
            shape,
            moments,
            low,
            high,
        }
    }
}

fn total(pieces: &[Piece]) -> Moments {
    pieces.iter().fold(Moments::default(), |mut m, p| {
        m.add(p.moments);
        m
    })
}

fn partition(pieces: Vec<Piece>, budget: usize, cells: &mut Vec<CompartmentCellsItem>) {
    let moments = total(&pieces);
    let center = moments.first.map(|v| v / moments.volume);
    let variance: [f64; 3] = std::array::from_fn(|i| {
        (moments.second[i] / moments.volume - center[i] * center[i]).max(1e-12)
    });
    let low: [f64; 3] = std::array::from_fn(|i| {
        pieces
            .iter()
            .map(|p| p.low[i])
            .fold(f64::INFINITY, f64::min)
    });
    let high: [f64; 3] = std::array::from_fn(|i| {
        pieces
            .iter()
            .map(|p| p.high[i])
            .fold(f64::NEG_INFINITY, f64::max)
    });
    let box_volume = (0..3).map(|i| high[i] - low[i]).product::<f64>();
    // An already rectangular region needs no subdivision. Otherwise split the
    // actual space, including cells crossing the plane, so this model depends
    // on the room's shape rather than incidental CSG fragment centroids.
    if budget == 1 || moments.volume >= box_volume * (1. - 1e-10) {
        cells.push(CompartmentCellsItem {
            center,
            size: variance.map(|v| (12. * v).sqrt()),
            volume_m3: Some(moments.volume),
        });
        return;
    }
    let axis = (0..3)
        .max_by(|&a, &b| variance[a].total_cmp(&variance[b]))
        .unwrap();
    let mut normal = [0.; 3];
    normal[axis] = 1.;
    let (mut left, mut right) = (Vec::new(), Vec::new());
    for piece in pieces {
        if piece.high[axis] <= center[axis] {
            left.push(piece);
        } else if piece.low[axis] >= center[axis] {
            right.push(piece);
        } else {
            for (sign, side) in [(1., &mut left), (-1., &mut right)] {
                if let Some(shape) =
                    cg::clip(&piece.shape, normal.map(|v| v * sign), center[axis] * sign)
                {
                    let part = Piece::new(shape);
                    if part.moments.volume > 0. {
                        side.push(part);
                    }
                }
            }
        }
    }
    if left.is_empty() || right.is_empty() {
        cells.push(CompartmentCellsItem {
            center,
            size: variance.map(|v| (12. * v).sqrt()),
            volume_m3: Some(moments.volume),
        });
    } else {
        partition(left, budget / 2, cells);
        partition(right, budget - budget / 2, cells);
    }
}

pub(super) fn compact(room: &Compartment) -> Option<Compartment> {
    let volumes = room.volumes.as_ref()?;
    if volumes.is_empty() {
        return None;
    }
    let pieces: Vec<_> = volumes.iter().cloned().map(Piece::new).collect();
    if pieces.iter().any(|p| {
        let m = p.moments;
        !m.volume.is_finite()
            || m.volume <= 0.
            || m.first.iter().chain(&m.second).any(|x| !x.is_finite())
    }) {
        return None;
    }
    let mut cells = Vec::with_capacity(MAX_CELLS);
    partition(pieces, MAX_CELLS, &mut cells);
    Some(Compartment {
        capacity_m3: room.capacity_m3,
        center: room.center,
        size: room.size,
        cells: Some(cells),
        ..Default::default()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::floodwater::water_body;

    fn room() -> Compartment {
        let cells: Vec<_> = (0..16)
            .flat_map(|x| {
                (0..8).map(move |z| {
                    cg::box_cell([x as f64 * 0.5 - 3.75, -2., z as f64 - 3.5], [0.5, 4., 1.])
                })
            })
            .collect();
        Compartment {
            capacity_m3: cg::total(&cells).volume,
            center: [0., -2., 0.],
            size: [8., 4., 8.],
            volumes: Some(cells),
            ..Default::default()
        }
    }

    #[test]
    fn bounded_model_preserves_capacity_full_center_and_inertia() {
        let room = room();
        let proxy = compact(&room).unwrap();
        assert!(proxy.cells.as_ref().unwrap().len() <= MAX_CELLS);
        assert_eq!(proxy.capacity_m3, room.capacity_m3);
        let exact = cg::total(room.volumes.as_ref().unwrap());
        for (roll, pitch) in [(0., 0.), (0.7, -0.2), (3.1, 0.4)] {
            let body = water_body(&proxy, proxy.capacity_m3, roll, pitch);
            for i in 0..3 {
                assert!((body.center[i] - exact.center()[i]).abs() < 1e-9);
                assert!((body.inertia_m3([0.; 3])[i] - exact.inertia(1., [0.; 3])[i]).abs() < 1e-7);
            }
        }
    }

    #[test]
    fn upright_rectangular_room_keeps_partial_fill_level_and_center() {
        let room = room();
        let proxy = compact(&room).unwrap();
        let mut previous = f64::NEG_INFINITY;
        for i in 0..=100 {
            let fraction = i as f64 / 100.;
            let water = water_body(&proxy, room.capacity_m3 * fraction, 0., 0.);
            assert!(water.level >= previous);
            assert!((water.level - (-4. + 4. * fraction)).abs() < 1e-8);
            if i > 0 {
                assert!((water.center[1] - (-4. + 2. * fraction)).abs() < 1e-8);
                assert!(water.center[0].abs() < 1e-9 && water.center[2].abs() < 1e-9);
            }
            previous = water.level;
        }
    }

    #[test]
    fn fragment_subdivision_does_not_change_the_hydraulic_shape() {
        let shape = cg::clip(&cg::box_cell([0.; 3], [8., 4., 16.]), [0.6, 0.8, 0.], 1.).unwrap();
        let whole = Compartment {
            capacity_m3: cg::moments(&shape).volume,
            size: [8., 4., 16.],
            volumes: Some(vec![shape.clone()]),
            ..Default::default()
        };
        let pieces = (-4..4)
            .filter_map(|i| {
                let cell = cg::clip(&shape, [0., 0., 1.], (i + 1) as f64 * 2.)?;
                cg::clip(&cell, [0., 0., -1.], -(i as f64) * 2.)
            })
            .collect();
        let divided = Compartment {
            volumes: Some(pieces),
            ..whole.clone()
        };
        let a = compact(&whole).unwrap();
        let b = compact(&divided).unwrap();
        for (roll, pitch) in [(0., 0.), (0.23, 0.07), (2.7, -0.2)] {
            for fill in [0.001, 0.01, 0.1, 0.5, 0.9, 1.] {
                let a = water_body(&a, a.capacity_m3 * fill, roll, pitch);
                let b = water_body(&b, b.capacity_m3 * fill, roll, pitch);
                assert!((a.level - b.level).abs() < 1e-6);
                for i in 0..3 {
                    assert!((a.center[i] - b.center[i]).abs() < 1e-6);
                }
            }
        }
    }
}
