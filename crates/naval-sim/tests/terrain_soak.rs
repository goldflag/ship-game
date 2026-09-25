//! Eight bots a side fight on each real chart for several simulated minutes:
//! none may put its hull on the ground or end up stuck or circling in a bay.
//! `examples/terrain_soak.rs` runs the same soak longer, with other fleets.
//!
//! About 45 s of simulation, so it runs nightly (.github/workflows/soak.yml), not on every push:
//! `cargo test --profile ci-test -p naval-sim --test terrain_soak -- --ignored`, or
//! `bun run rust:test -- terrain_soak -- --ignored` after a change to navigation or bots.
#[path = "support/soak.rs"]
mod soak;
use naval_sim::{catalog::Catalog, vessel::CompiledShip};
use std::{
    collections::BTreeMap,
    sync::{Arc, OnceLock},
};

const FLEET: [&str; 8] = [
    "iowa",
    "bismarck",
    "baltimore",
    "baltimore",
    "fletcher",
    "fletcher",
    "fletcher",
    "fletcher",
];
type Content = (Arc<Catalog>, BTreeMap<String, Arc<CompiledShip>>);
fn content() -> &'static Content {
    static CONTENT: OnceLock<Content> = OnceLock::new();
    CONTENT.get_or_init(|| {
        let catalog = Catalog::installed();
        let compiled = FLEET
            .iter()
            .map(|id| (id.to_string(), Arc::new(catalog.compile(id).unwrap())))
            .collect();
        (catalog, compiled)
    })
}
fn soak(map: &str) {
    let (catalog, compiled) = content();
    // Online's spawn distance, and a long approach from the far ends of the lane.
    for (distance, seed) in [(5000.0, 11), (16000.0, 12)] {
        let report = soak::run(catalog, compiled, map, &FLEET, distance, 300, seed);
        eprintln!("{} at {distance} m", report.summary());
        assert!(report.aground().is_empty(), "{}", report.summary());
        assert!(report.stuck().is_empty(), "{}", report.summary());
    }
}
#[test]
#[ignore = "nightly soak; run with --ignored"]
fn bots_keep_off_the_coast_of_iron_bottom_sound() {
    soak("iron-bottom-sound");
}
#[test]
#[ignore = "nightly soak; run with --ignored"]
fn bots_keep_off_the_coast_of_vestfjord() {
    soak("vestfjord");
}
#[test]
#[ignore = "nightly soak; run with --ignored"]
fn bots_keep_off_the_coast_of_sunda_strait() {
    soak("sunda-strait");
}
#[test]
#[ignore = "nightly soak; run with --ignored"]
fn bots_keep_off_the_coast_of_the_strait_of_dover() {
    soak("strait-of-dover");
}
