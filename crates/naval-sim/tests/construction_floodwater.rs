//! Water levels, centers and inertia retain the reference clipped-cell solve as
//! attitude and fill change. In particular, cached full-cell moments are local
//! geometry and must never acquire a previous attitude's waterline.
use naval_sim::{
    construction_geometry::{self as cg, Cell, Moments},
    definition::{Compartment, Vec3},
    floodwater::{Scratch, refresh, water_body},
    geometry::dot,
};

fn cells() -> Vec<Cell> {
    vec![
        cg::box_cell([2., -3., 5.], [4., 6., 8.]),
        cg::transform(
            &cg::box_cell([0.; 3], [1.; 3]),
            [7., -2., 5.],
            [2., 5., 7.],
            0.37,
        ),
        cg::prism(&[[10., 1., 1.], [11., 1., 3.], [12., 1., 1.]], 1.7),
        cg::box_cell([-4., 2., 3.], [2., cg::EPS * 1.5, 3.]),
    ]
}

fn reference(room: &Compartment, volume: f64, roll: f64, pitch: f64) -> (f64, f64, Moments) {
    let cells = room.volumes.as_ref().unwrap();
    let n = [
        roll.sin() * pitch.cos(),
        roll.cos() * pitch.cos(),
        -pitch.sin(),
    ];
    let (mut lo, mut hi) = cells
        .iter()
        .flat_map(|c| c.faces.iter().flat_map(|f| &f.vertices))
        .map(|&p| dot(p, n))
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), y| {
            (lo.min(y), hi.max(y))
        });
    if volume == 0. {
        return (lo, 0., Moments::default());
    }
    if volume == room.capacity_m3 {
        return (hi, 0., cg::total(cells));
    }
    for _ in 0..30 {
        let mid = (lo + hi) * 0.5;
        if cg::submerged(cells, n, mid).volume < volume {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    let level = (lo + hi) * 0.5;
    let e = 0.0001;
    let area = (cg::submerged(cells, n, level + e).volume
        - cg::submerged(cells, n, level - e).volume)
        / (2. * e);
    (level, area.max(0.), cg::submerged(cells, n, level))
}

fn same(a: f64, b: f64) {
    assert_eq!(a.to_bits(), b.to_bits(), "{a:?} != {b:?}");
}

#[test]
fn changing_attitude_and_fill_preserves_reference_moments_bit_for_bit() {
    let cells = cells();
    let room = Compartment {
        capacity_m3: cg::total(&cells).volume,
        volumes: Some(cells),
        center: [3., -1., 2.],
        ..Default::default()
    };
    let mut scratch = Scratch::default();
    let mut body = water_body(&room, 0., 0., 0.);
    for (roll, pitch) in [
        (0., 0.),
        (0.21, -0.013),
        (-0.37, 0.08),
        (1.2, -0.4),
        (-2.9, 0.55),
        (0., 0.),
    ] {
        for fill in [0., 1e-8, 0.01, 0.13, 0.5, 0.87, 0.99999999, 1., 0.13] {
            let volume = room.capacity_m3 * fill;
            refresh(&mut body, &room, volume, roll, pitch, &mut scratch);
            let (level, area, moments) = reference(&room, volume, roll, pitch);
            same(body.level, level);
            same(body.area, area);
            let center = if fill == 0. {
                room.center
            } else {
                moments.center()
            };
            for (a, b) in body.center.into_iter().zip(center) {
                same(a, b);
            }
            for origin in [[0.; 3], [1., -2., 3.]] {
                let second: Vec3 = std::array::from_fn(|i| {
                    (moments.second[i] - 2. * origin[i] * moments.first[i]
                        + origin[i] * origin[i] * moments.volume)
                        .max(0.)
                });
                let inertia = [
                    second[1] + second[2],
                    second[0] + second[2],
                    second[0] + second[1],
                ];
                for (a, b) in body.inertia_m3(origin).into_iter().zip(inertia) {
                    same(a, b);
                }
            }
        }
    }
}

#[test]
fn volume_only_clipping_matches_full_integration_at_vertices_and_tolerance_boundaries() {
    let mut cells = cells();
    cells.push(cg::box_cell([1e6, -2e6, 3e6], [3., 5., 7.]));
    cells.push(cg::box_cell([0.; 3], [2., 0., 3.]));
    let normals = [[0., 1., 0.], [1., 0., 0.], [0., 0., -1.], [0.6, 0.8, 0.]];
    for cell in &cells {
        for n in normals {
            let mut levels: Vec<f64> = cell
                .faces
                .iter()
                .flat_map(|f| &f.vertices)
                .map(|p| dot(*p, n))
                .collect();
            levels.extend([-1e8, 1e8, 0., 0.371]);
            for level in levels {
                for offset in [-2. * cg::EPS, -cg::EPS, 0., cg::EPS, 2. * cg::EPS] {
                    let d = level + offset;
                    let reference = cg::clip(cell, n, d).map(|c| cg::moments(&c).volume.to_bits());
                    assert_eq!(cg::clipped_volume(cell, n, d).map(f64::to_bits), reference);
                    assert_eq!(
                        cg::clipped_moments(cell, n, d).map(|m| m.volume.to_bits()),
                        reference
                    );
                }
            }
        }
    }
}
