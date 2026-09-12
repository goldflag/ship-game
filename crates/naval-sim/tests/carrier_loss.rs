use naval_sim::{
    air_recovery::CarrierRecovery,
    air_rules::{ActiveFlights, AirRules, DeckCycle, DeckTimings, EndurancePolicy},
    aircraft::{AirOrder, active_flight, terminal},
    aviation::Aviation,
    aviation_step::AirContext,
    catalog::Catalog,
    deck_operations::DeckAction,
    rules::TeamId,
    sensors::{self, Knowledge, Sensors},
    vessel::Vessel,
};
use std::sync::{Arc, OnceLock};
fn catalog() -> &'static Catalog {
    static C: OnceLock<Catalog> = OnceLock::new();
    C.get_or_init(|| {
        Catalog::load(&std::fs::read("../../.build/naval-content/manifest.json").unwrap()).unwrap()
    })
}
fn setup(preset: &str) -> (Vec<Vessel>, Aviation, Sensors) {
    let mut actors: Vec<_> = [
        ("carrier", preset, TeamId::A),
        ("escort", "fletcher", TeamId::A),
        ("enemy", "fletcher", TeamId::B),
    ]
    .into_iter()
    .map(|(id, preset, team)| Vessel::new(id, team, Arc::new(catalog().compile(preset).unwrap())))
    .collect();
    actors[1].motion.x = 4000.0;
    actors[2].motion.z = -5000.0;
    let mut rules = AirRules::legacy();
    rules.group_size = Some(4);
    rules.deck_capacity = Some(24);
    rules.active_flights = ActiveFlights::Unlimited;
    rules.endurance = EndurancePolicy::Disabled;
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
    air.airspace = Some(catalog().missions["pve-fleet-v1"].area.clone());
    (actors, air, Sensors::default())
}
fn step_dt(
    actors: &[Vessel],
    air: &mut Aviation,
    reports: &Sensors,
    tick: u64,
    dt: f64,
) -> Vec<naval_sim::impact::DamageEvent> {
    let mut events = vec![];
    air.step(
        &mut AirContext {
            knowledge: Some(Knowledge {
                sensors: reports,
                tick,
                islands: &[],
                terrain: &[],
            }),
            actors,
            shells: &mut vec![],
            torpedoes: &mut vec![],
            releases: &mut vec![],
            sequence: &mut 0,
            events: &mut events,
            seed: 123,
            sea: None,
        },
        dt,
        tick as f64 / 60.0,
    );
    events
}
fn step(
    actors: &[Vessel],
    air: &mut Aviation,
    reports: &Sensors,
    tick: u64,
) -> Vec<naval_sim::impact::DamageEvent> {
    step_dt(actors, air, reports, tick, 0.25)
}
fn airborne(actors: &[Vessel], air: &mut Aviation, role: &str) -> String {
    let f = air
        .squadron_flights(&actors[0])
        .into_iter()
        .find(|f| {
            air.wing("carrier")
                .unwrap()
                .planes
                .iter()
                .any(|p| f.plane_ids.contains(&p.id) && p.role == role && p.deck_slot.is_some())
        })
        .unwrap();
    assert!(air.command_squadron(
        &actors[0],
        &f.id,
        AirOrder::Patrol {
            point: [0.0, 850.0, -3500.0]
        },
        actors,
        None
    ));
    for p in air
        .wing_mut("carrier")
        .unwrap()
        .planes
        .iter_mut()
        .filter(|p| f.plane_ids.contains(&p.id))
    {
        p.phase = "outbound".into();
        p.deck_slot = None;
        p.deck_position = None;
        p.position = [0.0, 850.0, -3500.0];
        p.previous_position = p.position;
        p.velocity = [0.0, 0.0, -85.0];
        p.hp = 73.0;
    }
    f.id
}
fn observe(actors: &[Vessel], air: &Aviation, reports: &mut Sensors) {
    for tick in [60, 120, 180, 240, 300, 360] {
        reports.update(
            tick,
            &sensors::entities(actors, air),
            &[],
            &[],
            sensors::VisualConditions::resolve(catalog(), "north-atlantic", "clear"),
            &sensors::VisualRules::default(),
        );
    }
}
fn destroy_service(a: &mut Vessel) {
    let id = a
        .definition()
        .air_wing
        .as_ref()
        .unwrap()
        .service_module_id
        .clone();
    a.damage.modules.iter_mut().find(|m| m.id == id).unwrap().hp = 0.0;
}
#[test]
fn irreversible_service_loss_clears_committed_handling_without_killing_or_restoring_survivors() {
    for preset in ["enterprise-cv6", "shokaku"] {
        let (mut actors, mut air, reports) = setup(preset);
        let group = air
            .wing("carrier")
            .unwrap()
            .flights
            .iter()
            .find(|f| {
                air.wing("carrier")
                    .unwrap()
                    .planes
                    .iter()
                    .any(|p| f.plane_ids.contains(&p.id) && p.phase == "hangar")
            })
            .unwrap()
            .id
            .clone();
        air.deck_command("carrier", &group, DeckAction::Raise)
            .unwrap();
        for tick in (0..300).step_by(15) {
            step(&actors, &mut air, &reports, tick);
            if air
                .wing("carrier")
                .unwrap()
                .deck
                .as_ref()
                .unwrap()
                .current_plane_id
                .is_some()
            {
                break;
            }
        }
        assert!(
            air.wing("carrier")
                .unwrap()
                .deck
                .as_ref()
                .unwrap()
                .current_plane_id
                .is_some()
        );
        let before: Vec<_> = air
            .wing("carrier")
            .unwrap()
            .planes
            .iter()
            .map(|p| (p.id.clone(), p.hp, p.payload, p.ammo))
            .collect();
        destroy_service(&mut actors[0]);
        let events = step(&actors, &mut air, &reports, 300);
        let wing = air.wing("carrier").unwrap();
        assert!(matches!(
            wing.recovery,
            Some(CarrierRecovery::Closed { .. })
        ));
        assert!(wing.deck.as_ref().unwrap().queue.is_empty());
        assert!(wing.deck.as_ref().unwrap().current_plane_id.is_none());
        assert_eq!(wing.deck.as_ref().unwrap().occupied, 0);
        assert!(wing.planes.iter().all(|p| p.phase == "withdrawn"
            && p.wreck.is_none()
            && p.deck_slot.is_none()
            && p.deck_position.is_none()));
        assert_eq!(
            before,
            wing.planes
                .iter()
                .map(|p| (p.id.clone(), p.hp, p.payload, p.ammo))
                .collect::<Vec<_>>()
        );
        assert_eq!(
            events
                .iter()
                .filter(|e| e.kind == "aircraft-unavailable")
                .count(),
            48
        );
        assert!(events.iter().all(|e| e.kind != "aircraft-lost"));
        assert!(wing.flights.iter().all(|f| !active_flight(f, &wing.planes)));
        assert!(
            air.deck_command("carrier", &group, DeckAction::Raise)
                .is_err()
        );
        assert!(
            step(&actors, &mut air, &reports, 315).is_empty(),
            "terminal events occur only once"
        );
    }
}
#[test]
fn carrier_loss_destroys_grounded_planes_but_withdraws_returners_without_a_new_home() {
    let (mut actors, mut air, reports) = setup("enterprise-cv6");
    let group = airborne(&actors, &mut air, "dive-bomber");
    air.recall("carrier", Some(&group));
    actors[0].damage.sunk = true;
    let events = step(&actors, &mut air, &reports, 0);
    let wing = air.wing("carrier").unwrap();
    assert_eq!(wing.planes.iter().filter(|p| p.phase == "lost").count(), 44);
    let withdrawn: Vec<_> = wing
        .planes
        .iter()
        .filter(|p| p.phase == "withdrawn")
        .collect();
    assert_eq!(withdrawn.len(), 4);
    assert!(
        withdrawn
            .iter()
            .all(|p| p.owner_id == "carrier" && p.hp == 73.0 && p.payload && p.wreck.is_none())
    );
    assert_eq!(
        events
            .iter()
            .filter(|e| e.kind == "aircraft-unavailable")
            .count(),
        4
    );
    assert!(wing.planes.iter().all(terminal));
    assert_eq!(wing.deck.as_ref().unwrap().occupied, 0);
}
#[test]
fn a_temporary_unsteady_deck_retains_the_marshal_queue_and_resumes_recovery() {
    let (mut actors, mut air, reports) = setup("enterprise-cv6");
    let group = airborne(&actors, &mut air, "fighter");
    air.recall("carrier", Some(&group));
    actors[0].motion.roll = 0.3;
    for tick in (0..1200).step_by(15) {
        step(&actors, &mut air, &reports, tick);
    }
    let wing = air.wing("carrier").unwrap();
    assert_eq!(wing.recovery, Some(CarrierRecovery::Delayed));
    assert!(
        wing.planes
            .iter()
            .filter(|p| p.flight_id.as_ref() == Some(&group))
            .all(|p| p.phase == "returning" && p.recovery_requested_at.is_some() && p.hp == 73.0)
    );
    actors[0].motion.roll = 0.0;
    step(&actors, &mut air, &reports, 1200);
    assert_eq!(
        air.wing("carrier").unwrap().recovery,
        Some(CarrierRecovery::Open)
    );
    assert!(
        air.wing("carrier")
            .unwrap()
            .planes
            .iter()
            .all(|p| !terminal(p))
    );
    for tick in (1215..1200 + 900 * 60).step_by(15) {
        step(&actors, &mut air, &reports, tick);
        if air
            .wing("carrier")
            .unwrap()
            .planes
            .iter()
            .filter(|p| p.flight_id.as_ref() == Some(&group))
            .all(|p| p.phase == "ready" && p.deck_slot.is_some())
        {
            break;
        }
    }
    assert!(
        air.wing("carrier")
            .unwrap()
            .planes
            .iter()
            .filter(|p| p.flight_id.as_ref() == Some(&group))
            .all(|p| p.phase == "ready" && p.deck_slot.is_some() && p.hp == 73.0),
        "all returning aircraft physically recover after the temporary delay"
    );
}
#[test]
fn an_observed_strike_can_finish_after_carrier_loss_but_aircraft_cannot_preserve_the_fleet() {
    let (mut actors, mut air, mut reports) = setup("enterprise-cv6");
    let group = airborne(&actors, &mut air, "dive-bomber");
    observe(&actors, &air, &mut reports);
    let contact = reports
        .contacts(TeamId::A)
        .into_iter()
        .find(|c| c.kind == sensors::ContactKind::Surface)
        .unwrap()
        .id;
    assert!(air.command_squadron(
        &actors[0],
        &group,
        AirOrder::Strike {
            contact_id: contact
        },
        &actors,
        None
    ));
    actors[0].damage.sunk = true;
    step(&actors, &mut air, &reports, 360);
    assert!(
        air.wing("carrier")
            .unwrap()
            .planes
            .iter()
            .filter(|p| p.flight_id.as_ref() == Some(&group))
            .all(|p| p.phase == "outbound" || p.phase == "attack")
    );
    assert!(
        naval_sim::mission::evaluate(
            360,
            &actors,
            &air,
            &catalog().missions["pve-fleet-v1"],
            [1, 1]
        )
        .is_none()
    );
    actors[1].damage.sunk = true;
    assert_eq!(
        naval_sim::mission::evaluate(
            360,
            &actors,
            &air,
            &catalog().missions["pve-fleet-v1"],
            [0, 1]
        )
        .unwrap()
        .winner_team_id,
        Some(TeamId::B)
    );
    actors[1].damage.sunk = false;
    for p in air
        .wing_mut("carrier")
        .unwrap()
        .planes
        .iter_mut()
        .filter(|p| p.flight_id.as_ref() == Some(&group))
    {
        p.payload = false;
    }
    step(&actors, &mut air, &reports, 375);
    assert!(
        air.wing("carrier")
            .unwrap()
            .planes
            .iter()
            .filter(|p| p.flight_id.as_ref() == Some(&group))
            .all(|p| p.phase == "withdrawn" && p.hp == 73.0)
    );
}
#[test]
fn stale_target_reports_do_not_keep_a_homeless_strike_in_the_air_forever() {
    let (mut actors, mut air, mut reports) = setup("shokaku");
    let group = airborne(&actors, &mut air, "torpedo-bomber");
    observe(&actors, &air, &mut reports);
    let contact = reports
        .contacts(TeamId::A)
        .into_iter()
        .find(|c| c.kind == sensors::ContactKind::Surface)
        .unwrap()
        .id;
    assert!(air.command_squadron(
        &actors[0],
        &group,
        AirOrder::Strike {
            contact_id: contact
        },
        &actors,
        None
    ));
    destroy_service(&mut actors[0]);
    step(&actors, &mut air, &reports, 360 + 91 * 60);
    assert!(air.wing("carrier").unwrap().planes.iter().all(terminal));
    assert!(
        air.wing("carrier")
            .unwrap()
            .planes
            .iter()
            .filter(|p| p.flight_id.as_ref() == Some(&group))
            .all(|p| p.phase == "withdrawn" && p.payload && p.hp == 73.0)
    );
}

#[test]
fn a_homeless_strike_releases_its_bombs_then_withdraws_without_fabricated_kills() {
    let (mut actors, mut air, mut reports) = setup("enterprise-cv6");
    let group = airborne(&actors, &mut air, "dive-bomber");
    observe(&actors, &air, &mut reports);
    let contact = reports
        .contacts(TeamId::A)
        .into_iter()
        .find(|c| c.kind == sensors::ContactKind::Surface)
        .unwrap()
        .id;
    assert!(air.command_squadron(
        &actors[0],
        &group,
        AirOrder::Strike {
            contact_id: contact
        },
        &actors,
        None
    ));
    actors[0].damage.sunk = true;
    let mut releases = 0;
    let mut withdrawals = 0;
    // Match the 60 Hz flight integrator: a quarter-second step can skip the
    // dive bomber's narrow ballistic release window entirely.
    for tick in 375..375 + 180 * 60 {
        if tick % 60 == 0 {
            reports.update(
                tick,
                &sensors::entities(&actors, &air),
                &[],
                &[],
                sensors::VisualConditions::resolve(catalog(), "north-atlantic", "clear"),
                &sensors::VisualRules::default(),
            );
        }
        for event in step_dt(&actors, &mut air, &reports, tick, 1.0 / 60.0) {
            if event.kind == "bomb-release" {
                releases += 1;
            }
            if event.kind == "aircraft-unavailable" {
                withdrawals += 1;
            }
        }
        if air.wing("carrier").unwrap().planes.iter().all(terminal) {
            break;
        }
    }
    assert_eq!(
        releases, 4,
        "each surviving bomber must physically release its bomb"
    );
    assert_eq!(withdrawals, 4);
    assert!(
        air.wing("carrier")
            .unwrap()
            .planes
            .iter()
            .filter(|p| p.flight_id.as_ref() == Some(&group))
            .all(|p| p.phase == "withdrawn" && !p.payload && p.hp == 73.0 && p.wreck.is_none())
    );
}

#[test]
fn pve_carrier_loss_also_closes_the_production_compatibility_deck() {
    let (mut actors, _, reports) = setup("shokaku");
    let mut air =
        Aviation::with_rules(&actors, catalog().aircraft.clone(), AirRules::legacy()).unwrap();
    assert!(air.wing("carrier").unwrap().deck.is_none());
    destroy_service(&mut actors[0]);
    step(&actors, &mut air, &reports, 0);
    let state = air.wing("carrier").unwrap();
    assert!(matches!(
        state.recovery,
        Some(CarrierRecovery::Closed { .. })
    ));
    assert_eq!(state.planes.len(), 48);
    assert!(
        state
            .planes
            .iter()
            .all(|p| p.phase == "withdrawn" && p.hp == 100.0)
    );
    let group = air.squadron_flights(&actors[0])[0].id.clone();
    assert!(!air.command_squadron(
        &actors[0],
        &group,
        AirOrder::Patrol {
            point: [0.0, 850.0, 0.0]
        },
        &actors,
        None
    ));
    assert!(step(&actors, &mut air, &reports, 15).is_empty());
}
