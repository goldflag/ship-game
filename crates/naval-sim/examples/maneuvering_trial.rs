//! `bun run ship:trial <id> [--vs [ref]]` runs this on any preset and prints a table (docs/maneuvering.md).
//! cargo run --profile test-fast -p naval-sim --example maneuvering_trial -- public/models/fletcher.json (--release for timing)
//! Isolates movement CPU cost; hull compilation and flooding solves are timed separately elsewhere.
use naval_sim::{
    damage::Combatant,
    definition::ShipDefinition,
    maneuvering::{self, Maneuvering},
    motion::HelmCommand,
};
use std::{hint::black_box, time::Instant};
fn main() {
    for path in std::env::args().skip(1) {
        let d: ShipDefinition = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        let start = Instant::now();
        let model = Maneuvering::new(&d);
        let compile_ms = start.elapsed().as_secs_f64() * 1000.;
        let mut results = vec![];
        for (name, throttle, rudder, speed) in [
            ("ahead", 1., 0., 0.),
            ("half", 0.5, 0., 0.),
            ("turn", 1., 1., model.estimated_speed),
            ("coast", 0., 0., model.estimated_speed),
            ("crash-stop", -1., 0., model.estimated_speed),
        ] {
            let mut a = Combatant::new("trial", &d);
            if let Some(l) = &d.loading {
                a.motion.y = -l.waterline_y;
            }
            a.motion.speed = speed;
            let command = HelmCommand {
                throttle,
                rudder,
                ..Default::default()
            };
            let start = Instant::now();
            let mut heading_change = 0.;
            let mut seconds_to_half_speed = None;
            let mut seconds_to_cruise = None;
            let mut seconds_to_quarter_turn = None;
            let mut seconds_to_stop = None;
            let mut samples = vec![];
            for tick in 1..=180 * 60 {
                let old_heading = a.motion.heading;
                maneuvering::step(&mut a, &d, &model, black_box(command), None);
                heading_change += naval_sim::geometry::wrap_angle(a.motion.heading - old_heading);
                let seconds = tick as f64 / 60.;
                if speed == 0. && a.motion.speed >= model.estimated_speed * 0.5 {
                    seconds_to_half_speed.get_or_insert(seconds);
                }
                if speed == 0. && a.motion.speed >= model.estimated_speed * 0.9 {
                    seconds_to_cruise.get_or_insert(seconds);
                }
                if heading_change.abs() >= std::f64::consts::FRAC_PI_2 {
                    seconds_to_quarter_turn.get_or_insert(seconds);
                }
                if speed > 0. && a.motion.speed <= 0. {
                    seconds_to_stop.get_or_insert(seconds);
                }
                if [10 * 60, 30 * 60, 60 * 60].contains(&tick) {
                    samples.push(serde_json::json!({"seconds":seconds,"speed":a.motion.speed,"headingChangeDeg":heading_change.to_degrees()}));
                }
            }
            results.push(serde_json::json!({"scenario":name,"speed":a.motion.speed,"yawRate":a.motion.yaw_rate,"position":[a.motion.x,a.motion.z],"secondsToHalfSpeed":seconds_to_half_speed,"secondsTo90PercentSpeed":seconds_to_cruise,"secondsTo90DegreeTurn":seconds_to_quarter_turn,"secondsToStop":seconds_to_stop,"samples":samples,"microsecondsPerShipTick":start.elapsed().as_secs_f64()*1e6/(180.*60.)}));
        }
        println!(
            "{}",
            serde_json::json!({"ship":d.id,"prepareMs":compile_ms,"estimatedSpeed":model.estimated_speed,"powerKw":model.power_w/1000.,"wettedAreaM2":model.resistance.wetted_area,"fullness":model.resistance.fullness,"trials":results})
        );
    }
}
