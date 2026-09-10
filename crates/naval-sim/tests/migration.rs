use naval_sim::{
    ballistics::*,
    catalog::Catalog,
    definition::{Handling, Vec3},
    geometry::*,
    motion::*,
    rules::*,
};
use serde_json::{Value, from_value};
fn fixture() -> Value {
    serde_json::from_str(include_str!(
        "../../../assets/gameplay/migration/reference.v1.json"
    ))
    .unwrap()
}
fn near(actual: f64, expected: f64, tolerance: f64) {
    assert!(
        actual.is_finite() && (actual - expected).abs() <= tolerance,
        "actual {actual}, expected {expected}, tolerance {tolerance}"
    );
}
fn vector(actual: Vec3, expected: &Value, tolerance: f64) {
    for i in 0..3 {
        near(actual[i], expected[i].as_f64().unwrap(), tolerance);
    }
}
#[test]
fn movement_matches_existing_hulls() {
    for case in fixture()["motion"].as_array().unwrap() {
        let mut ship = ShipState::new(case["id"].as_str().unwrap());
        let handling: Handling = from_value(case["handling"].clone()).unwrap();
        for (i, input) in case["inputs"].as_array().unwrap().iter().enumerate() {
            let command: HelmCommand = from_value(input["command"].clone()).unwrap();
            for _ in 0..input["ticks"].as_u64().unwrap() {
                step_ship(&mut ship, command, &handling, 1.0, 1.0, None);
            }
            let actual = serde_json::to_value(&ship).unwrap();
            for (key, value) in case["checkpoints"][i].as_object().unwrap() {
                if let Some(n) = value.as_f64() {
                    near(actual[key].as_f64().unwrap(), n, 1e-7);
                }
            }
        }
    }
}
#[test]
fn ballistic_aim_and_flight_match_reference() {
    for case in fixture()["ballistic"].as_array().unwrap() {
        let from = from_value(case["from"].clone()).unwrap();
        let target = from_value(case["target"].clone()).unwrap();
        let speed = case["speed"].as_f64().unwrap();
        let drag = case["drag"].as_f64().unwrap();
        let arc = solve_drag_arc(from, target, speed, drag);
        if case["arc"].is_null() {
            assert!(arc.is_none());
        } else {
            let arc = arc.unwrap();
            near(arc.time, case["arc"]["time"].as_f64().unwrap(), 1e-8);
            vector(arc.direction, &case["arc"]["direction"], 1e-10);
        }
        let (p, v) = ballistic_step(from, [20.0, 40.0, -300.0], DT, drag);
        vector(p, &case["step"]["position"], 1e-10);
        vector(v, &case["step"]["velocity"], 1e-10);
    }
    for case in fixture()["dispersion"].as_array().unwrap() {
        let seed = case["seed"].as_u64().unwrap() as u32;
        let shot = case["shot"].as_u64().unwrap() as u32;
        near(
            dispersed_speed(820.0, 0.005, seed, shot),
            case["speed"].as_f64().unwrap(),
            1e-9,
        );
        vector(
            dispersed_direction([0.0, 0.0, -1.0], 0.002, seed, shot),
            &case["direction"],
            1e-10,
        );
    }
}
#[test]
fn articulation_coordinate_contract_matches() {
    let f = fixture();
    let g = &f["geometry"];
    let pose = from_value(g["pose"].clone()).unwrap();
    let point = from_value(g["point"].clone()).unwrap();
    vector(local_to_world(point, pose), &g["world"], 1e-10);
    vector(world_to_local(point, pose), &g["local"], 1e-10);
}
#[test]
fn environment_integer_seeds_match_browser() {
    for case in fixture()["environments"].as_array().unwrap() {
        let selection = select_environment(
            case["seed"].as_u64().unwrap() as u32,
            &["open-ocean".into(), "islands".into()],
            &["map".into(), "clear".into(), "storm".into()],
            &Rules::default(),
        )
        .unwrap();
        assert_eq!(serde_json::to_value(selection).unwrap(), case["selection"]);
    }
}
#[test]
fn registered_content_loads_and_tampering_is_rejected() {
    let bytes = std::fs::read("../../.build/naval-content/manifest.json")
        .expect("Run bun run multiplayer:content first");
    let catalog = Catalog::load(&bytes).unwrap();
    assert!(!catalog.definitions.is_empty());
    let mut value: Value = serde_json::from_slice(&bytes).unwrap();
    value["ships"][0]["json"] = Value::String("{}".into());
    assert!(Catalog::load(&serde_json::to_vec(&value).unwrap()).is_err());
}
#[test]
fn buoyancy_floodwater_and_weapon_training_match_reference() {
    use naval_sim::{
        floodwater::water_body,
        hydrostatics::HullHydrostatics,
        weapons::{MountState, Obstructions, muzzle_local, update_mount},
    };
    let bytes = std::fs::read("../../.build/naval-content/manifest.json").unwrap();
    let catalog = Catalog::load(&bytes).unwrap();
    let f = fixture();
    for case in f["hydro"].as_array().unwrap() {
        let d = &catalog.definitions[case["id"].as_str().unwrap()];
        let h = HullHydrostatics::new(&d.hull);
        let sample = h.sample(-1.2, 0.21, -0.013);
        near(
            sample.volume,
            case["hydrostatics"]["volume"].as_f64().unwrap(),
            1e-6,
        );
        vector(sample.center, &case["hydrostatics"]["center"], 1e-7);
        let sample = h.flotation(d.hull.mass_kg / 1025.0, 0.21, -0.013);
        near(sample.y, case["flotation"]["y"].as_f64().unwrap(), 1e-7);
        vector(sample.center, &case["flotation"]["center"], 1e-7);
        for water in case["water"].as_array().unwrap() {
            let room = d
                .compartments
                .iter()
                .find(|c| c.id == water["id"].as_str().unwrap())
                .unwrap();
            let body = water_body(room, room.capacity_m3 * 0.37, 0.21, -0.013);
            near(body.level, water["body"]["level"].as_f64().unwrap(), 1e-7);
            near(body.area, water["body"]["area"].as_f64().unwrap(), 1e-6);
            vector(body.center, &water["body"]["center"], 1e-7);
            near(
                body.level_at_volume(room.capacity_m3 * 0.68),
                water["nextLevel"].as_f64().unwrap(),
                1e-7,
            );
        }
    }
    for case in f["mounts"].as_array().unwrap() {
        let d = &catalog.definitions[case["id"].as_str().unwrap()];
        let ship = from_value(case["ship"].clone()).unwrap();
        let mut obstructions = Obstructions::new(d);
        // This frozen TypeScript comparison predates physical movement
        // interlocks. The published profile and complete independent poses
        // are covered by mount_clearance.rs and the WASM preview regressions.
        obstructions.clearance = None;
        let mut states: Vec<_> = d.mounts.iter().map(MountState::new).collect();
        for _ in 0..120 {
            for (i, m) in d.mounts.iter().enumerate() {
                naval_sim::mount_frames::update_mount_carrier(d, i, &mut states);
                let mut state = states[i].clone();
                update_mount(
                    m,
                    &mut state,
                    d,
                    &ship,
                    Some([3000.0, 0.5, -4000.0]),
                    DT,
                    [0.0; 3],
                    1.0,
                    &obstructions,
                    &states,
                );
                states[i] = state;
            }
        }
        for (i, m) in d.mounts.iter().enumerate() {
            let state = &states[i];
            let expected = &case["states"][i];
            assert_eq!(
                state.status,
                expected["state"]["status"].as_str().unwrap(),
                "{} {}",
                d.id,
                m.id
            );
            near(
                state.train,
                expected["state"]["train"].as_f64().unwrap(),
                1e-7,
            );
            near(
                state.elevation,
                expected["state"]["elevation"].as_f64().unwrap(),
                1e-7,
            );
            vector(muzzle_local(m, &state, 0), &expected["muzzle"], 1e-7);
        }
    }
}
#[test]
fn cpu_sea_and_baked_terrain_match_reference() {
    use naval_sim::environment::{Island, SeaState};
    let f = fixture();
    let bytes = std::fs::read("../../.build/naval-content/manifest.json").unwrap();
    let catalog = Catalog::load(&bytes).unwrap();
    for case in f["sea"].as_array().unwrap() {
        let sea: SeaState = catalog
            .resolve_environment(
                case["mapId"].as_str().unwrap(),
                case["weather"].as_str().unwrap(),
                73493,
                8,
                5000.0,
                None,
            )
            .unwrap()
            .sea;
        near(
            sea.height(452.5, -320.4, 67.1),
            case["height"].as_f64().unwrap(),
            1e-10,
        );
    }
    let bytes = std::fs::read("../../.build/naval-content/manifest.json").unwrap();
    let catalog = Catalog::load(&bytes).unwrap();
    for case in f["terrain"].as_array().unwrap() {
        let island: Island = from_value(case["island"].clone()).unwrap();
        let field = catalog
            .terrain
            .iter()
            .find(|f| f.seed == island.seed && f.style == island.style)
            .unwrap();
        for point in case["points"].as_array().unwrap() {
            near(
                island.height_at(
                    field,
                    point["x"].as_f64().unwrap(),
                    point["z"].as_f64().unwrap(),
                ),
                point["height"].as_f64().unwrap(),
                1e-6,
            );
        }
    }
}
#[test]
fn rotated_endpoint_contacts_are_stable() {
    let pose = Pose {
        x: 321.4,
        y: 5.2,
        z: -5090.5,
        heading: std::f64::consts::PI + 0.017,
        roll: 0.11,
        pitch: -0.035,
    };
    for epsilon in [-1e-12, 0.0, 1e-12] {
        let from = world_to_local(local_to_world([-3.0, 0.0, 0.0], pose), pose);
        let to = world_to_local(local_to_world([-1.0 + epsilon, 0.0, 0.0], pose), pose);
        let hit = segment_box(from, to, [0.0; 3], [2.0; 3]).unwrap();
        near(hit.t, 1.0, 1e-8);
        assert_eq!(hit.normal, [-1.0, 0.0, 0.0]);
    }
    assert!(segment_box([-3.0, 0.0, 0.0], [-1.0001, 0.0, 0.0], [0.0; 3], [2.0; 3]).is_none());
}
