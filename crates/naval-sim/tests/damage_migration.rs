use naval_sim::{
    breaches::add_breach,
    catalog::Catalog,
    damage::{Combatant, damage_hull},
    damage_control::update_damage_control,
    flooding::update_flooding,
    hydrostatics::HullHydrostatics,
    machinery::{mount_support, system_health},
    motion::HelmCommand,
    submarine::step_submarine,
};
use serde_json::{Value, json};
fn compare(actual: &Value, expected: &Value, path: &str) {
    match expected {
        Value::Number(n) => {
            let expected = n.as_f64().unwrap();
            let actual = actual
                .as_f64()
                .unwrap_or_else(|| panic!("{path}: missing number"));
            assert!(
                actual.is_finite() && (actual - expected).abs() < 1e-6,
                "{path}: actual {actual}, expected {expected}"
            );
        }
        Value::Object(fields) => {
            for (k, v) in fields {
                compare(&actual[k], v, &format!("{path}.{k}"));
            }
        }
        Value::Array(values) => {
            assert_eq!(
                actual.as_array().map(Vec::len),
                Some(values.len()),
                "{path}"
            );
            for (i, v) in values.iter().enumerate() {
                compare(&actual[i], v, &format!("{path}[{i}]"));
            }
        }
        _ => assert_eq!(actual, expected, "{path}"),
    }
}
#[test]
fn damage_flooding_crews_and_submarines_match_existing_hulls() {
    let catalog =
        Catalog::load(&std::fs::read("../../.build/naval-content/manifest.json").unwrap()).unwrap();
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../assets/gameplay/migration/damage.v1.json"
    ))
    .unwrap();
    for case in fixture["cases"].as_array().unwrap() {
        let id = case["id"].as_str().unwrap();
        let def = &catalog.definitions[id];
        let hydro = HullHydrostatics::new(&def.hull);
        let mut actor = Combatant::new(id, def);
        actor.motion.roll = 0.13;
        actor.motion.pitch = -0.01;
        actor.motion.speed = 4.0;
        if let Some(room) = def.compartments.first() {
            actor.damage.compartments[0].water_m3 = room.capacity_m3 * 0.17;
            let p = [room.center[0], -def.hull.draft * 0.7, room.center[2]];
            add_breach(
                &mut actor.damage.compartments[0],
                p,
                0.06,
                1,
                None,
                None,
                false,
            );
            add_breach(
                &mut actor.damage.compartments[0],
                [p[0], p[1] + 0.08, p[2]],
                0.08,
                2,
                None,
                None,
                false,
            );
        }
        if let Some(f) = actor.damage.control.rooms.get_mut(1) {
            f.heat = 1.2;
        }
        if let Some(f) = actor.damage.control.mounts.first_mut() {
            f.heat = 1.1;
        }
        if let Some(m) = actor.damage.modules.first_mut() {
            m.hp *= 0.7;
        }
        let region = actor.damage.regions.first().map(|r| r.id.clone());
        damage_hull(&mut actor, 1400.0, region.as_deref());
        damage_hull(&mut actor, 0.001, region.as_deref());
        for tick in 1..=600 {
            if tick == 181 {
                actor.damage.control.priority = "flooding".into();
                actor.damage.control.focus = def
                    .compartments
                    .first()
                    .map_or(String::new(), |r| r.id.clone());
            }
            update_damage_control(&mut actor, def, 1.0 / 60.0, None);
            update_flooding(&mut actor, def, &hydro, 1.0 / 60.0, None, None);
            step_submarine(
                &mut actor,
                def,
                HelmCommand {
                    depth_m: Some(if tick < 301 { 12.0 } else { 0.0 }),
                    emergency_blow: Some(tick >= 301),
                    ..Default::default()
                },
                1.0 / 60.0,
                0.0,
            );
            if let Some(expected) = case["checkpoints"]
                .as_array()
                .unwrap()
                .iter()
                .find(|c| c["tick"] == tick)
            {
                let support = mount_support(&actor, def, None, None);
                let mut actual = serde_json::to_value(&actor).unwrap();
                actual["tick"] = json!(tick);
                actual["support"] = json!({"power":support.0,"fireControl":support.1});
                actual["engine"] = json!(system_health(&actor, def, "engine", None));
                compare(&actual, expected, &format!("{id}@{tick}"));
            }
        }
    }
}

#[test]
fn armor_contacts_and_resistance_match_reference() {
    let catalog =
        Catalog::load(&std::fs::read("../../.build/naval-content/manifest.json").unwrap()).unwrap();
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../assets/gameplay/migration/contacts.v1.json"
    ))
    .unwrap();
    for case in fixture["cases"].as_array().unwrap() {
        let id = case["id"].as_str().unwrap();
        let def = &catalog.definitions[id];
        let geometry = naval_sim::contacts::ContactGeometry::new(def).unwrap();
        let mut actor = Combatant::new(id, def);
        actor.motion = serde_json::from_value(case["motion"].clone()).unwrap();
        for (i, m) in actor.mounts.iter_mut().enumerate() {
            m.train = case["trains"][i].as_f64().unwrap();
        }
        let shell = naval_sim::shell::Shell::default();
        for (i, ray) in case["rays"].as_array().unwrap().iter().enumerate() {
            let hits = naval_sim::contacts::ship_contacts(
                &shell,
                serde_json::from_value(ray["from"].clone()).unwrap(),
                serde_json::from_value(ray["to"].clone()).unwrap(),
                &actor,
                def,
                &geometry,
            );
            compare(
                &serde_json::to_value(hits).unwrap(),
                &ray["hits"],
                &format!("{id}.ray[{i}]"),
            );
        }
    }
    for c in fixture["responses"].as_array().unwrap() {
        let actual = naval_sim::protection::plate_response(
            c["thickness"].as_f64().unwrap(),
            c["material"].as_str().unwrap(),
            c["cosine"].as_f64().unwrap(),
            0.38,
        );
        compare(
            &serde_json::to_value(actual).unwrap(),
            &c["result"],
            "plate response",
        );
    }
}

#[test]
fn direct_ap_he_and_inert_contacts_match_reference() {
    let catalog =
        Catalog::load(&std::fs::read("../../.build/naval-content/manifest.json").unwrap()).unwrap();
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../assets/gameplay/migration/impacts.v1.json"
    ))
    .unwrap();
    for case in fixture["cases"].as_array().unwrap() {
        let id = case["id"].as_str().unwrap();
        let def = &catalog.definitions[id];
        let geometry = naval_sim::contacts::ContactGeometry::new(def).unwrap();
        for (i, ray) in case["rays"].as_array().unwrap().iter().enumerate() {
            let mut actor = Combatant::new(id, def);
            actor.motion = serde_json::from_value(case["motion"].clone()).unwrap();
            for (i, m) in actor.mounts.iter_mut().enumerate() {
                m.train = case["trains"][i].as_f64().unwrap();
            }
            let mut shell: naval_sim::shell::Shell =
                serde_json::from_value(ray["initial"].clone()).unwrap();
            let from = serde_json::from_value(ray["from"].clone()).unwrap();
            let to = serde_json::from_value(ray["to"].clone()).unwrap();
            let direction = naval_sim::geometry::normalize(naval_sim::geometry::sub(
                naval_sim::geometry::world_to_local(to, actor.motion.pose()),
                naval_sim::geometry::world_to_local(from, actor.motion.pose()),
            ));
            let contacts =
                naval_sim::contacts::ship_contacts(&shell, from, to, &actor, def, &geometry);
            let mut events = vec![];
            let mut stopped = false;
            for hit in contacts {
                let (stop, event) = naval_sim::impact::resolve_ship_contact(
                    &mut shell,
                    &hit,
                    &mut actor,
                    def,
                    Some(direction),
                );
                let ricochet = event.kind == "ricochet";
                events.push(event);
                if stop {
                    stopped = true;
                    break;
                }
                if ricochet {
                    break;
                }
            }
            let path = format!("{id}.impact[{i}]");
            let expected_state = patched(&case["baseline"], &ray["patches"]);
            compare(&json!(stopped), &ray["stopped"], &path);
            compare(
                &serde_json::to_value(&shell).unwrap(),
                &ray["shell"],
                &format!("{path}.shell"),
            );
            compare(
                &serde_json::to_value(&actor.damage).unwrap(),
                &expected_state["damage"],
                &format!("{path}.damage"),
            );
            compare(
                &serde_json::to_value(&actor.mounts).unwrap(),
                &expected_state["mounts"],
                &format!("{path}.mounts"),
            );
            compare(
                &serde_json::to_value(events).unwrap(),
                &ray["events"],
                &format!("{path}.events"),
            );
        }
    }
}
#[test]
fn exact_plate_seam_is_one_layer_and_parallel_ray_misses() {
    use naval_sim::{
        contacts::{ContactGeometry, ship_contacts},
        definition::{Armor, ArmorPlate, ShipDefinition},
        shell::Shell,
    };
    let plate = |id: &str, vertices: Vec<[f64; 3]>| Armor {
        id: id.into(),
        name: id.into(),
        thickness_mm: 20.0,
        center: [0.0, 0.0, 0.0],
        size: [2.0, 2.0, 0.00001],
        plate: Some(ArmorPlate {
            vertices,
            material: "steel".into(),
            surface_id: Some("shared".into()),
            ..Default::default()
        }),
        ..Default::default()
    };
    let mut def = ShipDefinition::default();
    def.hull.mass_kg = 1000.0;
    def.armor = vec![
        plate(
            "a",
            vec![[-1.0, -1.0, 0.0], [1.0, -1.0, 0.0], [1.0, 1.0, 0.0]],
        ),
        plate(
            "b",
            vec![[-1.0, -1.0, 0.0], [1.0, 1.0, 0.0], [-1.0, 1.0, 0.0]],
        ),
    ];
    let actor = Combatant::new("ship", &def);
    let geometry = ContactGeometry::new(&def).unwrap();
    let mut shell = Shell::default();
    let hits = ship_contacts(
        &shell,
        [0.0, 0.0, -1.0],
        [0.0, 0.0, 1.0],
        &actor,
        &def,
        &geometry,
    );
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].seam_keys.len(), 1);
    shell.visited.push(hits[0].key.clone());
    shell.visited.extend(hits[0].seam_keys.clone());
    assert!(
        ship_contacts(
            &shell,
            [0.0, 0.0, -1.0],
            [0.0, 0.0, 1.0],
            &actor,
            &def,
            &geometry
        )
        .is_empty()
    );
    assert!(
        ship_contacts(
            &Shell::default(),
            [-2.0, 0.0, 0.0],
            [2.0, 0.0, 0.0],
            &actor,
            &def,
            &geometry
        )
        .is_empty()
    );
}

fn patched(baseline: &Value, patches: &Value) -> Value {
    let mut value = baseline.clone();
    for patch in patches.as_array().unwrap() {
        let mut target = &mut value;
        for key in patch["path"].as_array().unwrap() {
            target = if let Some(index) = key.as_u64() {
                &mut target[index as usize]
            } else {
                &mut target[key.as_str().unwrap()]
            };
        }
        *target = patch["value"].clone();
    }
    value
}
#[test]
fn complete_projectile_flight_and_bursts_match_reference() {
    use naval_sim::{
        projectile::advance_projectile,
        rules::TeamId,
        shell::Shell,
        vessel::{CompiledShip, Vessel},
    };
    let catalog =
        Catalog::load(&std::fs::read("../../.build/naval-content/manifest.json").unwrap()).unwrap();
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../assets/gameplay/migration/projectiles.v1.json"
    ))
    .unwrap();
    for case in fixture["cases"].as_array().unwrap() {
        let id = case["id"].as_str().unwrap();
        let compiled =
            std::sync::Arc::new(CompiledShip::new(catalog.definitions[id].clone()).unwrap());
        for (i, shot) in case["shots"].as_array().unwrap().iter().enumerate() {
            let mut actors = vec![Vessel::new(id, TeamId::A, compiled.clone())];
            let mut shell: Shell = serde_json::from_value(shot["initial"].clone()).unwrap();
            let mut events = vec![];
            let mut end = None;
            let mut ticks = 0;
            while ticks < 360 && end.is_none() {
                ticks += 1;
                let (result, new_events) =
                    advance_projectile(&mut shell, &mut actors, 1.0 / 60.0, &[], &[], &|_, _| 0.0);
                end = result;
                events.extend(new_events);
            }
            let path = format!("{id}.flight[{i}]");
            compare(&json!(ticks), &shot["ticks"], &format!("{path}.ticks"));
            compare(
                &serde_json::to_value(end).unwrap(),
                &shot["end"],
                &format!("{path}.end"),
            );
            compare(
                &serde_json::to_value(&shell).unwrap(),
                &shot["shell"],
                &format!("{path}.shell"),
            );
            let expected = patched(&case["baseline"], &shot["patches"]);
            compare(
                &serde_json::to_value(&actors[0].damage).unwrap(),
                &expected["damage"],
                &format!("{path}.damage"),
            );
            compare(
                &serde_json::to_value(&actors[0].mounts).unwrap(),
                &expected["mounts"],
                &format!("{path}.mounts"),
            );
            compare(
                &serde_json::to_value(events).unwrap(),
                &shot["events"],
                &format!("{path}.events"),
            );
        }
    }
}
#[test]
fn seeded_bot_observations_helm_and_gun_aim_match_reference() {
    use naval_sim::{
        bots::{self, BotState},
        motion::{HelmCommand, step_ship},
        rules::TeamId,
        vessel::{CompiledShip, Vessel},
    };
    let catalog =
        Catalog::load(&std::fs::read("../../.build/naval-content/manifest.json").unwrap()).unwrap();
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../assets/gameplay/migration/bots.v1.json"
    ))
    .unwrap();
    let content: std::collections::BTreeMap<_, _> = catalog
        .definitions
        .iter()
        .map(|(id, d)| {
            (
                id.clone(),
                std::sync::Arc::new(CompiledShip::new(d.clone()).unwrap()),
            )
        })
        .collect();
    for case in fixture["cases"].as_array().unwrap() {
        let id = case["id"].as_str().unwrap();
        let def = &catalog.definitions[id];
        let target_def = &catalog.definitions[case["targetId"].as_str().unwrap()];
        let mut actor = Vessel::new(id, TeamId::A, content[id].clone());
        let mut target = Vessel::new("target", TeamId::B, content[&target_def.id].clone());
        target.motion.z = -5000.0;
        target.motion.heading = 0.3;
        let mut bot = BotState::new(
            id,
            def,
            case["seed"].as_u64().unwrap() as u32,
            serde_json::from_value(case["level"].clone()).unwrap(),
        );
        for tick in 1..=2400 {
            if tick == 1200 {
                actor.damage.integrity -= 2000.0;
            }
            if tick == 900
                && let Some(r) = target.damage.regions.first_mut()
            {
                r.hp *= 0.1;
            }
            step_ship(
                &mut target.motion,
                HelmCommand {
                    throttle: if tick < 1200 { 0.7 } else { 0.3 },
                    rudder: if tick < 1800 { 0.2 } else { -0.4 },
                    ..Default::default()
                },
                &target_def.handling,
                1.0,
                1.0,
                None,
            );
            bot.update(&actor, def, Some((&target, target_def)), tick as f64 / 60.0);
            let helm = bots::helm(
                &mut bot,
                &actor,
                Some(&target),
                &[actor.clone(), target.clone()],
            );
            step_ship(&mut actor.motion, helm, &def.handling, 1.0, 1.0, None);
            let aim = def.mounts.first().map(|m| {
                let motion = actor.motion.clone();
                bots::aim(
                    Some(&bot),
                    &motion,
                    &target,
                    target_def,
                    m,
                    &mut actor.mounts[0],
                )
            });
            let ready = bot.ready(def.mounts.first());
            if ready && let Some(m) = def.mounts.first() {
                bot.did_fire(m);
            }
            if let Some(expected) = case["checkpoints"]
                .as_array()
                .unwrap()
                .iter()
                .find(|c| c["tick"] == tick)
            {
                let torpedo = def
                    .torpedo_tubes
                    .as_ref()
                    .and_then(|t| t.first())
                    .and_then(|t| bots::torpedo_aim(&bot, &actor.motion, t));
                let actual = json!({"tick":tick,"bot":bot,"motion":actor.motion,"helm":helm,"aim":aim,"ready":ready,"torpedoAim":torpedo});
                compare(&actual, expected, &format!("{id}.{}@{tick}", case["level"]));
            }
        }
    }
}
#[test]
fn torpedo_training_swept_hits_and_depth_charge_trajectories_match() {
    use naval_sim::{
        depth_charges,
        rules::TeamId,
        torpedoes::{self, Torpedo},
        vessel::{CompiledShip, Vessel},
    };
    let catalog =
        Catalog::load(&std::fs::read("../../.build/naval-content/manifest.json").unwrap()).unwrap();
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../assets/gameplay/migration/underwater.v1.json"
    ))
    .unwrap();
    for case in fixture["cases"].as_array().unwrap() {
        let id = case["id"].as_str().unwrap();
        let compiled =
            std::sync::Arc::new(CompiledShip::new(catalog.definitions[id].clone()).unwrap());
        let def = compiled.definition.clone();
        let mut actor = Vessel::new(id, TeamId::A, compiled);
        actor.motion = serde_json::from_value(case["motion"].clone()).unwrap();
        let aim = serde_json::from_value(case["aim"].clone()).unwrap();
        let mut solutions = vec![];
        for _ in 0..120 {
            torpedoes::train_launchers(&mut actor, &def, &|_| Some(aim), 1.0 / 60.0, None);
            let mut states = std::mem::take(&mut actor.torpedo_tubes);
            solutions = def
                .torpedo_tubes
                .iter()
                .flatten()
                .zip(&mut states)
                .map(|(tube, state)| {
                    torpedoes::tube_solution(&actor, &def, tube, state, aim, 1.0 / 60.0, None)
                })
                .collect();
            actor.torpedo_tubes = states;
        }
        compare(
            &serde_json::to_value(solutions).unwrap(),
            &case["solutions"],
            &format!("{id}.solutions"),
        );
        compare(
            &serde_json::to_value(&actor.torpedo_tubes).unwrap(),
            &case["tubes"],
            &format!("{id}.tubes"),
        );
        for l in case["trains"].as_array().unwrap() {
            compare(
                &json!(actor.launcher_trains[l["id"].as_str().unwrap()]),
                &l["train"],
                &format!("{id}.train"),
            );
        }
        for (i, shot) in case["shots"].as_array().unwrap().iter().enumerate() {
            let from = serde_json::from_value(shot["from"].clone()).unwrap();
            let to = serde_json::from_value(shot["to"].clone()).unwrap();
            let t = Torpedo {
                id: 1,
                owner_id: "other".into(),
                tube_id: "fixture".into(),
                position: from,
                velocity: [30.0, 0.0, 0.0],
                age: 0.0,
                distance: 0.0,
                weapon: serde_json::from_value(fixture["torpedo"].clone()).unwrap(),
            };
            let hit = torpedoes::first_torpedo_hit(&t, from, to, std::slice::from_ref(&actor))
                .map(|(_, point, t)| json!({"point":point,"t":t}));
            compare(&json!(hit), &shot["hit"], &format!("{id}.hit[{i}]"));
        }
        let message = torpedoes::damage_underwater_blast(
            &mut actor,
            &def,
            serde_json::from_value(case["point"].clone()).unwrap(),
            430.0,
            0.5,
            "Fixture hit",
            1,
        );
        compare(&json!(message), &case["message"], &format!("{id}.message"));
        let expected = patched(&case["baseline"], &case["patches"]);
        compare(
            &serde_json::to_value(&actor.damage).unwrap(),
            &expected["damage"],
            &format!("{id}.damage"),
        );
        for hit in case["torpedoHits"].as_array().unwrap() {
            let mut target = Vessel::new(id, TeamId::A, actor.compiled.clone());
            target.motion = actor.motion.clone();
            let weapon = serde_json::from_value(fixture["torpedo"].clone()).unwrap();
            let message = torpedoes::damage_torpedo_hit(
                &mut target,
                &def,
                serde_json::from_value(hit["point"].clone()).unwrap(),
                &weapon,
                7,
            );
            compare(
                &json!(message),
                &hit["message"],
                &format!("{id}.torpedo.message"),
            );
            let expected = patched(&case["baseline"], &hit["patches"]);
            compare(
                &serde_json::to_value(&target.damage).unwrap(),
                &expected["damage"],
                &format!("{id}.torpedo.damage"),
            );
        }
        for (i, c) in case["reaches"].as_array().unwrap().iter().enumerate() {
            let result = depth_charges::reach(
                serde_json::from_value(c["position"].clone()).unwrap(),
                &actor.motion,
                &def,
            );
            compare(
                &serde_json::to_value(result).unwrap(),
                &c["result"],
                &format!("{id}.reach[{i}]"),
            );
        }
    }
    for (i, c) in fixture["charges"].as_array().unwrap().iter().enumerate() {
        let mut charge = serde_json::from_value(c["initial"].clone()).unwrap();
        let result = depth_charges::step(&mut charge, c["dt"].as_f64().unwrap());
        compare(
            &serde_json::to_value(result).unwrap(),
            &c["result"],
            &format!("charge[{i}].result"),
        );
        compare(
            &serde_json::to_value(charge).unwrap(),
            &c["charge"],
            &format!("charge[{i}].state"),
        );
    }
}
#[test]
fn fleet_collisions_and_grounding_match_reference() {
    use naval_sim::{
        collisions::resolve_ship_collisions,
        land::resolve_land_contact,
        rules::TeamId,
        vessel::{CompiledShip, Vessel},
    };
    let catalog =
        Catalog::load(&std::fs::read("../../.build/naval-content/manifest.json").unwrap()).unwrap();
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../assets/gameplay/migration/collisions.v1.json"
    ))
    .unwrap();
    let content: std::collections::BTreeMap<_, _> = catalog
        .definitions
        .iter()
        .map(|(id, d)| {
            (
                id.clone(),
                std::sync::Arc::new(CompiledShip::new(d.clone()).unwrap()),
            )
        })
        .collect();
    for (i, c) in fixture["collisions"].as_array().unwrap().iter().enumerate() {
        let id = c["id"].as_str().unwrap();
        let mut actors: Vec<_> = c["baseline"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| {
                let mut a = Vessel::new(
                    s["motion"]["id"].as_str().unwrap(),
                    TeamId::A,
                    content[id].clone(),
                );
                a.motion = serde_json::from_value(s["motion"].clone()).unwrap();
                a
            })
            .collect();
        let events = resolve_ship_collisions(&mut actors);
        let expected = patched(&c["baseline"], &c["patches"]);
        for (j, a) in actors.iter().enumerate() {
            compare(
                &json!({"motion":a.motion,"damage":a.damage}),
                &expected[j],
                &format!("collision[{i}].actor[{j}]"),
            );
        }
        compare(
            &json!(events),
            &c["events"],
            &format!("collision[{i}].events"),
        );
    }
    let island = serde_json::from_value(fixture["island"].clone()).unwrap();
    for c in fixture["land"].as_array().unwrap() {
        let id = c["id"].as_str().unwrap();
        let mut actor = Vessel::new(id, TeamId::A, content[id].clone());
        actor.motion = serde_json::from_value(c["baseline"]["motion"].clone()).unwrap();
        let events =
            resolve_land_contact(&mut actor, std::slice::from_ref(&island), &catalog.terrain);
        let expected = patched(&c["baseline"], &c["patches"]);
        compare(
            &json!({"motion":actor.motion,"damage":actor.damage}),
            &expected,
            &format!("{id}.grounding"),
        );
        compare(
            &json!(events),
            &c["events"],
            &format!("{id}.grounding.events"),
        );
    }
}
#[test]
fn aircraft_flight_controls_and_seeded_fire_match_reference() {
    use naval_sim::{
        air_gunnery::{FireDiscipline, gunnery_seed, step_discipline},
        aircraft::Aircraft,
        aircraft_accuracy::{fighter_burst, strike_aim_error},
        aircraft_flight::{FlightOptions, fly, step_mechanisms},
    };
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../assets/gameplay/migration/flights.v1.json"
    ))
    .unwrap();
    for case in fixture["cases"].as_array().unwrap() {
        let mut plane: Aircraft = serde_json::from_value(case["initial"].clone()).unwrap();
        plane.pilot.fire_discipline = Some(FireDiscipline::default());
        let seed = gunnery_seed(&plane.id, 5739);
        for tick in 1..=1800 {
            if tick == 601 {
                plane.phase = "attack".into();
            }
            if tick == 1201 {
                plane.phase = "landing".into();
            }
            let point = if tick <= 600 {
                [1500.0, 700.0, -1000.0]
            } else if tick <= 1200 {
                [-500.0, 10.0, -2500.0]
            } else {
                [0.0, 15.0, -4500.0]
            };
            fly(
                &mut plane,
                point,
                105.0,
                1.0 / 60.0,
                FlightOptions {
                    dive: tick > 600 && tick <= 1200,
                    landing: tick > 1200,
                    ..Default::default()
                },
            );
            step_mechanisms(&mut plane, 1.0 / 60.0, false);
            step_discipline(
                plane.pilot.fire_discipline.as_mut().unwrap(),
                1.0 / 60.0,
                0.7,
                seed,
                tick < 1500,
            );
            if let Some(expected) = case["checkpoints"]
                .as_array()
                .unwrap()
                .iter()
                .find(|c| c["tick"] == tick)
            {
                let actual = json!({"tick":tick,"plane":plane,"burst":fighter_burst(&plane,[500.0,200.0,-1500.0],5739,2),"strike":strike_aim_error(&plane,0.7,5739,2)});
                compare(
                    &actual,
                    expected,
                    &format!("{}.flight@{tick}", plane.model_id),
                );
            }
        }
    }
}
#[test]
fn carrier_sorties_recovery_and_fighters_match_reference() {
    use naval_sim::{
        aviation::Aviation,
        aviation_step::AirContext,
        rules::TeamId,
        vessel::{CompiledShip, Vessel},
    };
    use std::sync::Arc;
    let catalog =
        Catalog::load(&std::fs::read("../../.build/naval-content/manifest.json").unwrap()).unwrap();
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../assets/gameplay/migration/aviation.v1.json"
    ))
    .unwrap();
    for c in fixture["cases"].as_array().unwrap() {
        let id = c["id"].as_str().unwrap();
        let compiled = Arc::new(CompiledShip::new(catalog.definitions[id].clone()).unwrap());
        let mut actors = vec![
            Vessel::new("carrier", TeamId::A, compiled.clone()),
            Vessel::new("opponent", TeamId::B, compiled),
        ];
        for (i, a) in actors.iter_mut().enumerate() {
            a.motion = serde_json::from_value(c["initial"][i]["motion"].clone()).unwrap()
        }
        let mut air = Aviation::new(&actors, catalog.aircraft.clone());
        let mut shells = vec![];
        let mut torpedoes = vec![];
        let mut releases = vec![];
        let mut sequence = 1000;
        let mut events = vec![];
        let scenario = c["scenario"].as_str().unwrap();
        let mut launched = vec![];
        for s in &actors[0].definition().air_wing.as_ref().unwrap().squadrons {
            if scenario == "mixed" || s.role == "fighter" {
                launched.push(air.launch_squadron(
                    &actors[0],
                    &s.id,
                    Some(&actors[1]),
                    None,
                    &actors,
                    None,
                    None,
                ))
            }
        }
        if scenario == "fighters" {
            let s = actors[1]
                .definition()
                .air_wing
                .as_ref()
                .unwrap()
                .squadrons
                .iter()
                .find(|s| s.role == "fighter")
                .unwrap();
            launched.push(air.launch_squadron(
                &actors[1],
                &s.id,
                Some(&actors[0]),
                None,
                &actors,
                None,
                None,
            ));
        }
        compare(&json!(launched), &c["launched"], scenario);
        let mut time = 0.0;
        for tick in 1..=c["duration"].as_u64().unwrap() * 60 {
            if scenario == "moving-recall" {
                actors[0].motion.x += 0.025;
                actors[0].motion.heading = 0.25;
                actors[0].motion.speed = 1.5;
                if tick == 3901 {
                    air.recall("carrier", None)
                }
            }
            if scenario == "deck-loss" && tick == 61 {
                actors[0].damage.sunk = true
            }
            air.step(
                &mut AirContext {
                    actors: &actors,
                    shells: &mut shells,
                    torpedoes: &mut torpedoes,
                    releases: &mut releases,
                    sequence: &mut sequence,
                    events: &mut events,
                    seed: 5739,
                    sea: None,
                },
                1.0 / 60.0,
                time,
            );
            time += 1.0 / 60.0;
            if let Some(check) = c["checkpoints"]
                .as_array()
                .unwrap()
                .iter()
                .find(|p| p["tick"] == tick)
            {
                assert_eq!(
                    json!(sequence),
                    check["sequence"],
                    "{scenario}@{tick} sequence"
                );
                let expected = patched(&c["baseline"], &check["patches"]);
                compare(
                    &json!({"wings":air.wings,"shells":shells,"torpedoes":torpedoes,"releases":releases,"events":events}),
                    &expected,
                    &format!("{scenario}@{tick}"),
                );
            }
        }
    }
}
#[test]
fn complete_battles_match_reference() {
    use naval_sim::{
        battle::{Battle, BattleSetup, Orders},
        gunnery::{PlayerGunOrders, group_id},
        vessel::CompiledShip,
        weapons::Ammunition,
    };
    use std::{collections::BTreeMap, sync::Arc};
    let catalog = Arc::new(
        Catalog::load(&std::fs::read("../../.build/naval-content/manifest.json").unwrap()).unwrap(),
    );
    let compiled: BTreeMap<_, _> = catalog
        .definitions
        .iter()
        .map(|(id, d)| (id.clone(), Arc::new(CompiledShip::new(d.clone()).unwrap())))
        .collect();
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../assets/gameplay/migration/battles.v1.json"
    ))
    .unwrap();
    for g in fixture["groups"].as_array().unwrap() {
        assert_eq!(
            json!(
                catalog.definitions[g["id"].as_str().unwrap()]
                    .mounts
                    .iter()
                    .map(group_id)
                    .collect::<Vec<_>>()
            ),
            g["groups"]
        );
    }
    for c in fixture["cases"].as_array().unwrap() {
        let setup: BattleSetup = serde_json::from_value(c["setup"].clone()).unwrap();
        let mut b = Battle::new(catalog.clone(), &compiled, setup).unwrap();
        if b.actors[0].definition().air_wing.is_some() {
            for s in &b.actors[0]
                .definition()
                .air_wing
                .as_ref()
                .unwrap()
                .squadrons
            {
                b.aviation.launch_squadron(
                    &b.actors[0],
                    &s.id,
                    Some(&b.actors[1]),
                    None,
                    &b.actors,
                    None,
                    None,
                );
            }
        }
        for tick in 1..=c["duration"].as_u64().unwrap() * 60 {
            let battery = c["battery"].as_str().unwrap();
            let aim = serde_json::from_value(c["aims"][(tick - 1) as usize].clone()).unwrap();
            let orders = BTreeMap::from([(
                "player".into(),
                Orders {
                    helm: Some(HelmCommand {
                        throttle: 0.6,
                        rudder: if tick < 900 { 0.4 } else { 0.0 },
                        ..Default::default()
                    }),
                    guns: Some(PlayerGunOrders {
                        battery: battery.into(),
                        weapon_group_id: None,
                        aim: Some(aim),
                        fire: true,
                        ammunition: BTreeMap::from([(
                            battery.into(),
                            if tick < 1200 {
                                Ammunition::Ap
                            } else {
                                Ammunition::He
                            },
                        )]),
                    }),
                    ..Default::default()
                },
            )]);
            b.step(&orders);
            if let Some(check) = c["checkpoints"]
                .as_array()
                .unwrap()
                .iter()
                .find(|p| p["tick"] == tick)
            {
                let expected = patched(&c["baseline"], &check["patches"]);
                compare(
                    &json!({"tick":b.tick,"actors":b.actors,"wings":b.aviation.wings,"shells":b.shells,"torpedoes":b.torpedoes,"depthCharges":b.depth_charges,"releases":b.air_releases,"events":b.events,"outcome":b.outcome,"score":b.records.scores.get("player"),"shellHistory":b.records.shell_history}),
                    &expected,
                    &format!("{}@{tick}", c["id"]),
                );
            }
        }
    }
}
