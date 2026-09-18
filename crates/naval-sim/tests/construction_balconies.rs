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
fn open_balcony_attaches_to_side_and_counts_solid_deck_once() {
    let (source, catalog) = fixture();
    let result = construction::compile(&source, &catalog);
    assert!(result.definition.is_some(), "{:?}", result.diagnostics);
    let loading = result.loading.unwrap();
    let deck = loading
        .contributions
        .iter()
        .find(|c| c.id == "skin-balcony-platform")
        .unwrap();
    assert!((deck.mass_kg - 4.06 * 4.06 * 0.08 * 7850.).abs() < 1e-6);
    assert!((deck.center[0] - 7.).abs() < 1e-8);
    let cells = construction::primitive_cells(&source.construction.primitives[1]).unwrap();
    assert!((cg::total(&cells).volume - 4.06 * 4.06 * 0.08).abs() < 1e-8);
}

#[test]
fn mixed_edges_concavity_mirroring_and_native_steel_remain_valid() {
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
fn crossed_outlines_and_detached_platforms_cannot_launch() {
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
    let (mut source, catalog) = fixture();
    source.construction.primitives[1].position[1] = 12.;
    let result = construction::compile(&source, &catalog);
    assert!(result.definition.is_none());
    assert!(result.diagnostics.iter().any(|d| d.code == "attachment"));
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
            if reflected { point.x = -point.x; }
        }
        let cells = construction::primitive_cells(balcony).unwrap();
        for x in [-2.02, 2.02] {
            for z in [-2.02, 2.02] {
                assert!(cells.iter().any(|cell| cg::contains(cell, [x, 0.6, z])), "missing wall corner at {x}, {z}");
            }
        }
        // A complete square wall ring has its exact mitred area, with no
        // overlapping corner blocks to inflate the steel volume.
        let expected = 4.06 * 4.06 * 0.08 + (4.06 * 4.06 - 3.94 * 3.94) * 1.1;
        assert!((cg::total(&cells).volume - expected).abs() < 1e-8);
    }
}
