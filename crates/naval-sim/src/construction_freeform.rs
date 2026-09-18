//! Round/chamfer edges on one vertex hull. Source controls and all physical output
//! share the construction definition; the browser only duplicates preview math.
use crate::{
    construction_geometry as cg,
    construction_vertex::{FACES, SIGNS, VertexSolid},
    definition::*,
    geometry::*,
};
const EDGES: [[usize; 2]; 12] = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
];
fn sample(v: &[Vec3], uvw: Vec3) -> Vec3 {
    let mut out = [0.; 3];
    for (i, sign) in SIGNS.iter().enumerate() {
        let w = (0..3)
            .map(|k| if sign[k] > 0. { uvw[k] } else { 1. - uvw[k] })
            .product::<f64>();
        out = add(out, scale(v[i], w));
    }
    out
}
fn mapped(p: &ConstructionPrimitive, q: Vec3) -> Vec3 {
    let v = p
        .vertices
        .clone()
        .unwrap_or_else(|| SIGNS.iter().map(|v| scale(*v, 0.5)).collect());
    let uvw = std::array::from_fn(|k| q[k] / p.size[k] + 0.5);
    let mut out = sample(&v, uvw);
    for (coordinate, dimension) in out.iter_mut().zip(p.size) {
        *coordinate *= dimension;
    }
    crate::construction_orientation::point(p, out)
}
fn validate(p: &ConstructionPrimitive, s: &ConstructionFreeformShape) -> Result<(), String> {
    let r = p.size.iter().copied().fold(f64::INFINITY, f64::min) * 0.45;
    if s.version != 1.
        || !s.radius.is_finite()
        || s.radius < 0.
        || s.radius > r + 1e-8
        || !["round", "chamfer"].contains(&s.style.as_str())
        || s.edges.len() > 12
        || s.edges
            .iter()
            .any(|e| !e.is_finite() || *e < 0. || *e > 11. || e.fract() != 0.)
        || s.edges
            .iter()
            .map(|e| *e as usize)
            .collect::<std::collections::BTreeSet<_>>()
            .len()
            != s.edges.len()
    {
        return Err(
            "Invalid edge treatment or radius; use at most 45% of the smallest block dimension"
                .into(),
        );
    }
    Ok(())
}
pub fn build(p: &ConstructionPrimitive) -> Result<VertexSolid, String> {
    let s = p.shaping.as_ref().ok_or("Missing shaping data")?;
    validate(p, s)?;
    // Validate the original cage with the established folded/self-overlap checks.
    let mut cage = p.clone();
    cage.shaping = None;
    crate::construction_vertex::build(&cage)?;
    let mut cell = cg::Cell {
        faces: FACES
            .iter()
            .map(|(_, f)| ConvexVolumeFacesItem {
                vertices: f
                    .iter()
                    .map(|i| std::array::from_fn(|k| SIGNS[*i][k] * p.size[k] / 2.))
                    .collect(),
            })
            .collect(),
    };
    let mut planes = vec![];
    let r = s.radius;
    if r > 0. {
        for e in &s.edges {
            let [a, b] = EDGES[*e as usize];
            let axes: Vec<_> = (0..3).filter(|k| SIGNS[a][*k] == SIGNS[b][*k]).collect();
            for i in 1..if s.style == "round" { 6 } else { 2 } {
                let angle =
                    i as f64 * std::f64::consts::PI / if s.style == "round" { 12. } else { 4. };
                let mut n = [0.; 3];
                n[axes[0]] = angle.cos() * SIGNS[a][axes[0]];
                n[axes[1]] = angle.sin() * SIGNS[a][axes[1]];
                let d = (0..3)
                    .map(|k| n[k].abs() * (p.size[k] / 2. - r))
                    .sum::<f64>()
                    + if s.style == "round" {
                        r
                    } else {
                        r / 2_f64.sqrt()
                    };
                planes.push((n, d));
            }
        }
        if s.style == "round" {
            for (corner, sign) in SIGNS.iter().enumerate() {
                if EDGES
                    .iter()
                    .enumerate()
                    .filter(|(_, e)| e.contains(&corner))
                    .any(|(i, _)| !s.edges.contains(&(i as f64)))
                {
                    continue;
                }
                for a in 1..3 {
                    for b in 1..3 {
                        let u = a as f64 * std::f64::consts::PI / 6.;
                        let v = b as f64 * std::f64::consts::PI / 6.;
                        let n = [
                            u.cos() * v.cos() * sign[0],
                            u.sin() * v.cos() * sign[1],
                            v.sin() * sign[2],
                        ];
                        planes.push((
                            n,
                            (0..3)
                                .map(|k| n[k].abs() * (p.size[k] / 2. - r))
                                .sum::<f64>()
                                + r,
                        ));
                    }
                }
            }
        }
    }
    for (n, d) in planes {
        cell = cg::clip(&cell, n, d).ok_or("Rounding collapsed this block")?;
    }
    let faces: Vec<(String, Vec<Vec3>)> = cell
        .faces
        .iter()
        .map(|f| {
            let n = cg::normal(&f.vertices);
            let name = [
                ("port", 0, -1.),
                ("starboard", 0, 1.),
                ("bottom", 1, -1.),
                ("top", 1, 1.),
                ("bow", 2, -1.),
                ("stern", 2, 1.),
            ]
            .iter()
            .find(|(_, k, s)| n[*k] * s > 1. - 1e-7)
            .map(|(name, _, _)| *name)
            .unwrap_or("slope");
            (name.into(), f.vertices.clone())
        })
        .collect();
    let mut boundary = vec![];
    for (name, f) in faces {
        let center = scale(
            f.iter().fold([0.; 3], |sum, p| add(sum, *p)),
            1. / f.len() as f64,
        );
        let c = mapped(p, center);
        let mapped: Vec<_> = f.iter().map(|q| mapped(p, *q)).collect();
        let n = cg::normal(&mapped);
        let convex_patch = (0..mapped.len()).all(|i| {
            let edge = sub(mapped[(i + 1) % mapped.len()], mapped[i]);
            mapped
                .iter()
                .all(|q| dot(cross(edge, sub(*q, mapped[i])), n) >= -1e-8)
        });
        if convex_patch
            && length(n) > 0.9
            && mapped
                .iter()
                .chain(std::iter::once(&c))
                .all(|q| dot(n, sub(*q, mapped[0])).abs() < 1e-8)
        {
            boundary.push((name, mapped));
        } else {
            for i in 0..mapped.len() {
                let triangle = vec![mapped[i], mapped[(i + 1) % mapped.len()], c];
                if cg::area(&triangle) > 1e-10 {
                    boundary.push((name.clone(), triangle));
                }
            }
        }
    }
    if boundary.len() > 4096
        || boundary
            .iter()
            .flat_map(|(_, f)| f.iter().flatten())
            .any(|v| !v.is_finite() || v.abs() > 1000.)
    {
        return Err("Shaped hull exceeds its geometry or 1000 m bounds limit".into());
    }
    // Retain the disjoint parameter patches. A plane/area-only merge can trade
    // a small overlap for a gap after a warped cage deformation.
    let world: Vec<_> = boundary
        .iter()
        .flat_map(|(_, f)| f.iter().copied())
        .collect();
    let convex = boundary.iter().all(|(_, f)| {
        let n = cg::normal(f);
        world.iter().all(|p| dot(n, sub(*p, f[0])) < 1e-7)
    });
    if convex && boundary.len() <= cg::MAX_CELL_FACES {
        let cell = cg::Cell {
            faces: boundary
                .iter()
                .map(|(_, f)| ConvexVolumeFacesItem {
                    vertices: f.clone(),
                })
                .collect(),
        };
        if cg::moments(&cell).volume > 1e-8 {
            return Ok(VertexSolid {
                cells: vec![cell],
                faces: boundary,
            });
        }
    }
    let center = mapped(p, [0.; 3]);
    let mut cells = vec![];
    // Every boundary patch is convex and planar. A pyramid over the entire patch
    // keeps the collision representation compact.
    for (_, f) in &boundary {
        let distance = dot(cg::normal(f), sub(f[0], center));
        if distance < -1e-8 {
            return Err(
                "This rounded hull folds beyond its center. Reduce the radius or corner deformation."
                    .into(),
            );
        }
        if distance.abs() < 1e-8 {
            continue;
        }
        let mut faces = vec![ConvexVolumeFacesItem {
            vertices: f.clone(),
        }];
        for i in 0..f.len() {
            faces.push(ConvexVolumeFacesItem {
                vertices: vec![center, f[(i + 1) % f.len()], f[i]],
            });
        }
        cells.push(cg::Cell {
            faces: faces.into(),
        });
    }
    if cg::total(&cells).volume < 1e-8 {
        return Err("Shaped hull has no enclosed volume".into());
    }
    // A positive fan alone does not prove a globally valid surface.
    for i in 0..cells.len() {
        for j in 0..i {
            if cg::intersection(&cells[i], &cells[j]).is_some_and(|c| cg::moments(&c).volume > 1e-7)
            {
                return Err(
                    "Rounded hull overlaps itself. Reduce the radius or corner deformation.".into(),
                );
            }
        }
    }
    Ok(VertexSolid {
        cells,
        faces: boundary,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn cube() -> ConstructionPrimitive {
        serde_json::from_value(serde_json::json!({"id":"shape","kind":"vertex","position":[0,0,0],"size":[4,4,4],"rotationDeg":0,"shaping":{"version":1,"edges":[],"radius":1,"style":"round"}})).unwrap()
    }
    fn volume(p: &ConstructionPrimitive) -> f64 {
        cg::total(&build(p).unwrap().cells).volume
    }
    #[test]
    fn chamfer_and_round_have_closed_physical_volume() {
        let mut p = cube();
        assert!((volume(&p) - 64.).abs() < 1e-7);
        p.shaping.as_mut().unwrap().edges = vec![8.];
        p.shaping.as_mut().unwrap().style = "chamfer".into();
        assert!((volume(&p) - 62.).abs() < 1e-7);
        p.shaping.as_mut().unwrap().style = "round".into();
        let rounded = volume(&p);
        assert!(rounded > 63.14 && rounded < 63.2, "{rounded}");
        p.shaping.as_mut().unwrap().edges = (0..12).map(|i| i as f64).collect();
        let solid = build(&p).unwrap();
        assert_eq!(solid.cells.len(), 1);
        assert!(cg::total(&solid.cells).volume < 64.);
        cg::check_budget(&solid.cells).unwrap();
    }
    #[test]
    fn invalid_edge_treatments_are_rejected() {
        let mut p = cube();
        for radius in [-1., 2., f64::NAN] {
            p.shaping.as_mut().unwrap().radius = radius;
            assert!(build(&p).is_err());
        }
        p.shaping.as_mut().unwrap().radius = 1.;
        for edges in [vec![99.], vec![1.5], vec![8., 8.]] {
            p.shaping.as_mut().unwrap().edges = edges;
            assert!(build(&p).is_err());
        }
    }
    #[test]
    fn rounded_cage_rotates_and_translates_with_identical_volume() {
        let mut p = cube();
        let mut vertices: Vec<_> = SIGNS.iter().map(|v| scale(*v, 0.5)).collect();
        vertices[0][0] = -0.35;
        p.vertices = Some(vertices);
        p.shaping.as_mut().unwrap().edges = vec![8., 9.];
        p.shaping.as_mut().unwrap().radius = 0.3;
        let a = volume(&p);
        p.rotation_deg = 90.;
        p.position = [10., -2., 20.];
        assert!((volume(&p) - a).abs() < 1e-6);
        p.shaping.as_mut().unwrap().radius = 0.;
        let sharp = volume(&p);
        p.shaping = None;
        let original = cg::total(&crate::construction_vertex::build(&p).unwrap().cells).volume;
        assert!((sharp - original).abs() < 1e-6);
    }
}
