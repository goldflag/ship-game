//! A max-height pyramid over a heightfield: the early-out behind shell, torpedo
//! and sight-line queries. The bilinear surface inside a cell never rises above
//! the highest of its four samples, so the highest sample of a block bounds every
//! height inside it, and a ray portion whose lowest point clears that bound
//! cannot meet the ground there. Open water proves itself clear in one lookup.
use super::{Heightfield, OPEN_SEA_M};

/// Cells per side of a level-0 block, the finest region the pyramid resolves.
pub(super) const BLOCK: usize = 8;

pub(super) struct Relief {
    /// Level 0 holds one entry per `BLOCK`-cell square; each further level
    /// halves both sides, up to a single entry for the whole chart.
    levels: Vec<Level>,
}
struct Level {
    width: usize,
    height: usize,
    /// Highest quantum of every sample the block's cells touch.
    top: Vec<i16>,
}

impl Relief {
    pub(super) fn build(field: &Heightfield) -> Self {
        let (columns, rows) = (field.columns, field.rows);
        let width = (columns - 1).div_ceil(BLOCK);
        let height = (rows - 1).div_ceil(BLOCK);
        let mut top = vec![i16::MIN; width * height];
        for j in 0..rows {
            let row = &field.quanta[j * columns..(j + 1) * columns];
            // A sample row on a block boundary is the bottom edge of the block
            // above and the top edge of the block below.
            let last = (j / BLOCK).min(height - 1);
            let first = if j % BLOCK == 0 && j > 0 {
                j / BLOCK - 1
            } else {
                last
            };
            for bi in 0..width {
                let i0 = bi * BLOCK;
                let i1 = (i0 + BLOCK).min(columns - 1);
                let highest = row[i0..=i1].iter().copied().max().unwrap_or(i16::MIN);
                for bj in first..=last {
                    let slot = &mut top[bj * width + bi];
                    *slot = (*slot).max(highest);
                }
            }
        }
        let mut levels = vec![Level { width, height, top }];
        while levels.last().is_some_and(|l| l.width > 1 || l.height > 1) {
            let below = levels.last().unwrap();
            let (width, height) = (below.width.div_ceil(2), below.height.div_ceil(2));
            let mut top = vec![i16::MIN; width * height];
            for bj in 0..below.height {
                for bi in 0..below.width {
                    let slot = &mut top[(bj / 2) * width + bi / 2];
                    *slot = (*slot).max(below.top[bj * below.width + bi]);
                }
            }
            levels.push(Level { width, height, top });
        }
        Self { levels }
    }

    /// Highest quantum over cells `i0..=i1` by `j0..=j1` (valid cell indices),
    /// read from at most four entries of the level whose blocks span the range.
    fn top(&self, i0: usize, j0: usize, i1: usize, j1: usize) -> i16 {
        let (mut bi0, mut bj0, mut bi1, mut bj1) = (i0 / BLOCK, j0 / BLOCK, i1 / BLOCK, j1 / BLOCK);
        let mut level = 0;
        while (bi1 - bi0 > 1 || bj1 - bj0 > 1) && level + 1 < self.levels.len() {
            bi0 >>= 1;
            bj0 >>= 1;
            bi1 >>= 1;
            bj1 >>= 1;
            level += 1;
        }
        let l = &self.levels[level];
        let mut highest = i16::MIN;
        for bj in bj0..=bj1.min(l.height - 1) {
            for bi in bi0..=bi1.min(l.width - 1) {
                highest = highest.max(l.top[bj * l.width + bi]);
            }
        }
        highest
    }

    /// An upper bound on `field.height` anywhere in the chart rectangle
    /// `[x0, x1] x [z0, z1]`: `OPEN_SEA_M` wherever it leaves the grid.
    pub(super) fn highest(&self, field: &Heightfield, x0: f64, z0: f64, x1: f64, z1: f64) -> f64 {
        let (gx0, gx1) = (
            (x0 - field.origin_x) / field.cell,
            (x1 - field.origin_x) / field.cell,
        );
        let (gz0, gz1) = (
            (z0 - field.origin_z) / field.cell,
            (z1 - field.origin_z) / field.cell,
        );
        if ![gx0, gx1, gz0, gz1].iter().all(|g| g.is_finite()) {
            return f64::INFINITY;
        }
        let (last_x, last_z) = ((field.columns - 1) as f64, (field.rows - 1) as f64);
        if gx1 < 0.0 || gz1 < 0.0 || gx0 > last_x || gz0 > last_z {
            return OPEN_SEA_M;
        }
        let outside = gx0 < 0.0 || gz0 < 0.0 || gx1 > last_x || gz1 > last_z;
        // The same cell `Heightfield::height` interpolates in, clamped the same way.
        let cell = |g: f64, samples: usize| (g.max(0.0).floor() as usize).min(samples - 2);
        // A bilinear blend of equal quanta can round a few ulps above them; the
        // micrometre keeps the bound an upper bound without costing a pruned block.
        let highest = self.top(
            cell(gx0, field.columns),
            cell(gz0, field.rows),
            cell(gx1.min(last_x), field.columns),
            cell(gz1.min(last_z), field.rows),
        ) as f64
            * field.step
            + 1e-6;
        if outside {
            highest.max(OPEN_SEA_M)
        } else {
            highest
        }
    }
}
