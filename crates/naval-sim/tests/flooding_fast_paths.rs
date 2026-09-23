//! The flooding fast paths must be bit-exact, not merely close: a dry
//! compartment's lazily built shape has to equal the eager build, and the fully
//! immersed hydrostatic sample has to be independent of roll and pitch.
use naval_sim::{
    catalog::Catalog,
    floodwater::{refresh, water_body},
    hydrostatics::HullHydrostatics,
};
fn catalog() -> Catalog {
    Catalog::load(&naval_sim::catalog::installed_manifest()).unwrap()
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
                // Exact polyhedral rooms have no wetted surface when dry;
                // only the column fast path retains an average area.
                let dry_area = if room.volumes.is_some() {
                    0.0
                } else {
                    room.capacity_m3 / (ceiling - floor)
                };
                assert_eq!(dry.area.to_bits(), dry_area.to_bits(), "{id} {}", room.id);
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
/// A constructed room answers level queries from a table of exact clipped
/// volumes, filled in where queries land. It must agree with bisecting the
/// clipped volume directly, whatever was asked before and after the hull turns.
#[test]
fn a_constructed_room_levels_match_bisecting_the_clipped_volume() {
    use naval_sim::construction_geometry::submerged;
    let catalog = catalog();
    let (mut checked, mut worst) = (0, 0.0_f64);
    for (id, def) in &catalog.definitions {
        let mut rooms: Vec<_> = def
            .compartments
            .iter()
            .filter(|r| r.volumes.is_some())
            .collect();
        rooms.sort_by_key(|r| std::cmp::Reverse(r.volumes.as_ref().unwrap().len()));
        for room in rooms.into_iter().take(2) {
            let cells = room.volumes.as_ref().unwrap();
            let held = room.capacity_m3 * 0.2;
            let mut body = water_body(room, held, ATTITUDES[1].0, ATTITUDES[1].1);
            for (roll, pitch) in [ATTITUDES[0], ATTITUDES[1], ATTITUDES[2]] {
                refresh(&mut body, room, held, roll, pitch, &mut Default::default());
                let n = [
                    roll.sin() * pitch.cos(),
                    roll.cos() * pitch.cos(),
                    -pitch.sin(),
                ];
                let heights = cells
                    .iter()
                    .flat_map(|c| c.faces.iter().flat_map(|f| f.vertices.iter()))
                    .map(|p| p[0] * n[0] + p[1] * n[1] + p[2] * n[2]);
                let (floor, ceiling) = heights.fold((f64::INFINITY, f64::NEG_INFINITY), |a, y| {
                    (a.0.min(y), a.1.max(y))
                });
                assert_eq!(body.level_at_volume(room, 0.0).to_bits(), floor.to_bits());
                assert_eq!(
                    body.level_at_volume(room, room.capacity_m3).to_bits(),
                    ceiling.to_bits()
                );
                for fill in [0.31, 0.3100001, 0.64, 0.31, 1e-6, 0.02, 0.97, 0.999999] {
                    let volume = room.capacity_m3 * fill;
                    let (mut lo, mut hi) = (floor, ceiling);
                    for _ in 0..40 {
                        let mid = (lo + hi) * 0.5;
                        if submerged(cells, n, mid).volume < volume {
                            lo = mid;
                        } else {
                            hi = mid;
                        }
                    }
                    let level = body.level_at_volume(room, volume);
                    let error = (level - (lo + hi) * 0.5).abs();
                    worst = worst.max(error);
                    assert!(error < 1e-6, "{id} {} at {fill}: {error} m", room.id);
                    checked += 1;
                }
                // The body's own fill reports the level its refresh solved.
                let own = (body.level - body.level_at_volume(room, held * (1. + 1e-12))).abs();
                assert!(own < 1e-6, "{id} {}: own level off by {own} m", room.id);
            }
        }
    }
    assert!(checked > 0, "no constructed rooms in the catalog");
    println!("worst level difference {worst:e} m over {checked} queries");
}
/// In battle a constructed hull solves its immersion by a warm-started secant
/// instead of bisecting from its bounding distance. Whatever the hint, it must
/// land where the bisection does, within the bisection's own resolution.
#[test]
fn a_warm_started_flotation_matches_the_bisected_one() {
    let catalog = catalog();
    let mut checked = 0;
    for (id, def) in &catalog.definitions {
        if def.hull.volume.is_none() {
            continue;
        }
        let hydro = HullHydrostatics::new(&def.hull, None);
        for load in [0.7, 1.0, 1.6] {
            let volume = def.hull.mass_kg / 1025.0 * load;
            if volume >= hydro.full_volume() {
                continue;
            }
            for (roll, pitch) in [ATTITUDES[0], ATTITUDES[1], ATTITUDES[2], ATTITUDES[5]] {
                let bisected = hydro.mesh_flotation(volume, roll, pitch);
                for hint in [
                    bisected.y,
                    bisected.y + 2.5,
                    bisected.y - 4.0,
                    f64::NAN,
                    1e9,
                    -1e9,
                ] {
                    let near = hydro.flotation_near(volume, roll, pitch, hint);
                    assert!(near.afloat);
                    assert!(
                        (near.y - bisected.y).abs() < 1e-5,
                        "{id} load {load} hint {hint}: {} vs {}",
                        near.y,
                        bisected.y
                    );
                    for axis in 0..3 {
                        assert!((near.center[axis] - bisected.center[axis]).abs() < 1e-4);
                    }
                    assert!((near.volume - volume).abs() < 1e-3 * volume.max(1.0));
                    checked += 1;
                }
            }
        }
    }
    assert!(checked > 0, "no constructed hulls in the catalog");
}
/// The mesh solver's flotation shortcut still rests on this: at -bound every
/// vertex is kept, so the sample cannot depend on attitude. The published table
/// makes the same claim structurally, by holding one fully immersed entry.
#[test]
fn the_fully_immersed_sample_does_not_depend_on_attitude() {
    let catalog = catalog();
    for (id, def) in &catalog.definitions {
        let hull = &def.hull;
        let mesh = HullHydrostatics::new(hull, None);
        let bound = hull.length + hull.beam + hull.draft + hull.depth;
        let full = mesh.sample(-bound, 0.0, 0.0);
        assert_eq!(full.volume.to_bits(), mesh.full_volume().to_bits(), "{id}");
        for (roll, pitch) in ATTITUDES {
            let sample = mesh.sample(-bound, roll, pitch);
            assert_eq!(sample.volume.to_bits(), full.volume.to_bits(), "{id}");
            for axis in 0..3 {
                assert_eq!(
                    sample.center[axis].to_bits(),
                    full.center[axis].to_bits(),
                    "{id} axis {axis}"
                );
            }
        }
        // The table is solved by the TypeScript twin's copy of that same mesh,
        // so its published total must land on the same displacement.
        let table = HullHydrostatics::new(hull, catalog.hydrostatics.get(id));
        assert!(
            (table.full_volume() - full.volume).abs() < full.volume * 1e-9,
            "{id}: table {} mesh {}",
            table.full_volume(),
            full.volume
        );
    }
}
