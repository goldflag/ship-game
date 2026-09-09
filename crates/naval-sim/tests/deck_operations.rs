use naval_sim::{
    air_rules::{ActiveFlights, AirRules, DeckCycle, DeckTimings, EndurancePolicy},
    aircraft::AirOrder,
    aviation::Aviation,
    aviation_step::AirContext,
    catalog::Catalog,
    deck_operations::{DeckAction, DeckPolicy},
    rules::TeamId,
    vessel::{CompiledShip, Controller, Vessel},
};
use std::{
    collections::BTreeSet,
    sync::{Arc, OnceLock},
};
fn catalog() -> &'static Catalog {
    static CONTENT: OnceLock<Catalog> = OnceLock::new();
    CONTENT.get_or_init(|| {
        Catalog::load(&std::fs::read("../../.build/naval-content/manifest.json").unwrap()).unwrap()
    })
}
fn setup(id: &str, groups: usize) -> (Vec<Vessel>, Aviation) {
    let mut actor = Vessel::new(
        "carrier",
        TeamId::A,
        Arc::new(CompiledShip::new(catalog().definitions[id].clone()).unwrap()),
    );
    actor.controller = Controller::Player;
    let actors = vec![actor];
    let mut rules = AirRules::legacy();
    rules.group_size = Some(4);
    rules.deck_capacity = Some(24);
    rules.active_flights = ActiveFlights::Unlimited;
    rules.endurance = EndurancePolicy::Disabled;
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
    let aviation = Aviation::with_rules(&actors, catalog().aircraft.clone(), rules).unwrap();
    (actors, aviation)
}
fn step(a: &mut Aviation, actors: &[Vessel], time: &mut f64, dt: f64) {
    a.step(
        &mut AirContext {
            knowledge: None,
            actors,
            shells: &mut vec![],
            torpedoes: &mut vec![],
            releases: &mut vec![],
            sequence: &mut 0,
            events: &mut vec![],
            seed: 7,
            sea: None,
        },
        dt,
        *time,
    );
    *time += dt;
    let planes = &a.wings[0].state.planes;
    assert_eq!(planes.len(), 48);
    assert_eq!(
        planes.iter().map(|p| &p.id).collect::<BTreeSet<_>>().len(),
        48
    );
    assert!(planes.iter().filter(|p| p.deck_slot.is_some()).count() <= 24);
    assert_eq!(
        planes
            .iter()
            .filter_map(|p| p.deck_slot)
            .collect::<BTreeSet<_>>()
            .len(),
        planes.iter().filter(|p| p.deck_slot.is_some()).count()
    );
}
fn until(
    a: &mut Aviation,
    actors: &[Vessel],
    time: &mut f64,
    condition: impl Fn(&Aviation) -> bool,
) {
    for _ in 0..5000 {
        if condition(a) {
            return;
        }
        step(a, actors, time, 0.25);
    }
    panic!(
        "Deck did not complete: {:?}; phases {:?}",
        a.wings[0].state.deck,
        a.wings[0]
            .state
            .planes
            .iter()
            .filter(|p| p.phase != "hangar")
            .map(|p| (&p.id, &p.phase))
            .collect::<Vec<_>>()
    );
}
#[test]
fn both_carriers_start_with_six_deck_groups_and_six_hangar_groups() {
    for id in ["enterprise-cv6", "shokaku"] {
        let (actors, a) = setup(id, 2);
        let wing = &a.wings[0].state;
        assert_eq!(wing.flights.len(), 12);
        assert!(wing.flights.iter().all(|f| f.plane_ids.len() == 4));
        assert_eq!(
            wing.planes.iter().filter(|p| p.phase == "ready").count(),
            24
        );
        assert_eq!(
            wing.planes.iter().filter(|p| p.phase == "hangar").count(),
            24
        );
        for role in ["fighter", "dive-bomber", "torpedo-bomber"] {
            assert_eq!(
                wing.planes
                    .iter()
                    .filter(|p| p.role == role && p.deck_slot.is_some())
                    .count(),
                8
            );
        }
        assert!(wing.planes.iter().all(|p| p.flight_id.is_some()));
        assert!(
            a.squadron_flights(&actors[0])
                .iter()
                .all(|f| wing.flights.iter().any(|original| original.id == f.id))
        );
    }
}
#[test]
fn timed_lifts_suspend_cancel_and_service_preserves_individual_health() {
    let (mut actors, mut a) = setup("enterprise-cv6", 0);
    let flight = a.wings[0].state.flights[0].clone();
    let ids = flight.plane_ids.clone();
    let mut time = 0.0;
    let request = a
        .deck_command("carrier", &flight.id, DeckAction::Raise)
        .unwrap();
    assert_eq!(a.wings[0].state.deck.as_ref().unwrap().queue[0].id, request);
    until(&mut a, &actors, &mut time, |a| {
        a.wings[0].state.planes.iter().any(|p| p.phase == "raising")
    });
    let index = a.wings[0]
        .state
        .planes
        .iter()
        .position(|p| p.phase == "raising")
        .unwrap();
    assert!(a.prioritize_deck(&actors[0], request).is_err());
    let initial_time = a.wings[0]
        .state
        .deck
        .as_ref()
        .unwrap()
        .step_remaining_seconds
        .unwrap();
    step(&mut a, &actors, &mut time, 0.25);
    let remaining = a.wings[0]
        .state
        .deck
        .as_ref()
        .unwrap()
        .step_remaining_seconds
        .unwrap();
    assert!(remaining > 0.0 && remaining < initial_time);
    let before = a.wings[0].state.planes[index].deck_position;
    let module = actors[0]
        .damage
        .modules
        .iter()
        .position(|m| m.id == "magazine-forward")
        .unwrap();
    let health = actors[0].damage.modules[module].hp;
    actors[0].damage.modules[module].hp = 0.0;
    for _ in 0..80 {
        step(&mut a, &actors, &mut time, 0.25);
    }
    assert_eq!(a.wings[0].state.planes[index].deck_position, before);
    assert_eq!(
        a.wings[0]
            .state
            .deck
            .as_ref()
            .unwrap()
            .step_remaining_seconds,
        Some(remaining)
    );
    assert!(a.wings[0].state.deck.as_ref().unwrap().suspended);
    assert!(a.cancel_deck_command("carrier", request));
    assert!(a.wings[0].state.deck.as_ref().unwrap().queue.is_empty());
    actors[0].damage.modules[module].hp = health;
    until(&mut a, &actors, &mut time, |a| {
        a.wings[0].state.planes[index].phase == "ready"
    });
    assert_eq!(
        a.wings[0]
            .state
            .planes
            .iter()
            .filter(|p| p.phase == "ready")
            .count(),
        1
    );
    // Cancellation finishes the aircraft already on the lift but leaves its
    // three group mates below; no aircraft is copied to make a complete group.
    assert_eq!(
        a.wings[0]
            .state
            .planes
            .iter()
            .filter(|p| ids.contains(&p.id) && p.phase == "hangar")
            .count(),
        3
    );
    a.wings[0].state.planes[index].hp = 33.0;
    a.wings[0].state.planes[index].ammo = 0.0;
    // Stow the partially raised group, then raise it as a complete group again.
    a.deck_command("carrier", &flight.id, DeckAction::Stow)
        .unwrap();
    until(&mut a, &actors, &mut time, |a| {
        a.wings[0]
            .state
            .planes
            .iter()
            .filter(|p| ids.contains(&p.id))
            .all(|p| p.phase == "hangar")
    });
    a.deck_command("carrier", &flight.id, DeckAction::Raise)
        .unwrap();
    until(&mut a, &actors, &mut time, |a| {
        a.wings[0]
            .state
            .planes
            .iter()
            .filter(|p| ids.contains(&p.id))
            .all(|p| p.phase == "ready")
    });
    a.deck_command("carrier", &flight.id, DeckAction::Rearm)
        .unwrap();
    step(&mut a, &actors, &mut time, 0.25);
    assert_eq!(a.wings[0].state.planes[index].ammo, 0.0);
    until(&mut a, &actors, &mut time, |a| {
        a.wings[0]
            .state
            .planes
            .iter()
            .filter(|p| ids.contains(&p.id))
            .all(|p| p.phase == "ready")
    });
    assert_eq!(a.wings[0].state.planes[index].hp, 33.0);
    assert!(a.wings[0].state.planes[index].ammo > 0.0);
    a.deck_command("carrier", &flight.id, DeckAction::Repair)
        .unwrap();
    until(&mut a, &actors, &mut time, |a| {
        a.wings[0]
            .state
            .planes
            .iter()
            .filter(|p| ids.contains(&p.id))
            .all(|p| p.phase == "hangar")
    });
    assert_eq!(a.wings[0].state.planes[index].hp, 60.0);
    assert_eq!(
        a.wings[0]
            .state
            .planes
            .iter()
            .filter(|p| ids.contains(&p.id) && p.hp == 100.0)
            .count(),
        3
    );
    assert_eq!(a.wings[0].state.flights[0].plane_ids, ids);
    // Damage discovered after automatic stow can be serviced in the hangar;
    // no pointless lift to the deck and back is necessary.
    a.wings[0].state.planes[index].hp = 22.0;
    a.deck_command("carrier", &flight.id, DeckAction::Repair)
        .unwrap();
    step(&mut a, &actors, &mut time, 0.25);
    assert_eq!(a.wings[0].state.planes[index].phase, "repairing");
    assert!(a.wings[0].state.planes[index].deck_slot.is_none());
    assert!(a.wings[0].state.planes[index].deck_position.is_none());
    until(&mut a, &actors, &mut time, |a| {
        a.wings[0].state.planes[index].phase == "hangar"
    });
    assert_eq!(a.wings[0].state.planes[index].hp, 60.0);
    assert_eq!(a.wings[0].state.flights[0].plane_ids, ids);
    // A destroyed airframe cannot be restored by a service timer completing.
    a.wings[0].state.planes[index].phase = "repairing".into();
    a.wings[0].state.planes[index].timer = 0.1;
    a.wings[0].state.planes[index].hp = 0.0;
    step(&mut a, &actors, &mut time, 0.25);
    assert_eq!(a.wings[0].state.planes[index].phase, "lost");
    assert_eq!(a.wings[0].state.planes[index].hp, 0.0);
}
#[test]
fn all_six_aircraft_models_complete_a_physical_launch_and_recovery_cycle() {
    for carrier in ["enterprise-cv6", "shokaku"] {
        for role in ["fighter", "dive-bomber", "torpedo-bomber"] {
            sortie(carrier, role);
        }
    }
}
fn sortie(carrier: &str, role: &str) {
    let (actors, mut a) = setup(carrier, 0);
    let flight = a.wings[0]
        .state
        .flights
        .iter()
        .find(|f| {
            a.wings[0]
                .state
                .planes
                .iter()
                .any(|p| f.plane_ids.contains(&p.id) && p.role == role)
        })
        .unwrap()
        .clone();
    let mut time = 0.0;
    a.deck_command("carrier", &flight.id, DeckAction::Raise)
        .unwrap();
    until(&mut a, &actors, &mut time, |a| {
        a.wings[0]
            .state
            .planes
            .iter()
            .filter(|p| flight.plane_ids.contains(&p.id))
            .all(|p| p.phase == "ready")
    });
    let launch = |a: &mut Aviation| {
        a.launch_squadron(
            &actors[0],
            &flight.squadron_id,
            None,
            Some(AirOrder::Patrol {
                point: [5000.0, 600.0, -5000.0],
            }),
            &actors,
            Some(&flight.id),
            None,
        )
    };
    assert_eq!(launch(&mut a), 4);
    a.recall("carrier", Some(&flight.id));
    for _ in 0..40 {
        step(&mut a, &actors, &mut time, 0.25);
    }
    assert!(
        a.wings[0]
            .state
            .planes
            .iter()
            .filter(|p| flight.plane_ids.contains(&p.id))
            .all(|p| p.phase == "ready" && p.deck_slot.is_some())
    );
    assert_eq!(launch(&mut a), 4);
    let started = time;
    for _ in 0..5000 {
        step(&mut a, &actors, &mut time, 0.25);
        assert!(
            a.wings[0]
                .state
                .planes
                .iter()
                .filter(|p| p.phase == "takeoff" && p.deck_position.is_some())
                .count()
                <= 1
        );
        if a.wings[0]
            .state
            .planes
            .iter()
            .filter(|p| flight.plane_ids.contains(&p.id))
            .all(|p| p.phase == "outbound")
        {
            assert!(time - started >= 4.0 * naval_sim::aircraft_flight::TAKEOFF_ROLL_SECONDS);
            a.recall("carrier", Some(&flight.id));
            for _ in 0..108000 {
                step(&mut a, &actors, &mut time, 1.0 / 60.0);
                if a.wings[0]
                    .state
                    .planes
                    .iter()
                    .filter(|p| flight.plane_ids.contains(&p.id))
                    .all(|p| p.phase == "ready")
                {
                    assert!(
                        a.wings[0]
                            .state
                            .planes
                            .iter()
                            .filter(|p| flight.plane_ids.contains(&p.id))
                            .all(|p| p.sortie == Some(1))
                    );
                    return;
                }
            }
            panic!(
                "{carrier} / {role}: actual flight recovery stalled: {:?}; {:?}",
                a.wings[0].state.deck,
                a.wings[0]
                    .state
                    .planes
                    .iter()
                    .filter(|p| flight.plane_ids.contains(&p.id))
                    .map(|p| (&p.phase, &p.pilot.recovery_stage, p.position))
                    .collect::<Vec<_>>()
            );
        }
    }
    panic!("Launch stalled: {:?}", a.wings[0].state.deck);
}

#[test]
fn balanced_recovery_clears_a_full_deck_without_waiting_for_airborne_group_mates() {
    use naval_sim::{deck_operations::place, flight_deck::DeckPose, geometry::local_to_world};
    for carrier in ["enterprise-cv6", "shokaku"] {
        let (actors, mut a) = setup(carrier, 2);
        let actor = &actors[0];
        let layout = actor
            .definition()
            .air_wing
            .as_ref()
            .unwrap()
            .deck_layout
            .as_ref()
            .unwrap();
        let index = a.wings[0]
            .state
            .planes
            .iter()
            .position(|p| p.phase == "hangar" && p.role == "fighter")
            .unwrap();
        let flight_id = a.wings[0].state.planes[index].flight_id.clone().unwrap();
        let group = a.wings[0]
            .state
            .flights
            .iter()
            .find(|f| f.id == flight_id)
            .unwrap()
            .plane_ids
            .clone();
        for p in a.wings[0]
            .state
            .planes
            .iter_mut()
            .filter(|p| group.contains(&p.id))
        {
            p.phase = "outbound".into();
            p.position = [10000.0, 500.0, 10000.0];
            p.wing_fold = 0.0;
        }
        let p = &mut a.wings[0].state.planes[index];
        p.phase = "returning".into();
        p.hp = 22.0;
        p.recovery_requested_at = Some(0.0);
        p.pilot.recovery_stage = Some("final".into());
        p.position = local_to_world(
            [
                layout.recovery_touchdown[0],
                90.0,
                layout.recovery_touchdown[2] + 1100.0,
            ],
            actor.motion.pose(),
        );
        let mut landed = false;
        for _ in 0..12000 {
            // Exercise the deck scheduler independently of approach aerodynamics:
            // the returning plane holds its final-leg position until admitted.
            let mut ops = a.deck_operations.remove("carrier").unwrap();
            ops.step(&mut a.wings[0].state, actor, &a.ground, true, true, 0.25);
            if !landed && ops.landing_clearance().is_some() {
                assert_eq!(
                    ops.landing_clearance(),
                    Some(a.wings[0].state.planes[index].id.as_str())
                );
                assert!(a.wings[0].state.planes[index].deck_slot.is_some());
                let p = &mut a.wings[0].state.planes[index];
                p.phase = "rollout".into();
                place(
                    p,
                    actor,
                    DeckPose {
                        position: layout.recovery_touchdown,
                        heading: 0.0,
                    },
                    &a.ground[&p.model_id],
                );
                landed = true;
            }
            a.deck_operations.insert("carrier".into(), ops);
            let planes = &a.wings[0].state.planes;
            assert!(planes.iter().filter(|p| p.deck_slot.is_some()).count() <= 24);
            assert_eq!(
                planes.iter().map(|p| &p.id).collect::<BTreeSet<_>>().len(),
                48
            );
            if landed && planes[index].phase == "ready" {
                break;
            }
        }
        assert!(
            landed,
            "{carrier} never received clearance: {:?}",
            a.wings[0].state.deck
        );
        assert_eq!(
            a.wings[0].state.planes[index].phase, "ready",
            "{carrier}: {:?}",
            a.wings[0].state.deck
        );
        assert_eq!(a.wings[0].state.planes[index].hp, 22.0);
        assert_eq!(
            a.wings[0]
                .state
                .planes
                .iter()
                .filter(|p| group.contains(&p.id) && p.phase == "outbound")
                .count(),
            3
        );
        a.deck_command("carrier", &flight_id, DeckAction::Stow)
            .unwrap();
        for _ in 0..5000 {
            let mut ops = a.deck_operations.remove("carrier").unwrap();
            ops.step(&mut a.wings[0].state, actor, &a.ground, true, true, 0.25);
            a.deck_operations.insert("carrier".into(), ops);
            if a.wings[0].state.planes[index].phase == "hangar" {
                break;
            }
        }
        assert_eq!(
            a.wings[0].state.planes[index].phase, "hangar",
            "{carrier}: {:?}",
            a.wings[0].state.deck
        );
        assert_eq!(
            a.wings[0].state.planes[index].flight_id.as_deref(),
            Some(flight_id.as_str())
        );
        // The standing group instruction also applies to later arrivals. It
        // must survive the interval when all currently landed members are below.
        let pending = &a.wings[0].state.deck.as_ref().unwrap().queue;
        assert!(
            pending
                .iter()
                .any(|r| r.flight_id == flight_id && r.action == DeckAction::Stow && !r.automatic)
        );
    }
}

#[test]
fn recall_keeps_a_committed_takeoff_on_the_runway_until_it_can_return() {
    let (actors, mut a) = setup("enterprise-cv6", 2);
    let flight = a.wings[0].state.flights[0].id.clone();
    let p = &mut a.wings[0].state.planes[0];
    p.phase = "takeoff".into();
    p.timer = 1.0;
    p.wing_fold = 0.0;
    a.recall("carrier", Some(&flight));
    let mut time = 0.0;
    step(&mut a, &actors, &mut time, 1.0 / 60.0);
    assert_eq!(a.wings[0].state.planes[0].phase, "takeoff");
    for _ in 0..600 {
        step(&mut a, &actors, &mut time, 1.0 / 60.0);
        if a.wings[0].state.planes[0].phase == "returning" {
            return;
        }
    }
    panic!(
        "Recalled aircraft did not finish takeoff: {}",
        a.wings[0].state.planes[0].phase
    );
}

#[test]
fn balanced_handling_recovers_an_entire_surviving_wing_onto_a_smaller_deck() {
    use naval_sim::{deck_operations::place, flight_deck::DeckPose, geometry::local_to_world};
    for carrier in ["enterprise-cv6", "shokaku"] {
        let (actors, mut a) = setup(carrier, 0);
        let actor = &actors[0];
        let layout = actor
            .definition()
            .air_wing
            .as_ref()
            .unwrap()
            .deck_layout
            .as_ref()
            .unwrap();
        let mut recovered = BTreeSet::new();
        for (i, p) in a.wings[0].state.planes.iter_mut().enumerate() {
            p.phase = "returning".into();
            p.wing_fold = 0.0;
            p.hp = 30.0 + i as f64;
            p.recovery_requested_at = Some(i as f64);
            p.pilot.recovery_stage = Some("final".into());
            p.position = local_to_world(
                [
                    layout.recovery_touchdown[0],
                    90.0,
                    layout.recovery_touchdown[2] + 1100.0,
                ],
                actor.motion.pose(),
            );
        }
        for _ in 0..40000 {
            let mut ops = a.deck_operations.remove("carrier").unwrap();
            ops.step(&mut a.wings[0].state, actor, &a.ground, true, true, 0.25);
            if let Some(id) = ops.landing_clearance() {
                let p = a.wings[0]
                    .state
                    .planes
                    .iter_mut()
                    .find(|p| p.id == id)
                    .unwrap();
                if p.phase != "rollout" {
                    assert!(recovered.insert(p.id.clone()));
                    p.phase = "rollout".into();
                    place(
                        p,
                        actor,
                        DeckPose {
                            position: layout.recovery_touchdown,
                            heading: 0.0,
                        },
                        &a.ground[&p.model_id],
                    );
                }
            }
            a.deck_operations.insert("carrier".into(), ops);
            let planes = &a.wings[0].state.planes;
            assert_eq!(planes.len(), 48);
            assert!(planes.iter().filter(|p| p.deck_slot.is_some()).count() <= 24);
            let slots: Vec<_> = planes.iter().filter_map(|p| p.deck_slot).collect();
            assert_eq!(slots.iter().collect::<BTreeSet<_>>().len(), slots.len());
            if recovered.len() == 48
                && planes
                    .iter()
                    .all(|p| matches!(p.phase.as_str(), "ready" | "hangar"))
            {
                break;
            }
        }
        assert_eq!(
            recovered.len(),
            48,
            "{carrier}: {:?}",
            a.wings[0].state.deck
        );
        assert!(
            a.wings[0]
                .state
                .planes
                .iter()
                .all(|p| matches!(p.phase.as_str(), "ready" | "hangar")),
            "{carrier}: {:?}",
            a.wings[0].state.deck
        );
        for (i, p) in a.wings[0].state.planes.iter().enumerate() {
            assert_eq!(p.hp, 30.0 + i as f64);
        }
    }
}

#[test]
fn a_queued_lift_does_not_refill_the_lane_a_launch_batch_is_still_using() {
    let (actors, mut a) = setup("enterprise-cv6", 2);
    let groups: Vec<_> = a.wings[0]
        .state
        .flights
        .iter()
        .filter(|f| {
            a.wings[0]
                .state
                .planes
                .iter()
                .any(|p| f.plane_ids.contains(&p.id) && p.role == "dive-bomber")
        })
        .cloned()
        .collect();
    let launch = &groups[0];
    let raise = &groups[2];
    a.deck_command("carrier", &raise.id, DeckAction::Raise)
        .unwrap();
    assert_eq!(
        a.launch_squadron(
            &actors[0],
            &launch.squadron_id,
            None,
            Some(AirOrder::Patrol {
                point: [5000.0, 800.0, -5000.0]
            }),
            &actors,
            Some(&launch.id),
            None
        ),
        4
    );
    let mut time = 0.0;
    until(&mut a, &actors, &mut time, |a| {
        a.wings[0]
            .state
            .planes
            .iter()
            .filter(|p| launch.plane_ids.contains(&p.id))
            .all(|p| p.deck_slot.is_none())
    });
    assert!(
        a.wings[0]
            .state
            .planes
            .iter()
            .filter(|p| raise.plane_ids.contains(&p.id))
            .all(|p| p.phase == "hangar")
    );
    until(&mut a, &actors, &mut time, |a| {
        a.wings[0]
            .state
            .planes
            .iter()
            .filter(|p| raise.plane_ids.contains(&p.id))
            .all(|p| p.phase == "ready")
    });
}

#[test]
fn returning_groups_cannot_permanently_block_a_queued_launch_behind_them() {
    use naval_sim::{deck_operations::place, flight_deck::DeckPose, geometry::local_to_world};
    let (actors, mut a) = setup("enterprise-cv6", 0);
    let groups: Vec<_> = a.wings[0]
        .state
        .flights
        .iter()
        .filter(|f| {
            a.wings[0]
                .state
                .planes
                .iter()
                .any(|p| f.plane_ids.contains(&p.id) && p.role == "dive-bomber")
        })
        .cloned()
        .collect();
    let departing = &groups[0];
    a.deck_command("carrier", &departing.id, DeckAction::Raise)
        .unwrap();
    let mut time = 0.0;
    until(&mut a, &actors, &mut time, |a| {
        a.wings[0]
            .state
            .planes
            .iter()
            .filter(|p| departing.plane_ids.contains(&p.id))
            .all(|p| p.phase == "ready")
    });
    let actor = &actors[0];
    let layout = actor
        .definition()
        .air_wing
        .as_ref()
        .unwrap()
        .deck_layout
        .as_ref()
        .unwrap();
    let arriving: Vec<_> = groups[1]
        .plane_ids
        .iter()
        .chain(groups[2].plane_ids.iter().take(1))
        .cloned()
        .collect();
    for (i, p) in a.wings[0]
        .state
        .planes
        .iter_mut()
        .filter(|p| arriving.contains(&p.id))
        .enumerate()
    {
        p.phase = "returning".into();
        p.wing_fold = 0.0;
        p.recovery_requested_at = Some(i as f64);
        p.pilot.recovery_stage = Some("final".into());
        p.position = local_to_world(
            [
                layout.recovery_touchdown[0],
                90.0,
                layout.recovery_touchdown[2] + 1100.0,
            ],
            actor.motion.pose(),
        );
    }
    assert_eq!(
        a.launch_squadron(
            actor,
            &departing.squadron_id,
            None,
            Some(AirOrder::Patrol {
                point: [5000.0, 800.0, -5000.0]
            }),
            &actors,
            Some(&departing.id),
            None
        ),
        4
    );
    let mut landed = BTreeSet::new();
    let mut launched = BTreeSet::new();
    for _ in 0..20000 {
        let mut ops = a.deck_operations.remove("carrier").unwrap();
        ops.step(&mut a.wings[0].state, actor, &a.ground, true, true, 0.25);
        if let Some(id) = ops.landing_clearance() {
            let p = a.wings[0]
                .state
                .planes
                .iter_mut()
                .find(|p| p.id == id)
                .unwrap();
            if p.phase != "rollout" {
                assert!(landed.insert(p.id.clone()));
                p.phase = "rollout".into();
                place(
                    p,
                    actor,
                    DeckPose {
                        position: layout.recovery_touchdown,
                        heading: 0.0,
                    },
                    &a.ground[&p.model_id],
                );
            }
        }
        a.deck_operations.insert("carrier".into(), ops);
        for p in a.wings[0]
            .state
            .planes
            .iter_mut()
            .filter(|p| p.phase == "takeoff")
        {
            assert!(launched.insert(p.id.clone()));
            p.phase = "outbound".into();
            p.deck_position = None;
            p.deck_slot = None;
            p.deck_heading = None;
        }
        if landed.len() == 5 && launched.len() == 4 {
            return;
        }
    }
    panic!(
        "Mixed handling stalled: {} landed, {} launched; {:?}",
        landed.len(),
        launched.len(),
        a.wings[0].state.deck
    );
}

#[test]
fn all_deck_preferences_drain_mixed_physical_traffic_without_losing_aircraft() {
    use naval_sim::{deck_operations::place, flight_deck::DeckPose, geometry::local_to_world};
    for policy in [
        DeckPolicy::Balanced,
        DeckPolicy::LaunchFirst,
        DeckPolicy::RecoverFirst,
    ] {
        let (actors, mut a) = setup("enterprise-cv6", 0);
        a.set_deck_policy("carrier", policy).unwrap();
        let flights = a.wings[0].state.flights.clone();
        let role = |flight: &&naval_sim::aircraft::AirFlight, role: &str| {
            a.wings[0]
                .state
                .planes
                .iter()
                .any(|p| flight.plane_ids.contains(&p.id) && p.role == role)
        };
        let departing: Vec<_> = flights
            .iter()
            .filter(|f| role(f, "fighter"))
            .take(3)
            .cloned()
            .collect();
        let arrivals: Vec<_> = flights
            .iter()
            .filter(|f| role(f, "dive-bomber"))
            .take(3)
            .flat_map(|f| f.plane_ids.clone())
            .collect();
        let leaving: Vec<_> = departing.iter().flat_map(|f| f.plane_ids.clone()).collect();
        for f in &departing {
            a.deck_command("carrier", &f.id, DeckAction::Raise).unwrap();
        }
        let mut time = 0.0;
        until(&mut a, &actors, &mut time, |a| {
            a.wings[0]
                .state
                .planes
                .iter()
                .filter(|p| leaving.contains(&p.id))
                .all(|p| p.phase == "ready")
        });
        let actor = &actors[0];
        let layout = actor
            .definition()
            .air_wing
            .as_ref()
            .unwrap()
            .deck_layout
            .as_ref()
            .unwrap();
        for (i, p) in a.wings[0]
            .state
            .planes
            .iter_mut()
            .filter(|p| arrivals.contains(&p.id))
            .enumerate()
        {
            p.phase = "returning".into();
            p.wing_fold = 0.0;
            p.recovery_requested_at = Some(i as f64);
            p.pilot.recovery_stage = Some("final".into());
            p.position = local_to_world(
                [
                    layout.recovery_touchdown[0],
                    90.0,
                    layout.recovery_touchdown[2] + 1100.0,
                ],
                actor.motion.pose(),
            );
        }
        for f in &departing {
            assert_eq!(
                a.launch_squadron(
                    actor,
                    &f.squadron_id,
                    None,
                    Some(AirOrder::Patrol {
                        point: [5000.0, 800.0, -5000.0]
                    }),
                    &actors,
                    Some(&f.id),
                    None
                ),
                4
            );
        }
        let mut events = String::new();
        let mut handled = BTreeSet::new();
        for _ in 0..40000 {
            let mut ops = a.deck_operations.remove("carrier").unwrap();
            // Repeated preference changes cannot reset the already-used batch.
            ops.set_policy(DeckPolicy::Balanced);
            ops.set_policy(policy);
            ops.step(&mut a.wings[0].state, actor, &a.ground, true, true, 0.25);
            if let Some(id) = ops.landing_clearance() {
                let p = a.wings[0]
                    .state
                    .planes
                    .iter_mut()
                    .find(|p| p.id == id)
                    .unwrap();
                if p.phase != "rollout" {
                    assert!(handled.insert(p.id.clone()));
                    events.push('R');
                    // Queue admission test: supply the permitted touchdown.
                    p.phase = "rollout".into();
                    place(
                        p,
                        actor,
                        DeckPose {
                            position: layout.recovery_touchdown,
                            heading: 0.0,
                        },
                        &a.ground[&p.model_id],
                    );
                }
            }
            a.deck_operations.insert("carrier".into(), ops);
            for p in a.wings[0]
                .state
                .planes
                .iter_mut()
                .filter(|p| p.phase == "takeoff")
            {
                assert!(handled.insert(p.id.clone()));
                events.push('L');
                // Queue fairness is separate from the existing actual sortie test.
                p.phase = "outbound".into();
                p.deck_position = None;
                p.deck_slot = None;
                p.deck_heading = None;
            }
            if events.len() == 24 {
                break;
            }
        }
        assert_eq!(
            events.len(),
            24,
            "{policy:?}: {events}; {:?}",
            a.wings[0].state.deck
        );
        assert_eq!(events.chars().filter(|c| *c == 'L').count(), 12);
        assert_eq!(events.chars().filter(|c| *c == 'R').count(), 12);
        assert_eq!(a.wings[0].state.planes.len(), 48);
        assert!(a.wings[0].state.planes.iter().all(|p| p.hp == 100.0));
    }
}
