//! Local, deterministic flight allocation. Hostile priority consumes measured
//! kinematics only; role, stores, health and enemy flight identity are irrelevant.
use crate::{
    aircraft::{Aircraft, PlaneView},
    definition::Vec3,
    geometry::*,
};

pub fn target(
    p: &Aircraft,
    planes: &[PlaneView<'_>],
    anchor: Vec3,
    explicit: Option<&str>,
) -> Option<usize> {
    let eligible = |o: &&PlaneView<'_>| {
        o.team != p.team && o.in_flight()
        && explicit.is_none_or(|id| o.flight_id == Some(id))
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
                && a.flight_id == p.flight_id.as_deref()
                && a.in_flight()
                && matches!(a.phase, "attack" | "outbound")
                && a.ammo > 0.0
        })
        .collect();
    allies.push(PlaneView::of(p));
    allies.sort_by(|a, b| a.id.cmp(b.id));
    let low = targets.iter().any(|(_, t)| t.position[1] < 650.0);
    let high = targets.iter().any(|(_, t)| t.position[1] >= 650.0);
    let split = low && high && explicit.is_none() && allies.len() >= 4;
    // One counter per eligible track, in the same order the map was keyed by.
    let mut assigned = vec![0u32; targets.len()];
    for (slot, ally) in allies.iter().enumerate() {
        // Adjacent wingmen share an altitude sector, but attack separate tracks
        // when available. Surplus fighters support occupied tracks evenly.
        let low_sector = (slot / 2) % 2 == 0;
        let best = targets
            .iter()
            .enumerate()
            .filter(|(_, (_, t))| length(sub(t.position, ally.position)) < 6500.0)
            .min_by(|(ia, (_, a)), (ib, (_, b))| {
                let score = |i: usize, t: &PlaneView<'_>| {
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
                        + assigned[i] as f64 * 18000.0
                        - if ally.hostile_id == Some(t.id) {
                            600.0
                        } else {
                            0.0
                        }
                };
                score(*ia, a)
                    .total_cmp(&score(*ib, b))
                    .then_with(|| a.id.cmp(b.id))
            })
            .map(|(at, (i, _))| (at, *i));
        if ally.id == p.id {
            return best.map(|(_, i)| i);
        }
        if let Some((at, _)) = best {
            assigned[at] += 1;
        }
    }
    None
}
