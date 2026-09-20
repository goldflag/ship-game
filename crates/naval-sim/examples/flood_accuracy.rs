//! Compare runtime flooding geometry with the exact authoring model.
//! cargo run --profile test-fast -p naval-sim --example flood_accuracy -- definition.json
use naval_sim::{
    definition::ShipDefinition,
    floodwater::{Scratch, refresh, refresh_runtime, water_body, water_body_runtime},
};
use std::time::Instant;

fn main() {
    let path = std::env::args().nth(1).expect("definition JSON path");
    let json: serde_json::Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    let def: ShipDefinition =
        serde_json::from_value(json.get("definition").unwrap_or(&json).clone()).unwrap();
    let mut rooms = Vec::new();
    for room in &def.compartments {
        let mut exact = water_body(room, 0., 0., 0.);
        let started = Instant::now();
        let mut runtime = water_body_runtime(room, 0., 0., 0.);
        let prepare_ms = started.elapsed().as_secs_f64() * 1000.;
        let mut exact_scratch = Scratch::default();
        let mut runtime_scratch = Scratch::default();
        let (mut exact_ms, mut runtime_ms) = (0., 0.);
        let mut levels = Vec::new();
        let mut centers = Vec::new();
        let mut sample_count = 0;
        let mut samples = Vec::new();
        for (roll, pitch) in [
            (0., 0.),
            (0.1, 0.02),
            (-0.25, -0.05),
            (0.5, 0.1),
            (1.2, -0.3),
            (3.0, 0.2),
        ] {
            for fill in [0.001, 0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 0.95, 1.] {
                let volume = room.capacity_m3 * fill;
                let start = Instant::now();
                refresh(&mut exact, room, volume, roll, pitch, &mut exact_scratch);
                exact_ms += start.elapsed().as_secs_f64() * 1000.;
                let start = Instant::now();
                refresh_runtime(
                    &mut runtime,
                    room,
                    volume,
                    roll,
                    pitch,
                    &mut runtime_scratch,
                );
                runtime_ms += start.elapsed().as_secs_f64() * 1000.;
                assert!(runtime.level.is_finite());
                assert!(runtime.center.iter().all(|c| c.is_finite()));
                assert_eq!(exact.volume, runtime.volume);
                levels.push((runtime.level - exact.level).abs());
                centers.push(naval_sim::geometry::length(naval_sim::geometry::sub(
                    runtime.center,
                    exact.center,
                )));
                samples.push(serde_json::json!({"roll":roll,"pitch":pitch,"fill":fill,
                    "levelErrorM":levels.last(),"centerErrorM":centers.last(),
                    "shipCenterErrorM":centers.last().unwrap() * volume * 1025. /
                        (def.hull.mass_kg + volume * 1025.)}));
                sample_count += 1;
            }
        }
        levels.sort_by(f64::total_cmp);
        centers.sort_by(f64::total_cmp);
        rooms.push(serde_json::json!({
            "id": room.id, "capacityM3": room.capacity_m3,
            "fragments": room.volumes.as_ref().map_or(0, Vec::len), "samples": sample_count,
            "prepareMs": prepare_ms, "exactMs": exact_ms, "runtimeMs": runtime_ms,
            "levelMedianM": levels[levels.len()/2], "levelMaxM": levels.last(),
            "centerMedianM": centers[centers.len()/2], "centerMaxM": centers.last(),
            "cases": samples,
        }));
    }
    println!("{}", serde_json::to_string_pretty(&rooms).unwrap());
}
