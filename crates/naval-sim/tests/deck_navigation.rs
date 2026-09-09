use naval_sim::{catalog::Catalog, deck_navigation::DeckTraffic, flight_deck::DeckPose};
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

#[test]
fn both_full_decks_have_an_order_of_clear_paths_to_the_launch_datum() {
    for id in ["enterprise-cv6", "shokaku"] {
        let ship = &catalog().definitions[id];
        let wing = ship.air_wing.as_ref().unwrap();
        let layout = wing.deck_layout.as_ref().unwrap();
        let mut remaining: Vec<_> = layout
            .spots
            .iter()
            .map(|s| {
                let model = &wing
                    .squadrons
                    .iter()
                    .find(|p| p.role == s.preferred_role)
                    .unwrap()
                    .model_id;
                (
                    &s.id,
                    catalog().aircraft[model].deck_geometry.as_ref().unwrap(),
                    pose(s.position),
                )
            })
            .collect();
        remaining.sort_by(|a, b| {
            a.2.position[2]
                .total_cmp(&b.2.position[2])
                .then_with(|| a.2.position[0].abs().total_cmp(&b.2.position[0].abs()))
        });
        let mut cleared = vec![];
        while !remaining.is_empty() {
            let mut found = None;
            for (i, &(name, model, from)) in remaining.iter().enumerate() {
                let occupied: Vec<_> = remaining
                    .iter()
                    .enumerate()
                    .filter(|(j, _)| *j != i)
                    .map(|(_, (_, g, p))| (g.parked, *p))
                    .collect();
                let traffic = DeckTraffic {
                    ship,
                    occupied: &occupied,
                };
                if let Some(route) = traffic.route(model, from, pose(layout.launch_start)) {
                    assert_eq!(route.last().unwrap().position, layout.launch_start);
                    let mut previous = from;
                    for point in route {
                        assert!(traffic.segment_clear(model, previous, point));
                        previous = point;
                    }
                    cleared.push(name.clone());
                    found = Some(i);
                    break;
                }
            }
            let Some(index) = found else {
                panic!(
                    "{id}: no safe departure after {:?}; remaining {:?}",
                    cleared,
                    remaining.iter().map(|p| p.0).collect::<Vec<_>>()
                )
            };
            remaining.remove(index);
        }
        assert_eq!(cleared.len(), 24);
    }
}

#[test]
fn empty_deck_allows_recovery_to_elevator_and_rejects_unsupported_destinations() {
    for id in ["enterprise-cv6", "shokaku"] {
        let ship = &catalog().definitions[id];
        let wing = ship.air_wing.as_ref().unwrap();
        let layout = wing.deck_layout.as_ref().unwrap();
        let traffic = DeckTraffic {
            ship,
            occupied: &[],
        };
        for pool in &wing.squadrons {
            let model = catalog().aircraft[&pool.model_id]
                .deck_geometry
                .as_ref()
                .unwrap();
            assert!(
                traffic
                    .route(
                        model,
                        pose(layout.recovery_stop),
                        pose(layout.elevators[0].position)
                    )
                    .is_some(),
                "{id} / {}",
                pool.model_id
            );
            assert!(
                traffic
                    .route(
                        model,
                        pose(layout.recovery_stop),
                        pose([100.0, layout.recovery_stop[1], 0.0])
                    )
                    .is_none()
            );
        }
    }
}

#[test]
fn routing_yields_within_budget_and_invalidates_paths_when_the_deck_changes() {
    use naval_sim::deck_navigation::RouteProgress;
    let ship = &catalog().definitions["enterprise-cv6"];
    let wing = ship.air_wing.as_ref().unwrap();
    let layout = wing.deck_layout.as_ref().unwrap();
    let pool = wing.squadrons.iter().find(|p| p.role == "fighter").unwrap();
    let model = catalog().aircraft[&pool.model_id]
        .deck_geometry
        .as_ref()
        .unwrap();
    let from = pose(
        layout
            .spots
            .iter()
            .find(|s| s.preferred_role == "fighter")
            .unwrap()
            .position,
    );
    let to = pose(layout.launch_start);
    let traffic = DeckTraffic {
        ship,
        occupied: &[],
    };
    let mut search = traffic.begin_route(model, from, to, 7);
    assert!(matches!(
        search.advance(&traffic, 7, 0),
        RouteProgress::Pending
    ));
    assert_eq!(search.visited_nodes(), 0);
    assert!(matches!(
        search.advance(&traffic, 7, 1),
        RouteProgress::Pending
    ));
    assert_eq!(search.visited_nodes(), 1);
    assert!(matches!(
        search.advance(&traffic, 8, 16),
        RouteProgress::Invalidated
    ));
    assert_eq!(search.visited_nodes(), 1);
    // An invalidated search cannot resume even if the old revision is supplied.
    assert!(matches!(
        search.advance(&traffic, 7, 16),
        RouteProgress::Invalidated
    ));

    let mut search = traffic.begin_route(model, from, to, 8);
    let path = loop {
        let before = search.visited_nodes();
        let result = search.advance(&traffic, 8, 16).clone();
        assert!(search.visited_nodes() - before <= 16);
        match result {
            RouteProgress::Pending => continue,
            RouteProgress::Found(path) => break path,
            other => panic!("Expected a clear route around the island: {other:?}"),
        }
    };
    assert_eq!(path.last().unwrap().position, to.position);
    let mut previous = from;
    for point in path {
        assert!(traffic.segment_clear(model, previous, point));
        previous = point;
    }
    // A completed route is stale too; callers must reserve before changing the
    // deck revision or publishing it to a moving aircraft.
    assert!(matches!(
        search.advance(&traffic, 9, 0),
        RouteProgress::Invalidated
    ));
}
