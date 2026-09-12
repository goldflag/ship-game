//! Native fleet-command run that exercises the opposing air commander end to
//! end: plan, deploy, then step the Session while applying the enemy air and
//! fleet directives exactly as the wasm runtime does. Twenty simulated minutes
//! take about two minutes in release, so it is ignored by default:
//!
//! `cargo test --release -p naval-protocol --test pve_air_doctrine -- --ignored --nocapture`
//!
//! `DOCTRINE_SEED`, `DOCTRINE_LEVEL` (easy|normal|hard), `DOCTRINE_MAP`,
//! `DOCTRINE_WEATHER` and `DOCTRINE_MINUTES` select the run.
use naval_protocol::{Command, CommandEnvelope, session::Session};
use naval_sim::{
    aircraft::{AirOrder, airborne},
    battle::{Battle, Spawn},
    bots::AiLevel,
    catalog::Catalog,
    navigation::Movement,
    pve::{FleetShip, GroupStation, Placement, PvePlan, PveRequest, TaskGroup},
    pve_air::{AirDoctrine, AirIntent},
    rules::TeamId,
};
use std::{
    collections::BTreeMap,
    sync::{Arc, OnceLock},
};

fn catalog() -> Arc<Catalog> {
    static C: OnceLock<Arc<Catalog>> = OnceLock::new();
    C.get_or_init(|| {
        Arc::new(
            Catalog::load(&std::fs::read("../../.build/naval-content/manifest.json").unwrap())
                .unwrap(),
        )
    })
    .clone()
}
#[derive(Default)]
struct Metrics {
    enemy_carriers: usize,
    strike_orders: usize,
    longest_search_s: u64,
    most_flights_on_one_contact: usize,
    most_inbound_per_carrier: usize,
    released: bool,
    escorted_samples: usize,
    strike_samples: usize,
}
fn run(seed: u32, level: AiLevel, map: &str, weather: &str, minutes: u64) -> Metrics {
    let catalog = catalog();
    let doctrine = AirDoctrine::for_level(level).unwrap();
    let ids = [
        "iowa",
        "baltimore",
        "cleveland",
        "fletcher",
        "yukikaze",
        "gleaves",
        "enterprise-cv6",
        "shokaku",
    ];
    let ships: Vec<_> = ids
        .iter()
        .enumerate()
        .map(|(i, id)| FleetShip {
            id: format!("unit-{}", i + 1),
            preset_id: (*id).into(),
            group_id: if id.contains("enterprise") || *id == "shokaku" {
                "rear"
            } else {
                "front"
            }
            .into(),
        })
        .collect();
    let request = PveRequest {
        version: 1,
        seed,
        map_id: map.into(),
        weather: weather.into(),
        difficulty: level,
        ships: ships.clone(),
        groups: vec![
            TaskGroup {
                id: "front".into(),
                name: "Surface force".into(),
                station: GroupStation::Front,
                formation: None,
            },
            TaskGroup {
                id: "rear".into(),
                name: "Carrier force".into(),
                station: GroupStation::Rear,
                formation: None,
            },
        ],
    };
    let mut plan = PvePlan::generate(&catalog, request).expect("plan");
    let placements: Vec<_> = ships
        .iter()
        .enumerate()
        .map(|(i, s)| Placement {
            id: s.id.clone(),
            spawn: Spawn {
                x: -3000.0 + (i as f64) * 700.0,
                z: if s.group_id == "front" {
                    8000.0
                } else {
                    14500.0
                },
                heading: 0.0,
            },
        })
        .collect();
    let setup = plan.deploy(&catalog, placements).expect("deploy");
    let mut compiled = BTreeMap::new();
    for ship in &setup.ships {
        compiled
            .entry(ship.preset_id.clone())
            .or_insert_with(|| Arc::new(catalog.compile(&ship.preset_id).unwrap()));
    }
    println!(
        "=== seed {seed} {level:?} {map} {weather}: enemy {:?}",
        setup
            .ships
            .iter()
            .filter(|s| s.team == TeamId::B)
            .map(|s| s.preset_id.as_str())
            .collect::<Vec<_>>()
    );
    let enemy_carriers = setup
        .ships
        .iter()
        .filter(|s| s.team == TeamId::B && catalog.definitions[&s.preset_id].air_wing.is_some())
        .count();
    let battle = Battle::new(catalog.clone(), &compiled, setup).expect("battle");
    let mut session = Session::new(battle, [TeamId::A, TeamId::B]).unwrap();
    session.input_ready[1] = false;
    for (id, (movement, target)) in plan.initial_directives(&session.battle) {
        if let Some(ship) = session.control.ships.get_mut(&id) {
            ship.movement = movement;
            ship.target_id = target;
        }
    }
    // The player's fleet advances slowly so the enemy finds it.
    for s in &ships {
        if let Some(ship) = session.control.ships.get_mut(&s.id) {
            ship.movement = Movement::Route {
                waypoints: vec![[0.0, -6000.0]],
                speed_mps: 8.0,
                looped: false,
            };
        }
    }
    let mut metrics = Metrics {
        enemy_carriers,
        ..Default::default()
    };
    let mut searching_since: BTreeMap<String, u64> = BTreeMap::new();
    let mut sequence = 0u32;
    for _ in 0..minutes * 60 * 60 {
        for directive in plan.enemy_air_directives(&session.battle) {
            sequence += 1;
            let command = match directive.intent {
                AirIntent::Order(order) => {
                    if matches!(order, AirOrder::Strike { .. }) {
                        metrics.strike_orders += 1;
                    }
                    println!(
                        "t={:>6.0}s ORDER {} {} {:?}",
                        session.battle.tick as f64 / 60.0,
                        directive.carrier_id,
                        directive.flight_id,
                        order
                    );
                    Command::Air {
                        flight_id: directive.flight_id,
                        order,
                    }
                }
                AirIntent::Deck(action) => Command::Deck {
                    flight_id: directive.flight_id,
                    action,
                },
            };
            let _ = session.apply(
                1,
                CommandEnvelope {
                    sequence,
                    connection_epoch: session.control.players[1].epoch,
                    ship_id: directive.carrier_id,
                    command,
                },
            );
        }
        for (id, (movement, target)) in plan.enemy_directives(&session.battle) {
            if let Some(ship) = session.control.ships.get_mut(&id) {
                ship.movement = movement;
                ship.target_id = target;
            }
        }
        session.step();
        let tick = session.battle.tick;
        if tick.is_multiple_of(30 * 60) {
            let battle = &session.battle;
            let mut per_contact: BTreeMap<String, usize> = BTreeMap::new();
            let mut escorted = 0;
            let mut strikes = 0;
            for actor in battle
                .actors
                .iter()
                .filter(|a| a.team == TeamId::B && a.physical_loss().is_none())
            {
                let Some(wing) = battle.aviation.wing(&actor.motion.id) else {
                    continue;
                };
                let mut inbound = 0;
                for f in &wing.flights {
                    let planes: Vec<_> = wing
                        .planes
                        .iter()
                        .filter(|p| f.plane_ids.contains(&p.id) && p.hp > 0.0)
                        .collect();
                    let on_task = planes.iter().any(|p| {
                        matches!(
                            p.phase.as_str(),
                            "queued" | "taxi" | "launch-ready" | "takeoff" | "outbound" | "attack"
                        )
                    });
                    if planes
                        .iter()
                        .any(|p| airborne(p) && p.role != "fighter" && !p.payload)
                    {
                        metrics.released = true;
                    }
                    let key = format!("{}/{}", actor.motion.id, f.id);
                    let searching = on_task
                        && f.notice
                            .as_deref()
                            .is_some_and(|n| n.starts_with("Contact lost"));
                    if searching {
                        let since = *searching_since.entry(key.clone()).or_insert(tick);
                        metrics.longest_search_s =
                            metrics.longest_search_s.max((tick - since) / 60);
                    } else {
                        searching_since.remove(&key);
                    }
                    if !on_task {
                        continue;
                    }
                    if let AirOrder::Strike { contact_id } = &f.order {
                        strikes += 1;
                        *per_contact.entry(contact_id.clone()).or_default() += 1;
                        if planes.iter().any(|p| p.payload && p.flight_time < 240.0) {
                            inbound += 1;
                        }
                        if wing.flights.iter().any(|e| {
                            matches!(&e.order, AirOrder::Escort { flight_id } if flight_id == &f.id)
                                && wing.planes.iter().any(|p| {
                                    e.plane_ids.contains(&p.id) && p.hp > 0.0 && airborne(p)
                                })
                        }) {
                            escorted += 1;
                        }
                    }
                    println!(
                        "    t={:>5}s {key} order={:?} notice={:?} phases={:?}",
                        tick / 60,
                        f.order,
                        f.notice,
                        planes.iter().map(|p| p.phase.as_str()).collect::<Vec<_>>()
                    );
                }
                metrics.most_inbound_per_carrier = metrics.most_inbound_per_carrier.max(inbound);
            }
            metrics.strike_samples += strikes;
            metrics.escorted_samples += escorted;
            metrics.most_flights_on_one_contact = metrics
                .most_flights_on_one_contact
                .max(per_contact.values().copied().max().unwrap_or(0));
        }
        if session.battle.outcome.is_some() {
            println!("outcome at t={}s: {:?}", tick / 60, session.battle.outcome);
            break;
        }
    }
    println!(
        "strike orders {} · longest search {} s · most flights on one contact {} · most inbound per carrier {} (wave {}) · released {} · escorted strike samples {}/{}",
        metrics.strike_orders,
        metrics.longest_search_s,
        metrics.most_flights_on_one_contact,
        metrics.most_inbound_per_carrier,
        doctrine.wave_flights,
        metrics.released,
        metrics.escorted_samples,
        metrics.strike_samples
    );
    metrics
}

#[test]
#[ignore = "twenty simulated minutes; run explicitly in release"]
fn enemy_air_wing_strikes_in_sized_waves_and_never_orbits_a_dead_report() {
    let env = |k: &str| std::env::var(k).ok();
    let seed = env("DOCTRINE_SEED")
        .and_then(|s| s.parse().ok())
        .unwrap_or(1);
    let minutes = env("DOCTRINE_MINUTES")
        .and_then(|s| s.parse().ok())
        .unwrap_or(20);
    let level = match env("DOCTRINE_LEVEL").as_deref() {
        Some("easy") => AiLevel::Easy,
        Some("normal") => AiLevel::Normal,
        _ => AiLevel::Hard,
    };
    let map = env("DOCTRINE_MAP").unwrap_or_else(|| "pacific-islands".into());
    let weather = env("DOCTRINE_WEATHER").unwrap_or_else(|| "clear".into());
    let doctrine = AirDoctrine::for_level(level).unwrap();
    let m = run(seed, level, &map, &weather, minutes);
    if m.enemy_carriers == 0 {
        println!("seed {seed} generated an opponent without carriers; nothing to judge");
        return;
    }
    assert!(
        m.longest_search_s <= 180,
        "a strike searched a lost report for {} s",
        m.longest_search_s
    );
    assert!(
        m.most_flights_on_one_contact <= 4 + 2 * doctrine.carrier_bonus,
        "{} flights were committed to one contact",
        m.most_flights_on_one_contact
    );
    assert!(
        m.most_inbound_per_carrier <= doctrine.wave_flights,
        "a carrier had {} bomber flights inbound at once",
        m.most_inbound_per_carrier
    );
    assert!(m.strike_orders > 0, "the enemy never struck");
    assert!(m.released, "no bomber ever released its payload");
}
