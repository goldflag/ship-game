//! Source block orientation, shared by physical geometry and overlap queries.
use crate::{construction_geometry as cg, definition::*, geometry::*};
pub fn valid(p: &ConstructionPrimitive) -> bool {
    p.rotation_deg.is_finite()
        && p.rotation_deg.abs() <= 3600.
        && p.tilt.as_ref().is_none_or(|t| {
            t.version == 1.
                && [t.pitch_deg, t.roll_deg]
                    .iter()
                    .all(|n| n.is_finite() && n.abs() <= 3600.)
        })
}
pub fn rotate(p: &ConstructionPrimitive, v: Vec3) -> Vec3 {
    let [mut x, mut y, mut z] = v;
    if let Some(t) = &p.tilt {
        let (s, c) = t.roll_deg.to_radians().sin_cos();
        (x, y) = (c * x - s * y, s * x + c * y);
        let (s, c) = t.pitch_deg.to_radians().sin_cos();
        (y, z) = (c * y - s * z, s * y + c * z);
    }
    let (s, c) = p.rotation_deg.to_radians().sin_cos();
    [c * x + s * z, y, -s * x + c * z]
}
pub fn inverse(p: &ConstructionPrimitive, v: Vec3) -> Vec3 {
    std::array::from_fn(|k| {
        let mut axis = [0.; 3];
        axis[k] = 1.;
        dot(rotate(p, axis), v)
    })
}
pub fn point(p: &ConstructionPrimitive, v: Vec3) -> Vec3 {
    add(p.position, rotate(p, v))
}
pub fn cell(p: &ConstructionPrimitive, c: &cg::Cell, size: Vec3) -> cg::Cell {
    // Preserve legacy arithmetic and serialized outputs exactly for level blocks.
    if p.tilt.is_none() {
        return cg::transform(c, p.position, size, p.rotation_deg.to_radians());
    }
    cg::Cell {
        faces: c
            .faces
            .iter()
            .map(|f| ConvexVolumeFacesItem {
                vertices: f
                    .vertices
                    .iter()
                    .map(|v| point(p, std::array::from_fn(|k| v[k] * size[k])))
                    .collect(),
            })
            .collect(),
    }
}
