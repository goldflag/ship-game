//! Captain integration checks run the actual ship motion and authored handling.
//! Combat is omitted here so navigation failures cannot be masked by a sunk ship.
use naval_sim::{
    definition::ShipDefinition,
    environment::Island,
    motion::step_ship,
    navigation::{self, Movement, NavigationState, NavigationStatus},
    rules::TeamId,
    vessel::{CompiledShip, Vessel},
};
use std::{
    collections::BTreeMap,
    sync::{Arc, OnceLock},
};

fn content() -> &'static BTreeMap<&'static str, Arc<CompiledShip>> {
    static SHIPS: OnceLock<BTreeMap<&'static str, Arc<CompiledShip>>> = OnceLock::new();
    SHIPS.get_or_init(|| {
        ["enterprise-cv6", "fletcher"]
            .into_iter()
            .map(|id| {
                let bytes = std::fs::read(format!("../../public/models/{id}.json")).unwrap();
                let def: ShipDefinition = serde_json::from_slice(&bytes).unwrap();
                (id, Arc::new(CompiledShip::new(Arc::new(def)).unwrap()))
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
fn step(ships: &mut Vec<Vessel>, orders: &[Movement], islands: &[Island], tick: u64) {
    let mut commands = vec![];
    for (i, order) in orders.iter().enumerate().take(ships.len()) {
        let mut a = ships.remove(i);
        let mut state = a
            .navigation
            .take()
            .unwrap_or_else(|| NavigationState::new(order.clone()));
        let c = navigation::command(&a, ships, islands, order, &mut state, tick, 15.0);
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
        },
    ];
    let mut overtook_leader_speed = false;
    for tick in 0..60 * 600 {
        step(&mut ships, &orders, &[], tick);
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
        step(&mut ships, &orders[1..], &[], tick);
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
        });
    }
    let islands = vec![island("west", -1800.0, 0.0), island("east", 1800.0, 0.0)];
    let mut minimum_gap = f64::INFINITY;
    for tick in 0..60 * 1100 {
        step(&mut ships, &orders, &islands, tick);
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
    let (sin, cos) = leader.motion.heading.sin_cos();
    for (a, offset) in ships[1..].iter().zip(offsets) {
        let target = [
            leader.motion.x + offset[0] * cos - offset[1] * sin,
            leader.motion.z + offset[0] * sin + offset[1] * cos,
        ];
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
                    },
                    ..Default::default()
                },
            ),
        ]);
        // A healthy ship deployed far away does not manufacture a damage choice.
        ships[1].motion.z = 4000.0;
        assert!(
            navigation::formation_report(&ships[0], &ships[1..], &orders, policy)
                .stragglers
                .is_empty()
        );
        ships[1].motion.z = 350.0;
        damage_engines(&mut ships[1], 0.09);
        let report = navigation::formation_report(&ships[0], &ships[1..], &orders, policy);
        assert_eq!(report.stragglers.len(), 1);
        assert_eq!(report.stragglers[0].ship_id, "dd");
        for tick in 0..60 * 600 {
            let mut commands = vec![];
            for i in 0..2 {
                let mut a = ships.remove(i);
                let order = &orders[&a.motion.id];
                let limit =
                    navigation::formation_report(&a, &ships, &orders, policy).speed_limit_mps;
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
    let before =
        navigation::command_observed(&a, &[hidden], &[], &order, &mut state, 0, 12.0, Some(&[]));
    let mut state = NavigationState::new(order.clone());
    let after = navigation::command_observed(&a, &[], &[], &order, &mut state, 0, 12.0, Some(&[]));
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
            let normal = navigation::command(&a, &[], &[], &order, &mut state, tick, 12.0);
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
    assert!(gap(&ships[0], [3000.0, 0.0]) < 150.0,
        "outward route stalled: position=({}, {}), status={:?}",
        ships[0].motion.x, ships[0].motion.z, ships[0].navigation.as_ref().unwrap().status);
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
        assert!((a.motion.x / (650.0 * 1.22 + half_length))
            .hypot(a.motion.z / (1000.0 * 1.22 + half_length)) > 1.0,
            "recovery must preserve hull clearance at tick {tick}");
    }
    assert!(gap(&ships[0], [-3000.0, 0.0]) < 150.0, "did not complete recovery detour");
}

#[test]
fn shore_margin_recovery_never_relaxes_the_hull_or_destination_clearance() {
    let islands = vec![island("island", 0.0, 0.0)];
    for (from, to) in [(820.0, [3000.0, 0.0]), (950.0, [970.0, 300.0])] {
        let a = ship("dd", "fletcher", from, 0.0);
        let order = route(vec![to]);
        let mut state = NavigationState::new(order.clone());
        let command = navigation::command(&a, &[], &islands, &order, &mut state, 0, 15.0);
        assert_eq!(state.status, NavigationStatus::Blocked);
        assert_eq!(command.throttle, 0.0);
    }
}
