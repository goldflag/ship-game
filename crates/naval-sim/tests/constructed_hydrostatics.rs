//! Fast tetrahedral moments must match the original clipped authored hull,
//! including inversion, nearly coincident waterline vertices and weighted cells.
use naval_sim::{catalog::Catalog, hydrostatics::HullHydrostatics};

#[test]
fn constructed_buoyancy_matches_clipped_hulls_through_the_waterline() {
    let catalog =
        Catalog::load(&std::fs::read("../../.build/naval-content/manifest.json").unwrap()).unwrap();
    for id in ["valiant", "resolute"] {
        let def = &catalog.definitions[id];
        assert!(def.hull.volume.is_some());
        let hydro = HullHydrostatics::new(&def.hull, None);
        let full = hydro.full_volume();
        for (roll, pitch) in [
            (0., 0.),
            (1e-12, -1e-12),
            (0.2, 0.05),
            (-0.5, -0.12),
            (1.57, 0.),
            (3., 0.4),
        ] {
            for fraction in [0.001, 0.1, 0.25, 0.5, 0.75, 0.95, 0.999] {
                let flotation = hydro.flotation(full * fraction, roll, pitch);
                let exact = hydro.mesh_sample(flotation.y, roll, pitch);
                let fast = hydro.sample(flotation.y, roll, pitch);
                assert!(
                    (fast.volume - exact.volume).abs() < full * 1e-8,
                    "{id} {roll} {pitch} {fraction}"
                );
                for axis in 0..3 {
                    assert!(
                        (fast.center[axis] - exact.center[axis]).abs() < 1e-5,
                        "{id} {roll} {pitch} {fraction}: {:?} vs {:?}",
                        fast.center,
                        exact.center
                    );
                    assert!((flotation.center[axis] - fast.center[axis]).abs() < 1e-8);
                }
            }
        }
    }
}
