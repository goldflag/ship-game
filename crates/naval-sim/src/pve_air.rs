//! The opposing air commander. Inputs are own inventory and team reports;
//! returned intentions must still pass the ordinary addressed command handler.
//!
//! Doctrine, scaled to the game's wings: keep a scout out until a ship is
//! tracked, size each strike by what the target looks like, launch waves a
//! carrier can recover and rearm, hold a reserve, escort in proportion and
//! thicken the patrol when hostile aircraft are reported. Every carrier reads
//! one team-wide allocation so two carriers hit two ships, not one.
use crate::{
    aircraft::{AirFlight, AirOrder, Aircraft, SearchAltitude, SearchPolicy, active_flight},
    battle::Battle,
    bots::AiLevel,
    deck_operations::DeckAction,
    pve::PvePlan,
    rules::{TICK_RATE, TeamId},
    sensors::{Affiliation, ContactKind, ContactTrack},
    vessel::Vessel,
};
use std::collections::BTreeMap;

#[derive(Clone, Debug, serde::Serialize)]
pub enum AirIntent {
    Order(AirOrder),
    Deck(DeckAction),
}
#[derive(Clone, Debug, serde::Serialize)]
pub struct AirDirective {
    pub carrier_id: String,
    pub flight_id: String,
    pub intent: AirIntent,
}

/// Per-difficulty operating limits. Counts are flights; a package is one
/// dive flight and one torpedo flight.
#[derive(Clone, Copy, Debug)]
pub struct AirDoctrine {
    /// Ticks between carrier decisions; one action per carrier per decision.
    pub cadence: u64,
    /// Bomber flights a carrier keeps inbound with payload at once.
    pub wave_flights: usize,
    /// Ready bomber flights held back until the first wave has reported.
    pub bomber_reserve: usize,
    /// Ready fighter flights never spent on escort.
    pub fighter_reserve: usize,
    /// Reported hostile aircraft inside this range doubles the patrol.
    pub cap_alert_m: f64,
    /// Reported hostile aircraft inside this range draws an interception.
    pub intercept_m: f64,
    /// No targetable report younger than this sends a scout.
    pub rescout_seconds: u64,
    /// Extra dive and torpedo flights allowed against an identified carrier.
    pub carrier_bonus: usize,
}
impl AirDoctrine {
    pub fn for_level(level: AiLevel) -> Option<Self> {
        Some(match level {
            AiLevel::Static | AiLevel::Moving => return None,
            AiLevel::Easy => Self {
                cadence: 600,
                wave_flights: 2,
                bomber_reserve: 2,
                fighter_reserve: 1,
                cap_alert_m: 15000.0,
                intercept_m: 12000.0,
                rescout_seconds: 300,
                carrier_bonus: 0,
            },
            AiLevel::Normal => Self {
                cadence: 300,
                wave_flights: 4,
                bomber_reserve: 1,
                fighter_reserve: 1,
                cap_alert_m: 25000.0,
                intercept_m: 12000.0,
                rescout_seconds: 180,
                carrier_bonus: 0,
            },
            AiLevel::Hard => Self {
                cadence: 180,
                wave_flights: 6,
                bomber_reserve: 0,
                fighter_reserve: 1,
                cap_alert_m: 25000.0,
                intercept_m: 15000.0,
                rescout_seconds: 120,
                carrier_bonus: 1,
            },
        })
    }
}

/// Bomber flights (dive, torpedo) one contact is worth, from what the team
/// has actually observed: silhouette class, identified carrier and visible
/// damage. Never the target's hidden hull state.
pub fn strike_budget(c: &ContactTrack, battle: &Battle, doctrine: &AirDoctrine) -> (usize, usize) {
    let carrier = c
        .identified_preset_id
        .as_ref()
        .and_then(|id| battle.catalog.definitions.get(id))
        .is_some_and(|d| d.air_wing.is_some());
    if carrier {
        return (2 + doctrine.carrier_bonus, 2 + doctrine.carrier_bonus);
    }
    let (dive, torpedo): (usize, usize) = match c.classification.as_deref() {
        Some("Large warship") => (2, 2),
        Some("Warship") => (1, 1),
        _ => (1, 0),
    };
    let damaged = c
        .visible_condition
        .as_ref()
        .is_some_and(|v| v.fire || v.heavy_smoke || v.listing);
    if damaged {
        (dive.saturating_sub(1).max(1), torpedo.saturating_sub(1))
    } else {
        (dive, torpedo)
    }
}
/// Relative worth used to pick between contacts with budget remaining.
fn contact_value(c: &ContactTrack, battle: &Battle) -> f64 {
    let carrier = c
        .identified_preset_id
        .as_ref()
        .and_then(|id| battle.catalog.definitions.get(id))
        .is_some_and(|d| d.air_wing.is_some());
    if carrier {
        6.0
    } else {
        match c.classification.as_deref() {
            Some("Large warship") => 3.0,
            Some("Warship") => 2.0,
            _ => 1.0,
        }
    }
}
/// A strike may still be flown against this report.
fn feasible_target(c: &ContactTrack) -> bool {
    c.kind == ContactKind::Surface
        && c.affiliation == Affiliation::Hostile
        && c.status != crate::sensors::TrackStatus::Stale
        && !c.visible_condition.as_ref().is_some_and(|v| v.sinking)
}
fn on_task(f: &AirFlight, planes: &[Aircraft]) -> bool {
    planes.iter().any(|p| {
        f.plane_ids.contains(&p.id)
            && p.hp > 0.0
            && matches!(
                p.phase.as_str(),
                "queued" | "taxi" | "launch-ready" | "takeoff" | "outbound" | "attack"
            )
    })
}
fn flight_role<'a>(f: &AirFlight, planes: &'a [Aircraft]) -> &'a str {
    planes
        .iter()
        .find(|p| f.plane_ids.contains(&p.id) && p.hp > 0.0)
        .map_or("", |p| p.role.as_str())
}
fn distance(a: [f64; 2], b: [f64; 2]) -> f64 {
    (a[0] - b[0]).hypot(a[1] - b[1])
}

impl PvePlan {
    pub fn enemy_air_directives(&self, battle: &Battle) -> Vec<AirDirective> {
        let level = self
            .setup
            .ships
            .iter()
            .find(|s| s.team == TeamId::B)
            .map_or(AiLevel::Normal, |s| s.ai_level);
        let Some(doctrine) = AirDoctrine::for_level(level) else {
            return vec![];
        };
        if battle.outcome.is_some()
            || battle.tick == 0
            || !battle.tick.is_multiple_of(doctrine.cadence)
        {
            return vec![];
        }
        let reports = battle.sensors.contacts(TeamId::B);
        let age = |c: &ContactTrack| battle.tick.saturating_sub(c.last_observed_tick);
        let own_ships: Vec<_> = battle
            .actors
            .iter()
            .filter(|a| a.team == TeamId::B && a.physical_loss().is_none())
            .collect();
        let carriers: Vec<_> = own_ships
            .iter()
            .copied()
            .filter(|a| a.definition().air_wing.is_some())
            .collect();
        // Team-wide strike accounting: flights already committed per contact,
        // by role, across every carrier. Stuck strikes on dead reports do not
        // hold a budget slot.
        let mut assigned: BTreeMap<String, (usize, usize)> = BTreeMap::new();
        for carrier in &carriers {
            let Some(wing) = battle.aviation.wing(&carrier.motion.id) else {
                continue;
            };
            for f in &wing.flights {
                let AirOrder::Strike { contact_id } = &f.order else {
                    continue;
                };
                if !on_task(f, &wing.planes)
                    || !reports
                        .iter()
                        .any(|c| &c.id == contact_id && feasible_target(c))
                {
                    continue;
                }
                let slot = assigned.entry(contact_id.clone()).or_default();
                match flight_role(f, &wing.planes) {
                    "dive-bomber" => slot.0 += 1,
                    "torpedo-bomber" => slot.1 += 1,
                    _ => {}
                }
            }
        }
        let targets: Vec<_> = reports
            .iter()
            .filter(|c| feasible_target(c) && age(c) <= 30 * TICK_RATE)
            .collect();
        let hostile_aircraft: Vec<_> = reports
            .iter()
            .filter(|c| {
                c.kind == ContactKind::Aircraft
                    && c.affiliation == Affiliation::Hostile
                    && age(c) <= 60 * TICK_RATE
            })
            .collect();
        let fresh_surface = reports
            .iter()
            .any(|c| feasible_target(c) && age(c) <= doctrine.rescout_seconds * TICK_RATE);
        let mut directives = vec![];
        for (carrier_index, actor) in carriers.iter().enumerate() {
            let wing = battle.aviation.wing(&actor.motion.id).unwrap();
            let flights = battle.aviation.squadron_flights(actor);
            let planes_of = |f: &AirFlight| -> Vec<&Aircraft> {
                wing.planes
                    .iter()
                    .filter(|p| f.plane_ids.contains(&p.id) && p.hp > 0.0)
                    .collect()
            };
            let active: Vec<_> = flights
                .iter()
                .filter(|f| active_flight(f, &wing.planes))
                .collect();
            let available = |f: &AirFlight| {
                let planes = planes_of(f);
                !active_flight(f, &wing.planes)
                    && !planes.is_empty()
                    && planes
                        .iter()
                        .all(|p| matches!(p.phase.as_str(), "ready" | "hangar"))
            };
            let role = |f: &AirFlight| flight_role(f, &wing.planes);
            let ready: Vec<_> = flights.iter().filter(|f| available(f)).collect();
            let ready_fighters: Vec<_> = ready
                .iter()
                .copied()
                .filter(|f| role(f) == "fighter")
                .collect();
            let ready_bombers: Vec<_> = ready
                .iter()
                .copied()
                .filter(|f| role(f) != "fighter")
                .collect();
            let tasked = |f: &AirFlight| on_task(f, &wing.planes);
            let strikes: Vec<_> = active
                .iter()
                .copied()
                .filter(|f| {
                    tasked(f)
                        && matches!(&f.order, AirOrder::Strike { contact_id }
                            if reports.iter().any(|c| &c.id == contact_id && feasible_target(c)))
                })
                .collect();
            let escorts: Vec<_> = active
                .iter()
                .copied()
                .filter(|f| tasked(f) && matches!(f.order, AirOrder::Escort { .. }))
                .collect();
            let cap: Vec<_> = active
                .iter()
                .copied()
                .filter(|f| tasked(f) && matches!(f.order, AirOrder::Defend { .. }))
                .collect();
            let here = [actor.motion.x, actor.motion.z];
            let nearest_threat = hostile_aircraft
                .iter()
                .copied()
                .filter(|c| {
                    own_ships.iter().any(|s| {
                        distance(
                            [s.motion.x, s.motion.z],
                            [c.estimated_position[0], c.estimated_position[2]],
                        ) < doctrine.cap_alert_m
                    })
                })
                .min_by(|a, b| {
                    let range = |c: &ContactTrack| {
                        distance(here, [c.estimated_position[0], c.estimated_position[2]])
                    };
                    range(a)
                        .total_cmp(&range(b))
                        .then(a.uncertainty_m.total_cmp(&b.uncertainty_m))
                        .then(a.id.cmp(&b.id))
                });
            let threat_in_reach = nearest_threat.filter(|c| {
                own_ships.iter().any(|s| {
                    distance(
                        [s.motion.x, s.motion.z],
                        [c.estimated_position[0], c.estimated_position[2]],
                    ) < doctrine.intercept_m
                })
            });
            // The ship the patrol should cover: whichever own hull the threat is closest to.
            let defended = nearest_threat.and_then(|threat| {
                own_ships
                    .iter()
                    .min_by(|a, b| {
                        let range = |a: &Vessel| {
                            distance(
                                [a.motion.x, a.motion.z],
                                [threat.estimated_position[0], threat.estimated_position[2]],
                            )
                        };
                        range(a)
                            .total_cmp(&range(b))
                            .then(a.motion.id.cmp(&b.motion.id))
                    })
                    .map(|a| a.motion.id.clone())
            });
            let cap_wanted = if nearest_threat.is_some() { 2 } else { 1 };
            let cap_retask = defended.as_ref().and_then(|id| {
                cap.iter()
                    .find(|f| {
                        matches!(&f.order, AirOrder::Defend { target_id }
                        if target_id.as_deref().unwrap_or(&actor.motion.id) != id)
                    })
                    .map(|f| (*f, id.clone()))
            });
            let fighter = ready_fighters.first().copied();
            let mut chosen: Option<(&AirFlight, AirOrder)> = None;
            if let Some((flight, id)) = cap_retask {
                chosen = Some((
                    flight,
                    AirOrder::Defend {
                        target_id: Some(id),
                    },
                ));
            }
            if chosen.is_none() && cap.len() < cap_wanted {
                chosen = fighter.map(|f| {
                    (
                        f,
                        AirOrder::Defend {
                            target_id: defended.clone(),
                        },
                    )
                });
            }
            if chosen.is_none()
                && let Some(threat) = threat_in_reach
                && !active
                    .iter()
                    .any(|f| matches!(f.order, AirOrder::InterceptContact { .. }))
            {
                chosen = fighter.map(|f| {
                    (
                        f,
                        AirOrder::InterceptContact {
                            contact_id: threat.id.clone(),
                        },
                    )
                });
            }
            let slot_available = battle.aviation.carrier_rules[&actor.motion.id]
                .active_flights
                .is_none_or(|limit| active.len() < limit);
            // One fighter flight per package, newest strike first, without
            // spending the last ready fighters that the patrol will need.
            if chosen.is_none() && slot_available && ready_fighters.len() > doctrine.fighter_reserve
            {
                let needed = strikes.len().div_ceil(2);
                if escorts.len() < needed {
                    let unescorted = strikes
                        .iter()
                        .copied()
                        .filter(|s| {
                            !escorts
                                .iter()
                                .any(|e| matches!(&e.order, AirOrder::Escort { flight_id } if flight_id == &s.id))
                        })
                        .min_by(|a, b| {
                            let flown = |f: &AirFlight| {
                                planes_of(f)
                                    .iter()
                                    .map(|p| p.flight_time)
                                    .fold(0.0_f64, f64::max)
                            };
                            flown(a).total_cmp(&flown(b)).then(a.id.cmp(&b.id))
                        });
                    if let (Some(strike), Some(f)) = (unescorted, fighter) {
                        chosen = Some((
                            f,
                            AirOrder::Escort {
                                flight_id: strike.id.clone(),
                            },
                        ));
                    }
                }
            }
            if chosen.is_none() && slot_available && !ready_bombers.is_empty() {
                // Every bomber flight out with payload holds a wave slot,
                // whether or not its report is still good, unless it has
                // been out so long that it is searching or coming home.
                let inbound = active
                    .iter()
                    .filter(|f| tasked(f) && matches!(f.order, AirOrder::Strike { .. }))
                    .filter(|f| {
                        planes_of(f)
                            .iter()
                            .any(|p| p.payload && p.flight_time < 240.0)
                    })
                    .count();
                let reported = wing.planes.iter().any(|p| {
                    p.role != "fighter"
                        && p.hp > 0.0
                        && (crate::aircraft::airborne(p) && !p.payload
                            || p.sortie.unwrap_or(0) > 0
                                && matches!(
                                    p.phase.as_str(),
                                    "ready" | "hangar" | "rearming" | "repairing"
                                ))
                });
                let reserve = if reported { 0 } else { doctrine.bomber_reserve };
                let escort_room = fighter.is_none()
                    || battle.aviation.carrier_rules[&actor.motion.id]
                        .active_flights
                        .is_none_or(|limit| active.len() + 1 < limit);
                if inbound < doctrine.wave_flights && ready_bombers.len() > reserve && escort_room {
                    let has_role = |r: &str| ready_bombers.iter().any(|f| role(f) == r);
                    let pick = targets
                        .iter()
                        .copied()
                        .filter_map(|c| {
                            let (dive, torpedo) = strike_budget(c, battle, &doctrine);
                            let used = assigned.get(&c.id).copied().unwrap_or_default();
                            let dive_left = dive.saturating_sub(used.0);
                            let torpedo_left = torpedo.saturating_sub(used.1);
                            let role = if dive_left >= torpedo_left
                                && dive_left > 0
                                && has_role("dive-bomber")
                            {
                                "dive-bomber"
                            } else if torpedo_left > 0 && has_role("torpedo-bomber") {
                                "torpedo-bomber"
                            } else if dive_left > 0 && has_role("dive-bomber") {
                                "dive-bomber"
                            } else {
                                return None;
                            };
                            let range_km =
                                distance(here, [c.estimated_position[0], c.estimated_position[2]])
                                    / 1000.0;
                            let score = contact_value(c, battle) / (1.0 + range_km / 20.0);
                            Some((score, c, role))
                        })
                        .max_by(|a, b| a.0.total_cmp(&b.0).then(b.1.id.cmp(&a.1.id)));
                    if let Some((_, c, wanted)) = pick
                        && let Some(f) = ready_bombers.iter().copied().find(|f| role(f) == wanted)
                    {
                        chosen = Some((
                            f,
                            AirOrder::Strike {
                                contact_id: c.id.clone(),
                            },
                        ));
                        let slot = assigned.entry(c.id.clone()).or_default();
                        if wanted == "dive-bomber" {
                            slot.0 += 1;
                        } else {
                            slot.1 += 1;
                        }
                    }
                }
            }
            if chosen.is_none()
                && slot_available
                && !fresh_surface
                && !active
                    .iter()
                    .any(|f| tasked(f) && matches!(f.order, AirOrder::SearchArea { .. }))
                && let Some(f) = ready_bombers
                    .iter()
                    .copied()
                    .min_by_key(|f| if role(f) == "dive-bomber" { 0 } else { 1 })
            {
                let sorties = planes_of(f)
                    .iter()
                    .map(|p| p.sortie.unwrap_or(0))
                    .max()
                    .unwrap_or(0);
                let sector = (sorties as usize + carrier_index + self.setup.seed as usize % 3) % 3;
                let radius = 5000.0;
                let area = &battle.mission_rules.as_ref().unwrap().area;
                let mut center: [f64; 2] =
                    [[-8500.0, 13000.0], [0.0, 17000.0], [8500.0, 13000.0]][sector];
                let scale = ((area.radius_m - radius - 1500.0)
                    / center[0].hypot(center[1]).max(1.0))
                .min(1.0);
                center[0] *= scale;
                center[1] *= scale;
                chosen = Some((
                    f,
                    AirOrder::SearchArea {
                        center,
                        radius_m: radius,
                        altitude: SearchAltitude::High,
                        policy: SearchPolicy::Shadow,
                    },
                ));
            }
            let Some((f, order)) = chosen else {
                continue;
            };
            let planes = planes_of(f);
            let intent = if wing.deck.is_some() && planes.iter().any(|p| p.phase == "hangar") {
                Some(AirIntent::Deck(if planes.iter().any(|p| p.hp < 25.0) {
                    DeckAction::Repair
                } else {
                    DeckAction::Raise
                }))
            } else if wing.deck.is_some()
                && planes.iter().any(|p| {
                    if p.role == "fighter" {
                        p.ammo <= 0.0
                    } else {
                        !p.payload
                    }
                })
            {
                Some(AirIntent::Deck(DeckAction::Rearm))
            } else if wing.deck.is_some() && planes.iter().any(|p| p.hp < 25.0) {
                Some(AirIntent::Deck(DeckAction::Repair))
            } else if slot_available || active_flight(f, &wing.planes) {
                Some(AirIntent::Order(order))
            } else {
                None
            };
            let Some(intent) = intent else {
                continue;
            };
            if wing
                .deck
                .as_ref()
                .is_some_and(|d| d.queue.iter().any(|r| r.flight_id == f.id))
            {
                continue;
            }
            directives.push(AirDirective {
                carrier_id: actor.motion.id.clone(),
                flight_id: f.id.clone(),
                intent,
            });
        }
        directives
    }
}
