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
