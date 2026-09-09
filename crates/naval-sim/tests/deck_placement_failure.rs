//! Fault-inject missing contact patches after content admission to exercise
//! managed handling's failure/retry paths independently of route clearance.
use naval_sim::{
    air_rules::{ActiveFlights, AirRules, DeckCycle, DeckTimings, EndurancePolicy},
    aviation::Aviation,
    aviation_step::AirContext,
    catalog::Catalog,
    deck_operations::{DeckAction, place},
    flight_deck::DeckPose,
    geometry::{length, local_to_world, sub},
    impact::DamageEvent,
    rules::TeamId,
    vessel::{CompiledShip, Controller, Vessel},
};
use std::sync::{Arc, OnceLock};

fn catalog() -> &'static Catalog {
    static CONTENT: OnceLock<Catalog> = OnceLock::new();
    CONTENT.get_or_init(|| {
        Catalog::load(&std::fs::read("../../.build/naval-content/manifest.json").unwrap()).unwrap()
    })
}
fn setup() -> (Vec<Vessel>, Aviation) {
    let mut actor = Vessel::new(
        "carrier",
        TeamId::A,
        Arc::new(CompiledShip::new(catalog().definitions["enterprise-cv6"].clone()).unwrap()),
    );
    actor.controller = Controller::Player;
    let actors = vec![actor];
    let mut rules = AirRules::legacy();
    rules.group_size = Some(4);
    rules.deck_capacity = Some(24);
    rules.active_flights = ActiveFlights::Unlimited;
    rules.endurance = EndurancePolicy::Disabled;
    rules.deck_cycle = DeckCycle::Managed {
        startup_groups_per_role: 0,
        timings: DeckTimings {
            lift_seconds: 6.0,
            taxi_speed: 12.0,
            turn_radians_per_second: 0.7,
            rearm_seconds: 35.0,
            repair_seconds: 90.0,
        },
    };
    let aviation = Aviation::with_rules(&actors, catalog().aircraft.clone(), rules).unwrap();
    (actors, aviation)
}
fn tick(a: &mut Aviation, actors: &[Vessel], events: &mut Vec<DamageEvent>, time: &mut f64) {
    a.step(
        &mut AirContext {
            knowledge: None,
            actors,
            shells: &mut vec![],
            torpedoes: &mut vec![],
            releases: &mut vec![],
            sequence: &mut 0,
            events,
            seed: 7,
            sea: None,
        },
        0.25,
        *time,
    );
    *time += 0.25;
}

#[test]
fn failed_takeoff_follows_the_moving_carrier_and_emits_launch_only_once_after_retry() {
    let (mut actors, mut a) = setup();
    let ground = a.ground[&a.wings[0].state.planes[0].model_id].clone();
    let start = actors[0]
        .definition()
        .air_wing
        .as_ref()
        .unwrap()
        .deck_layout
        .as_ref()
        .unwrap()
        .launch_start;
    let p = &mut a.wings[0].state.planes[0];
    assert!(place(
        p,
        &actors[0],
        DeckPose {
            position: start,
            heading: 0.0
        },
        &ground
    ));
    p.phase = "takeoff".into();
    p.wing_fold = 0.0;
    p.timer = 0.0;
    let initial_root = p.deck_position.unwrap();
    let patches = ground.deck_geometry.as_ref().unwrap().tyres.clone();
    let mut events = vec![];
    let mut time = 0.0;
    for expected_launches in [0, 1] {
        a.ground
            .get_mut(&ground.id)
            .unwrap()
            .deck_geometry
            .as_mut()
            .unwrap()
            .tyres = Arc::new(vec![]);
        let timer = a.wings[0].state.planes[0].timer;
        let datum = a.wings[0].state.planes[0].deck_datum;
        let root = a.wings[0].state.planes[0].deck_position.unwrap();
        for _ in 0..4 {
            actors[0].motion.x += 2.0;
            actors[0].motion.z -= 1.0;
            actors[0].motion.y += 0.02;
            actors[0].motion.heading += 0.01;
            actors[0].motion.pitch += 0.001;
            actors[0].motion.roll -= 0.001;
            actors[0].motion.speed = 9.0;
            tick(&mut a, &actors, &mut events, &mut time);
            let p = &a.wings[0].state.planes[0];
            assert_eq!(p.phase, "takeoff");
            assert_eq!(
                p.timer, timer,
                "Unsupported progress advanced the launch clock"
            );
            assert_eq!(p.deck_datum, datum);
            assert_eq!(p.deck_position, Some(root));
            assert!(
                length(sub(
                    p.position,
                    local_to_world(root, actors[0].motion.pose())
                )) < 1e-9,
                "Stalled aircraft lost its moving carrier attachment"
            );
            assert_eq!(
                events
                    .iter()
                    .filter(|e| e.kind == "aircraft-launch")
                    .count(),
                expected_launches
            );
        }
        a.ground
            .get_mut(&ground.id)
            .unwrap()
            .deck_geometry
            .as_mut()
            .unwrap()
            .tyres = patches.clone();
        tick(&mut a, &actors, &mut events, &mut time);
        assert!(a.wings[0].state.planes[0].timer > timer);
        assert_eq!(
            events
                .iter()
                .filter(|e| e.kind == "aircraft-launch")
                .count(),
            1
        );
    }
    assert_ne!(a.wings[0].state.planes[0].deck_position, Some(initial_root));
}

#[test]
fn failed_initial_raise_preserves_hangar_state_reservations_and_retries_the_same_job() {
    let (actors, mut a) = setup();
    let flight = a.wings[0].state.flights[0].clone();
    let plane_id = flight.plane_ids[0].clone();
    let model = a.wings[0]
        .state
        .planes
        .iter()
        .find(|p| p.id == plane_id)
        .unwrap()
        .model_id
        .clone();
    let patches = a.ground[&model]
        .deck_geometry
        .as_ref()
        .unwrap()
        .tyres
        .clone();
    a.ground
        .get_mut(&model)
        .unwrap()
        .deck_geometry
        .as_mut()
        .unwrap()
        .tyres = Arc::new(
        patches
            .iter()
            .map(|tyre| {
                tyre.iter()
                    .map(|tri| {
                        tri.map(|mut point| {
                            point[0] += 20.0;
                            point
                        })
                    })
                    .collect()
            })
            .collect(),
    );
    // Keep the route geometry admissible while its actual contact patches are
    // unsupported; this reaches placement after successful route planning.
    assert!(a.ground[&model].deck_geometry.as_ref().unwrap().valid());
    let request = a
        .deck_command("carrier", &flight.id, DeckAction::Raise)
        .unwrap();
    let mut events = vec![];
    let mut time = 0.0;
    for _ in 0..1000 {
        tick(&mut a, &actors, &mut events, &mut time);
        if a.wings[0].state.deck.as_ref().unwrap().notice.as_deref()
            == Some("Waiting for supported aircraft tyres")
        {
            break;
        }
    }
    for _ in 0..4 {
        let wing = &a.wings[0].state;
        let status = wing.deck.as_ref().unwrap();
        assert_eq!(
            status.notice.as_deref(),
            Some("Waiting for supported aircraft tyres")
        );
        assert_eq!(status.current_plane_id.as_deref(), Some(plane_id.as_str()));
        assert!(status.suspended);
        assert!(status.queue.iter().any(|r| r.id == request));
        assert_eq!(status.occupied, 0);
        let p = wing.planes.iter().find(|p| p.id == plane_id).unwrap();
        assert_eq!(p.phase, "hangar");
        assert_eq!(p.deck_slot, None);
        assert_eq!(p.deck_datum, None);
        assert_eq!(p.deck_position, None);
        tick(&mut a, &actors, &mut events, &mut time);
    }
    a.ground
        .get_mut(&model)
        .unwrap()
        .deck_geometry
        .as_mut()
        .unwrap()
        .tyres = patches;
    tick(&mut a, &actors, &mut events, &mut time);
    let wing = &a.wings[0].state;
    let p = wing.planes.iter().find(|p| p.id == plane_id).unwrap();
    assert_eq!(p.phase, "raising");
    assert!(p.deck_slot.is_some() && p.deck_datum.is_some() && p.deck_position.is_some());
    assert_eq!(
        wing.deck.as_ref().unwrap().current_plane_id.as_deref(),
        Some(plane_id.as_str())
    );
    assert!(wing.deck.as_ref().unwrap().notice.is_none());
}
