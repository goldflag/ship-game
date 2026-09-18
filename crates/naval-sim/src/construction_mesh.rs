//! Versioned source topology. The same closed surface owns rendering and physics.
use crate::{
    construction_geometry as cg, construction_vertex::VertexSolid, definition::*, geometry::*,
};
use std::collections::{BTreeMap, BTreeSet};

pub fn build(p: &ConstructionPrimitive) -> Result<VertexSolid, String> {
    let m = p.mesh.as_ref().ok_or("Missing freeform topology")?;
    let fail = || {
        "Invalid freeform topology: use a closed, consistently oriented solid with 4–256 vertices and at most 256 faces".to_string()
    };
    if m.version != 1.
        || !["prism", "rings", "polyhedron"].contains(&m.family.as_str())
        || m.label.is_empty()
        || m.label.len() > 80
        || !(4..=256).contains(&m.vertices.len())
        || !(4..=256).contains(&m.faces.len())
        || m.reference.len() != m.vertices.len()
        || m.vertices
            .iter()
            .chain(&m.reference)
            .flatten()
            .any(|n| !n.is_finite() || n.abs() > 100000.)
        || p.vertices.is_some()
        || p.shaping.is_some()
    {
        return Err(fail());
    }
    let index = |n: f64| n.is_finite() && n >= 0. && n.fract() == 0. && n < m.vertices.len() as f64;
    if m.rings.len() > 24
        || m.rings
            .iter()
            .any(|r| r.is_empty() || r.len() > 64 || r.iter().any(|n| !index(*n)))
    {
        return Err(fail());
    }
    let (sin, cos) = p.rotation_deg.to_radians().sin_cos();
    let world: Vec<Vec3> = m
        .vertices
        .iter()
        .map(|v| {
            let [x, y, z] = std::array::from_fn(|k| v[k] * p.size[k]);
            add(p.position, [cos * x + sin * z, y, -sin * x + cos * z])
        })
        .collect();
    if world
        .iter()
        .flatten()
        .any(|n| !n.is_finite() || n.abs() > 1000.)
    {
        return Err("Freeform vertices must remain within 1000 m of the design origin".into());
    }
    let mut ids = BTreeSet::new();
    let mut edges: BTreeMap<(usize, usize), (usize, i32)> = BTreeMap::new();
    let mut used = BTreeSet::new();
    let mut faces = Vec::new();
    for f in &m.faces {
        if f.id.is_empty()
            || f.id.len() > 80
            || !ids.insert(&f.id)
            || !(3..=64).contains(&f.corners.len())
            || ![
                "port",
                "starboard",
                "bottom",
                "top",
                "bow",
                "stern",
                "slope",
            ]
            .contains(&f.name.as_str())
            || f.corners.iter().any(|n| !index(*n))
        {
            return Err(fail());
        }
        let indices: Vec<usize> = f.corners.iter().map(|n| *n as usize).collect();
        if indices.iter().collect::<BTreeSet<_>>().len() != indices.len() {
            return Err(fail());
        }
        for (i, a) in indices.iter().enumerate() {
            used.insert(*a);
            let b = indices[(i + 1) % indices.len()];
            let e = edges.entry(((*a).min(b), (*a).max(b))).or_default();
            e.0 += 1;
            e.1 += if *a < b { 1 } else { -1 };
        }
        faces.push((
            f.name.clone(),
            indices.iter().map(|i| world[*i]).collect::<Vec<_>>(),
        ));
    }
    if used.len() != world.len() || edges.values().any(|e| *e != (2, 0)) {
        return Err(fail());
    }
    // Convex planar topology stays one cell; flat caps do not acquire fan diagonals.
    if faces.iter().all(|(_, f)| {
        let n = cg::normal(f);
        let d = dot(n, f[0]);
        length(n) > 0.9
            && f.iter().all(|v| (dot(n, *v) - d).abs() < 1e-8)
            && world.iter().all(|v| dot(n, *v) - d < 1e-8)
            && f.iter().enumerate().all(|(i, a)| {
                dot(
                    cross(
                        sub(f[(i + 1) % f.len()], *a),
                        sub(f[(i + 2) % f.len()], f[(i + 1) % f.len()]),
                    ),
                    n,
                ) >= -1e-9
            })
    }) {
        let cell = cg::Cell {
            faces: faces
                .iter()
                .map(|(_, vertices)| ConvexVolumeFacesItem {
                    vertices: vertices.clone(),
                })
                .collect(),
        };
        if cg::moments(&cell).volume > 1e-8 {
            return Ok(VertexSolid {
                cells: vec![cell],
                faces,
            });
        }
    }
    let center = scale(
        world.iter().copied().fold([0.; 3], add),
        1. / world.len() as f64,
    );
    let mut cells = Vec::new();
    let mut boundary = Vec::new();
    for (name, f) in faces {
        let fc = scale(f.iter().copied().fold([0.; 3], add), 1. / f.len() as f64);
        for i in 0..f.len() {
            let a = f[i];
            let b = f[(i + 1) % f.len()];
            let det = dot(sub(a, center), cross(sub(b, center), sub(fc, center)));
            if det < -1e-8 {
                return Err("Freeform folds through itself or beyond its center. Move the crossed points back or reset this edit.".into());
            }
            if det.abs() < 1e-8 {
                continue;
            }
            let face = vec![a, b, fc];
            boundary.push((name.clone(), face.clone()));
            cells.push(cg::Cell {
                faces: vec![
                    face,
                    vec![center, b, a],
                    vec![center, a, fc],
                    vec![center, fc, b],
                ]
                .into_iter()
                .map(|vertices| ConvexVolumeFacesItem { vertices })
                .collect(),
            });
        }
    }
    if cells.is_empty() || cells.len() > 1024 {
        return Err("Freeform is collapsed or too complex".into());
    }
    for i in 0..cells.len() {
        for j in 0..i {
            if cg::intersection(&cells[i], &cells[j]).is_some_and(|c| cg::moments(&c).volume > 1e-7)
            {
                return Err(
                    "Freeform overlaps itself. Move the crossed points back or reset this edit."
                        .into(),
                );
            }
        }
    }
    Ok(VertexSolid {
        cells: cg::coalesce_cells(cells),
        faces: boundary,
    })
}
