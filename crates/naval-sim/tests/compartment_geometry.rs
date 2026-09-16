use naval_sim::{
    compartment_geometry::coalesce,
    construction_geometry as cg,
    definition::{Compartment, ShipDefinition},
    floodwater::water_body,
    geometry::*,
};

#[test]
fn joining_removes_partitions_without_filling_a_corner_or_slit() {
    let cells = vec![
        cg::box_cell([0., 0., 0.], [1.; 3]),
        cg::box_cell([1., 0., 0.], [1.; 3]),
        cg::box_cell([0., 0., 1.], [1.; 3]),
    ];
    let compact = coalesce(cells.clone()).0;
    assert_eq!(compact.len(), 2);
    assert!((cg::total(&compact).volume - 3.).abs() < 1e-12);
    for x in -3..8 {
        for y in -3..4 {
            for z in -3..8 {
                let p = [x as f64 / 4., y as f64 / 4., z as f64 / 4.];
                assert_eq!(
                    cells.iter().any(|c| cg::contains(c, p)),
                    compact.iter().any(|c| cg::contains(c, p)),
                    "{p:?}"
                );
            }
        }
    }
    assert_eq!(
        serde_json::to_vec(&compact).unwrap(),
        serde_json::to_vec(&coalesce(cells).0).unwrap()
    );
    let slit = vec![
        cg::box_cell([0.; 3], [1.; 3]),
        cg::box_cell([1.001, 0., 0.], [1.; 3]),
    ];
    assert_eq!(coalesce(slit).0.len(), 2);
}

#[test]
fn slivers_keep_their_original_planes() {
    let cells = vec![
        cg::box_cell([0.; 3], [1., 1e-10, 1.]),
        cg::box_cell([1., 0., 0.], [1., 1e-10, 1.]),
    ];
    let before = serde_json::to_vec(&cells).unwrap();
    assert_eq!(serde_json::to_vec(&coalesce(cells).0).unwrap(), before);
}

// The original cap-building implementation is an independent numerical oracle.
// The production optimization skips only whole-cell work, so bit equality is required.
fn reference(room: &Compartment, volume: f64, roll: f64, pitch: f64) -> (f64, f64, [f64; 3]) {
    let cells = room.volumes.as_ref().unwrap();
    let n = [
        roll.sin() * pitch.cos(),
        roll.cos() * pitch.cos(),
        -pitch.sin(),
    ];
    let (mut lo, mut hi) = cells
        .iter()
        .flat_map(|c| c.faces.iter().flat_map(|f| f.vertices.iter()))
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), p| {
            let y = dot(*p, n);
            (lo.min(y), hi.max(y))
        });
    let volume = volume.clamp(0., room.capacity_m3);
    if volume <= 0. {
        return (lo, 0., room.center);
    }
    if volume >= room.capacity_m3 {
        return (hi, 0., cg::total(cells).center());
    }
    for _ in 0..30 {
        let mid = (lo + hi) * 0.5;
        if cg::submerged(cells, n, mid).volume < volume {
            lo = mid
        } else {
            hi = mid
        }
    }
    let level = (lo + hi) * 0.5;
    let m = cg::submerged(cells, n, level);
    let area = (cg::submerged(cells, n, level + 0.0001).volume
        - cg::submerged(cells, n, level - 0.0001).volume)
        / 0.0002;
    (level, area.max(0.), m.center())
}

#[test]
fn prepared_flood_cells_match_original_clipping_bit_for_bit() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let definition: ShipDefinition = serde_json::from_slice(
        &std::fs::read(root.join("public/models/admiral-hipper-construction.json")).unwrap(),
    )
    .unwrap();
    for room in &definition.compartments {
        for (roll, pitch) in [
            (0., 0.),
            (radians(15.), radians(3.)),
            (radians(-35.), radians(-7.)),
            (radians(90.), 0.),
            (radians(170.), radians(10.)),
        ] {
            for f in [0., 0.1, 0.5, 0.9, 1.] {
                let a = reference(room, room.capacity_m3 * f, roll, pitch);
                let b = water_body(room, room.capacity_m3 * f, roll, pitch);
                assert_eq!(
                    (a.0.to_bits(), a.1.to_bits(), a.2.map(f64::to_bits)),
                    (
                        b.level.to_bits(),
                        b.area.to_bits(),
                        b.center.map(f64::to_bits)
                    ),
                    "{}, {roll}, {pitch}, {f}",
                    room.id
                );
            }
        }
    }
}
