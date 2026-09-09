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
            .map(|id| {
                (
                    id.into(),
                    Arc::new(CompiledShip::new(catalog.definitions[id].clone()).unwrap()),
                )
            })
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
