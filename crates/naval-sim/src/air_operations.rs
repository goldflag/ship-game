//! Persistent orders own existing groups, never aircraft or ammunition. Only
//! accepted commands create stations/packages; parked default orders do not.
use crate::{
    aircraft::{AirOrder, Aircraft, FIGHTER_AMMO_BURSTS, active_flight, terminal},
    aviation::Aviation,
    deck_operations::DeckAction,
    environment::SeaState,
    vessel::Vessel,
};
#[path = "air_packages.rs"]
mod packages;
pub use packages::AttackPackage;

#[derive(Clone, Debug)]
pub struct PatrolStation {
    pub owner_id: String,
    pub order: AirOrder,
    /// At most two groups rotate. Other groups retain their orders/reserve.
    pub groups: Vec<String>,
    pub current: String,
    pub relief: Option<String>,
}
#[derive(Clone, Debug, Default)]
pub struct AirOperations {
    pub stations: Vec<PatrolStation>,
    pub packages: Vec<AttackPackage>,
    pub(crate) now: f64,
    next_patrol_check: f64,
    next_package_check: f64,
    internal_command: bool,
    pub(crate) package_sequence: u64,
}
impl Aviation {
    pub(crate) fn record_air_order(&mut self, actor: &Vessel, id: &str, order: &AirOrder) {
        if self.operations.internal_command {
            return;
        }
        // A command addresses the station through either rotation member.
        self.cancel_air_operation(&actor.motion.id, Some(id));
        let fighter = self.wing(&actor.motion.id).is_some_and(|w| {
            w.planes
                .iter()
                .any(|p| p.flight_id.as_deref() == Some(id) && p.role == "fighter")
        });
        if fighter && matches!(order, AirOrder::Defend { .. } | AirOrder::Patrol { .. }) {
            self.operations.stations.push(PatrolStation {
                owner_id: actor.motion.id.clone(),
                order: order.clone(),
                groups: vec![id.into()],
                current: id.into(),
                relief: None,
            });
        }
        self.record_package_order(actor, id, order);
    }
    pub(crate) fn cancel_air_operation(&mut self, owner: &str, flight: Option<&str>) {
        if self.operations.internal_command {
            return;
        }
        let mut cancelled = vec![];
        self.operations.stations.retain(|s| {
            let remove =
                s.owner_id == owner && flight.is_none_or(|f| s.groups.iter().any(|id| id == f));
            if remove {
                cancelled.extend(
                    s.groups
                        .iter()
                        .filter(|id| flight != Some(id.as_str()))
                        .cloned(),
                );
            }
            !remove
        });
        self.operations.internal_command = true;
        for id in cancelled {
            self.recall(owner, Some(&id));
        }
        self.operations.internal_command = false;
        for package in &mut self.operations.packages {
            if package.owner_id == owner {
                package
                    .members
                    .retain(|m| flight.is_some_and(|id| m.flight_id != id));
            }
        }
        self.operations.packages.retain(|p| !p.members.is_empty());
    }
    /// Five-second admission checks avoid retrying deck requests every tick.
    pub fn step_air_operations(
        &mut self,
        actors: &[Vessel],
        sea: Option<(&SeaState, f64)>,
        time: f64,
    ) {
        self.operations.now = time;
        if time >= self.operations.next_package_check {
            self.operations.next_package_check = time + 1.0;
            self.refresh_packages();
        }
        if time < self.operations.next_patrol_check {
            return;
        }
        self.operations.next_patrol_check = time + 5.0;
        let stations = std::mem::take(&mut self.operations.stations);
        let reserved: Vec<_> = stations
            .iter()
            .flat_map(|s| s.groups.iter().cloned())
            .collect();
        self.operations.internal_command = true;
        for mut station in stations {
            let Some(actor) = actors
                .iter()
                .find(|a| a.motion.id == station.owner_id && a.physical_loss().is_none())
            else {
                continue;
            };
            let anchor = match &station.order {
                AirOrder::Defend { target_id } => actors
                    .iter()
                    .find(|a| {
                        a.motion.id == target_id.as_deref().unwrap_or(&station.owner_id)
                            && a.team == actor.team
                            && a.physical_loss().is_none()
                    })
                    .map(|a| [a.motion.x, 850.0, a.motion.z]),
                AirOrder::Patrol { point } => Some(*point),
                _ => None,
            };
            let Some(anchor) = anchor else {
                for id in &station.groups {
                    self.recall(&station.owner_id, Some(id));
                }
                continue;
            };
            for id in &mut station.groups {
                *id = self.resolved_flight_id(&station.owner_id, id);
            }
            station.groups.sort();
            station.groups.dedup();
            station.current = self.resolved_flight_id(&station.owner_id, &station.current);
            station.relief = station
                .relief
                .map(|id| self.resolved_flight_id(&station.owner_id, &id));
            // Keep all assignments visible while choosing a spare below, including
            // stations not processed yet (the original groups are active).
            if let Some(relief) = station.relief.clone() {
                let w = self.wing(&station.owner_id).unwrap();
                let relief_planes: Vec<_> = w
                    .planes
                    .iter()
                    .filter(|p| p.flight_id.as_deref() == Some(&relief) && !terminal(p))
                    .collect();
                let on_station = relief_planes.iter().any(|p| {
                    matches!(p.phase.as_str(), "outbound" | "attack")
                        && p.hp >= 25.0
                        && p.ammo > 0.0
                        && (p.position[0] - anchor[0]).hypot(p.position[2] - anchor[2]) < 2200.0
                });
                if on_station {
                    let outgoing = station.current.clone();
                    self.recall(&station.owner_id, Some(&outgoing));
                    self.patrol_notice(
                        &station.owner_id,
                        &outgoing,
                        "Patrol relieved · returning for service",
                    );
                    station.current = relief;
                    station.relief = None;
                    self.patrol_notice(
                        &station.owner_id,
                        &station.current,
                        "Continuous patrol · on station",
                    );
                } else if relief_planes.is_empty()
                    || relief_planes
                        .iter()
                        .all(|p| matches!(p.phase.as_str(), "returning" | "landing"))
                {
                    station.relief = None;
                }
            }
            let w = self.wing(&station.owner_id).unwrap();
            let current: Vec<_> = w
                .planes
                .iter()
                .filter(|p| p.flight_id.as_deref() == Some(&station.current) && !terminal(p))
                .collect();
            let lead_seconds =
                90.0 + (anchor[0] - actor.motion.x).hypot(anchor[2] - actor.motion.z) / 90.0;
            let grounded = !current.is_empty()
                && current.iter().all(|p| {
                    matches!(
                        p.phase.as_str(),
                        "ready" | "hangar" | "repairing" | "rearming"
                    )
                });
            let needs_relief = grounded
                || current.is_empty()
                || current.iter().any(|p| {
                    p.ammo <= FIGHTER_AMMO_BURSTS * 0.25
                        || p.hp < 45.0
                        || self
                            .rules
                            .endurance
                            .needs_recall(p.flight_time + lead_seconds, true)
                        || matches!(p.phase.as_str(), "returning" | "landing")
                })
                || current.len() < self.flight_size(actor).div_ceil(2);
            if station.relief.is_none() && needs_relief {
                let candidate = grounded.then(|| station.current.clone()).or_else(|| {
                    station
                        .groups
                        .iter()
                        .find(|id| **id != station.current)
                        .cloned()
                        .or_else(|| self.patrol_spare(actor, &station, &reserved))
                });
                if let Some(id) = candidate {
                    // Reserve the candidate during service, so a second station
                    // cannot consume it and there is no chain of relief launches.
                    if !station.groups.contains(&id) {
                        station.groups.push(id.clone());
                    }
                    let flight = self
                        .squadron_flights(actor)
                        .into_iter()
                        .find(|f| f.id == id);
                    if let Some(flight) = flight {
                        let serviced = self
                            .wing(&station.owner_id)
                            .unwrap()
                            .planes
                            .iter()
                            .filter(|p| flight.plane_ids.contains(&p.id) && !terminal(p))
                            .all(|p| {
                                p.hp >= self.rules.repair_ceiling_hp.min(45.0).max(25.0)
                                    && p.ammo >= FIGHTER_AMMO_BURSTS * 0.75
                            });
                        if serviced
                            && self.launch_squadron(
                                actor,
                                &flight.squadron_id,
                                None,
                                Some(station.order.clone()),
                                actors,
                                Some(&id),
                                sea,
                            ) > 0
                        {
                            station.relief = (id != station.current).then(|| id.clone());
                            self.patrol_notice(&station.owner_id, &id, "Patrol relief · launching");
                            self.patrol_notice(
                                &station.owner_id,
                                &station.current,
                                "Continuous patrol · relief launching",
                            );
                        } else {
                            self.prepare_patrol_group(&station.owner_id, &id);
                            self.patrol_notice(
                                &station.owner_id,
                                &station.current,
                                "Continuous patrol · waiting for relief aircraft/deck",
                            );
                        }
                    }
                } else {
                    self.patrol_notice(
                        &station.owner_id,
                        &station.current,
                        "Continuous patrol · reserve retained; no relief available",
                    );
                }
            }
            self.operations.stations.push(station);
        }
        self.operations.internal_command = false;
    }
    fn patrol_notice(&mut self, owner: &str, id: &str, notice: &str) {
        if let Some(f) = self
            .wing_mut(owner)
            .and_then(|w| w.flights.iter_mut().find(|f| f.id == id))
        {
            if f.notice.as_deref() != Some(notice) {
                f.notice = Some(notice.into());
            }
        }
    }
    fn patrol_spare(
        &self,
        actor: &Vessel,
        station: &PatrolStation,
        reserved: &[String],
    ) -> Option<String> {
        if station.groups.len() >= 2 {
            return None;
        }
        let w = self.wing(&station.owner_id)?;
        let mut candidates: Vec<_> = self.squadron_flights(actor).into_iter().filter(|f| {
            !station.groups.contains(&f.id)
                    && !reserved.contains(&f.id)
                && !self.operations.stations.iter().any(|s| s.groups.contains(&f.id))
                && !active_flight(f, &w.planes)
                // Explicitly tasked groups remain allocated, even while parked.
                && matches!(f.order, AirOrder::Defend { target_id: None })
                && w.planes.iter().any(|p| f.plane_ids.contains(&p.id) && !terminal(p) && p.role == "fighter")
        }).collect();
        candidates.sort_by_key(|f| (std::cmp::Reverse(f.plane_ids.len()), f.id.clone()));
        // Keep one untouched group in reserve. The player can still launch it.
        (candidates.len() >= 2).then(|| candidates[0].id.clone())
    }
    fn prepare_patrol_group(&mut self, owner: &str, id: &str) {
        let Some(ops) = self.deck_operations.get(owner) else {
            return;
        };
        let w = self.wing(owner).unwrap();
        if ops.group_busy(w, id) {
            return;
        }
        let planes: Vec<&Aircraft> = w
            .planes
            .iter()
            .filter(|p| p.flight_id.as_deref() == Some(id) && !terminal(p))
            .collect();
        if planes.is_empty() {
            return;
        }
        let action = if planes
            .iter()
            .any(|p| p.hp < 45.0 || p.ammo < FIGHTER_AMMO_BURSTS)
        {
            Some(DeckAction::Repair)
        } else if planes
            .iter()
            .all(|p| matches!(p.phase.as_str(), "hangar" | "ready"))
            && planes.iter().any(|p| p.phase == "hangar")
        {
            Some(DeckAction::Raise)
        } else {
            None
        };
        if let Some(action) = action {
            let _ = self.deck_command(owner, id, action);
        }
    }
}
