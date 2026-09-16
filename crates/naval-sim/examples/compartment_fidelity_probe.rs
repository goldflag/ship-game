//! Compare an unpublished compartment candidate with the published reference.
use naval_sim::{
    construction_geometry as cg, definition::ShipDefinition, floodwater::water_body, geometry::*,
};
use std::time::Instant;
fn main() {
    let args: Vec<_> = std::env::args().collect();
    let read = |path: &str| -> ShipDefinition {
        serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
    };
    let reference = read(&args[1]);
    let candidate = read(&args[2]);
    assert_eq!(reference.compartments.len(), candidate.compartments.len());
    let mut old_fields = serde_json::to_value(&reference).unwrap();
    let mut new_fields = serde_json::to_value(&candidate).unwrap();
    for value in [&mut old_fields, &mut new_fields] {
        for room in value["compartments"].as_array_mut().unwrap() {
            room.as_object_mut().unwrap().remove("volumes");
        }
    }
    assert_eq!(
        old_fields, new_fields,
        "Only compartment volume geometry may change"
    );
    let mut results = vec![];
    let mut timings = [vec![], vec![]];
    for (index, (a, b)) in reference
        .compartments
        .iter()
        .zip(&candidate.compartments)
        .enumerate()
    {
        let mut worst_volume = 0_f64;
        let mut worst_center = 0_f64;
        let mut worst_level = 0_f64;
        let mut worst_area = 0_f64;
        let mut worst_area_relative = 0_f64;
        for (roll, pitch) in [
            (0., 0.),
            (radians(15.), radians(3.)),
            (radians(-35.), radians(-7.)),
            (radians(90.), 0.),
            (radians(170.), radians(10.)),
        ] {
            for fraction in [0., 0.1, 0.5, 0.9, 1.] {
                let now = Instant::now();
                let x = water_body(a, a.capacity_m3 * fraction, roll, pitch);
                timings[0].push(now.elapsed().as_secs_f64() * 1000.);
                let now = Instant::now();
                let y = water_body(b, b.capacity_m3 * fraction, roll, pitch);
                timings[1].push(now.elapsed().as_secs_f64() * 1000.);
                worst_level = worst_level.max((x.level - y.level).abs());
                if fraction > 0. {
                    worst_center = worst_center.max(length(sub(x.center, y.center)));
                }
                worst_area = worst_area.max((x.area - y.area).abs());
                if x.area > 1. {
                    worst_area_relative = worst_area_relative.max((x.area - y.area).abs() / x.area);
                }
            }
            let n = [
                roll.sin() * pitch.cos(),
                roll.cos() * pitch.cos(),
                -pitch.sin(),
            ];
            let (lo, hi) = a
                .volumes
                .as_ref()
                .unwrap()
                .iter()
                .flat_map(|c| c.faces.iter().flat_map(|f| f.vertices.iter()))
                .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), p| {
                    let d = dot(*p, n);
                    (lo.min(d), hi.max(d))
                });
            for fraction in [0.1, 0.5, 0.9] {
                let d = lo + (hi - lo) * fraction;
                worst_volume = worst_volume.max(
                    (cg::submerged(a.volumes.as_ref().unwrap(), n, d).volume
                        - cg::submerged(b.volumes.as_ref().unwrap(), n, d).volume)
                        .abs(),
                );
            }
        }
        let row = serde_json::json!({"roomIndex":index,"id":a.id,"capacityM3":a.capacity_m3,"maxSubmergedVolumeErrorM3":worst_volume,"maxWaterLevelErrorM":worst_level,"maxWaterCenterErrorM":worst_center,"maxSurfaceAreaErrorM2":worst_area,"maxSurfaceAreaRelativeError":worst_area_relative});
        eprintln!(
            "room {index}: level {worst_level:.6}m, center {worst_center:.6}m, volume {worst_volume:.6}m³"
        );
        results.push(row);
    }
    // Ports are gameplay-relevant damage/flood connection positions; avoid an
    // arbitrary random sample that could miss narrow or adjoining spaces.
    let positions: Vec<_> = reference
        .connections
        .iter()
        .filter_map(|c| c.position)
        .step_by(31)
        .collect();
    let mut changed = 0;
    let mut max_distance_error = 0_f64;
    for p in &positions {
        let nearest = |d: &ShipDefinition| {
            d.compartments
                .iter()
                .enumerate()
                .map(|(i, c)| (i, cg::room_distance(c, *p)))
                .min_by(|a, b| a.1.total_cmp(&b.1))
                .unwrap()
        };
        let a = nearest(&reference);
        let b = nearest(&candidate);
        changed += usize::from(a.0 != b.0);
        max_distance_error = max_distance_error.max((a.1 - b.1).abs());
    }
    let timing = |mut t: Vec<f64>| {
        t.sort_by(f64::total_cmp);
        serde_json::json!({"samples":t.len(),"totalMs":t.iter().sum::<f64>(),"p50Ms":t[t.len()/2],"p95Ms":t[t.len()*95/100],"p99Ms":t[t.len()*99/100],"maxMs":t.last()})
    };
    println!(
        "{}",
        serde_json::json!({"rooms":results,"timingBefore":timing(timings[0].clone()),"timingAfter":timing(timings[1].clone()),"nearestRoomSamples":positions.len(),"nearestRoomChanged":changed,"maxNearestDistanceErrorM":max_distance_error,"conditions":"Five attitudes including capsize/inversion, five fill fractions; exact CPU water solver; shared machine"})
    );
}
