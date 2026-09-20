//! Bounded eight-corner trilinear solids. Rendering uses these compiled surfaces.
use crate::{construction_geometry as cg, definition::*, geometry::*};
pub struct VertexSolid {
    pub cells: Vec<cg::Cell>,
    pub faces: Vec<(String, Vec<Vec3>)>,
}
pub(crate) const SIGNS: [Vec3; 8] = [
    [-1., -1., -1.],
    [1., -1., -1.],
    [1., 1., -1.],
    [-1., 1., -1.],
    [-1., -1., 1.],
    [1., -1., 1.],
    [1., 1., 1.],
    [-1., 1., 1.],
];
pub(crate) const FACES: [(&str, [usize; 4]); 6] = [
    ("bow", [0, 3, 2, 1]),
    ("stern", [4, 5, 6, 7]),
    ("port", [0, 4, 7, 3]),
    ("starboard", [1, 2, 6, 5]),
    ("bottom", [0, 1, 5, 4]),
    ("top", [3, 7, 6, 2]),
];
fn transform(p: &ConstructionPrimitive, v: Vec3) -> Vec3 {
    let [x, y, z] = std::array::from_fn(|k| v[k] * p.size[k]);
    crate::construction_orientation::point(p, [x, y, z])
}
pub fn build(p: &ConstructionPrimitive) -> Result<VertexSolid, String> {
    if p.solid.is_some() {
        return crate::construction_solid::build(p);
    }
    if p.mesh.is_some() {
        return crate::construction_mesh::build(p);
    }
    if p.shaping.is_some() {
        return crate::construction_freeform::build(p);
    }
    let default: Vec<_> = SIGNS.iter().map(|v| scale(*v, 0.5)).collect();
    let v = p.vertices.as_ref().unwrap_or(&default);
    if v.len() != 8
        || v.iter()
            .flatten()
            .any(|x| !x.is_finite() || x.abs() > 100000.)
    {
        return Err("Vertex hull requires eight finite local corners".into());
    }
    let world: Vec<_> = v.iter().map(|v| transform(p, *v)).collect();
    if world.iter().flatten().any(|n| n.abs() > 1000.) {
        return Err("Hull corners must remain within 1000 m of the design origin".into());
    }
    let faces: Vec<_> = FACES
        .iter()
        .map(|(name, f)| {
            (
                name.to_string(),
                f.iter().map(|i| world[*i]).collect::<Vec<_>>(),
            )
        })
        .collect();
    // Planar convex blocks retain a single cell, including ordinary scaled cubes.
    if faces.iter().all(|(_, f)| {
        let n = cg::normal(f);
        let d = dot(n, f[0]);
        length(n) > 0.9
            && f.iter().all(|v| (dot(n, *v) - d).abs() < 1e-8)
            && world.iter().all(|v| dot(n, *v) - d < 1e-8)
    }) {
        let cell = cg::Cell {
            faces: faces
                .iter()
                .map(|(_, v)| ConvexVolumeFacesItem {
                    vertices: v.clone(),
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
    // A bilinear face's center is the mean of its four corners. Four triangles
    // around that center integrate its signed volume exactly, without favoring
    // either diagonal. Parameter-axis splits consequently conserve displacement.
    let center = scale(world.iter().fold([0.; 3], |a, v| add(a, *v)), 1. / 8.);
    let mut cells = vec![];
    let mut boundary = vec![];
    for (name, indices) in FACES {
        let face_center = scale(
            indices.iter().fold([0.; 3], |a, i| add(a, world[*i])),
            1. / 4.,
        );
        for edge in 0..4 {
            let a = world[indices[edge]];
            let b = world[indices[(edge + 1) % 4]];
            let det = dot(
                sub(a, center),
                cross(sub(b, center), sub(face_center, center)),
            );
            if det < -1e-8 {
                return Err("Hull folds through itself or beyond its center. Move the crossed corners back or reset this edit.".into());
            }
            if det.abs() < 1e-8 {
                continue;
            }
            let face = vec![a, b, face_center];
            boundary.push((name.to_string(), face.clone()));
            cells.push(cg::Cell {
                faces: vec![
                    face,
                    vec![center, b, a],
                    vec![center, a, face_center],
                    vec![center, face_center, b],
                ]
                .into_iter()
                .map(|vertices| ConvexVolumeFacesItem { vertices })
                .collect(),
            });
        }
    }
    if cg::total(&cells).volume < 1e-8 {
        return Err("Hull has no enclosed volume. Move its corners apart.".into());
    }
    // Positive local tetrahedra are necessary; global overlaps are also forbidden.
    for i in 0..cells.len() {
        for j in 0..i {
            if cg::intersection(&cells[i], &cells[j]).is_some_and(|c| cg::moments(&c).volume > 1e-7)
            {
                return Err(
                    "Hull overlaps itself. Move the crossed corners back or reset this edit."
                        .into(),
                );
            }
        }
    }
    let mut merged = vec![];
    for (name, _) in FACES {
        for polygon in cg::merge_patches(
            boundary
                .iter()
                .filter(|(face, _)| face == name)
                .map(|(_, p)| p.clone())
                .collect(),
        ) {
            merged.push((name.to_string(), polygon));
        }
    }
    Ok(VertexSolid {
        cells: cg::coalesce_cells(cells),
        faces: merged,
    })
}
