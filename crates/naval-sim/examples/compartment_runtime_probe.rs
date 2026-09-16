//! Offline compartment coalescing probe. Writes only to the explicitly supplied output.
use naval_sim::{
    construction_geometry as cg,
    definition::{ConvexVolumeFacesItem, ShipDefinition},
    geometry::*,
};
use std::{
    collections::{BTreeMap, BTreeSet},
    time::Instant,
};

fn face_key(vertices: &[[f64; 3]]) -> Vec<[i64; 3]> {
    // Candidate lookup only. cg::coalesce_cells applies the original exact-plane
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

fn bounded_join(a: &cg::Cell, b: &cg::Cell, tolerance: f64) -> Option<cg::Cell> {
    if !a
        .faces
        .iter()
        .any(|f| b.faces.iter().any(|g| same_patch(&f.vertices, &g.vertices)))
    {
        return None;
    }
    let points: Vec<_> = a
        .faces
        .iter()
        .chain(b.faces.iter())
        .flat_map(|f| f.vertices.iter().copied())
        .collect();
    let (center, size) = naval_sim::structure::bounds(points.iter().copied());
    let mut result = cg::box_cell(center, size);
    for f in a.faces.iter().chain(b.faces.iter()) {
        let n = cg::normal(&f.vertices);
        let d = points
            .iter()
            .map(|p| dot(*p, n))
            .fold(f64::NEG_INFINITY, f64::max);
        result = cg::clip(&result, n, d)?;
    }
    if result.faces.len() > cg::MAX_CELL_FACES {
        return None;
    }
    // Vertex distance is a sampled geometric guard, not a Hausdorff proof.
    if result.faces.iter().flat_map(|f| &f.vertices).any(|&p| {
        length(sub(p, cg::closest_point(a, p))).min(length(sub(p, cg::closest_point(b, p))))
            > tolerance
    }) {
        return None;
    }
    Some(result)
}
fn coalesce(mut cells: Vec<cg::Cell>, tolerance: f64) -> (Vec<cg::Cell>, usize) {
    let mut rounds = 0;
    let mut extra_budget = cg::total(&cells).volume * 0.001;
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
            let Some(candidate) = join(left, right).or_else(|| {
                if tolerance > 0. {
                    bounded_join(left, right, tolerance)
                } else {
                    None
                }
            }) else {
                continue;
            };
            let after = cg::moments(&candidate);
            let delta = after.volume - sum.volume;
            let exact_limit = 1e-9_f64.max(sum.volume * 1e-10);
            if delta.abs() > exact_limit {
                if tolerance <= 0.
                    || delta < 0.
                    || delta > extra_budget
                    || delta > sum.volume * 0.0001
                {
                    continue;
                }
                extra_budget -= delta;
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
fn columns(room: &naval_sim::definition::Compartment, pitch: f64) -> Vec<cg::Cell> {
    let cells = room.volumes.as_ref().unwrap();
    // Retain small/thin disconnected spaces exactly; never remove a room.
    if room.capacity_m3 < 20. || room.size[0].min(room.size[2]) < pitch {
        return cells.clone();
    }
    let low = [
        room.center[0] - room.size[0] * 0.5,
        room.center[2] - room.size[2] * 0.5,
    ];
    let mut bins = BTreeMap::<[i64; 2], (cg::Moments, f64, f64)>::new();
    for cell in cells {
        let (center, size) = cg::bounds(cell);
        let first = [
            ((center[0] - size[0] * 0.5 - low[0]) / pitch).floor() as i64,
            ((center[2] - size[2] * 0.5 - low[1]) / pitch).floor() as i64,
        ];
        let last = [
            ((center[0] + size[0] * 0.5 - low[0]) / pitch).floor() as i64,
            ((center[2] + size[2] * 0.5 - low[1]) / pitch).floor() as i64,
        ];
        for x in first[0]..=last[0] {
            for z in first[1]..=last[1] {
                let mut clipped = Some(cell.clone());
                for (axis, k) in [(0, x), (2, z)] {
                    let j = usize::from(axis == 2);
                    for (sign, d) in [
                        (-1., -(low[j] + k as f64 * pitch)),
                        (1., low[j] + (k + 1) as f64 * pitch),
                    ] {
                        let mut normal = [0.; 3];
                        normal[axis] = sign;
                        clipped = clipped.and_then(|c| cg::clip(&c, normal, d));
                    }
                }
                if let Some(c) = clipped {
                    let m = cg::moments(&c);
                    let (c0, s0) = cg::bounds(&c);
                    // Sub-nanolitre clipping slivers have unreliable signed moments.
                    if m.volume > 1e-7 && m.center().iter().all(|v| v.is_finite()) {
                        let bin = bins.entry([x, z]).or_insert((
                            cg::Moments::default(),
                            f64::INFINITY,
                            f64::NEG_INFINITY,
                        ));
                        bin.0.add(m);
                        bin.1 = bin.1.min(c0[1] - s0[1] * 0.5);
                        bin.2 = bin.2.max(c0[1] + s0[1] * 0.5);
                    }
                }
            }
        }
    }
    let gross: f64 = bins.values().map(|m| m.0.volume).sum();
    let capacity_scale = room.capacity_m3 / gross;
    bins.into_iter()
        .map(|([x, z], (m, lo, hi))| {
            let height = m.volume * capacity_scale / (pitch * pitch);
            let center_y = if lo + height * 0.5 <= hi - height * 0.5 {
                m.center()[1].clamp(lo + height * 0.5, hi - height * 0.5)
            } else {
                (lo + hi) * 0.5
            };
            let center = [
                low[0] + (x as f64 + 0.5) * pitch,
                center_y,
                low[1] + (z as f64 + 0.5) * pitch,
            ];
            cg::box_cell(center, [pitch, height, pitch])
        })
        .collect()
}
fn main() {
    let args: Vec<_> = std::env::args().collect();
    let input = args
        .get(1)
        .map(String::as_str)
        .unwrap_or("public/models/admiral-hipper-construction.json");
    let output = args
        .get(2)
        .expect("Provide a .build output definition path");
    assert!(
        output.starts_with(".build/"),
        "Probe output must stay in .build/"
    );
    let mut definition: ShipDefinition =
        serde_json::from_slice(&std::fs::read(input).unwrap()).unwrap();
    let mode = args.get(3).map(String::as_str).unwrap_or("join");
    let pitch = args.get(4).map(|s| s.parse::<f64>().unwrap()).unwrap_or(2.);
    assert!(pitch.is_finite() && pitch > 0.);
    let mut report = vec![];
    let started = Instant::now();
    for (i, room) in definition.compartments.iter_mut().enumerate() {
        let Some(cells) = room.volumes.clone() else {
            continue;
        };
        let count = cells.len();
        let before = cg::total(&cells);
        let (cells, rounds) = if mode == "columns" {
            (columns(room, pitch), 0)
        } else if mode == "bounded" {
            coalesce(cells, pitch)
        } else {
            naval_sim::compartment_geometry::coalesce(cells)
        };
        let after = cg::total(&cells);
        report.push(serde_json::json!({"room":room.id,"beforeCells":count,"afterCells":cells.len(),"rounds":rounds,"volumeErrorM3":after.volume-before.volume,"centerErrorM":(0..3).map(|k|(after.center()[k]-before.center()[k]).abs()).fold(0.,f64::max)}));
        eprintln!("room {i}: {count} -> {} ({rounds} rounds)", cells.len());
        room.volumes = Some(cells);
    }
    std::fs::write(output, serde_json::to_vec(&definition).unwrap()).unwrap();
    println!(
        "{}",
        serde_json::json!({"seconds":started.elapsed().as_secs_f64(),"rooms":report,"adopted":false,"mode":mode,"pitchM":pitch})
    );
}
