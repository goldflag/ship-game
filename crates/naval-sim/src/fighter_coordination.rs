//! Local, deterministic flight allocation. Hostile priority consumes measured
//! kinematics only; role, stores, health and enemy flight identity are irrelevant.
use crate::{
    aircraft::{Aircraft, in_flight},
    definition::Vec3,
    geometry::*,
};

pub fn target(
    p: &Aircraft,
    planes: &[&Aircraft],
    anchor: Vec3,
    explicit: Option<&str>,
) -> Option<usize> {
    let eligible = |o: &&Aircraft| {
        o.team != p.team && in_flight(o)
        && explicit.is_none_or(|id| o.flight_id.as_deref() == Some(id))
        && length(sub(o.position, anchor)) < 7500.0
        // Defense must not follow departing tracks away from the station.
        && (explicit.is_some() || length(sub(o.position, anchor)) < 3500.0
            || dot(o.velocity, sub(anchor, o.position)) > 0.0)
    };
    let targets: Vec<_> = planes
        .iter()
        .enumerate()
        .filter(|(_, o)| eligible(o))
        .collect();
    let mut allies: Vec<_> = planes
        .iter()
        .copied()
        .filter(|a| {
            a.id != p.id
                && a.team == p.team
                && a.role == "fighter"
                && a.flight_id == p.flight_id
                && in_flight(a)
                && matches!(a.phase.as_str(), "attack" | "outbound")
                && a.ammo > 0.0
        })
        .collect();
    allies.push(p);
    allies.sort_by(|a, b| a.id.cmp(&b.id));
    let low = targets.iter().any(|(_, t)| t.position[1] < 650.0);
    let high = targets.iter().any(|(_, t)| t.position[1] >= 650.0);
    let split = low && high && explicit.is_none() && allies.len() >= 4;
    let mut assigned = std::collections::BTreeMap::<usize, usize>::new();
    for (slot, ally) in allies.iter().enumerate() {
        // Adjacent wingmen share an altitude sector, but attack separate tracks
        // when available. Surplus fighters support occupied tracks evenly.
        let low_sector = (slot / 2) % 2 == 0;
        let best = targets
            .iter()
            .filter(|(_, t)| length(sub(t.position, ally.position)) < 6500.0)
            .min_by(|(ia, a), (ib, b)| {
                let score = |i: &usize, t: &Aircraft| {
                    let range = length(sub(t.position, anchor));
                    let closure = dot(t.velocity, normalize(sub(anchor, t.position)));
                    let eta = range / closure.max(25.0);
                    let distance = length(sub(t.position, ally.position));
                    distance
                        + eta.min(200.0) * 14.0
                        + if split && (t.position[1] < 650.0) != low_sector {
                            12000.0
                        } else {
                            0.0
                        }
                        + assigned.get(i).copied().unwrap_or(0) as f64 * 18000.0
                        - if ally.pilot.hostile_id.as_deref() == Some(t.id.as_str()) {
                            600.0
                        } else {
                            0.0
                        }
                };
                score(ia, a)
                    .total_cmp(&score(ib, b))
                    .then_with(|| a.id.cmp(&b.id))
            })
            .map(|(i, _)| *i);
        if ally.id == p.id {
            return best;
        }
        if let Some(i) = best {
            *assigned.entry(i).or_default() += 1;
        }
    }
    None
}
