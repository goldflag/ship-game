//! Approximate internal loading must reach both construction readings and CPU motion.
use naval_sim::{construction, damage::Combatant, definition::*, hydrostatics::HullHydrostatics};

fn fixture() -> (ConstructionSource, ConstructionCatalog) {
    let source = serde_json::from_value(serde_json::json!({
        "schemaVersion": 1, "id": "loading-test", "name": "Loading test",
        "revision": "one", "coordinates": "meters-y-up-bow-negative-z",
        "construction": { "version": 2, "catalogRevision": "test", "defaultThicknessMm": 16,
            "primitives": [{ "id": "hull", "kind": "box", "size": [10,4,20],
                "position": [0,0,0], "rotationDeg": 0 }],
            "surfaces": [], "equipment": [], "boundaries": [], "loads": [] }
    }))
    .unwrap();
    let catalog = serde_json::from_value(serde_json::json!({
        "schemaVersion": 1, "revision": "test", "equipment": [],
        "weapons": { "schemaVersion": 1, "parts": [] }
    }))
    .unwrap();
    (source, catalog)
}
fn compile(source: &ConstructionSource, catalog: &ConstructionCatalog) -> ShipDefinition {
    let result = construction::compile(source, catalog);
    result
        .definition
        .unwrap_or_else(|| panic!("{:?}", result.diagnostics))
}
fn allowance(def: &ShipDefinition) -> &ConstructionMass {
    def.loading
        .as_ref()
        .unwrap()
        .contributions
        .iter()
        .find(|m| m.kind == "internal-allowance")
        .expect("explicit internal allowance")
}
fn near(actual: f64, expected: f64) {
    assert!((actual - expected).abs() < 1e-5, "{actual} != {expected}");
}

#[test]
fn internal_allowance_has_distributed_inertia_and_counts_union_volume_once() {
    let (mut source, catalog) = fixture();
    let def = compile(&source, &catalog);
    let a = allowance(&def);
    near(a.mass_kg, 120_000.); // 800 m³ × 150 kg/m³.
    assert_eq!(a.center, [0., -1., 0.]);
    for (actual, expected) in a.inertia_kg_m2.into_iter().zip([
        120_000. * (4. + 400.) / 12.,
        120_000. * (100. + 400.) / 12.,
        120_000. * (100. + 4.) / 12.,
    ]) {
        near(actual, expected);
    }
    let loading = def.loading.as_ref().unwrap();
    near(
        def.hull.mass_kg,
        loading.contributions.iter().map(|m| m.mass_kg).sum(),
    );
    near(HullHydrostatics::new(&def.hull, None).full_volume(), 800.);
    // Overlapping construction pieces cannot multiply the inferred weight.
    let mut duplicate = source.construction.primitives[0].clone();
    duplicate.id = "overlap".into();
    source.construction.primitives.push(duplicate);
    let overlapped = compile(&source, &catalog);
    near(allowance(&overlapped).mass_kg, a.mass_kg);
    near(
        overlapped.loading.unwrap().usable_volume_m3,
        loading.usable_volume_m3,
    );
    // Subdivision into adjacent pieces must not change the inferred loading either.
    for (i, p) in source.construction.primitives.iter_mut().enumerate() {
        p.size[2] = 10.;
        p.position[2] = if i == 0 { -5. } else { 5. };
    }
    let split = compile(&source, &catalog);
    near(allowance(&split).mass_kg, a.mass_kg);
    for i in 0..3 {
        near(allowance(&split).inertia_kg_m2[i], a.inertia_kg_m2[i]);
    }
}

#[test]
fn internal_allowance_follows_translated_and_rotated_hulls() {
    let (mut source, catalog) = fixture();
    let original = compile(&source, &catalog);
    source.construction.primitives[0].position = [3., 5., 7.];
    source.construction.primitives[0].rotation_deg = 90.;
    let moved = compile(&source, &catalog);
    let a = allowance(&moved);
    near(a.mass_kg, allowance(&original).mass_kg);
    for (actual, expected) in a.center.into_iter().zip([3., 4., 7.]) {
        near(actual, expected);
    }
    near(a.inertia_kg_m2[0], allowance(&original).inertia_kg_m2[2]);
    near(a.inertia_kg_m2[2], allowance(&original).inertia_kg_m2[0]);
}

#[test]
fn slender_rounded_hull_returns_from_small_heel_in_native_sea_trial() {
    let (mut source, catalog) = fixture();
    // Destroyer starting profile narrowed to 10 m: the old empty shell settled
    // at roughly 72 degrees of heel from an initial 4.6-degree disturbance.
    let times: [f64; 8] = [0., 0.08, 0.2, 0.36, 0.54, 0.72, 0.88, 1.];
    let widths = [0., 0.24, 0.62, 0.92, 1., 0.9, 0.55, 0.08];
    let p = &mut source.construction.primitives[0];
    p.kind = "custom-hull".into();
    p.size = [10., 9., 120.];
    p.custom_hull = Some(ConstructionCustomHull {
        red_paint_y: None,
        version: 1.,
        rake: 0.65,
        bulb: 0.,
        stations: times
            .into_iter()
            .zip(widths)
            .enumerate()
            .map(|(i, (t, w))| {
                let keel = -0.52 + 0.28 * ((t - 0.5).abs() * 2.).powi(3);
                let half = [
                    [w, 0.45],
                    [w * 0.96, keel + (0.45 - keel) * 0.63],
                    [w * (0.85 - 0.78 * 0.14), keel + (0.45 - keel) * 0.18],
                    [w * 0.36, keel + 0.02],
                ];
                let points = half
                    .iter()
                    .map(|v| ConstructionHullPoint { x: -v[0], y: v[1] })
                    .chain(std::iter::once(ConstructionHullPoint { x: 0., y: keel }))
                    .chain(
                        half.iter()
                            .rev()
                            .map(|v| ConstructionHullPoint { x: v[0], y: v[1] }),
                    )
                    .collect();
                ConstructionHullStation {
                    id: format!("s{i}"),
                    t,
                    points,
                }
            })
            .collect(),
    });
    let def = compile(&source, &catalog);
    let loading = def.loading.as_ref().unwrap();
    assert!(loading.mass_kg > 1_000_000., "mass={}", loading.mass_kg);
    assert!(
        loading.roll_metacentric_height_m > 0.2,
        "GM={}",
        loading.roll_metacentric_height_m
    );
    let hydro = HullHydrostatics::new(&def.hull, None);
    let mut actor = Combatant::new("trial", &def);
    actor.motion.roll = 0.08;
    for _ in 0..3600 {
        naval_sim::flooding::update_flooding(&mut actor, &def, &hydro, 1. / 60., 0.5, None, None);
        assert!(actor.motion.roll.abs() < 0.15, "roll={}", actor.motion.roll);
        assert!(!actor.damage.sunk);
    }
    assert!(
        actor.motion.roll.abs() < 0.03,
        "final roll={}",
        actor.motion.roll
    );
}
