//! Exercise the authored machinery packages through the native compiler and damage consumer.
use naval_sim::{construction, damage::Combatant, definition::*, machinery};
use serde_json::{Value, json};

#[test]
fn every_catalog_plant_fits_powers_independent_shafts_and_loses_only_its_own_services() {
    let authored: Value =
        serde_json::from_str(include_str!("../../../assets/parts/construction.json")).unwrap();
    let mut parts = authored["equipment"].as_array().unwrap().clone();
    for part in &mut parts {
        part["modelUrl"] = json!("/models/components/test/model.glb");
        part["contentHash"] = json!("test");
    }
    let engines: Vec<_> = parts
        .iter()
        .filter(|p| p["kind"] == "engine")
        .cloned()
        .collect();
    assert_eq!(engines.len(), 8);
    assert!(
        !engines
            .iter()
            .any(|p| p["id"] == "steam-machinery-82000kw"
                || p["id"] == "generic-steam-plant-36000kw")
    );
    let catalog: ConstructionCatalog = serde_json::from_value(json!({
        "schemaVersion": 1, "revision": "test",
        "weapons": { "schemaVersion": 1, "parts": [] }, "equipment": parts
    }))
    .unwrap();
    for engine in engines {
        let mut source: ConstructionSource = serde_json::from_value(json!({
            "schemaVersion": 1, "id": "machinery-test", "name": "Machinery test", "revision": "test",
            "coordinates": "meters-y-up-bow-negative-z",
            "construction": {
                "version": 1, "catalogRevision": "test", "defaultThicknessMm": 10,
                "primitives": [{ "id": "hull", "kind": "box", "position": [0,0,0], "size": [30,12,100], "rotationDeg": 0 }],
                "equipment": [], "surfaces": [],
                "boundaries": [{ "id": "center-wall", "axis": "x", "offset": 0, "thicknessMm": 10 }],
                "loads": [{ "id": "outfit", "name": "Explicit test load", "massKg": 8000000, "center": [3,-4,30], "size": [1,1,1] }]
            }
        })).unwrap();
        for (side, x) in [("port", -7.5), ("starboard", 7.5)] {
            for (kind, part_id, position) in [
                ("engine", engine["id"].as_str().unwrap(), [x, -5.99, 0.]),
                ("funnel", "nelson-funnel", [x, 6., 0.]),
                ("screw", "generic-propeller-1200", [x, -5.0, 50.42]),
            ] {
                source.construction.equipment.push(ConstructionEquipment {
                    id: format!("{side}-{kind}"),
                    part_id: part_id.into(),
                    position,
                    power_source_id: (kind != "engine").then(|| format!("{side}-engine")),
                    ..Default::default()
                });
            }
        }
        let result = construction::compile(&source, &catalog);
        let def = result
            .definition
            .unwrap_or_else(|| panic!("{}: {:?}", engine["id"], result.diagnostics));
        let prop = catalog
            .equipment
            .iter()
            .find(|p| p.id == "generic-propeller-1200")
            .unwrap();
        let expected =
            2. * engine["powerKw"].as_f64().unwrap() * 0.98 * prop.thrust_efficiency.unwrap();
        assert!(
            (def.loading.as_ref().unwrap().power_kw - expected).abs() < 1e-6,
            "{}",
            engine["id"]
        );
        let mut actor = Combatant::new("test", &def);
        assert!((machinery::electrical_power(&actor, &def, None) - 1.).abs() < 1e-9);
        let port = def
            .modules
            .iter()
            .position(|m| m.id == "port-engine")
            .unwrap();
        actor.damage.modules[port].hp = 0.;
        assert_eq!(
            machinery::equipment_condition(&actor, &def, &def.modules[port], None).availability,
            0.
        );
        assert!((machinery::system_health(&actor, &def, "engine", None) - 0.5).abs() < 1e-9);
        assert!((machinery::electrical_power(&actor, &def, None) - 0.5).abs() < 1e-9);
        assert_eq!(
            Combatant::new("reset", &def).damage.modules[port].hp,
            def.modules[port].hp
        );
    }
}
