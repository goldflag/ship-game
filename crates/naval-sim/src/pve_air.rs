//! A small opposing air commander. Inputs are own inventory and team reports;
//! returned intentions must still pass the ordinary addressed command handler.
use crate::{
    aircraft::{AirOrder, SearchAltitude, SearchPolicy, active_flight},
    battle::Battle,
    bots::AiLevel,
    deck_operations::DeckAction,
    pve::PvePlan,
    rules::{TICK_RATE, TeamId},
    sensors::{Affiliation, ContactKind},
};
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
impl PvePlan {
    pub fn enemy_air_directives(&self, battle: &Battle) -> Vec<AirDirective> {
        let level = self
            .setup
            .ships
            .iter()
            .find(|s| s.team == TeamId::B)
            .map_or(AiLevel::Normal, |s| s.ai_level);
        let cadence = match level {
            AiLevel::Static | AiLevel::Moving => return vec![],
            AiLevel::Easy => 600,
            AiLevel::Hard => 180,
            _ => 300,
        };
        if battle.outcome.is_some() || battle.tick == 0 || !battle.tick.is_multiple_of(cadence) {
            return vec![];
        }
        let reports = battle.sensors.contacts(TeamId::B);
        let mut directives = vec![];
        for (carrier_index, actor) in battle
            .actors
            .iter()
            .filter(|a| {
                a.team == TeamId::B
                    && a.definition().air_wing.is_some()
                    && a.physical_loss().is_none()
            })
            .enumerate()
        {
            let wing = battle.aviation.wing(&actor.motion.id).unwrap();
            let flights = battle.aviation.squadron_flights(actor);
            let active: Vec<_> = flights
                .iter()
                .filter(|f| active_flight(f, &wing.planes))
                .collect();
            let available = |f: &&crate::aircraft::AirFlight| {
                !active_flight(f, &wing.planes)
                    && wing
                        .planes
                        .iter()
                        .any(|p| f.plane_ids.contains(&p.id) && p.hp > 0.0)
                    && wing
                        .planes
                        .iter()
                        .filter(|p| f.plane_ids.contains(&p.id) && p.hp > 0.0)
                        .all(|p| matches!(p.phase.as_str(), "ready" | "hangar"))
            };
            let role = |f: &crate::aircraft::AirFlight| {
                wing.planes
                    .iter()
                    .find(|p| f.plane_ids.contains(&p.id) && p.hp > 0.0)
                    .map_or("", |p| p.role.as_str())
            };
            let ready: Vec<_> = flights.iter().filter(available).collect();
            let on_task = |f: &crate::aircraft::AirFlight| {
                wing.planes.iter().any(|p| {
                    f.plane_ids.contains(&p.id)
                        && p.hp > 0.0
                        && matches!(
                            p.phase.as_str(),
                            "queued" | "taxi" | "launch-ready" | "takeoff" | "outbound" | "attack"
                        )
                })
            };
            let cap = active
                .iter()
                .any(|f| on_task(f) && matches!(f.order, AirOrder::Defend { .. }));
            let strike = active
                .iter()
                .find(|f| on_task(f) && matches!(f.order, AirOrder::Strike { .. }));
            let escort = strike.is_some_and(|strike| {
                active.iter().any(
                    |f| matches!(&f.order, AirOrder::Escort {flight_id} if flight_id == &strike.id),
                )
            });
            let fighter = ready.iter().find(|f| role(f) == "fighter").copied();
            let threat = reports
                .iter()
                .filter(|c| {
                    c.kind == ContactKind::Aircraft
                        && c.affiliation == Affiliation::Hostile
                        && battle.tick.saturating_sub(c.last_observed_tick) <= 4 * TICK_RATE
                })
                .filter(|c| {
                    (c.estimated_position[0] - actor.motion.x)
                        .hypot(c.estimated_position[2] - actor.motion.z)
                        < 12000.0
                })
                .min_by(|a, b| {
                    a.uncertainty_m
                        .total_cmp(&b.uncertainty_m)
                        .then(a.id.cmp(&b.id))
                });
            let target = crate::pve_command::priority_contact(battle);
            let defended = threat
                .and_then(|threat| {
                    battle
                        .actors
                        .iter()
                        .filter(|a| a.team == TeamId::B && a.physical_loss().is_none())
                        .min_by(|a, b| {
                            let range = |a: &crate::vessel::Vessel| {
                                (a.motion.x - threat.estimated_position[0])
                                    .hypot(a.motion.z - threat.estimated_position[2])
                            };
                            range(a)
                                .total_cmp(&range(b))
                                .then(a.motion.id.cmp(&b.motion.id))
                        })
                })
                .map(|a| a.motion.id.clone());
            let cap_retask = defended.as_ref().and_then(|id| active.iter().find(|f| on_task(f)
                && matches!(&f.order, AirOrder::Defend {target_id} if target_id.as_deref().unwrap_or(&actor.motion.id) != id))
                .map(|f| (*f,id.clone())));
            let mut chosen = if let Some((flight, id)) = cap_retask {
                Some((
                    flight,
                    AirOrder::Defend {
                        target_id: Some(id),
                    },
                ))
            } else if !cap {
                fighter.map(|f| {
                    (
                        f,
                        AirOrder::Defend {
                            target_id: defended,
                        },
                    )
                })
            } else if let Some(strike) = strike.filter(|_| !escort) {
                fighter.map(|f| {
                    (
                        f,
                        AirOrder::Escort {
                            flight_id: strike.id.clone(),
                        },
                    )
                })
            } else if let Some(threat) = threat.filter(|_| {
                !active
                    .iter()
                    .any(|f| matches!(f.order, AirOrder::InterceptContact { .. }))
            }) {
                fighter.map(|f| {
                    (
                        f,
                        AirOrder::InterceptContact {
                            contact_id: threat.id.clone(),
                        },
                    )
                })
            } else {
                None
            };
            let slot_available = battle.aviation.carrier_rules[&actor.motion.id]
                .active_flights
                .is_none_or(|limit| active.len() < limit);
            if chosen.is_none() && slot_available {
                let bomber = ready
                    .iter()
                    .filter(|f| role(f) != "fighter")
                    .min_by_key(|f| if role(f) == "dive-bomber" { 0 } else { 1 })
                    .copied();
                if let Some(f) = bomber {
                    if let Some(c) = target.as_ref() {
                        // Keep a compatibility-mode slot available for the strike's escort.
                        let escort_room = fighter.is_none()
                            || escort
                            || battle.aviation.carrier_rules[&actor.motion.id]
                                .active_flights
                                .is_none_or(|limit| active.len() + 1 < limit);
                        if escort_room {
                            chosen = Some((
                                f,
                                AirOrder::Strike {
                                    contact_id: c.id.clone(),
                                },
                            ));
                        }
                    } else if !active
                        .iter()
                        .any(|f| on_task(f) && matches!(f.order, AirOrder::SearchArea { .. }))
                    {
                        let sorties = wing
                            .planes
                            .iter()
                            .filter(|p| f.plane_ids.contains(&p.id))
                            .map(|p| p.sortie.unwrap_or(0))
                            .max()
                            .unwrap_or(0);
                        let sector =
                            (sorties as usize + carrier_index + self.setup.seed as usize % 3) % 3;
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
                }
            }
            if let Some((f, order)) = chosen {
                let planes: Vec<_> = wing
                    .planes
                    .iter()
                    .filter(|p| f.plane_ids.contains(&p.id) && p.hp > 0.0)
                    .collect();
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
                if let Some(intent) = intent {
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
            }
        }
        directives
    }
}
