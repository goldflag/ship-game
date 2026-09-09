use naval_sim::{
    air_rules::{
        ActiveFlights, AirRules, ConsolidationPolicy, DeckCycle, DeckTimings, EndurancePolicy,
    },
    aircraft::{AirOrder, terminal},
    aviation::Aviation,
    aviation_step::AirContext,
    catalog::Catalog,
    deck_operations::DeckAction,
    rules::TeamId,
    vessel::{CompiledShip, Controller, Vessel},
};
use std::{
    collections::BTreeSet,
    sync::{Arc, OnceLock},
};

fn catalog() -> &'static Catalog {
    static C: OnceLock<Catalog> = OnceLock::new();
    C.get_or_init(|| {
        Catalog::load(&std::fs::read("../../.build/naval-content/manifest.json").unwrap()).unwrap()
    })
}
fn setup(preset: &str) -> (Vec<Vessel>, Aviation) {
    let actors: Vec<_> = [
        ("carrier", TeamId::A),
        ("ally", TeamId::A),
        ("enemy", TeamId::B),
    ]
    .into_iter()
    .map(|(id, team)| {
        let mut actor = Vessel::new(
            id,
            team,
            Arc::new(CompiledShip::new(catalog().definitions[preset].clone()).unwrap()),
        );
        actor.controller = Controller::Player;
        actor
    })
    .collect();
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
    let air = Aviation::with_rules(&actors, catalog().aircraft.clone(), rules).unwrap();
    (actors, air)
}
fn step(actors: &[Vessel], air: &mut Aviation) {
    step_at(actors, air, 0.25);
}
fn step_at(actors: &[Vessel], air: &mut Aviation, time: f64) {
    air.step(
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
        0.25,
        time,
    );
}
fn deplete(air: &mut Aviation, group: &str, survivors: usize) {
    let state = air.wing_mut("carrier").unwrap();
    let ids = state
        .flights
        .iter()
        .find(|f| f.id == group)
        .unwrap()
        .plane_ids
        .clone();
    for (i, id) in ids.iter().enumerate() {
        let p = state.planes.iter_mut().find(|p| &p.id == id).unwrap();
        if i >= survivors {
            p.phase = "lost".into();
            p.hp = 0.0;
        } else {
            p.hp = 30.0 + i as f64 * 43.0;
            p.ammo = 6.0 + i as f64;
            p.payload = i % 2 == 0;
        }
    }
}
fn groups(air: &Aviation, role: &str) -> Vec<String> {
    let state = air.wing("carrier").unwrap();
    state
        .flights
        .iter()
        .filter(|f| {
            state
                .planes
                .iter()
                .any(|p| f.plane_ids.contains(&p.id) && p.role == role)
        })
        .map(|f| f.id.clone())
        .collect()
}
fn identities(air: &Aviation) {
    let state = air.wing("carrier").unwrap();
    assert_eq!(state.planes.len(), 48);
    let assigned: Vec<_> = state.flights.iter().flat_map(|f| &f.plane_ids).collect();
    assert_eq!(assigned.len(), 48);
    assert_eq!(assigned.iter().collect::<BTreeSet<_>>().len(), 48);
    for f in &state.flights {
        for id in &f.plane_ids {
            assert_eq!(
                state
                    .planes
                    .iter()
                    .find(|p| &p.id == id)
                    .unwrap()
                    .flight_id
                    .as_ref(),
                Some(&f.id)
            );
        }
    }
}

#[test]
fn compatible_hangar_groups_preserve_every_aircraft_and_repair_escort_references() {
    for preset in ["enterprise-cv6", "shokaku"] {
        for role in ["fighter", "dive-bomber", "torpedo-bomber"] {
            let (actors, mut air) = setup(preset);
            let ids = groups(&air, role);
            deplete(&mut air, &ids[0], 2);
            deplete(&mut air, &ids[1], 2);
            // Service already underway remains an individual timer after merging.
            for p in &mut air.wing_mut("carrier").unwrap().planes {
                if p.flight_id.as_ref() == Some(&ids[1]) && !terminal(p) {
                    p.phase = "repairing".into();
                    p.timer = 50.0;
                }
            }
            let before = air.wing("carrier").unwrap().planes.clone();
            for owner in ["ally", "enemy"] {
                air.wing_mut(owner).unwrap().flights[0].order = AirOrder::Escort {
                    flight_id: ids[1].clone(),
                };
            }
            step(&actors, &mut air);
            identities(&air);
            let state = air.wing("carrier").unwrap();
            let source = state.flights.iter().find(|f| f.id == ids[1]).unwrap();
            let target = state.flights.iter().find(|f| f.id == ids[0]).unwrap();
            assert_eq!(source.merged_into.as_ref(), Some(&ids[0]));
            assert!(target.notice.as_ref().unwrap().contains("4 aircraft"));
            assert_eq!(air.squadron_flights(&actors[0]).len(), 11);
            for old in &before {
                let p = state.planes.iter().find(|p| p.id == old.id).unwrap();
                assert_eq!(
                    (p.hp, p.ammo, p.payload, p.sortie, &p.model_id, &p.role),
                    (
                        old.hp,
                        old.ammo,
                        old.payload,
                        old.sortie,
                        &old.model_id,
                        &old.role
                    )
                );
                assert_eq!(
                    p.timer,
                    if old.phase == "repairing" {
                        49.75
                    } else {
                        old.timer
                    }
                );
            }
            assert!(matches!(&air.wing("ally").unwrap().flights[0].order,
                AirOrder::Escort { flight_id } if flight_id == &ids[0]));
            assert!(
                matches!(&air.wing("enemy").unwrap().flights[0].order,
                AirOrder::Escort { flight_id } if flight_id == &ids[1]),
                "private merges cannot rewrite enemy knowledge"
            );
            // A stale addressed command follows the surviving own group.
            air.deck_command("carrier", &ids[1], DeckAction::Repair)
                .unwrap();
            assert_eq!(
                air.wing("carrier").unwrap().deck.as_ref().unwrap().queue[0].flight_id,
                ids[0]
            );
            assert!(
                air.deck_command("ally", &ids[1], DeckAction::Repair)
                    .is_err()
            );
        }
    }
}

#[test]
fn consolidation_waits_for_all_members_and_respects_pending_handling_and_profile() {
    let (actors, mut initial) = setup("enterprise-cv6");
    let ids = groups(&initial, "fighter");
    deplete(&mut initial, &ids[0], 2);
    deplete(&mut initial, &ids[1], 2);
    for phase in ["outbound", "returning", "ready", "raising", "lowering"] {
        let mut air = initial.clone();
        let p = air
            .wing_mut("carrier")
            .unwrap()
            .planes
            .iter_mut()
            .find(|p| p.flight_id.as_ref() == Some(&ids[1]) && !terminal(p))
            .unwrap();
        p.phase = phase.into();
        p.position = [0.0, 850.0, -4000.0];
        if phase == "ready" {
            p.deck_slot = Some(0);
        }
        step(&actors, &mut air);
        assert_eq!(
            air.squadron_flights(&actors[0]).len(),
            12,
            "{phase} group cannot merge"
        );
        identities(&air);
    }
    let mut disabled = initial.clone();
    disabled.rules.consolidation = ConsolidationPolicy::Disabled;
    step(&actors, &mut disabled);
    assert_eq!(disabled.squadron_flights(&actors[0]).len(), 12);
    let request = initial
        .deck_command("carrier", &ids[1], DeckAction::Raise)
        .unwrap();
    // A disabled service module holds the queued operation without moving its aircraft.
    let mut suspended = actors;
    let service = suspended[0]
        .definition()
        .air_wing
        .as_ref()
        .unwrap()
        .service_module_id
        .clone();
    suspended[0]
        .damage
        .modules
        .iter_mut()
        .find(|m| m.id == service)
        .unwrap()
        .hp = 0.0;
    step(&suspended, &mut initial);
    assert_eq!(initial.squadron_flights(&suspended[0]).len(), 12);
    assert!(initial.cancel_deck_command("carrier", request));
    step(&suspended, &mut initial);
    assert_eq!(initial.squadron_flights(&suspended[0]).len(), 11);
}

#[test]
fn incompatible_or_oversize_groups_do_not_merge_and_chained_merges_keep_the_first_id() {
    let (actors, mut air) = setup("enterprise-cv6");
    let fighter = groups(&air, "fighter");
    let bomber = groups(&air, "dive-bomber");
    deplete(&mut air, &fighter[0], 3);
    deplete(&mut air, &fighter[1], 2);
    deplete(&mut air, &bomber[0], 1);
    step(&actors, &mut air);
    assert_eq!(air.squadron_flights(&actors[0]).len(), 12);
    deplete(&mut air, &fighter[0], 1);
    deplete(&mut air, &fighter[2], 1);
    step(&actors, &mut air);
    identities(&air);
    let state = air.wing("carrier").unwrap();
    assert_eq!(air.squadron_flights(&actors[0]).len(), 10);
    for id in &fighter[1..3] {
        assert_eq!(
            state
                .flights
                .iter()
                .find(|f| &f.id == id)
                .unwrap()
                .merged_into
                .as_ref(),
            Some(&fighter[0])
        );
    }
    assert_eq!(
        state
            .planes
            .iter()
            .filter(|p| p.flight_id.as_ref() == Some(&fighter[0]) && !terminal(p))
            .count(),
        4
    );
}

#[test]
fn same_role_different_models_stay_separate() {
    let (actors, mut air) = setup("enterprise-cv6");
    let ids = groups(&air, "fighter");
    deplete(&mut air, &ids[0], 2);
    deplete(&mut air, &ids[1], 2);
    for p in &mut air.wing_mut("carrier").unwrap().planes {
        if p.flight_id.as_ref() == Some(&ids[1]) {
            p.model_id = "a6m2-zero".into();
        }
    }
    step(&actors, &mut air);
    identities(&air);
    assert_eq!(air.squadron_flights(&actors[0]).len(), 12);
}

#[test]
fn a_consolidated_group_repairs_raises_and_launches_through_its_previous_id() {
    for preset in ["enterprise-cv6", "shokaku"] {
        let (actors, mut air) = setup(preset);
        let ids = groups(&air, "dive-bomber");
        deplete(&mut air, &ids[0], 2);
        deplete(&mut air, &ids[1], 2);
        step(&actors, &mut air);
        let mut time = 0.25;
        air.deck_command("carrier", &ids[1], DeckAction::Repair)
            .unwrap();
        for _ in 0..2000 {
            time += 0.25;
            step_at(&actors, &mut air, time);
            if air
                .wing("carrier")
                .unwrap()
                .planes
                .iter()
                .filter(|p| p.flight_id.as_ref() == Some(&ids[0]))
                .all(|p| p.phase == "hangar" && p.payload && p.hp >= 60.0)
            {
                break;
            }
        }
        assert!(
            air.wing("carrier")
                .unwrap()
                .planes
                .iter()
                .filter(|p| p.flight_id.as_ref() == Some(&ids[0]))
                .all(|p| p.phase == "hangar" && p.payload && p.hp >= 60.0)
        );
        air.deck_command("carrier", &ids[1], DeckAction::Raise)
            .unwrap();
        for _ in 0..5000 {
            time += 0.25;
            step_at(&actors, &mut air, time);
            if air
                .wing("carrier")
                .unwrap()
                .planes
                .iter()
                .filter(|p| p.flight_id.as_ref() == Some(&ids[0]))
                .all(|p| p.phase == "ready" && p.deck_slot.is_some())
            {
                break;
            }
        }
        assert!(
            air.command_squadron(
                &actors[0],
                &ids[1],
                AirOrder::Patrol {
                    point: [0.0, 850.0, -5000.0],
                },
                &actors,
                None
            ),
            "the merged group must be ready to launch after its actual lift"
        );
        for _ in 0..5000 {
            time += 0.25;
            step_at(&actors, &mut air, time);
            if air
                .wing("carrier")
                .unwrap()
                .planes
                .iter()
                .filter(|p| p.flight_id.as_ref() == Some(&ids[0]))
                .all(|p| p.phase == "outbound")
            {
                break;
            }
        }
        let state = air.wing("carrier").unwrap();
        assert_eq!(
            state
                .planes
                .iter()
                .filter(|p| p.phase == "outbound"
                    && p.flight_id.as_ref() == Some(&ids[0])
                    && p.sortie == Some(1))
                .count(),
            4
        );
        identities(&air);
        air.recall("carrier", Some(&ids[1]));
        assert!(
            air.wing("carrier")
                .unwrap()
                .planes
                .iter()
                .filter(|p| p.flight_id.as_ref() == Some(&ids[0]))
                .all(|p| p.phase == "returning")
        );
    }
}
