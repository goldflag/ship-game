//! Exact, piecewise cubic displaced volume of a convex cell.
//!
//! Geometry is tetrahedralized once with the compiled hull. At a new attitude
//! only vertex heights are projected; each draft trial evaluates these cubics
//! instead of constructing waterline faces and sorting their cap vertices.
//! Unlike a sampled heel/trim table this covers arbitrary asymmetric hulls and
//! every attitude, including inversion, without interpolation error.

use crate::{
    definition::{ConvexVolume, Vec3},
    geometry::{add, cross, dot, scale, sub},
};
use std::cell::OnceCell;

#[derive(Clone, Debug)]
struct Tetrahedron {
    vertices: [usize; 4],
    volume: f64,
}

#[derive(Clone, Debug)]
pub(super) struct CellDisplacement {
    vertices: Vec<Vec3>,
    tetrahedra: Vec<Tetrahedron>,
}

impl CellDisplacement {
    pub fn new(shape: &ConvexVolume, full_volume: f64) -> Option<Self> {
        let mut vertices = Vec::new();
        let mut tetrahedra = Vec::new();
        let origin = *shape.faces.first()?.vertices.first()?;
        vertices.push(origin);
        let mut total = 0.;
        for face in shape.faces.iter() {
            let indices: Vec<_> = face
                .vertices
                .iter()
                .map(|&p| {
                    if let Some(i) = vertices.iter().position(|v| *v == p) {
                        i
                    } else {
                        vertices.push(p);
                        vertices.len() - 1
                    }
                })
                .collect();
            for i in 1..indices.len().saturating_sub(1) {
                let a = sub(vertices[indices[0]], origin);
                let b = sub(vertices[indices[i]], origin);
                let c = sub(vertices[indices[i + 1]], origin);
                let volume = dot(a, cross(b, c)) / 6.;
                if !volume.is_finite() || volume < -full_volume.abs() * 1e-10 {
                    return None;
                }
                if volume > 0. {
                    total += volume;
                    tetrahedra.push(Tetrahedron {
                        vertices: [0, indices[0], indices[i], indices[i + 1]],
                        volume,
                    });
                }
            }
        }
        if total <= 0. || !full_volume.is_finite() || full_volume <= 0. {
            return None;
        }
        // Retain the source cell's displacement, including weighted buoyancy
        // proxies. Different valid tetrahedralizations differ only by roundoff.
        let density = full_volume / total;
        for tetrahedron in &mut tetrahedra {
            tetrahedron.volume *= density;
        }
        Some(Self {
            vertices,
            tetrahedra,
        })
    }

    pub fn at_normal(&self, normal: Vec3) -> CellCurve<'_> {
        let heights: Vec<_> = self.vertices.iter().map(|&p| dot(normal, p)).collect();
        let bounds = heights
            .iter()
            .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), &h| {
                (lo.min(h), hi.max(h))
            });
        CellCurve {
            bounds,
            heights,
            source: self,
            tetrahedra: OnceCell::new(),
        }
    }
}

pub(super) struct CellCurve<'a> {
    pub bounds: (f64, f64),
    heights: Vec<f64>,
    source: &'a CellDisplacement,
    tetrahedra: OnceCell<Vec<TetrahedronCurve>>,
}

impl CellCurve<'_> {
    fn tetrahedra(&self) -> &[TetrahedronCurve] {
        // Most cells remain entirely dry or submerged during a draft solve.
        // Sort tetrahedral height knots only if a trial crosses this cell.
        self.tetrahedra.get_or_init(|| {
            self.source
                .tetrahedra
                .iter()
                .map(|tetrahedron| {
                    let mut vertices = tetrahedron.vertices;
                    vertices.sort_by(|&a, &b| self.heights[a].total_cmp(&self.heights[b]));
                    TetrahedronCurve {
                        height: vertices.map(|i| self.heights[i]),
                        vertices,
                        volume: tetrahedron.volume,
                    }
                })
                .collect()
        })
    }
    pub fn volume_at(&self, level: f64) -> f64 {
        self.tetrahedra().iter().map(|t| t.volume_at(level)).sum()
    }
    /// Exact displaced volume and first moments, by positive tetrahedra.
    /// No clipped faces or waterline polygons need to be built or sorted.
    pub fn first_moments_at(&self, level: f64) -> (f64, Vec3) {
        let mut volume = 0.;
        let mut first = [0.; 3];
        for t in self.tetrahedra() {
            let v = t.volume_at(level);
            volume += v;
            first = add(
                first,
                t.first_at(t.vertices.map(|i| self.source.vertices[i]), level),
            );
        }
        (volume, first)
    }
}

struct TetrahedronCurve {
    height: [f64; 4],
    vertices: [usize; 4],
    volume: f64,
}

impl TetrahedronCurve {
    fn first_at(&self, vertices: [Vec3; 4], level: f64) -> Vec3 {
        let [a, b, c, d] = self.height;
        let [pa, pb, pc, pd] = vertices;
        let first = |vertices: [Vec3; 4], fraction: f64| {
            scale(
                vertices.into_iter().fold([0.; 3], add),
                self.volume * fraction / 4.,
            )
        };
        let along = |a: Vec3, b: Vec3, t: f64| add(a, scale(sub(b, a), t));
        if level <= a {
            return [0.; 3];
        }
        if level >= d {
            return first(vertices, 1.);
        }
        if level < b {
            let (ab, ac, ad) = (
                (level - a) / (b - a),
                (level - a) / (c - a),
                (level - a) / (d - a),
            );
            return first(
                [pa, along(pa, pb, ab), along(pa, pc, ac), along(pa, pd, ad)],
                ab * ac * ad,
            );
        }
        if level >= c {
            let (da, db, dc) = (
                (d - level) / (d - a),
                (d - level) / (d - b),
                (d - level) / (d - c),
            );
            return sub(
                first(vertices, 1.),
                first(
                    [pd, along(pd, pa, da), along(pd, pb, db), along(pd, pc, dc)],
                    da * db * dc,
                ),
            );
        }
        let (ac, ad, bc, bd) = (
            (level - a) / (c - a),
            (level - a) / (d - a),
            (level - b) / (c - b),
            (level - b) / (d - b),
        );
        let (pac, pad, pbc, pbd) = (
            along(pa, pc, ac),
            along(pa, pd, ad),
            along(pb, pc, bc),
            along(pb, pd, bd),
        );
        // The two-immersed-vertex wedge is three positive tetrahedra. These
        // are the same fractions as volume_at, including coincident knots.
        add(
            add(
                first([pa, pb, pac, pad], ac * ad),
                first([pb, pac, pad, pbd], ac * bd * (1. - ad)),
            ),
            first([pb, pac, pbc, pbd], bc * bd * (1. - ac)),
        )
    }
    fn volume_at(&self, level: f64) -> f64 {
        let [a, b, c, d] = self.height;
        let fraction = if level <= a {
            0.
        } else if level >= d {
            1.
        } else if level < b {
            // One immersed vertex: a smaller, similar tetrahedron.
            ((level - a) / (b - a)) * ((level - a) / (c - a)) * ((level - a) / (d - a))
        } else if level >= c {
            // Three immersed vertices: subtract the dry tetrahedron.
            1. - ((d - level) / (d - a)) * ((d - level) / (d - b)) * ((d - level) / (d - c))
        } else {
            // Two immersed vertices form a wedge, split into three positive
            // tetrahedra. Subtracting cubic divided differences is unstable
            // when a≈b or c≈d; this expression never divides by those gaps.
            let ac = (level - a) / (c - a);
            let ad = (level - a) / (d - a);
            let bc = (level - b) / (c - b);
            let bd = (level - b) / (d - b);
            ac * ad + ac * bd * (1. - ad) + bc * bd * (1. - ac)
        };
        self.volume * fraction
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{construction_geometry as cg, geometry::normalize};

    #[test]
    fn polynomial_volume_matches_clipping_across_attitudes_and_degenerate_heights() {
        let box_cell = cg::box_cell([3., -2., 9.], [11., 4., 23.]);
        let clipped = cg::clip(&box_cell, normalize([1., 2., 0.3]), 1.).unwrap();
        let thin = cg::box_cell([-9., 4., -31.], [0.0001, 1., 200.]);
        for shape in [&box_cell, &clipped, &thin] {
            let full = cg::moments(shape).volume;
            let cached = CellDisplacement::new(shape, full).unwrap();
            for normal in [
                [0., 1., 0.],
                [1., 0., 0.],
                [0., 0., 1.],
                [0., -1., 0.],
                normalize([1e-14, 1., -1e-14]),
                normalize([1., 1e-14, 1.]),
                normalize([1., 2., -3.]),
                normalize([-3., -1., 2.]),
            ] {
                let curve = cached.at_normal(normal);
                let (lo, hi) = curve.bounds;
                let mut previous = 0.;
                for step in 0..=100 {
                    let level = lo + (hi - lo) * step as f64 / 100.;
                    let expected =
                        cg::clipped_moments(shape, normal, level).map_or(0., |m| m.volume);
                    let actual = curve.volume_at(level);
                    assert!(actual >= previous - full * 1e-12);
                    assert!(actual >= 0. && actual <= full * (1. + 1e-12));
                    assert!(
                        (actual - expected).abs() < full * 2e-7,
                        "normal {normal:?} step {step}: cached={actual} clipped={expected} full={full}"
                    );
                    previous = actual;
                }
            }
        }
    }

    #[test]
    fn tetrahedral_first_moments_match_clipped_cells_at_every_fill() {
        let box_cell = cg::box_cell([3., -2., 9.], [11., 4., 23.]);
        let clipped = cg::clip(&box_cell, normalize([1., 2., 0.3]), 1.).unwrap();
        let thin = cg::box_cell([-9., 4., -31.], [0.0001, 1., 200.]);
        for shape in [&box_cell, &clipped, &thin] {
            let full = cg::moments(shape).volume;
            for density in [1., 0.37] {
                let cached = CellDisplacement::new(shape, full * density).unwrap();
                for normal in [
                    [0., 1., 0.],
                    [1., 0., 0.],
                    [0., 0., 1.],
                    [0., -1., 0.],
                    normalize([1e-14, 1., -1e-14]),
                    normalize([1., 1e-14, 1.]),
                    normalize([1., 2., -3.]),
                    normalize([-3., -1., 2.]),
                ] {
                    let curve = cached.at_normal(normal);
                    let (lo, hi) = curve.bounds;
                    for step in 0..=100 {
                        let level = lo + (hi - lo) * step as f64 / 100.;
                        let expected =
                            cg::clipped_moments(shape, normal, level).unwrap_or_default();
                        let (volume, first) = curve.first_moments_at(level);
                        assert_eq!(volume, curve.volume_at(level));
                        assert!((volume - expected.volume * density).abs() < full * density * 2e-7);
                        for axis in 0..3 {
                            assert!(
                                (first[axis] - expected.first[axis] * density).abs()
                                    < full * density * 2e-6,
                                "normal {normal:?} step {step} axis {axis}: {first:?} vs {:?}",
                                expected.first
                            );
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn coincident_knots_are_finite_and_symmetric() {
        for height in [
            [0., 0., 0., 1.],
            [0., 0., 1., 1.],
            [0., 1., 1., 1.],
            [0., 1e-15, 1. - 1e-15, 1.],
            [0., 0., 0., 0.],
        ] {
            let original = TetrahedronCurve {
                height,
                vertices: [0, 1, 2, 3],
                volume: 1.,
            };
            let reflected = TetrahedronCurve {
                vertices: [0, 1, 2, 3],
                height: [-height[3], -height[2], -height[1], -height[0]],
                volume: 1.,
            };
            for step in -10..=110 {
                let level = step as f64 / 100.;
                let volume = original.volume_at(level);
                assert!(volume.is_finite() && (0. ..=1.).contains(&volume));
                if height[0] != height[3] || level != height[0] {
                    assert!((volume + reflected.volume_at(-level) - 1.).abs() < 1e-14);
                }
            }
        }
    }
}
