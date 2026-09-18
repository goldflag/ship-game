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
fn fleet_acceleration_and_crash_stops_retain_inertia() {
    for (id, cruise_range, stop_range) in [
        ("fletcher", (9., 14.), (11., 17.)),
        ("bismarck", (55., 75.), (50., 70.)),
        ("valiant", (35., 50.), (32., 45.)),
        ("resolute", (40., 55.), (38., 53.)),
        ("type-viic", (9., 14.), (9., 14.)),
    ] {
        let mut a = ship(id);
        let speed = a.compiled.maneuvering.estimated_speed;
        for (throttle, range) in [(1., cruise_range), (-1., stop_range)] {
            a.motion.speed = if throttle > 0. { 0. } else { speed };
            let mut elapsed = 0.;
            while elapsed < range.1 {
                step(&mut a, throttle, 0.);
                elapsed += DT;
                if (throttle > 0. && a.motion.speed >= speed * 0.9)
                    || (throttle < 0. && a.motion.speed <= 0.)
                {
                    break;
                }
            }
            assert!(
                elapsed >= range.0 && elapsed < range.1,
                "{id}: throttle {throttle} took {elapsed}s, expected {}–{}s",
                range.0,
                range.1
            );
        }
    }
}

#[test]
fn fleet_can_change_course_and_countersteer_during_a_fight() {
    for (id, min_seconds, turn_seconds) in [
        ("fletcher", 15., 22.),
        ("bismarck", 50., 65.),
        ("valiant", 120., 160.),
        ("resolute", 65., 90.),
        ("type-viic", 22., 30.),
    ] {
        for direction in [-1., 1.] {
            let mut a = ship(id);
            let speed = a.compiled.maneuvering.estimated_speed;
            a.motion.speed = speed;
            let mut angle = 0.;
            let mut elapsed = 0.;
            for _ in 0..(turn_seconds / DT) as usize {
                let old = a.motion.heading;
                step(&mut a, 1., direction);
                angle += wrap_angle(a.motion.heading - old) * direction;
                elapsed += DT;
                if angle >= std::f64::consts::FRAC_PI_2 {
                    break;
                }
            }
            assert!(
                angle >= std::f64::consts::FRAC_PI_2 && elapsed >= min_seconds,
                "{id}: turned {} degrees in {elapsed}s; expected {min_seconds}–{turn_seconds}s",
                angle.to_degrees()
            );
            assert!(
                a.motion.speed > speed * 0.4,
                "{id}: hard turn stalled the ship"
            );
            for _ in 0..(16. / DT) as usize {
                step(&mut a, 1., -direction);
            }
            assert!(
                a.motion.yaw_rate * direction < 0.,
                "{id}: failed to countersteer within 16s"
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
