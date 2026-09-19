//! Native diagnostic entry for the same source/catalog JSON accepted by WASM.
fn main() {
    let args: Vec<_> = std::env::args().collect();
    assert!(
        (3..=4).contains(&args.len()) || (args.len() == 5 && args[3] == "--suggest"),
        "usage: compile_construction source.json catalog.json [measurement_iterations | --suggest parts.json]"
    );
    let source = std::fs::read_to_string(&args[1]).expect("source");
    let catalog = std::fs::read_to_string(&args[2]).expect("catalog");
    if args.len() == 5 {
        let parts = std::fs::read_to_string(&args[4]).expect("part IDs");
        println!(
            "{}",
            naval_sim::construction::suggest_json(&source, &catalog, &parts).expect("valid JSON")
        );
        return;
    }
    if args.len() == 3 {
        println!(
            "{}",
            naval_sim::construction::compile_json(&source, &catalog).expect("valid JSON")
        );
        return;
    }
    let source = serde_json::from_str(&source).unwrap();
    let catalog = serde_json::from_str(&catalog).unwrap();
    let count: usize = args[3].parse().unwrap();
    assert!((1..=100).contains(&count));
    let mut times = vec![];
    let mut result = None;
    for _ in 0..count {
        let start = std::time::Instant::now();
        result = Some(naval_sim::construction::compile(&source, &catalog));
        times.push(start.elapsed().as_secs_f64() * 1000.);
    }
    times.sort_by(f64::total_cmp);
    let result = result.unwrap();
    eprintln!(
        "compile median_ms={:.3} max_ms={:.3} iterations={count}",
        times[count / 2],
        times[count - 1]
    );
    if let Some(d) = &result.definition {
        let hydro = naval_sim::hydrostatics::HullHydrostatics::new(&d.hull, None);
        let start = std::time::Instant::now();
        for i in 0..100 {
            std::hint::black_box(hydro.flotation(d.hull.mass_kg / 1025., i as f64 * 0.003, -0.01));
        }
        let flotation = start.elapsed().as_secs_f64() * 10.;
        let start = std::time::Instant::now();
        for i in 0..100 {
            for room in &d.compartments {
                std::hint::black_box(naval_sim::floodwater::water_body(
                    room,
                    room.capacity_m3 * 0.4,
                    i as f64 * 0.003,
                    -0.01,
                ));
            }
        }
        eprintln!(
            "hull_cells={} void_cells={} rooms={} flotation_mean_ms={flotation:.3} all_room_water_solve_mean_ms={:.3}",
            d.hull.volume.as_ref().unwrap().cells.len(),
            d.compartments
                .iter()
                .map(|r| r.volumes.as_ref().unwrap().len())
                .sum::<usize>(),
            d.compartments.len(),
            start.elapsed().as_secs_f64() * 10.
        );
    }
    println!("{}", naval_sim::construction::to_json(&result).unwrap());
}
