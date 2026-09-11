//! Search pilots use only their team's reports and their own motion.
use super::*;
use crate::{
    aircraft::{SearchPolicy, SearchSample},
    sensors::{Affiliation, ContactKind},
};
impl Aviation {
    /// True means the search consumed this tick. False permits the existing
    /// strike controller, after a compatible local acquisition, to execute.
    pub(super) fn search_mission(
        &self,
        p: &mut Aircraft,
        flight: &mut Option<AirFlight>,
        ctx: &AirContext<'_>,
        dt: f64,
    ) -> bool {
        let Some(f) = flight else {
            return false;
        };
        let AirOrder::SearchArea {
            center,
            radius_m,
            altitude,
            policy,
        } = f.order
        else {
            return false;
        };
        let Some(k) = ctx.knowledge else {
            crate::aircraft::set_str(&mut p.phase, "returning");
            return true;
        };
        let progress = p.search.get_or_insert_with(|| {
            crate::air_search::sweep(center, radius_m, altitude, p.position)
        });
        progress.elapsed_seconds += dt;
        progress
            .trail
            .retain(|s| k.tick.saturating_sub(s.tick) <= 90 * crate::rules::TICK_RATE);
        if progress
            .trail
            .last()
            .is_none_or(|s| k.tick.saturating_sub(s.tick) >= 5 * crate::rules::TICK_RATE)
        {
            progress.trail.push(SearchSample {
                position: p.position,
                tick: k.tick,
            });
        }
        if progress.elapsed_seconds >= progress.deadline_seconds {
            f.notice = Some("Search time complete · Returning".into());
            crate::aircraft::set_str(&mut p.phase, "returning");
            return true;
        }
        let reports = k.sensors.iter_contacts(p.team);
        let local = |c: &&crate::sensors::ContactTrack| observation::locally_observed(c, p, k.tick);
        let threatened = policy != SearchPolicy::Strike
            && reports.clone().filter(local).any(|c| {
                c.kind == ContactKind::Aircraft
                    && length(sub(observation::report_point(c, k.tick), p.position)) < 3500.0
            });
        if policy != SearchPolicy::Strike && (threatened || p.hp < 60.0) {
            f.notice = Some("Scout withdrawing · Preserving aircraft".into());
            crate::aircraft::set_str(&mut p.phase, "returning");
            return true;
        }
        if policy != SearchPolicy::Report && p.target_id.is_none() {
            p.target_id = reports
                .clone()
                .filter(local)
                .filter(|c| c.kind == ContactKind::Surface && c.affiliation == Affiliation::Hostile)
                .filter(|c| {
                    let point = observation::report_point(c, k.tick);
                    (point[0] - center[0]).hypot(point[2] - center[1]) <= radius_m
                })
                .min_by(|a, b| {
                    length(sub(a.measured_position, p.position))
                        .total_cmp(&length(sub(b.measured_position, p.position)))
                        .then(a.id.cmp(&b.id))
                })
                .map(|c| c.id.clone());
        }
        if let Some(id) = &p.target_id {
            if policy == SearchPolicy::Strike {
                // strike_solution repeats the current local-acquisition gate,
                // including reacquisition if this observation subsequently lapses.
                return false;
            }
            if let Some(c) = k.sensors.contact(p.team, id) {
                let progress = p.search.as_mut().unwrap();
                progress.shadow_seconds += dt;
                if progress.shadow_seconds >= 120.0 {
                    f.notice = Some("Shadow complete · Returning".into());
                    crate::aircraft::set_str(&mut p.phase, "returning");
                    return true;
                }
                if !observation::locally_observed(c, p, k.tick) {
                    f.notice = Some("Contact lost · Searching last report".into());
                    self.search_report(p, c, k.tick, dt);
                    return true;
                }
                let mut anchor = observation::report_point(c, k.tick);
                anchor[1] = altitude.metres();
                if let Some(area) = &self.airspace {
                    let scale =
                        ((area.radius_m - 4500.0) / anchor[0].hypot(anchor[2]).max(1.0)).min(1.0);
                    anchor[0] *= scale;
                    anchor[2] *= scale;
                }
                let point = orbit_point(p, anchor, 3000.0, 1.0);
                f.notice = Some("Shadowing · Reporting without attacking".into());
                crate::aircraft::set_str(&mut p.phase, "outbound");
                fly(
                    p,
                    point,
                    85.0,
                    dt,
                    FlightOptions {
                        bank_limit: Some(0.5),
                        ..Default::default()
                    },
                );
                return true;
            }
            p.target_id = None;
        }
        let progress = p.search.as_mut().unwrap();
        let Some(endpoint) = progress.route.get(progress.waypoint).copied() else {
            f.notice = Some("Sweep complete · Returning".into());
            crate::aircraft::set_str(&mut p.phase, "returning");
            return true;
        };
        let origin = if progress.waypoint == 0 {
            progress.entry_position
        } else {
            progress.route[progress.waypoint - 1]
        };
        let dx = endpoint[0] - origin[0];
        let dz = endpoint[2] - origin[2];
        let distance = dx.hypot(dz).max(1.0);
        let along =
            ((p.position[0] - origin[0]) * dx + (p.position[2] - origin[2]) * dz) / distance;
        let cross =
            ((p.position[0] - origin[0]) * dz - (p.position[2] - origin[2]) * dx).abs() / distance;
        if (along >= distance && cross < 450.0
            || (p.position[0] - endpoint[0]).hypot(p.position[2] - endpoint[2]) < 300.0)
            && (p.position[1] - endpoint[1]).abs() < 180.0
        {
            progress.waypoint += 1;
        }
        // Follow a line through the waypoint with lookahead, so finite-rate
        // aircraft cross it rather than orbiting an unreachable point forever.
        let ahead = (along + 1100.0).clamp(0.0, distance + 1100.0);
        let mut point = [
            origin[0] + dx / distance * ahead,
            endpoint[1],
            origin[2] + dz / distance * ahead,
        ];
        // Keep the four/six aircraft in a small parallel search formation.
        let slot = f.plane_ids.iter().position(|id| id == &p.id).unwrap_or(0) as f64;
        point[0] += (slot - (f.plane_ids.len() - 1) as f64 / 2.0) * 25.0;
        f.notice = Some(format!(
            "Searching · Leg {}/{} · {} m",
            (progress.waypoint + 1).min(progress.route.len()),
            progress.route.len(),
            altitude.metres() as u32
        ));
        crate::aircraft::set_str(&mut p.phase, "outbound");
        fly(
            p,
            point,
            85.0,
            dt,
            FlightOptions {
                bank_limit: Some(0.75),
                ..Default::default()
            },
        );
        true
    }
}
