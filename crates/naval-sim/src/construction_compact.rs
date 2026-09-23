//! Compact derived geometry without crossing authored material or room boundaries.

use crate::{construction_geometry as cg, definition::*};
use std::collections::{BTreeMap, BTreeSet};

pub fn compact_armor(armor: &mut Vec<Armor>) -> BTreeMap<String, String> {
    let mut lookup = BTreeMap::new();
    let mut remap = BTreeMap::new();
    let mut groups: Vec<Vec<Armor>> = vec![];
    for a in armor.drain(..) {
        if a.plate.is_none() {
            groups.push(vec![a]);
            continue;
        }
        // Every physical/authoring attribute must match; only tessellation data
        // and derived IDs/bounds may differ. References are generated afterwards.
        let mut key = a.clone();
        key.id.clear();
        key.center = [0.; 3];
        key.size = [0.; 3];
        key.plate.as_mut().unwrap().vertices.clear();
        let key = serde_json::to_string(&key).unwrap();
        let i = *lookup.entry(key).or_insert_with(|| {
            groups.push(vec![]);
            groups.len() - 1
        });
        groups[i].push(a);
    }
    for group in groups {
        if group.len() == 1 {
            remap.insert(group[0].id.clone(), group[0].id.clone());
            armor.extend(group);
            continue;
        }
        let limit = group.len().saturating_mul(128).min(1_000_000);
        for patch in compact_armor_group(group, limit) {
            for old in patch.original_ids {
                remap.insert(old, patch.armor.id.clone());
            }
            armor.push(patch.armor);
        }
    }
    remap
}

struct ArmorPatch {
    armor: Armor,
    original_ids: Vec<String>,
    bounds: (Vec3, Vec3),
}

/// A pair can be replaced by its convex hull only if it is disjoint and the
/// hull covers both complete operands with their combined area. Overlap can
/// otherwise cancel a filled gap in the area-sum check.
fn joined_armor_polygon(a: &[Vec3], b: &[Vec3]) -> Option<Vec<Vec3>> {
    use crate::geometry::*;
    if a.len() < 3 || b.len() < 3 {
        return None;
    }
    let normal = cg::normal(a);
    if length(normal) < 0.99
        || dot(normal, cg::normal(b)) < 1. - 1e-12
        || b.iter().any(|&p| dot(normal, sub(p, a[0])).abs() > 1e-9)
    {
        return None;
    }
    let mut overlap = a.to_vec();
    for i in 0..b.len() {
        let edge = sub(b[(i + 1) % b.len()], b[i]);
        let side = normalize(cross(edge, normal));
        if length(side) < 0.99 {
            return None;
        }
        overlap = cg::clip_polygon(&overlap, side, dot(side, b[i]));
        if overlap.len() < 3 {
            break;
        }
    }
    if overlap.len() >= 3 && cg::area(&overlap) > 0. {
        return None;
    }
    let mut joined = crate::compartment_geometry::merge_faces(vec![
        ConvexVolumeFacesItem {
            vertices: a.to_vec(),
        },
        ConvexVolumeFacesItem {
            vertices: b.to_vec(),
        },
    ]);
    if joined.len() != 1 {
        return None;
    }
    let polygon = joined.pop().unwrap().vertices;
    let normal = cg::normal(&polygon);
    if length(normal) < 0.99
        || !a.iter().chain(b).all(|&p| {
            dot(normal, sub(p, polygon[0])).abs() <= 1e-9
                && (0..polygon.len()).all(|i| {
                    let edge = sub(polygon[(i + 1) % polygon.len()], polygon[i]);
                    dot(cross(edge, sub(p, polygon[i])), normal) >= -1e-9 * length(edge)
                })
        })
    {
        return None;
    }
    Some(polygon)
}

/// Carry source ownership through each accepted merge. Geometry is never used
/// to rediscover provenance, so tiny or coincident patches cannot steal links.
fn compact_armor_group(group: Vec<Armor>, limit: usize) -> Vec<ArmorPatch> {
    let mut patches: Vec<_> = group
        .into_iter()
        .map(|armor| {
            let bounds =
                crate::structure::bounds(armor.plate.as_ref().unwrap().vertices.iter().copied());
            Some(ArmorPatch {
                original_ids: vec![armor.id.clone()],
                armor,
                bounds,
            })
        })
        .collect();
    let mut neighbors = vec![BTreeSet::new(); patches.len()];
    let mut pairs = BTreeSet::new();
    let mut searches = limit;
    'search: for i in 0..patches.len() {
        let (center, size) = patches[i].as_ref().unwrap().bounds;
        for j in 0..i {
            if searches == 0 {
                break 'search;
            }
            searches -= 1;
            let (other, extent) = patches[j].as_ref().unwrap().bounds;
            if (0..3).all(|k| (center[k] - other[k]).abs() <= (size[k] + extent[k]) * 0.5 + 1e-9) {
                neighbors[i].insert(j);
                neighbors[j].insert(i);
                pairs.insert((i, j));
            }
        }
    }
    let mut attempts = limit;
    let mut vertex_work = patches.len().saturating_mul(4096).min(4_000_000);
    while let Some((i, j)) = pairs.pop_first() {
        if attempts == 0 {
            break;
        }
        attempts -= 1;
        let (Some(a), Some(b)) = (&patches[i], &patches[j]) else {
            continue;
        };
        let (av, bv) = (
            &a.armor.plate.as_ref().unwrap().vertices,
            &b.armor.plate.as_ref().unwrap().vertices,
        );
        let cost = av
            .len()
            .saturating_mul(bv.len())
            .saturating_mul(4)
            .saturating_add(av.len().saturating_add(bv.len()).saturating_mul(16));
        if cost > vertex_work {
            continue;
        }
        vertex_work -= cost;
        let Some(polygon) = joined_armor_polygon(av, bv) else {
            continue;
        };
        let removed = patches[i].take().unwrap();
        let survivor = patches[j].as_mut().unwrap();
        survivor.original_ids.extend(removed.original_ids);
        survivor.bounds = crate::structure::bounds(polygon.iter().copied());
        (survivor.armor.center, survivor.armor.size) = survivor.bounds;
        survivor.armor.plate.as_mut().unwrap().vertices = polygon;
        let moved = std::mem::take(&mut neighbors[i]);
        neighbors[j].extend(moved);
        neighbors[j].remove(&i);
        neighbors[j].remove(&j);
        let adjacent: Vec<_> = neighbors[j]
            .iter()
            .copied()
            .filter(|&k| patches[k].is_some())
            .collect();
        for k in adjacent {
            neighbors[k].remove(&i);
            neighbors[k].insert(j);
            if pairs.len() < attempts {
                pairs.insert((k.max(j), k.min(j)));
            }
        }
    }
    patches.into_iter().flatten().collect()
}

pub fn exterior_clearance(cells: &[cg::Cell]) -> Vec<MountClearanceProfileBodiesItem> {
    let index = cg::Broadphase::sized_for(cells);
    cells
        .iter()
        .enumerate()
        .filter_map(|(i, cell)| {
            let nearby: Vec<_> = index
                .candidates(cell)
                .into_iter()
                .filter(|&j| i != j && !cg::separated(cell, &cells[j]))
                .collect();
            let mut surface = AuthoredSurface::default();
            for face in cell.faces.iter() {
                let mut patches = vec![face.vertices.clone()];
                for &j in &nearby {
                    patches = patches
                        .iter()
                        .flat_map(|p| cg::exposed(p, &cells[j], i < j))
                        .collect();
                    if patches.is_empty() {
                        break;
                    }
                }
                for polygon in patches
                    .into_iter()
                    .filter(|p| p.len() >= 3 && cg::area(p) > cg::EPS)
                {
                    let base = surface.vertices.len();
                    surface.triangles.extend(
                        (1..polygon.len() - 1)
                            .map(|j| [base as f64, (base + j) as f64, (base + j + 1) as f64]),
                    );
                    surface.vertices.extend(polygon);
                }
            }
            (!surface.triangles.is_empty()).then(|| MountClearanceProfileBodiesItem {
                id: format!("hull-cell-{i}"),
                mount_id: None,
                surface,
            })
        })
        .collect()
}

pub fn compact_connections(connections: &mut Vec<FloodConnection>) {
    let mut groups: BTreeMap<String, usize> = BTreeMap::new();
    let mut result: Vec<FloodConnection> = vec![];
    for (order, mut c) in connections.drain(..).enumerate() {
        c.transfer_order = Some(order as f64);
        if c.state.as_deref() != Some("closed")
            || c.armor_id.is_none()
            || c.position.is_none()
            || c.bounds.is_none()
            || c.patches.is_some()
            || c.thickness_mm.is_some()
        {
            result.push(c);
            continue;
        }
        let key =
            serde_json::to_string(&(&c.from_id, &c.to_id, &c.armor_id, &c.state, c.thickness_mm))
                .unwrap();
        let patch = |c: &FloodConnection| FloodConnectionPatch {
            area_m2: c.area_m2,
            position: c.position.unwrap(),
            bounds: FloodConnectionPatchBounds {
                center: c.bounds.as_ref().unwrap().center,
                size: c.bounds.as_ref().unwrap().size,
            },
            transfer_order: c.transfer_order.unwrap(),
        };
        if let Some(&i) = groups.get(&key) {
            let group = &mut result[i];
            if group.patches.is_none() {
                group.patches = Some(vec![patch(group)]);
            }
            group.patches.as_mut().unwrap().push(patch(&c));
            let (a, b) = (group.bounds.as_ref().unwrap(), c.bounds.as_ref().unwrap());
            let lo = std::array::from_fn(|k| {
                (a.center[k] - a.size[k] / 2.).min(b.center[k] - b.size[k] / 2.)
            });
            let hi = std::array::from_fn(|k| {
                (a.center[k] + a.size[k] / 2.).max(b.center[k] + b.size[k] / 2.)
            });
            let (center, size) = crate::structure::bounds([lo, hi].into_iter());
            group.bounds = Some(FloodConnectionBounds { center, size });
            group.area_m2 += c.area_m2;
            // Display center only; runtime transfer always uses individual patches.
            group.position = Some(center);
        } else {
            groups.insert(key, result.len());
            result.push(c);
        }
    }
    *connections = result;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plate(id: &str, x: f64, y: f64) -> Armor {
        Armor {
            id: id.into(),
            name: "panel".into(),
            thickness_mm: 20.,
            exterior: Some(true),
            plate: Some(ArmorPlate {
                vertices: vec![
                    [x, y, 0.],
                    [x + 1., y, 0.],
                    [x + 1., y + 1., 0.],
                    [x, y + 1., 0.],
                ],
                material: "steel".into(),
                surface_id: Some("panel".into()),
                exterior: Some(true),
                ..Default::default()
            }),
            ..Default::default()
        }
    }

    #[test]
    fn armor_merges_only_compatible_adjacent_patches() {
        let mut armor = vec![plate("a", 0., 0.), plate("b", 1., 0.), plate("c", 3., 0.)];
        armor.push(plate("thick", 0., 1.));
        armor[3].thickness_mm = 30.;
        compact_armor(&mut armor);
        assert_eq!(armor.len(), 3);
        assert_eq!(armor[0].id, "a");
        assert!((cg::area(&armor[0].plate.as_ref().unwrap().vertices) - 2.).abs() < 1e-10);
    }

    #[test]
    fn armor_preserves_openings_and_mount_ownership() {
        let mut armor: Vec<_> = (0..3)
            .flat_map(|x| {
                (0..3)
                    .filter(move |&y| x != 1 || y != 1)
                    .map(move |y| plate(&format!("{x}-{y}"), x as f64, y as f64))
            })
            .collect();
        compact_armor(&mut armor);
        assert!(armor.len() > 1);
        assert!(
            (armor
                .iter()
                .map(|a| cg::area(&a.plate.as_ref().unwrap().vertices))
                .sum::<f64>()
                - 8.)
                .abs()
                < 1e-10
        );
        let mut armor = vec![plate("a", 0., 0.), plate("b", 1., 0.)];
        armor[1].plate.as_mut().unwrap().mount_id = Some("mount".into());
        compact_armor(&mut armor);
        assert_eq!(armor.len(), 2);
    }

    #[test]
    fn armor_keeps_thin_real_plates_and_remaps_every_owner() {
        let mut a = plate("a", 0., 0.);
        a.plate.as_mut().unwrap().vertices = vec![[0., 0., 0.], [1., 0., 0.], [1., 1e-8, 0.]];
        let mut b = a.clone();
        b.id = "b".into();
        b.plate.as_mut().unwrap().vertices = vec![[0., 0., 0.], [1., 1e-8, 0.], [0., 1e-8, 0.]];
        let mut armor = vec![a, b];
        let map = compact_armor(&mut armor);
        assert_eq!(map.len(), 2);
        assert!(
            armor
                .iter()
                .all(|a| a.plate.as_ref().unwrap().vertices.len() >= 3)
        );
        assert!(
            (armor
                .iter()
                .map(|a| cg::area(&a.plate.as_ref().unwrap().vertices))
                .sum::<f64>()
                - 1e-8)
                .abs()
                < 1e-15
        );
    }

    #[test]
    fn armor_overlap_cannot_cancel_a_gap_in_the_convex_hull_area() {
        let mut a = plate("a", 0., 0.);
        a.plate.as_mut().unwrap().vertices =
            vec![[0., 0., 0.], [2., 0., 0.], [2., 1., 0.], [0., 1., 0.]];
        let mut b = plate("b", 1., 0.5);
        b.plate.as_mut().unwrap().vertices =
            vec![[1., 0.5, 0.], [3., 0.5, 0.], [3., 1.5, 0.], [1., 1.5, 0.]];
        // Sum=4 m² and convex hull=4 m², but overlap=0.5 m² and true
        // union=3.5 m². An area-sum check alone fills real unarmored space.
        let mut armor = vec![a, b];
        let map = compact_armor(&mut armor);
        assert_eq!(armor.len(), 2);
        assert_eq!(map["a"], "a");
        assert_eq!(map["b"], "b");
    }

    #[test]
    fn armor_disconnected_thin_plates_keep_their_own_damage_links() {
        let mut armor = vec![plate("a", 0., 0.), plate("b", 1.1, 0.)];
        for a in &mut armor {
            for p in &mut a.plate.as_mut().unwrap().vertices {
                p[1] *= 1e-8;
            }
        }
        let map = compact_armor(&mut armor);
        assert_eq!(armor.len(), 2);
        assert_eq!(map["a"], "a");
        assert_eq!(map["b"], "b");
    }

    #[test]
    fn armor_exhausted_budget_preserves_every_source_patch_and_owner() {
        for limit in [0, 1, 4] {
            let original: Vec<_> = (0..64)
                .map(|i| plate(&format!("plate-{i}"), i as f64, 0.))
                .collect();
            let compact = compact_armor_group(original.clone(), limit);
            assert!(compact.len() >= original.len() - limit);
            let mut retained: Vec<_> = compact
                .iter()
                .flat_map(|p| p.original_ids.iter().cloned())
                .collect();
            let mut expected: Vec<_> = original.iter().map(|a| a.id.clone()).collect();
            retained.sort();
            expected.sort();
            assert_eq!(retained, expected);
            assert!(compact.iter().all(|p| p.original_ids.contains(&p.armor.id)));
            assert!(
                (compact
                    .iter()
                    .map(|p| cg::area(&p.armor.plate.as_ref().unwrap().vertices))
                    .sum::<f64>()
                    - 64.)
                    .abs()
                    < 1e-10
            );
        }
    }

    #[test]
    fn connection_groups_keep_original_order_across_ungrouped_entries() {
        let c = FloodConnection {
            id: Some("first".into()),
            from_id: "a".into(),
            to_id: "b".into(),
            state: Some("closed".into()),
            area_m2: 1.,
            armor_id: Some("wall".into()),
            position: Some([0.; 3]),
            bounds: Some(FloodConnectionBounds {
                center: [0.; 3],
                size: [1.; 3],
            }),
            ..Default::default()
        };
        let mut other = c.clone();
        other.armor_id = Some("other".into());
        let mut door = c.clone();
        door.state = Some("open".into());
        let mut connections = vec![c.clone(), other, c, door];
        compact_connections(&mut connections);
        assert_eq!(connections.len(), 3);
        assert_eq!(
            connections[0]
                .patches
                .as_ref()
                .unwrap()
                .iter()
                .map(|p| p.transfer_order)
                .collect::<Vec<_>>(),
            vec![0., 2.]
        );
        assert_eq!(connections[1].transfer_order, Some(1.));
        assert_eq!(connections[2].transfer_order, Some(3.));
        assert_eq!(connections[0].area_m2, 2.);
    }

    #[test]
    fn clearance_removes_shared_faces_but_keeps_courtyard() {
        let cells = vec![
            cg::box_cell([0., 0., 0.], [2., 2., 2.]),
            cg::box_cell([2., 0., 0.], [2., 2., 2.]),
        ];
        let bodies = exterior_clearance(&cells);
        let triangles: usize = bodies.iter().map(|b| b.surface.triangles.len()).sum();
        assert_eq!(triangles, 20);
        assert!(!bodies.iter().any(|b| b.surface.triangles.iter().any(|t| {
            t.iter()
                .all(|i| (b.surface.vertices[*i as usize][0] - 1.).abs() < 1e-8)
        })));
        let cells: Vec<_> = (0..3)
            .flat_map(|x| {
                (0..3)
                    .filter(move |&z| x != 1 || z != 1)
                    .map(move |z| cg::box_cell([x as f64, 0., z as f64], [1., 1., 1.]))
            })
            .collect();
        let bodies = exterior_clearance(&cells);
        // The four inward courtyard walls survive; no hull is drawn across the opening.
        let inner_area: f64 = bodies
            .iter()
            .flat_map(|b| {
                b.surface
                    .triangles
                    .iter()
                    .map(|t| t.map(|i| b.surface.vertices[i as usize]))
            })
            .filter(|t| {
                let p = crate::geometry::scale(
                    t.iter().copied().fold([0.; 3], crate::geometry::add),
                    1. / 3.,
                );
                p[1].abs() < 0.49 && p[0] >= 0.5 && p[0] <= 1.5 && p[2] >= 0.5 && p[2] <= 1.5
            })
            .map(|t| cg::area(&t))
            .sum();
        assert!((inner_area - 4.).abs() < 1e-8);
    }
}
