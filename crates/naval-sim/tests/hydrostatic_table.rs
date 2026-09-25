//! The published hydrostatic table replaces the mesh solver in every battle, so
//! it has to answer the same questions to within a tolerance a helmsman could
//! not see. This measures it against the solver it was built from, for every
//! catalog hull.
use naval_sim::{catalog::Catalog, geometry::Pose, hydrostatics::HullHydrostatics};

fn catalog() -> Catalog {
    Catalog::load(&naval_sim::catalog::installed_manifest()).unwrap()
}
/// Attitudes a fighting ship reaches: heel to a bad list, trim to a flooded end.
const HEEL: [f64; 12] = [
    0.0, 0.008, 0.02, 0.05, 0.09, 0.15, 0.22, 0.32, 0.45, 0.6, 0.8, 1.05,
];
const TRIM: [f64; 11] = [
    -0.35, -0.15, -0.07, -0.03, -0.012, 0.0, 0.009, 0.025, 0.06, 0.12, 0.28,
];
/// Displacement as a fraction of the whole hull: a light warship floats near a
/// third of it, and loss of flotation is the whole of it.
const FRACTION: [f64; 6] = [0.3, 0.45, 0.6, 0.75, 0.88, 0.97];

/// Buoyancy is only ever read through a righting arm, so the error that matters
/// is the arm's, not the centroid's in ship coordinates.
fn arms(table: [f64; 3], mesh: [f64; 3], roll: f64, pitch: f64) -> (f64, f64) {
    let d = naval_sim::geometry::rotate(
        std::array::from_fn(|i| table[i] - mesh[i]),
        Pose {
            roll,
            pitch,
            ..Pose::default()
        },
    );
    (d[0].abs(), d[2].abs())
}

/// The worst error of one kind in one band, and where it happened, so a
/// failure names the hull and attitude instead of only a fleet-wide number.
#[derive(Clone, Default)]
struct Worst {
    error: f64,
    at: String,
}
impl Worst {
    fn record(&mut self, error: f64, at: impl FnOnce() -> String) {
        if error > self.error {
            *self = Worst { error, at: at() };
        }
    }
}

/// `NAVAL_SHIPS=shokaku,enterprise-cv6` measures only those hulls: after
/// `ship:hydrostatics <id>`, a two-second check instead of the whole fleet.
fn selected(id: &str) -> bool {
    std::env::var("NAVAL_SHIPS").map_or(true, |ids| ids.split(',').any(|s| s.trim() == id))
}

#[test]
fn the_published_table_floats_every_hull_where_the_mesh_solver_does() {
    let catalog = catalog();
    // Split at the point where a hull runs out of reserve buoyancy. Above it a
    // metre of draft buys almost no displacement, so inverting for draft is
    // ill-conditioned for the mesh solver too, and the ship is foundering.
    let mut draft: [Worst; 2] = Default::default();
    let (mut roll_arm, mut pitch_arm, mut displacement) =
        (draft.clone(), draft.clone(), draft.clone());
    let mut hulls = catalog
        .definitions
        .iter()
        .filter(|(id, _)| selected(id))
        .collect::<Vec<_>>();
    hulls.sort_by_key(|(id, _)| id.as_str());
    assert!(!hulls.is_empty(), "NAVAL_SHIPS names no catalog hull");
    for (id, def) in hulls {
        let table = HullHydrostatics::new(&def.hull, catalog.hydrostatics.get(id));
        let mesh = HullHydrostatics::new(&def.hull, None);
        assert!(
            (table.full_volume() - mesh.full_volume()).abs() < mesh.full_volume() * 1e-9,
            "{id}: published displacement does not match the mesh"
        );
        // Each hull's own worst, printed below: which ship to re-solve.
        let mut own = [0.0_f64; 2];
        for roll in HEEL {
            for pitch in TRIM {
                for fraction in FRACTION {
                    let volume = mesh.full_volume() * fraction;
                    let band = usize::from(fraction > 0.9);
                    for roll in [roll, -roll] {
                        let a = table.flotation(volume, roll, pitch);
                        let b = mesh.flotation(volume, roll, pitch);
                        assert!(
                            a.afloat && b.afloat,
                            "{id}: sinks at heel {:.1}°, trim {:.1}°, {:.0}% of hull volume",
                            roll.to_degrees(),
                            pitch.to_degrees(),
                            fraction * 100.0
                        );
                        let immersion = (a.y - b.y).abs();
                        let (r, p) = arms(a.center, b.center, roll, pitch);
                        // The immersion the table solved for must also read back
                        // as the same displacement and centroid.
                        let (s, sc) = {
                            let s = table.sample(b.y, roll, pitch);
                            (s.volume, s.center)
                        };
                        let (r2, p2) = arms(sc, mesh.sample(b.y, roll, pitch).center, roll, pitch);
                        let at = || {
                            format!(
                                "{id} at heel {:.1}°, trim {:.1}°, {:.0}% of hull volume",
                                roll.to_degrees(),
                                pitch.to_degrees(),
                                fraction * 100.0
                            )
                        };
                        displacement[band].record((s - volume).abs() / volume, at);
                        draft[band].record(immersion, at);
                        roll_arm[band].record(r.max(r2), at);
                        pitch_arm[band].record(p.max(p2), at);
                        own[band] = own[band].max(r.max(r2));
                    }
                }
            }
        }
        println!(
            "{id}: worst roll arm {:.1} cm afloat, {:.1} cm foundering",
            own[0] * 100.0,
            own[1] * 100.0
        );
    }
    for band in 0..2 {
        println!(
            "{}: draft {:.0} mm, roll arm {:.1} cm, pitch arm {:.1} cm, displacement {:.2}%",
            ["afloat", "foundering"][band],
            draft[band].error * 1000.0,
            roll_arm[band].error * 100.0,
            pitch_arm[band].error * 100.0,
            displacement[band].error * 100.0
        );
    }
    // Draft to a few centimetres, inside the wave heave the hull rides anyway.
    // The arms are read against the stiffness they work into: a longitudinal
    // metacentric radius of several hundred metres turns even the worst pitch
    // arm here into under a twentieth of a degree of settled trim, and the worst
    // roll arm into a fifth of a degree of list.
    let limits = [
        ("draft", &draft[0], 0.08, "m"),
        ("roll arm", &roll_arm[0], 0.12, "m"),
        ("pitch arm", &pitch_arm[0], 0.7, "m"),
        ("displacement", &displacement[0], 0.03, "of volume"),
        ("foundering draft", &draft[1], 0.4, "m"),
        ("foundering roll arm", &roll_arm[1], 0.3, "m"),
        ("foundering pitch arm", &pitch_arm[1], 0.8, "m"),
    ];
    let failures = limits
        .iter()
        .filter(|(_, worst, limit, _)| worst.error >= *limit)
        .map(|(what, worst, limit, unit)| {
            format!(
                "{what} error {:.4} {unit} (limit {limit}): {}",
                worst.error, worst.at
            )
        })
        .collect::<Vec<_>>();
    assert!(
        failures.is_empty(),
        "{}\nAdd a heel, trim or volume node near that attitude (scripts/ships/hydrostaticTable.ts), then bun run ship:hydrostatics <id>; rerun one hull with NAVAL_SHIPS=<id> bun run rust:test -- hydrostatic_table",
        failures.join("\n")
    );
}
