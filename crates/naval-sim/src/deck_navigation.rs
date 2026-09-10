//! Bounded ground-route search. A route includes its turns: a clear parking spot
//! and runway do not by themselves imply that an aircraft can move between them.
use crate::{
    definition::ShipDefinition,
    flight_deck::{AircraftDeckGeometry, DeckPose, Envelope, inside},
    geometry::{length, sub, wrap_angle},
};
use std::{
    cmp::Ordering,
    collections::{BTreeMap, BinaryHeap},
};

pub struct DeckTraffic<'a> {
    pub ship: &'a ShipDefinition,
    pub surface: &'a crate::deck_contact::DeckSurface,
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
fn polygons_overlap(a: &[[f64; 2]], b: &[[f64; 2]]) -> bool {
    a.iter().any(|p| inside(b, p[0], p[1]))
        || b.iter().any(|p| inside(a, p[0], p[1]))
        || a.iter().enumerate().any(|(i, &p)| {
            b.iter()
                .enumerate()
                .any(|(j, &q)| intersect(p, a[(i + 1) % a.len()], q, b[(j + 1) % b.len()]))
        })
}

impl DeckTraffic<'_> {
    pub fn clear(&self, model: &AircraftDeckGeometry, pose: DeckPose) -> bool {
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
    pub fn segment_clear(
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
    pub fn begin_route(
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
    pub fn route(
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
pub enum RouteProgress {
    Pending,
    Found(Vec<DeckPose>),
    Blocked,
    Invalidated,
}

/// Grid nodes retain heading and allow forward/reverse motion plus finite
/// pivots. Every edge is checked against the same revision. A search owns its
/// aircraft geometry, so switching aircraft cannot reuse another model's path.
#[derive(Clone, Debug)]
pub struct RouteSearch {
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
    pub fn visited_nodes(&self) -> usize {
        self.visited
    }
    /// Work is bounded by node expansions, not elapsed wall time, preserving
    /// replay determinism. A zero budget performs no geometry work. Direct
    /// connection and initial-turn validation consume the first work unit.
    pub fn advance(
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
