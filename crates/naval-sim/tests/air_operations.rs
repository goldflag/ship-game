//! Order-level regression tests: real inventory/admission/deck cycle, with
//! controlled airborne starting positions to isolate relief and coordination.
use naval_sim::{
    air_rules::{ActiveFlights, EndurancePolicy},
    aircraft::{AirOrder, Aircraft},
    aviation::Aviation,
    aviation_step::AirContext,
    catalog::Catalog,
    rules::TeamId,
    vessel::{CompiledShip, Controller, Vessel},
};
use std::sync::{Arc, OnceLock};
fn catalog() -> &'static Catalog {
    static C: OnceLock<Catalog> = OnceLock::new();
    C.get_or_init(|| {
        Catalog::load(&std::fs::read("../../.build/naval-content/manifest.json").unwrap()).unwrap()
    })
}
fn actors() -> Vec<Vessel> {
    [
        ("carrier", "enterprise-cv6", TeamId::A, 0.0),
        ("other", "enterprise-cv6", TeamId::A, 4000.0),
        ("target", "bismarck", TeamId::B, 14000.0),
    ]
    .into_iter()
    .map(|(id, preset, team, x)| {
        let mut a = Vessel::new(
            id,
            team,
            Arc::new(CompiledShip::new(catalog().definitions[preset].clone()).unwrap()),
        );
        a.controller = Controller::Player;
        a.motion.x = x;
        a
    })
    .collect()
}
fn setup() -> (Vec<Vessel>, Aviation) {
    let actors = actors();
    let air = Aviation::with_rules(
        &actors,
        catalog().aircraft.clone(),
        catalog().air_profiles["pve-air-v1"].clone(),
    )
    .unwrap();
    (actors, air)
}
fn launch(
    air: &mut Aviation,
    actors: &[Vessel],
    owner: usize,
    role: &str,
    order: AirOrder,
) -> String {
    let a = &actors[owner];
    let squadron = &a
        .definition()
        .air_wing
        .as_ref()
        .unwrap()
        .squadrons
        .iter()
        .find(|s| s.role == role)
        .unwrap()
        .id;
    assert!(air.launch_squadron(a, squadron, None, Some(order), actors, None, None) > 0);
    air.wing(&a.motion.id)
        .unwrap()
        .flights
        .last()
        .unwrap()
        .id
        .clone()
}
fn airborne(air: &mut Aviation, owner: &str, flight: &str, point: [f64; 3]) {
    for p in air
        .wing_mut(owner)
        .unwrap()
        .planes
        .iter_mut()
        .filter(|p| p.flight_id.as_deref() == Some(flight))
    {
        p.phase = "outbound".into();
        p.position = point;
        p.previous_position = point;
        p.velocity = [85.0, 0.0, 0.0];
        p.heading = std::f64::consts::FRAC_PI_2;
        p.deck_slot = None;
        p.deck_position = None;
        p.deck_datum = None;
        p.flight_time = 30.0;
        p.controls.gear = 0.0;
    }
}
fn tick(air: &mut Aviation, actors: &[Vessel], time: f64, dt: f64) -> usize {
    let mut events = vec![];
    air.step(
        &mut AirContext {
            knowledge: None,
            actors,
            shells: &mut vec![],
            torpedoes: &mut vec![],
            releases: &mut vec![],
            sequence: &mut 0,
            events: &mut events,
            seed: 17,
            sea: None,
        },
        dt,
        time,
    );
    events
        .iter()
        .filter(|e| e.kind == "aircraft-launch")
        .count()
}
fn low_ammo(air: &mut Aviation, owner: &str, id: &str) {
    for p in air
        .wing_mut(owner)
        .unwrap()
        .planes
        .iter_mut()
        .filter(|p| p.flight_id.as_deref() == Some(id))
    {
        p.ammo = 4.0;
    }
}
#[test]
fn parked_default_defend_orders_never_start_patrols() {
    let (actors, mut air) = setup();
    for time in 0..100 {
        air.step_air_operations(&actors, None, time as f64);
    }
    assert!(air.operations.stations.is_empty());
    assert!(air.iter_planes().all(|p| p.phase == "ready"));
}
#[test]
fn relief_uses_existing_inventory_and_launches_before_the_original_returns() {
    let (actors, mut air) = setup();
    let id = launch(
        &mut air,
        &actors,
        0,
        "fighter",
        AirOrder::Defend { target_id: None },
    );
    airborne(&mut air, "carrier", &id, [0.0, 850.0, -700.0]);
    low_ammo(&mut air, "carrier", &id);
    let before: Vec<_> = air.iter_planes().map(|p| (p.id.clone(), p.ammo)).collect();
    air.step_air_operations(&actors, None, 1.0);
    assert_eq!(air.operations.stations.len(), 1);
    let relief = air.operations.stations[0].relief.clone().unwrap();
    assert_ne!(relief, id);
    assert!(
        air.wing("carrier")
            .unwrap()
            .planes
            .iter()
            .filter(|p| p.flight_id.as_deref() == Some(&id))
            .all(|p| p.phase == "outbound")
    );
    assert_eq!(
        before,
        air.iter_planes()
            .map(|p| (p.id.clone(), p.ammo))
            .collect::<Vec<_>>()
    );
    let mut launches = 0;
    for tick_id in 1..1200 {
        launches += tick(&mut air, &actors, tick_id as f64 / 10.0, 0.1);
        if launches > 0 {
            break;
        }
    }
    assert!(
        launches > 0,
        "replacement must use normal launch/deck progression"
    );
    assert_eq!(air.operations.stations[0].groups.len(), 2);
    // Four untouched fighters remain reserved, while the original still covers.
    assert_eq!(
        air.wing("carrier")
            .unwrap()
            .planes
            .iter()
            .filter(|p| p.role == "fighter" && p.flight_id.is_none())
            .count(),
        4
    );
    assert!(
        air.wing("carrier")
            .unwrap()
            .planes
            .iter()
            .any(|p| p.flight_id.as_deref() == Some(&id) && p.phase == "outbound")
    );
    airborne(&mut air, "carrier", &relief, [0.0, 850.0, -900.0]);
    air.step_air_operations(&actors, None, 200.0);
    assert_eq!(air.operations.stations[0].current, relief);
    assert!(
        air.wing("carrier")
            .unwrap()
            .planes
            .iter()
            .filter(|p| p.flight_id.as_deref() == Some(&id))
            .all(|p| p.phase == "returning")
    );
}
#[test]
fn recall_of_either_rotation_member_cancels_pending_relief_and_relaunch() {
    let (actors, mut air) = setup();
    let id = launch(
        &mut air,
        &actors,
        0,
        "fighter",
        AirOrder::Defend { target_id: None },
    );
    airborne(&mut air, "carrier", &id, [0.0, 850.0, 0.0]);
    low_ammo(&mut air, "carrier", &id);
    air.step_air_operations(&actors, None, 1.0);
    let relief = air.operations.stations[0].relief.clone().unwrap();
    air.recall("carrier", Some(&relief));
    assert!(air.operations.stations.is_empty());
    for t in 2..120 {
        air.step_air_operations(&actors, None, t as f64);
    }
    assert!(
        air.wing("carrier")
            .unwrap()
            .planes
            .iter()
            .all(|p| p.phase != "queued")
    );
    assert!(
        air.wing("carrier")
            .unwrap()
            .planes
            .iter()
            .filter(|p| p.flight_id.as_deref() == Some(&id))
            .all(|p| p.phase == "returning")
    );
}
#[test]
fn active_limit_and_carrier_loss_do_not_admit_relief() {
    let (mut actors, mut air) = setup();
    air.carrier_rules.get_mut("carrier").unwrap().active_flights = Some(1);
    let id = launch(
        &mut air,
        &actors,
        0,
        "fighter",
        AirOrder::Defend { target_id: None },
    );
    airborne(&mut air, "carrier", &id, [0.0, 850.0, 0.0]);
    low_ammo(&mut air, "carrier", &id);
    air.step_air_operations(&actors, None, 1.0);
    assert!(air.operations.stations[0].relief.is_none());
    assert_eq!(
        air.wing("carrier")
            .unwrap()
            .planes
            .iter()
            .filter(|p| p.phase == "queued")
            .count(),
        0
    );
    // Closing service via a submerged deck blocks the compatibility admission.
    air.carrier_rules.get_mut("carrier").unwrap().active_flights = None;
    actors[0].motion.y = -4.0;
    air.step_air_operations(&actors, None, 10.0);
    assert!(air.operations.stations[0].relief.is_none());
}
#[test]
fn preemptive_endurance_relief_is_scoped_to_carrier_and_anchor() {
    let (actors, mut air) = setup();
    air.rules.endurance = EndurancePolicy::Timed {
        order_limit_seconds: 500.0,
        recall_seconds: 600.0,
        fighter_recall_seconds: 600.0,
        exhaustion_seconds: 900.0,
    };
    let id = launch(
        &mut air,
        &actors,
        0,
        "fighter",
        AirOrder::Defend {
            target_id: Some("other".into()),
        },
    );
    airborne(&mut air, "carrier", &id, [4000.0, 850.0, 0.0]);
    for p in air
        .wing_mut("carrier")
        .unwrap()
        .planes
        .iter_mut()
        .filter(|p| p.flight_id.as_deref() == Some(&id))
    {
        p.flight_time = 480.0;
    }
    air.step_air_operations(&actors, None, 1.0);
    let relief = air.operations.stations[0].relief.clone().unwrap();
    assert_eq!(
        air.wing("carrier")
            .unwrap()
            .flights
            .iter()
            .find(|f| f.id == relief)
            .unwrap()
            .order,
        AirOrder::Defend {
            target_id: Some("other".into())
        }
    );
    assert!(
        air.wing("other")
            .unwrap()
            .planes
            .iter()
            .all(|p| p.phase == "ready")
    );
}
#[test]
fn offensive_allocation_is_preserved_instead_of_draining_the_last_reserve() {
    let (actors, mut air) = setup();
    let bomber = launch(
        &mut air,
        &actors,
        0,
        "dive-bomber",
        AirOrder::Attack {
            target_id: "target".into(),
        },
    );
    let escort = launch(
        &mut air,
        &actors,
        0,
        "fighter",
        AirOrder::Escort { flight_id: bomber },
    );
    airborne(&mut air, "carrier", &escort, [0.0, 850.0, 0.0]);
    let cap = launch(
        &mut air,
        &actors,
        0,
        "fighter",
        AirOrder::Defend { target_id: None },
    );
    airborne(&mut air, "carrier", &cap, [0.0, 850.0, 0.0]);
    low_ammo(&mut air, "carrier", &cap);
    air.step_air_operations(&actors, None, 1.0);
    assert!(air.operations.stations[0].relief.is_none());
    assert!(matches!(
        air.wing("carrier")
            .unwrap()
            .flights
            .iter()
            .find(|f| f.id == escort)
            .unwrap()
            .order,
        AirOrder::Escort { .. }
    ));
}
fn strike() -> AirOrder {
    AirOrder::Strike {
        contact_id: "observed-contact-7".into(),
    }
}
fn sample(air: &Aviation, id: &str) -> Aircraft {
    air.iter_planes()
        .find(|p| p.flight_id.as_deref() == Some(id))
        .unwrap()
        .clone()
}
#[test]
fn packages_are_small_owned_contact_groups_and_lone_flights_do_not_wait() {
    let (actors, mut air) = setup();
    let first = launch(&mut air, &actors, 0, "dive-bomber", strike());
    airborne(&mut air, "carrier", &first, [4000.0, 850.0, 0.0]);
    let mut p = sample(&air, &first);
    assert!(!air.package_guidance(&mut p, [9000.0, 0.0, 0.0], 0.0, 0.1));
    assert!(p.pilot.attack_heading.is_none());
    launch(&mut air, &actors, 1, "dive-bomber", strike());
    assert_eq!(
        air.operations.packages.len(),
        2,
        "carrier ownership scopes membership"
    );
    launch(&mut air, &actors, 0, "torpedo-bomber", strike());
    launch(&mut air, &actors, 0, "dive-bomber", strike());
    launch(&mut air, &actors, 0, "torpedo-bomber", strike());
    assert_eq!(air.operations.packages[0].members.len(), 3);
    assert_eq!(air.operations.packages.len(), 3);
}
#[test]
fn missing_rendezvous_member_cannot_hold_a_strike_indefinitely() {
    let (actors, mut air) = setup();
    let dive = launch(&mut air, &actors, 0, "dive-bomber", strike());
    launch(&mut air, &actors, 0, "torpedo-bomber", strike());
    airborne(&mut air, "carrier", &dive, [4000.0, 850.0, 0.0]);
    let mut p = sample(&air, &dive);
    assert!(air.package_guidance(&mut p, [9000.0, 0.0, 0.0], 0.0, 0.1));
    air.step_air_operations(&actors, None, 27.0);
    assert!(!air.package_guidance(&mut p, [9000.0, 0.0, 0.0], 0.0, 0.1));
    air.step_air_operations(&actors, None, 34.0);
    assert!(!air.package_guidance(&mut p, [9000.0, 0.0, 0.0], 0.0, 0.1));
}
#[test]
fn compatible_roles_use_complementary_headings_and_preserve_escort_identity() {
    let (actors, mut air) = setup();
    let dive = launch(&mut air, &actors, 0, "dive-bomber", strike());
    let torp = launch(&mut air, &actors, 0, "torpedo-bomber", strike());
    let escort = launch(
        &mut air,
        &actors,
        0,
        "fighter",
        AirOrder::Escort {
            flight_id: dive.clone(),
        },
    );
    let mut d = sample(&air, &dive);
    let mut t = sample(&air, &torp);
    d.position = [4000.0, 850.0, 0.0];
    t.position = [4000.0, 90.0, 0.0];
    air.package_guidance(&mut d, [9000.0, 0.0, 0.0], 0.0, 0.1);
    air.package_guidance(&mut t, [9000.0, 0.0, 0.0], 0.0, 0.1);
    assert!((d.pilot.attack_heading.unwrap() - t.pilot.attack_heading.unwrap()).abs() > 0.5);
    assert_eq!(
        air.wing("carrier")
            .unwrap()
            .flights
            .iter()
            .find(|f| f.id == escort)
            .unwrap()
            .order,
        AirOrder::Escort { flight_id: dive }
    );
}
#[test]
fn release_window_ends_remaining_passes_and_withdrawal_is_bounded() {
    let (actors, mut air) = setup();
    let dive = launch(&mut air, &actors, 0, "dive-bomber", strike());
    let torp = launch(&mut air, &actors, 0, "torpedo-bomber", strike());
    airborne(&mut air, "carrier", &dive, [8500.0, 300.0, 0.0]);
    airborne(&mut air, "carrier", &torp, [7500.0, 90.0, 0.0]);
    let mut d = sample(&air, &dive);
    air.package_guidance(&mut d, [9000.0, 0.0, 0.0], 0.0, 0.1);
    let id = d.id.clone();
    air.plane_mut(&id).unwrap().payload = false;
    air.step_air_operations(&actors, None, 1.0);
    let mut t = sample(&air, &torp);
    air.step_air_operations(&actors, None, 27.0);
    assert!(air.package_guidance(&mut t, [9000.0, 0.0, 0.0], 0.0, 0.1));
    assert_eq!(t.phase, "returning");
    assert!(air.package_withdrawal(&mut t, 0.1));
    air.step_air_operations(&actors, None, 48.0);
    assert!(!air.package_withdrawal(&mut t, 0.1));
    d.hp = 20.0;
    assert!(!air.package_withdrawal(&mut d, 0.1));
}
#[test]
fn lost_leader_and_unknown_target_do_not_create_positions_or_waits() {
    let (actors, mut air) = setup();
    let dive = launch(&mut air, &actors, 0, "dive-bomber", strike());
    let torp = launch(&mut air, &actors, 0, "torpedo-bomber", strike());
    airborne(&mut air, "carrier", &dive, [4000.0, 850.0, 0.0]);
    airborne(&mut air, "carrier", &torp, [4000.0, 90.0, 0.0]);
    let mut d = sample(&air, &dive);
    assert!(
        !air.package_withdrawal(&mut d, 0.1),
        "no permitted target fix exists"
    );
    for p in air
        .wing_mut("carrier")
        .unwrap()
        .planes
        .iter_mut()
        .filter(|p| p.flight_id.as_deref() == Some(&torp))
    {
        p.phase = "lost".into();
        p.hp = 0.0;
    }
    air.step_air_operations(&actors, None, 1.0);
    assert!(!air.package_guidance(&mut d, [9000.0, 0.0, 0.0], 0.0, 0.1));
    air.recall("carrier", Some(&dive));
    assert!(air.operations.packages.is_empty());
}
#[test]
#[ignore = "isolated native operation-scheduler benchmark"]
fn benchmark_operations_scheduler() {
    let (actors, mut air) = setup();
    air.rules.active_flights = ActiveFlights::Unlimited;
    let cap = launch(
        &mut air,
        &actors,
        0,
        "fighter",
        AirOrder::Defend { target_id: None },
    );
    airborne(&mut air, "carrier", &cap, [0.0, 850.0, 0.0]);
    for owner in 0..2 {
        for role in ["dive-bomber", "torpedo-bomber"] {
            launch(&mut air, &actors, owner, role, strike());
        }
    }
    let started = std::time::Instant::now();
    for frame in 0..108000 {
        air.step_air_operations(&actors, None, frame as f64 / 60.0);
    }
    eprintln!(
        "operation scheduler: 108000 frames, 2 carriers, {} ms",
        started.elapsed().as_secs_f64() * 1000.0
    );
    assert_eq!(air.iter_planes().count(), 96);
}

#[test]
fn a_serviced_original_group_rotates_back_without_a_relief_chain() {
    let (actors, mut air) = setup();
    let original = launch(
        &mut air,
        &actors,
        0,
        "fighter",
        AirOrder::Patrol {
            point: [1000.0, 850.0, 0.0],
        },
    );
    airborne(&mut air, "carrier", &original, [1000.0, 850.0, 0.0]);
    low_ammo(&mut air, "carrier", &original);
    air.step_air_operations(&actors, None, 1.0);
    let relief = air.operations.stations[0].relief.clone().unwrap();
    airborne(&mut air, "carrier", &relief, [1000.0, 850.0, 0.0]);
    air.step_air_operations(&actors, None, 6.0);
    // Isolate the next admission from the recovery controller; no stores are
    // awarded by the scheduler. First leave the original in service, then ready.
    for p in air
        .wing_mut("carrier")
        .unwrap()
        .planes
        .iter_mut()
        .filter(|p| p.flight_id.as_deref() == Some(&original))
    {
        p.phase = "rearming".into();
    }
    low_ammo(&mut air, "carrier", &relief);
    air.step_air_operations(&actors, None, 11.0);
    assert!(air.operations.stations[0].relief.is_none());
    assert_eq!(air.operations.stations[0].groups.len(), 2);
    for p in air
        .wing_mut("carrier")
        .unwrap()
        .planes
        .iter_mut()
        .filter(|p| p.flight_id.as_deref() == Some(&original))
    {
        p.phase = "ready".into();
        p.ammo = 16.0;
        p.hp = 60.0;
    }
    air.step_air_operations(&actors, None, 16.0);
    assert_eq!(
        air.operations.stations[0].relief.as_deref(),
        Some(original.as_str())
    );
    assert_eq!(air.operations.stations.len(), 1);
    assert_eq!(air.operations.stations[0].groups.len(), 2);
}
#[test]
fn managed_relief_requests_physical_handling_without_raising_or_refilling_aircraft() {
    use naval_sim::air_rules::{DeckCycle, DeckTimings};
    let actors = actors();
    let mut rules = catalog().air_profiles["pve-air-v1"].clone();
    rules.group_size = Some(4);
    rules.deck_capacity = Some(24);
    rules.deck_cycle = DeckCycle::Managed {
        startup_groups_per_role: 1,
        timings: DeckTimings {
            lift_seconds: 6.0,
            taxi_speed: 12.0,
            turn_radians_per_second: 0.7,
            rearm_seconds: 35.0,
            repair_seconds: 90.0,
        },
    };
    let mut air = Aviation::with_rules(&actors, catalog().aircraft.clone(), rules).unwrap();
    let cap = launch(
        &mut air,
        &actors,
        0,
        "fighter",
        AirOrder::Defend { target_id: None },
    );
    airborne(&mut air, "carrier", &cap, [0.0, 850.0, 0.0]);
    low_ammo(&mut air, "carrier", &cap);
    let before: Vec<_> = air
        .iter_planes()
        .map(|p| (p.id.clone(), p.phase.clone(), p.ammo, p.hp))
        .collect();
    air.step_air_operations(&actors, None, 1.0);
    assert!(air.operations.stations[0].relief.is_none());
    assert_eq!(air.operations.stations[0].groups.len(), 2);
    let relief = air.operations.stations[0]
        .groups
        .iter()
        .find(|id| **id != cap)
        .unwrap()
        .clone();
    let requests = &air.wing("carrier").unwrap().deck.as_ref().unwrap().queue;
    assert!(requests.iter().any(
        |r| r.flight_id == relief && r.action == naval_sim::deck_operations::DeckAction::Raise
    ));
    assert_eq!(
        before,
        air.iter_planes()
            .map(|p| (p.id.clone(), p.phase.clone(), p.ammo, p.hp))
            .collect::<Vec<_>>()
    );
    let request_ids: Vec<_> = requests.iter().map(|r| r.id).collect();
    for n in 2..20 {
        air.step_air_operations(&actors, None, n as f64);
    }
    assert_eq!(
        request_ids,
        air.wing("carrier")
            .unwrap()
            .deck
            .as_ref()
            .unwrap()
            .queue
            .iter()
            .map(|r| r.id)
            .collect::<Vec<_>>(),
        "do not replace queued handling every scheduler tick"
    );
}

#[test]
fn a_patrol_resumes_after_a_deck_limit_forced_a_coverage_gap() {
    let (actors, mut air) = setup();
    air.carrier_rules.get_mut("carrier").unwrap().active_flights = Some(1);
    let original = launch(
        &mut air,
        &actors,
        0,
        "fighter",
        AirOrder::Defend { target_id: None },
    );
    airborne(&mut air, "carrier", &original, [0.0, 850.0, 0.0]);
    low_ammo(&mut air, "carrier", &original);
    air.step_air_operations(&actors, None, 1.0);
    assert!(air.operations.stations[0].relief.is_none());
    for p in air
        .wing_mut("carrier")
        .unwrap()
        .planes
        .iter_mut()
        .filter(|p| p.flight_id.as_deref() == Some(&original))
    {
        p.phase = "ready".into();
        p.ammo = 16.0;
        p.flight_time = 0.0;
    }
    air.step_air_operations(&actors, None, 6.0);
    assert!(
        air.wing("carrier")
            .unwrap()
            .planes
            .iter()
            .filter(|p| p.flight_id.as_deref() == Some(&original))
            .all(|p| p.phase == "queued")
    );
    airborne(&mut air, "carrier", &original, [0.0, 850.0, 0.0]);
    air.step_air_operations(&actors, None, 11.0);
    assert!(
        air.wing("carrier")
            .unwrap()
            .planes
            .iter()
            .filter(|p| p.flight_id.as_deref() == Some(&original))
            .all(|p| p.phase == "outbound")
    );
}

#[test]
#[ignore = "isolated native attack-package flight/timing benchmark"]
fn benchmark_attack_package_flights() {
    for paired in [false, true] {
        let (actors, mut air) = setup();
        let order = AirOrder::Attack {
            target_id: "target".into(),
        };
        let dive = launch(&mut air, &actors, 0, "dive-bomber", order.clone());
        airborne(&mut air, "carrier", &dive, [8500.0, 850.0, 0.0]);
        if paired {
            let torp = launch(&mut air, &actors, 0, "torpedo-bomber", order);
            airborne(&mut air, "carrier", &torp, [8400.0, 200.0, -400.0]);
        }
        let mut sequence = 0;
        let mut releases_by_role = std::collections::BTreeMap::<String, Vec<f64>>::new();
        for frame in 0..4800 {
            let time = frame as f64 * 0.05;
            let mut events = vec![];
            air.step(
                &mut AirContext {
                    knowledge: None,
                    actors: &actors,
                    shells: &mut vec![],
                    torpedoes: &mut vec![],
                    releases: &mut vec![],
                    sequence: &mut sequence,
                    events: &mut events,
                    seed: 5739,
                    sea: None,
                },
                0.05,
                time,
            );
            for event in events
                .iter()
                .filter(|e| matches!(e.kind.as_str(), "bomb-release" | "aircraft-release"))
            {
                let id = &event.aircraft.as_ref().unwrap().id;
                let role = air
                    .iter_planes()
                    .find(|p| &p.id == id)
                    .unwrap()
                    .role
                    .clone();
                releases_by_role.entry(role).or_default().push(time);
            }
        }
        eprintln!("paired={paired} releases={releases_by_role:?}");
        assert_eq!(releases_by_role.get("dive-bomber").map(Vec::len), Some(6));
        if paired {
            assert_eq!(
                releases_by_role.get("torpedo-bomber").map(Vec::len),
                Some(6)
            );
            let times: Vec<_> = releases_by_role.values().flatten().copied().collect();
            let first = times.iter().copied().fold(f64::INFINITY, f64::min);
            let last = times.iter().copied().fold(0.0, f64::max);
            assert!(last - first <= 25.0);
        }
    }
}

fn managed_setup(groups: usize) -> (Vec<Vessel>, Aviation) {
    use naval_sim::air_rules::{DeckCycle, DeckTimings};
    let actors = actors();
    let mut rules = catalog().air_profiles["pve-air-v1"].clone();
    rules.group_size = Some(4);
    rules.deck_capacity = Some(24);
    rules.deck_cycle = DeckCycle::Managed {
        startup_groups_per_role: groups,
        timings: DeckTimings {
            lift_seconds: 6.0,
            taxi_speed: 12.0,
            turn_radians_per_second: 0.7,
            rearm_seconds: 35.0,
            repair_seconds: 90.0,
        },
    };
    let air = Aviation::with_rules(&actors, catalog().aircraft.clone(), rules).unwrap();
    (actors, air)
}
#[test]
fn cancelling_a_managed_relief_launch_clears_queued_planes_and_persistent_station() {
    let (actors, mut air) = managed_setup(2);
    let original = launch(
        &mut air,
        &actors,
        0,
        "fighter",
        AirOrder::Defend { target_id: None },
    );
    airborne(&mut air, "carrier", &original, [0.0, 850.0, 0.0]);
    low_ammo(&mut air, "carrier", &original);
    air.step_air_operations(&actors, None, 1.0);
    let relief = air.operations.stations[0].relief.clone().unwrap();
    let request = air
        .wing("carrier")
        .unwrap()
        .deck
        .as_ref()
        .unwrap()
        .queue
        .iter()
        .find(|r| {
            r.flight_id == relief && r.action == naval_sim::deck_operations::DeckAction::Launch
        })
        .unwrap()
        .id;
    assert!(!air.cancel_deck_command("other", request));
    assert_eq!(air.operations.stations.len(), 1);
    assert!(air.cancel_deck_command("carrier", request));
    assert!(air.operations.stations.is_empty());
    assert!(
        air.wing("carrier")
            .unwrap()
            .planes
            .iter()
            .filter(|p| p.flight_id.as_deref() == Some(&relief))
            .all(|p| p.phase == "ready")
    );
    assert!(
        air.wing("carrier")
            .unwrap()
            .planes
            .iter()
            .filter(|p| p.flight_id.as_deref() == Some(&original))
            .all(|p| p.phase == "returning")
    );
    for time in 2..90 {
        air.step_air_operations(&actors, None, time as f64);
    }
    assert!(air.operations.stations.is_empty());
    assert!(
        air.wing("carrier")
            .unwrap()
            .deck
            .as_ref()
            .unwrap()
            .queue
            .iter()
            .all(|r| r.action != naval_sim::deck_operations::DeckAction::Launch)
    );
}
#[test]
fn cancelling_managed_strike_launch_and_patrol_preparation_retires_operation_intent() {
    let (actors, mut air) = managed_setup(1);
    let flight = launch(&mut air, &actors, 0, "dive-bomber", strike());
    let request = air
        .wing("carrier")
        .unwrap()
        .deck
        .as_ref()
        .unwrap()
        .queue
        .iter()
        .find(|r| r.flight_id == flight)
        .unwrap()
        .id;
    assert_eq!(air.operations.packages.len(), 1);
    assert!(air.cancel_deck_command("carrier", request));
    assert!(air.operations.packages.is_empty());
    assert!(
        air.wing("carrier")
            .unwrap()
            .planes
            .iter()
            .filter(|p| p.flight_id.as_deref() == Some(&flight))
            .all(|p| p.phase == "ready")
    );
    let cap = launch(
        &mut air,
        &actors,
        0,
        "fighter",
        AirOrder::Defend { target_id: None },
    );
    airborne(&mut air, "carrier", &cap, [0.0, 850.0, 0.0]);
    low_ammo(&mut air, "carrier", &cap);
    air.step_air_operations(&actors, None, 1.0);
    let request = air
        .wing("carrier")
        .unwrap()
        .deck
        .as_ref()
        .unwrap()
        .queue
        .iter()
        .find(|r| r.action == naval_sim::deck_operations::DeckAction::Raise)
        .unwrap()
        .id;
    assert!(air.cancel_deck_command("carrier", request));
    for time in 2..90 {
        air.step_air_operations(&actors, None, time as f64);
    }
    assert!(air.operations.stations.is_empty());
    assert!(
        air.wing("carrier")
            .unwrap()
            .deck
            .as_ref()
            .unwrap()
            .queue
            .iter()
            .all(|r| r.action != naval_sim::deck_operations::DeckAction::Raise)
    );
}

#[test]
fn returning_package_aircraft_evade_observed_fighters_before_following_the_exit_leg() {
    use naval_sim::sensors::{self, Knowledge, Sensors, VisualConditions, VisualRules};
    let mut actors = actors();
    actors[1].team = TeamId::B;
    let mut air = Aviation::with_rules(
        &actors,
        catalog().aircraft.clone(),
        catalog().air_profiles["pve-air-v1"].clone(),
    )
    .unwrap();
    let dive = launch(
        &mut air,
        &actors,
        0,
        "dive-bomber",
        AirOrder::Attack {
            target_id: "target".into(),
        },
    );
    let fighter = launch(
        &mut air,
        &actors,
        1,
        "fighter",
        AirOrder::Defend { target_id: None },
    );
    airborne(&mut air, "carrier", &dive, [13000.0, 850.0, 0.0]);
    airborne(&mut air, "other", &fighter, [12300.0, 850.0, 0.0]);
    // Supply the package's permitted target fix, as strike_solution normally
    // does before release. Returning aircraft remain in the same package.
    let mut bomber = sample(&air, &dive);
    air.package_guidance(&mut bomber, [14000.0, 0.0, 0.0], 0.0, 0.1);
    for p in air
        .wing_mut("carrier")
        .unwrap()
        .planes
        .iter_mut()
        .filter(|p| p.flight_id.as_deref() == Some(&dive))
    {
        p.phase = "returning".into();
        p.payload = false;
    }
    let mut hidden = air.clone();
    let mut reports = Sensors::default();
    let conditions = VisualConditions::resolve(catalog(), "north-atlantic", "clear");
    for tick in (0..=360).step_by(60) {
        reports.update(
            tick,
            &sensors::entities(&actors, &air),
            &[],
            &[],
            conditions,
            &VisualRules::default(),
        );
    }
    let empty = Sensors::default();
    for (simulation, sensors) in [(&mut air, &reports), (&mut hidden, &empty)] {
        simulation.step(
            &mut AirContext {
                knowledge: Some(Knowledge {
                    sensors,
                    tick: 360,
                    islands: &[],
                    terrain: &[],
                }),
                actors: &actors,
                shells: &mut vec![],
                torpedoes: &mut vec![],
                releases: &mut vec![],
                sequence: &mut 0,
                events: &mut vec![],
                seed: 17,
                sea: None,
            },
            0.1,
            6.0,
        );
    }
    let visible_bomber = sample(&air, &dive);
    let hidden_bomber = sample(&hidden, &dive);
    assert!(
        visible_bomber.pilot.defense.as_ref().is_some_and(
            |d| d.maneuver_seconds > 0.0 && d.notice.as_deref() == Some("Evading fighter")
        ),
        "package exit must not suppress a locally observed threat"
    );
    assert!(
        hidden_bomber.pilot.defense.is_none(),
        "unreported fighters must not cause evasion"
    );
    assert_ne!(
        visible_bomber.navigation_target, hidden_bomber.navigation_target,
        "observed fighter evasion must override the ordinary package exit waypoint"
    );
    assert_eq!(visible_bomber.phase, "returning");
}
