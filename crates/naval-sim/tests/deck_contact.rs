//! Independent contact checks against the published authored surfaces. The
//! reference casts a vertical line into triangle planes without using the
//! fitter's spatial index, barycentric height query, or Newton solver.
use naval_sim::{
    aircraft::create_air_wing,
    aircraft_deck::{GroundPose, compose_attitude},
    catalog::Catalog,
    deck_contact::{ContactPose, DeckSurface},
    deck_operations::place,
    definition::{ShipDefinition, Vec3},
    flight_deck::DeckPose,
    geometry::{Pose, add, cross, dot, length, local_to_world, rotate, sub, world_to_local},
    rules::TeamId,
    vessel::{CompiledShip, Vessel},
};
use std::{
    f64::consts::PI,
    sync::{Arc, OnceLock},
};

fn catalog() -> &'static Catalog {
    static CONTENT: OnceLock<Catalog> = OnceLock::new();
    CONTENT.get_or_init(|| {
        Catalog::load(&std::fs::read("../../.build/naval-content/manifest.json").unwrap()).unwrap()
    })
}
const CARRIERS: [&str; 2] = ["enterprise-cv6", "shokaku"];

struct Reference(Vec<[Vec3; 3]>);
impl Reference {
    fn new(ship: &ShipDefinition) -> Self {
        let surface_id = &ship
            .air_wing
            .as_ref()
            .unwrap()
            .deck_layout
            .as_ref()
            .unwrap()
            .surface_id;
        let mut triangles = vec![];
        for s in ship
            .structures
            .as_ref()
            .unwrap()
            .iter()
            .filter(|s| &s.id == surface_id || s.id.starts_with("elevator-"))
        {
            if let Some(surface) = &s.surface {
                triangles.extend(
                    surface
                        .triangles
                        .iter()
                        .map(|t| t.map(|i| surface.vertices[i as usize])),
                );
            } else {
                for i in 1..s.footprint.len() - 1 {
                    triangles.push(
                        [s.footprint[0], s.footprint[i], s.footprint[i + 1]]
                            .map(|p| [p[0], s.base_y + s.height, p[1]]),
                    );
                }
            }
        }
        Self(triangles)
    }
    fn height(&self, x: f64, z: f64) -> Option<f64> {
        self.0
            .iter()
            .filter_map(|&[a, b, c]| {
                let n = cross(sub(b, a), sub(c, a));
                if n[1].abs() < 1e-9 {
                    return None;
                }
                let y = a[1] - (n[0] * (x - a[0]) + n[2] * (z - a[2])) / n[1];
                let p = [x, y, z];
                [(a, b), (b, c), (c, a)]
                    .iter()
                    .all(|&(u, v)| dot(cross(sub(v, u), sub(p, u)), n) >= -1e-7 * dot(n, n))
                    .then_some(y)
            })
            .max_by(f64::total_cmp)
    }
    // An intersection of two projected triangles has vertices drawn from the
    // original vertices or pairwise edge crossings. Enumerate those candidates
    // directly, independently of the production polygon-clipping routine.
    fn tyre_gap(&self, patches: &[[Vec3; 3]], fit: ContactPose) -> Option<f64> {
        let patches: Vec<_> = patches
            .iter()
            .map(|p| p.map(|v| add(fit.root, rotate(v, fit.attitude))))
            .collect();
        let bounds = |p: &[Vec3]| -> [f64; 4] {
            [
                p.iter().map(|p| p[0]).fold(f64::INFINITY, f64::min),
                p.iter().map(|p| p[0]).fold(f64::NEG_INFINITY, f64::max),
                p.iter().map(|p| p[2]).fold(f64::INFINITY, f64::min),
                p.iter().map(|p| p[2]).fold(f64::NEG_INFINITY, f64::max),
            ]
        };
        let tyre_bounds = bounds(&patches.iter().flatten().copied().collect::<Vec<_>>());
        let overlaps = |a: [f64; 4], b: [f64; 4]| {
            a[0] <= b[1] + 1e-9 && a[1] >= b[0] - 1e-9 && a[2] <= b[3] + 1e-9 && a[3] >= b[2] - 1e-9
        };
        let projected_cross = |a: Vec3, b: Vec3, c: Vec3| {
            (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0])
        };
        let inside = |p: Vec3, t: [Vec3; 3]| {
            let sign = projected_cross(t[0], t[1], t[2]).signum();
            (0..3).all(|i| projected_cross(t[i], t[(i + 1) % 3], p) * sign >= -1e-9)
        };
        let mut gap = f64::INFINITY;
        for &deck in &self.0 {
            if !overlaps(tyre_bounds, bounds(&deck)) {
                continue;
            }
            let deck_normal = cross(sub(deck[1], deck[0]), sub(deck[2], deck[0]));
            if deck_normal[1].abs() < 1e-9 {
                continue;
            }
            let deck_height = |p: Vec3| {
                deck[0][1]
                    - (deck_normal[0] * (p[0] - deck[0][0]) + deck_normal[2] * (p[2] - deck[0][2]))
                        / deck_normal[1]
            };
            for &patch in &patches {
                if !overlaps(bounds(&patch), bounds(&deck)) {
                    continue;
                }
                let mut candidates: Vec<_> =
                    patch.into_iter().filter(|&p| inside(p, deck)).collect();
                let tyre_normal = cross(sub(patch[1], patch[0]), sub(patch[2], patch[0]));
                if tyre_normal[1].abs() > 1e-12 {
                    for mut p in deck.into_iter().filter(|&p| inside(p, patch)) {
                        p[1] = patch[0][1]
                            - (tyre_normal[0] * (p[0] - patch[0][0])
                                + tyre_normal[2] * (p[2] - patch[0][2]))
                                / tyre_normal[1];
                        candidates.push(p);
                    }
                }
                for i in 0..3 {
                    let a = patch[i];
                    let d = sub(patch[(i + 1) % 3], a);
                    for j in 0..3 {
                        let b = deck[j];
                        let e = sub(deck[(j + 1) % 3], b);
                        let ba = sub(b, a);
                        let determinant = d[0] * e[2] - d[2] * e[0];
                        if determinant.abs() < 1e-12 {
                            continue;
                        }
                        let t = (ba[0] * e[2] - ba[2] * e[0]) / determinant;
                        let u = (ba[0] * d[2] - ba[2] * d[0]) / determinant;
                        if (-1e-9..=1.0 + 1e-9).contains(&t) && (-1e-9..=1.0 + 1e-9).contains(&u) {
                            candidates.push(std::array::from_fn(|k| a[k] + t * d[k]));
                        }
                    }
                }
                for p in candidates {
                    gap = gap.min(p[1] - deck_height(p));
                }
            }
        }
        gap.is_finite().then_some(gap)
    }
}
fn contacts(ground: &GroundPose) -> Vec<Vec3> {
    // Invert the nominal pitch analytically, separately from fitter inversion.
    let (s, c) = ground.pitch.sin_cos();
    ground
        .deck_geometry
        .as_ref()
        .unwrap()
        .support
        .iter()
        .map(|p| {
            [
                p[0],
                c * (p[1] - ground.clearance) + s * p[2],
                -s * (p[1] - ground.clearance) + c * p[2],
            ]
        })
        .collect()
}
fn assert_contact(
    reference: &Reference,
    ground: &GroundPose,
    fit: ContactPose,
    offset: f64,
    label: &str,
) {
    for (i, patches) in ground
        .deck_geometry
        .as_ref()
        .unwrap()
        .tyres
        .iter()
        .enumerate()
    {
        let gap = reference
            .tyre_gap(patches, fit)
            .unwrap_or_else(|| panic!("{label}: tyre {i} is unsupported"))
            - offset;
        assert!(
            gap.abs() < 0.00011,
            "{label}: tyre {i} actual triangle gap {gap}"
        );
    }
}

#[test]
fn indexed_height_matches_independent_authored_planes_including_crown_and_lift_seams() {
    for id in CARRIERS {
        let ship = &catalog().definitions[id];
        let surface = DeckSurface::new(ship).unwrap();
        let reference = Reference::new(ship);
        let layout = ship
            .air_wing
            .as_ref()
            .unwrap()
            .deck_layout
            .as_ref()
            .unwrap();
        let mut points: Vec<_> = (-24..=24)
            .flat_map(|x| (-60..=60).map(move |z| (x as f64 * 0.7, z as f64 * 2.1)))
            .collect();
        // Sample both sides of the platform/deck join, where two independently
        // authored surfaces have different crown/height and duplicated edges.
        for e in &layout.elevators {
            for x in [-e.width_m / 2.0, 0.0, e.width_m / 2.0] {
                for z in [-e.length_m / 2.0, e.length_m / 2.0] {
                    for epsilon in [-0.001, 0.0, 0.001] {
                        points.push((e.position[0] + x, e.position[2] + z + epsilon));
                    }
                }
            }
        }
        for (x, z) in points {
            match (surface.height(x, z), reference.height(x, z)) {
                (None, None) => {}
                (Some(a), Some(b)) => {
                    assert!((a - b).abs() < 1e-8, "{id}: height at {x},{z}: {a} vs {b}")
                }
                (actual, expected) => {
                    panic!("{id}: coverage at {x},{z}: {actual:?} vs {expected:?}")
                }
            }
        }
    }
}

#[test]
fn all_six_models_rest_on_both_carriers_at_every_startup_spot_and_intermediate_heading() {
    assert_eq!(
        catalog().aircraft.len(),
        6,
        "This test covers the six fitted combat models"
    );
    let mut samples = vec![];
    for id in CARRIERS {
        let ship = &catalog().definitions[id];
        let surface = DeckSurface::new(ship).unwrap();
        let reference = Reference::new(ship);
        let layout = ship
            .air_wing
            .as_ref()
            .unwrap()
            .deck_layout
            .as_ref()
            .unwrap();
        for ground in catalog().aircraft.values() {
            let mut poses: Vec<_> = layout
                .spots
                .iter()
                .map(|s| DeckPose {
                    position: s.position,
                    heading: 0.0,
                })
                .collect();
            for x in [-6.0, 0.0, 6.0] {
                for z in [0.0, 35.0, 70.0] {
                    for angle in 0..24 {
                        let at = DeckPose {
                            position: [x, reference.height(x, z).unwrap(), z],
                            heading: angle as f64 * PI / 12.0,
                        };
                        // Some turns put a main tyre into the island cutout.
                        // Only demand solutions for independently supported poses.
                        if contacts(ground).iter().all(|&p| {
                            let p = add(
                                at.position,
                                rotate(
                                    p,
                                    Pose {
                                        heading: at.heading,
                                        pitch: ground.pitch,
                                        ..Default::default()
                                    },
                                ),
                            );
                            reference.height(p[0], p[2]).is_some()
                        }) {
                            poses.push(at);
                        }
                    }
                }
            }
            if id == "enterprise-cv6" {
                poses.push(DeckPose {
                    position: [-0.5, 16.472, -71.86128257887508],
                    heading: 0.0,
                });
            }
            for e in &layout.elevators {
                poses.push(DeckPose {
                    position: e.position,
                    heading: 0.0,
                });
            }
            for at in poses {
                let label = format!("{id}/{} at {at:?}", ground.id);
                let fitted = surface
                    .fit(ship, ground, at)
                    .unwrap_or_else(|| panic!("{label}: no contact solution"));
                assert!(
                    (fitted.root[0] - at.position[0]).hypot(fitted.root[2] - at.position[2])
                        <= 0.03,
                    "Tyre settling exceeded 3 cm"
                );
                assert_eq!(fitted.attitude.heading, at.heading, "Taxi yaw changed");
                assert_contact(&reference, ground, fitted, 0.0, &label);
                // Reusing the original route datum is stable; a rendered root
                // must never be reused as a new datum and accumulate clearance.
                let repeated = surface.fit(ship, ground, at).unwrap();
                assert_eq!(fitted.root, repeated.root);
                assert_eq!(fitted.attitude, repeated.attitude);
                if at.heading == 0.0
                    || (at.position[0] == 0.0
                        && at.position[2] == 35.0
                        && (at.heading - PI / 4.0).abs() < 1e-8)
                {
                    samples.push(serde_json::json!({"ship":id,"model":ground.id,"modelHash":ground.deck_geometry.as_ref().unwrap().model_hash,"datum":at.position,"heading":at.heading,"root":fitted.root,"attitude":fitted.attitude,"contacts":contacts(ground)}));
                }
            }
        }
    }
    if let Ok(path) = std::env::var("DECK_CONTACT_SAMPLES") {
        std::fs::write(
            path,
            serde_json::to_vec(
                &serde_json::json!({"manifestHash":catalog().manifest_hash,"samples":samples}),
            )
            .unwrap(),
        )
        .unwrap();
    }
}

#[test]
fn aircraft_contacts_ride_the_platform_through_intermediate_lift_heights() {
    for id in CARRIERS {
        let ship = &catalog().definitions[id];
        let surface = DeckSurface::new(ship).unwrap();
        let reference = Reference::new(ship);
        let layout = ship
            .air_wing
            .as_ref()
            .unwrap()
            .deck_layout
            .as_ref()
            .unwrap();
        for e in &layout.elevators {
            for ground in catalog().aircraft.values() {
                for fraction in [0.0, 0.25, 0.5, 0.75, 0.99, 0.995, 0.999, 1.0] {
                    let y = e.hangar_y + fraction * (e.position[1] - e.hangar_y);
                    let at = DeckPose {
                        position: [e.position[0], y, e.position[2]],
                        heading: 0.0,
                    };
                    let fit = surface.fit(ship, ground, at).unwrap_or_else(|| {
                        panic!("{id}/{}: unsupported lift at {fraction}", ground.id)
                    });
                    assert_contact(
                        &reference,
                        ground,
                        fit,
                        y - e.position[1],
                        &format!("{id}/{} lift {fraction}", ground.id),
                    );
                }
            }
        }
    }
}

#[test]
fn fitted_contact_composes_with_translated_pitched_and_rolled_carrier() {
    for id in CARRIERS {
        let compiled = Arc::new(CompiledShip::new(catalog().definitions[id].clone()).unwrap());
        let mut actor = Vessel::new("carrier", TeamId::A, compiled);
        actor.motion.x = 730.0;
        actor.motion.y = -0.9;
        actor.motion.z = -1250.0;
        actor.motion.heading = 1.7;
        actor.motion.pitch = 0.08;
        actor.motion.roll = -0.11;
        let mut wing = create_air_wing(
            actor.definition(),
            &actor.motion.id,
            actor.team,
            &catalog().aircraft,
        )
        .unwrap();
        for ground in catalog().aircraft.values() {
            let plane = &mut wing.planes[0];
            for heading in [0.0, 0.37, 1.2, 2.6, -2.7] {
                let at = DeckPose {
                    position: [6.0, 16.0, 45.0],
                    heading,
                };
                let fit = actor
                    .compiled
                    .deck_surface
                    .as_ref()
                    .unwrap()
                    .fit(actor.definition(), ground, at)
                    .unwrap();
                place(plane, &actor, at, ground);
                assert_eq!(plane.deck_datum, Some(at.position));
                assert_eq!(plane.deck_position, Some(fit.root));
                assert_eq!(
                    plane.position,
                    local_to_world(fit.root, actor.motion.pose())
                );
                let attitude = Pose {
                    heading: plane.heading,
                    pitch: plane.pitch,
                    roll: plane.bank,
                    ..Default::default()
                };
                assert_contact(
                    &Reference::new(actor.definition()),
                    ground,
                    fit,
                    0.0,
                    &format!("{id}/{} tilted carrier", ground.id),
                );
                for local in contacts(ground) {
                    let actual = add(plane.position, rotate(local, attitude));
                    let expected = local_to_world(
                        add(fit.root, rotate(local, fit.attitude)),
                        actor.motion.pose(),
                    );
                    assert!(
                        sub(actual, expected).iter().all(|v| v.abs() < 1e-9),
                        "{id}/{} at {heading}: compound rotation moved tyre",
                        ground.id
                    );
                    let recovered = world_to_local(actual, actor.motion.pose());
                    let local_expected = add(fit.root, rotate(local, fit.attitude));
                    assert!(
                        sub(recovered, local_expected)
                            .iter()
                            .all(|v| v.abs() < 1e-9)
                    );
                }
            }
        }
    }
}

#[test]
fn missing_or_unsupported_contact_geometry_is_rejected() {
    let ship = &catalog().definitions["enterprise-cv6"];
    let surface = DeckSurface::new(ship).unwrap();
    let ground = &catalog().aircraft["f4f-4-wildcat"];
    for position in [[100.0, 16.5, 40.0], [14.0, 16.5, 40.0], [0.0, 16.5, 150.0]] {
        assert!(
            surface
                .fit(
                    ship,
                    ground,
                    DeckPose {
                        position,
                        heading: 0.0
                    }
                )
                .is_none()
        );
    }
    let at = DeckPose {
        position: [0.0, 16.5, 40.0],
        heading: 0.0,
    };
    let mut missing = ground.clone();
    missing.deck_geometry = None;
    assert!(surface.fit(ship, &missing, at).is_none());
    let mut empty = ground.clone();
    Arc::make_mut(&mut empty.deck_geometry.as_mut().unwrap().tyres).clear();
    assert!(
        surface.fit(ship, &empty, at).is_none(),
        "Empty tyre patches must not be accepted as contact"
    );
}

#[test]
fn unsupported_placement_preserves_the_aircraft_and_its_previous_controls() {
    let compiled =
        Arc::new(CompiledShip::new(catalog().definitions["enterprise-cv6"].clone()).unwrap());
    let actor = Vessel::new("carrier", TeamId::A, compiled);
    let mut wing = create_air_wing(
        actor.definition(),
        &actor.motion.id,
        actor.team,
        &catalog().aircraft,
    )
    .unwrap();
    let plane = &mut wing.planes[0];
    let ground = &catalog().aircraft[&plane.model_id];
    assert!(place(
        plane,
        &actor,
        DeckPose {
            position: [0.0, 16.472, 40.0],
            heading: 0.3
        },
        ground
    ));
    // An attempted placement must not partially clamp the interpolation state
    // before discovering that no wheel-supported pose exists.
    plane.controls.hook = 1.0;
    plane.previous_controls = Some(plane.controls);
    let before = serde_json::to_value(&*plane).unwrap();
    assert!(!place(
        plane,
        &actor,
        DeckPose {
            position: [100.0, 16.472, 40.0],
            heading: 1.0
        },
        ground
    ));
    assert_eq!(serde_json::to_value(&*plane).unwrap(), before);
}

#[test]
fn malformed_authored_surface_indices_reject_the_entire_cache() {
    // Corrupt the last platform, after valid deck/platform triangles have
    // already compiled, to ensure invalid data cannot produce a partial cache.
    for bad in [-1.0, 0.5, f64::NAN, f64::INFINITY, 1_000_000.0] {
        let mut ship = catalog().definitions["enterprise-cv6"].as_ref().clone();
        let platform = ship
            .structures
            .as_mut()
            .unwrap()
            .iter_mut()
            .find(|s| s.id == "elevator-aft")
            .unwrap();
        platform.surface.as_mut().unwrap().triangles[0][0] = bad;
        assert!(
            DeckSurface::new(&ship).is_none(),
            "Accepted triangle index {bad}"
        );
    }
}

#[test]
fn malformed_surface_coordinates_and_unbounded_triangle_spans_are_rejected() {
    for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, 1e9, -1e9] {
        let mut ship = catalog().definitions["enterprise-cv6"].as_ref().clone();
        let deck = ship
            .structures
            .as_mut()
            .unwrap()
            .iter_mut()
            .find(|s| s.id == "flight-deck")
            .unwrap();
        // Unreferenced bad vertices must also fail before other geometry
        // consumers encounter the same malformed authored surface.
        deck.surface
            .as_mut()
            .unwrap()
            .vertices
            .push([bad, 16.0, 0.0]);
        assert!(DeckSurface::new(&ship).is_none(), "Accepted vertex {bad}");
    }
    let mut ship = catalog().definitions["enterprise-cv6"].as_ref().clone();
    let deck = ship
        .structures
        .as_mut()
        .unwrap()
        .iter_mut()
        .find(|s| s.id == "flight-deck")
        .unwrap();
    let mesh = deck.surface.as_mut().unwrap();
    // Coordinates are finite and each fits the cache's broad coordinate range,
    // but one triangle must not allocate millions of spatial cells.
    mesh.vertices = vec![
        [-9000.0, 16.0, -9000.0],
        [9000.0, 16.0, -9000.0],
        [0.0, 16.0, 9000.0],
    ];
    mesh.triangles = vec![[0.0, 1.0, 2.0]];
    assert!(DeckSurface::new(&ship).is_none());
}

#[test]
fn repeated_surfaces_cannot_exhaust_construction_or_height_query_budgets() {
    for (span, repeats) in [(1.0, 20_000), (400.0, 120), (1.0, 6_000)] {
        let mut ship = catalog().definitions["enterprise-cv6"].as_ref().clone();
        let deck = ship
            .structures
            .as_mut()
            .unwrap()
            .iter_mut()
            .find(|s| s.id == "flight-deck")
            .unwrap();
        let mesh = deck.surface.as_mut().unwrap();
        mesh.vertices = vec![[0.0, 16.0, 0.0], [span, 16.0, 0.0], [0.0, 16.0, span]];
        mesh.triangles = vec![[0.0, 1.0, 2.0]; repeats];
        assert!(
            DeckSurface::new(&ship).is_none(),
            "Accepted {repeats} repeated {span}m triangles"
        );
    }
}

#[test]
fn nonfinite_height_queries_and_empty_authored_surfaces_are_rejected() {
    let mut ship = catalog().definitions["enterprise-cv6"].as_ref().clone();
    let surface = DeckSurface::new(&ship).unwrap();
    for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, 1e9] {
        assert!(surface.height(bad, 0.0).is_none());
        assert!(surface.height(0.0, bad).is_none());
    }
    let deck = ship
        .structures
        .as_mut()
        .unwrap()
        .iter_mut()
        .find(|s| s.id == "flight-deck")
        .unwrap();
    deck.surface.as_mut().unwrap().triangles.clear();
    assert!(
        DeckSurface::new(&ship).is_none(),
        "Platforms alone cannot replace an invalid authored deck"
    );
    let mesh = ship
        .structures
        .as_mut()
        .unwrap()
        .iter_mut()
        .find(|s| s.id == "flight-deck")
        .unwrap()
        .surface
        .as_mut()
        .unwrap();
    mesh.vertices = vec![[0.0, 10.0, 0.0], [0.0, 16.0, 0.0], [1.0, 16.0, 0.0]];
    mesh.triangles = vec![[0.0, 1.0, 2.0]];
    assert!(
        DeckSurface::new(&ship).is_none(),
        "A vertical wall cannot replace the deck cap"
    );
}

#[test]
fn parked_contact_cache_follows_carrier_motion_without_drift_and_rebuilds_after_restore() {
    let c = catalog();
    let mut actor = Vessel::new(
        "carrier",
        TeamId::A,
        Arc::new(CompiledShip::new(c.definitions["enterprise-cv6"].clone()).unwrap()),
    );
    let mut air = naval_sim::aviation::Aviation::new(&[actor.clone()], c.aircraft.clone());
    let plane = &mut air.wings[0].state.planes[0];
    let ground = &c.aircraft[&plane.model_id];
    let at = DeckPose {
        position: [8.8, 16.431877, 32.0],
        heading: 0.4,
    };
    assert!(naval_sim::deck_operations::place(plane, &actor, at, ground));
    let root = plane.deck_position.unwrap();
    let local = plane.deck_local_attitude.unwrap();
    for i in 0..120 {
        actor.motion.x += 0.2;
        actor.motion.heading = i as f64 * 0.02;
        actor.motion.pitch = (i as f64 * 0.1).sin() * 0.07;
        actor.motion.roll = (i as f64 * 0.1).cos() * 0.12;
        assert!(naval_sim::deck_operations::place(plane, &actor, at, ground));
        assert_eq!(plane.deck_datum, Some(at.position));
        assert_eq!(plane.deck_position, Some(root));
        assert!(
            length(sub(
                plane.position,
                local_to_world(root, actor.motion.pose())
            )) < 1e-9
        );
        let expected = compose_attitude(
            actor.motion.pose(),
            Pose {
                heading: local.heading,
                pitch: local.pitch,
                roll: local.bank,
                ..Default::default()
            },
        );
        assert!((plane.heading - expected.heading).abs() < 1e-9);
        assert!((plane.pitch - expected.pitch).abs() < 1e-9);
        assert!((plane.bank - expected.bank).abs() < 1e-9);
    }
    let mut restored: naval_sim::aircraft::Aircraft =
        serde_json::from_value(serde_json::to_value(&*plane).unwrap()).unwrap();
    assert!(restored.deck_local_attitude.is_none());
    assert!(naval_sim::deck_operations::place(
        &mut restored,
        &actor,
        at,
        ground
    ));
    assert_eq!(restored.deck_position, Some(root));
}

#[test]
fn public_tyre_query_rejects_bad_patches_poses_and_excessive_patch_counts() {
    let surface = DeckSurface::new(&catalog().definitions["enterprise-cv6"]).unwrap();
    let patch = [[0.0, 16.5, 0.0], [1.0, 16.5, 0.0], [0.0, 16.5, 1.0]];
    assert!(surface.tyre_gap(&[], [0.0; 3], Pose::default()).is_none());
    assert!(
        surface
            .tyre_gap(&[patch; 501], [0.0; 3], Pose::default())
            .is_none()
    );
    for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, 1e9] {
        let mut malformed = patch;
        malformed[1][0] = bad;
        assert!(
            surface
                .tyre_gap(&[malformed], [0.0; 3], Pose::default())
                .is_none()
        );
        assert!(
            surface
                .tyre_gap(&[patch], [bad, 0.0, 0.0], Pose::default())
                .is_none()
        );
    }
    for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        for attitude in [
            Pose {
                heading: bad,
                ..Default::default()
            },
            Pose {
                pitch: bad,
                ..Default::default()
            },
            Pose {
                roll: bad,
                ..Default::default()
            },
        ] {
            assert!(surface.tyre_gap(&[patch], [0.0; 3], attitude).is_none());
        }
    }
    let mut outside = patch;
    outside[0][0] = 26.0;
    assert!(
        surface
            .tyre_gap(&[outside], [0.0; 3], Pose::default())
            .is_none()
    );
    let near_limit = [[20.0, 0.0, 0.0], [21.0, 0.0, 0.0], [20.0, 0.0, 1.0]];
    assert!(
        surface
            .tyre_gap(&[near_limit], [9990.0, 0.0, 0.0], Pose::default())
            .is_none(),
        "Individually valid root and patch cannot transform outside the coordinate budget"
    );
}

#[test]
fn individually_admitted_surface_and_patches_still_obey_a_combined_query_budget() {
    let mut ship = catalog().definitions["enterprise-cv6"].as_ref().clone();
    let mesh = ship
        .structures
        .as_mut()
        .unwrap()
        .iter_mut()
        .find(|s| s.id == "flight-deck")
        .unwrap()
        .surface
        .as_mut()
        .unwrap();
    mesh.vertices = vec![[0.0, 16.0, 0.0], [1.0, 16.0, 0.0], [0.0, 16.0, 1.0]];
    mesh.triangles = vec![[0.0, 1.0, 2.0]; 2000];
    let surface =
        DeckSurface::new(&ship).expect("Dense but bounded authored surface should be admitted");
    let patch = [[0.1, 16.0, 0.1], [0.4, 16.0, 0.1], [0.1, 16.0, 0.4]];
    assert!(
        surface
            .tyre_gap(&[patch], [0.0; 3], Pose::default())
            .unwrap()
            .abs()
            < 1e-9
    );
    assert!(
        surface
            .tyre_gap(&[patch; 500], [0.0; 3], Pose::default())
            .is_none(),
        "Repeated patch/surface products must not evade the per-query work budget"
    );
}
