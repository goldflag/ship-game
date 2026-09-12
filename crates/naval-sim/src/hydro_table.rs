//! Content-published hydrostatic lookup, the twin of `src/simulation/hydrostatics.ts`.
//!
//! Clipping every hull section at each of 27 bisection immersions cost about a
//! million vertex clips per ship per half second. The table replaces that with a
//! bicubic interpolation over heel and trim of displacements solved once, at
//! content time, by the same mesh solver. Both simulations read this one table,
//! so neither can drift from the other; every arithmetic step below is written
//! in the same order as the TypeScript so the two agree bit for bit.
use crate::definition::Vec3;

/// Nodes hold (immersion, displacement, centroid) as little-endian f32.
pub const NODE_STRIDE: usize = 5;
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HydrostaticTable {
    /// Ship class the table was solved for; the manifest keys entries by it.
    pub id: String,
    pub version: u32,
    /// Heel from upright in radians, 0 to pi; sections are mirrored, so negative heel reflects.
    pub heel: Vec<f64>,
    /// Trim in radians, -pi/2 to pi/2.
    pub trim: Vec<f64>,
    /// Displacement intervals per orientation; each run holds `steps + 1` nodes.
    pub steps: usize,
    pub full_volume: f64,
    pub full_center: Vec3,
    #[serde(deserialize_with = "nodes")]
    pub nodes: Vec<f32>,
}
fn nodes<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Vec<f32>, D::Error> {
    use serde::{Deserialize, de::Error};
    let text = String::deserialize(d)?;
    let bytes = base64(text.as_bytes()).ok_or_else(|| D::Error::custom("Invalid base64 nodes"))?;
    if bytes.len() % 4 != 0 {
        return Err(D::Error::custom("Truncated hydrostatic nodes"));
    }
    Ok(bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|b| f32::from_le_bytes(*b))
        .collect())
}
/// Standard base64 with padding; the published table is the only caller.
fn base64(text: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(text.len() / 4 * 3);
    let (mut acc, mut bits) = (0u32, 0u32);
    for &c in text {
        let value = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' | b'\n' | b'\r' => continue,
            _ => return None,
        };
        acc = acc << 6 | value as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    Some(out)
}
impl HydrostaticTable {
    /// Cell containing `at`, clamped to the ends; grids are short, so a scan beats a search.
    fn cell(grid: &[f64], at: f64) -> (usize, f64) {
        let last = grid.len() - 1;
        if at <= grid[0] {
            return (0, 0.0);
        }
        if at >= grid[last] {
            return (last - 1, 1.0);
        }
        let mut i = 0;
        while i < last - 1 && grid[i + 1] < at {
            i += 1;
        }
        (i, (at - grid[i]) / (grid[i + 1] - grid[i]))
    }
    /// Cubic Hermite over cell `[i, i + 1]` with central-difference slopes,
    /// spread over the four contributing nodes. The buoyancy locus curves with
    /// a radius of the metacentric height, hundreds of metres longitudinally on
    /// a battleship, so a straight chord between tabulated angles is far too
    /// coarse; the cubic follows the arc.
    fn hermite(grid: &[f64], i: usize, t: f64, weight: &mut [f64; 4]) -> [usize; 4] {
        let last = grid.len() - 1;
        let a = i.saturating_sub(1);
        let d = (i + 2).min(last);
        let h = grid[i + 1] - grid[i];
        let (t2, t3) = (t * t, t * t * t);
        let h00 = 2.0 * t3 - 3.0 * t2 + 1.0;
        let h10 = t3 - 2.0 * t2 + t;
        let h01 = -2.0 * t3 + 3.0 * t2;
        let h11 = t3 - t2;
        *weight = [0.0, h00, h01, 0.0];
        if a == i {
            weight[1] -= h10;
            weight[2] += h10;
        } else {
            let k = h10 * h / (grid[i + 1] - grid[a]);
            weight[0] -= k;
            weight[2] += k;
        }
        if d == i + 1 {
            weight[1] -= h11;
            weight[2] += h11;
        } else {
            let k = h11 * h / (grid[d] - grid[i]);
            weight[1] -= k;
            weight[3] += k;
        }
        [a, i, i + 1, d]
    }
    /// Interpolate one orientation's node run at a displacement.
    fn at_volume(&self, base: usize, volume: f64, out: &mut [f64; 4]) {
        let n = &self.nodes;
        let mut k = 0;
        while k < self.steps - 1 && (n[base + (k + 1) * NODE_STRIDE + 1] as f64) < volume {
            k += 1;
        }
        let a = base + k * NODE_STRIDE;
        let b = a + NODE_STRIDE;
        let (low, high) = (n[a + 1] as f64, n[b + 1] as f64);
        let t = if high > low {
            (volume - low) / (high - low)
        } else {
            0.0
        };
        out[0] = n[a] as f64 + (n[b] as f64 - n[a] as f64) * t;
        for i in 1..4 {
            out[i] = n[a + 1 + i] as f64 + (n[b + 1 + i] as f64 - n[a + 1 + i] as f64) * t;
        }
    }
    /// Interpolate one orientation's node run at an immersion; y falls as k rises.
    fn at_immersion(&self, base: usize, y: f64, out: &mut [f64; 4]) {
        let n = &self.nodes;
        let mut k = 0;
        while k < self.steps - 1 && n[base + (k + 1) * NODE_STRIDE] as f64 > y {
            k += 1;
        }
        let a = base + k * NODE_STRIDE;
        let b = a + NODE_STRIDE;
        let (high, low) = (n[a] as f64, n[b] as f64);
        let t = if high > low {
            (high - y) / (high - low)
        } else {
            0.0
        }
        .clamp(0.0, 1.0);
        for i in 0..4 {
            out[i] = n[a + 1 + i] as f64 + (n[b + 1 + i] as f64 - n[a + 1 + i] as f64) * t;
        }
    }
    fn interpolated(&self, roll: f64, pitch: f64, volume: Option<f64>, y: f64) -> [f64; 4] {
        let (h, ht) = Self::cell(&self.heel, roll.abs());
        let (t, tt) = Self::cell(&self.trim, pitch);
        let (mut heel_weight, mut trim_weight) = ([0.0; 4], [0.0; 4]);
        let heels = Self::hermite(&self.heel, h, ht, &mut heel_weight);
        let trims = Self::hermite(&self.trim, t, tt, &mut trim_weight);
        let run = (self.steps + 1) * NODE_STRIDE;
        let (mut total, mut corner) = ([0.0; 4], [0.0; 4]);
        for a in 0..4 {
            if heel_weight[a] == 0.0 {
                continue;
            }
            for b in 0..4 {
                if trim_weight[b] == 0.0 {
                    continue;
                }
                let w = heel_weight[a] * trim_weight[b];
                let base = (heels[a] * self.trim.len() + trims[b]) * run;
                match volume {
                    Some(v) => self.at_volume(base, v, &mut corner),
                    None => self.at_immersion(base, y, &mut corner),
                }
                for i in 0..4 {
                    total[i] += corner[i] * w;
                }
            }
        }
        total
    }
    /// Hull sections are mirrored about the centreline, so a heeled entry serves
    /// both sides with the transverse centroid reflected.
    pub fn sample(&self, y: f64, roll: f64, pitch: f64) -> (f64, Vec3) {
        let total = self.interpolated(roll, pitch, None, y);
        let sign = if roll < 0.0 { -1.0 } else { 1.0 };
        (
            total[0],
            if total[0] > 1e-9 {
                [sign * total[1], total[2], total[3]]
            } else {
                [0.0; 3]
            },
        )
    }
    pub fn flotation(&self, volume: f64, roll: f64, pitch: f64) -> (f64, Vec3) {
        let total = self.interpolated(roll, pitch, Some(volume), 0.0);
        let sign = if roll < 0.0 { -1.0 } else { 1.0 };
        (total[0], [sign * total[1], total[2], total[3]])
    }
}
