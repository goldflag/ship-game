//! Simplify a disjoint convex decomposition without changing its occupied space.
use crate::{construction_geometry as cg, definition::ConvexVolumeFacesItem, geometry::*};
use std::collections::BTreeSet;

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

const TOLERANCE: f64 = 1e-9;

struct Piece {
    cell: cg::Cell,
    points: Vec<crate::definition::Vec3>,
    planes: Vec<(crate::definition::Vec3, f64)>,
    volume: f64,
    mergeable: bool,
}

impl Piece {
    fn new(cell: cg::Cell) -> Self {
        let points = cell
            .faces
            .iter()
            .flat_map(|f| f.vertices.iter().copied())
            .collect();
        let planes = cell
            .faces
            .iter()
            .map(|f| {
                let n = cg::normal(&f.vertices);
                (n, dot(n, f.vertices[0]))
            })
            .collect();
        let volume = cg::moments(&cell).volume;
        let mergeable = volume >= 1e-9 && cg::bounds(&cell).1.iter().all(|&v| v >= 1e-5);
        Self {
            mergeable,
            cell,
            points,
            planes,
            volume,
        }
    }

    fn contains(&self, p: crate::definition::Vec3) -> bool {
        self.planes.iter().all(|&(n, d)| dot(n, p) - d <= TOLERANCE)
    }
}

fn join(a: &Piece, b: &Piece) -> Option<Piece> {
    // Keep numerically thin CSG debris unchanged. Its nearly opposing planes
    // are part of containment even when its signed volume is negligible.
    if !a.mergeable || !b.mergeable {
        return None;
    }
    let mut faces = vec![];
    let mut shared = false;
    for (a, b) in [(a, b), (b, a)] {
        for (f, &(n, d)) in a.cell.faces.iter().zip(&a.planes) {
            if b.points.iter().all(|&p| dot(n, p) - d <= TOLERANCE) {
                faces.push(f.clone());
            } else if b
                .planes
                .iter()
                .any(|&(bn, bd)| dot(n, bn) < -1. + 1e-12 && (d + bd).abs() < TOLERANCE)
                && f.vertices.iter().all(|&p| b.contains(p))
            {
                // This whole face lies inside the other operand. Partial face
                // contact leaves a concave step and cannot remove a boundary.
                shared = true;
            } else {
                return None;
            }
        }
    }
    if !shared {
        return None;
    }
    let faces = merge_faces(faces);
    // Consumers derive planes from the first three vertices. Revalidate those
    // planes after removing tessellation seams, not only their signed volume.
    if !faces.iter().all(|f| {
        let n = cg::normal(&f.vertices);
        length(n) > 0.99
            && a.points
                .iter()
                .chain(&b.points)
                .all(|&p| dot(n, sub(p, f.vertices[0])) <= TOLERANCE)
    }) {
        return None;
    }
    if faces.len() > cg::MAX_CELL_FACES {
        return None;
    }
    let merged = Piece::new(cg::Cell {
        faces: faces.into(),
    });
    let expected = a.volume + b.volume;
    ((merged.volume - expected).abs() <= 1e-9_f64.max(expected.abs() * 1e-10)).then_some(merged)
}

fn replace(
    a: usize,
    b: usize,
    merged: Piece,
    pieces: &mut [Option<Piece>],
    neighbors: &mut [BTreeSet<usize>],
    queue: &mut BTreeSet<(usize, usize)>,
    budget: usize,
) {
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
    for other in adjacent {
        if queue.len() < budget {
            queue.insert((a.min(other), a.max(other)));
        }
        neighbors[other].remove(&b);
        neighbors[other].insert(a);
    }
}

/// Merge only convex unions within one connected room. Adjacency is carried
/// forward after each merge; unrelated pairs are never rescanned. The attempt
/// budget makes this an optional, bounded optimization for pathological input.
/// Exhausting it retains the remaining exact cells rather than rejecting a ship.
/// Returns the compact partition and number of cell merges.
pub fn coalesce(cells: Vec<cg::Cell>) -> (Vec<cg::Cell>, usize) {
    let before = cells.len();
    let compact = compact(cells);
    let merges = before - compact.len();
    (compact, merges)
}

fn compact(cells: Vec<cg::Cell>) -> Vec<cg::Cell> {
    let budget = cells.len().saturating_mul(128).min(1_000_000);
    with_budget(cells, budget)
}

fn with_budget(cells: Vec<cg::Cell>, mut budget: usize) -> Vec<cg::Cell> {
    if cells.len() < 2 {
        return cells;
    }
    let mut neighbors = vec![BTreeSet::new(); cells.len()];
    let mut queue = BTreeSet::new();
    let bounds: Vec<_> = cells.iter().map(cg::bounds).collect();
    let (_, extent) = crate::structure::bounds(
        cells
            .iter()
            .flat_map(|c| c.faces.iter())
            .flat_map(|f| f.vertices.iter().copied()),
    );
    let axis = (0..3)
        .max_by(|&a, &b| extent[a].total_cmp(&extent[b]))
        .unwrap();
    let mut order: Vec<_> = (0..cells.len()).collect();
    order.sort_by(|&a, &b| {
        (bounds[a].0[axis] - bounds[a].1[axis] * 0.5)
            .total_cmp(&(bounds[b].0[axis] - bounds[b].1[axis] * 0.5))
    });
    let mut active: Vec<usize> = vec![];
    let mut searches = budget;
    'search: for i in order {
        let (center, size) = bounds[i];
        let mut next = vec![];
        for j in active {
            if searches == 0 {
                break 'search;
            }
            searches -= 1;
            let (other, other_size) = bounds[j];
            if other[axis] + other_size[axis] * 0.5 < center[axis] - size[axis] * 0.5 - TOLERANCE {
                continue;
            }
            next.push(j);
            if (0..3).all(|k| {
                (center[k] - other[k]).abs() <= (size[k] + other_size[k]) * 0.5 + TOLERANCE
            }) {
                neighbors[i].insert(j);
                neighbors[j].insert(i);
                queue.insert((i.min(j), i.max(j)));
            }
        }
        next.push(i);
        active = next;
    }
    let mut pieces: Vec<_> = cells.into_iter().map(|c| Some(Piece::new(c))).collect();
    while let Some((a, b)) = queue.pop_first() {
        if budget == 0 {
            break;
        }
        budget -= 1;
        let (Some(left), Some(right)) = (&pieces[a], &pieces[b]) else {
            continue;
        };
        let Some(merged) = join(left, right) else {
            continue;
        };
        replace(
            a,
            b,
            merged,
            &mut pieces,
            &mut neighbors,
            &mut queue,
            budget,
        );
    }
    pieces.into_iter().flatten().map(|p| p.cell).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_same_space(before: &[cg::Cell], after: &[cg::Cell]) {
        let (a, b) = (cg::total(before), cg::total(after));
        assert!((a.volume - b.volume).abs() < 1e-7);
        for i in 0..3 {
            assert!((a.first[i] - b.first[i]).abs() < 1e-7);
            assert!((a.second[i] - b.second[i]).abs() < 1e-7);
        }
        for n in [[1., 0., 0.], [0., 1., 0.], normalize([1., 2., 3.])] {
            for level in -12..12 {
                let (a, b) = (
                    cg::submerged(before, n, level as f64 * 0.23),
                    cg::submerged(after, n, level as f64 * 0.23),
                );
                assert!((a.volume - b.volume).abs() < 1e-7);
                for i in 0..3 {
                    assert!((a.first[i] - b.first[i]).abs() < 1e-7);
                    assert!((a.second[i] - b.second[i]).abs() < 1e-7);
                }
            }
        }
    }

    #[test]
    fn partial_face_neighbors_merge_when_the_complete_union_becomes_convex() {
        let before = vec![
            cg::box_cell([0., 0., 0.], [2., 4., 2.]),
            cg::box_cell([2., -1., 0.], [2., 2., 2.]),
            cg::box_cell([2., 1., 0.], [2., 2., 2.]),
        ];
        let after = compact(before.clone());
        assert_eq!(after.len(), 1);
        assert_same_space(&before, &after);
    }

    #[test]
    fn concave_steps_holes_and_disconnected_spaces_are_not_filled() {
        for before in [
            vec![
                cg::box_cell([0.; 3], [2.; 3]),
                cg::box_cell([2., -0.5, 0.], [2., 1., 2.]),
            ],
            cg::subtract(
                &cg::box_cell([0.; 3], [4.; 3]),
                &cg::box_cell([0.; 3], [1., 5., 1.]),
            ),
            vec![
                cg::box_cell([0.; 3], [1.; 3]),
                cg::box_cell([2., 0., 0.], [1.; 3]),
            ],
        ] {
            let after = compact(before.clone());
            assert!(after.len() > 1);
            assert_same_space(&before, &after);
        }
    }

    #[test]
    fn equivalent_shared_faces_do_not_require_matching_tessellation() {
        let mut left = cg::box_cell([0.; 3], [2.; 3]);
        left.faces = left
            .faces
            .iter()
            .flat_map(|face| {
                (1..face.vertices.len() - 1).map(|i| ConvexVolumeFacesItem {
                    vertices: vec![face.vertices[0], face.vertices[i], face.vertices[i + 1]],
                })
            })
            .collect::<Vec<_>>()
            .into();
        let before = vec![left, cg::box_cell([2., 0., 0.], [2.; 3])];
        assert_eq!(
            cg::coalesce_cells(before.clone()).len(),
            2,
            "old exact-face matching misses this seam"
        );
        let after = compact(before.clone());
        assert_eq!(after.len(), 1);
        assert_eq!(after[0].faces.len(), 6);
        assert_same_space(&before, &after);
    }

    #[test]
    fn arbitrary_cuts_preserve_clipped_volume_centroid_and_inertia() {
        for step in 0..12 {
            let outer = cg::box_cell([0.; 3], [8., 6., 10.]);
            let mut before = vec![outer];
            // Triangulation planes and the unrelated planes of earlier CSG
            // cutters leave these seams in the construction interior.
            for (n, d) in [
                ([1., 0., 0.], 0.3),
                ([0., 1., 0.], -0.4),
                ([0., 0., 1.], 1.),
                (normalize([1., 2., 0.]), 0.7),
                (normalize([0., 1., 3.]), -1.2),
            ] {
                before = before
                    .iter()
                    .flat_map(|c| [cg::clip(c, n, d), cg::clip(c, scale(n, -1.), -d)])
                    .flatten()
                    .collect();
            }
            let cutters = [
                cg::transform(
                    &cg::box_cell([0.; 3], [1., 8., 2.]),
                    [1., 0., 0.],
                    [1.; 3],
                    step as f64 * 0.17,
                ),
                cg::box_cell([-2., -1., 2.], [1., 2., 3.]),
            ];
            before = cg::subtract_all(before, &cutters).unwrap();
            let after = compact(before.clone());
            assert!(after.len() < before.len());
            assert_same_space(&before, &after);
            // Bidirectional subtraction also checks the full spatial union,
            // independently of the sampled waterplanes and global moments.
            assert!(cg::total(&cg::subtract_all(before.clone(), &after).unwrap()).volume < 1e-7);
            assert!(cg::total(&cg::subtract_all(after, &before).unwrap()).volume < 1e-7);
        }
    }

    #[test]
    fn exhausted_work_budget_keeps_the_exact_remaining_partition() {
        let before: Vec<_> = (0..12)
            .map(|i| cg::box_cell([i as f64, 0., 0.], [1.; 3]))
            .collect();
        assert_eq!(
            serde_json::to_value(with_budget(before.clone(), 0)).unwrap(),
            serde_json::to_value(&before).unwrap()
        );
        let after = with_budget(before.clone(), 4);
        assert!(after.len() > 1);
        assert_same_space(&before, &after);
    }
}
