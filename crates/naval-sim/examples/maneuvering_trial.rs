//! cargo run --release -p naval-sim --example maneuvering_trial -- public/models/fletcher.json
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
            ("turn", 1., 1., d.handling.forward_speed),
            ("coast", 0., 0., d.handling.forward_speed),
            ("crash-stop", -1., 0., d.handling.forward_speed),
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
            for _ in 0..180 * 60 {
                maneuvering::step(&mut a, &d, &model, black_box(command), None);
            }
            results.push(serde_json::json!({"scenario":name,"speed":a.motion.speed,"yawRate":a.motion.yaw_rate,"position":[a.motion.x,a.motion.z],"microsecondsPerShipTick":start.elapsed().as_secs_f64()*1e6/(180.*60.)}));
        }
        println!(
            "{}",
            serde_json::json!({"ship":d.id,"prepareMs":compile_ms,"estimatedSpeed":model.estimated_speed,"powerKw":model.power_w/1000.,"wettedAreaM2":model.resistance.wetted_area,"fullness":model.resistance.fullness,"trials":results})
        );
    }
}
