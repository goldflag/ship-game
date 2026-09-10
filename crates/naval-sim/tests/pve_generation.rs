use naval_sim::{
    bots::AiLevel,
    catalog::Catalog,
    pve::{FleetShip, GroupStation, Placement, PvePlan, PveRequest, TaskGroup, eligible_presets},
    rules::TeamId,
};
use std::{collections::BTreeSet, sync::OnceLock};
fn catalog() -> &'static Catalog {
    static CONTENT: OnceLock<Catalog> = OnceLock::new();
    CONTENT.get_or_init(|| {
        Catalog::load(&std::fs::read("../../.build/naval-content/manifest.json").unwrap()).unwrap()
    })
}
fn battle(plan: &PvePlan) -> naval_sim::battle::Battle {
    use std::{collections::BTreeMap, sync::Arc};
    static COMPILED: OnceLock<BTreeMap<String, Arc<naval_sim::vessel::CompiledShip>>> =
        OnceLock::new();
    let compiled = COMPILED.get_or_init(|| {
        ["fletcher", "enterprise-cv6"]
            .into_iter()
            .map(|id| {
                (
                    id.into(),
                    Arc::new(
                        naval_sim::vessel::CompiledShip::new(catalog().definitions[id].clone())
                            .unwrap(),
                    ),
                )
            })
            .collect()
    });
    // Restrict only this focused command fixture's available pool.
    naval_sim::battle::Battle::new(Arc::new(catalog().clone()), compiled, plan.restart_setup())
        .unwrap()
}
fn request(seed: u32, ids: &[&str], map: &str) -> PveRequest {
    PveRequest {
        version: 1,
        seed,
        map_id: map.into(),
        weather: "clear".into(),
        difficulty: AiLevel::Normal,
        ships: ids
            .iter()
            .enumerate()
            .map(|(i, id)| FleetShip {
                id: format!("ship-{i}"),
                preset_id: (*id).into(),
                group_id: if id.contains("enterprise") || *id == "shokaku" {
                    "rear"
                } else {
                    "front"
                }
                .into(),
            })
            .collect(),
        groups: vec![
            TaskGroup {
                id: "front".into(),
                name: "Surface force".into(),
                station: GroupStation::Front,
            },
            TaskGroup {
                id: "rear".into(),
                name: "Carrier force".into(),
                station: GroupStation::Rear,
            },
        ],
    }
}
#[test]
fn generated_fleets_scale_to_selected_fleet_and_respect_every_hard_cap_across_maps() {
    let catalog = catalog();
    let rules = &catalog.missions["pve-fleet-v1"];
    let mut complements = BTreeSet::new();
    let mut layouts = BTreeSet::new();
    for map in catalog.map_ids().unwrap() {
        for seed in 0..24 {
            let ids = if seed % 2 == 0 {
                vec!["bismarck", "baltimore", "fletcher", "fletcher"]
            } else {
                vec!["enterprise-cv6", "baltimore", "fletcher", "fletcher"]
            };
            let plan = PvePlan::generate(catalog, request(seed, &ids, &map)).unwrap();
            let setup = plan.restart_setup();
            let own = rules
                .budget
                .resolve(
                    &ids.iter().map(|id| (*id).into()).collect::<Vec<_>>(),
                    catalog,
                )
                .unwrap();
            let enemy: Vec<_> = setup.ships.iter().filter(|s| s.team == TeamId::B).collect();
            let total = rules
                .budget
                .resolve(
                    &enemy
                        .iter()
                        .map(|s| s.preset_id.clone())
                        .collect::<Vec<_>>(),
                    catalog,
                )
                .unwrap();
            assert!(
                (0.85..=1.15)
                    .contains(&(total.displacement_kg as f64 / own.displacement_kg as f64))
            );
            let environment = catalog
                .resolve_pve_environment(&map, "clear", seed, rules, None)
                .unwrap();
            for (index, ship) in setup.ships.iter().enumerate() {
                let p = ship.spawn.as_ref().unwrap();
                assert!(rules.area.contains(
                    [p.x, p.z],
                    catalog.definitions[&ship.preset_id].hull.length / 2.0
                ));
                assert!(if ship.team == TeamId::A {
                    p.z >= 7000.0
                } else {
                    p.z <= -7000.0
                });
                assert!(setup.ships[..index].iter().all(|s| {
                    let o = s.spawn.as_ref().unwrap();
                    (o.x - p.x).hypot(o.z - p.z) >= 350.0
                }));
                assert!(environment.islands.iter().all(|i| {
                    let mut expanded = i.clone();
                    expanded.rx += 250.0;
                    expanded.rz += 250.0;
                    expanded.radius(p.x, p.z) > 1.05
                }));
            }
            complements.insert(
                enemy
                    .iter()
                    .map(|s| s.preset_id.clone())
                    .collect::<Vec<_>>(),
            );
            layouts.insert(serde_json::to_string(&enemy).unwrap());
        }
    }
    assert!(
        complements.len() > 8,
        "Generator must vary actual complements"
    );
    assert!(layouts.len() >= 24);
}
#[test]
fn tiny_fleet_and_one_preset_catalog_have_a_small_legal_opponent() {
    let mut content = catalog().clone();
    content.definitions.retain(|id, _| id == "fletcher");
    let plan = PvePlan::generate(&content, request(42, &["fletcher"], "north-atlantic")).unwrap();
    assert_eq!(plan.restart_setup().ships.len(), 2);
    assert!(
        plan.restart_setup()
            .ships
            .iter()
            .all(|s| s.preset_id == "fletcher")
    );
    assert_eq!(eligible_presets(&content), ["fletcher"]);
    // Reject the entire reserved namespace, independent of actual enemy size.
    for id in ["opponent-1", "opponent-15", "opponent-99999"] {
        let mut req = request(42, &["fletcher"], "north-atlantic");
        req.ships[0].id = id.into();
        assert!(PvePlan::generate(&content, req).is_err());
    }
}
#[test]
fn seed_repeats_setup_and_friendly_placement_never_rerolls_or_exposes_enemy() {
    let content = catalog();
    let req = request(51, &["baltimore", "fletcher"], "pacific-islands");
    let mut plan = PvePlan::generate(content, req.clone()).unwrap();
    let repeat = PvePlan::generate(content, req).unwrap();
    let initial = serde_json::to_value(plan.restart_setup()).unwrap();
    assert_eq!(
        initial,
        serde_json::to_value(repeat.restart_setup()).unwrap()
    );
    let briefing = plan.briefing(content);
    assert!(briefing.setup.ships.iter().all(|s| s.team == TeamId::A));
    assert!(
        !serde_json::to_string(&briefing)
            .unwrap()
            .contains("opponent-")
    );
    let enemy_before: Vec<_> = plan
        .restart_setup()
        .ships
        .into_iter()
        .filter(|s| s.team == TeamId::B)
        .collect();
    let placements: Vec<_> = briefing
        .setup
        .ships
        .iter()
        .enumerate()
        .map(|(i, s)| Placement {
            id: s.id.clone(),
            spawn: naval_sim::battle::Spawn {
                x: i as f64 * 750.0,
                z: 9000.0,
                heading: 0.2,
            },
        })
        .collect();
    let changed = plan.deploy(content, placements.clone()).unwrap();
    let enemy_after: Vec<_> = changed
        .ships
        .into_iter()
        .filter(|s| s.team == TeamId::B)
        .collect();
    assert_eq!(
        serde_json::to_value(enemy_before).unwrap(),
        serde_json::to_value(enemy_after).unwrap()
    );
    let accepted = serde_json::to_value(plan.restart_setup()).unwrap();
    let mut invalid = placements;
    invalid[0].spawn.z = -8000.0;
    assert!(plan.deploy(content, invalid).is_err());
    assert_eq!(
        accepted,
        serde_json::to_value(plan.restart_setup()).unwrap(),
        "Rejected placement is atomic"
    );
}
#[test]
fn mission_geography_is_independent_of_private_roster_and_initial_pool_excludes_unsupported_ships()
{
    let content = catalog();
    let eligible = eligible_presets(content);
    assert!(eligible.contains(&"shokaku".into()));
    for id in [
        "type-viic",
        "liberty-cargo",
        "liberty-collier",
        "victory-cargo",
    ] {
        assert!(!eligible.contains(&id.into()));
    }
    for map in content.map_ids().unwrap() {
        let small = PvePlan::generate(content, request(55, &["fletcher"], &map))
            .unwrap()
            .briefing(content);
        let large = PvePlan::generate(
            content,
            request(55, &["iowa", "bismarck", "baltimore", "fletcher"], &map),
        )
        .unwrap()
        .briefing(content);
        let environment = |setup: &naval_sim::battle::BattleSetup| {
            serde_json::to_value(
                content
                    .resolve_pve_environment(
                        &setup.map_id,
                        &setup.weather,
                        setup.seed,
                        setup.mission_rules.as_ref().unwrap(),
                        setup.wind_speed,
                    )
                    .unwrap(),
            )
            .unwrap()
        };
        assert_eq!(environment(&small.setup), environment(&large.setup));
    }
}

#[test]
fn opening_orders_keep_rear_escorts_with_the_carrier_and_surface_orders_under_player_control() {
    use naval_sim::navigation::Movement;
    let mut content = catalog().clone();
    content
        .definitions
        .retain(|id, _| matches!(id.as_str(), "fletcher" | "enterprise-cv6"));
    let mut req = request(
        812,
        &["enterprise-cv6", "fletcher", "fletcher"],
        "north-atlantic",
    );
    req.ships[1].group_id = "rear".into();
    let plan = PvePlan::generate(&content, req).unwrap();
    let battle = battle(&plan);
    let orders = plan.initial_directives(&battle);
    assert!(matches!(
        &orders["ship-0"].0,
        Movement::Route { looped: true, .. }
    ));
    assert!(matches!(&orders["ship-1"].0,Movement::Escort{leader_id,..} if leader_id=="ship-0"));
    assert!(matches!(&orders["ship-2"].0, Movement::HoldArea { .. }));
    assert!(orders.values().all(|(_, target)| target.is_none()));
}
#[test]
fn enemy_search_orders_do_not_change_when_unobserved_friendly_ships_move() {
    let mut content = catalog().clone();
    content.definitions.retain(|id, _| id == "fletcher");
    let plan = PvePlan::generate(
        &content,
        request(83, &["fletcher", "fletcher"], "north-atlantic"),
    )
    .unwrap();
    let mut battle = battle(&plan);
    let before = serde_json::to_value(plan.enemy_directives(&battle)).unwrap();
    for actor in battle.actors.iter_mut().filter(|a| a.team == TeamId::A) {
        actor.motion.x = 18000.0;
        actor.motion.z = 12000.0;
        actor.motion.heading = 1.2;
    }
    let after = serde_json::to_value(plan.enemy_directives(&battle)).unwrap();
    assert_eq!(before, after);
    assert!(
        plan.enemy_directives(&battle)
            .keys()
            .all(|id| id.starts_with("opponent-"))
    );
}

#[test]
fn enemy_air_commander_scouts_before_striking_uses_reports_and_keeps_fighter_support() {
    use naval_sim::{aircraft::AirOrder, pve_air::AirIntent, sensors};
    let mut content = catalog().clone();
    content.definitions.retain(|id, _| id == "enterprise-cv6");
    let plan =
        PvePlan::generate(&content, request(83, &["enterprise-cv6"], "north-atlantic")).unwrap();
    let mut battle = battle(&plan);
    assert!(plan.enemy_air_directives(&battle).is_empty());
    battle.tick = 300;
    let directives = plan.enemy_air_directives(&battle);
    assert_eq!(directives.len(), 1);
    let cap = &directives[0];
    assert!(cap.carrier_id.starts_with("opponent-"));
    let AirIntent::Order(order @ AirOrder::Defend { .. }) = &cap.intent else {
        panic!("initial air decision must protect the carrier")
    };
    assert!(battle.command_air(&cap.carrier_id, &cap.flight_id, order.clone()));
    battle.tick = 600;
    let before = serde_json::to_value(plan.enemy_air_directives(&battle)).unwrap();
    for a in battle.actors.iter_mut().filter(|a| a.team == TeamId::A) {
        a.motion.x = 18000.0;
        a.motion.z = 12000.0;
        a.motion.heading = 1.2;
        a.damage.integrity *= 0.25;
    }
    assert_eq!(
        before,
        serde_json::to_value(plan.enemy_air_directives(&battle)).unwrap()
    );
    let scout = plan.enemy_air_directives(&battle).remove(0);
    let AirIntent::Order(order @ AirOrder::SearchArea { .. }) = scout.intent else {
        panic!("no contact: search")
    };
    assert!(battle.command_air(&scout.carrier_id, &scout.flight_id, order));
    let own_carrier = battle
        .actors
        .iter()
        .find(|a| a.team == TeamId::B)
        .unwrap()
        .motion
        .clone();
    for a in battle.actors.iter_mut().filter(|a| a.team == TeamId::A) {
        a.motion.x = own_carrier.x;
        a.motion.z = own_carrier.z + 5000.0;
    }
    for _ in 0..6 {
        battle.tick += 60;
        battle.sensors.update(
            battle.tick,
            &sensors::entities(&battle.actors, &battle.aviation),
            &battle.islands,
            &[],
            sensors::VisualConditions::resolve(catalog(), "north-atlantic", "clear"),
            &sensors::VisualRules::default(),
        );
    }
    battle.tick = 1200;
    let strike = plan.enemy_air_directives(&battle).remove(0);
    let AirIntent::Order(order @ AirOrder::Strike { .. }) = strike.intent else {
        panic!("observed surface contact: commit a strike")
    };
    let AirOrder::Strike { contact_id } = &order else {
        unreachable!()
    };
    assert!(battle.sensors.contact(TeamId::B, contact_id).is_some());
    assert!(!contact_id.starts_with("ship-"));
    assert!(battle.command_air(&strike.carrier_id, &strike.flight_id, order));
    battle.tick = 1500;
    let escort = plan.enemy_air_directives(&battle).remove(0);
    let AirIntent::Order(order @ AirOrder::Escort { .. }) = escort.intent else {
        panic!("strike needs a fighter escort")
    };
    assert!(battle.command_air(&escort.carrier_id, &escort.flight_id, order));
    assert!(
        battle.aviation.wing("ship-0").unwrap().flights.is_empty(),
        "the commander never launches the human's aircraft"
    );
    assert_eq!(
        battle.aviation.wing(&cap.carrier_id).unwrap().flights.len(),
        4
    );
}

#[test]
fn enemy_front_loss_repositions_carriers_and_keeps_surviving_escorts_with_them() {
    use naval_sim::{navigation::Movement, sensors};
    let mut content = catalog().clone();
    content
        .definitions
        .retain(|id, _| matches!(id.as_str(), "fletcher" | "enterprise-cv6"));
    let plan = (0..50)
        .map(|seed| {
            PvePlan::generate(
                &content,
                request(
                    seed,
                    &["enterprise-cv6", "fletcher", "fletcher", "fletcher"],
                    "north-atlantic",
                ),
            )
            .unwrap()
        })
        .find(|p| {
            let b = battle(p);
            b.actors
                .iter()
                .any(|a| a.team == TeamId::B && a.definition().air_wing.is_some())
                && p.initial_directives(&b).iter().any(|(id, (m, _))| {
                    id.starts_with("opponent-")
                        && matches!(m,Movement::Route{waypoints,..} if waypoints.len()==6)
                })
        })
        .unwrap();
    let mut battle = battle(&plan);
    battle.islands.clear();
    for (i, a) in battle.actors.iter_mut().enumerate() {
        a.motion.x = i as f64 * 500.0;
        a.motion.z = if a.team == TeamId::A { -6000.0 } else { 0.0 };
    }
    for tick in (0..=600).step_by(60) {
        battle.sensors.update(
            tick,
            &sensors::entities(&battle.actors, &battle.aviation),
            &[],
            &[],
            sensors::VisualConditions::resolve(catalog(), "north-atlantic", "clear"),
            &sensors::VisualRules::default(),
        );
    }
    battle.tick = 600;
    // The carrier is outside the close-threat withdrawal threshold. Only the
    // subsequent loss of the front should change its rear patrol into retreat.
    let carrier_id = battle
        .actors
        .iter_mut()
        .find(|a| a.team == TeamId::B && a.definition().air_wing.is_some())
        .map(|a| {
            a.motion.z = 6000.0;
            a.motion.id.clone()
        })
        .unwrap();
    assert!(matches!(
        &plan.enemy_directives(&battle)[&carrier_id].0,
        Movement::Route { looped: true, .. }
    ));
    let opening = plan.initial_directives(&battle);
    let front_leaders: Vec<_> = opening
        .iter()
        .filter(|(id, (m, _))| {
            id.starts_with("opponent-")
                && matches!(m,Movement::Route{waypoints,..} if waypoints.len()==6)
        })
        .map(|(id, _)| id.clone())
        .collect();
    let front: Vec<_> = opening
        .iter()
        .filter(|(id, (m, _))| {
            front_leaders.contains(id)
                || matches!(m,Movement::Escort{leader_id,..} if front_leaders.contains(leader_id))
        })
        .map(|(id, _)| id.clone())
        .collect();
    for a in battle
        .actors
        .iter_mut()
        .filter(|a| front.contains(&a.motion.id))
    {
        a.damage.sunk = true;
    }
    let directives = plan.enemy_directives(&battle);
    let carrier = battle
        .actors
        .iter()
        .find(|a| a.team == TeamId::B && a.definition().air_wing.is_some())
        .unwrap();
    let (movement, target) = &directives[&carrier.motion.id];
    let contact = battle
        .sensors
        .contact(TeamId::B, target.as_ref().unwrap())
        .unwrap();
    let Movement::Route {
        waypoints,
        looped: false,
        ..
    } = movement
    else {
        panic!("exposed carrier must withdraw, got {movement:?}")
    };
    let before = (carrier.motion.x - contact.estimated_position[0])
        .hypot(carrier.motion.z - contact.estimated_position[2]);
    let after = (waypoints[0][0] - contact.estimated_position[0])
        .hypot(waypoints[0][1] - contact.estimated_position[2]);
    assert!(
        after > before + 2000.0,
        "retreat must open range: {before} -> {after}"
    );
    assert!(
        directives
            .values()
            .all(|(_, t)| t.as_ref().is_none_or(|id| id.starts_with("contact-")))
    );
    for (id, (movement, _)) in &directives {
        if id != &carrier.motion.id && !front.contains(id) {
            assert!(
                matches!(movement,Movement::Escort{leader_id,..} if leader_id==&carrier.motion.id)
            );
        }
    }
    let before = serde_json::to_value(&directives).unwrap();
    for a in battle.actors.iter_mut().filter(|a| a.team == TeamId::A) {
        a.motion.x = 18000.0;
        a.motion.z = 15000.0;
        a.damage.integrity *= 0.1;
    }
    assert_eq!(
        before,
        serde_json::to_value(plan.enemy_directives(&battle)).unwrap(),
        "hidden manoeuvres and damage cannot retarget retreat"
    );
}
