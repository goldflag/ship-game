//! Editor-only overlap policy. Uses the compiler's actual solids, not display bounds.
//! Loading continues to use the physical union independently of this editing aid.
use crate::{
    construction::primitive_cells,
    construction_geometry as cg,
    definition::{ConstructionPrimitive, Vec3},
    geometry::*,
};
use std::collections::BTreeSet;

pub const MIN_EXPOSED: f64 = 0.1;
const VOLUME_TOL: f64 = 1e-7;
const TRAVEL_TOL: f64 = 1e-6;

struct Piece {
    id: String,
    ballast: bool,
    cells: Vec<cg::Cell>,
    volume: f64,
}
pub struct OverlapScene {
    pieces: Vec<Piece>,
    index: cg::Broadphase,
    owners: Vec<usize>,
}

fn shifted(cell: &cg::Cell, delta: Vec3) -> cg::Cell {
    cg::transform(cell, delta, [1.; 3], 0.)
}
fn extent(cell: &cg::Cell, a: Vec3, b: Vec3) -> (Vec3, Vec3) {
    let (center, size) = cg::bounds(cell);
    (
        std::array::from_fn(|k| center[k] - size[k] / 2. + a[k].min(b[k])),
        std::array::from_fn(|k| center[k] + size[k] / 2. + a[k].max(b[k])),
    )
}
/// Conservative swept polyhedron. Relax every supporting plane over the interval.
/// It encloses every intermediate pose and converges to the exact cell on subdivision.
fn swept(cell: &cg::Cell, a: Vec3, b: Vec3) -> cg::Cell {
    if length(sub(a, b)) < 1e-12 {
        return shifted(cell, a);
    }
    let (lo, hi) = extent(cell, a, b);
    let mut out = cg::box_cell(scale(add(lo, hi), 0.5), sub(hi, lo));
    for f in cell.faces.iter() {
        let n = cg::normal(&f.vertices);
        out = cg::clip(&out, n, dot(n, f.vertices[0]) + dot(n, a).max(dot(n, b))).unwrap_or(out);
    }
    out
}
impl OverlapScene {
    pub fn new(primitives: &[ConstructionPrimitive]) -> Result<Self, String> {
        if primitives.len() > 10_000 {
            return Err("Too many hull blocks".into());
        }
        let mut pieces = vec![];
        for p in primitives {
            if p.size.iter().any(|v| !v.is_finite() || *v <= 0.)
                || p.position.iter().any(|v| !v.is_finite())
                || !p.rotation_deg.is_finite()
            {
                return Err("Invalid hull dimensions".into());
            }
            let cells = primitive_cells(p)?;
            let volume = cg::total(&cells).volume;
            if volume <= cg::EPS {
                return Err("Hull block has no volume".into());
            }
            pieces.push(Piece {
                id: p.id.clone(),
                ballast: p.kind == "ballast",
                cells,
                volume,
            });
        }
        let flat: Vec<_> = pieces
            .iter()
            .flat_map(|p| p.cells.iter().cloned())
            .collect();
        cg::check_budget(&flat)?;
        let owners = pieces
            .iter()
            .enumerate()
            .flat_map(|(i, p)| std::iter::repeat_n(i, p.cells.len()))
            .collect();
        Ok(Self {
            pieces,
            index: cg::Broadphase::sized_for(&flat),
            owners,
        })
    }
    fn neighbors(&self, cells: &[cg::Cell], a: Vec3, b: Vec3) -> BTreeSet<usize> {
        let mut found = BTreeSet::new();
        for cell in cells {
            let (lo, hi) = extent(cell, a, b);
            let bins = (0..3)
                .map(|k| ((hi[k] - lo[k]) / self.index.pitch() + 3.).ceil())
                .product::<f64>();
            // A long diagonal drag must not enumerate billions of empty grid bins.
            if bins > (self.owners.len().max(1) * 8) as f64 {
                for (i, p) in self.pieces.iter().enumerate() {
                    if p.cells.iter().any(|c| {
                        let (l, h) = extent(c, [0.; 3], [0.; 3]);
                        (0..3).all(|k| l[k] <= hi[k] + cg::EPS && lo[k] <= h[k] + cg::EPS)
                    }) {
                        found.insert(i);
                    }
                }
            } else {
                found.extend(
                    self.index
                        .candidates_box(lo, hi)
                        .into_iter()
                        .map(|k| self.owners[k]),
                );
            }
        }
        found
    }
    fn exposed(&self, i: usize, obstacles: impl Iterator<Item = cg::Cell>) -> Result<f64, String> {
        let mut remaining = self.pieces[i].cells.clone();
        for c in obstacles {
            remaining = cg::subtract_all(remaining, [&c])?;
            if remaining.is_empty() {
                return Ok(0.);
            }
        }
        Ok((cg::total(&remaining).volume / self.pieces[i].volume).clamp(0., 1.))
    }
    fn initial(&self, i: usize) -> Result<f64, String> {
        self.exposed(
            i,
            self.neighbors(&self.pieces[i].cells, [0.; 3], [0.; 3])
                .into_iter()
                .filter(|&j| j != i)
                .flat_map(|j| self.pieces[j].cells.iter().cloned()),
        )
    }
    pub fn placement(&self, additions: &[ConstructionPrimitive]) -> Result<bool, String> {
        let new = Self::new(additions)?;
        for (i, p) in new.pieces.iter().enumerate() {
            let neighbors = self.neighbors(&p.cells, [0.; 3], [0.; 3]);
            let obstacles = neighbors
                .iter()
                .flat_map(|&j| self.pieces[j].cells.iter().cloned())
                .chain(
                    new.pieces
                        .iter()
                        .enumerate()
                        .filter(|(j, _)| *j != i)
                        .flat_map(|(_, p)| p.cells.iter().cloned()),
                );
            if new.exposed(i, obstacles)? + VOLUME_TOL < MIN_EXPOSED {
                return Ok(false);
            }
            if p.ballast {
                for other in self
                    .pieces
                    .iter()
                    .chain(new.pieces.iter().take(i))
                    .filter(|q| q.ballast)
                {
                    if p.cells.iter().any(|a| {
                        other.cells.iter().any(|b| {
                            cg::intersection(a, b).is_some_and(|c| cg::moments(&c).volume > cg::EPS)
                        })
                    }) {
                        return Ok(false);
                    }
                }
            }
        }
        let affected: BTreeSet<_> = new
            .pieces
            .iter()
            .flat_map(|p| self.neighbors(&p.cells, [0.; 3], [0.; 3]))
            .collect();
        for i in affected {
            let floor = self.initial(i)?.min(MIN_EXPOSED);
            let neighbors = self.neighbors(&self.pieces[i].cells, [0.; 3], [0.; 3]);
            let obstacles = neighbors
                .into_iter()
                .filter(|&j| j != i)
                .flat_map(|j| self.pieces[j].cells.iter().cloned())
                .chain(new.pieces.iter().flat_map(|p| p.cells.iter().cloned()));
            if self.exposed(i, obstacles)? + VOLUME_TOL < floor {
                return Ok(false);
            }
        }
        Ok(true)
    }
    pub fn movement(&self, ids: &[String], delta: Vec3) -> Result<Vec3, String> {
        if delta.iter().any(|v| !v.is_finite() || v.abs() > 4000.) {
            return Ok([0.; 3]);
        }
        let moving: BTreeSet<_> = self
            .pieces
            .iter()
            .enumerate()
            .filter(|(_, p)| ids.contains(&p.id))
            .map(|(i, _)| i)
            .collect();
        if moving.is_empty() || moving.len() == self.pieces.len() || length(delta) < 1e-12 {
            return Ok(delta);
        }
        let mut affected = moving.clone();
        for &i in &moving {
            affected.extend(self.neighbors(&self.pieces[i].cells, [0.; 3], delta));
        }
        let mut checks = vec![];
        for i in affected {
            let own_moves = moving.contains(&i);
            let mut neighbors = self.neighbors(
                &self.pieces[i].cells,
                [0.; 3],
                if own_moves { delta } else { [0.; 3] },
            );
            if !own_moves {
                neighbors.extend(moving.iter().copied());
            }
            neighbors.remove(&i);
            let floor = self.initial(i)?.min(MIN_EXPOSED);
            checks.push((i, neighbors, floor));
        }
        let safe = |a: f64, b: f64| -> Result<bool, String> {
            for (i, neighbors, floor) in &checks {
                let own_moves = moving.contains(i);
                let obstacles = neighbors
                    .iter()
                    .flat_map(|&j| {
                        let relative = (moving.contains(&j) as i8 - own_moves as i8) as f64;
                        self.pieces[j].cells.iter().map(move |c| {
                            swept(c, scale(delta, relative * a), scale(delta, relative * b))
                        })
                    })
                    .collect::<Vec<_>>();
                if *floor > VOLUME_TOL
                    && self.exposed(*i, obstacles.into_iter())? + VOLUME_TOL < *floor
                {
                    return Ok(false);
                }
                if self.pieces[*i].ballast {
                    for &j in neighbors
                        .iter()
                        .filter(|&&j| self.pieces[j].ballast && moving.contains(&j) != own_moves)
                    {
                        let sign = if own_moves { -1. } else { 1. };
                        // Existing invalid ballast can separate, but cannot gain overlap.
                        let initial: f64 = self.pieces[*i]
                            .cells
                            .iter()
                            .flat_map(|x| {
                                self.pieces[j]
                                    .cells
                                    .iter()
                                    .filter_map(|y| cg::intersection(x, y))
                            })
                            .map(|c| cg::moments(&c).volume)
                            .sum();
                        let cutters: Vec<_> = self.pieces[j]
                            .cells
                            .iter()
                            .map(|c| swept(c, scale(delta, sign * a), scale(delta, sign * b)))
                            .collect();
                        let overlap: f64 = self.pieces[*i]
                            .cells
                            .iter()
                            .flat_map(|x| cutters.iter().filter_map(|y| cg::intersection(x, y)))
                            .map(|c| cg::moments(&c).volume)
                            .sum();
                        if overlap > initial + cg::EPS {
                            return Ok(false);
                        }
                    }
                }
            }
            Ok(true)
        };
        // Certify whole swept intervals; bisect uncertain ones in travel order.
        // A bounded search fails closed at the last certified position.
        let mut pending = vec![(0., 1.)];
        let mut accepted = 0.;
        let mut budget = 2048;
        while let Some((a, b)) = pending.pop() {
            budget -= 1;
            if budget == 0 {
                break;
            }
            if safe(a, b)? {
                accepted = b;
                continue;
            }
            if (b - a) * length(delta) <= TRAVEL_TOL {
                break;
            }
            let mid = (a + b) / 2.;
            pending.push((mid, b));
            pending.push((a, mid));
        }
        Ok(scale(delta, accepted))
    }
}
