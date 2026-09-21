use super::*;
use crate::{contacts::contact_armor, definition::*};

fn plate(id: &str, x0: f64, x1: f64, y0: f64, y1: f64, z0: f64, z1: f64) -> Armor {
    let vertices = vec![[x0, y0, z0], [x0, y0, z1], [x1, y1, z1], [x1, y1, z0]];
    let (center, size) = crate::structure::bounds(vertices.iter().copied());
    Armor {
        id: id.into(),
        name: id.into(),
        center,
        size,
        thickness_mm: 20.,
        exterior: Some(true),
        plate: Some(ArmorPlate {
            vertices,
            material: "steel".into(),
            surface_id: Some(id.into()),
            exterior: Some(true),
            ..Default::default()
        }),
        ..Default::default()
    }
}
fn definition(armor: Vec<Armor>) -> ShipDefinition {
    ShipDefinition {
        armor,
        construction: Some(Default::default()),
        ..Default::default()
    }
}
fn cast(cache: &SurfaceContacts, def: &ShipDefinition, x: f64, z: f64) -> Vec<ShipContact> {
    let mut hits = vec![];
    cache.contacts(
        &Shell::default(),
        [x, 10., z],
        [x, -10., z],
        "ship",
        def,
        &mut hits,
    );
    hits
}

#[test]
fn merges_nearly_flat_panels_across_ids_but_preserves_hit_ownership() {
    let def = definition(vec![
        plate("left", -2., 0., 0., 0., 0., 2.),
        plate("right", 0., 2., 0., 0.02, 0., 2.),
    ]);
    let original = serde_json::to_vec(&def).unwrap();
    let cache = SurfaceContacts::new(&def);
    assert_eq!(cache.reduction(), 1);
    for (x, id) in [(-1., "left"), (1., "right")] {
        let hits = cast(&cache, &def, x, 1.);
        assert_eq!(hits.len(), 1);
        let armor = contact_armor(&def, &hits[0]);
        assert_eq!(armor.id, id);
        assert_eq!(armor.thickness_mm, 20.);
        assert!(hits[0].point[1].abs() < 0.02);
    }
    assert_eq!(serde_json::to_vec(&def).unwrap(), original);
}

#[test]
fn flat_seams_charge_once_and_visit_both_original_surfaces() {
    let def = definition(vec![
        plate("a", -2., 0., 0., 0., 0., 2.),
        plate("b", 0., 2., 0., 0., 0., 2.),
    ]);
    let cache = SurfaceContacts::new(&def);
    let hits = cast(&cache, &def, 0., 1.);
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].seam_keys.len(), 1);
    let mut shell = Shell::default();
    shell.visited.push(hits[0].key.clone());
    let mut repeated = vec![];
    cache.contacts(
        &shell,
        [0., 1., 1.],
        [0., -1., 1.],
        "ship",
        &def,
        &mut repeated,
    );
    assert!(repeated.is_empty());
}

#[test]
fn holes_gaps_layers_and_protection_boundaries_are_retained() {
    let a = plate("a", 0., 2., 0., 0., 0., 2.);
    for b in [
        plate("gap", 2.001, 4., 0., 0., 0., 2.),
        plate("layer", 0., 2., 0.001, 0.001, 0., 2.),
    ] {
        assert_eq!(
            SurfaceContacts::new(&definition(vec![a.clone(), b])).reduction(),
            0
        );
    }
    for property in 0..5 {
        let mut def = definition(vec![a.clone(), plate("b", 2., 4., 0., 0., 0., 2.)]);
        match property {
            0 => def.armor[1].thickness_mm = 30.,
            1 => def.armor[1].plate.as_mut().unwrap().material = "KC".into(),
            2 => def.armor[1].plate.as_mut().unwrap().mount_id = Some("gun".into()),
            3 => def.armor[1].exterior = Some(false),
            _ => def.connections.push(FloodConnection {
                armor_id: Some("b".into()),
                ..Default::default()
            }),
        }
        assert_eq!(SurfaceContacts::new(&def).reduction(), 0);
    }
    let def = definition(vec![
        a,
        plate("b", 2., 4., 0., 0., 0., 2.),
        plate("c", 0., 2., 0., 0., 2., 4.),
    ]);
    let cache = SurfaceContacts::new(&def);
    assert_eq!(cache.reduction(), 2);
    assert!(
        cast(&cache, &def, 3., 3.).is_empty(),
        "the missing corner must stay empty"
    );
}

#[test]
fn successive_merges_keep_the_original_curve_within_the_error_budget() {
    let def = definition(
        (0..20)
            .map(|i| {
                let x = i as f64;
                plate(
                    &format!("p{i}"),
                    x,
                    x + 1.,
                    x * x * 0.003,
                    (x + 1.).powi(2) * 0.003,
                    0.,
                    2.,
                )
            })
            .collect(),
    );
    let cache = SurfaceContacts::new(&def);
    assert!(cache.reduction() > 0 && cache.reduction() < 19);
    for (armor, ids) in cache.armor.iter().zip(&cache.sources) {
        let p = &armor.plate.as_ref().unwrap().vertices;
        let n = cg::normal(p);
        for &i in ids {
            for &v in &def.armor[i].plate.as_ref().unwrap().vertices {
                assert!(dot(n, sub(v, p[0])).abs() <= DISTANCE_M + 1e-9);
            }
        }
    }
    let long = definition(vec![
        plate("a", -100., 0., 0., 0., 0., 2.),
        plate("b", 0., 100., 0., 1., 0., 2.),
    ]);
    assert_eq!(
        SurfaceContacts::new(&long).reduction(),
        0,
        "a small angle on a long plate can still move too far"
    );
}
