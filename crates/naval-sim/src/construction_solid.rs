//! Compound solids: one hull block authored as an ordered union of convex parts.
//! Arbitrary closed geometry — concave, tunnelled, thin-walled or several shells — reaches
//! the compiler already decomposed, so validation stays local and total: every part must be a
//! closed, planar-faced, outward-wound convex polyhedron, and parts may not share volume.
//! The exterior boundary is then whatever survives being covered by a sibling part, which is
//! the same exposure rule neighboring hull pieces use.
use crate::{
    construction_geometry as cg, construction_vertex::VertexSolid, definition::*, geometry::*,
};
use std::collections::{BTreeMap, BTreeSet};

/// Source bounds. `MAX_PART_FACES` is the derived-cell face budget, so a validated part
/// always fits one convex cell; `MAX_PARTS` keeps a block inside the whole-design cell cap.
pub const MAX_VERTICES: usize = 8_192;
pub const MAX_PARTS: usize = 256;
pub const MAX_PART_FACES: usize = cg::MAX_CELL_FACES;
pub const MAX_FACES: usize = 8_192;
pub const MAX_FACE_CORNERS: usize = 64;
/// Exterior patches one block may contribute after sibling parts cover each other.
const MAX_PATCHES: usize = 32_768;
/// Coplanar patches of one surface group are joined below this count; larger groups keep
/// their part-by-part patches so a maximal block cannot spend quadratic time here.
const MERGE_LIMIT: usize = 64;
/// Cubic metres. A part below the floor is degenerate; overlap above it is a real solid.
const MIN_PART_VOLUME: f64 = 1e-7;
const MAX_PART_OVERLAP: f64 = 1e-7;

fn extent_of(points: impl Iterator<Item = Vec3> + Clone) -> (Vec3, Vec3) {
    let (center, size) = crate::structure::bounds(points);
    (
        std::array::from_fn(|i| center[i] - size[i] * 0.5),
        std::array::from_fn(|i| center[i] + size[i] * 0.5),
    )
}
/// A face plane of either cell with every point of the other beyond it. Convex parts that
/// merely meet face to face are separated by their shared plane, so the exact intersection
/// is reserved for pairs that really interpenetrate.
fn plane_separated(a: &cg::Cell, b: &cg::Cell, tolerance: f64) -> bool {
    let beyond = |x: &cg::Cell, y: &cg::Cell| {
        x.faces.iter().any(|f| {
            let n = cg::normal(&f.vertices);
            let d = dot(n, f.vertices[0]);
            y.faces
                .iter()
                .flat_map(|g| g.vertices.iter())
                .all(|v| dot(n, *v) - d >= -tolerance)
        })
    };
    beyond(a, b) || beyond(b, a)
}

pub fn build(p: &ConstructionPrimitive) -> Result<VertexSolid, String> {
    let s = p.solid.as_ref().ok_or("Missing compound solid")?;
    if s.version != 1. {
        return Err("Compound solid needs version 1".into());
    }
    if p.vertices.is_some() || p.mesh.is_some() || p.shaping.is_some() {
        return Err(
            "A compound solid replaces the vertices, mesh and shaping records; remove them".into(),
        );
    }
    if s.label.is_empty() || s.label.len() > 80 {
        return Err("Compound solid needs a label of 1–80 bytes".into());
    }
    if !(4..=MAX_VERTICES).contains(&s.vertices.len()) {
        return Err(format!(
            "Compound solid carries {} shared vertices; the range is 4–{MAX_VERTICES}",
            s.vertices.len()
        ));
    }
    if !(1..=MAX_PARTS).contains(&s.parts.len()) {
        return Err(format!(
            "Compound solid carries {} convex parts; the range is 1–{MAX_PARTS}",
            s.parts.len()
        ));
    }
    let polygons_total: usize = s.parts.iter().map(|part| part.faces.len()).sum();
    if polygons_total > MAX_FACES {
        return Err(format!(
            "Compound solid carries {polygons_total} polygons; the limit is {MAX_FACES}"
        ));
    }
    // Normalized, unlike a freeform mesh: `size` and `position` then really are the block's
    // envelope, so `ship:near`, `ship:bounds`, placement ghosts and mirroring stay honest
    // about geometry the editor cannot otherwise see.
    if let Some((i, v)) = s
        .vertices
        .iter()
        .enumerate()
        .find(|(_, v)| v.iter().any(|n| !n.is_finite() || n.abs() > 0.5 + 1e-9))
    {
        return Err(format!(
            "Compound solid vertex {i} is {v:?}; every local corner must be finite and within ±0.5, so `size` is the block's envelope"
        ));
    }
    let world: Vec<Vec3> = s
        .vertices
        .iter()
        .map(|v| {
            let [x, y, z] = std::array::from_fn(|k| v[k] * p.size[k]);
            crate::construction_orientation::point(p, [x, y, z])
        })
        .collect();
    if world
        .iter()
        .flatten()
        .any(|n| !n.is_finite() || n.abs() > 1000.)
    {
        return Err(
            "Compound solid vertices must remain within 1000 m of the design origin".into(),
        );
    }
    // Planarity and winding are scale-relative: the same source at 0.5 m and at 300 m must
    // pass or fail identically, and float noise grows with the coordinates.
    let (low, high) = extent_of(world.iter().copied());
    let extent = (0..3).map(|i| high[i] - low[i]).fold(0., f64::max).max(1.);
    let tolerance = 1e-7 * extent;

    let mut ids = BTreeSet::new();
    let mut cells: Vec<cg::Cell> = Vec::with_capacity(s.parts.len());
    let mut groups: Vec<Vec<Option<String>>> = Vec::with_capacity(s.parts.len());
    for (i, part) in s.parts.iter().enumerate() {
        let at = |what: String| format!("Compound solid part {i} ({}) {what}", part.id);
        if part.id.is_empty() || part.id.len() > 64 || !part.id.is_ascii() {
            return Err(format!(
                "Compound solid part {i} needs an ID of 1–64 ASCII characters"
            ));
        }
        if !ids.insert(part.id.as_str()) {
            return Err(format!(
                "Compound solid part {i} repeats the part ID {}",
                part.id
            ));
        }
        if !(4..=MAX_PART_FACES).contains(&part.faces.len()) {
            return Err(at(format!(
                "carries {} polygons; a convex part needs 4–{MAX_PART_FACES}",
                part.faces.len()
            )));
        }
        let mut edges: BTreeMap<(usize, usize), (usize, i32)> = BTreeMap::new();
        let mut used = BTreeSet::new();
        let mut polygons: Vec<Vec<Vec3>> = Vec::with_capacity(part.faces.len());
        let mut labels: Vec<Option<String>> = Vec::with_capacity(part.faces.len());
        for (j, f) in part.faces.iter().enumerate() {
            if !(3..=MAX_FACE_CORNERS).contains(&f.corners.len()) {
                return Err(at(format!(
                    "polygon {j} lists {} corners; the range is 3–{MAX_FACE_CORNERS}",
                    f.corners.len()
                )));
            }
            if f.group
                .as_ref()
                .is_some_and(|g| g.is_empty() || g.len() > 64 || !g.is_ascii() || g.contains(':'))
            {
                return Err(at(format!(
                    "polygon {j} needs a surface group of 1–64 ASCII characters without ':'"
                )));
            }
            let mut indices = Vec::with_capacity(f.corners.len());
            for (k, n) in f.corners.iter().enumerate() {
                if !n.is_finite() || *n < 0. || n.fract() != 0. || *n >= s.vertices.len() as f64 {
                    return Err(at(format!(
                        "polygon {j} corner {k} is {n}, not a vertex index in 0..{}",
                        s.vertices.len()
                    )));
                }
                indices.push(*n as usize);
            }
            if indices.iter().collect::<BTreeSet<_>>().len() != indices.len() {
                return Err(at(format!("polygon {j} uses one corner twice")));
            }
            let polygon: Vec<Vec3> = indices.iter().map(|k| world[*k]).collect();
            let n = cg::normal(&polygon);
            if !n.iter().all(|v| v.is_finite()) || length(n) < 0.9 {
                return Err(at(format!(
                    "polygon {j} is degenerate: its first three corners are coincident or collinear"
                )));
            }
            let d = dot(n, polygon[0]);
            if polygon.iter().any(|v| (dot(n, *v) - d).abs() > tolerance) {
                return Err(at(format!(
                    "polygon {j} is not planar within {tolerance:.2e} m"
                )));
            }
            for k in 0..polygon.len() {
                let (a, b, c) = (
                    polygon[k],
                    polygon[(k + 1) % polygon.len()],
                    polygon[(k + 2) % polygon.len()],
                );
                if dot(cross(sub(b, a), sub(c, b)), n) < -tolerance * extent {
                    return Err(at(format!(
                        "polygon {j} turns the wrong way at corner {k}: a part face must be convex and wound counter-clockwise seen from outside"
                    )));
                }
            }
            if cg::area(&polygon) <= tolerance * extent {
                return Err(at(format!("polygon {j} encloses no area")));
            }
            for (k, a) in indices.iter().enumerate() {
                used.insert(*a);
                let b = indices[(k + 1) % indices.len()];
                let e = edges.entry(((*a).min(b), (*a).max(b))).or_default();
                e.0 += 1;
                e.1 += if *a < b { 1 } else { -1 };
            }
            labels.push(f.group.clone());
            polygons.push(polygon);
        }
        if let Some(((a, b), (count, net))) = edges.iter().find(|(_, e)| **e != (2, 0)) {
            return Err(at(format!(
                "is not closed: the edge between vertices {a} and {b} appears {count} times with net direction {net}, but a closed part walks every edge twice, once each way"
            )));
        }
        let points: Vec<Vec3> = used.iter().map(|k| world[*k]).collect();
        for (j, polygon) in polygons.iter().enumerate() {
            let n = cg::normal(polygon);
            let d = dot(n, polygon[0]);
            if points.iter().any(|v| dot(n, *v) - d > tolerance)
                && points.iter().any(|v| dot(n, *v) - d < -tolerance)
            {
                return Err(at(format!(
                    "is not convex: the plane of polygon {j} cuts through it. Split this part, or re-import the mesh so the decomposition does it"
                )));
            }
        }
        let cell = cg::Cell {
            faces: polygons
                .iter()
                .map(|vertices| ConvexVolumeFacesItem {
                    vertices: vertices.clone(),
                })
                .collect(),
        };
        let volume = cg::moments(&cell).volume;
        if volume <= -MIN_PART_VOLUME {
            return Err(at(
                "is inside-out: reverse the corner order of its polygons so the normals face outward".into(),
            ));
        }
        if volume < MIN_PART_VOLUME {
            return Err(at(format!(
                "encloses {volume:.2e} m³; a part must enclose more than {MIN_PART_VOLUME:.0e} m³"
            )));
        }
        cells.push(cell);
        groups.push(labels);
    }
    cg::check_budget(&cells)?;
    let index = cg::Broadphase::sized_for(&cells);
    for (i, cell) in cells.iter().enumerate() {
        for j in index.candidates(cell) {
            if j >= i
                || cg::separated(cell, &cells[j])
                || plane_separated(cell, &cells[j], tolerance)
            {
                continue;
            }
            if cg::intersection(cell, &cells[j])
                .is_some_and(|c| cg::moments(&c).volume > MAX_PART_OVERLAP)
            {
                return Err(format!(
                    "Compound solid parts {} and {} share volume; parts meet face to face and never interpenetrate",
                    s.parts[j].id, s.parts[i].id
                ));
            }
        }
    }
    // Whatever a sibling part covers is interior: one block's skin, armor and buoyancy then
    // match a single closed surface however the decomposition split it.
    let mut patches: BTreeMap<String, Vec<cg::Polygon>> = BTreeMap::new();
    let mut order: Vec<String> = Vec::new();
    let mut count = 0usize;
    for (i, cell) in cells.iter().enumerate() {
        for (j, face) in cell.faces.iter().enumerate() {
            let (low, high) = extent_of(face.vertices.iter().copied());
            let neighbors: Vec<usize> = index
                .candidates_box(low, high)
                .into_iter()
                .filter(|&k| k != i)
                .collect();
            let mut exposed = vec![face.vertices.clone()];
            for k in neighbors {
                if exposed.is_empty() {
                    break;
                }
                exposed = exposed
                    .iter()
                    .flat_map(|patch| cg::exposed(patch, &cells[k], i < k))
                    .collect();
            }
            for patch in exposed {
                if patch.len() < 3 || cg::area(&patch) < cg::EPS {
                    continue;
                }
                count += 1;
                if count > MAX_PATCHES {
                    return Err(format!(
                        "Compound solid exposes more than {MAX_PATCHES} surface patches; simplify the mesh before importing it"
                    ));
                }
                let name = crate::construction::face_name(&patch, p);
                let label = match &groups[i][j] {
                    Some(group) => format!("{name}:{group}"),
                    None => name,
                };
                let bucket = patches.entry(label.clone()).or_default();
                if bucket.is_empty() {
                    order.push(label);
                }
                bucket.push(patch);
            }
        }
    }
    let mut faces = Vec::with_capacity(count);
    for label in order {
        let bucket = patches.remove(&label).unwrap_or_default();
        let joined = if bucket.len() <= MERGE_LIMIT {
            cg::merge_patches(bucket)
        } else {
            bucket
        };
        faces.extend(joined.into_iter().map(|polygon| (label.clone(), polygon)));
    }
    Ok(VertexSolid { cells, faces })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The rejection message for a source that must not compile. `VertexSolid` carries raw
    /// geometry and derives no `Debug`, so the success case cannot be unwrapped for its text.
    fn fails(p: &ConstructionPrimitive) -> String {
        match build(p) {
            Ok(_) => panic!("expected the compound solid to be rejected"),
            Err(message) => message,
        }
    }
    /// A rectangular block as one part, in the shared pool's coordinates.
    pub(super) fn box_part(
        vertices: &mut Vec<[f64; 3]>,
        id: &str,
        low: Vec3,
        high: Vec3,
        group: Option<&str>,
    ) -> ConstructionSolidPart {
        let base = vertices.len();
        for i in 0..8 {
            vertices.push([
                if i & 1 == 0 { low[0] } else { high[0] },
                if i & 2 == 0 { low[1] } else { high[1] },
                if i & 4 == 0 { low[2] } else { high[2] },
            ]);
        }
        // Outward-wound quads of a unit cube indexed by the bit pattern above.
        let quads = [
            [0, 4, 6, 2],
            [1, 3, 7, 5],
            [0, 1, 5, 4],
            [2, 6, 7, 3],
            [0, 2, 3, 1],
            [4, 5, 7, 6],
        ];
        ConstructionSolidPart {
            id: id.into(),
            faces: quads
                .iter()
                .map(|q| ConstructionSolidFace {
                    corners: q.iter().map(|k| (base + k) as f64).collect(),
                    group: group.map(str::to_string),
                })
                .collect(),
        }
    }
    /// Helpers author in metres; the source is normalized, so fold the extent into `size`
    /// exactly as the importer does.
    pub(super) fn primitive(
        vertices: Vec<[f64; 3]>,
        parts: Vec<ConstructionSolidPart>,
    ) -> ConstructionPrimitive {
        let axis = |k: usize| {
            let values = vertices.iter().map(|v| v[k]);
            let low = values.clone().fold(f64::INFINITY, f64::min);
            (low, values.fold(f64::NEG_INFINITY, f64::max) - low)
        };
        let frame: [(f64, f64); 3] = std::array::from_fn(axis);
        let size: Vec3 = std::array::from_fn(|k| if frame[k].1 > 0. { frame[k].1 } else { 1. });
        let vertices = vertices
            .iter()
            .map(|v| std::array::from_fn(|k| (v[k] - frame[k].0) / size[k] - 0.5))
            .collect();
        ConstructionPrimitive {
            id: "solid".into(),
            kind: "vertex".into(),
            size,
            position: [0.; 3],
            rotation_deg: 0.,
            solid: Some(ConstructionSolid {
                version: 1.,
                label: "Test solid".into(),
                vertices,
                parts,
            }),
            ..Default::default()
        }
    }
    /// An L in the XY plane: a tall leg and a foot that meet on one face.
    fn l_shape() -> ConstructionPrimitive {
        let mut vertices = vec![];
        let parts = vec![
            box_part(
                &mut vertices,
                "leg",
                [0., 0., 0.],
                [1., 3., 1.],
                Some("leg"),
            ),
            box_part(
                &mut vertices,
                "foot",
                [1., 0., 0.],
                [3., 1., 1.],
                Some("foot"),
            ),
        ];
        primitive(vertices, parts)
    }

    #[test]
    fn concave_parts_union_into_one_block_with_one_outer_skin() {
        let solid = build(&l_shape()).unwrap();
        assert_eq!(solid.cells.len(), 2);
        assert!((cg::total(&solid.cells).volume - 5.).abs() < 1e-9);
        // The 1 m² face the two parts share is interior and must not be plated.
        let area: f64 = solid.faces.iter().map(|(_, f)| cg::area(f)).sum();
        assert!((area - 22.).abs() < 1e-6, "{area}");
        assert!(solid.faces.iter().all(|(name, _)| name.contains(':')));
        let leg: f64 = solid
            .faces
            .iter()
            .filter(|(name, _)| name.ends_with(":leg"))
            .map(|(_, f)| cg::area(f))
            .sum();
        assert!((leg - 13.).abs() < 1e-6, "{leg}");
    }

    #[test]
    fn size_is_the_envelope_and_scales_the_normalized_frame() {
        let mut p = l_shape();
        // The L already fills a 3 x 3 x 1 envelope; stretching it must scale the volume.
        assert_eq!(p.size, [3., 3., 1.]);
        p.size = [6., 3., 4.];
        let solid = build(&p).unwrap();
        assert!((cg::total(&solid.cells).volume - 5. * 2. * 4.).abs() < 1e-9);
    }

    #[test]
    fn a_corner_outside_the_normalized_frame_is_named_and_refused() {
        let mut p = l_shape();
        p.solid.as_mut().unwrap().vertices[3][1] = 0.75;
        let error = fails(&p);
        assert!(error.contains("vertex 3") && error.contains("±0.5"), "{error}");
    }

    /// A square annulus: four strips around a 1 x 1 x 1 bore, so the block has a hole
    /// through it and a genus no single convex piece can carry.
    fn tunnel() -> ConstructionPrimitive {
        let mut vertices = vec![];
        let parts = vec![
            box_part(
                &mut vertices,
                "sill",
                [0., 0., 0.],
                [3., 1., 1.],
                Some("out"),
            ),
            box_part(
                &mut vertices,
                "head",
                [0., 2., 0.],
                [3., 3., 1.],
                Some("out"),
            ),
            box_part(
                &mut vertices,
                "port",
                [0., 1., 0.],
                [1., 2., 1.],
                Some("out"),
            ),
            box_part(
                &mut vertices,
                "stbd",
                [2., 1., 0.],
                [3., 2., 1.],
                Some("out"),
            ),
        ];
        primitive(vertices, parts)
    }

    #[test]
    fn a_tunnel_keeps_its_bore_plated_and_its_seams_bare() {
        let solid = build(&tunnel()).unwrap();
        assert_eq!(solid.cells.len(), 4);
        assert!((cg::total(&solid.cells).volume - 8.).abs() < 1e-9);
        // Two 8 m² pierced end faces, 12 m² of rim and the four 1 m² walls of the bore.
        // The eight seam faces where the strips meet are interior and carry no plate.
        let area: f64 = solid.faces.iter().map(|(_, f)| cg::area(f)).sum();
        assert!((area - 32.).abs() < 1e-6, "{area}");
    }

    #[test]
    fn a_thin_plate_compiles_at_its_authored_thickness() {
        let mut vertices = vec![];
        let parts = vec![box_part(
            &mut vertices,
            "plate",
            [0.; 3],
            [20., 0.02, 5.],
            None,
        )];
        let solid = build(&primitive(vertices, parts)).unwrap();
        assert!((cg::total(&solid.cells).volume - 2.).abs() < 1e-9);
        let area: f64 = solid.faces.iter().map(|(_, f)| cg::area(f)).sum();
        assert!((area - 201.).abs() < 1e-6, "{area}");
    }

    #[test]
    fn the_same_source_compiles_to_the_same_surfaces_every_time() {
        let read = |p: &ConstructionPrimitive| {
            build(p)
                .unwrap()
                .faces
                .iter()
                .map(|(name, f)| format!("{name} {:.9}", cg::area(f)))
                .collect::<Vec<_>>()
        };
        let p = tunnel();
        assert_eq!(read(&p), read(&p));
    }

    #[test]
    fn overlapping_parts_name_both_parts() {
        let mut vertices = vec![];
        let parts = vec![
            box_part(&mut vertices, "a", [0.; 3], [2.; 3], None),
            box_part(&mut vertices, "b", [1.; 3], [3.; 3], None),
        ];
        let error = fails(&primitive(vertices, parts));
        assert!(error.contains("parts a and b share volume"), "{error}");
    }

    #[test]
    fn open_inverted_and_non_convex_parts_are_named_and_indexed() {
        let cube = || {
            let mut vertices = vec![];
            let part = box_part(&mut vertices, "a", [0.; 3], [1.; 3], None);
            (vertices, vec![part])
        };

        // Three polygons short of closed: every remaining edge still names its own gap.
        let (vertices, mut parts) = cube();
        parts[0].faces.truncate(4);
        let error = fails(&primitive(vertices, parts));
        assert!(error.contains("part 0 (a) is not closed"), "{error}");

        let (vertices, mut parts) = cube();
        for face in &mut parts[0].faces {
            face.corners.reverse();
        }
        let error = fails(&primitive(vertices, parts));
        assert!(error.contains("is inside-out"), "{error}");

        // Pull one corner of the cube through the opposite face: still closed, no longer convex.
        let (mut vertices, parts) = cube();
        vertices[7] = [-2., -2., -2.];
        let error = fails(&primitive(vertices, parts));
        assert!(
            error.contains("is not convex") || error.contains("not planar"),
            "{error}"
        );

        // A polygon that indexes past the shared pool names the part, polygon and corner.
        let (vertices, mut parts) = cube();
        parts[0].faces[0].corners[1] = 99.;
        let error = fails(&primitive(vertices, parts));
        assert!(
            error.contains("polygon 0 corner 1 is 99, not a vertex index in 0..8"),
            "{error}"
        );
    }
}

#[cfg(test)]
mod bench {
    use super::*;
    /// Not an assertion: prints the wall clock of a maximal block so the documented limits
    /// stand on a measured number. `cargo test -p naval-sim --release solid_cost -- --nocapture`.
    #[test]
    fn solid_cost() {
        for parts in [16usize, 64, 256] {
            let mut vertices = vec![];
            let mut list = vec![];
            for i in 0..parts {
                let (x, z) = ((i % 16) as f64, (i / 16) as f64);
                list.push(super::tests::box_part(
                    &mut vertices,
                    &format!("p{i}"),
                    [x, 0., z],
                    [x + 1., 1., z + 1.],
                    Some("skin"),
                ));
            }
            let p = super::tests::primitive(vertices, list);
            let start = std::time::Instant::now();
            let solid = build(&p).unwrap();
            println!(
                "{parts} parts -> {} patches in {:.1} ms",
                solid.faces.len(),
                start.elapsed().as_secs_f64() * 1000.
            );
        }
    }
}
