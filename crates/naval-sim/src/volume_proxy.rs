//! Moment-preserving weighted boxes for runtime hydrostatic geometry.
//! Definitions, rendering, collision and watertight topology retain their original shapes.
use crate::{
    construction_geometry::{self as cg, Moments},
    definition::CompartmentCellsItem,
};

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

pub(crate) fn boxes(volumes: &[cg::Cell], budget: usize) -> Option<Vec<CompartmentCellsItem>> {
    if volumes.is_empty() || budget == 0 {
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
    let mut cells = Vec::with_capacity(budget);
    partition(pieces, budget, &mut cells);
    Some(cells)
}
