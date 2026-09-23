use naval_sim::{construction, construction_geometry as cg, definition::*};

fn fixture() -> (ConstructionSource, ConstructionCatalog) {
    let source=serde_json::from_value(serde_json::json!({
        "schemaVersion":1,"id":"balcony-test","name":"Balcony test","coordinates":"meters-y-up-bow-negative-z","revision":"one",
        "construction":{"version":1,"catalogRevision":"test","defaultThicknessMm":10,
        "primitives":[{"id":"hull","kind":"box","size":[10,4,20],"position":[0,0,0],"rotationDeg":0},
        {"id":"balcony","kind":"balcony","size":[4,0.08,4],"position":[7,1,0],"rotationDeg":0,
        "balcony":{"version":1,"heightM":1.1,"wallThicknessM":0.06,"points":[
        {"id":"a","x":-0.5,"z":-0.5,"edge":"open"},{"id":"b","x":0.5,"z":-0.5,"edge":"open"},
        {"id":"c","x":0.5,"z":0.5,"edge":"open"},{"id":"d","x":-0.5,"z":0.5,"edge":"open"}]}}],
        "surfaces":[],"equipment":[],"boundaries":[],"loads":[]}})).unwrap();
    let catalog = ConstructionCatalog {
        schema_version: 1.,
        revision: "test".into(),
        weapons: PartCatalog {
            schema_version: 1.,
            ..Default::default()
        },
        ..Default::default()
    };
    (source, catalog)
}

#[test]
fn balconies_render_without_changing_structural_physics() {
    for x in [7., 4.5] {
        let (mut source, catalog) = fixture();
        source.construction.primitives[1].position[0] = x;
        let balcony = source.construction.primitives[1].balcony.as_mut().unwrap();
        balcony.points[0].edge = "wall".into();
        balcony.points[1].edge = "railing".into();
        balcony.points[2].edge = "triple-railing".into();
        let result = construction::compile(&source, &catalog);
        assert!(result.definition.is_some(), "{:?}", result.diagnostics);
        assert!(result.surfaces.iter().any(|s| s.primitive_id == "balcony"));
        source
            .construction
            .primitives
            .retain(|p| p.kind != "balcony");
        let baseline = construction::compile(&source, &catalog);
        assert!(baseline.definition.is_some(), "{:?}", baseline.diagnostics);
        let mut actual = serde_json::to_value(result.definition.unwrap()).unwrap();
        let mut expected = serde_json::to_value(baseline.definition.unwrap()).unwrap();
        // Source identity changes, but every compiled gameplay field must match.
        for key in ["id", "contentHash", "construction"] {
            actual.as_object_mut().unwrap().remove(key);
            expected.as_object_mut().unwrap().remove(key);
        }
        for (key, value) in expected.as_object().unwrap() {
            assert_eq!(&actual[key], value, "changed {key} at balcony x={x}");
        }
        assert_eq!(
            serde_json::to_value(result.loading).unwrap(),
            serde_json::to_value(baseline.loading).unwrap()
        );
    }
}

#[test]
fn balcony_alone_is_not_a_hull() {
    let (mut source, catalog) = fixture();
    source
        .construction
        .primitives
        .retain(|p| p.kind == "balcony");
    let result = construction::compile(&source, &catalog);
    assert!(result.definition.is_none());
    assert!(
        result
            .diagnostics
            .iter()
            .any(|d| d.message.contains("hull primitive"))
    );
}

#[test]
fn decorative_balcony_still_supports_deck_equipment() {
    let (mut source, mut catalog) = fixture();
    catalog.equipment.push(ConstructionEquipmentPart {
        id: "fitting".into(),
        name: "Fitting".into(),
        kind: "deck-fitting".into(),
        placement: "deck".into(),
        size: [1., 1., 1.],
        bounds_center: [0., 0.5, 0.],
        center_of_gravity: [0., 0.5, 0.],
        mass_kg: Some(300.),
        model_url: "/models/components/fitting/test.glb".into(),
        content_hash: "test".into(),
        sockets: Some(vec![ConstructionEquipmentPartSocketsItem {
            id: "attachment".into(),
            kind: "support".into(),
            position: [0.; 3],
            direction: [0., -1., 0.],
        }]),
        ..Default::default()
    });
    source.construction.equipment.push(ConstructionEquipment {
        id: "fitting".into(),
        part_id: "fitting".into(),
        position: [7., 1.04, 0.],
        ..Default::default()
    });
    let result = construction::compile(&source, &catalog);
    assert!(result.definition.is_some(), "{:?}", result.diagnostics);
    let def = result.definition.unwrap();
    assert!(
        !def.hull
            .volume
            .unwrap()
            .cells
            .iter()
            .any(|cell| cg::contains(cell, [7., 1., 0.]))
    );
    assert!(
        result
            .loading
            .unwrap()
            .contributions
            .iter()
            .any(|c| c.mass_kg == 300.)
    );
}

#[test]
fn mixed_edges_concavity_and_mirroring_remain_visible() {
    let (mut source, catalog) = fixture();
    let b = source.construction.primitives[1].balcony.as_mut().unwrap();
    b.points[0].edge = "wall".into();
    b.points[1].edge = "railing".into();
    b.points.insert(
        2,
        ConstructionBalconyPoint {
            id: "inset".into(),
            x: 0.,
            z: 0.,
            edge: "triple-railing".into(),
        },
    );
    let result = construction::compile(&source, &catalog);
    assert!(result.definition.is_some(), "{:?}", result.diagnostics);
    assert!(
        result
            .surfaces
            .iter()
            .filter(|s| s.primitive_id == "balcony")
            .any(|s| s.vertices.iter().any(|v| v[1] > 2.))
    );
    let mass = result.loading.unwrap().mass_kg;
    for p in &mut source.construction.primitives {
        p.position[0] = -p.position[0];
        if let Some(b) = p.balcony.as_mut() {
            for point in &mut b.points {
                point.x = -point.x;
            }
        }
    }
    let reflected = construction::compile(&source, &catalog);
    assert!(
        reflected.definition.is_some(),
        "{:?}",
        reflected.diagnostics
    );
    assert!((reflected.loading.unwrap().mass_kg - mass).abs() < 1e-5);
}

#[test]
fn crossed_outlines_cannot_launch_but_platforms_may_float() {
    let (mut source, catalog) = fixture();
    source.construction.primitives[1]
        .balcony
        .as_mut()
        .unwrap()
        .points
        .swap(1, 2);
    let result = construction::compile(&source, &catalog);
    assert!(result.definition.is_none());
    assert!(result.diagnostics.iter().any(|d| d.code == "balcony"));
    // A platform clear of every hull piece is decorative and still launches.
    let (mut source, catalog) = fixture();
    source.construction.primitives[1].position[1] = 12.;
    let result = construction::compile(&source, &catalog);
    assert!(result.definition.is_some(), "{:?}", result.diagnostics);
}

#[test]
fn a_platform_still_carries_the_piece_above_it() {
    // Saved designs stand deckhouses on platforms: the balcony spans x 5..9 and is the only
    // contact between the two boxes, as it was before platforms were allowed to float.
    let (mut source, catalog) = fixture();
    let mut second = source.construction.primitives[0].clone();
    second.id = "hull-b".into();
    second.size = [4., 4., 20.];
    second.position = [11., 0., 0.];
    source.construction.primitives.push(second);
    let result = construction::compile(&source, &catalog);
    assert!(result.definition.is_some(), "{:?}", result.diagnostics);
    // Without the platform the second box is detached.
    source
        .construction
        .primitives
        .retain(|p| p.kind != "balcony");
    let result = construction::compile(&source, &catalog);
    assert!(
        result
            .diagnostics
            .iter()
            .any(|d| d.code == "attachment" && d.source_id.as_deref() == Some("hull-b"))
    );
}

#[test]
fn opening_a_wall_keeps_the_deck_attached_at_the_old_wall_footprint() {
    let (mut source, catalog) = fixture();
    source.construction.primitives[1].position[0] = 7.03;
    let result = construction::compile(&source, &catalog);
    assert!(result.definition.is_some(), "{:?}", result.diagnostics);
}

#[test]
fn solid_walls_cover_outer_corners_for_both_windings() {
    for reflected in [false, true] {
        let (mut source, _) = fixture();
        let balcony = &mut source.construction.primitives[1];
        balcony.position = [0.; 3];
        for point in &mut balcony.balcony.as_mut().unwrap().points {
            point.edge = "wall".into();
            if reflected {
                point.x = -point.x;
            }
        }
        let cells = construction::primitive_cells(balcony).unwrap();
        for x in [-2.02, 2.02] {
            for z in [-2.02, 2.02] {
                assert!(
                    cells.iter().any(|cell| cg::contains(cell, [x, 0.6, z])),
                    "missing wall corner at {x}, {z}"
                );
            }
        }
        // A complete square wall ring has its exact mitred area, with no
        // overlapping corner blocks to inflate the steel volume.
        let expected = 4.06 * 4.06 * 0.08 + (4.06 * 4.06 - 3.94 * 3.94) * 1.1;
        assert!((cg::total(&cells).volume - expected).abs() < 1e-8);
    }
}
