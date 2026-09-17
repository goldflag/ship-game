use naval_sim::{construction, definition::*};

fn fixture(position: Vec3) -> (ConstructionSource, ConstructionCatalog) {
    let source = ConstructionSource {
        schema_version: 1.,
        id: "shaft-test".into(),
        name: "Shaft test".into(),
        revision: "one".into(),
        coordinates: "meters-y-up-bow-negative-z".into(),
        construction: ConstructionData {
            version: 1.,
            catalog_revision: "test".into(),
            default_thickness_mm: 10.,
            primitives: vec![ConstructionPrimitive { shaping: None,
                id: "hull".into(),
                kind: "box".into(),
                size: [10., 4., 20.],
                ..Default::default()
            }],
            equipment: vec![ConstructionEquipment {
                id: "screw".into(),
                part_id: "propeller".into(),
                position,
                ..Default::default()
            }],
            ..Default::default()
        },
    };
    let catalog = ConstructionCatalog {
        schema_version: 1.,
        revision: "test".into(),
        weapons: PartCatalog {
            schema_version: 1.,
            ..Default::default()
        },
        equipment: vec![ConstructionEquipmentPart {
            id: "propeller".into(),
            name: "Test screw".into(),
            kind: "propeller".into(),
            placement: "underwater".into(),
            size: [1.22, 1.22, 0.72],
            bounds_center: [0., 0., -0.06],
            mass_kg: Some(110.),
            thrust_efficiency: Some(0.6),
            model_url: "/models/components/test/test.glb".into(),
            content_hash: "test".into(),
            sockets: Some(vec![ConstructionEquipmentPartSocketsItem {
                id: "attachment".into(),
                kind: "shaft".into(),
                position: [0., 0., -0.42],
                direction: [0., 0., -1.],
            }]),
            ..Default::default()
        }],
    };
    (source, catalog)
}
fn valid(source: &ConstructionSource, catalog: &ConstructionCatalog) -> ConstructionResult {
    let result = construction::compile(source, catalog);
    assert!(result.definition.is_some(), "{:?}", result.diagnostics);
    result
}

#[test]
fn automatic_shaft_reaches_stern_and_rotates_with_installation() {
    for (z, bearing, sign) in [(13., 0., 1.), (-13., 180., -1.)] {
        let (mut source, catalog) = fixture([0., -1., z]);
        source.construction.equipment[0].bearing_deg = bearing;
        let result = valid(&source, &catalog);
        let members = &result.propeller_supports.as_ref().unwrap()[0].members;
        assert_eq!(members.len(), 1);
        assert_eq!(members[0].kind, "shaft");
        assert!((members[0].end[2] - sign * 9.98).abs() < 1e-6);
        assert!(
            result
                .loading
                .as_ref()
                .unwrap()
                .contributions
                .iter()
                .any(|m| m.id == "screw-support" && m.mass_kg > 100.)
        );
    }
}

#[test]
fn suspended_screw_has_shaft_and_two_hull_braces_without_buoyancy() {
    let (source, catalog) = fixture([0., -3.5, 9.]);
    let result = valid(&source, &catalog);
    let members = &result.propeller_supports.as_ref().unwrap()[0].members;
    assert_eq!(members.len(), 3);
    for member in &members[1..] {
        assert_eq!(member.kind, "strut");
        assert!(member.end[1] > -2. && member.end[1] < -1.97);
        assert_eq!(member.start, members[0].end);
    }
    let mut bare = source.clone();
    bare.construction.equipment.clear();
    let baseline = valid(&bare, &catalog);
    let a = result.loading.unwrap();
    let b = baseline.loading.unwrap();
    assert_eq!(a.envelope_volume_m3, b.envelope_volume_m3);
    assert_eq!(a.material_volume_m3, b.material_volume_m3);
    assert!(a.mass_kg > b.mass_kg + 110.);
}

#[test]
fn directly_attached_screw_keeps_original_geometry() {
    let (source, catalog) = fixture([0., -1., 10.42]);
    assert!(valid(&source, &catalog).propeller_supports.is_none());
}

#[test]
fn distant_and_open_hull_connections_are_rejected() {
    let (source, catalog) = fixture([0., -3.5, 30.]);
    let result = construction::compile(&source, &catalog);
    assert!(
        result
            .diagnostics
            .iter()
            .any(|d| d.code == "equipment-attachment")
    );
    let (mut source, catalog) = fixture([0., -3.5, 9.]);
    source
        .construction
        .surfaces
        .push(ConstructionSurfaceAssignment { panel_id: None,
            primitive_id: "hull".into(),
            face: "bottom".into(),
            thickness_mm: 10.,
            material: "steel".into(),
            paint: "naval-gray".into(),
            open: Some(true),
        });
    let result = construction::compile(&source, &catalog);
    assert!(result.definition.is_none());
    assert!(
        result
            .diagnostics
            .iter()
            .any(|d| d.code == "equipment-attachment"),
        "{:?}",
        result.diagnostics
    );
}

#[test]
fn shaft_cannot_cross_another_propeller_regardless_of_source_order() {
    let (mut source, catalog) = fixture([0., -1., 14.]);
    source.construction.equipment.push(ConstructionEquipment {
        id: "other".into(),
        part_id: "propeller".into(),
        position: [0., -1., 12.],
        ..Default::default()
    });
    for _ in 0..2 {
        let result = construction::compile(&source, &catalog);
        assert!(result.definition.is_none());
        assert!(
            result
                .diagnostics
                .iter()
                .any(|d| d.code == "equipment-overlap"),
            "{:?}",
            result.diagnostics
        );
        source.construction.equipment.reverse();
    }
}

#[test]
fn every_published_propeller_variant_can_hang_below_a_hull() {
    let catalog: ConstructionCatalog = serde_json::from_str(include_str!(
        "../../../public/models/components/catalog.json"
    ))
    .unwrap();
    for part in catalog.equipment.iter().filter(|p| p.kind == "propeller") {
        let diameter = part.size[0].max(part.size[1]);
        let (mut source, _) = fixture([0., -2. - diameter * 0.8, 9.]);
        source.construction.catalog_revision = catalog.revision.clone();
        source.construction.primitives[0].size[0] = 20.;
        source.construction.equipment[0].part_id = part.id.clone();
        let result = valid(&source, &catalog);
        assert_eq!(
            result.propeller_supports.unwrap()[0].members.len(),
            3,
            "{}",
            part.id
        );
    }
}
