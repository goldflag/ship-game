use crate::{
    aircraft::*, aircraft_deck::GroundPose, environment::SeaState, machinery::equipment_condition,
    vessel::Vessel,
};
use std::collections::BTreeMap;
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CarrierWing {
    pub owner_id: String,
    pub state: AirWingState,
}
#[derive(Clone, Debug, serde::Serialize)]
pub struct Aviation {
    pub wings: Vec<CarrierWing>,
    #[serde(skip)]
    pub ground: BTreeMap<String, GroundPose>,
}
pub fn flight_size(actor: &Vessel) -> usize {
    actor
        .definition()
        .air_wing
        .as_ref()
        .and_then(|w| w.flight_size)
        .unwrap_or(3.0) as usize
}
pub fn deck_capacity(actor: &Vessel) -> usize {
    actor
        .definition()
        .air_wing
        .as_ref()
        .and_then(|w| w.deck_capacity)
        .unwrap_or(18.0) as usize
}
pub fn service_available(actor: &Vessel, sea: Option<(&SeaState, f64)>) -> bool {
    let def = actor.definition();
    let module = def
        .air_wing
        .as_ref()
        .and_then(|w| def.modules.iter().find(|m| m.id == w.service_module_id));
    module.is_some_and(|m| {
        actor.physical_loss().is_none()
            && actor.motion.roll.abs() < 0.22
            && actor.motion.pitch.abs() < 0.15
            && actor.motion.y > -3.0
            && equipment_condition(actor, def, m, sea).availability > 0.0
    })
}
impl Aviation {
    pub fn new(actors: &[Vessel], ground: BTreeMap<String, GroundPose>) -> Self {
        Self {
            wings: actors
                .iter()
                .filter_map(|a| {
                    create_air_wing(a.definition(), &a.motion.id, a.team).map(|state| CarrierWing {
                        owner_id: a.motion.id.clone(),
                        state,
                    })
                })
                .collect(),
            ground,
        }
    }
    pub fn wing(&self, id: &str) -> Option<&AirWingState> {
        self.wings
            .iter()
            .find(|w| w.owner_id == id)
            .map(|w| &w.state)
    }
    pub fn wing_mut(&mut self, id: &str) -> Option<&mut AirWingState> {
        self.wings
            .iter_mut()
            .find(|w| w.owner_id == id)
            .map(|w| &mut w.state)
    }
    pub fn planes(&self) -> Vec<&Aircraft> {
        self.wings.iter().flat_map(|w| &w.state.planes).collect()
    }
    pub fn plane_mut(&mut self, id: &str) -> Option<&mut Aircraft> {
        self.wings
            .iter_mut()
            .flat_map(|w| &mut w.state.planes)
            .find(|p| p.id == id)
    }
    pub fn squadron_flights(&self, actor: &Vessel) -> Vec<AirFlight> {
        let Some(state) = self.wing(&actor.motion.id) else {
            return vec![];
        };
        let size = flight_size(actor);
        actor
            .definition()
            .air_wing
            .iter()
            .flat_map(|w| &w.squadrons)
            .flat_map(|s| {
                let planes: Vec<_> = state
                    .planes
                    .iter()
                    .filter(|p| p.squadron_id == s.id)
                    .collect();
                planes
                    .chunks(size)
                    .enumerate()
                    .map(|(i, planes)| {
                        let id = format!("{}/{}/squadron-{}", actor.motion.id, s.id, i + 1);
                        state
                            .flights
                            .iter()
                            .find(|f| f.id == id)
                            .cloned()
                            .unwrap_or_else(|| AirFlight {
                                id,
                                name: format!(
                                    "{} {}",
                                    match s.role.as_str() {
                                        "fighter" => "Fighter",
                                        "dive-bomber" => "Dive",
                                        _ => "Torpedo",
                                    },
                                    i + 1
                                ),
                                squadron_id: s.id.clone(),
                                plane_ids: planes.iter().map(|p| p.id.clone()).collect(),
                                order: AirOrder::Defend { target_id: None },
                                notice: None,
                                merged_into: None,
                            })
                    })
                    .collect::<Vec<_>>()
            })
            .filter(|f| f.merged_into.is_none())
            .collect()
    }
    pub fn valid_order(
        &self,
        actor: &Vessel,
        flight_id: &str,
        planes: &[&Aircraft],
        order: &AirOrder,
        actors: &[Vessel],
        refuelled: bool,
    ) -> bool {
        if matches!(order, AirOrder::Return) {
            return true;
        }
        if planes.is_empty()
            || planes
                .iter()
                .any(|p| !refuelled && p.flight_time > 470.0 || p.hp < 25.0)
        {
            return false;
        }
        match order {
            AirOrder::Patrol { point } => {
                point.iter().all(|n| n.is_finite())
                    && (point[0] - actor.motion.x).hypot(point[2] - actor.motion.z) <= 30000.0
            }
            AirOrder::Attack { target_id } => {
                actors.iter().any(|a| {
                    a.motion.id == *target_id
                        && a.team != actor.team
                        && a.physical_loss().is_none()
                        && a.motion.y >= -8.0
                }) && planes.iter().all(|p| p.role != "fighter" && p.payload)
            }
            _ => {
                if planes.iter().any(|p| p.role != "fighter" || p.ammo <= 0.0) {
                    return false;
                }
                match order {
                    AirOrder::Defend { target_id } => target_id.as_ref().is_none_or(|id| {
                        actors.iter().any(|a| {
                            &a.motion.id == id
                                && a.team == actor.team
                                && a.physical_loss().is_none()
                        })
                    }),
                    AirOrder::Escort { flight_id: id } | AirOrder::Intercept { flight_id: id } => {
                        id != flight_id
                            && actors.iter().any(|a| {
                                (if matches!(order, AirOrder::Escort { .. }) {
                                    a.team == actor.team
                                } else {
                                    a.team != actor.team
                                }) && self.wing(&a.motion.id).is_some_and(|w| {
                                    w.flights
                                        .iter()
                                        .any(|f| f.id == *id && active_flight(f, &w.planes))
                                })
                            })
                    }
                    _ => false,
                }
            }
        }
    }
    #[allow(clippy::too_many_arguments)]
    pub fn launch_squadron(
        &mut self,
        actor: &Vessel,
        squadron_id: &str,
        target: Option<&Vessel>,
        requested: Option<AirOrder>,
        actors: &[Vessel],
        flight_id: Option<&str>,
        sea: Option<(&SeaState, f64)>,
    ) -> usize {
        if !service_available(actor, sea) {
            return 0;
        }
        let Some(state) = self.wing(&actor.motion.id) else {
            return 0;
        };
        let max = actor
            .definition()
            .air_wing
            .as_ref()
            .and_then(|w| w.max_active_flights)
            .unwrap_or(4.0) as usize;
        if state
            .flights
            .iter()
            .filter(|f| active_flight(f, &state.planes))
            .count()
            >= max
        {
            return 0;
        }
        let Some(mut flight) = self.squadron_flights(actor).into_iter().find(|f| {
            f.squadron_id == squadron_id
                && flight_id.is_none_or(|id| f.id == id)
                && state
                    .planes
                    .iter()
                    .any(|p| f.plane_ids.contains(&p.id) && p.phase != "lost")
                && state
                    .planes
                    .iter()
                    .filter(|p| f.plane_ids.contains(&p.id))
                    .all(|p| matches!(p.phase.as_str(), "ready" | "lost"))
        }) else {
            return 0;
        };
        let planes: Vec<_> = state
            .planes
            .iter()
            .filter(|p| flight.plane_ids.contains(&p.id) && p.phase == "ready")
            .collect();
        let order = requested.unwrap_or_else(|| {
            if planes[0].role == "fighter" {
                AirOrder::Defend { target_id: None }
            } else {
                AirOrder::Attack {
                    target_id: target.map_or(String::new(), |a| a.motion.id.clone()),
                }
            }
        });
        if matches!(order, AirOrder::Return)
            || !self.valid_order(actor, &flight.id, &planes, &order, actors, true)
        {
            return 0;
        }
        let count = planes.len();
        flight.order = order.clone();
        flight.notice = None;
        let state = self.wing_mut(&actor.motion.id).unwrap();
        state.flights.retain(|f| f.id != flight.id);
        for p in &mut state.planes {
            if !flight.plane_ids.contains(&p.id) || p.phase != "ready" {
                continue;
            }
            p.sortie = Some(p.sortie.unwrap_or(0) + 1);
            p.phase = "queued".into();
            p.flight_id = Some(flight.id.clone());
            p.target_id = match &order {
                AirOrder::Attack { target_id } => Some(target_id.clone()),
                _ => None,
            };
            p.pilot = Default::default();
            p.flight_time = 0.0;
            p.timer = 0.0;
            p.recovery_requested_at = None;
            p.loss_reason = None;
        }
        state.flights.push(flight);
        state.flight_sequence += 1;
        count
    }
    pub fn recall(&mut self, actor_id: &str, flight_id: Option<&str>) {
        let Some(state) = self.wing_mut(actor_id) else {
            return;
        };
        for f in &mut state.flights {
            if flight_id.is_none_or(|id| id == f.id) {
                f.order = AirOrder::Return;
                f.notice = Some("Recalled".into());
            }
        }
        for p in &mut state.planes {
            if flight_id.is_some_and(|id| p.flight_id.as_deref() != Some(id)) {
                continue;
            }
            if p.phase == "queued" {
                p.phase = "ready".into();
                p.deck_slot = None;
                p.deck_position = None;
            } else if p.phase == "taxi" || p.phase == "takeoff" && on_flight_deck(p) {
                p.phase = "parking".into();
            } else if airborne(p) && p.phase != "landing" {
                p.phase = "returning".into();
            }
        }
    }
    pub fn order_flight(
        &mut self,
        actor: &Vessel,
        flight_id: &str,
        order: AirOrder,
        actors: &[Vessel],
    ) -> bool {
        let Some(state) = self.wing(&actor.motion.id) else {
            return false;
        };
        let Some(flight) = state.flights.iter().find(|f| f.id == flight_id) else {
            return false;
        };
        if !active_flight(flight, &state.planes) || actor.physical_loss().is_some() {
            return false;
        }
        if matches!(order, AirOrder::Return) {
            self.recall(&actor.motion.id, Some(flight_id));
            return true;
        }
        let planes: Vec<_> = state
            .planes
            .iter()
            .filter(|p| {
                p.flight_id.as_deref() == Some(flight_id)
                    && matches!(
                        p.phase.as_str(),
                        "queued" | "taxi" | "takeoff" | "outbound" | "attack" | "returning"
                    )
            })
            .collect();
        if !self.valid_order(actor, flight_id, &planes, &order, actors, false) {
            return false;
        }
        let state = self.wing_mut(&actor.motion.id).unwrap();
        let f = state
            .flights
            .iter_mut()
            .find(|f| f.id == flight_id)
            .unwrap();
        f.order = order.clone();
        f.notice = None;
        for p in &mut state.planes {
            if p.flight_id.as_deref() != Some(flight_id)
                || !matches!(
                    p.phase.as_str(),
                    "queued" | "taxi" | "takeoff" | "outbound" | "attack" | "returning"
                )
            {
                continue;
            }
            p.target_id = match &order {
                AirOrder::Attack { target_id } => Some(target_id.clone()),
                _ => None,
            };
            p.pilot = Default::default();
            p.recovery_requested_at = None;
            if matches!(p.phase.as_str(), "outbound" | "attack" | "returning") {
                p.phase = "outbound".into();
            }
        }
        true
    }
    pub fn command_squadron(
        &mut self,
        actor: &Vessel,
        id: &str,
        order: AirOrder,
        actors: &[Vessel],
        sea: Option<(&SeaState, f64)>,
    ) -> bool {
        let Some(f) = self
            .squadron_flights(actor)
            .into_iter()
            .find(|f| f.id == id)
        else {
            return false;
        };
        if active_flight(&f, &self.wing(&actor.motion.id).unwrap().planes) {
            self.order_flight(actor, id, order, actors)
        } else {
            self.launch_squadron(
                actor,
                &f.squadron_id,
                None,
                Some(order),
                actors,
                Some(id),
                sea,
            ) > 0
        }
    }
}
