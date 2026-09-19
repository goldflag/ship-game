//! Height coatings persist in the shared source and never change physical hulls.
use naval_sim::{construction, definition::*};
use serde_json::json;

fn fixture() -> (ConstructionSource, ConstructionCatalog) {
    let source = serde_json::from_value(json!({
        "schemaVersion":1,"id":"paint-test","name":"Paint test","revision":"one","coordinates":"meters-y-up-bow-negative-z",
        "construction":{"version":2,"catalogRevision":"test","defaultThicknessMm":16,
            "primitives":[{"id":"hull","kind":"custom-hull","size":[10,4,20],"position":[0,0,0],"rotationDeg":0,
                "customHull":{"version":1,"rake":0,"bulb":0,"redPaintY":-0.5,
                    "stations":(0..4).map(|i| json!({"id":format!("s{i}"),"t":i as f64/3.,"points":[
                        {"x":-1,"y":0.5},{"x":-1,"y":-0.5},{"x":0,"y":-0.5},{"x":1,"y":-0.5},{"x":1,"y":0.5}
                    ]})).collect::<Vec<_>>()}}],
            "surfaces":[],"equipment":[],"boundaries":[],"loads":[]}
    })).unwrap();
    let catalog = serde_json::from_value(json!({"schemaVersion":1,"revision":"test","equipment":[],"weapons":{"schemaVersion":1,"parts":[]}})).unwrap();
    (source, catalog)
}
fn bands() -> serde_json::Value {
    json!({"version":1.0,"bands":[{"id":"lower","upperY":-0.5,"paint":"sea-blue"},{"id":"waterline","upperY":0.25,"paint":"boot-top-black"}]})
}

#[test]
fn coatings_round_trip_without_changing_surfaces_mass_or_hydrostatics() {
    let (mut source, catalog) = fixture();
    assert!(
        serde_json::to_value(
            source.construction.primitives[0]
                .custom_hull
                .as_ref()
                .unwrap()
        )
        .unwrap()
        .get("paintBands")
        .is_none()
    );
    let original = construction::compile(&source, &catalog);
    assert!(original.definition.is_some(), "{:?}", original.diagnostics);
    source.construction.primitives[0]
        .custom_hull
        .as_mut()
        .unwrap()
        .paint_bands = Some(serde_json::from_value(bands()).unwrap());
    let saved = serde_json::to_value(&source).unwrap();
    assert_eq!(
        saved["construction"]["primitives"][0]["customHull"]["paintBands"],
        bands()
    );
    let loaded: ConstructionSource = serde_json::from_value(saved).unwrap();
    let painted = construction::compile(&loaded, &catalog);
    assert!(painted.definition.is_some(), "{:?}", painted.diagnostics);
    assert_eq!(
        serde_json::to_value(&original.surfaces).unwrap(),
        serde_json::to_value(&painted.surfaces).unwrap()
    );
    let original = original.definition.unwrap();
    let painted = painted.definition.unwrap();
    assert_eq!(
        serde_json::to_value(original.hull).unwrap(),
        serde_json::to_value(painted.hull).unwrap()
    );
    assert_eq!(
        serde_json::to_value(original.loading).unwrap(),
        serde_json::to_value(painted.loading).unwrap()
    );
}

#[test]
fn compiler_rejects_invalid_band_versions_order_identity_and_paints() {
    let (source, catalog) = fixture();
    let mut bad = vec![];
    for (field, value) in [
        ("id", json!("lower")),
        ("upperY", json!(-0.5)),
        ("upperY", json!(-1)),
        ("upperY", json!(501)),
        ("paint", json!("")),
    ] {
        let mut b = bands();
        b["bands"][1][field] = value;
        bad.push(b);
    }
    let mut version = bands();
    version["version"] = json!(2);
    bad.push(version);
    bad.push(json!({"version":1,"bands":(0..9).map(|i|json!({"id":format!("b{i}"),"upperY":i,"paint":"red-oxide"})).collect::<Vec<_>>()}));
    for value in bad {
        let mut invalid = source.clone();
        invalid.construction.primitives[0]
            .custom_hull
            .as_mut()
            .unwrap()
            .paint_bands = Some(serde_json::from_value(value).unwrap());
        let result = construction::compile(&invalid, &catalog);
        assert!(
            result.definition.is_none(),
            "Invalid band settings were accepted"
        );
        assert!(result.diagnostics.iter().any(|d| d.severity == "error"));
    }
}
