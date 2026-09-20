//! Compact derived geometry without crossing authored material or room boundaries.

use crate::{construction_geometry as cg, definition::*};
use std::collections::BTreeMap;

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
        let patches = crate::compartment_geometry::merge_faces(
            group
                .iter()
                .map(|a| ConvexVolumeFacesItem {
                    vertices: a.plate.as_ref().unwrap().vertices.clone(),
                })
                .collect(),
        );
        let mut compacted = vec![];
        let mut mapped = BTreeMap::new();
        for (template, face) in group.iter().zip(patches) {
            let polygon = face.vertices;
            let mut a = template.clone();
            let normal = cg::normal(&polygon);
            for old in &group {
                let vertices = &old.plate.as_ref().unwrap().vertices;
                let center = crate::geometry::scale(
                    vertices.iter().copied().fold([0.; 3], crate::geometry::add),
                    1. / vertices.len() as f64,
                );
                if crate::geometry::dot(normal, cg::normal(vertices)) > 1. - 1e-10
                    && crate::geometry::dot(normal, crate::geometry::sub(center, polygon[0])).abs()
                        < cg::EPS
                    && (0..polygon.len()).all(|i| {
                        let edge =
                            crate::geometry::sub(polygon[(i + 1) % polygon.len()], polygon[i]);
                        crate::geometry::dot(
                            crate::geometry::cross(edge, crate::geometry::sub(center, polygon[i])),
                            normal,
                        ) >= -cg::EPS
                    })
                {
                    mapped.insert(old.id.clone(), a.id.clone());
                }
            }
            (a.center, a.size) = crate::structure::bounds(polygon.iter().copied());
            a.plate.as_mut().unwrap().vertices = polygon;
            compacted.push(a);
        }
        if group.iter().all(|a| mapped.contains_key(&a.id)) {
            remap.extend(mapped);
            armor.extend(compacted);
        } else {
            // Numerically degenerate authoring geometry keeps its original
            // coverage and IDs instead of guessing a protection owner.
            for a in group {
                remap.insert(a.id.clone(), a.id.clone());
                armor.push(a);
            }
        }
    }
    remap
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
                (0..3).filter_map(move |y| {
                    (x != 1 || y != 1).then(|| plate(&format!("{x}-{y}"), x as f64, y as f64))
                })
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
                (0..3).filter_map(move |z| {
                    (x != 1 || z != 1).then(|| cg::box_cell([x as f64, 0., z as f64], [1., 1., 1.]))
                })
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
