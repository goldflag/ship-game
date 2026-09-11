//! Captain integration checks run the actual ship motion and authored handling.
//! Combat is omitted here so navigation failures cannot be masked by a sunk ship.
use naval_sim::{
    definition::ShipDefinition,
    environment::Island,
    formations::{StationClass, formation_stations},
    geometry::wrap_angle,
    motion::step_ship,
    navigation::{self, Formation, Movement, NavigationState, NavigationStatus, Trails},
    rules::{DT, TeamId},
    vessel::{CompiledShip, Vessel},
};
use std::{
    collections::BTreeMap,
    sync::{Arc, OnceLock},
};

fn content() -> &'static BTreeMap<&'static str, Arc<CompiledShip>> {
    static SHIPS: OnceLock<BTreeMap<&'static str, Arc<CompiledShip>>> = OnceLock::new();
    SHIPS.get_or_init(|| {
        ["enterprise-cv6", "fletcher", "baltimore"]
            .into_iter()
            .map(|id| {
                let bytes = std::fs::read(format!("../../public/models/{id}.json")).unwrap();
                let def: ShipDefinition = serde_json::from_slice(&bytes).unwrap();
                (
                    id,
                    Arc::new(CompiledShip::new(Arc::new(def), None).unwrap()),
                )
            })
            .collect()
    })
}
fn ship(id: &str, preset: &str, x: f64, z: f64) -> Vessel {
    let mut a = Vessel::new(id, TeamId::A, content()[preset].clone());
    a.motion.x = x;
    a.motion.z = z;
    a
}
/// Battle records every actor's track each tick; these checks do the same, so
/// column followers see the same wake in isolation as they do in a real battle.
fn record(ships: &[Vessel], trails: &mut Trails) {
    for a in ships {
        let trail = trails.entry(a.motion.id.clone()).or_default();
        trail.record([a.motion.x, a.motion.z], a.motion.heading, a.motion.speed);
        trail.steady_axis(a.motion.heading, DT);
    }
}
fn step(ships: &mut Vec<Vessel>, orders: &[Movement], islands: &[Island], tick: u64) {
    step_tracked(ships, orders, islands, tick, &mut Trails::new());
}
fn step_tracked(
    ships: &mut Vec<Vessel>,
    orders: &[Movement],
    islands: &[Island],
    tick: u64,
    trails: &mut Trails,
) {
    step_fleet(ships, orders, islands, tick, trails, false)
}
/// `reserve` reproduces what Battle does for a fleet: the guide's speed comes
/// from the damage-aware formation report rather than a fixed ceiling.
fn step_fleet(
    ships: &mut Vec<Vessel>,
    orders: &[Movement],
    islands: &[Island],
    tick: u64,
    trails: &mut Trails,
    reserve: bool,
) {
    record(ships, trails);
    let fleet: BTreeMap<String, naval_sim::battle::Orders> = ships
        .iter()
        .zip(orders)
        .map(|(a, order)| {
            (
                a.motion.id.clone(),
                naval_sim::battle::Orders {
                    movement: order.clone(),
                    ..Default::default()
                },
            )
        })
        .collect();
    let mut commands = vec![];
    for (i, order) in orders.iter().enumerate().take(ships.len()) {
        let mut a = ships.remove(i);
        let limit = if reserve {
            navigation::formation_report(&a, ships, &fleet, Default::default(), trails)
                .speed_limit_mps
        } else {
            15.0
        };
        let mut state = a
            .navigation
            .take()
            .unwrap_or_else(|| NavigationState::new(order.clone()));
        let c = navigation::command(&a, ships, islands, order, &mut state, tick, limit, trails);
        a.navigation = Some(state);
        commands.push(c);
        ships.insert(i, a);
    }
    for (a, c) in ships.iter_mut().zip(commands) {
        let handling = a.definition().handling.clone();
        step_ship(&mut a.motion, c, &handling, 1.0, 1.0, None);
    }
}
fn route(waypoints: Vec<[f64; 2]>) -> Movement {
    Movement::Route {
        waypoints,
        speed_mps: 12.0,
        looped: false,
    }
}
fn gap(a: &Vessel, p: [f64; 2]) -> f64 {
    (a.motion.x - p[0]).hypot(a.motion.z - p[1])
}

#[test]
fn completes_a_route_with_a_turn_and_stops_at_the_last_waypoint() {
    let mut ships = vec![ship("dd", "fletcher", 0.0, 0.0)];
    let orders = vec![route(vec![[0.0, -1800.0], [1800.0, -1800.0]])];
    for tick in 0..60 * 600 {
        step(&mut ships, &orders, &[], tick);
    }
    let a = &ships[0];
    assert!(
        gap(a, [1800.0, -1800.0]) < 110.0,
        "position {}, {}",
        a.motion.x,
        a.motion.z
    );
    assert!(a.motion.speed.abs() < 0.2, "speed {}", a.motion.speed);
    assert_eq!(a.navigation.as_ref().unwrap().waypoint, 1);
    assert_eq!(
        a.navigation.as_ref().unwrap().status,
        NavigationStatus::Holding
    );
}

#[test]
fn escort_catches_a_moving_leader_and_holds_locally_after_its_loss() {
    let mut ships = vec![
        ship("cv", "enterprise-cv6", 0.0, 0.0),
        ship("dd", "fletcher", 650.0, 1300.0),
    ];
    ships[0].motion.speed = 10.0;
    ships[1].motion.speed = 10.0;
    let orders = vec![
        route(vec![[0.0, -14000.0]]),
        Movement::Escort {
            leader_id: "cv".into(),
            offset: [650.0, 350.0],
            radius_m: 1500.0,
            formation: Default::default(),
            slot: 0,
        },
    ];
    let mut trails = Trails::new();
    let mut overtook_leader_speed = false;
    for tick in 0..60 * 600 {
        step_tracked(&mut ships, &orders, &[], tick, &mut trails);
        overtook_leader_speed |= ships[1].motion.speed > ships[0].motion.speed + 1.0;
    }
    assert!(overtook_leader_speed, "escort needs catch-up speed");
    assert!(
        gap(
            &ships[1],
            [ships[0].motion.x + 650.0, ships[0].motion.z + 350.0]
        ) < 120.0
    );
    let mut ships = vec![ships.remove(1)];
    let at = [ships[0].motion.x, ships[0].motion.z];
    for tick in 60 * 600..60 * 900 {
        step_tracked(&mut ships, &orders[1..], &[], tick, &mut trails);
    }
    assert_eq!(
        ships[0].navigation.as_ref().unwrap().status,
        NavigationStatus::LeaderLost
    );
    assert!(
        gap(&ships[0], at) < 160.0,
        "lost leader must not authorize pursuit: {}",
        gap(&ships[0], at)
    );
}

fn island(id: &str, x: f64, z: f64) -> Island {
    Island {
        id: id.into(),
        x,
        z,
        rx: 650.0,
        rz: 1000.0,
        height: 100.0,
        seed: 1.0,
        style: "tropical".into(),
    }
}

#[test]
fn routes_around_an_island_and_reports_an_unreachable_destination() {
    let mut ships = vec![ship("dd", "fletcher", 0.0, 2200.0)];
    let islands = vec![island("island", 0.0, 0.0)];
    let orders = vec![route(vec![[0.0, -2400.0]])];
    for tick in 0..60 * 900 {
        step(&mut ships, &orders, &islands, tick);
        assert!(
            islands[0].radius(ships[0].motion.x, ships[0].motion.z) > 1.1,
            "grounding at tick {tick}"
        );
    }
    assert!(
        gap(&ships[0], [0.0, -2400.0]) < 150.0,
        "did not complete detour: {}, {}",
        ships[0].motion.x,
        ships[0].motion.z
    );
    let bad = vec![route(vec![[0.0, 0.0]])];
    step(&mut ships, &bad, &islands, 60 * 900);
    assert_eq!(
        ships[0].navigation.as_ref().unwrap().status,
        NavigationStatus::Blocked
    );
}

#[test]
fn carrier_screen_traverses_a_passage_and_reforms_after_a_turn() {
    let offsets = [[-650.0, 350.0], [650.0, 350.0], [0.0, 1000.0]];
    let mut ships = vec![ship("cv", "enterprise-cv6", 0.0, 2000.0)];
    let mut orders = vec![route(vec![[0.0, -2800.0], [2400.0, -2800.0]])];
    for (i, offset) in offsets.iter().enumerate() {
        ships.push(ship(
            &format!("dd{i}"),
            "fletcher",
            offset[0],
            2000.0 + offset[1],
        ));
        orders.push(Movement::Escort {
            leader_id: "cv".into(),
            offset: *offset,
            radius_m: 1500.0,
            formation: Default::default(),
            slot: 0,
        });
    }
    let islands = vec![island("west", -1800.0, 0.0), island("east", 1800.0, 0.0)];
    let mut minimum_gap = f64::INFINITY;
    let mut trails = Trails::new();
    for tick in 0..60 * 1100 {
        step_tracked(&mut ships, &orders, &islands, tick, &mut trails);
        for (i, a) in ships.iter().enumerate() {
            for island in &islands {
                assert!(
                    island.radius(a.motion.x, a.motion.z) > 1.05,
                    "{} grounded at tick {tick}",
                    a.motion.id
                );
            }
            for b in ships.iter().skip(i + 1) {
                minimum_gap = minimum_gap.min(gap(a, [b.motion.x, b.motion.z]));
            }
        }
    }
    assert!(
        minimum_gap > 200.0,
        "unsafe formation spacing: {minimum_gap}"
    );
    assert!(
        gap(&ships[0], [2400.0, -2800.0]) < 150.0,
        "leader failed route"
    );
    let leader = &ships[0];
    for (a, order) in ships[1..].iter().zip(&orders[1..]) {
        let target = navigation::station_for(order, leader, trails.get("cv"))
            .unwrap()
            .position;
        assert!(
            gap(a, target) < 200.0,
            "{} failed to reform: error {}, position ({}, {}), target {:?}, speed {}, heading {}, status {:?}",
            a.motion.id,
            gap(a, target),
            a.motion.x,
            a.motion.z,
            target,
            a.motion.speed,
            a.motion.heading,
            a.navigation.as_ref().unwrap().status
        );
    }
}

fn damage_engines(a: &mut Vessel, fraction: f64) {
    let engines: Vec<_> = a
        .definition()
        .modules
        .iter()
        .filter(|m| m.kind == "engine")
        .map(|m| (m.id.clone(), m.hp))
        .collect();
    assert!(!engines.is_empty());
    for (id, hp) in engines {
        a.damage.modules.iter_mut().find(|m| m.id == id).unwrap().hp = hp * fraction;
    }
}
#[test]
fn damaged_straggler_requires_an_explicit_decision_and_slowing_restores_formation() {
    use naval_sim::{battle::Orders, machinery::system_health, navigation::FormationPolicy};
    let run = |policy| {
        let mut ships = vec![
            ship("cv", "enterprise-cv6", 0.0, 0.0),
            ship("dd", "fletcher", 650.0, 350.0),
        ];
        for a in &mut ships {
            a.motion.speed = 12.0;
        }
        let orders = BTreeMap::from([
            (
                "cv".into(),
                Orders {
                    movement: route(vec![[0.0, -20000.0]]),
                    formation_policy: policy,
                    ..Default::default()
                },
            ),
            (
                "dd".into(),
                Orders {
                    movement: Movement::Escort {
                        leader_id: "cv".into(),
                        offset: [650.0, 350.0],
                        radius_m: 160.0,
                        formation: Default::default(),
                        slot: 0,
                    },
                    ..Default::default()
                },
            ),
        ]);
        // A healthy ship deployed far away does not manufacture a damage choice.
        ships[1].motion.z = 4000.0;
        assert!(
            navigation::formation_report(&ships[0], &ships[1..], &orders, policy, &Trails::new())
                .stragglers
                .is_empty()
        );
        ships[1].motion.z = 350.0;
        damage_engines(&mut ships[1], 0.09);
        let report =
            navigation::formation_report(&ships[0], &ships[1..], &orders, policy, &Trails::new());
        assert_eq!(report.stragglers.len(), 1);
        assert_eq!(report.stragglers[0].ship_id, "dd");
        for tick in 0..60 * 600 {
            let mut commands = vec![];
            for i in 0..2 {
                let mut a = ships.remove(i);
                let order = &orders[&a.motion.id];
                let limit =
                    navigation::formation_report(&a, &ships, &orders, policy, &Trails::new())
                        .speed_limit_mps;
                let mut state = a
                    .navigation
                    .take()
                    .unwrap_or_else(|| NavigationState::new(order.movement.clone()));
                commands.push(navigation::command(
                    &a,
                    &ships,
                    &[],
                    &order.movement,
                    &mut state,
                    tick,
                    limit,
                    &Trails::new(),
                ));
                a.navigation = Some(state);
                ships.insert(i, a);
            }
            for (a, command) in ships.iter_mut().zip(commands) {
                let handling = a.definition().handling.clone();
                let power = system_health(a, a.definition(), "engine", None);
                step_ship(&mut a.motion, command, &handling, power, 1.0, None);
            }
        }
        let lead = &ships[0];
        let (sin, cos) = lead.motion.heading.sin_cos();
        (
            gap(
                &ships[1],
                [
                    lead.motion.x + 650.0 * cos - 350.0 * sin,
                    lead.motion.z + 650.0 * sin + 350.0 * cos,
                ],
            ),
            lead.motion.speed,
        )
    };
    let awaiting = run(FormationPolicy::AwaitDecision);
    let leaving = run(FormationPolicy::LeaveStragglers);
    let slowing = run(FormationPolicy::SlowForStragglers);
    assert_eq!(awaiting, leaving, "no silent slow-down before a decision");
    assert!(
        awaiting.0 > 1500.0,
        "damaged escort must really fail to keep pace: {awaiting:?}"
    );
    assert!(
        slowing.0 < 250.0,
        "accepted slow-down must actually reform: {slowing:?}"
    );
    assert!(slowing.1 < awaiting.1 * 0.6);
}

#[test]
fn unobserved_nearby_enemy_motion_cannot_change_route_avoidance() {
    let a = ship("dd", "fletcher", 0.0, 0.0);
    let mut hidden = ship("hidden", "fletcher", 0.0, -150.0);
    hidden.team = TeamId::B;
    let order = route(vec![[0.0, -2000.0]]);
    let mut state = NavigationState::new(order.clone());
    let before = navigation::command_observed(
        &a,
        &[hidden],
        &[],
        &order,
        &mut state,
        0,
        12.0,
        &Trails::new(),
        Some(&[]),
    );
    let mut state = NavigationState::new(order.clone());
    let after = navigation::command_observed(
        &a,
        &[],
        &[],
        &order,
        &mut state,
        0,
        12.0,
        &Trails::new(),
        Some(&[]),
    );
    assert_eq!(
        serde_json::to_value(before).unwrap(),
        serde_json::to_value(after).unwrap()
    );
}

#[test]
fn observed_threat_dodge_expires_without_erasing_the_route_or_waypoint() {
    use naval_sim::{
        fleet_evasion::{self, ObservedThreat},
        motion::HelmCommand,
    };
    let mut a = ship("dd", "fletcher", 0.0, 0.0);
    a.motion.speed = 10.0;
    let order = route(vec![[0.0, -2000.0], [2000.0, -2000.0]]);
    let mut state = NavigationState::new(order.clone());
    state.waypoint = 1;
    let normal = HelmCommand {
        throttle: 0.6,
        rudder: 0.0,
        ..Default::default()
    };
    let threat = ObservedThreat {
        position: [0.0, -600.0, -1000.0],
        velocity: [0.0, 0.0, 25.0],
        torpedo: true,
    };
    let evade = fleet_evasion::command(&a, &[], &[threat], 100, &mut state, normal);
    assert_eq!(state.status, NavigationStatus::EvadingTorpedo);
    assert!(evade.rudder.abs() > 0.5);
    assert_eq!(state.order, order);
    assert_eq!(state.waypoint, 1);
    let resumed = fleet_evasion::command(&a, &[], &[], 100 + 8 * 60, &mut state, normal);
    assert_eq!(
        serde_json::to_value(resumed).unwrap(),
        serde_json::to_value(normal).unwrap()
    );
    assert_eq!(state.order, order);
    assert_eq!(state.waypoint, 1);
    let receding = ObservedThreat {
        velocity: [0.0, 0.0, -80.0],
        ..threat
    };
    let clear = fleet_evasion::command(&a, &[], &[receding], 100 + 9 * 60, &mut state, normal);
    assert_eq!(clear.rudder, normal.rudder);
}

#[test]
fn torpedo_wake_acquisition_requires_local_weather_range_and_clear_terrain() {
    use naval_sim::{fleet_evasion, torpedoes::Torpedo};
    let a = ship("dd", "fletcher", 0.0, 0.0);
    let torpedo = Torpedo {
        id: 1,
        owner_id: "enemy".into(),
        tube_id: "tube".into(),
        position: [0.0, -2.0, -1000.0],
        velocity: [0.0, 0.0, 25.0],
        distance: 300.0,
        age: 12.0,
        weapon: Default::default(),
    };
    assert_eq!(
        fleet_evasion::visible_wakes(&a, std::slice::from_ref(&torpedo), &[], &[], 10000.0).len(),
        1
    );
    assert!(
        fleet_evasion::visible_wakes(&a, std::slice::from_ref(&torpedo), &[], &[], 500.0)
            .is_empty()
    );
    let mut obstruction = island("screen", 0.0, -500.0);
    obstruction.rx = 100.0;
    obstruction.rz = 100.0;
    assert!(fleet_evasion::visible_wakes(&a, &[torpedo], &[obstruction], &[], 10000.0).is_empty());
}

#[test]
fn aircraft_evasion_uses_only_fresh_hostile_converging_reports() {
    use naval_sim::{fleet_evasion, motion::HelmCommand, sensors::ContactTrack};
    let mut a = ship("dd", "fletcher", 0.0, 0.0);
    a.motion.speed = 10.0;
    let order = route(vec![[0.0, -2000.0]]);
    let normal = HelmCommand {
        throttle: 0.6,
        rudder: 0.0,
        ..Default::default()
    };
    let report: ContactTrack=serde_json::from_value(serde_json::json!({
        "id":"contact-b-1","kind":"aircraft","affiliation":"hostile","status":"tracked",
        "firstObservedTick":0,"lastObservedTick":600,"measuredPosition":[0,500,-1400],"estimatedPosition":[0,500,-1400],
        "velocity":[0,0,100],"uncertaintyM":50,"identificationConfidence":0,"classification":"Aircraft","identifiedPresetId":null,"sources":[]
    })).unwrap();
    let mut state = NavigationState::new(order.clone());
    let dodge = fleet_evasion::command(
        &a,
        std::slice::from_ref(&report),
        &[],
        600,
        &mut state,
        normal,
    );
    assert_eq!(state.status, NavigationStatus::EvadingAircraft);
    assert_ne!(dodge.rudder, normal.rudder);
    for (report, tick) in [
        (report.clone(), 1000),
        (
            ContactTrack {
                affiliation: naval_sim::sensors::Affiliation::Unknown,
                ..report.clone()
            },
            600,
        ),
        (
            ContactTrack {
                velocity: [0.0, 0.0, -100.0],
                ..report
            },
            600,
        ),
    ] {
        let mut state = NavigationState::new(order.clone());
        assert_eq!(
            fleet_evasion::command(&a, &[report], &[], tick, &mut state, normal).rudder,
            normal.rudder
        );
    }
}

#[test]
fn a_visible_torpedo_dodge_opens_real_clearance_then_resumes_the_order() {
    use naval_sim::{
        fleet_evasion::{self, ObservedThreat},
        rules::DT,
    };
    let run = |evade| {
        let mut a = ship("dd", "fletcher", 0.0, 0.0);
        a.motion.speed = 12.0;
        let order = route(vec![[0.0, -5000.0]]);
        let mut state = NavigationState::new(order.clone());
        let mut minimum = f64::INFINITY;
        for tick in 0..60 * 45 {
            let position = [0.0, -2.0, -800.0 + 25.0 * tick as f64 * DT];
            let normal =
                navigation::command(&a, &[], &[], &order, &mut state, tick, 12.0, &Trails::new());
            let command = if evade {
                fleet_evasion::command(
                    &a,
                    &[],
                    &[ObservedThreat {
                        position,
                        velocity: [0.0, 0.0, 25.0],
                        torpedo: true,
                    }],
                    tick,
                    &mut state,
                    normal,
                )
            } else {
                normal
            };
            let handling = a.definition().handling.clone();
            step_ship(&mut a.motion, command, &handling, 1.0, 1.0, None);
            minimum = minimum.min((position[0] - a.motion.x).hypot(position[2] - a.motion.z));
            assert_eq!(state.order, order);
        }
        minimum
    };
    let baseline = run(false);
    let dodging = run(true);
    assert!(baseline < 5.0, "control course should collide: {baseline}");
    assert!(
        dodging > 40.0,
        "physical dodge must open useful clearance: {dodging}"
    );
}

#[test]
fn ship_in_shore_safety_margin_can_sail_out_to_open_water() {
    let mut ships = vec![ship("dd", "fletcher", 950.0, 0.0)];
    ships[0].motion.heading = std::f64::consts::FRAC_PI_2;
    let islands = vec![island("island", 0.0, 0.0)];
    let orders = vec![route(vec![[3000.0, 0.0]])];
    assert!(islands[0].radius(950.0, 0.0) > 1.2, "ship starts in water");
    for tick in 0..60 * 600 {
        step(&mut ships, &orders, &islands, tick);
    }
    assert!(
        gap(&ships[0], [3000.0, 0.0]) < 150.0,
        "outward route stalled: position=({}, {}), status={:?}",
        ships[0].motion.x,
        ships[0].motion.z,
        ships[0].navigation.as_ref().unwrap().status
    );
}

#[test]
fn shore_margin_recovery_takes_a_detour_instead_of_crossing_land() {
    let mut ships = vec![ship("dd", "fletcher", 950.0, 0.0)];
    ships[0].motion.heading = std::f64::consts::FRAC_PI_2;
    let islands = vec![island("island", 0.0, 0.0)];
    let orders = vec![route(vec![[-3000.0, 0.0]])];
    let half_length = ships[0].definition().hull.length * 0.5;
    for tick in 0..60 * 1200 {
        step(&mut ships, &orders, &islands, tick);
        let a = &ships[0];
        assert!(
            (a.motion.x / (650.0 * 1.22 + half_length))
                .hypot(a.motion.z / (1000.0 * 1.22 + half_length))
                > 1.0,
            "recovery must preserve hull clearance at tick {tick}"
        );
    }
    assert!(
        gap(&ships[0], [-3000.0, 0.0]) < 150.0,
        "did not complete recovery detour"
    );
}

#[test]
fn shore_margin_recovery_never_relaxes_the_hull_or_destination_clearance() {
    let islands = vec![island("island", 0.0, 0.0)];
    for (from, to) in [(820.0, [3000.0, 0.0]), (950.0, [970.0, 300.0])] {
        let a = ship("dd", "fletcher", from, 0.0);
        let order = route(vec![to]);
        let mut state = NavigationState::new(order.clone());
        let command = navigation::command(
            &a,
            &[],
            &islands,
            &order,
            &mut state,
            0,
            15.0,
            &Trails::new(),
        );
        assert_eq!(state.status, NavigationStatus::Blocked);
        assert_eq!(command.throttle, 0.0);
    }
}

/// Distance from a point to the polyline the guide actually steamed.
fn cross_track(track: &[[f64; 2]], p: [f64; 2]) -> f64 {
    track
        .windows(2)
        .map(|s| {
            let d = [s[1][0] - s[0][0], s[1][1] - s[0][1]];
            let n = d[0] * d[0] + d[1] * d[1];
            let t = if n > 0.0 {
                (((p[0] - s[0][0]) * d[0] + (p[1] - s[0][1]) * d[1]) / n).clamp(0.0, 1.0)
            } else {
                0.0
            };
            (p[0] - s[0][0] - d[0] * t).hypot(p[1] - s[0][1] - d[1] * t)
        })
        .fold(f64::INFINITY, f64::min)
}

#[test]
fn a_column_turns_in_succession_and_keeps_its_line_and_intervals() {
    const INTERVAL: f64 = 600.0;
    let mut ships = vec![ship("guide", "fletcher", 0.0, 0.0)];
    let mut orders = vec![route(vec![[0.0, -5000.0], [6000.0, -5000.0]])];
    for i in 0..3 {
        ships.push(ship(
            &format!("dd{i}"),
            "fletcher",
            0.0,
            INTERVAL * (i + 1) as f64,
        ));
        orders.push(Movement::Escort {
            leader_id: "guide".into(),
            offset: [0.0, INTERVAL * (i + 1) as f64],
            radius_m: 160.0,
            formation: Formation::Column,
            slot: i as u32,
        });
    }
    for a in &mut ships {
        a.motion.speed = 12.0;
    }
    let mut trails = Trails::new();
    let mut track = vec![];
    for tick in 0..60 * 1200 {
        step_tracked(&mut ships, &orders, &[], tick, &mut trails);
        let head = [ships[0].motion.x, ships[0].motion.z];
        if track.last().is_none_or(|p| gap(&ships[0], *p) > 10.0) {
            track.push(head);
        }
    }
    // The guide has completed its turn and run straight; the line must have
    // followed it round rather than cutting the corner.
    assert!(
        gap(&ships[0], [6000.0, -5000.0]) < 150.0,
        "guide failed its route"
    );
    for a in &ships[1..] {
        assert!(
            cross_track(&track, [a.motion.x, a.motion.z]) < 60.0,
            "{} left the guide's track by {} m",
            a.motion.id,
            cross_track(&track, [a.motion.x, a.motion.z])
        );
    }
    for pair in ships.windows(2) {
        let interval = gap(&pair[0], [pair[1].motion.x, pair[1].motion.z]);
        assert!(
            (interval - INTERVAL).abs() < INTERVAL * 0.15,
            "{} to {} interval {interval}",
            pair[0].motion.id,
            pair[1].motion.id
        );
    }
}

/// The side columns of a double column ride the same wake as the centre one, an
/// interval out on the beam, so the whole body turns in succession behind the
/// guide instead of swinging round it.
#[test]
fn a_double_column_rides_the_guides_wake_in_both_columns() {
    let followers = ["dd0", "dd1", "dd2"];
    let stations = formation_stations(
        Formation::DoubleColumn,
        ("guide", StationClass::Destroyer),
        &followers
            .iter()
            .map(|id| ((*id).into(), StationClass::Destroyer))
            .collect::<Vec<_>>(),
    );
    assert_eq!(
        stations.iter().map(|s| s.offset).collect::<Vec<_>>(),
        [[360.0, 0.0], [0.0, 360.0], [360.0, 360.0]],
        "the sailed stations are the table's own"
    );
    let mut ships = vec![ship("guide", "fletcher", 0.0, 0.0)];
    let mut orders = vec![route(vec![[0.0, -5000.0], [6000.0, -5000.0]])];
    for station in &stations {
        ships.push(ship(
            &station.id,
            "fletcher",
            station.offset[0],
            station.offset[1],
        ));
        orders.push(Movement::Escort {
            leader_id: "guide".into(),
            offset: station.offset,
            radius_m: 160.0,
            formation: Formation::DoubleColumn,
            slot: station.slot,
        });
    }
    for a in &mut ships {
        a.motion.speed = 12.0;
    }
    let mut trails = Trails::new();
    let mut track = vec![];
    let mut minimum_gap = f64::INFINITY;
    for tick in 0..60 * 1200 {
        step_tracked(&mut ships, &orders, &[], tick, &mut trails);
        if track.last().is_none_or(|p| gap(&ships[0], *p) > 10.0) {
            track.push([ships[0].motion.x, ships[0].motion.z]);
        }
        for (i, a) in ships.iter().enumerate() {
            for b in ships.iter().skip(i + 1) {
                minimum_gap = minimum_gap.min(gap(a, [b.motion.x, b.motion.z]));
            }
        }
    }
    assert!(
        gap(&ships[0], [6000.0, -5000.0]) < 150.0,
        "guide failed its route"
    );
    assert!(minimum_gap > 200.0, "unsafe column spacing: {minimum_gap}");
    // Each ship astern holds its own column's distance from the guide's track:
    // the port column on it, the starboard column one interval off it.
    for (a, station) in ships[1..].iter().zip(&stations) {
        let off_track = cross_track(&track, [a.motion.x, a.motion.z]);
        if station.offset[1] > 0.0 {
            assert!(
                (off_track - station.offset[0]).abs() < 90.0,
                "{} is {off_track} m off the wake, not {}",
                a.motion.id,
                station.offset[0]
            );
        }
    }
    for (a, order) in ships[1..].iter().zip(&orders[1..]) {
        let target = navigation::station_for(order, &ships[0], trails.get("guide"))
            .unwrap()
            .position;
        assert!(
            gap(a, target) < 200.0,
            "{} failed to reform: error {}, status {:?}",
            a.motion.id,
            gap(a, target),
            a.navigation.as_ref().unwrap().status
        );
    }
}

#[test]
fn a_screen_turns_together_on_its_axis_and_reforms_without_impossible_speed() {
    // The screen the deployment chart lays out, read from the shared table: the
    // cruiser takes the inner ring dead ahead, the destroyers the outer ring
    // ahead and on both quarters.
    let fleet = [
        ("cruiser", "baltimore"),
        ("dd0", "fletcher"),
        ("dd1", "fletcher"),
        ("dd2", "fletcher"),
    ];
    let mut ships = vec![ship("cv", "enterprise-cv6", 0.0, 0.0)];
    let mut orders = vec![route(vec![[0.0, -9000.0], [20000.0, -9000.0]])];
    let class = |preset: &str| StationClass::of(&content()[preset].definition);
    let stations = formation_stations(
        Formation::Screen,
        ("cv", class("enterprise-cv6")),
        &fleet
            .iter()
            .map(|(id, preset)| ((*id).into(), class(preset)))
            .collect::<Vec<_>>(),
    );
    assert_eq!(
        stations.iter().map(|s| s.offset).collect::<Vec<_>>(),
        [
            [0.0, -700.0],
            [0.0, -1300.0],
            [1126.0, 650.0],
            [-1126.0, 650.0]
        ],
        "the sailed screen is the table's own"
    );
    for (station, (id, preset)) in stations.iter().zip(&fleet) {
        assert_eq!(station.id, *id);
        ships.push(ship(id, preset, station.offset[0], station.offset[1]));
        orders.push(Movement::Escort {
            leader_id: "cv".into(),
            offset: station.offset,
            radius_m: 160.0,
            formation: Formation::Screen,
            slot: station.slot,
        });
    }
    for a in &mut ships {
        a.motion.speed = 12.0;
    }
    let mut trails = Trails::new();
    let mut steadied = 0;
    // Reorienting a screen is still a real physical manoeuvre: the outer slot
    // has to run most of a quarter circle of 1.3 km relative to the guide, and
    // the guide is held to its turn reserve while that station is swinging.
    let settle = 60 * 300;
    let run = 60 * 1500;
    for tick in 0..run {
        step_fleet(&mut ships, &orders, &[], tick, &mut trails, true);
        if steadied == 0
            && wrap_angle(ships[0].motion.heading - std::f64::consts::FRAC_PI_2).abs() < 0.02
        {
            steadied = tick;
        }
        for (a, order) in ships[1..].iter().zip(&orders[1..]) {
            assert!(
                a.motion.speed <= navigation::maximum_speed(a),
                "{} exceeded its maximum speed at tick {tick}: {}",
                a.motion.id,
                a.motion.speed
            );
            // Once the guide has steadied on the new course the whole screen is
            // back on its axis stations and stays there.
            if steadied > 0 && tick > steadied + settle {
                let station = navigation::station_for(order, &ships[0], trails.get("cv")).unwrap();
                assert!(
                    gap(a, station.position) < 200.0,
                    "{} is {} m off its axis station at tick {tick}",
                    a.motion.id,
                    gap(a, station.position)
                );
            }
        }
    }
    assert!(
        steadied > 0 && run - steadied > settle + 60 * 240,
        "not enough steady running after the turn: steadied at {steadied}"
    );
    // The axis has caught the guide's course, so the screen is oriented on it.
    let axis = trails["cv"].axis(ships[0].motion.heading);
    assert!(
        wrap_angle(axis - ships[0].motion.heading).abs() < 1e-3,
        "axis {axis} never caught the guide's heading {}",
        ships[0].motion.heading
    );
    for a in &ships[1..] {
        assert_eq!(
            a.navigation.as_ref().unwrap().status,
            NavigationStatus::OnStation,
            "{} is not on station",
            a.motion.id
        );
    }
}
