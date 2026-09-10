use naval_sim::{
    catalog::Catalog,
    flight_deck::{DeckPose, Envelope},
};
use std::sync::OnceLock;

fn catalog() -> &'static Catalog {
    static CONTENT: OnceLock<Catalog> = OnceLock::new();
    CONTENT.get_or_init(|| {
        Catalog::load(&std::fs::read("../../.build/naval-content/manifest.json").unwrap()).unwrap()
    })
}
fn pose(position: [f64; 3]) -> DeckPose {
    DeckPose {
        position,
        heading: 0.0,
    }
}
fn envelope(model: &str) -> Envelope {
    catalog().aircraft[model]
        .deck_geometry
        .as_ref()
        .unwrap()
        .parked
}

#[test]
fn authored_startup_packing_fits_both_real_wings_and_their_elevator() {
    for id in ["enterprise-cv6", "shokaku"] {
        let wing = catalog().definitions[id].air_wing.as_ref().unwrap();
        let layout = wing.deck_layout.as_ref().unwrap();
        let parked: Vec<_> = layout
            .spots
            .iter()
            .map(|spot| {
                let pool = wing
                    .squadrons
                    .iter()
                    .find(|s| s.role == spot.preferred_role)
                    .unwrap();
                (envelope(&pool.model_id), pose(spot.position))
            })
            .collect();
        assert_eq!(parked.len(), 24);
        for (i, &(a, p)) in parked.iter().enumerate() {
            for &(b, q) in &parked[i + 1..] {
                assert!(
                    !a.overlaps(p, b, q, 0.15),
                    "{id} parked aircraft overlap near {:?}",
                    p.position
                );
            }
            assert!(
                layout
                    .elevators
                    .iter()
                    .any(|e| a.max[0] - a.min[0] + 0.15 <= e.width_m
                        && a.max[2] - a.min[2] + 0.15 <= e.length_m)
            );
        }
    }
    // Current Japanese rigs have no folding hinges. Their actual full span,
    // including the Kate's 15.5 m wing, must participate in admission.
    for id in ["a6m2-zero", "d3a1-val", "b5n2-kate"] {
        let g = catalog().aircraft[id].deck_geometry.as_ref().unwrap();
        assert_eq!(g.parked.min, g.spread.min);
        assert_eq!(g.parked.max, g.spread.max);
    }
    let kate = envelope("b5n2-kate");
    assert!(kate.max[0] - kate.min[0] > 15.4);
    assert!(envelope("f4f-4-wildcat").max[0] < 2.1);
}

#[test]
fn clear_endpoints_do_not_allow_towing_through_another_plane_or_turning_into_it() {
    let dive = envelope("sbd-3-dauntless");
    let fighter = envelope("f4f-4-wildcat");
    let start = pose([0.0; 3]);
    let finish = pose([0.0, 0.0, -50.0]);
    let middle = pose([0.0, 0.0, -25.0]);
    assert!(!dive.overlaps(start, fighter, middle, 0.15));
    assert!(!dive.overlaps(finish, fighter, middle, 0.15));
    assert!(dive.swept_overlap(start, finish, fighter, middle));
    let turned = DeckPose {
        heading: std::f64::consts::FRAC_PI_2,
        ..start
    };
    let neighbor = pose([9.6, 0.0, 0.0]);
    assert!(!dive.overlaps(start, fighter, neighbor, 0.15));
    assert!(!dive.overlaps(turned, fighter, neighbor, 0.15));
    assert!(dive.swept_overlap(start, turned, fighter, neighbor));
}

#[test]
fn full_deck_needs_physical_clearance_before_recovery_but_forward_launch_lane_is_clear() {
    for id in ["enterprise-cv6", "shokaku"] {
        let wing = catalog().definitions[id].air_wing.as_ref().unwrap();
        let layout = wing.deck_layout.as_ref().unwrap();
        for pool in &wing.squadrons {
            let arrival = catalog().aircraft[&pool.model_id]
                .deck_geometry
                .as_ref()
                .unwrap()
                .spread;
            let blocked = |from, to| {
                layout.spots.iter().any(|s| {
                    let model = &wing
                        .squadrons
                        .iter()
                        .find(|p| p.role == s.preferred_role)
                        .unwrap()
                        .model_id;
                    arrival.swept_overlap(pose(from), pose(to), envelope(model), pose(s.position))
                })
            };
            assert!(
                blocked(layout.recovery_touchdown, layout.recovery_stop),
                "{id} must clear parked planes before landing"
            );
            assert!(
                !blocked(layout.launch_start, layout.launch_end),
                "{id} launch run intersects parked aircraft"
            );
        }
    }
}

#[test]
fn installed_aircraft_geometry_rejects_nonphysical_or_incomplete_sweep_bounds() {
    let mut geometry = catalog().aircraft["tbd-1-devastator"]
        .deck_geometry
        .clone()
        .unwrap();
    assert!(geometry.valid());
    geometry.sweep.max[0] = geometry.parked.max[0];
    assert!(!geometry.valid());
    geometry = catalog().aircraft["tbd-1-devastator"]
        .deck_geometry
        .clone()
        .unwrap();
    geometry.parked.min[1] = -3.0;
    assert!(!geometry.valid());
}
