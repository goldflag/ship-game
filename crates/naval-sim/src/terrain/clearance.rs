//! Distance to the nearest land sample, for navigation and grounding.
//!
//! Nodes sit every `stride` samples (about `SPACING_M` metres; 120 m on the
//! 40 m charts) and hold the exact distance from the node to the nearest land
//! sample, with that sample, from a separable Euclidean distance transform
//! (Felzenszwalb and Huttenlocher) in whole-sample arithmetic.
//!
//! Near land, where ships steer and ground by it, the query is exact: when the
//! nearest of the cell corners' own nearest land samples is within three node
//! spacings (360 m), the samples around the point are scanned (at most 19 by 19
//! on the 40 m charts). Further out it is a lower bound, never more than the
//! truth: each corner of the point's cell proves an open disk of its own
//! clearance free of land, so the nearest land sample lies outside the union of
//! the four disks and the point is at least as far from land as from that
//! union's boundary (the nearest uncovered point of the four circles: a radial
//! projection or a pairwise intersection). That bound is exact at nodes, never
//! below the single-corner Lipschitz bound `d(node) - r`, so it is short by at
//! most a node diagonal (170 m) at a cell centre, and in open water it is
//! usually within a few metres. Beyond the nodes it grows as the distance to the
//! chart does. The real coastline (height > 0) can lie up to one sample diagonal
//! (57 m) nearer than the nearest land sample, so margins built on this measure
//! add that much.
use super::Heightfield;

/// Target node spacing, metres, rounded to a whole number of samples.
pub(super) const SPACING_M: f64 = 120.0;
const NONE: u16 = u16::MAX;
/// Subdivisions `segment_clear` may spend before it answers "not proven clear".
const SEGMENT_BUDGET: usize = 4096;

/// Distance from `p` to the nearest point outside every open disk: zero when `p`
/// is outside them all. The nearest such point lies on the union's boundary: a
/// circle's radial projection of `p` or two circles' crossing, whichever is not
/// inside another disk. Conservative in floating point: a candidate is dropped
/// only when it lies clearly inside another disk, and the answer never falls
/// below the best single-disk bound.
fn free_disks_bound(p: [f64; 2], centre: &[[f64; 2]; 4], radius: &[f64; 4]) -> f64 {
    let distance = |a: [f64; 2], b: [f64; 2]| (a[0] - b[0]).hypot(a[1] - b[1]);
    let reach: [f64; 4] = std::array::from_fn(|k| distance(p, centre[k]));
    let floor = (0..4).map(|k| radius[k] - reach[k]).fold(0.0f64, f64::max);
    if floor <= 0.0 {
        return 0.0;
    }
    let covered = |q: [f64; 2], k: usize, l: usize| {
        (0..4).any(|m| {
            m != k && m != l && distance(q, centre[m]) < radius[m] - 1e-7 * (1.0 + radius[m])
        })
    };
    let mut best = f64::INFINITY;
    for k in 0..4 {
        if reach[k] <= 1e-9 {
            // At the centre every point of the circle is equally near.
            best = best.min(radius[k]);
            continue;
        }
        let scale = radius[k] / reach[k];
        let q = [
            centre[k][0] + (p[0] - centre[k][0]) * scale,
            centre[k][1] + (p[1] - centre[k][1]) * scale,
        ];
        if !covered(q, k, k) {
            best = best.min((radius[k] - reach[k]).abs());
        }
    }
    for k in 0..4 {
        for l in k + 1..4 {
            let (rk, rl) = (radius[k], radius[l]);
            let d = distance(centre[k], centre[l]);
            if d <= 1e-12 || d > rk + rl || d < (rk - rl).abs() {
                continue;
            }
            let along = (rk * rk - rl * rl + d * d) / (2.0 * d);
            let across = (rk * rk - along * along).max(0.0).sqrt();
            let e = [
                (centre[l][0] - centre[k][0]) / d,
                (centre[l][1] - centre[k][1]) / d,
            ];
            let mid = [centre[k][0] + e[0] * along, centre[k][1] + e[1] * along];
            for side in [1.0, -1.0] {
                let q = [mid[0] - e[1] * across * side, mid[1] + e[0] * across * side];
                if !covered(q, k, l) {
                    best = best.min(distance(p, q));
                }
            }
        }
    }
    if best.is_finite() {
        best.max(floor)
    } else {
        floor
    }
}

pub(super) struct Clearance {
    /// Metres between nodes.
    pub(super) spacing: f64,
    pub(super) width: usize,
    pub(super) height: usize,
    /// Squared distance from each node to its nearest land sample, in square
    /// samples (exact integers); `u32::MAX` when the chart has no land.
    distance2: Vec<u32>,
    /// That sample, as `j * columns + i`; `u32::MAX` when the chart has no land.
    site: Vec<u32>,
    pub(super) any_land: bool,
}

impl Clearance {
    pub(super) fn build(field: &Heightfield) -> Self {
        let (columns, rows) = (field.columns, field.rows);
        let stride = ((SPACING_M / field.cell).round() as usize).max(1);
        let width = (columns - 1).div_ceil(stride) + 1;
        let height = (rows - 1).div_ceil(stride) + 1;
        // Pass 1, down every sample column: the nearest land row to each node row.
        let mut nearest = vec![NONE; columns * height];
        let mut last = vec![NONE; columns];
        for j in 0..rows {
            let row = &field.quanta[j * columns..(j + 1) * columns];
            for (i, q) in row.iter().enumerate() {
                if *q > 0 {
                    last[i] = j as u16;
                }
            }
            if j % stride == 0 {
                nearest[(j / stride) * columns..][..columns].copy_from_slice(&last);
            }
        }
        if (height - 1) * stride > rows - 1 {
            nearest[(height - 1) * columns..][..columns].copy_from_slice(&last);
        }
        let mut next = vec![NONE; columns];
        for j in (0..rows).rev() {
            let row = &field.quanta[j * columns..(j + 1) * columns];
            for (i, q) in row.iter().enumerate() {
                if *q > 0 {
                    next[i] = j as u16;
                }
            }
            if j % stride == 0 {
                let slots = &mut nearest[(j / stride) * columns..][..columns];
                for (slot, below) in slots.iter_mut().zip(&next) {
                    if *below != NONE
                        && (*slot == NONE || (*below as usize - j) < (j - *slot as usize))
                    {
                        *slot = *below;
                    }
                }
            }
        }
        // Pass 2, along every node row: the lower envelope of the parabolas
        // (x - i)^2 + f(i) over sample columns, read at the node columns.
        let mut distance2 = vec![u32::MAX; width * height];
        let mut site = vec![u32::MAX; width * height];
        let mut envelope = vec![0usize; columns];
        let mut bounds = vec![0f64; columns + 1];
        let mut any_land = false;
        for b in 0..height {
            let z = (b * stride) as i64;
            let rows_at = &nearest[b * columns..][..columns];
            let f = |i: usize| {
                let r = rows_at[i];
                (r != NONE).then(|| ((z - r as i64) * (z - r as i64)) as f64)
            };
            let mut k = 0usize;
            let mut started = false;
            for q in 0..columns {
                let Some(fq) = f(q) else { continue };
                if !started {
                    envelope[0] = q;
                    bounds[0] = f64::NEG_INFINITY;
                    bounds[1] = f64::INFINITY;
                    started = true;
                    continue;
                }
                // Where parabola q overtakes the envelope's last one; pop every
                // parabola it hides. bounds[0] is -inf, so k never underflows.
                let meet = |p: usize| {
                    let fp = f(p).unwrap();
                    ((fq + (q * q) as f64) - (fp + (p * p) as f64)) / (2.0 * (q - p) as f64)
                };
                let mut s = meet(envelope[k]);
                while s <= bounds[k] {
                    k -= 1;
                    s = meet(envelope[k]);
                }
                k += 1;
                envelope[k] = q;
                bounds[k] = s;
                bounds[k + 1] = f64::INFINITY;
            }
            if !started {
                continue;
            }
            any_land = true;
            let mut k = 0usize;
            for a in 0..width {
                let x = (a * stride) as f64;
                while bounds[k + 1] < x {
                    k += 1;
                }
                let i = envelope[k];
                let dx = (a * stride) as i64 - i as i64;
                let r = rows_at[i] as i64;
                let d2 = dx * dx + (z - r) * (z - r);
                distance2[b * width + a] = d2.min(u32::MAX as i64 - 1) as u32;
                site[b * width + a] = (rows_at[i] as usize * columns + i) as u32;
            }
        }
        Self {
            spacing: stride as f64 * field.cell,
            width,
            height,
            distance2,
            site,
            any_land,
        }
    }

    fn node_distance(&self, field: &Heightfield, n: usize) -> f64 {
        (self.distance2[n] as f64).sqrt() * field.cell
    }
    /// Exact clearance at node `n`, metres.
    pub(super) fn at_node(&self, field: &Heightfield, n: usize) -> f64 {
        if self.any_land {
            self.node_distance(field, n)
        } else {
            f64::INFINITY
        }
    }
    /// Chart position of node `n`.
    pub(super) fn node_position(&self, field: &Heightfield, n: usize) -> [f64; 2] {
        [
            field.origin_x + (n % self.width) as f64 * self.spacing,
            field.origin_z + (n / self.width) as f64 * self.spacing,
        ]
    }
    /// The cell of nodes around chart point (x, z) after projecting it onto the
    /// node rectangle: its lower corner, the offsets inside it (node units) and
    /// the squared metres the projection moved the point.
    fn locate(&self, field: &Heightfield, x: f64, z: f64) -> (usize, usize, f64, f64, f64) {
        let gx = (x - field.origin_x) / self.spacing;
        let gz = (z - field.origin_z) / self.spacing;
        let qx = gx.clamp(0.0, (self.width - 1) as f64);
        let qz = gz.clamp(0.0, (self.height - 1) as f64);
        let out2 = ((gx - qx) * self.spacing).powi(2) + ((gz - qz) * self.spacing).powi(2);
        let a = (qx.floor() as usize).min(self.width - 2);
        let b = (qz.floor() as usize).min(self.height - 2);
        (a, b, qx - a as f64, qz - b as f64, out2)
    }
    const CORNERS: [(usize, usize); 4] = [(0, 0), (1, 0), (0, 1), (1, 1)];

    /// The nearest of the cell corners' own nearest land samples: its distance
    /// from chart point (x, z), an upper bound on the clearance there, and the
    /// way away from it.
    fn corner_site(
        &self,
        field: &Heightfield,
        a: usize,
        b: usize,
        x: f64,
        z: f64,
    ) -> (f64, [f64; 2]) {
        let mut best: Option<(f64, [f64; 2])> = None;
        for (da, db) in Self::CORNERS {
            let s = self.site[(b + db) * self.width + a + da] as usize;
            let away = [
                x - (field.origin_x + (s % field.columns) as f64 * field.cell),
                z - (field.origin_z + (s / field.columns) as f64 * field.cell),
            ];
            let d2 = away[0] * away[0] + away[1] * away[1];
            if best.is_none_or(|(b2, _)| d2 < b2) {
                best = Some((d2, away));
            }
        }
        let (d2, away) = best.unwrap();
        (d2.sqrt(), away)
    }
    /// Offsets from chart point (x, z) of every land sample in the square of
    /// half-width `reach` around it, row by row.
    fn land_near(
        field: &Heightfield,
        x: f64,
        z: f64,
        reach: f64,
    ) -> impl Iterator<Item = [f64; 2]> + '_ {
        let span = move |c: f64, origin: f64, count: usize| {
            let low = ((c - reach - origin) / field.cell).floor().max(0.0) as usize;
            let high = ((c + reach - origin) / field.cell).ceil().max(0.0) as usize;
            low..=high.min(count - 1)
        };
        span(z, field.origin_z, field.rows).flat_map(move |j| {
            span(x, field.origin_x, field.columns)
                .filter(move |&i| field.sample_is_land(i, j))
                .map(move |i| {
                    [
                        x - (field.origin_x + i as f64 * field.cell),
                        z - (field.origin_z + j as f64 * field.cell),
                    ]
                })
        })
    }

    /// The distance from chart point (x, z) to the nearest land sample, never
    /// more than the truth; infinite without land. Exact within `EXACT_NODES`
    /// node spacings of land, the union-of-disks bound further out (see the
    /// module notes).
    pub(super) fn clearance(&self, field: &Heightfield, x: f64, z: f64) -> f64 {
        const EXACT_NODES: f64 = 3.0;
        if !self.any_land {
            return f64::INFINITY;
        }
        if !(x.is_finite() && z.is_finite()) {
            return 0.0;
        }
        let (a, b, u, v, out2) = self.locate(field, x, z);
        if out2 == 0.0 {
            let (upper, _) = self.corner_site(field, a, b, x, z);
            if upper <= EXACT_NODES * self.spacing {
                // The corners' best sample lies in the square, so the scan finds
                // the nearest one.
                return Self::land_near(field, x, z, upper)
                    .map(|d| d[0].hypot(d[1]))
                    .fold(upper, f64::min);
            }
        }
        let point = [u * self.spacing, v * self.spacing];
        let mut centre = [[0.0; 2]; 4];
        let mut radius = [0.0; 4];
        for (k, (da, db)) in Self::CORNERS.into_iter().enumerate() {
            centre[k] = [da as f64 * self.spacing, db as f64 * self.spacing];
            radius[k] = self.node_distance(field, (b + db) * self.width + a + da);
        }
        let lower = free_disks_bound(point, &centre, &radius);
        if out2 > 0.0 {
            // Every land sample lies inside the node rectangle, so the distance
            // from outside it grows at least as fast as the projection moved.
            (lower * lower + out2).sqrt()
        } else {
            lower
        }
    }

    /// Unit vector in chart x and z pointing away from the nearest coast; zero
    /// without land. Far from land it points away from the nearest of the cell
    /// corners' own nearest samples. Within `REFINE_NODES` node spacings of land,
    /// where grounding and land avoidance steer by it, the samples around the
    /// point are scanned: the direction averages the way away from every land
    /// sample within one sample spacing of the nearest, so a coast's staircase
    /// of samples reads as its shoreline normal.
    pub(super) fn escape(&self, field: &Heightfield, x: f64, z: f64) -> [f64; 2] {
        const REFINE_NODES: f64 = 3.0;
        if !self.any_land || !(x.is_finite() && z.is_finite()) {
            return [0.0; 2];
        }
        let (a, b, _, _, _) = self.locate(field, x, z);
        let (reach, mut away) = self.corner_site(field, a, b, x, z);
        if reach <= REFINE_NODES * self.spacing {
            // Every sample within the corners' best plus one spacing lies in this square.
            let window = reach + field.cell;
            let nearest = Self::land_near(field, x, z, window)
                .map(|d| d[0].hypot(d[1]))
                .fold(reach, f64::min);
            let mut sum = [0.0; 2];
            for v in Self::land_near(field, x, z, window) {
                let d = v[0].hypot(v[1]);
                if d <= nearest + field.cell && d > 1e-9 {
                    sum = [sum[0] + v[0] / d, sum[1] + v[1] / d];
                }
            }
            away = sum;
        }
        let d = away[0].hypot(away[1]);
        if d > 1e-9 {
            return [away[0] / d, away[1] / d];
        }
        // On a land sample itself: head for the corner with the most sea room.
        let mut open: Option<(u32, usize, usize)> = None;
        for (da, db) in Self::CORNERS {
            let d2 = self.distance2[(b + db) * self.width + a + da];
            if open.is_none_or(|(o, _, _)| d2 > o) {
                open = Some((d2, da, db));
            }
        }
        let (_, da, db) = open.unwrap();
        let corner = self.node_position(field, (b + db) * self.width + a + da);
        let away = [corner[0] - x, corner[1] - z];
        let d = away[0].hypot(away[1]);
        if d > 1e-9 {
            [away[0] / d, away[1] / d]
        } else {
            [1.0, 0.0]
        }
    }

    /// Whether every point of the chart segment keeps at least `margin` metres
    /// of clearance. Conservative: halves are split until each is proven by
    /// the Lipschitz bound at its midpoint, and a point below the margin, a
    /// spent budget or a non-finite input answers false.
    pub(super) fn segment_clear(
        &self,
        field: &Heightfield,
        from: [f64; 2],
        to: [f64; 2],
        margin: f64,
    ) -> bool {
        if !self.any_land {
            return true;
        }
        if ![from[0], from[1], to[0], to[1], margin]
            .iter()
            .all(|v| v.is_finite())
        {
            return false;
        }
        let length = (to[0] - from[0]).hypot(to[1] - from[1]);
        let mut stack = vec![(0.0f64, 1.0f64)];
        let mut budget = SEGMENT_BUDGET;
        while let Some((t0, t1)) = stack.pop() {
            if budget == 0 {
                return false;
            }
            budget -= 1;
            let t = (t0 + t1) / 2.0;
            let half = length * (t1 - t0) / 2.0;
            let c = self.clearance(
                field,
                from[0] + (to[0] - from[0]) * t,
                from[1] + (to[1] - from[1]) * t,
            );
            if c < margin || (half <= 0.5 && c - half < margin) {
                return false;
            }
            if c - half >= margin {
                continue;
            }
            // Later half first on the stack: the nearer half is proven first.
            stack.push((t, t1));
            stack.push((t0, t));
        }
        true
    }
}
