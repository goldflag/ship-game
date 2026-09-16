use naval_sim::{definition::*, floodwater::water_body, hydrostatics::HullHydrostatics};
fn hull() -> Hull {
    Hull {
        length: 4.,
        beam: 4.,
        draft: 1.,
        depth: 1.,
        half_breadths: vec![[0., 2.], [4., 2.]],
        deck_heights: vec![[0., 1.], [4., 1.]],
        keel_heights: vec![[0., -1.], [4., -1.]],
        buoyancy: Some(HullBuoyancy {
            version: 1.,
            cells: vec![
                BuoyancyCell {
                    center: [-1., 0., 0.],
                    size: [2., 2., 2.],
                    volume_m3: 2.,
                },
                BuoyancyCell {
                    center: [1., 0., 0.],
                    size: [2., 2., 2.],
                    volume_m3: 6.,
                },
            ],
        }),
        ..Default::default()
    }
}
#[test]
fn weights_preserve_full_displacement_and_center_at_extreme_heel() {
    let h = HullHydrostatics::new(&hull(), None);
    for roll in [0., 0.4, 1.57, 3.14] {
        let s = h.sample(-100., roll, 0.2);
        assert!((s.volume - 8.).abs() < 1e-10);
        assert!((s.center[0] - 0.5).abs() < 1e-10);
    }
    let half = h.sample(0., 0., 0.);
    assert!((half.volume - 4.).abs() < 1e-10);
    assert!((half.center[1] + 0.5).abs() < 1e-10);
}
#[test]
fn water_weights_preserve_capacity_and_shift_center() {
    let cells = hull()
        .buoyancy
        .unwrap()
        .cells
        .into_iter()
        .map(|c| CompartmentCellsItem {
            center: c.center,
            size: c.size,
            volume_m3: Some(c.volume_m3),
        })
        .collect();
    let r = Compartment {
        capacity_m3: 8.,
        center: [0.; 3],
        size: [4., 2., 2.],
        cells: Some(cells),
        ..Default::default()
    };
    for f in [0.1, 0.5, 1.] {
        let w = water_body(&r, f * 8., 0., 0.);
        assert!((w.level - (-1. + 2. * f)).abs() < 1e-10);
        assert!((w.center[0] - 0.5).abs() < 1e-10);
        assert!((w.center[1] - (-1. + f)).abs() < 1e-10);
    }
}
#[test]
fn water_inertia_matches_the_filled_box_and_parallel_axis_theorem() {
    let room = Compartment {
        capacity_m3: 8.,
        center: [0.; 3],
        size: [2.; 3],
        cells: Some(vec![CompartmentCellsItem {
            center: [0.; 3],
            size: [2.; 3],
            volume_m3: Some(8.),
        }]),
        ..Default::default()
    };
    let full = water_body(&room, 8., 0., 0.);
    let i = full.inertia_m3([0.; 3]);
    assert!((i[0] - 16. / 3.).abs() < 1e-10);
    assert!((i[2] - 16. / 3.).abs() < 1e-10);
    let shifted = full.inertia_m3([1., 0., 0.]);
    assert!((shifted[2] - i[2] - 8.).abs() < 1e-10);
    let half = water_body(&room, 4., 0., 0.);
    assert!((half.inertia_m3(half.center)[0] - 5. / 3.).abs() < 1e-10);
}
#[test]
fn exact_water_in_a_mixed_profile_retains_point_mass_inertia() {
    let room = Compartment {
        capacity_m3: 8.,
        center: [1., 0., 0.],
        size: [2.; 3],
        volumes: Some(vec![naval_sim::construction_geometry::box_cell(
            [1., 0., 0.],
            [2.; 3],
        )]),
        ..Default::default()
    };
    let water = water_body(&room, 4., 0., 0.);
    assert!((water.inertia_m3([0.; 3])[2] - 5.).abs() < 1e-7);
}
