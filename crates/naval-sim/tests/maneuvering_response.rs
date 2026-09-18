//! Player-scale response budgets, through the same movement entry point as battles.
use naval_sim::{
    definition::ShipDefinition,
    geometry::wrap_angle,
    motion::{HelmCommand, step_ship},
    rules::{DT, TeamId},
    vessel::{CompiledShip, Vessel},
};
use std::{
    collections::BTreeMap,
    sync::{Arc, OnceLock},
};

fn ship(id: &'static str) -> Vessel {
    static CONTENT: OnceLock<BTreeMap<&'static str, Arc<CompiledShip>>> = OnceLock::new();
    let content = CONTENT.get_or_init(|| {
        ["fletcher", "bismarck", "valiant", "resolute", "type-viic"]
            .into_iter()
            .map(|id| {
                let bytes = std::fs::read(format!("../../public/models/{id}.json")).unwrap();
                let definition: ShipDefinition = serde_json::from_slice(&bytes).unwrap();
                (
                    id,
                    Arc::new(CompiledShip::new(Arc::new(definition), None).unwrap()),
                )
            })
            .collect()
    });
    Vessel::new("player", TeamId::A, content[id].clone())
}

fn step(a: &mut Vessel, throttle: f64, rudder: f64) {
    step_ship(
        a,
        HelmCommand {
            throttle,
            rudder,
            ..Default::default()
        },
        None,
    );
}

#[test]
fn fleet_gets_underway_and_can_crash_stop_within_seconds() {
    for (id, cruise_seconds, stop_seconds) in [
        ("fletcher", 10., 12.),
        ("bismarck", 45., 40.),
        ("valiant", 30., 27.),
        ("resolute", 35., 32.),
        ("type-viic", 10., 10.),
    ] {
        let mut a = ship(id);
        let speed = a.compiled.maneuvering.estimated_speed;
        for _ in 0..(cruise_seconds / DT) as usize {
            step(&mut a, 1., 0.);
        }
        assert!(
            a.motion.speed >= speed * 0.9,
            "{id}: only {} of {speed} m/s after {cruise_seconds}s",
            a.motion.speed
        );

        // Start at full speed so this also bounds braking after a long straight run.
        a.motion.speed = speed;
        for _ in 0..(stop_seconds / DT) as usize {
            step(&mut a, -1., 0.);
        }
        assert!(
            a.motion.speed < 0.,
            "{id}: still moving ahead at {} m/s after {stop_seconds}s astern",
            a.motion.speed
        );
    }
}

#[test]
fn fleet_can_change_course_and_countersteer_during_a_fight() {
    for (id, turn_seconds) in [
        ("fletcher", 18.),
        ("bismarck", 50.),
        ("valiant", 80.),
        ("resolute", 48.),
        ("type-viic", 24.),
    ] {
        for direction in [-1., 1.] {
            let mut a = ship(id);
            let speed = a.compiled.maneuvering.estimated_speed;
            a.motion.speed = speed;
            let mut angle = 0.;
            for _ in 0..(turn_seconds / DT) as usize {
                let old = a.motion.heading;
                step(&mut a, 1., direction);
                angle += wrap_angle(a.motion.heading - old) * direction;
            }
            assert!(
                angle >= std::f64::consts::FRAC_PI_2,
                "{id}: turned only {} degrees in {turn_seconds}s",
                angle.to_degrees()
            );
            assert!(
                a.motion.speed > speed * 0.4,
                "{id}: hard turn stalled the ship"
            );
            for _ in 0..(10. / DT) as usize {
                step(&mut a, 1., -direction);
            }
            assert!(
                a.motion.yaw_rate * direction < 0.,
                "{id}: failed to countersteer within 10s"
            );
        }
    }
}

#[test]
fn response_tuning_preserves_top_speed_and_navigation_braking_estimate() {
    for id in ["fletcher", "bismarck", "valiant", "resolute", "type-viic"] {
        let mut a = ship(id);
        let model = &a.compiled.maneuvering;
        let speed = model.estimated_speed;
        let braking = model.braking_acceleration(speed, 1., a.motion_mass.mass);
        a.motion.speed = speed;
        step(&mut a, -1., 0.);
        let measured = (speed - a.motion.speed) / DT;
        assert!(
            (measured / braking - 1.).abs() < 0.02,
            "{id}: navigation expects {braking}, actual braking is {measured}"
        );
        for _ in 0..(180. / DT) as usize {
            step(&mut a, 1., 0.);
        }
        assert!(
            (a.motion.speed / speed - 1.).abs() < 0.01,
            "{id}: top speed changed to {} from {speed}",
            a.motion.speed
        );
    }
}
