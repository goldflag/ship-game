use naval_sim::{
    aircraft::{AirOrder, Aircraft},
    aviation_step::AirContext,
    battle::{Battle, BattleSetup},
    catalog::Catalog,
    rules::TeamId,
    sensors::{self, ContactKind, Knowledge, Sensors, TrackStatus},
    snapshot::PresentationView,
    vessel::CompiledShip,
};
use std::{
    collections::BTreeMap,
    sync::{Arc, OnceLock},
};
type Content = (Arc<Catalog>, BTreeMap<String, Arc<CompiledShip>>);
fn content() -> &'static Content {
    static CONTENT: OnceLock<Content> = OnceLock::new();
    CONTENT.get_or_init(|| {
        let catalog = Arc::new(
            Catalog::load(&std::fs::read("../../.build/naval-content/manifest.json").unwrap())
                .unwrap(),
        );
        let compiled = ["fletcher", "enterprise-cv6"]
            .into_iter()
            .map(|id| (id.into(), Arc::new(catalog.compile(id).unwrap())))
            .collect();
        (catalog, compiled)
    })
}
fn battle() -> Battle {
    let (catalog, compiled) = content();
    let setup: BattleSetup = serde_json::from_value(serde_json::json!({
        "ships":[
            {"id":"own","presetId":"enterprise-cv6","team":"a","controller":"bot","aiLevel":"static","spawn":{"x":0,"z":0,"heading":0}},
            {"id":"private-ship","presetId":"fletcher","team":"b","controller":"bot","aiLevel":"static","spawn":{"x":0,"z":-5000,"heading":0}},
            {"id":"private-carrier","presetId":"enterprise-cv6","team":"b","controller":"bot","aiLevel":"static","spawn":{"x":18000,"z":0,"heading":0}}
        ], "seed":12345,"mapId":"north-atlantic","weather":"clear","spawnDistance":16000,"windSpeed":0,
        "missionRules":catalog.missions["pve-fleet-v1"]
    })).unwrap();
    Battle::new(catalog.clone(), compiled, setup).unwrap()
}
fn launch(b: &mut Battle, owner: &str, role: &str, position: [f64; 3]) -> String {
    let actor = b.actors.iter().find(|a| a.motion.id == owner).unwrap();
    let f = b
        .aviation
        .squadron_flights(actor)
        .into_iter()
        .find(|f| {
            b.aviation
                .wing(owner)
                .unwrap()
                .planes
                .iter()
                .any(|p| f.plane_ids.contains(&p.id) && p.role == role)
        })
        .unwrap();
    assert!(b.command_air(owner, &f.id, AirOrder::Patrol { point: position }));
    // Begin at the airborne decision boundary; takeoff geometry has separate tests.
    for (i, p) in b
        .aviation
        .wing_mut(owner)
        .unwrap()
        .planes
        .iter_mut()
        .filter(|p| f.plane_ids.contains(&p.id))
        .enumerate()
    {
        p.phase = "outbound".into();
        p.deck_slot = None;
        p.deck_position = None;
        p.position = [position[0] + i as f64 * 30.0, position[1], position[2]];
        p.previous_position = p.position;
        p.velocity = [0.0, 0.0, -85.0];
        p.heading = 0.0;
    }
    f.id
}
fn observe(b: &mut Battle, include_air: bool) {
    for _ in 0..6 {
        b.tick += 60;
        let mut entities = sensors::entities(&b.actors, &b.aviation);
        if !include_air {
            entities.retain(|e| e.kind != ContactKind::Aircraft || e.team != TeamId::A);
        }
        b.sensors.update(
            b.tick,
            &entities,
            &b.islands,
            &[],
            sensors::VisualConditions::resolve(&content().0, "north-atlantic", "clear"),
            &sensors::VisualRules::default(),
        );
    }
}
fn step_air(b: &mut Battle, reports: &Sensors, tick: u64, steps: usize) {
    for i in 0..steps {
        let mut ctx = AirContext {
            knowledge: Some(Knowledge {
                sensors: reports,
                tick: tick + i as u64,
                islands: &b.islands,
                terrain: &[],
            }),
            actors: &b.actors,
            shells: &mut b.shells,
            torpedoes: &mut b.torpedoes,
            releases: &mut b.air_releases,
            sequence: &mut b.sequence,
            events: &mut vec![],
            seed: b.seed,
            sea: None,
        };
        b.aviation
            .step(&mut ctx, 1.0 / 60.0, (tick + i as u64) as f64 / 60.0);
    }
}
fn own_planes(b: &Battle) -> Vec<Aircraft> {
    b.aviation.wing("own").unwrap().planes.clone()
}

#[test]
fn air_commands_use_owned_reports_and_mission_airspace_not_private_ids() {
    let mut b = battle();
    let flight = launch(&mut b, "own", "dive-bomber", [0.0, 850.0, -3500.0]);
    assert!(!b.command_air(
        "own",
        &flight,
        AirOrder::Attack {
            target_id: "private-ship".into()
        }
    ));
    assert!(!b.command_air(
        "own",
        &flight,
        AirOrder::Strike {
            contact_id: "private-ship".into()
        }
    ));
    assert!(!b.command_air(
        "own",
        &flight,
        AirOrder::Strike {
            contact_id: "contact-1-1".into()
        }
    ));
    observe(&mut b, true);
    let contact = b
        .sensors
        .track(TeamId::A, "private-ship")
        .unwrap()
        .id
        .clone();
    assert!(b.command_air(
        "own",
        &flight,
        AirOrder::Strike {
            contact_id: contact.clone()
        }
    ));
    assert!(!b.command_air(
        "own",
        &flight,
        AirOrder::InterceptContact {
            contact_id: contact.clone()
        }
    ));
    assert!(!b.command_air(
        "own",
        &flight,
        AirOrder::Patrol {
            point: [20000.0, 850.0, 20000.0]
        }
    ));
    // Beyond the old 30 km carrier-relative gate, inside the circular airspace.
    assert!(b.command_air(
        "private-carrier",
        &launch_id(&b, "private-carrier"),
        AirOrder::Patrol {
            point: [-20000.0, 850.0, 0.0]
        }
    ));
    let frame = b
        .presentation_value(PresentationView::Team(TeamId::A))
        .unwrap()
        .to_string();
    assert!(frame.contains(&contact));
    assert!(!frame.contains("private-ship"));
    assert!(!frame.contains("private-carrier"));
}
fn launch_id(b: &Battle, owner: &str) -> String {
    let a = b.actors.iter().find(|a| a.motion.id == owner).unwrap();
    b.aviation.squadron_flights(a)[0].id.clone()
}

#[test]
fn lost_ship_reports_cannot_follow_hidden_course_damage_or_position() {
    for role in ["dive-bomber", "torpedo-bomber"] {
        let mut a = battle();
        let mut b = battle();
        let fa = launch(&mut a, "own", role, [0.0, 850.0, -3500.0]);
        let fb = launch(&mut b, "own", role, [0.0, 850.0, -3500.0]);
        observe(&mut a, true);
        observe(&mut b, true);
        let contact = a
            .sensors
            .track(TeamId::A, "private-ship")
            .unwrap()
            .id
            .clone();
        for (battle, f) in [(&mut a, &fa), (&mut b, &fb)] {
            assert!(battle.command_air(
                "own",
                f,
                AirOrder::Strike {
                    contact_id: contact.clone()
                }
            ));
        }
        a.actors[1].motion.x = 22000.0;
        a.actors[1].motion.z = -10000.0;
        b.actors[1].motion.x = -22000.0;
        b.actors[1].motion.z = 10000.0;
        b.actors[1].motion.heading = 2.0;
        for m in &mut b.actors[1].mounts {
            m.hp = 0.0;
        }
        for _ in 0..420 {
            a.step(&BTreeMap::new());
            b.step(&BTreeMap::new());
        }
        assert_eq!(
            a.sensors.contact(TeamId::A, &contact).unwrap().status,
            TrackStatus::Lost
        );
        assert_eq!(
            serde_json::to_value(own_planes(&a)).unwrap(),
            serde_json::to_value(own_planes(&b)).unwrap(),
            "{role}"
        );
        let flight = a
            .aviation
            .wing("own")
            .unwrap()
            .flights
            .iter()
            .find(|f| f.id == fa)
            .unwrap();
        assert!(
            flight
                .notice
                .as_ref()
                .unwrap()
                .contains("Searching last report")
        );
        assert!(
            a.aviation
                .wing("own")
                .unwrap()
                .planes
                .iter()
                .filter(|p| p.flight_id.as_ref() == Some(&fa))
                .all(|p| p.payload && p.phase == "outbound")
        );
        assert!(a.air_releases.is_empty());
        let frame = a
            .presentation_value(PresentationView::Team(TeamId::A))
            .unwrap();
        assert!(
            frame["wings"][0]["state"]["planes"]
                .as_array()
                .unwrap()
                .iter()
                .any(|p| p["navigationTarget"].is_array())
        );
        assert!(!frame.to_string().contains("private-ship"));
    }
}

#[test]
fn a_ship_report_guides_a_strike_but_only_a_local_sighting_starts_the_attack() {
    let mut b = battle();
    let f = launch(&mut b, "own", "dive-bomber", [0.0, 850.0, -3500.0]);
    observe(&mut b, false);
    let c = b
        .sensors
        .track(TeamId::A, "private-ship")
        .unwrap()
        .id
        .clone();
    assert!(b.command_air("own", &f, AirOrder::Strike { contact_id: c }));
    let reports = std::mem::take(&mut b.sensors);
    let tick = b.tick;
    step_air(&mut b, &reports, tick, 30);
    b.sensors = reports;
    assert!(
        b.aviation
            .wing("own")
            .unwrap()
            .planes
            .iter()
            .filter(|p| p.flight_id.as_ref() == Some(&f))
            .all(|p| p.pilot.attack_stage.is_none() && p.payload)
    );
    observe(&mut b, true);
    let reports = std::mem::take(&mut b.sensors);
    let tick = b.tick;
    step_air(&mut b, &reports, tick, 1);
    assert!(
        b.aviation
            .wing("own")
            .unwrap()
            .planes
            .iter()
            .filter(|p| p.flight_id.as_ref() == Some(&f))
            .all(|p| p.pilot.attack_stage.is_some())
    );
}

#[test]
fn cap_does_not_acquire_unreported_aircraft_inside_its_old_automatic_radius() {
    let mut a = battle();
    let mut b = battle();
    for battle in [&mut a, &mut b] {
        launch(battle, "own", "fighter", [0.0, 420.0, -1000.0]);
        launch(battle, "private-carrier", "fighter", [0.0, 420.0, -1600.0]);
    }
    for p in b
        .aviation
        .wing_mut("private-carrier")
        .unwrap()
        .planes
        .iter_mut()
        .filter(|p| p.phase == "outbound")
    {
        p.position[0] += 900.0;
        p.hp = 30.0;
        p.payload = true;
        p.velocity = [80.0, 0.0, 0.0];
    }
    let empty = Sensors::default();
    step_air(&mut a, &empty, 0, 180);
    step_air(&mut b, &empty, 0, 180);
    assert_eq!(
        serde_json::to_value(own_planes(&a)).unwrap(),
        serde_json::to_value(own_planes(&b)).unwrap()
    );
    assert!(own_planes(&a).iter().all(|p| p.pilot.hostile_id.is_none()));
    assert!(
        own_planes(&a)
            .iter()
            .filter(|p| p.phase == "outbound")
            .all(|p| p.ammo == 16.0)
    );
}

#[test]
fn interception_follows_team_reports_then_engages_only_with_local_acquisition() {
    let mut b = battle();
    let f = launch(&mut b, "own", "fighter", [0.0, 420.0, -1000.0]);
    launch(&mut b, "private-carrier", "fighter", [0.0, 420.0, -3600.0]);
    observe(&mut b, false);
    let contact = b
        .sensors
        .contacts(TeamId::A)
        .into_iter()
        .find(|c| c.kind == ContactKind::Aircraft)
        .unwrap()
        .id;
    assert!(b.command_air(
        "own",
        &f,
        AirOrder::InterceptContact {
            contact_id: contact.clone()
        }
    ));
    let reports = std::mem::take(&mut b.sensors);
    let tick = b.tick;
    step_air(&mut b, &reports, tick, 30);
    b.sensors = reports;
    assert!(own_planes(&b).iter().all(|p| p.pilot.hostile_id.is_none()));
    observe(&mut b, true);
    let reports = std::mem::take(&mut b.sensors);
    let tick = b.tick;
    step_air(&mut b, &reports, tick, 1);
    assert!(own_planes(&b).iter().filter(|p| p.flight_id.as_ref() == Some(&f)).all(|p|p.pilot.hostile_id.as_deref() == Some(contact.as_str()) && p.phase == "attack"));
    // With the same final report and no new observations, the interception
    // returns to a search even while the physical target still exists nearby.
    step_air(&mut b, &reports, tick + 180, 1);
    assert!(
        own_planes(&b)
            .iter()
            .filter(|p| p.flight_id.as_ref() == Some(&f))
            .all(|p| p.pilot.hostile_id.is_none() && p.phase == "outbound")
    );
}

#[test]
fn firing_at_a_recent_aircraft_report_does_not_damage_its_empty_marker_or_overwrite_the_real_aircraft()
 {
    let mut b = battle();
    launch(&mut b, "own", "fighter", [0.0, 420.0, -1000.0]);
    let enemy = launch(&mut b, "private-carrier", "fighter", [0.0, 420.0, -1300.0]);
    observe(&mut b, true);
    // Move the actual aircraft away after its last sighting, before the
    // projectile reaches it. The pilot still aims at the recent measurement.
    for p in b
        .aviation
        .wing_mut("private-carrier")
        .unwrap()
        .planes
        .iter_mut()
        .filter(|p| p.flight_id.as_ref() == Some(&enemy))
    {
        p.position[0] += 200.0;
        p.hp = 37.0;
        p.ammo = 0.0;
    }
    let reports = std::mem::take(&mut b.sensors);
    let tick = b.tick;
    step_air(&mut b, &reports, tick, 30);
    assert!(
        own_planes(&b).iter().any(|p| p.ammo < 16.0),
        "Fighters must actually fire in this case"
    );
    assert!(
        b.aviation
            .wing("private-carrier")
            .unwrap()
            .planes
            .iter()
            .filter(|p| p.flight_id.as_ref() == Some(&enemy))
            .all(|p| p.hp == 37.0 && p.ammo == 0.0 && p.position[0] >= 190.0)
    );
}

fn search_order(policy: naval_sim::aircraft::SearchPolicy) -> AirOrder {
    AirOrder::SearchArea {
        center: [0.0, -5000.0],
        radius_m: 2000.0,
        altitude: naval_sim::aircraft::SearchAltitude::Medium,
        policy,
    }
}
#[test]
fn finite_search_flies_the_sweep_and_returns_with_payload_instead_of_orbiting_forever() {
    use naval_sim::aircraft::SearchPolicy;
    let mut b = battle();
    let flight = launch(&mut b, "own", "dive-bomber", [0.0, 850.0, -3500.0]);
    assert!(b.command_air("own", &flight, search_order(SearchPolicy::Report)));
    let reports = Sensors::default();
    let ids = b
        .aviation
        .wing("own")
        .unwrap()
        .flights
        .iter()
        .find(|f| f.id == flight)
        .unwrap()
        .plane_ids
        .clone();
    for tick in 0..60000 {
        step_air(&mut b, &reports, tick, 1);
        let planes: Vec<_> = b
            .aviation
            .wing("own")
            .unwrap()
            .planes
            .iter()
            .filter(|p| ids.contains(&p.id))
            .collect();
        if planes.iter().all(|p| p.phase == "returning") {
            for p in planes {
                let search = p.search.as_ref().unwrap();
                assert_eq!(
                    search.waypoint,
                    search.route.len(),
                    "must fly every leg, not just time out"
                );
                assert!(search.elapsed_seconds < search.deadline_seconds);
                assert!(p.payload);
                assert!(p.target_id.is_none());
                assert!(search.trail.len() <= 19);
                assert!(
                    search
                        .route
                        .iter()
                        .all(|point| (point[0]).hypot(point[2] + 5000.0) <= 2000.0)
                );
            }
            assert!(b.air_releases.is_empty());
            return;
        }
    }
    panic!("search failed to return");
}
#[test]
fn search_policy_preserves_scout_weapons_and_requires_local_sighting_for_opportunistic_strikes() {
    use naval_sim::aircraft::SearchPolicy;
    for policy in [
        SearchPolicy::Report,
        SearchPolicy::Shadow,
        SearchPolicy::Strike,
    ] {
        let mut b = battle();
        let flight = launch(&mut b, "own", "dive-bomber", [0.0, 850.0, -3500.0]);
        observe(&mut b, false);
        assert!(b.command_air("own", &flight, search_order(policy)));
        let reports = std::mem::take(&mut b.sensors);
        let tick = b.tick;
        step_air(&mut b, &reports, tick, 1);
        assert!(own_planes(&b).iter().all(|p| p.target_id.is_none()));
        b.sensors = reports;
        observe(&mut b, true);
        let reports = std::mem::take(&mut b.sensors);
        let tick = b.tick;
        step_air(&mut b, &reports, tick, 1);
        let planes: Vec<_> = own_planes(&b)
            .into_iter()
            .filter(|p| p.flight_id.as_ref() == Some(&flight))
            .collect();
        assert!(planes.iter().all(|p| p.payload));
        assert!(b.air_releases.is_empty());
        match policy {
            SearchPolicy::Report => assert!(
                planes
                    .iter()
                    .all(|p| p.target_id.is_none() && p.pilot.attack_stage.is_none())
            ),
            SearchPolicy::Shadow => assert!(planes.iter().all(|p| p.target_id.is_some()
                && p.pilot.attack_stage.is_none()
                && p.search.as_ref().unwrap().shadow_seconds > 0.0)),
            SearchPolicy::Strike => assert!(
                planes
                    .iter()
                    .all(|p| p.target_id.is_some() && p.pilot.attack_stage.is_some())
            ),
        }
    }
}
#[test]
fn search_bounds_and_role_validation_are_atomic_and_scouts_withdraw_from_local_air_threats() {
    use naval_sim::aircraft::{SearchAltitude, SearchPolicy};
    let mut b = battle();
    let fighter = launch(&mut b, "own", "fighter", [0.0, 850.0, -3500.0]);
    assert!(!b.command_air("own", &fighter, search_order(SearchPolicy::Strike)));
    for (center, radius_m) in [
        ([0.0, 23000.0], 2000.0),
        ([0.0, 0.0], f64::NAN),
        ([0.0, 0.0], 500.0),
        ([f64::INFINITY, 0.0], 2000.0),
    ] {
        assert!(!b.command_air(
            "own",
            &fighter,
            AirOrder::SearchArea {
                center,
                radius_m,
                altitude: SearchAltitude::Low,
                policy: SearchPolicy::Report
            }
        ));
    }
    assert!(matches!(
        b.aviation
            .wing("own")
            .unwrap()
            .flights
            .iter()
            .find(|f| f.id == fighter)
            .unwrap()
            .order,
        AirOrder::Patrol { .. }
    ));
    assert!(b.command_air("own", &fighter, search_order(SearchPolicy::Shadow)));
    launch(&mut b, "private-carrier", "fighter", [0.0, 850.0, -4100.0]);
    // An unreported nearby threat must not cause withdrawal or any new knowledge.
    step_air(&mut b, &Sensors::default(), 0, 1);
    assert!(
        own_planes(&b)
            .iter()
            .filter(|p| p.flight_id.as_ref() == Some(&fighter))
            .all(|p| p.phase == "outbound")
    );
    observe(&mut b, true);
    let reports = std::mem::take(&mut b.sensors);
    let tick = b.tick;
    step_air(&mut b, &reports, tick, 1);
    assert!(
        own_planes(&b)
            .iter()
            .filter(|p| p.flight_id.as_ref() == Some(&fighter))
            .all(|p| p.phase == "returning" && p.ammo == 16.0)
    );
}

#[test]
fn spotted_aircraft_publish_only_visible_exteriors_and_stop_when_sight_is_lost() {
    let mut b = battle();
    launch(&mut b, "private-carrier", "fighter", [0.0, 420.0, -1600.0]);
    let plane = b
        .aviation
        .wing("private-carrier")
        .unwrap()
        .planes
        .iter()
        .find(|p| p.phase == "outbound")
        .unwrap()
        .clone();
    observe(&mut b, true);
    let frame = b
        .presentation_value(PresentationView::Team(TeamId::A))
        .unwrap();
    let exteriors = frame["observedAircraft"].as_array().unwrap();
    assert!(!exteriors.is_empty());
    let id = &b.sensors.track(TeamId::A, &plane.id).unwrap().id;
    let exterior = exteriors.iter().find(|p| p["id"] == *id).unwrap();
    assert_eq!(exterior["position"], serde_json::json!(plane.position));
    assert_eq!(exterior["modelId"], plane.model_id);
    assert_eq!(exterior["health"], plane.hp / 100.0);
    assert_eq!(exterior["velocity"], serde_json::json!(plane.velocity));
    assert!(
        exterior["observers"]
            .as_array()
            .unwrap()
            .iter()
            .any(|id| id == "own")
    );
    // A slung torpedo or bomb is exterior state, like wing fold; rounds and orders stay private.
    assert_eq!(exterior["payload"], plane.payload);
    for field in [
        "ownerId", "hp", "ammo", "order", "pilot", "targetId", "flightId", "behavior",
    ] {
        assert!(exterior.get(field).is_none(), "private field {field}");
    }
    assert!(!frame.to_string().contains("private-carrier"));
    assert_eq!(frame["wings"].as_array().unwrap().len(), 1);
    // Moving a hidden plane, its controls and damage after the observation
    // cannot update its retained exterior before another visibility sample.
    for p in b
        .aviation
        .wing_mut("private-carrier")
        .unwrap()
        .planes
        .iter_mut()
    {
        p.position = [28000.0, 400.0, 18000.0];
        p.hp = 1.0;
        p.heading = 2.0;
    }
    assert_eq!(
        b.presentation_value(PresentationView::Team(TeamId::A))
            .unwrap()["observedAircraft"],
        frame["observedAircraft"]
    );
    observe(&mut b, true);
    let hidden = b
        .presentation_value(PresentationView::Team(TeamId::A))
        .unwrap();
    assert!(hidden["observedAircraft"].as_array().unwrap().is_empty());
    assert!(
        !hidden["contacts"].as_array().unwrap().is_empty(),
        "last-known reports remain on the chart"
    );
}

#[test]
fn bomber_evasion_requires_local_observation_or_actual_nearby_fire() {
    let mut visible = battle();
    let mut hidden = battle();
    for b in [&mut visible, &mut hidden] {
        launch(b, "own", "dive-bomber", [0.0, 850.0, -3500.0]);
        launch(b, "private-carrier", "fighter", [0.0, 850.0, -2800.0]);
    }
    observe(&mut visible, true);
    let reports = std::mem::take(&mut visible.sensors);
    let tick = visible.tick;
    step_air(&mut visible, &reports, tick, 1);
    step_air(&mut hidden, &Sensors::default(), tick, 1);
    assert!(own_planes(&visible).iter().any(|p| {
        p.pilot
            .defense
            .as_ref()
            .is_some_and(|d| d.maneuver_seconds > 0.0)
    }));
    assert!(
        own_planes(&hidden)
            .iter()
            .all(|p| p.pilot.defense.is_none())
    );
    let id = own_planes(&hidden)
        .iter()
        .find(|p| p.phase == "outbound")
        .unwrap()
        .id
        .clone();
    naval_sim::aircraft_defense::near_fire(
        hidden.aviation.plane_mut(&id).unwrap(),
        [0.0, 850.0, -2800.0],
    );
    step_air(&mut hidden, &Sensors::default(), tick + 1, 1);
    assert!(
        hidden
            .aviation
            .plane_mut(&id)
            .unwrap()
            .pilot
            .defense
            .as_ref()
            .unwrap()
            .maneuver_seconds
            > 0.0
    );
}

#[test]
fn owned_flights_publish_activity_without_private_pilot_state() {
    let mut b = battle();
    let flight = launch(&mut b, "own", "dive-bomber", [0.0, 850.0, -3500.0]);
    let p = b
        .aviation
        .wing_mut("own")
        .unwrap()
        .planes
        .iter_mut()
        .find(|p| p.flight_id.as_ref() == Some(&flight))
        .unwrap();
    p.pilot.recovery = Some(naval_sim::aircraft_recovery::RecoveryProgress {
        notice: Some("Carrier turning too sharply · Steady the course to recover aircraft".into()),
        ..Default::default()
    });
    p.pilot.defense = Some(naval_sim::aircraft_defense::DefenseState {
        notice: Some("Evading fighter".into()),
        maneuver_seconds: 4.0,
        ..Default::default()
    });
    let id = p.id.clone();
    for frame in [
        b.presentation_value(PresentationView::FullKnowledge)
            .unwrap(),
        b.presentation_value(PresentationView::Team(TeamId::A))
            .unwrap(),
        serde_json::to_value(b.presentation_snapshot()).unwrap(),
    ] {
        let p = frame["wings"][0]["state"]["planes"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["id"] == id)
            .unwrap();
        assert!(p.get("pilot").is_none());
        assert_eq!(p["behavior"]["evasionNotice"], "Evading fighter");
        assert!(
            p["behavior"]["recoveryNotice"]
                .as_str()
                .unwrap()
                .contains("Steady the course")
        );
        assert_eq!(p["behavior"].as_object().unwrap().len(), 2);
    }
}
