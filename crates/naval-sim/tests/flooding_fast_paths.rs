//! The flooding fast paths must be bit-exact, not merely close: a dry
//! compartment's lazily built shape has to equal the eager build, and the fully
//! immersed hydrostatic sample has to be independent of roll and pitch.
use naval_sim::{catalog::Catalog, floodwater::water_body, hydrostatics::HullHydrostatics};
fn catalog() -> Catalog {
    let bytes = std::fs::read("../../.build/naval-content/manifest.json")
        .expect("Run bun run multiplayer:content first");
    Catalog::load(&bytes).unwrap()
}
const ATTITUDES: [(f64, f64); 6] = [
    (0.0, 0.0),
    (0.21, -0.013),
    (-0.37, 0.08),
    (1.2, -0.4),
    (-2.9, 0.55),
    (0.004, 0.0007),
];
#[test]
fn a_dry_body_reports_the_same_levels_as_a_flooded_one() {
    let catalog = catalog();
    for (id, def) in &catalog.definitions {
        if def.stability.is_none() {
            continue;
        }
        for (roll, pitch) in ATTITUDES {
            for room in &def.compartments {
                let dry = water_body(room, 0.0, roll, pitch);
                let eager = water_body(room, room.capacity_m3 * 1e-9, roll, pitch);
                // The fast path derives level and area without building the
                // column list; both must match the full build exactly.
                let floor = eager.level_at_volume(room, 0.0);
                let ceiling = eager.level_at_volume(room, room.capacity_m3);
                assert_eq!(dry.level.to_bits(), floor.to_bits(), "{id} {}", room.id);
                assert_eq!(
                    dry.area.to_bits(),
                    (room.capacity_m3 / (ceiling - floor)).to_bits(),
                    "{id} {}",
                    room.id
                );
                for fill in [0.13, 0.5, 0.87, 1.0] {
                    let volume = room.capacity_m3 * fill;
                    assert_eq!(
                        dry.level_at_volume(room, volume).to_bits(),
                        eager.level_at_volume(room, volume).to_bits(),
                        "{id} {} at {fill}",
                        room.id
                    );
                }
            }
        }
    }
}
#[test]
fn an_unchanged_rebuild_leaves_a_body_identical() {
    let catalog = catalog();
    for def in catalog.definitions.values() {
        for room in &def.compartments {
            for fill in [0.0, 0.42] {
                let volume = room.capacity_m3 * fill;
                let a = water_body(room, volume, 0.21, -0.013);
                let b = water_body(room, volume, 0.21, -0.013);
                assert_eq!(a.level.to_bits(), b.level.to_bits());
                assert_eq!(a.area.to_bits(), b.area.to_bits());
                assert_eq!(a.center[1].to_bits(), b.center[1].to_bits());
            }
        }
    }
}
#[test]
fn the_fully_immersed_sample_does_not_depend_on_attitude() {
    let catalog = catalog();
    for (id, def) in &catalog.definitions {
        let hull = &def.hull;
        let hydro = HullHydrostatics::new(hull);
        let bound = hull.length + hull.beam + hull.draft + hull.depth;
        let full = hydro.sample(-bound, 0.0, 0.0);
        assert_eq!(full.volume.to_bits(), hydro.full_volume().to_bits(), "{id}");
        for (roll, pitch) in ATTITUDES {
            let sample = hydro.sample(-bound, roll, pitch);
            assert_eq!(sample.volume.to_bits(), full.volume.to_bits(), "{id}");
            for axis in 0..3 {
                assert_eq!(
                    sample.center[axis].to_bits(),
                    full.center[axis].to_bits(),
                    "{id} axis {axis}"
                );
            }
        }
    }
}
