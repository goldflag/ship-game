//! Pilot decisions consume team reports. True aircraft enter only the physical
//! hit resolver; a report never becomes a live reference to hidden motion.
use super::*;
use crate::sensors::{Affiliation, ContactKind, ContactTrack, Knowledge, TrackStatus};

pub(in crate::aviation) struct StrikeSolution {
    pub point: Vec3,
    pub velocity: Vec3,
    pub heading: f64,
}
pub(in crate::aviation) fn report_point(c: &ContactTrack, tick: u64) -> Vec3 {
    let age = (tick.saturating_sub(c.last_observed_tick) as f64 / crate::rules::TICK_RATE as f64)
        .min(if c.kind == ContactKind::Aircraft {
            10.0
        } else {
            30.0
        });
    add(c.measured_position, scale(c.velocity, age))
}
/// Orbiting a lost or stale report ends after this long at the search area;
/// the pilot then retargets or returns. A ship seen sinking ends it at once.
const SEARCH_DEADLINE_SECONDS: f64 = 90.0;
/// A strike may shift to another ship it can see within this range.
const RETARGET_RANGE_M: f64 = 8000.0;
pub(in crate::aviation) fn dead_report(c: &ContactTrack) -> bool {
    c.visible_condition.as_ref().is_some_and(|v| v.sinking)
}
fn reset_attack(p: &mut Aircraft) {
    p.pilot.attack_heading = None;
    p.pilot.attack_stage = None;
    p.pilot.attempts = 0;
    p.pilot.search_seconds = 0.0;
}
pub(in crate::aviation) fn locally_observed(c: &ContactTrack, p: &Aircraft, tick: u64) -> bool {
    c.affiliation == Affiliation::Hostile
        && c.sources.iter().any(|s| {
            s.observer_id == p.id && tick.saturating_sub(s.tick) <= 2 * crate::rules::TICK_RATE
        })
}
impl Aviation {
    pub(in crate::aviation) fn search_report(
        &self,
        p: &mut Aircraft,
        c: &ContactTrack,
        tick: u64,
        dt: f64,
    ) {
        let mut anchor = report_point(c, tick);
        let radius = c.uncertainty_m.clamp(650.0, 2500.0);
        if let Some(area) = &self.airspace {
            let distance = anchor[0].hypot(anchor[2]);
            let limit = (area.radius_m - radius - 600.0).max(0.0);
            if distance > limit && distance > 0.0 {
                anchor[0] *= limit / distance;
                anchor[2] *= limit / distance;
            }
        }
        anchor[1] = if c.kind == ContactKind::Aircraft {
            anchor[1].clamp(150.0, 1500.0)
        } else if p.role == "dive-bomber" {
            850.0
        } else {
            420.0
        };
        let point = if (p.position[0] - anchor[0]).hypot(p.position[2] - anchor[2]) > radius + 900.0
        {
            anchor
        } else {
            orbit_point(p, anchor, radius, 1.0)
        };
        crate::aviation::aircraft::set_str(&mut p.phase, "outbound");
        p.pilot.attack_stage = None;
        p.pilot.attack_heading = None;
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
    }

    pub(in crate::aviation) fn strike_solution(
        &self,
        p: &mut Aircraft,
        flight: &mut Option<AirFlight>,
        ctx: &AirContext<'_>,
        dt: f64,
    ) -> Option<StrikeSolution> {
        if !p.payload {
            crate::aviation::aircraft::set_str(&mut p.phase, "returning");
            if let Some(f) = flight
                && f.notice
                    .as_deref()
                    .is_some_and(|n| n.starts_with("Target "))
            {
                f.notice = None;
            }
            return None;
        }
        let Some(k) = ctx.knowledge else {
            if let Some(target) = ctx.actors.iter().find(|a| {
                Some(&a.motion.id) == p.target_id.as_ref()
                    && a.team != p.team
                    && a.physical_loss().is_none()
                    && a.motion.y > -8.0
            }) {
                return Some(StrikeSolution {
                    point: [
                        target.motion.x,
                        (target.motion.y + target.definition().hull.depth
                            - target.definition().hull.draft)
                            .max(0.0),
                        target.motion.z,
                    ],
                    velocity: target.motion.velocity(),
                    heading: target.motion.heading,
                });
            }
            if let Some(f) = flight {
                f.notice = Some("Target unavailable · Returning armed".into());
            }
            crate::aviation::aircraft::set_str(&mut p.phase, "returning");
            return None;
        };
        // A wingmate's retarget changes the flight order; the flight stays on
        // one ship instead of each aircraft picking its own.
        if let Some(f) = flight.as_ref()
            && let AirOrder::Strike { contact_id } = &f.order
            && p.target_id.as_ref() != Some(contact_id)
        {
            p.target_id = Some(contact_id.clone());
            reset_attack(p);
        }
        let surface = |c: &&ContactTrack| {
            c.kind == ContactKind::Surface && c.affiliation == Affiliation::Hostile
        };
        let mut contact = p
            .target_id
            .as_ref()
            .and_then(|id| k.sensors.contact(p.team, id))
            .filter(surface);
        let lost =
            contact.is_none_or(dead_report) || p.pilot.search_seconds >= SEARCH_DEADLINE_SECONDS;
        if lost {
            let prefix = if contact.is_none() {
                "Target unavailable"
            } else {
                "Target lost"
            };
            // Only a ship this pilot can see right now qualifies; a report
            // alone never redirects a strike.
            let next = k
                .sensors
                .iter_contacts(p.team)
                .filter(|c| c.targetable() && locally_observed(c, p, k.tick))
                .map(|c| {
                    let point = report_point(c, k.tick);
                    (
                        (point[0] - p.position[0]).hypot(point[2] - p.position[2]),
                        c,
                    )
                })
                .filter(|(distance, _)| *distance <= RETARGET_RANGE_M)
                .min_by(|a, b| a.0.total_cmp(&b.0).then(a.1.id.cmp(&b.1.id)))
                .map(|(_, c)| c);
            match next {
                Some(c) => {
                    p.target_id = Some(c.id.clone());
                    reset_attack(p);
                    if let Some(f) = flight {
                        if matches!(f.order, AirOrder::Strike { .. }) {
                            f.order = AirOrder::Strike {
                                contact_id: c.id.clone(),
                            };
                        }
                        f.notice = Some(format!(
                            "{prefix} · Attacking {}",
                            c.classification.as_deref().unwrap_or("contact")
                        ));
                    }
                    contact = Some(c);
                }
                None => {
                    if let Some(f) = flight {
                        f.notice = Some(format!("{prefix} · Returning armed"));
                    }
                    crate::aviation::aircraft::set_str(&mut p.phase, "returning");
                    return None;
                }
            }
        }
        let c = contact.unwrap();
        if !locally_observed(c, p, k.tick) {
            if let Some(f) = flight {
                f.notice = Some(
                    if matches!(c.status, TrackStatus::Lost | TrackStatus::Stale) {
                        "Contact lost · Searching last report"
                    } else {
                        "Following report · Acquiring target locally"
                    }
                    .into(),
                );
            }
            let anchor = report_point(c, k.tick);
            let radius = c.uncertainty_m.clamp(650.0, 2500.0);
            if (p.position[0] - anchor[0]).hypot(p.position[2] - anchor[2]) <= radius + 900.0 {
                p.pilot.search_seconds += dt;
            }
            self.search_report(p, c, k.tick, dt);
            return None;
        }
        p.pilot.search_seconds = 0.0;
        // A retarget notice stays through the attack; search notices clear.
        if let Some(f) = flight
            && f.notice
                .as_deref()
                .is_some_and(|n| n.starts_with("Contact lost") || n.starts_with("Following report"))
        {
            f.notice = None;
        }
        let mut point = report_point(c, k.tick);
        point[1] = point[1].max(0.0);
        Some(StrikeSolution {
            point,
            velocity: c.velocity,
            heading: c.pose().heading,
        })
    }

    /// Preserve own physical aircraft for formation/clear-fire checks. Hostile
    /// representations contain measurements and unknown capability, never HP,
    /// payload, current private maneuvers, squadron IDs or carrier inventories.
    pub(in crate::aviation) fn pilot_aircraft<'a>(
        &'a self,
        p: &Aircraft,
        knowledge: Option<Knowledge<'a>>,
        radius: f64,
    ) -> Vec<PlaneView<'a>> {
        let Some(k) = knowledge else {
            return self
                .iter_planes()
                .filter(|a| {
                    in_flight(a) && crate::geometry::within_distance(a.position, p.position, radius)
                })
                .map(PlaneView::of)
                .collect();
        };
        let mut planes: Vec<_> = self
            .iter_planes()
            .filter(|a| {
                a.team == p.team
                    && in_flight(a)
                    && crate::geometry::within_distance(a.position, p.position, radius)
            })
            .map(PlaneView::of)
            .collect();
        for c in k
            .sensors
            .iter_contacts(p.team)
            .filter(|c| c.kind == ContactKind::Aircraft && locally_observed(c, p, k.tick))
        {
            if !crate::geometry::within_distance(report_point(c, k.tick), p.position, radius) {
                continue;
            }
            // A report carries measurements and unknown capability, never HP,
            // payload, private maneuvers, squadron IDs or carrier inventories.
            planes.push(PlaneView {
                id: &c.id,
                flight_id: Some(&c.id),
                hostile_id: None,
                team: if p.team == crate::rules::TeamId::A {
                    crate::rules::TeamId::B
                } else {
                    crate::rules::TeamId::A
                },
                // Any aircraft approaching from behind may pose a threat; no
                // unobserved weapon load or aircraft model is consulted.
                role: "fighter",
                phase: "outbound",
                position: report_point(c, k.tick),
                velocity: c.velocity,
                hp: 100.0,
                ammo: 0.0,
            });
        }
        planes
    }

    pub(in crate::aviation) fn apply_fighter_hit(
        &mut self,
        p: &mut Aircraft,
        observed_id: &str,
        burst: &crate::aviation::aircraft_accuracy::FighterBurst,
        gun: &FighterAim,
        ctx: &mut AirContext<'_>,
    ) {
        let id = if let Some(k) = ctx.knowledge {
            k.sensors.resolve_contact(p.team, observed_id)
        } else {
            Some(observed_id)
        };
        let Some(target) = id
            .and_then(|id| self.plane_mut(id))
            .filter(|t| in_flight(t))
        else {
            return;
        };
        let hit = if ctx.knowledge.is_some() {
            // Resolve the shot against physical motion, not the report marker.
            length(sub(
                burst.end,
                add(target.position, scale(target.velocity, gun.time)),
            )) <= 7.0
        } else {
            burst.hit
        };
        if length(sub(
            burst.end,
            add(target.position, scale(target.velocity, gun.time)),
        )) < 45.0
        {
            crate::aviation::aircraft_defense::near_fire(target, p.position);
        }
        if hit {
            target.hp -= air_gunnery::FIGHTER_DAMAGE
                * clamp((gun.alignment - 0.996) / 0.004, 0.3, 1.0)
                * clamp(1.3 - gun.distance / 900.0, 0.5, 1.0);
        }
        if target.hp <= 0.0 {
            p.kills += 1;
            lose(target, ctx.events, "Shot down");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{rules::TICK_RATE, sensors::ObservationSource};
    fn track(kind: ContactKind, last_observed_tick: u64) -> ContactTrack {
        ContactTrack {
            id: "contact".into(),
            kind,
            affiliation: Affiliation::Hostile,
            status: TrackStatus::Stale,
            first_observed_tick: 0,
            last_observed_tick,
            measured_position: [1000.0, 0.0, -2000.0],
            estimated_position: [1000.0, 0.0, -2000.0],
            velocity: [10.0, 0.0, 0.0],
            uncertainty_m: 800.0,
            identification_confidence: 0.5,
            classification: None,
            identified_preset_id: None,
            sources: vec![],
            visible_condition: None,
        }
    }
    #[test]
    fn a_report_is_dead_reckoned_for_a_bounded_time_only() {
        let seen = 100 * TICK_RATE;
        let surface = track(ContactKind::Surface, seen);
        assert_eq!(report_point(&surface, seen)[0], 1000.0);
        assert_eq!(report_point(&surface, seen + 10 * TICK_RATE)[0], 1100.0);
        // A minute-old ship report is carried 30 s ahead, never a full minute.
        assert_eq!(report_point(&surface, seen + 60 * TICK_RATE)[0], 1300.0);
        assert_eq!(report_point(&surface, seen + 600 * TICK_RATE)[0], 1300.0);
        // Aircraft reports go stale three times faster.
        let air = track(ContactKind::Aircraft, seen);
        assert_eq!(report_point(&air, seen + 60 * TICK_RATE)[0], 1100.0);
        // A report from the future is not moved backwards.
        assert_eq!(report_point(&surface, seen - TICK_RATE)[0], 1000.0);
    }
    #[test]
    fn only_this_pilots_fresh_own_sighting_counts_as_local_observation() {
        let (_, ps) = crate::aviation::test_support::planes("dive-bomber");
        let p = &ps[0];
        let now = 300 * TICK_RATE;
        let mut c = track(ContactKind::Surface, now);
        let source = |observer_id: &str, tick| ObservationSource {
            observer_id: observer_id.into(),
            kind: ContactKind::Aircraft,
            tick,
            strength: 1.0,
        };
        assert!(!locally_observed(&c, p, now), "no sources");
        c.sources = vec![source(&p.id, now - 2 * TICK_RATE)];
        assert!(locally_observed(&c, p, now), "own sighting two seconds old");
        c.sources = vec![source(&p.id, now - 2 * TICK_RATE - 1)];
        assert!(!locally_observed(&c, p, now), "own sighting just too old");
        c.sources = vec![source(&ps[1].id, now)];
        assert!(
            !locally_observed(&c, p, now),
            "a wingmate's sighting is a report"
        );
        c.sources = vec![source(&p.id, now)];
        c.affiliation = Affiliation::Unknown;
        assert!(
            !locally_observed(&c, p, now),
            "unidentified contacts are never targets"
        );
        c.affiliation = Affiliation::Hostile;
        assert!(!dead_report(&c));
        c.visible_condition = Some(crate::recon::ObservedCondition {
            sinking: true,
            ..Default::default()
        });
        assert!(dead_report(&c));
    }
}
