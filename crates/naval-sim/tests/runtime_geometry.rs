//! Independent attitudes and fill levels, separate from proxy acceptance probes.
use naval_sim::{definition::ShipDefinition, geometry::*, hydrostatics::HullHydrostatics};

#[test]
fn simplified_constructed_hulls_preserve_draft_displacement_and_balance() {
    for source in [
        include_str!("../../../public/models/valiant.json"),
        include_str!("../../../public/models/resolute.json"),
    ] {
        let def: ShipDefinition = serde_json::from_str(source).unwrap();
        let exact = HullHydrostatics::new(&def.hull, None);
        let runtime = HullHydrostatics::new_runtime(&def.hull, None);
        assert!(
            runtime.volume_shape_count() < exact.volume_shape_count(),
            "{}",
            def.id
        );
        assert!((runtime.full_volume() - exact.full_volume()).abs() < 1e-8);
        for (roll, pitch) in [
            (0., 0.),
            (0.13, 0.04),
            (-0.31, -0.07),
            (0.79, 0.21),
            (-1.57, 0.31),
            (2.75, -0.23),
            (std::f64::consts::PI - 0.002, 0.),
        ] {
            for fraction in [0.001, 0.01, 0.1, 0.33, 0.67, 0.9, 0.999] {
                let volume = exact.full_volume() * fraction;
                let before = exact.flotation(volume, roll, pitch);
                let after = runtime.flotation(volume, roll, pitch);
                let actual = exact.sample(after.y, roll, pitch);
                assert!((actual.volume - volume).abs() < exact.full_volume() * 0.00005);
                assert!(
                    (before.y - after.y).abs() < 0.005,
                    "{} {roll} {pitch} {fraction}",
                    def.id
                );
                assert!(
                    length(sub(actual.center, after.center)) < 0.01,
                    "{} {roll} {pitch} {fraction}",
                    def.id
                );
            }
        }
    }
}

#[test]
fn runtime_proxies_do_not_rewrite_visual_geometry_or_legacy_hydrostatics() {
    let def: ShipDefinition =
        serde_json::from_str(include_str!("../../../public/models/bismarck.json")).unwrap();
    let exact = HullHydrostatics::new(&def.hull, None);
    let runtime = HullHydrostatics::new_runtime(&def.hull, None);
    for (y, roll, pitch) in [(0., 0., 0.), (-2., 0.1, -0.2), (3., 0.7, 0.1)] {
        let a = exact.sample(y, roll, pitch);
        let b = runtime.sample(y, roll, pitch);
        assert_eq!(a.volume, b.volume);
        assert_eq!(a.center, b.center);
    }
    let def: ShipDefinition =
        serde_json::from_str(include_str!("../../../public/models/valiant.json")).unwrap();
    let original = serde_json::to_vec(&def).unwrap();
    let _ = HullHydrostatics::new_runtime(&def.hull, None);
    let _ = naval_sim::contacts::ContactGeometry::new(&def).unwrap();
    assert_eq!(serde_json::to_vec(&def).unwrap(), original);
}

#[test]
fn zero_volume_clipping_remnants_do_not_poison_simplified_buoyancy() {
    use naval_sim::{
        construction_geometry::box_cell,
        definition::{ConstructionGeometry, Hull},
    };
    let mut cells = vec![];
    for x in 0..8 {
        for y in 0..3 {
            for z in 0..3 {
                cells.push(box_cell(
                    [x as f64 + 0.5, y as f64 + 0.5, z as f64 + 0.5],
                    [1.; 3],
                ));
            }
        }
    }
    // Keep the remnant disconnected so it survives as a zero-volume cell.
    cells.push(box_cell([10., 1.5, 1.5], [1., 0., 1.]));
    let hull = Hull {
        length: 8.,
        beam: 3.,
        depth: 3.,
        draft: 1.5,
        half_breadths: vec![[0., 1.5], [8., 1.5]],
        keel_heights: vec![[0., 0.], [8., 0.]],
        deck_heights: vec![[0., 3.], [8., 3.]],
        volume: Some(ConstructionGeometry {
            cells,
            ..Default::default()
        }),
        ..Default::default()
    };
    let exact = HullHydrostatics::new(&hull, None);
    let runtime = HullHydrostatics::new_runtime(&hull, None);
    assert!(runtime.volume_shape_count() < exact.volume_shape_count());
    for (roll, pitch) in [(0., 0.), (0.3, 0.2), (-0.7, 0.04)] {
        let a = exact.sample(-1.5, roll, pitch);
        let b = runtime.sample(-1.5, roll, pitch);
        assert!((a.volume - b.volume).abs() < 1e-8);
        assert!(length(sub(a.center, b.center)) < 1e-8);
    }
}
