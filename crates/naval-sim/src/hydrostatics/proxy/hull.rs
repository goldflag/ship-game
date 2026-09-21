//! Convex envelopes of connected cell clusters, bounded against original space.
use crate::{
    construction_geometry as cg,
    definition::{ConvexVolumeFacesItem, Vec3},
    geometry::*,
};
use std::collections::{BTreeMap, BTreeSet};

const EPS: f64 = 1e-8;
const DISTANCE: f64 = 0.02;
const MAX_SOURCES: usize = 32;

fn convex_hull(mut points: Vec<Vec3>) -> Option<cg::Cell> {
    points.sort_by(|a, b| {
        a[0].total_cmp(&b[0])
            .then(a[1].total_cmp(&b[1]))
            .then(a[2].total_cmp(&b[2]))
    });
    points.dedup_by(|a, b| length(sub(*a, *b)) < EPS);
    if points.len() < 4 || points.len() > 192 {
        return None;
    }
    let b = (1..points.len()).max_by(|&a, &b| {
        length(sub(points[a], points[0])).total_cmp(&length(sub(points[b], points[0])))
    })?;
    let line = sub(points[b], points[0]);
    let c = (0..points.len()).max_by(|&a, &b| {
        length(cross(line, sub(points[a], points[0])))
            .total_cmp(&length(cross(line, sub(points[b], points[0]))))
    })?;
    let n = normalize(cross(line, sub(points[c], points[0])));
    let d = (0..points.len()).max_by(|&a, &b| {
        dot(n, sub(points[a], points[0]))
            .abs()
            .total_cmp(&dot(n, sub(points[b], points[0])).abs())
    })?;
    if dot(n, sub(points[d], points[0])).abs() < EPS {
        return None;
    }
    let inside = scale(
        add(add(points[0], points[b]), add(points[c], points[d])),
        0.25,
    );
    let face = |a, b, c| {
        let mut f = [a, b, c];
        if dot(
            cross(sub(points[b], points[a]), sub(points[c], points[a])),
            sub(inside, points[a]),
        ) > 0.
        {
            f.swap(1, 2);
        }
        f
    };
    let mut faces = vec![face(0, b, c), face(0, d, b), face(0, c, d), face(b, d, c)];
    for i in 0..points.len() {
        if [0, b, c, d].contains(&i) {
            continue;
        }
        let mut edges = BTreeMap::new();
        faces.retain(|&[a, b, c]| {
            let normal = normalize(cross(sub(points[b], points[a]), sub(points[c], points[a])));
            if dot(normal, sub(points[i], points[a])) <= EPS {
                return true;
            }
            for (a, b) in [(a, b), (b, c), (c, a)] {
                let key = (a.min(b), a.max(b));
                if edges.remove(&key).is_none() {
                    edges.insert(key, (a, b));
                }
            }
            false
        });
        for (_, (a, b)) in edges {
            faces.push(face(a, b, i));
        }
    }
    let faces: Vec<_> = faces
        .into_iter()
        .map(|f| ConvexVolumeFacesItem {
            vertices: f.map(|i| points[i]).to_vec(),
        })
        .collect();
    if faces.iter().any(|f| {
        let n = cg::normal(&f.vertices);
        length(n) < 0.99
            || points
                .iter()
                .any(|&p| dot(n, sub(p, f.vertices[0])) > EPS * 4.)
    }) {
        return None;
    }
    Some(cg::Cell {
        faces: crate::compartment_geometry::merge_faces(faces).into(),
    })
}

struct Cluster {
    ids: Vec<usize>,
    shape: cg::Cell,
    full: cg::Moments,
}

fn joined(a: &Cluster, b: &Cluster, source: &[cg::Cell]) -> Option<Cluster> {
    if a.ids.len() + b.ids.len() > MAX_SOURCES {
        return None;
    }
    let mut ids = a.ids.clone();
    ids.extend(&b.ids);
    ids.sort_unstable();
    let original: Vec<_> = ids.iter().map(|&i| &source[i]).collect();
    let points = original
        .iter()
        .flat_map(|c| c.faces.iter())
        .flat_map(|f| f.vertices.iter().copied())
        .collect();
    let shape = convex_hull(points)?;
    if shape.faces.len() > cg::MAX_CELL_FACES {
        return None;
    }
    let measured = cg::moments(&shape);
    let mut full = a.full;
    full.add(b.full);
    // Density keeps exact total displacement. Limit geometric fill before that
    // correction, so it cannot hide a filled cavity or bridge separate hulls.
    let extra = measured.volume - full.volume;
    if extra < -full.volume * 1e-8 || extra > full.volume * 0.0005 || measured.volume <= 0. {
        return None;
    }
    let shift = sub(full.center(), measured.center());
    if length(shift) > 0.005 {
        return None;
    }
    if extra > full.volume * 1e-9 {
        let mut added = vec![shape.clone()];
        for cell in &original {
            added = added.iter().flat_map(|a| cg::subtract(a, cell)).collect();
            if added.len() > 128 {
                return None;
            }
        }
        // Distance to a convex set is convex. If every corner of an added
        // piece is within the allowance of ONE original cell, its entire
        // interior is too. Comparing each corner to different cells would
        // incorrectly accept a large hole whose corners all touch material.
        if added.iter().any(|piece| {
            !original.iter().any(|cell| {
                piece.faces.iter().flat_map(|f| &f.vertices).all(|&p| {
                    length(sub(p, cg::closest_point(cell, p))) <= DISTANCE - length(shift)
                })
            })
        }) {
            return None;
        }
    }
    let shape = cg::transform(&shape, shift, [1.; 3], 0.);
    Some(Cluster { ids, shape, full })
}

pub(super) fn compact(source: &[cg::Cell]) -> Vec<(cg::Cell, cg::Moments)> {
    let mut pieces: Vec<_> = source
        .iter()
        .map(|c| {
            Some(Cluster {
                ids: vec![],
                shape: c.clone(),
                full: cg::moments(c),
            })
        })
        .collect();
    for (i, c) in pieces.iter_mut().enumerate() {
        c.as_mut().unwrap().ids.push(i);
    }
    let bounds: Vec<_> = source.iter().map(cg::bounds).collect();
    let mut order: Vec<_> = (0..source.len()).collect();
    order.sort_by(|&a, &b| {
        (bounds[a].0[2] - bounds[a].1[2] / 2.).total_cmp(&(bounds[b].0[2] - bounds[b].1[2] / 2.))
    });
    let mut active: Vec<usize> = vec![];
    let mut queue = BTreeSet::new();
    let mut neighbors = vec![BTreeSet::new(); source.len()];
    let budget = source.len().saturating_mul(64).min(100_000);
    let mut searches = budget;
    'scan: for i in order {
        active.retain(|&j| {
            bounds[j].0[2] + bounds[j].1[2] / 2. >= bounds[i].0[2] - bounds[i].1[2] / 2. - EPS
        });
        for &j in &active {
            if searches == 0 {
                break 'scan;
            }
            searches -= 1;
            if !cg::separated(&source[i], &source[j]) && cg::connected(&source[i], &source[j]) {
                neighbors[i].insert(j);
                neighbors[j].insert(i);
                queue.insert((i.min(j), i.max(j)));
            }
        }
        active.push(i);
    }
    let mut attempts = budget;
    while let Some((a, b)) = queue.pop_first() {
        if attempts == 0 {
            break;
        }
        attempts -= 1;
        let (Some(left), Some(right)) = (&pieces[a], &pieces[b]) else {
            continue;
        };
        let Some(merged) = joined(left, right, source) else {
            continue;
        };
        pieces[a] = Some(merged);
        pieces[b] = None;
        let moved = std::mem::take(&mut neighbors[b]);
        neighbors[a].extend(moved);
        neighbors[a].remove(&a);
        neighbors[a].remove(&b);
        let adjacent: Vec<_> = neighbors[a]
            .iter()
            .copied()
            .filter(|&i| pieces[i].is_some())
            .collect();
        for i in adjacent {
            neighbors[i].remove(&b);
            neighbors[i].insert(a);
            if queue.len() < budget {
                queue.insert((a.min(i), a.max(i)));
            }
        }
    }
    pieces
        .into_iter()
        .flatten()
        .map(|p| (p.shape, p.full))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn envelope_keeps_closed_convex_shapes_and_does_not_bridge_cavities() {
        let cells = vec![
            cg::box_cell([-1., 0., 0.], [2., 2., 2.]),
            cg::box_cell([1., 0., 0.], [2., 2., 2.]),
        ];
        let result = compact(&cells);
        assert_eq!(result.len(), 1);
        assert!((cg::moments(&result[0].0).volume - 16.).abs() < 1e-8);
        let gap = vec![cells[0].clone(), cg::box_cell([1.01, 0., 0.], [2., 2., 2.])];
        assert_eq!(compact(&gap).len(), 2);
        let elbow = vec![cells[0].clone(), cg::box_cell([0., 0., 2.], [4., 2., 2.])];
        assert_eq!(
            compact(&elbow).len(),
            2,
            "a concave step is not a convex hull"
        );
    }

    #[test]
    fn a_shallow_step_can_merge_with_exact_full_displacement_and_center() {
        let cells = vec![
            cg::box_cell([-1., 0., 0.], [2.; 3]),
            cg::box_cell([1., 0.001, 0.], [2.; 3]),
        ];
        let result = compact(&cells);
        assert_eq!(result.len(), 1);
        let (shape, full) = &result[0];
        let original = cg::total(&cells);
        let geometry = cg::moments(shape);
        assert!(geometry.volume > original.volume);
        assert!((full.volume - original.volume).abs() < 1e-9);
        assert!(length(sub(geometry.center(), original.center())) < 1e-9);
        for face in shape.faces.iter() {
            for &v in &face.vertices {
                assert!(cg::room_distance_within(&cells, v, f64::INFINITY) <= DISTANCE);
            }
        }
        let deep = vec![cells[0].clone(), cg::box_cell([1., 0.05, 0.], [2.; 3])];
        assert_eq!(compact(&deep).len(), 2);
    }
}
