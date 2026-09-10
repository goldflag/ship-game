//! Pilot decisions consume team reports. True aircraft enter only the physical
//! hit resolver; a report never becomes a live reference to hidden motion.
use super::*;
use crate::sensors::{Affiliation, ContactKind, ContactTrack, Knowledge, TrackStatus};

pub(super) struct StrikeSolution {
    pub point: Vec3,
    pub velocity: Vec3,
    pub heading: f64,
}
pub(super) fn report_point(c: &ContactTrack, tick: u64) -> Vec3 {
    let age = (tick.saturating_sub(c.last_observed_tick) as f64 / crate::rules::TICK_RATE as f64)
        .min(if c.kind == ContactKind::Aircraft {
            10.0
        } else {
            30.0
        });
    add(c.measured_position, scale(c.velocity, age))
}
pub(super) fn locally_observed(c: &ContactTrack, p: &Aircraft, tick: u64) -> bool {
    c.affiliation == Affiliation::Hostile
        && c.sources.iter().any(|s| {
            s.observer_id == p.id && tick.saturating_sub(s.tick) <= 2 * crate::rules::TICK_RATE
        })
}
impl Aviation {
    pub(super) fn search_report(&self, p: &mut Aircraft, c: &ContactTrack, tick: u64, dt: f64) {
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
        p.phase = "outbound".into();
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

    pub(super) fn strike_solution(
        &self,
        p: &mut Aircraft,
        flight: &mut Option<AirFlight>,
        ctx: &AirContext<'_>,
        dt: f64,
    ) -> Option<StrikeSolution> {
        if !p.payload {
            p.phase = "returning".into();
            return None;
        }
        if let Some(k) = ctx.knowledge {
            let contact = p
                .target_id
                .as_ref()
                .and_then(|id| k.sensors.contact(p.team, id))
                .filter(|c| {
                    c.kind == ContactKind::Surface && c.affiliation == Affiliation::Hostile
                });
            if let Some(c) = contact {
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
                    self.search_report(p, c, k.tick, dt);
                    return None;
                }
                if let Some(f) = flight {
                    f.notice = None;
                }
                let mut point = report_point(c, k.tick);
                point[1] = point[1].max(0.0);
                return Some(StrikeSolution {
                    point,
                    velocity: c.velocity,
                    heading: c.pose().heading,
                });
            }
        } else if let Some(target) = ctx.actors.iter().find(|a| {
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
        p.phase = "returning".into();
        None
    }

    /// Preserve own physical aircraft for formation/clear-fire checks. Hostile
    /// representations contain measurements and unknown capability, never HP,
    /// payload, current private maneuvers, squadron IDs or carrier inventories.
    pub(super) fn pilot_aircraft(
        &self,
        p: &Aircraft,
        knowledge: Option<Knowledge<'_>>,
        radius: f64,
    ) -> Vec<Aircraft> {
        let Some(k) = knowledge else {
            return self
                .iter_planes()
                .filter(|a| {
                    in_flight(a)
                        && crate::geometry::within_distance(a.position, p.position, radius)
                })
                .cloned()
                .collect();
        };
        let mut planes: Vec<_> = self
            .iter_planes()
            .filter(|a| {
                a.team == p.team
                    && in_flight(a)
                    && crate::geometry::within_distance(a.position, p.position, radius)
            })
            .cloned()
            .collect();
        for c in k
            .sensors
            .iter_contacts(p.team)
            .filter(|c| c.kind == ContactKind::Aircraft && locally_observed(c, p, k.tick))
        {
            if !crate::geometry::within_distance(report_point(c, k.tick), p.position, radius) {
                continue;
            }
            // The own-aircraft template supplies required mechanical fields to
            // the existing pilot math; every target-dependent field is replaced.
            let mut observed = p.clone();
            observed.id = c.id.clone();
            observed.owner_id.clear();
            observed.flight_id = Some(c.id.clone());
            observed.squadron_id.clear();
            observed.model_id.clear();
            observed.team = if p.team == crate::rules::TeamId::A {
                crate::rules::TeamId::B
            } else {
                crate::rules::TeamId::A
            };
            observed.position = report_point(c, k.tick);
            observed.previous_position = observed.position;
            observed.velocity = c.velocity;
            observed.heading = c.pose().heading;
            observed.pitch = c.velocity[1].atan2(c.velocity[0].hypot(c.velocity[2]));
            observed.bank = 0.0;
            observed.phase = "outbound".into();
            // Any aircraft approaching from behind may pose a threat; no
            // unobserved weapon load or aircraft model is consulted.
            observed.role = "fighter".into();
            observed.hp = 100.0;
            observed.ammo = 0.0;
            observed.payload = false;
            observed.deck_slot = None;
            observed.deck_datum = None;
            observed.deck_position = None;
            observed.target_id = None;
            observed.pilot = Default::default();
            planes.push(observed);
        }
        planes
    }

    pub(super) fn apply_fighter_hit(
        &mut self,
        p: &mut Aircraft,
        observed: &Aircraft,
        burst: &crate::aircraft_accuracy::FighterBurst,
        gun: &FighterAim,
        ctx: &mut AirContext<'_>,
    ) {
        let id = if let Some(k) = ctx.knowledge {
            k.sensors.resolve_contact(p.team, &observed.id)
        } else {
            Some(observed.id.as_str())
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
            crate::aircraft_defense::near_fire(target, p.position);
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
