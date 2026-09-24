//! Soak omniscient bots against the real charts and report hulls that touch the
//! ground or stay stuck or circling (the `terrain_soak` test's harness, longer):
//!
//! ```sh
//! cargo run --release -p naval-sim --example terrain_soak -- [seconds] [spawn m] [seeds] [map ...]
//! NAVAL_SOAK_FLEET=enterprise-cv6,bismarck,... cargo run --release -p naval-sim --example terrain_soak
//! ```
//!
//! Defaults: 600 s, 5000 m, seeds 1..=3, every map with land, and eight surface
//! ships a side. Exits non-zero when any hull grounded or got stuck.
#[path = "../tests/support/soak.rs"]
mod soak;
use naval_sim::catalog::Catalog;
use std::sync::Arc;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let seconds: u64 = args.first().map_or(600, |s| s.parse().expect("seconds"));
    let distance: f64 = args
        .get(1)
        .map_or(5000.0, |s| s.parse().expect("spawn distance"));
    let seeds: u32 = args.get(2).map_or(3, |s| s.parse().expect("seed count"));
    let catalog = Catalog::installed();
    let maps: Vec<String> = if args.len() > 3 {
        args[3..].to_vec()
    } else {
        catalog
            .map_ids()
            .unwrap()
            .into_iter()
            .filter(|m| catalog.map_terrain(m).unwrap().is_some())
            .collect()
    };
    let fleet_text = std::env::var("NAVAL_SOAK_FLEET").unwrap_or_else(|_| {
        "iowa,bismarck,baltimore,baltimore,fletcher,fletcher,fletcher,fletcher".into()
    });
    let fleet: Vec<&str> = fleet_text.split(',').collect();
    let compiled = fleet
        .iter()
        .map(|id| (id.to_string(), Arc::new(catalog.compile(id).unwrap())))
        .collect();
    let mut failed = false;
    for map in &maps {
        for seed in 1..=seeds {
            let started = std::time::Instant::now();
            let report = soak::run(&catalog, &compiled, map, &fleet, distance, seconds, seed);
            println!(
                "seed {seed}: {} [{:.1} s wall]",
                report.summary(),
                started.elapsed().as_secs_f64()
            );
            failed |= !report.aground().is_empty() || !report.stuck().is_empty();
        }
    }
    std::process::exit(failed as i32);
}
