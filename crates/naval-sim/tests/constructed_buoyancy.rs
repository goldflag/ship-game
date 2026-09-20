//! Cached displacement must remain valid through capsize and sinking, without
//! assuming a symmetric hull or a limited range of heel, trim, or loading.
use naval_sim::{
    construction_geometry as cg,
    definition::{ConstructionGeometry, Hull},
    geometry::normalize,
    hydrostatics::HullHydrostatics,
};
use std::f64::consts::{FRAC_PI_2, PI};

fn hull(asymmetric: bool) -> Hull {
    let mut cells = vec![cg::box_cell([0.; 3], [20., 12., 80.])];
    if asymmetric {
        cells.push(
            cg::clip(
                &cg::box_cell([17., 2., -13.], [14., 7., 26.]),
                normalize([1., 0.2, -0.3]),
                18.,
            )
            .unwrap(),
        );
        cells.push(cg::box_cell([-18., 3., 25.], [7., 1., 30.]));
    }
    Hull {
        length: 80.,
        beam: 48.,
        draft: 6.,
        depth: 6.,
        half_breadths: vec![[0., 10.], [80., 10.]],
        deck_heights: vec![[0., 6.], [80., 6.]],
        keel_heights: vec![[0., -6.], [80., -6.]],
        waterplane_area_m2: 1600.,
        volume: Some(ConstructionGeometry {
            version: 1.,
            cells,
            surfaces: vec![],
        }),
        ..Default::default()
    }
}

#[test]
fn cached_flotation_matches_exact_mesh_through_capsize_and_sinking() {
    let hydro = HullHydrostatics::new(&hull(true), None);
    let mut worst_y: f64 = 0.;
    let mut worst_center: f64 = 0.;
    for load in [0.001, 0.01, 0.1, 0.4, 0.7, 0.95, 0.999] {
        let volume = hydro.full_volume() * load;
        for (roll, pitch) in [
            (0., 0.),
            (1e-13, -1e-13),
            (0.2, 0.08),
            (-0.4, -0.13),
            (FRAC_PI_2, 0.),
            (-FRAC_PI_2, 0.),
            (0., FRAC_PI_2),
            (PI, 0.),
            (2.3, 1.4),
            (-2., -1.),
        ] {
            let exact = hydro.mesh_flotation(volume, roll, pitch);
            let cold = hydro.flotation(volume, roll, pitch);
            for cached in [
                cold,
                hydro.flotation_near(volume, roll, pitch, cold.y + 0.1),
                hydro.flotation_near(volume, roll, pitch, f64::NAN),
                hydro.flotation_near(volume, roll, pitch, 1e9),
            ] {
                let y_error = (cached.y - exact.y).abs();
                worst_y = worst_y.max(y_error);
                // The reference bisects 27 times over a 280 m bracket.
                assert!(y_error < 3e-6, "load {load}, ({roll},{pitch}): {y_error}");
                assert!(cached.afloat);
                assert!((cached.volume - volume).abs() < hydro.full_volume() * 2e-8);
                for axis in 0..3 {
                    let error = (cached.center[axis] - exact.center[axis]).abs();
                    worst_center = worst_center.max(error);
                    assert!(error < 2e-5, "axis {axis}, load {load}: {error}");
                }
            }
        }
    }
    println!(
        "maximum draft difference {worst_y:e} m, buoyancy-centre difference {worst_center:e} m"
    );
    for volume in [hydro.full_volume(), hydro.full_volume() * 1.2] {
        let actual = hydro.flotation_near(volume, PI, -FRAC_PI_2, 0.);
        let exact = hydro.mesh_flotation(volume, PI, -FRAC_PI_2);
        assert!(!actual.afloat);
        assert_eq!(actual.volume, exact.volume);
        assert_eq!(actual.center, exact.center);
        assert_eq!(actual.y, exact.y);
    }
}

#[test]
fn symmetric_hulls_keep_mirrored_buoyancy_without_imposing_symmetry_on_custom_shapes() {
    let hydro = HullHydrostatics::new(&hull(false), None);
    for load in [0.1, 0.5, 0.9] {
        for roll in [0.001, 0.3, 1., FRAC_PI_2, 2.8] {
            let a = hydro.flotation(hydro.full_volume() * load, roll, 0.2);
            let b = hydro.flotation(hydro.full_volume() * load, -roll, 0.2);
            assert!((a.y - b.y).abs() < 1e-8);
            assert!((a.center[0] + b.center[0]).abs() < 1e-8);
            assert!((a.center[1] - b.center[1]).abs() < 1e-8);
            assert!((a.center[2] - b.center[2]).abs() < 1e-8);
        }
    }
    let hydro = HullHydrostatics::new(&hull(true), None);
    let a = hydro.flotation(hydro.full_volume() * 0.8, 0.3, 0.);
    let b = hydro.flotation(hydro.full_volume() * 0.8, -0.3, 0.);
    assert!((a.y - b.y).abs() > 0.01);
}
