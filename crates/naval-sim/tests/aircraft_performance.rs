use naval_sim::{
    aircraft::Aircraft,
    aircraft_flight::{FlightOptions, fly},
    aircraft_performance::performance_for,
    aviation::Aviation,
    catalog::Catalog,
    geometry::length,
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
fn carrier(id: &str, preset: &str, team: TeamId) -> Vessel {
    let mut a = Vessel::new(
        id,
        team,
        Arc::new(CompiledShip::new(catalog().definitions[preset].clone()).unwrap()),
    );
    a.controller = Controller::Player;
    a
}

fn plane(model: &str, role: &str) -> Aircraft {
    let actors = vec![carrier("carrier", "enterprise-cv6", TeamId::A)];
    let air = Aviation::new(&actors, catalog().aircraft.clone());
    let mut p = air.planes()[0].clone();
    p.model_id = model.into();
    p.role = role.into();
    p.phase = "outbound".into();
    p.position = [0.0, 850.0, 0.0];
    p.velocity = [0.0, 0.0, -60.0];
    p.heading = 0.0;
    p.pitch = 0.0;
    p.bank = 0.0;
    p.payload = false;
    p
}
fn flight(mut p: Aircraft, seconds: usize, climb: bool, turn: bool) -> (Aircraft, f64) {
    let mut swept = 0.0;
    for _ in 0..seconds * 60 {
        let heading = p.heading + if turn { 1.5 } else { 0.0 };
        let point = [
            p.position[0] + heading.sin() * 10000.0,
            p.position[1] + if climb { 10000.0 } else { 0.0 },
            p.position[2] - heading.cos() * 10000.0,
        ];
        let old = p.heading;
        fly(&mut p, point, 180.0, 1.0 / 60.0, FlightOptions::default());
        swept += naval_sim::geometry::wrap_angle(p.heading - old).abs();
        assert!(
            p.position
                .iter()
                .chain(p.velocity.iter())
                .all(|v| v.is_finite())
        );
        assert!(p.controls.aileron.abs() <= 0.35);
        assert!(p.controls.elevator.abs() <= 0.3);
        assert!(p.controls.rudder.abs() <= 0.16);
    }
    (p, swept)
}
#[test]
fn models_change_actual_acceleration_climb_sustained_turn_and_speed() {
    let wildcat = plane("f4f-4-wildcat", "fighter");
    let zero = plane("a6m2-zero", "fighter");
    assert!(
        length(flight(zero.clone(), 4, false, false).0.velocity)
            > length(flight(wildcat.clone(), 4, false, false).0.velocity) + 2.0
    );
    assert!(
        flight(zero.clone(), 30, true, false).0.position[1]
            > flight(wildcat.clone(), 30, true, false).0.position[1] + 70.0
    );
    assert!(
        flight(zero.clone(), 30, false, true).1 > flight(wildcat.clone(), 30, false, true).1 * 1.15
    );
    assert!(
        length(flight(zero, 60, false, false).0.velocity)
            > length(flight(wildcat, 60, false, false).0.velocity) + 5.0
    );
    for (a, b, role) in [
        ("sbd-3-dauntless", "d3a1-val", "dive-bomber"),
        ("tbd-1-devastator", "b5n2-kate", "torpedo-bomber"),
    ] {
        let a = plane(a, role);
        let b = plane(b, role);
        assert!(
            flight(b.clone(), 30, true, false).0.position[1]
                > flight(a.clone(), 30, true, false).0.position[1] + 30.0
        );
        assert!(flight(b, 30, false, true).1 > flight(a, 30, false, true).1 * 1.05);
    }
}
#[test]
fn stores_damage_and_maneuvers_cost_performance_and_release_restores_it() {
    let clean = plane("b5n2-kate", "torpedo-bomber");
    let mut loaded = clean.clone();
    loaded.payload = true;
    let mut damaged = loaded.clone();
    damaged.hp = 45.0;
    let clean_height = flight(clean.clone(), 30, true, false).0.position[1];
    let loaded_height = flight(loaded.clone(), 30, true, false).0.position[1];
    let damaged_height = flight(damaged, 30, true, false).0.position[1];
    assert!(clean_height > loaded_height + 30.0);
    assert!(loaded_height > damaged_height + 30.0);
    assert!(
        length(flight(clean.clone(), 8, false, false).0.velocity)
            > length(flight(clean.clone(), 8, true, true).0.velocity)
    );
    loaded.payload = false;
    assert_eq!(
        performance_for(&loaded).acceleration,
        performance_for(&clean).acceleration
    );
}
#[test]
fn roll_response_and_submaximum_cruise_vary_but_recovery_speeds_remain_prescribed() {
    let mut w = plane("f4f-4-wildcat", "fighter");
    let mut z = plane("a6m2-zero", "fighter");
    for p in [&mut w, &mut z] {
        fly(
            p,
            [10000.0, 850.0, 0.0],
            90.0,
            0.25,
            FlightOptions::default(),
        );
    }
    assert!(w.bank.abs() > z.bank.abs());
    for _ in 0..1800 {
        for p in [&mut w, &mut z] {
            let point = [p.position[0], p.position[1], p.position[2] - 10000.0];
            p.heading = 0.0;
            p.bank = 0.0;
            fly(p, point, 90.0, 1.0 / 60.0, FlightOptions::default());
        }
    }
    assert!(length(z.velocity) > length(w.velocity) + 2.0);
    for _ in 0..1800 {
        for p in [&mut w, &mut z] {
            let point = [p.position[0], p.position[1], p.position[2] - 10000.0];
            fly(
                p,
                point,
                55.0,
                1.0 / 60.0,
                FlightOptions {
                    landing: true,
                    ..Default::default()
                },
            );
        }
    }
    assert!((length(z.velocity) - 55.0).abs() < 0.01);
    assert!((length(w.velocity) - 55.0).abs() < 0.01);
    let fallback = performance_for(&plane("future-airframe", "fighter"));
    assert_eq!(fallback.acceleration, 7.0);
}

#[test]
fn dive_brakes_remain_cpu_driven_and_strike_error_replays_by_seed_and_pass() {
    use naval_sim::{aircraft_accuracy::strike_aim_error, aircraft_flight::step_mechanisms};
    let mut p = plane("sbd-3-dauntless", "dive-bomber");
    p.phase = "attack".into();
    p.pitch = -0.6;
    p.payload = true;
    for _ in 0..120 {
        step_mechanisms(&mut p, 1.0 / 60.0, false);
    }
    assert_eq!(p.controls.brakes, 1.0);
    let error = strike_aim_error(&p, 0.7, 1234, 1);
    assert_eq!(error, strike_aim_error(&p, 0.7, 1234, 1));
    assert_ne!(error, strike_aim_error(&p, 0.7, 4321, 1));
    assert_ne!(error, strike_aim_error(&p, 0.7, 1234, 2));
    p.payload = false;
    for _ in 0..120 {
        step_mechanisms(&mut p, 1.0 / 60.0, false);
    }
    assert_eq!(p.controls.brakes, 0.0);
}
