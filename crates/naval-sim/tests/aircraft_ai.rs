use naval_sim::{
    aviation::{AirContext, AirOrder, Aviation, service_available},
    catalog::Catalog,
    geometry::local_to_world,
    motion::{HelmCommand, step_ship},
    rules::TeamId,
    vessel::{Controller, Vessel},
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
fn carrier(id: &str, preset: &str, team: TeamId) -> Vessel {
    let mut a = Vessel::new(id, team, Arc::new(catalog().compile(preset).unwrap()));
    a.controller = Controller::Player;
    a
}
fn step(air: &mut Aviation, actors: &[Vessel], tick: usize) -> Vec<naval_sim::impact::DamageEvent> {
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
            seed: 5739,
            sea: None,
        },
        1.0 / 60.0,
        tick as f64 / 60.0,
    );
    events
}

fn recover(
    preset: &str,
    role: &str,
    rudder: f64,
    count: usize,
    spawn: [f64; 3],
    change_at: Option<f64>,
) {
    let mut actors = vec![carrier("carrier", preset, TeamId::A)];
    actors[0].motion.speed = 16.0;
    let mut air = Aviation::new(&actors, catalog().aircraft.clone());
    let flight = air
        .squadron_flights(&actors[0])
        .into_iter()
        .find(|f| {
            air.wing("carrier")
                .unwrap()
                .planes
                .iter()
                .any(|p| f.plane_ids.contains(&p.id) && p.role == role)
        })
        .unwrap();
    let ids: Vec<_> = flight.plane_ids.into_iter().take(count).collect();
    for (slot, id) in ids.iter().enumerate() {
        let p = air.plane_mut(id).unwrap();
        p.phase = "returning".into();
        p.deck_slot = None;
        p.deck_datum = None;
        p.deck_position = None;
        p.position = local_to_world(
            [
                spawn[0] + slot as f64 * 40.0,
                spawn[1],
                spawn[2] + slot as f64 * 40.0,
            ],
            actors[0].motion.pose(),
        );
        p.previous_position = p.position;
        p.heading = 0.0;
        p.pitch = 0.0;
        p.bank = 0.0;
        p.velocity = [0.0, 0.0, -80.0];
        p.controls.gear = 0.0;
        p.flight_time = 65.0;
    }
    let mut recovered = BTreeSet::new();
    for tick in 0..36000 {
        let a = &mut actors[0];
        let def = a.compiled.definition.clone();
        let order = if change_at.is_some_and(|t| tick as f64 / 60.0 >= t) {
            0.0
        } else {
            rudder
        };
        step_ship(
            &mut a.motion,
            HelmCommand {
                throttle: 1.0,
                rudder: order,
                ..Default::default()
            },
            &def.handling,
            1.0,
            1.0,
            None,
        );
        assert!(service_available(a, None));
        for e in step(&mut air, &actors, tick) {
            if e.kind == "aircraft-recovered" {
                recovered.insert(e.aircraft.unwrap().id);
            }
        }
        if recovered.len() == count {
            return;
        }
    }
    panic!(
        "{preset} {role}, rudder {rudder}: recovered {}/{}; {:?}",
        recovered.len(),
        count,
        ids.iter()
            .map(|id| {
                let p = air.iter_planes().find(|p| &p.id == id).unwrap();
                (&p.phase, &p.pilot, p.position)
            })
            .collect::<Vec<_>>()
    );
}

#[test]
fn a_returning_fighter_recovers_while_the_carrier_keeps_turning() {
    recover(
        "enterprise-cv6",
        "fighter",
        0.32,
        1,
        [1500.0, 300.0, -1000.0],
        None,
    );
}

#[test]
fn all_roles_recover_on_both_carriers_through_normal_turns() {
    for preset in ["enterprise-cv6", "shokaku"] {
        for role in ["fighter", "dive-bomber", "torpedo-bomber"] {
            recover(preset, role, -0.32, 1, [-1500.0, 450.0, -1000.0], None);
        }
    }
}

#[test]
fn recovery_handles_six_aircraft_and_a_carrier_straightening() {
    recover(
        "enterprise-cv6",
        "torpedo-bomber",
        0.32,
        6,
        [1500.0, 300.0, -1000.0],
        Some(180.0),
    );
    recover(
        "shokaku",
        "dive-bomber",
        0.0,
        6,
        [-1200.0, 850.0, 3500.0],
        None,
    );
}

#[test]
fn a_sharp_turn_holds_with_a_reason_then_recovers_after_centering() {
    let mut actors = vec![carrier("carrier", "enterprise-cv6", TeamId::A)];
    let mut air = Aviation::new(&actors, catalog().aircraft.clone());
    let p = &mut air.wing_mut("carrier").unwrap().planes[0];
    p.phase = "returning".into();
    p.position = [1000.0, 300.0, 1000.0];
    p.velocity = [0.0, 0.0, -80.0];
    p.deck_slot = None;
    actors[0].motion.yaw_rate = 0.02;
    step(&mut air, &actors, 0);
    let p = &air.wing("carrier").unwrap().planes[0];
    assert_eq!(p.pilot.recovery_stage.as_deref(), Some("marshal"));
    assert!(
        p.pilot
            .recovery
            .as_ref()
            .unwrap()
            .notice
            .as_ref()
            .unwrap()
            .contains("Steady the course")
    );
    recover(
        "enterprise-cv6",
        "fighter",
        1.0,
        1,
        [1500.0, 300.0, -1000.0],
        Some(180.0),
    );
}

#[test]
fn fighter_dogfights_are_effective_finite_and_replay_exactly() {
    fn run(seed: u32) -> (usize, serde_json::Value) {
        let mut actors = vec![
            Vessel::new(
                "a",
                TeamId::A,
                Arc::new(catalog().compile("enterprise-cv6").unwrap()),
            ),
            Vessel::new(
                "b",
                TeamId::B,
                Arc::new(catalog().compile("shokaku").unwrap()),
            ),
        ];
        for (i, a) in actors.iter_mut().enumerate() {
            a.controller = Controller::Player;
            a.motion.z = if i == 0 { 1500.0 } else { -1500.0 };
        }
        let mut air = Aviation::new(&actors, catalog().aircraft.clone());
        for (i, a) in actors.iter().enumerate() {
            let squadron = &a
                .definition()
                .air_wing
                .as_ref()
                .unwrap()
                .squadrons
                .iter()
                .find(|s| s.role == "fighter")
                .unwrap()
                .id;
            assert_eq!(
                air.launch_squadron(
                    a,
                    squadron,
                    None,
                    Some(AirOrder::Patrol {
                        point: [0.0, 420.0, 0.0]
                    }),
                    &actors,
                    None,
                    None
                ),
                6
            );
            for (slot, p) in air
                .wing_mut(&a.motion.id)
                .unwrap()
                .planes
                .iter_mut()
                .filter(|p| p.phase == "queued")
                .enumerate()
            {
                p.phase = "outbound".into();
                p.deck_slot = None;
                p.position = [
                    slot as f64 * 40.0,
                    420.0,
                    if i == 0 { 500.0 } else { -500.0 },
                ];
                p.previous_position = p.position;
                p.heading = if i == 0 { 0.0 } else { std::f64::consts::PI };
                p.pitch = 0.0;
                p.bank = 0.0;
                p.velocity = [0.0, 0.0, if i == 0 { -100.0 } else { 100.0 }];
                p.controls.gear = 0.0;
            }
        }
        let mut sequence = 0;
        let mut shots = 0;
        let mut kills = 0;
        let mut breaks = 0;
        let mut old_break = std::collections::BTreeMap::new();
        for tick in 0..15600 {
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
                    seed,
                    sea: None,
                },
                1.0 / 60.0,
                tick as f64 / 60.0,
            );
            for e in events {
                if e.kind == "aircraft-fire" {
                    shots += 1;
                }
                if e.kind == "aircraft-lost" {
                    kills += 1;
                }
            }
            for p in air.planes() {
                if p.pilot.break_time > 0.0 && !old_break.get(&p.id).copied().unwrap_or(false) {
                    breaks += 1;
                }
                old_break.insert(p.id.clone(), p.pilot.break_time > 0.0);
            }
        }

        assert!(shots > 0 && shots <= 192);
        assert!(breaks > 5);
        for p in air.iter_planes() {
            assert!(p.position.iter().all(|v| v.is_finite()));
            assert!((0.0..=100.0).contains(&p.hp));
            assert!((0.0..=16.0).contains(&p.ammo));
        }
        (kills, serde_json::to_value(&air.wings).unwrap())
    }
    let first = run(5739);
    assert_eq!(
        first,
        run(5739),
        "same seed must replay every pilot and airframe state"
    );
    assert!(
        first.0 + run(1).0 + run(98765).0 >= 6,
        "dogfights became ineffective again"
    );
}

#[test]
fn a_full_bomber_flight_recovers_without_straightening_the_carrier() {
    recover(
        "enterprise-cv6",
        "dive-bomber",
        0.32,
        6,
        [1500.0, 850.0, -3500.0],
        None,
    );
}
