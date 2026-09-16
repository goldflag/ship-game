//! Remove redundant convex compartment partitions without rounding coordinates.
//! Candidate hashing never decides geometry. Merges require coincident full faces,
//! convexity against every original vertex, and conserved signed volume. Sources,
//! room IDs/capacities/connections, hull geometry and weapon clearance are unchanged.
use crate::{construction_geometry as cg, definition::ConvexVolumeFacesItem, geometry::*};
use std::collections::{BTreeMap, BTreeSet};

fn face_key(vertices: &[[f64; 3]]) -> Vec<[i64; 3]> {
    // Candidate lookup only. the merge predicate applies the exact-plane
    // and convexity predicates before accepting a merge; this grid changes no vertex.
    let (mut lo, mut hi) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
    for p in vertices {
        for k in 0..3 {
            lo[k] = lo[k].min(p[k]);
            hi[k] = hi[k].max(p[k]);
        }
    }
    vec![
        lo.map(|v| (v * 1e7).round() as i64),
        hi.map(|v| (v * 1e7).round() as i64),
    ]
}

pub fn merge_faces(mut faces: Vec<ConvexVolumeFacesItem>) -> Vec<ConvexVolumeFacesItem> {
    loop {
        let mut joined = None;
        'search: for i in 0..faces.len() {
            for j in 0..i {
                let (a, b) = (&faces[i].vertices, &faces[j].vertices);
                let n = cg::normal(a);
                if dot(n, cg::normal(b)) < 1. - 1e-12
                    || b.iter().any(|p| dot(n, sub(*p, a[0])).abs() > 1e-9)
                {
                    continue;
                }
                let origin = a[0];
                let u = normalize(sub(a[1], origin));
                let v = cross(n, u);
                let mut points = a.clone();
                points.extend_from_slice(b);
                points.sort_by(|a, b| {
                    dot(sub(*a, origin), u)
                        .total_cmp(&dot(sub(*b, origin), u))
                        .then(dot(sub(*a, origin), v).total_cmp(&dot(sub(*b, origin), v)))
                });
                points.dedup_by(|a, b| length(sub(*a, *b)) < 1e-10);
                let turn =
                    |a: [f64; 3], b: [f64; 3], c: [f64; 3]| dot(cross(sub(b, a), sub(c, b)), n);
                let mut hull: Vec<[f64; 3]> = vec![];
                for p in &points {
                    while hull.len() > 1
                        && turn(hull[hull.len() - 2], hull[hull.len() - 1], *p) <= 1e-14
                    {
                        hull.pop();
                    }
                    hull.push(*p);
                }
                let lower = hull.len();
                for p in points.iter().rev().skip(1) {
                    while hull.len() > lower
                        && turn(hull[hull.len() - 2], hull[hull.len() - 1], *p) <= 1e-14
                    {
                        hull.pop();
                    }
                    hull.push(*p);
                }
                hull.pop();
                if hull.len() < 3 || cg::area(&hull) <= 1e-14 {
                    continue;
                }
                let area = cg::area(a) + cg::area(b);
                if (cg::area(&hull) - area).abs() > 1e-12_f64.max(area * 1e-11) {
                    continue;
                }
                // Geometry consumers derive the plane from the first three vertices.
                // Start with the strongest corner, not a near-collinear clipping seam.
                let corner = (0..hull.len())
                    .max_by(|&a, &b| {
                        let strength = |i: usize| {
                            length(cross(
                                sub(hull[(i + 1) % hull.len()], hull[i]),
                                sub(hull[(i + 2) % hull.len()], hull[i]),
                            ))
                        };
                        strength(a).total_cmp(&strength(b))
                    })
                    .unwrap();
                hull.rotate_left(corner);
                joined = Some((i, j, hull));
                break 'search;
            }
        }
        let Some((i, j, hull)) = joined else {
            return faces;
        };
        faces.remove(i);
        faces[j] = ConvexVolumeFacesItem { vertices: hull };
    }
}
fn same_patch(a: &[[f64; 3]], b: &[[f64; 3]]) -> bool {
    let n = cg::normal(a);
    if dot(n, cg::normal(b)) >= -1. + 1e-12 || b.iter().any(|p| dot(n, sub(*p, a[0])).abs() > 1e-9)
    {
        return false;
    }
    let inside = |p: [f64; 3], polygon: &[[f64; 3]]| {
        let n = cg::normal(polygon);
        (0..polygon.len()).all(|i| {
            let edge = sub(polygon[(i + 1) % polygon.len()], polygon[i]);
            dot(cross(edge, sub(p, polygon[i])), n) >= -1e-9 * length(edge)
        })
    };
    a.iter().all(|p| inside(*p, b)) && b.iter().all(|p| inside(*p, a))
}
fn join(a: &cg::Cell, b: &cg::Cell) -> Option<cg::Cell> {
    let mut faces = vec![];
    let mut shared = false;
    for (a, b) in [(a, b), (b, a)] {
        for f in a.faces.iter() {
            let found = b.faces.iter().any(|g| same_patch(&f.vertices, &g.vertices));
            if found {
                shared = true;
            } else {
                faces.push(f.clone());
            }
        }
    }
    if !shared {
        return None;
    }
    let points: Vec<_> = faces.iter().flat_map(|f| f.vertices.iter()).collect();
    if !faces.iter().all(|f| {
        let n = cg::normal(&f.vertices);
        points
            .iter()
            .all(|p| dot(n, sub(**p, f.vertices[0])) < 1e-9)
    }) {
        return None;
    }
    let original_points: Vec<_> = points.into_iter().copied().collect();
    let faces = merge_faces(faces);
    if !faces.iter().all(|f| {
        let n = cg::normal(&f.vertices);
        length(n) > 0.99
            && original_points
                .iter()
                .all(|p| dot(n, sub(*p, f.vertices[0])) < 1e-9)
    }) {
        return None;
    }
    if faces.len() > cg::MAX_CELL_FACES {
        return None;
    }
    Some(cg::Cell {
        faces: faces.into(),
    })
}

pub fn coalesce(mut cells: Vec<cg::Cell>) -> (Vec<cg::Cell>, usize) {
    let mut rounds = 0;
    loop {
        let mut faces = BTreeMap::<Vec<[i64; 3]>, Vec<usize>>::new();
        for (i, cell) in cells.iter().enumerate() {
            for face in cell.faces.iter() {
                faces.entry(face_key(&face.vertices)).or_default().push(i);
            }
        }
        let mut pairs = BTreeSet::new();
        for adjacent in faces.values() {
            if adjacent.len() > 16 {
                continue;
            }
            for (k, &a) in adjacent.iter().enumerate() {
                for &b in &adjacent[..k] {
                    if a != b {
                        pairs.insert((a.min(b), a.max(b)));
                    }
                }
            }
        }
        let mut slots: Vec<_> = cells.into_iter().map(Some).collect();
        let mut merged = 0;
        for (a, b) in pairs {
            let (Some(left), Some(right)) = (&slots[a], &slots[b]) else {
                continue;
            };
            // Keep numerically thin clipping debris exactly. Removing opposing
            // planes on slivers can turn a negligible-volume cell into an
            // unbounded containment predicate even when moments still agree.
            if cg::moments(left).volume < 1e-9
                || cg::moments(right).volume < 1e-9
                || cg::bounds(left)
                    .1
                    .iter()
                    .chain(cg::bounds(right).1.iter())
                    .any(|v| *v < 1e-5)
            {
                continue;
            }
            let sum = cg::total(&[left.clone(), right.clone()]);
            let Some(candidate) = join(left, right) else {
                continue;
            };
            let after = cg::moments(&candidate);
            if (after.volume - sum.volume).abs() > 1e-9_f64.max(sum.volume * 1e-10) {
                continue;
            }
            slots[a] = Some(candidate);
            slots[b] = None;
            merged += 1;
        }
        cells = slots.into_iter().flatten().collect();
        if merged == 0 {
            return (cells, rounds);
        }
        rounds += 1;
    }
}
