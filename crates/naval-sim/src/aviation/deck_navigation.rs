//! Bounded ground-route search. A route includes its turns: a clear parking spot
//! and runway do not by themselves imply that an aircraft can move between them.
use super::flight_deck::{AircraftDeckGeometry, DeckPose, Envelope, inside};
use crate::{
    definition::ShipDefinition,
    geometry::{length, sub, wrap_angle},
};
use std::{
    cmp::Ordering,
    collections::{BTreeMap, BinaryHeap},
};

pub(super) struct DeckTraffic<'a> {
    pub ship: &'a ShipDefinition,
    pub surface: &'a crate::aviation::deck_contact::DeckSurface,
    /// Excludes the moving aircraft; includes occupied and reserved destinations.
    pub occupied: &'a [(Envelope, DeckPose)],
}

fn intersect(a: [f64; 2], b: [f64; 2], c: [f64; 2], d: [f64; 2]) -> bool {
    let cross = |p: [f64; 2], q: [f64; 2], r: [f64; 2]| {
        (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
    };
    let (ab_c, ab_d, cd_a, cd_b) = (
        cross(a, b, c),
        cross(a, b, d),
        cross(c, d, a),
        cross(c, d, b),
    );
    // The bounding check also handles parallel, collinear edges.
    ab_c * ab_d <= 0.0
        && cd_a * cd_b <= 0.0
        && (0..2).all(|i| a[i].min(b[i]) <= c[i].max(d[i]) && c[i].min(d[i]) <= a[i].max(b[i]))
}
#[cfg(test)]
thread_local! {
    static OVERLAP_SCANS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}
fn polygons_overlap(a: &[[f64; 2]], b: &[[f64; 2]]) -> bool {
    // Most height-compatible fittings are far from a route sample. Reject only
    // disjoint bounds; touching/near-touching edges keep the exact predicate.
    // Non-finite input falls through to the original polygon checks.
    let bounds = |polygon: &[[f64; 2]]| {
        let (mut low, mut high) = ([f64::INFINITY; 2], [f64::NEG_INFINITY; 2]);
        for point in polygon {
            for axis in 0..2 {
                if !point[axis].is_finite() {
                    return None;
                }
                low[axis] = low[axis].min(point[axis]);
                high[axis] = high[axis].max(point[axis]);
            }
        }
        Some((low, high))
    };
    if let (Some((al, ah)), Some((bl, bh))) = (bounds(a), bounds(b))
        && (0..2).any(|i| ah[i] + 1e-7 < bl[i] || bh[i] + 1e-7 < al[i])
    {
        return false;
    }
    #[cfg(test)]
    OVERLAP_SCANS.set(OVERLAP_SCANS.get() + 1);
    a.iter().any(|p| inside(b, p[0], p[1]))
        || b.iter().any(|p| inside(a, p[0], p[1]))
        || a.iter().enumerate().any(|(i, &p)| {
            b.iter()
                .enumerate()
                .any(|(j, &q)| intersect(p, a[(i + 1) % a.len()], q, b[(j + 1) % b.len()]))
        })
}

impl DeckTraffic<'_> {
    pub(super) fn clear(&self, model: &AircraftDeckGeometry, pose: DeckPose) -> bool {
        let Some(layout) = self
            .ship
            .air_wing
            .as_ref()
            .and_then(|w| w.deck_layout.as_ref())
        else {
            return false;
        };
        let structures = self.ship.structures.as_deref().unwrap_or_default();
        let Some(deck) = structures.iter().find(|s| s.id == layout.surface_id) else {
            return false;
        };
        if !pose.position.iter().all(|p| p.is_finite())
            || !pose.heading.is_finite()
            || (pose.position[1] - deck.base_y - deck.height).abs() > 0.5
        {
            return false;
        }
        let (sin, cos) = pose.heading.sin_cos();
        // Wing overhang is allowed; every actual tyre must remain supported.
        if model.support.iter().any(|p| {
            !inside(
                &deck.footprint,
                pose.position[0] + cos * p[0] - sin * p[2],
                pose.position[2] + sin * p[0] + cos * p[2],
            ) || self
                .surface
                .height(
                    pose.position[0] + cos * p[0] - sin * p[2],
                    pose.position[2] + sin * p[0] + cos * p[2],
                )
                .is_none()
        }) {
            return false;
        }
        if self
            .occupied
            .iter()
            .any(|&(other, at)| model.parked.overlaps(pose, other, at, 0.15))
        {
            return false;
        }
        !structures.iter().any(|s| {
            // The ground itself, flush platforms and subsurface structures are
            // supports. Tall fittings remain obstacles at all intermediate poses.
            s.base_y + s.height > pose.position[1] + 0.25
                && s.base_y < pose.position[1] + model.parked.max[1]
                && model.layers.iter().any(|layer| {
                    s.base_y + s.height > pose.position[1] + layer.min[1]
                        && s.base_y < pose.position[1] + layer.max[1]
                        && polygons_overlap(&layer.corners(pose, 0.15), &s.footprint)
                })
        })
    }
    pub(super) fn segment_clear(
        &self,
        model: &AircraftDeckGeometry,
        from: DeckPose,
        to: DeckPose,
    ) -> bool {
        let turn = wrap_angle(to.heading - from.heading);
        let radius = model.parked.min[0]
            .abs()
            .max(model.parked.max[0].abs())
            .hypot(model.parked.min[2].abs().max(model.parked.max[2].abs()));
        let travel = length(sub(to.position, from.position));
        if !turn.is_finite() || !travel.is_finite() || travel > 500.0 {
            return false;
        }
        let count = ((travel + turn.abs() * radius) / 0.1).ceil().max(1.0) as usize;
        (0..=count).all(|i| {
            let t = i as f64 / count as f64;
            self.clear(
                model,
                DeckPose {
                    position: std::array::from_fn(|j| {
                        from.position[j] + (to.position[j] - from.position[j]) * t
                    }),
                    heading: from.heading + turn * t,
                },
            )
        })
    }
    fn connection(
        &self,
        model: &AircraftDeckGeometry,
        from: DeckPose,
        to: DeckPose,
    ) -> Option<Vec<DeckPose>> {
        let delta = sub(to.position, from.position);
        let heading = if delta[0].hypot(delta[2]) < 0.01 {
            from.heading
        } else {
            delta[0].atan2(-delta[2])
        };
        let mut headings = [heading, wrap_angle(heading + std::f64::consts::PI)];
        let cost = |h: f64| wrap_angle(h - from.heading).abs() + wrap_angle(to.heading - h).abs();
        headings.sort_by(|a, b| cost(*a).total_cmp(&cost(*b)));
        headings.into_iter().find_map(|heading| {
            let turn = DeckPose { heading, ..from };
            let arrive = DeckPose { heading, ..to };
            (self.segment_clear(model, from, turn)
                && self.segment_clear(model, turn, arrive)
                && self.segment_clear(model, arrive, to))
            .then_some(vec![turn, arrive, to])
        })
    }
    /// Start a search against an immutable deck revision. Increment the revision
    /// whenever an occupied/reserved pose, fold state or ship definition changes.
    pub(super) fn begin_route(
        &self,
        model: &AircraftDeckGeometry,
        from: DeckPose,
        to: DeckPose,
        revision: u64,
    ) -> RouteSearch {
        RouteSearch {
            model: model.clone(),
            ship_id: self.ship.id.clone(),
            revision,
            from,
            to,
            initialized: false,
            frontier: BinaryHeap::new(),
            best: BTreeMap::new(),
            visited: 0,
            progress: RouteProgress::Pending,
        }
    }
    /// Blocking convenience for offline layout validation. Simulation callers
    /// must retain a search and advance it with a per-tick node budget instead.
    #[cfg(test)]
    pub(super) fn route(
        &self,
        model: &AircraftDeckGeometry,
        from: DeckPose,
        to: DeckPose,
    ) -> Option<Vec<DeckPose>> {
        let mut search = self.begin_route(model, from, to, 0);
        loop {
            match search.advance(self, 0, SEARCH_LIMIT) {
                RouteProgress::Pending => {}
                RouteProgress::Found(path) => return Some(path.clone()),
                RouteProgress::Blocked | RouteProgress::Invalidated => return None,
            }
        }
    }
}

type Key = (i16, i16, u8);
const SEARCH_LIMIT: usize = 6000;

#[derive(Clone, Debug)]
pub(super) enum RouteProgress {
    Pending,
    Found(Vec<DeckPose>),
    Blocked,
    Invalidated,
}

/// Grid nodes retain heading and allow forward/reverse motion plus finite
/// pivots. Every edge is checked against the same revision. A search owns its
/// aircraft geometry, so switching aircraft cannot reuse another model's path.
#[derive(Clone, Debug)]
pub(super) struct RouteSearch {
    model: AircraftDeckGeometry,
    ship_id: String,
    revision: u64,
    from: DeckPose,
    to: DeckPose,
    initialized: bool,
    frontier: BinaryHeap<Candidate>,
    best: BTreeMap<Key, (f64, Option<Key>)>,
    visited: usize,
    progress: RouteProgress,
}
impl RouteSearch {
    fn at(&self, k: Key) -> DeckPose {
        DeckPose {
            position: [
                self.from.position[0] + f64::from(k.0) * 2.0,
                self.from.position[1],
                self.from.position[2] + f64::from(k.1) * 2.0,
            ],
            heading: f64::from(k.2) * std::f64::consts::FRAC_PI_4,
        }
    }
    #[cfg(test)]
    pub(super) fn visited_nodes(&self) -> usize {
        self.visited
    }
    /// Work is bounded by node expansions, not elapsed wall time, preserving
    /// replay determinism. A zero budget performs no geometry work. Direct
    /// connection and initial-turn validation consume the first work unit.
    pub(super) fn advance(
        &mut self,
        traffic: &DeckTraffic<'_>,
        revision: u64,
        node_budget: usize,
    ) -> &RouteProgress {
        if revision != self.revision || traffic.ship.id != self.ship_id {
            self.progress = RouteProgress::Invalidated;
        }
        if !matches!(self.progress, RouteProgress::Pending) {
            return &self.progress;
        }
        for _ in 0..node_budget {
            if self.visited >= SEARCH_LIMIT {
                self.progress = RouteProgress::Blocked;
                break;
            }
            self.visited += 1;
            if !self.initialized {
                self.initialized = true;
                if !self.model.valid()
                    || !traffic.clear(&self.model, self.from)
                    || !traffic.clear(&self.model, self.to)
                {
                    self.progress = RouteProgress::Blocked;
                    break;
                }
                if let Some(path) = traffic.connection(&self.model, self.from, self.to) {
                    self.progress = RouteProgress::Found(path);
                    break;
                }
                let heading =
                    (wrap_angle(self.from.heading) / std::f64::consts::FRAC_PI_4).round() as i32;
                let first = (0, 0, heading.rem_euclid(8) as u8);
                if !traffic.segment_clear(&self.model, self.from, self.at(first)) {
                    self.progress = RouteProgress::Blocked;
                    break;
                }
                self.best.insert(first, (0.0, None));
                self.frontier.push(Candidate {
                    estimate: 0.0,
                    cost: 0.0,
                    key: first,
                });
                continue;
            }
            let Some(current) = self.frontier.pop() else {
                self.progress = RouteProgress::Blocked;
                break;
            };
            if current.cost > self.best[&current.key].0 {
                continue;
            }
            let here = self.at(current.key);
            if (here.position[0] - self.to.position[0])
                .hypot(here.position[2] - self.to.position[2])
                < 3.0
                && let Some(mut tail) = traffic.connection(&self.model, here, self.to)
            {
                let mut path = vec![here];
                let mut key = current.key;
                while let Some(parent) = self.best[&key].1 {
                    path.push(self.at(parent));
                    key = parent;
                }
                path.reverse();
                path.append(&mut tail);
                self.progress = RouteProgress::Found(path);
                break;
            }
            let (x, z, h) = current.key;
            let direction = [
                (0, -1),
                (1, -1),
                (1, 0),
                (1, 1),
                (0, 1),
                (-1, 1),
                (-1, 0),
                (-1, -1),
            ][h as usize];
            for next in [
                (x + direction.0, z + direction.1, h),
                (x - direction.0, z - direction.1, h),
                (x, z, (h + 1) % 8),
                (x, z, (h + 7) % 8),
            ] {
                let there = self.at(next);
                let cost = current.cost
                    + length(sub(there.position, here.position))
                    + wrap_angle(there.heading - here.heading).abs() * 5.0;
                if self.best.get(&next).is_some_and(|v| v.0 <= cost)
                    || !traffic.segment_clear(&self.model, here, there)
                {
                    continue;
                }
                self.best.insert(next, (cost, Some(current.key)));
                self.frontier.push(Candidate {
                    estimate: cost
                        + (there.position[0] - self.to.position[0])
                            .hypot(there.position[2] - self.to.position[2]),
                    cost,
                    key: next,
                });
            }
        }
        &self.progress
    }
}
#[derive(Clone, Copy, Debug)]
struct Candidate {
    estimate: f64,
    cost: f64,
    key: (i16, i16, u8),
}
impl PartialEq for Candidate {
    fn eq(&self, other: &Self) -> bool {
        self.estimate == other.estimate && self.key == other.key
    }
}
impl Eq for Candidate {}
impl PartialOrd for Candidate {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for Candidate {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .estimate
            .total_cmp(&self.estimate)
            .then_with(|| other.key.cmp(&self.key))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::aviation::{deck_contact::DeckSurface, test_support::catalog};

    fn pose(position: [f64; 3]) -> DeckPose {
        DeckPose {
            position,
            heading: 0.0,
        }
    }

    #[test]
    fn obstacle_overlap_matches_polygon_reference_at_rotated_and_touching_edges() {
        let reference = |a: &[[f64; 2]], b: &[[f64; 2]]| {
            a.iter().any(|p| inside(b, p[0], p[1]))
                || b.iter().any(|p| inside(a, p[0], p[1]))
                || a.iter().enumerate().any(|(i, &p)| {
                    b.iter()
                        .enumerate()
                        .any(|(j, &q)| intersect(p, a[(i + 1) % a.len()], q, b[(j + 1) % b.len()]))
                })
        };
        let rectangle = Envelope {
            min: [-2., 0., -3.],
            max: [2., 1., 3.],
        };
        let concave = [
            [-3., -3.],
            [3., -3.],
            [3., -1.],
            [-1., -1.],
            [-1., 3.],
            [-3., 3.],
        ];
        for heading in [0., 0.27, 1.57, 2.3, std::f64::consts::PI] {
            for x in [-100., -5., -4.99999999, -2., 0., 2., 4.99999999, 5., 100.] {
                for z in [-100., -6., -5.99999999, -2., 0., 2., 5.99999999, 6., 100.] {
                    let a = rectangle.corners(
                        DeckPose {
                            position: [x, 0., z],
                            heading,
                        },
                        0.,
                    );
                    for b in [&concave[..], &rectangle.corners(pose([0.; 3]), 0.)[..]] {
                        assert_eq!(
                            polygons_overlap(&a, b),
                            reference(&a, b),
                            "{x},{z}/{heading}"
                        );
                        assert_eq!(
                            polygons_overlap(b, &a),
                            reference(b, &a),
                            "reversed {x},{z}/{heading}"
                        );
                    }
                }
            }
        }
        // The broad phase must actually avoid the expensive polygon scan.
        OVERLAP_SCANS.set(0);
        let far = rectangle.corners(pose([100., 0., 100.]), 0.);
        assert!(!polygons_overlap(&far, &concave));
        assert_eq!(OVERLAP_SCANS.get(), 0);
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
                        &catalog().aircraft[model].deck_geometry,
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
                        surface: &DeckSurface::new(ship).unwrap(),
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
                surface: &DeckSurface::new(ship).unwrap(),
                occupied: &[],
            };
            for pool in &wing.squadrons {
                let model = &catalog().aircraft[&pool.model_id].deck_geometry;
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
        let ship = &catalog().definitions["enterprise-cv6"];
        let wing = ship.air_wing.as_ref().unwrap();
        let layout = wing.deck_layout.as_ref().unwrap();
        let pool = wing.squadrons.iter().find(|p| p.role == "fighter").unwrap();
        let model = &catalog().aircraft[&pool.model_id].deck_geometry;
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
            surface: &DeckSurface::new(ship).unwrap(),
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
}
