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
