//! Physical deck handling. Requests reference the wing's aircraft; this module
//! never owns a second inventory or creates replacement aircraft.
use crate::{
    air_rules::DeckTimings,
    aircraft::{AirWingState, Aircraft, FIGHTER_AMMO_BURSTS, aircraft_service_seconds},
    aircraft_deck::{GroundPose, deck_attitude},
    deck_navigation::{DeckTraffic, RouteProgress, RouteSearch},
    flight_deck::{DeckPose, Envelope},
    geometry::{add, length, local_to_world, scale, sub, wrap_angle},
    vessel::Vessel,
};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
#[path = "deck_recovery.rs"]
mod recovery;
#[path = "deck_scheduling.rs"]
mod scheduling;
pub use scheduling::DeckPolicy;

#[derive(
    Clone,
    Copy,
    Debug,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    serde::Serialize,
    serde::Deserialize,
    ts_rs::TS,
)]
#[serde(rename_all = "kebab-case")]
pub enum DeckAction {
    Raise,
    Stow,
    Rearm,
    Repair,
    Launch,
}
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeckRequest {
    pub id: u64,
    pub flight_id: String,
    pub action: DeckAction,
    pub automatic: bool,
}
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeckStatus {
    pub queue: Vec<DeckRequest>,
    pub policy: DeckPolicy,
    pub next_request_id: Option<u64>,
    pub current_plane_id: Option<String>,
    pub task: Option<String>,
    pub step_remaining_seconds: Option<f64>,
    pub suspended: bool,
    pub notice: Option<String>,
    pub occupied: usize,
    pub capacity: usize,
    pub group_size: usize,
    pub active_flight_limit: Option<usize>,
    pub endurance: crate::air_rules::EndurancePolicy,
    pub repair_ceiling_hp: f64,
}
#[derive(Clone, Debug)]
enum Destination {
    Spot(usize),
    Hangar { repair: bool },
    Launch,
}
#[derive(Clone, Debug)]
enum Stage {
    Planning,
    LiftUp(f64),
    Taxi,
    LiftDown(f64),
    Unfold,
    AwaitLanding,
    Rollout { elapsed: f64, from: DeckPose },
    Fold,
}
#[derive(Clone, Debug)]
struct Job {
    plane_id: String,
    request_id: u64,
    destination: Destination,
    elevator: usize,
    from: DeckPose,
    to: DeckPose,
    search: Option<RouteSearch>,
    path: VecDeque<DeckPose>,
    stage: Stage,
    cancelled: bool,
    arrival: bool,
    runway_checked: bool,
}
// Only physical occupancy/folding belongs in this key. A parked plane receiving
// a new air order must not invalidate every route on the deck.
type OccupancyKey = Vec<(String, Option<[f64; 3]>, Option<usize>, f64, f64, bool)>;
#[derive(Clone, Debug)]
pub struct DeckOperations {
    timings: DeckTimings,
    capacity: usize,
    group_size: usize,
    active_flight_limit: Option<usize>,
    endurance: crate::air_rules::EndurancePolicy,
    repair_ceiling: f64,
    queue: VecDeque<DeckRequest>,
    sequence: u64,
    active: Option<Job>,
    revision: u64,
    occupancy: OccupancyKey,
    failed: BTreeSet<(String, DeckAction, usize)>,
    notice: Option<String>,
    batch: scheduling::BatchSchedule,
    next_request_id: Option<u64>,
    closed: bool,
}
fn pose(p: &Aircraft, ground: &GroundPose) -> DeckPose {
    DeckPose {
        position: sub(p.deck_position.unwrap(), [0.0, ground.clearance, 0.0]),
        heading: p.deck_heading.unwrap_or(0.0),
    }
}
pub fn place(p: &mut Aircraft, actor: &Vessel, at: DeckPose, ground: &GroundPose) {
    let root = add(at.position, [0.0, ground.clearance, 0.0]);
    p.deck_position = Some(root);
    p.deck_heading = Some(at.heading);
    p.position = local_to_world(root, actor.motion.pose());
    let attitude = deck_attitude(actor.motion.pose(), ground, at.heading);
    p.heading = attitude.heading;
    p.pitch = attitude.pitch;
    p.bank = attitude.bank;
    p.velocity = actor.motion.velocity();
}
fn needs_hangar_service(p: &Aircraft, repair_ceiling: f64) -> bool {
    p.hp < repair_ceiling
        || if p.role == "fighter" {
            p.ammo < crate::aircraft::FIGHTER_AMMO_BURSTS
        } else {
            !p.payload
        }
}
fn restock(p: &mut Aircraft) {
    p.ammo = if p.role == "fighter" {
        FIGHTER_AMMO_BURSTS
    } else {
        0.0
    };
    p.payload = p.role != "fighter";
    p.flight_time = 0.0;
    p.recovery_requested_at = None;
    p.timer = 0.0;
}
impl DeckOperations {
    /// A group's explicit handling intent must finish or be cancelled before
    /// automatic consolidation can change its membership.
    pub(crate) fn group_busy(&self, state: &AirWingState, flight_id: &str) -> bool {
        self.queue.iter().any(|r| r.flight_id == flight_id)
            || self.active.as_ref().is_some_and(|job| {
                state
                    .planes
                    .iter()
                    .any(|p| p.id == job.plane_id && p.flight_id.as_deref() == Some(flight_id))
            })
    }
    pub fn initialize(
        state: &mut AirWingState,
        actor: &Vessel,
        ground: &BTreeMap<String, GroundPose>,
        rules: &crate::air_rules::AirRules,
        resolved: &crate::air_rules::CarrierAirRules,
        startup_per_role: usize,
    ) -> Result<Self, String> {
        let crate::air_rules::DeckCycle::Managed { timings, .. } = &rules.deck_cycle else {
            return Err("Managed deck policy required".into());
        };
        let capacity = resolved.deck_capacity;
        let layout = actor
            .definition()
            .air_wing
            .as_ref()
            .unwrap()
            .deck_layout
            .as_ref()
            .ok_or("Managed operations require a physical layout")?;
        let mut allocated: BTreeMap<String, usize> = BTreeMap::new();
        let mut occupied = vec![];
        for p in &mut state.planes {
            let g = ground
                .get(&p.model_id)
                .ok_or("Missing aircraft ground pose")?;
            let model = g
                .deck_geometry
                .as_ref()
                .filter(|m| m.valid())
                .ok_or("Managed operations require measured aircraft geometry")?;
            if !layout.elevators.iter().any(|e| {
                model.parked.max[0] - model.parked.min[0] <= e.width_m
                    && model.parked.max[2] - model.parked.min[2] <= e.length_m
            }) {
                return Err("Aircraft cannot fit any fitted elevator".into());
            }
            p.phase = "hangar".into();
            p.wing_fold = if g.folding_wings { 1.0 } else { 0.0 };
            let count = allocated.entry(p.role.clone()).or_default();
            if *count >= startup_per_role {
                continue;
            }
            let (index, spot) = layout
                .spots
                .iter()
                .enumerate()
                .filter(|(_, s)| s.preferred_role == p.role)
                .nth(*count)
                .ok_or("Not enough authored parking positions for startup groups")?;
            let at = DeckPose {
                position: spot.position,
                heading: 0.0,
            };
            if occupied.len() >= capacity
                || !(DeckTraffic {
                    ship: actor.definition(),
                    occupied: &occupied,
                })
                .clear(model, at)
            {
                return Err("Startup aircraft do not fit the physical deck".into());
            }
            occupied.push((model.parked, at));
            p.deck_slot = Some(index);
            p.phase = "ready".into();
            place(p, actor, at, g);
            p.previous_position = p.position;
            *count += 1;
        }
        if allocated.values().any(|n| *n != startup_per_role) {
            return Err("Startup allocation exceeds a role's aircraft inventory".into());
        }
        let ops = Self {
            timings: timings.clone(),
            capacity,
            group_size: resolved.group_size,
            active_flight_limit: resolved.active_flights,
            endurance: rules.endurance.clone(),
            repair_ceiling: rules.repair_ceiling_hp,
            queue: VecDeque::new(),
            sequence: 0,
            active: None,
            revision: 0,
            occupancy: vec![],
            failed: BTreeSet::new(),
            notice: None,
            batch: scheduling::BatchSchedule::default(),
            next_request_id: None,
            closed: false,
        };
        ops.publish(state, false);
        Ok(ops)
    }
    pub fn enqueue(
        &mut self,
        state: &AirWingState,
        flight_id: &str,
        action: DeckAction,
    ) -> Result<u64, String> {
        if self.closed {
            return Err("Carrier flight operations are permanently unavailable".into());
        }
        let flight = state
            .flights
            .iter()
            .find(|f| f.id == flight_id && f.merged_into.is_none())
            .ok_or("Unknown aircraft group")?;
        let survivors: Vec<_> = state
            .planes
            .iter()
            .filter(|p| flight.plane_ids.contains(&p.id) && !crate::aircraft::terminal(p))
            .collect();
        if survivors.is_empty() {
            return Err("No surviving aircraft in this group".into());
        }
        if self
            .queue
            .iter()
            .any(|r| r.flight_id == flight_id && r.automatic)
        {
            return Err("Group is clearing flight operations; wait for the current move".into());
        }
        let eligible = match action {
            DeckAction::Raise => {
                survivors.iter().any(|p| p.phase == "hangar")
                    && survivors
                        .iter()
                        .all(|p| p.phase == "hangar" || p.phase == "ready" && p.deck_slot.is_some())
            }
            DeckAction::Launch => survivors
                .iter()
                .all(|p| p.phase == "ready" && p.deck_slot.is_some()),
            DeckAction::Rearm => survivors
                .iter()
                .all(|p| p.phase == "ready" && p.deck_slot.is_some()),
            DeckAction::Repair => survivors.iter().any(|p| {
                p.phase == "hangar" && needs_hangar_service(p, self.repair_ceiling)
                    || matches!(p.phase.as_str(), "ready" | "rearming") && p.deck_slot.is_some()
            }),
            DeckAction::Stow => survivors
                .iter()
                .any(|p| matches!(p.phase.as_str(), "ready" | "rearming") && p.deck_slot.is_some()),
        };
        if !eligible {
            return Err("Group is not ready for this deck operation".into());
        }
        if self.queue.len() >= 64 {
            return Err("Deck handling queue is full".into());
        }
        // An in-progress aircraft finishes at a safe destination before a
        // replacement request changes the remaining members' handling.
        let previous: Vec<_> = self
            .queue
            .iter()
            .filter(|r| r.flight_id == flight_id)
            .map(|r| r.id)
            .collect();
        for id in previous {
            self.cancel(id);
        }
        self.sequence += 1;
        self.queue.push_back(DeckRequest {
            id: self.sequence,
            flight_id: flight_id.into(),
            action,
            automatic: false,
        });
        self.notice = None;
        Ok(self.sequence)
    }
    pub fn cancel(&mut self, id: u64) -> bool {
        if self.queue.iter().any(|r| r.id == id && r.automatic) {
            return false;
        }
        let before = self.queue.len();
        self.queue.retain(|r| r.id != id);
        if before == self.queue.len() {
            return false;
        }
        if self.next_request_id == Some(id) {
            self.next_request_id = None;
        }
        if self.active.as_ref().is_some_and(|j| j.request_id == id) {
            if self
                .active
                .as_ref()
                .is_some_and(|j| matches!(j.stage, Stage::Planning))
            {
                self.active = None;
            } else {
                self.active.as_mut().unwrap().cancelled = true;
                self.notice = Some("Finishing the current aircraft's move before stopping".into());
            }
        }
        true
    }
    pub fn cancel_launches(&mut self, flight_id: Option<&str>) {
        let ids: Vec<_> = self
            .queue
            .iter()
            .filter(|r| {
                r.action == DeckAction::Launch && flight_id.is_none_or(|id| r.flight_id == id)
            })
            .map(|r| r.id)
            .collect();
        for id in ids {
            self.cancel(id);
        }
    }
    fn occupied(
        state: &AirWingState,
        actor: &Vessel,
        ground: &BTreeMap<String, GroundPose>,
        except: &str,
    ) -> Vec<(Envelope, DeckPose)> {
        state
            .planes
            .iter()
            .filter(|p| {
                p.id != except && !crate::aircraft::terminal(p) && p.deck_position.is_some()
            })
            .map(|p| {
                let g = &ground[&p.model_id];
                let model = g.deck_geometry.as_ref().unwrap();
                let mut envelope = if g.folding_wings && p.wing_fold >= 1.0 {
                    model.parked
                } else {
                    model.sweep
                };
                let at = pose(p, g);
                if p.phase == "takeoff" {
                    let layout = actor
                        .definition()
                        .air_wing
                        .as_ref()
                        .unwrap()
                        .deck_layout
                        .as_ref()
                        .unwrap();
                    // The managed takeoff roll advances along local -Z with
                    // heading zero. Reserve its remaining travel, not just the
                    // current airframe, before admitting a concurrent lift.
                    envelope.min[2] -= (at.position[2] - layout.launch_end[2]).max(0.0);
                }
                (envelope, at)
            })
            .collect()
    }
    fn revise(&mut self, state: &AirWingState) {
        let current: OccupancyKey = state
            .planes
            .iter()
            .filter(|p| {
                !crate::aircraft::terminal(p)
                    && (p.deck_position.is_some() || p.deck_slot.is_some())
            })
            .map(|p| {
                let rolling = p.phase == "takeoff" && p.deck_position.is_some();
                (
                    p.id.clone(),
                    // A takeoff's remaining reservation only shrinks. Paths
                    // checked against an earlier extent stay safe; restarting
                    // their search every moving tick would prevent overlap.
                    if rolling {
                        Some([0.0; 3])
                    } else {
                        p.deck_position
                    },
                    p.deck_slot,
                    p.deck_heading.unwrap_or(0.0),
                    p.wing_fold,
                    rolling,
                )
            })
            .collect();
        if current != self.occupancy {
            self.revision += 1;
            self.occupancy = current;
            self.failed.clear();
        }
    }
    fn select_job(
        &mut self,
        state: &mut AirWingState,
        actor: &Vessel,
        ground: &BTreeMap<String, GroundPose>,
    ) {
        let layout = actor
            .definition()
            .air_wing
            .as_ref()
            .unwrap()
            .deck_layout
            .as_ref()
            .unwrap();
        // One handling job may overlap the last roll in a launch batch once
        // the departing aircraft's remaining runway reservation clears it.
        let rolling = state
            .planes
            .iter()
            .any(|p| p.phase == "takeoff" && p.deck_position.is_some());
        let mut completed = vec![];
        let recovery_waiting = !Self::near_returners(state, actor).is_empty();
        let launch_waiting = self.launch_waiting(state);

        for request in &self.queue {
            if (recovery_waiting || launch_waiting) && request.action == DeckAction::Raise {
                continue;
            }
            let flight = state.flights.iter().find(|f| f.id == request.flight_id);
            let Some(flight) = flight else {
                completed.push(request.id);
                continue;
            };
            let mut indices: Vec<_> = state
                .planes
                .iter()
                .enumerate()
                .filter(|(_, p)| flight.plane_ids.contains(&p.id) && !crate::aircraft::terminal(p))
                .map(|(i, _)| i)
                .collect();
            if matches!(
                request.action,
                DeckAction::Launch | DeckAction::Stow | DeckAction::Repair
            ) {
                indices.sort_by(|&a, &b| {
                    let a = state.planes[a].deck_position.unwrap_or([0.0; 3]);
                    let b = state.planes[b].deck_position.unwrap_or([0.0; 3]);
                    a[2].total_cmp(&b[2])
                        .then_with(|| a[0].abs().total_cmp(&b[0].abs()))
                });
            }
            if request.action == DeckAction::Rearm
                && !indices.iter().all(|&i| {
                    state.planes[i].phase == "ready" && state.planes[i].deck_slot.is_some()
                })
            {
                continue;
            }
            let mut needed = matches!(request.action, DeckAction::Stow | DeckAction::Repair)
                && indices
                    .iter()
                    .any(|&i| crate::aircraft::airborne(&state.planes[i]));
            for index in indices {
                let p = &mut state.planes[index];
                let action = request.action;
                let needs_move = match action {
                    DeckAction::Raise => p.phase == "hangar",
                    DeckAction::Repair if p.phase == "hangar" => {
                        if needs_hangar_service(p, self.repair_ceiling) {
                            p.phase = "repairing".into();
                            p.timer = aircraft_service_seconds(self.timings.repair_seconds, p.hp);
                        }
                        false
                    }
                    DeckAction::Stow | DeckAction::Repair => {
                        matches!(p.phase.as_str(), "ready" | "rearming") && p.deck_slot.is_some()
                    }
                    DeckAction::Launch => {
                        matches!(p.phase.as_str(), "ready" | "queued") && p.deck_slot.is_some()
                    }
                    DeckAction::Rearm => {
                        if p.phase == "ready" && p.deck_slot.is_some() {
                            p.phase = "rearming".into();
                            p.timer = aircraft_service_seconds(self.timings.rearm_seconds, p.hp);
                        }
                        false
                    }
                };
                if !needs_move {
                    continue;
                }
                needed = true;
                if rolling && action != DeckAction::Raise {
                    continue;
                }
                if ground[&p.model_id].folding_wings && p.wing_fold < 1.0 {
                    continue;
                }
                let model = ground[&p.model_id].deck_geometry.as_ref().unwrap();
                let Some((elevator, lift)) = layout.elevators.iter().enumerate().find(|(_, e)| {
                    model.parked.max[0] - model.parked.min[0] <= e.width_m
                        && model.parked.max[2] - model.parked.min[2] <= e.length_m
                }) else {
                    continue;
                };
                let (destination, from, to, key) = match action {
                    DeckAction::Raise => {
                        if state
                            .planes
                            .iter()
                            .filter(|p| p.deck_slot.is_some())
                            .count()
                            >= self.capacity
                        {
                            continue;
                        }
                        let p = &state.planes[index];
                        let mut spots: Vec<_> = layout
                            .spots
                            .iter()
                            .enumerate()
                            .filter(|(i, _)| {
                                !state
                                    .planes
                                    .iter()
                                    .any(|p| p.deck_slot == Some(*i) && p.phase != "takeoff")
                                    && !self.failed.contains(&(p.id.clone(), action, *i))
                            })
                            .collect();
                        // Aircraft entering at the forward lift must fill aft
                        // positions first; a full-span plane parked forward can
                        // otherwise seal the only route to its group mates.
                        spots.sort_by(|(i, a), (j, b)| {
                            (a.preferred_role != p.role)
                                .cmp(&(b.preferred_role != p.role))
                                .then_with(|| b.position[2].total_cmp(&a.position[2]))
                                .then_with(|| i.cmp(j))
                        });
                        let Some((slot, spot)) = spots.into_iter().next() else {
                            continue;
                        };
                        // A rolling aircraft may still own the best aft spot.
                        // Wait for its reservation instead of filling a forward
                        // hole that would block the group's later arrivals.
                        if state.planes.iter().any(|p| p.deck_slot == Some(slot)) {
                            continue;
                        }
                        (
                            Destination::Spot(slot),
                            DeckPose {
                                position: lift.position,
                                heading: 0.0,
                            },
                            DeckPose {
                                position: spot.position,
                                heading: 0.0,
                            },
                            slot,
                        )
                    }
                    DeckAction::Stow | DeckAction::Repair => (
                        Destination::Hangar {
                            repair: action == DeckAction::Repair,
                        },
                        pose(p, &ground[&p.model_id]),
                        DeckPose {
                            position: lift.position,
                            heading: 0.0,
                        },
                        elevator,
                    ),
                    DeckAction::Launch => (
                        Destination::Launch,
                        pose(p, &ground[&p.model_id]),
                        DeckPose {
                            position: layout.launch_start,
                            heading: 0.0,
                        },
                        0,
                    ),
                    DeckAction::Rearm => unreachable!(),
                };
                let p = &state.planes[index];
                if self.failed.contains(&(p.id.clone(), action, key)) {
                    continue;
                }
                let occupied = Self::occupied(state, actor, ground, &p.id);
                let traffic = DeckTraffic {
                    ship: actor.definition(),
                    occupied: &occupied,
                };
                // Retry admission as the runway clears; do not cache a failed
                // route while the aircraft is still approaching the lift.
                if action == DeckAction::Raise && !traffic.clear(model, from) {
                    continue;
                }
                self.active = Some(Job {
                    plane_id: p.id.clone(),
                    request_id: request.id,
                    destination,
                    elevator,
                    from,
                    to,
                    search: Some(traffic.begin_route(model, from, to, self.revision)),
                    path: VecDeque::new(),
                    stage: Stage::Planning,
                    cancelled: false,
                    arrival: false,
                    runway_checked: false,
                });
                self.queue.retain(|r| !completed.contains(&r.id));
                return;
            }
            if !needed {
                completed.push(request.id);
            }
        }
        self.queue.retain(|r| !completed.contains(&r.id));
    }
    pub(crate) fn close(&mut self, state: &mut AirWingState, reason: &str) {
        self.closed = true;
        self.queue.clear();
        self.active = None;
        self.next_request_id = None;
        self.failed.clear();
        self.occupancy.clear();
        self.notice = Some(reason.into());
        self.publish(state, true);
    }
    pub fn step(
        &mut self,
        state: &mut AirWingState,
        actor: &Vessel,
        ground: &BTreeMap<String, GroundPose>,
        available: bool,
        flight_ready: bool,
        dt: f64,
    ) {
        if self.closed {
            self.publish(state, true);
            return;
        }
        if dt <= 0.0 || !dt.is_finite() {
            return;
        }
        let layout = actor
            .definition()
            .air_wing
            .as_ref()
            .unwrap()
            .deck_layout
            .as_ref()
            .unwrap();
        for p in &mut state.planes {
            if crate::aircraft::terminal(p) || p.hp <= 0.0 {
                continue;
            }
            if p.deck_position.is_some() && p.phase != "takeoff" {
                place(
                    p,
                    actor,
                    pose(p, &ground[&p.model_id]),
                    &ground[&p.model_id],
                );
            }
            if available
                && ground[&p.model_id].folding_wings
                && matches!(p.phase.as_str(), "ready" | "queued" | "rearming")
            {
                p.wing_fold = (p.wing_fold + dt / 4.0).min(1.0);
            }
            if available && matches!(p.phase.as_str(), "rearming" | "repairing") {
                p.timer = (p.timer - dt).max(0.0);
                if p.timer <= 0.0 {
                    if p.phase == "repairing" {
                        p.hp = p.hp.max(self.repair_ceiling);
                    }
                    p.phase = if p.deck_slot.is_some() {
                        "ready"
                    } else {
                        "hangar"
                    }
                    .into();
                    restock(p);
                }
            }
        }
        self.revise(state);
        if !available {
            self.publish(state, true);
            return;
        }
        if self.active.is_none() {
            self.prepare_recovery(state, actor, ground);
        }
        if self.active.is_none() {
            self.select_job(state, actor, ground);
            if self.active.is_none()
                && !self.failed.is_empty()
                && self.queue.iter().any(|r| r.action == DeckAction::Launch)
            {
                self.stow_ready_group(state, "Clearing a handling path for queued launches");
            }
        }
        let Some(mut job) = self.active.take() else {
            self.publish(state, false);
            return;
        };
        let Some(index) = state
            .planes
            .iter()
            .position(|p| p.id == job.plane_id && !crate::aircraft::terminal(p) && p.hp > 0.0)
        else {
            self.publish(state, false);
            return;
        };
        let g = &ground[&state.planes[index].model_id];
        let model = g.deck_geometry.as_ref().unwrap();
        let mut finished = false;
        match job.stage {
            Stage::Planning => {
                let occupied = Self::occupied(state, actor, ground, &job.plane_id);
                let traffic = DeckTraffic {
                    ship: actor.definition(),
                    occupied: &occupied,
                };
                let progress = job
                    .search
                    .as_mut()
                    .unwrap()
                    .advance(&traffic, self.revision, 16)
                    .clone();
                match progress {
                    RouteProgress::Pending => {}
                    RouteProgress::Invalidated => {
                        job.search =
                            Some(traffic.begin_route(model, job.from, job.to, self.revision));
                    }
                    RouteProgress::Blocked => {
                        let action = match job.destination {
                            Destination::Spot(_) => DeckAction::Raise,
                            Destination::Hangar { repair: true } => DeckAction::Repair,
                            Destination::Hangar { repair: false } => DeckAction::Stow,
                            Destination::Launch => DeckAction::Launch,
                        };
                        let key = match job.destination {
                            Destination::Spot(i) => i,
                            Destination::Hangar { .. } => job.elevator,
                            Destination::Launch => 0,
                        };
                        self.failed.insert((job.plane_id.clone(), action, key));
                        self.notice = Some("Waiting for a clear handling path".into());
                        finished = true;
                    }
                    RouteProgress::Found(path) => {
                        job.path = path.into();
                        job.search = None;
                        self.notice = None;
                        let p = &mut state.planes[index];
                        if job.arrival {
                            let Destination::Spot(slot) = job.destination else {
                                unreachable!()
                            };
                            p.deck_slot = Some(slot);
                            job.stage = Stage::AwaitLanding;
                        } else if let Destination::Spot(slot) = job.destination {
                            p.deck_slot = Some(slot);
                            p.phase = "raising".into();
                            let lift = &layout.elevators[job.elevator];
                            place(
                                p,
                                actor,
                                DeckPose {
                                    position: [lift.position[0], lift.hangar_y, lift.position[2]],
                                    heading: 0.0,
                                },
                                g,
                            );
                            job.stage = Stage::LiftUp(0.0);
                        } else {
                            p.phase = if matches!(job.destination, Destination::Hangar { .. }) {
                                "lowering"
                            } else {
                                "taxi"
                            }
                            .into();
                            job.stage = Stage::Taxi;
                        }
                    }
                }
            }
            Stage::LiftUp(elapsed) | Stage::LiftDown(elapsed) => {
                let lift = &layout.elevators[job.elevator];
                let up = matches!(job.stage, Stage::LiftUp(_));
                let elapsed = (elapsed + dt).min(self.timings.lift_seconds);
                let t = elapsed / self.timings.lift_seconds;
                let y = lift.hangar_y
                    + (lift.position[1] - lift.hangar_y) * if up { t } else { 1.0 - t };
                let p = &mut state.planes[index];
                place(
                    p,
                    actor,
                    DeckPose {
                        position: [lift.position[0], y, lift.position[2]],
                        heading: 0.0,
                    },
                    g,
                );
                if elapsed >= self.timings.lift_seconds {
                    if up {
                        p.phase = "raising".into();
                        job.stage = Stage::Taxi;
                    } else {
                        p.deck_slot = None;
                        p.deck_position = None;
                        p.deck_heading = None;
                        let repair =
                            matches!(job.destination, Destination::Hangar { repair: true });
                        p.phase = if repair { "repairing" } else { "hangar" }.into();
                        p.timer = if repair {
                            aircraft_service_seconds(self.timings.repair_seconds, p.hp)
                        } else {
                            0.0
                        };
                        finished = true;
                    }
                } else {
                    job.stage = if up {
                        Stage::LiftUp(elapsed)
                    } else {
                        Stage::LiftDown(elapsed)
                    };
                }
            }
            Stage::Taxi => {
                let p = &mut state.planes[index];
                if let Some(target) = job.path.front() {
                    let current = pose(p, g);
                    let delta = sub(target.position, current.position);
                    let distance = length(delta);
                    let angle = wrap_angle(target.heading - current.heading);
                    let duration = (distance / self.timings.taxi_speed)
                        .max(angle.abs() / self.timings.turn_radians_per_second);
                    let t = if duration > 0.0 {
                        (dt / duration).min(1.0)
                    } else {
                        1.0
                    };
                    place(
                        p,
                        actor,
                        DeckPose {
                            position: add(current.position, scale(delta, t)),
                            heading: current.heading + angle * t,
                        },
                        g,
                    );
                    if t >= 1.0 {
                        job.path.pop_front();
                    }
                }
                if job.path.is_empty() {
                    match job.destination {
                        Destination::Spot(_) => {
                            p.phase = "ready".into();
                            if job.arrival {
                                self.batch.recovered();
                            }
                            finished = true;
                        }
                        Destination::Hangar { .. } => {
                            p.phase = "lowering".into();
                            job.stage = Stage::LiftDown(0.0);
                        }
                        Destination::Launch => {
                            p.phase = "launch-ready".into();
                            job.stage = Stage::Unfold;
                        }
                    }
                }
            }
            Stage::AwaitLanding | Stage::Rollout { .. } | Stage::Fold => {
                finished = self.step_recovery(
                    &mut job,
                    &mut state.planes[index],
                    actor,
                    g,
                    flight_ready,
                    dt,
                );
            }
            Stage::Unfold if job.cancelled => {
                let p = &mut state.planes[index];
                p.wing_fold = if g.folding_wings {
                    (p.wing_fold + dt / 4.0).min(1.0)
                } else {
                    0.0
                };
                if !g.folding_wings || p.wing_fold >= 1.0 {
                    p.phase = "ready".into();
                    finished = true;
                }
            }
            Stage::Unfold => {
                let occupied = Self::occupied(state, actor, ground, &job.plane_id);
                // Folding and the entire takeoff strip must clear other planes
                // before the wings open; no launch uses folded clearance.
                let at = pose(&state.planes[index], g);
                let end = DeckPose {
                    position: layout.launch_end,
                    heading: 0.0,
                };
                if !job.runway_checked && flight_ready {
                    let mut spread = model.clone();
                    spread.parked = model.sweep;
                    spread.layers = vec![model.sweep];
                    job.runway_checked = DeckTraffic {
                        ship: actor.definition(),
                        occupied: &occupied,
                    }
                    .segment_clear(&spread, at, end);
                }
                if !flight_ready || !job.runway_checked {
                    self.notice = Some("Waiting for a steady, clear launch lane".into());
                } else {
                    let p = &mut state.planes[index];
                    p.wing_fold = (p.wing_fold - dt / 4.0).max(0.0);
                    if p.wing_fold <= 0.0 {
                        p.phase = "takeoff".into();
                        p.sortie = Some(p.sortie.unwrap_or(0) + 1);
                        self.batch.launched();
                        p.timer = 0.0;
                        p.flight_time = 0.0;
                        finished = true;
                    }
                }
            }
        }
        if !finished {
            self.active = Some(job);
        } else if job.cancelled {
            self.notice = None;
        }
        self.publish(state, false);
    }
    pub(crate) fn publish(&self, state: &mut AirWingState, suspended: bool) {
        state.deck = Some(DeckStatus {
            queue: self.queue.iter().cloned().collect(),
            policy: self.batch.policy,
            next_request_id: self
                .next_request_id
                .filter(|id| self.queue.iter().any(|r| r.id == *id)),
            current_plane_id: self.active.as_ref().map(|j| j.plane_id.clone()),
            task: self.active.as_ref().map(|j| {
                match j.stage {
                    Stage::Planning => "Planning route",
                    Stage::LiftUp(_) => "Raising aircraft",
                    Stage::LiftDown(_) => "Lowering aircraft",
                    Stage::Taxi => "Moving aircraft",
                    Stage::Unfold => "Preparing launch",
                    Stage::AwaitLanding => "Reserved for landing",
                    Stage::Rollout { .. } => "Aircraft landing",
                    Stage::Fold => "Clearing landing lane",
                }
                .into()
            }),
            step_remaining_seconds: self.active.as_ref().and_then(|j| match j.stage {
                Stage::LiftUp(elapsed) | Stage::LiftDown(elapsed) => {
                    Some((self.timings.lift_seconds - elapsed).max(0.0))
                }
                _ => None,
            }),
            suspended,
            notice: self.notice.clone(),
            capacity: self.capacity,
            group_size: self.group_size,
            active_flight_limit: self.active_flight_limit,
            endurance: self.endurance.clone(),
            repair_ceiling_hp: self.repair_ceiling,
            occupied: state
                .planes
                .iter()
                .filter(|p| p.deck_slot.is_some())
                .count(),
        });
    }
}
