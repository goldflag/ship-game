//! Integrated ammunition uses the same retained components and native fit/combat definitions.
use naval_sim::{construction, definition::*};
fn fixture() -> (ConstructionSource, ConstructionCatalog) {
    let catalog: ConstructionCatalog = serde_json::from_str(include_str!(
        "../../../public/models/components/catalog.json"
    ))
    .unwrap();
    let source = ConstructionSource {
        schema_version: 1.,
        id: "integral-review".into(),
        revision: "r1".into(),
        name: "Integrated ammunition".into(),
        coordinates: "meters-y-up-bow-negative-z".into(),
        construction: ConstructionData {
            version: 2.,
            catalog_revision: catalog.revision.clone(),
            default_thickness_mm: 16.,
            primitives: vec![ConstructionPrimitive {
                id: "hull".into(),
                kind: "box".into(),
                position: [0.; 3],
                size: [24., 16., 80.],
                ..Default::default()
            }],
            ..Default::default()
        },
    };
    (source, catalog)
}
#[test]
fn every_retained_gun_has_a_magazine_and_can_be_raised_without_lifting_ammunition() {
    let (source, catalog) = fixture();
    for part in catalog.equipment.iter().filter(|p| p.kind == "gun") {
        let mut source = source.clone();
        let attachment = part
            .sockets
            .iter()
            .flatten()
            .find(|s| s.id == "attachment")
            .map_or(0., |s| s.position[1]);
        source.construction.equipment.push(ConstructionEquipment {
            id: "gun".into(),
            part_id: part.id.clone(),
            position: [0., 8. - attachment, 0.],
            ..Default::default()
        });
        let normal = construction::compile(&source, &catalog);
        let normal = normal
            .definition
            .unwrap_or_else(|| panic!("{}: {:?}", part.id, normal.diagnostics));
        let gun = &mut source.construction.equipment[0];
        gun.position[1] += 2.;
        gun.gun = Some(ConstructionEquipmentGun {
            barbette_height_m: Some(2.),
            ..Default::default()
        });
        let raised = construction::compile(&source, &catalog);
        let raised = raised
            .definition
            .unwrap_or_else(|| panic!("raised {}: {:?}", part.id, raised.diagnostics));
        let mag = |d: &ShipDefinition| {
            d.modules
                .iter()
                .find(|m| m.kind == "magazine")
                .unwrap()
                .clone()
        };
        assert!((0..3).all(|i| (mag(&normal).center[i] - mag(&raised).center[i]).abs() < 1e-9), "{}", part.id);
        assert!(mag(&raised).center[1] + mag(&raised).size[1] / 2. < 8.);
        assert_eq!(
            raised.mounts[0].magazine_id.as_ref(),
            Some(&mag(&raised).id)
        );
        assert!(
            raised
                .mount_clearance
                .as_ref()
                .unwrap()
                .bodies
                .as_ref()
                .unwrap()
                .iter()
                .any(|b| b.id.contains("barbette"))
        );
    }
}
#[test]
fn torpedo_banks_carry_their_own_ready_ammunition_and_retain_rotation() {
    let (mut source, catalog) = fixture();
    let parts: Vec<_> = catalog
        .equipment
        .iter()
        .filter(|p| p.kind == "torpedo-launcher")
        .collect();
    for (i, part) in parts.iter().enumerate() {
        let attachment = part
            .sockets
            .iter()
            .flatten()
            .find(|s| s.id == "attachment")
            .map_or(0., |s| s.position[1]);
        source.construction.equipment.push(ConstructionEquipment {
            id: format!("bank-{i}"),
            part_id: part.id.clone(),
            position: [0., 8. - attachment, -15. + i as f64 * 30.],
            bearing_deg: 45.,
            ..Default::default()
        });
    }
    let result = construction::compile(&source, &catalog);
    let def = result
        .definition
        .unwrap_or_else(|| panic!("{:?}", result.diagnostics));
    for (i, part) in parts.iter().enumerate() {
        let id = format!("bank-{i}");
        let magazine = def
            .modules
            .iter()
            .find(|m| m.id == format!("{id}-magazine"))
            .unwrap();
        assert_eq!(magazine.kind, "magazine");
        assert_eq!(magazine.torpedo_launcher_id.as_deref(), Some(id.as_str()));
        assert_eq!(magazine.placement.as_deref(), Some("fixed"));
        let tubes: Vec<_> = def
            .torpedo_tubes
            .as_ref()
            .unwrap()
            .iter()
            .filter(|t| t.launcher_id.as_ref() == Some(&id))
            .collect();
        assert_eq!(tubes.len(), part.tube_offsets.as_ref().unwrap().len());
        assert!(
            tubes
                .iter()
                .all(|t| t.magazine_id == magazine.id && t.ammo == 1.)
        );
        // Catalog mass already includes ready torpedoes: no second ammunition mass.
        assert!(
            !def.loading
                .as_ref()
                .unwrap()
                .contributions
                .iter()
                .any(|m| m.id == format!("{id}-ammunition"))
        );
    }
}
