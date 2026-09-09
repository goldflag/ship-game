use super::*;
use crate::geometry::world_to_local;
impl DeckOperations {
    pub(super) fn near_returners(state: &AirWingState, actor: &Vessel) -> Vec<usize> {
        let mut candidates: Vec<_> = state
            .planes
            .iter()
            .enumerate()
            .filter(|(_, p)| {
                matches!(p.phase.as_str(), "returning" | "landing")
                    && p.hp > 0.0
                    && length(sub(
                        p.position,
                        [actor.motion.x, actor.motion.y, actor.motion.z],
                    )) < 4500.0
            })
            .map(|(i, _)| i)
            .collect();
        candidates.sort_by(|&a, &b| {
            let a = &state.planes[a];
            let b = &state.planes[b];
            (b.hp < 25.0)
                .cmp(&(a.hp < 25.0))
                .then_with(|| {
                    a.recovery_requested_at
                        .unwrap_or(0.0)
                        .total_cmp(&b.recovery_requested_at.unwrap_or(0.0))
                })
                .then_with(|| a.id.cmp(&b.id))
        });
        candidates
    }
    pub fn landing_clearance(&self) -> Option<&str> {
        self.active
            .as_ref()
            .filter(|j| j.arrival && matches!(j.stage, Stage::AwaitLanding))
            .map(|j| j.plane_id.as_str())
    }
    pub(super) fn prepare_recovery(
        &mut self,
        state: &mut AirWingState,
        actor: &Vessel,
        ground: &BTreeMap<String, GroundPose>,
    ) {
        let candidates = Self::near_returners(state, actor);
        let Some(&index) = candidates.first() else {
            return;
        };
        if state
            .planes
            .iter()
            .any(|p| p.phase == "takeoff" && p.deck_position.is_some())
        {
            return;
        }
        if self.recovered_batch >= 4 && self.queue.iter().any(|r| r.action == DeckAction::Launch) {
            return;
        }
        let p = &state.planes[index];
        let g = &ground[&p.model_id];
        let model = g.deck_geometry.as_ref().unwrap();
        let layout = actor
            .definition()
            .air_wing
            .as_ref()
            .unwrap()
            .deck_layout
            .as_ref()
            .unwrap();
        let touchdown = DeckPose {
            position: layout.recovery_touchdown,
            heading: 0.0,
        };
        let stop = DeckPose {
            position: layout.recovery_stop,
            heading: 0.0,
        };
        let occupied = Self::occupied(state, ground, &p.id);
        let mut spread = model.clone();
        spread.parked = model.sweep;
        spread.layers = vec![model.sweep];
        let traffic = DeckTraffic {
            ship: actor.definition(),
            occupied: &occupied,
        };
        let lane_clear = traffic.segment_clear(&spread, touchdown, stop);
        let capacity = state
            .planes
            .iter()
            .filter(|p| p.deck_slot.is_some())
            .count()
            < self.capacity;
        let local = world_to_local(p.position, actor.motion.pose());
        // Prepare capacity while the aircraft joins its circuit. Reserve the
        // runway only on the nearby final leg; a distant return cannot lock it.
        let on_final = p.pilot.recovery_stage.as_deref() == Some("final")
            && local[2] - layout.recovery_touchdown[2] < 1800.0
            && local[2] - layout.recovery_touchdown[2] > 550.0
            && (local[0] - layout.recovery_touchdown[0]).abs() < 100.0
            && wrap_angle(p.heading - actor.motion.heading).abs() < 0.25;
        if capacity && lane_clear && on_final {
            let mut spots: Vec<_> = layout
                .spots
                .iter()
                .enumerate()
                .filter(|(i, _)| {
                    !state.planes.iter().any(|p| p.deck_slot == Some(*i))
                        && !self.failed.contains(&(p.id.clone(), DeckAction::Raise, *i))
                })
                .collect();
            spots.sort_by_key(|(i, s)| (s.preferred_role != p.role, *i));
            if let Some((slot, spot)) = spots.into_iter().find(|(_, s)| {
                traffic.clear(
                    model,
                    DeckPose {
                        position: s.position,
                        heading: 0.0,
                    },
                )
            }) {
                let to = DeckPose {
                    position: spot.position,
                    heading: 0.0,
                };
                self.active = Some(Job {
                    plane_id: p.id.clone(),
                    request_id: 0,
                    destination: Destination::Spot(slot),
                    elevator: 0,
                    from: stop,
                    to,
                    search: Some(traffic.begin_route(model, stop, to, self.revision)),
                    path: VecDeque::new(),
                    stage: Stage::Planning,
                    cancelled: false,
                    arrival: true,
                    runway_checked: true,
                });
                return;
            }
        }
        if capacity && lane_clear && self.failed.is_empty() {
            return;
        }
        self.stow_ready_group(state, "Clearing deck space for returning aircraft");
    }
    /// Automatic handling preserves an outstanding Raise request. It can resume
    /// after departures; cancelling the player's request would hide why the
    /// group never came back up after making room for the runway.
    pub(super) fn stow_ready_group(&mut self, state: &AirWingState, reason: &str) -> bool {
        let mut parked: Vec<_> = state
            .planes
            .iter()
            .filter(|p| {
                p.hp > 0.0
                    && matches!(p.phase.as_str(), "ready" | "rearming")
                    && p.deck_slot.is_some()
            })
            .collect();
        parked.sort_by(|a, b| a.deck_position.unwrap()[2].total_cmp(&b.deck_position.unwrap()[2]));
        let group = parked
            .into_iter()
            .filter_map(|p| p.flight_id.as_ref())
            .find(|id| {
                !self.queue.iter().any(|r| {
                    &r.flight_id == *id
                        && matches!(
                            r.action,
                            DeckAction::Stow | DeckAction::Repair | DeckAction::Launch
                        )
                })
            })
            .cloned();
        let Some(group) = group else {
            return false;
        };
        if self.queue.len() >= 64 {
            return false;
        }
        self.sequence += 1;
        self.queue.push_front(DeckRequest {
            id: self.sequence,
            flight_id: group,
            action: DeckAction::Stow,
            automatic: true,
        });
        self.notice = Some(reason.into());
        true
    }
    pub(super) fn step_recovery(
        &mut self,
        job: &mut Job,
        p: &mut Aircraft,
        actor: &Vessel,
        ground: &GroundPose,
        flight_ready: bool,
        dt: f64,
    ) -> bool {
        let layout = actor
            .definition()
            .air_wing
            .as_ref()
            .unwrap()
            .deck_layout
            .as_ref()
            .unwrap();
        match job.stage {
            Stage::AwaitLanding => {
                if p.phase == "rollout" {
                    job.stage = Stage::Rollout {
                        elapsed: 0.0,
                        from: pose(p, ground),
                    };
                } else if !flight_ready
                    || !matches!(p.phase.as_str(), "returning" | "landing")
                    || p.pilot.recovery_stage.as_deref() == Some("marshal")
                    || length(sub(
                        p.position,
                        [actor.motion.x, actor.motion.y, actor.motion.z],
                    )) > 2500.0
                {
                    p.deck_slot = None;
                    if p.phase == "landing" {
                        p.phase = "returning".into();
                        p.pilot.recovery_stage = Some("marshal".into());
                    }
                    return true;
                }
            }
            Stage::Rollout { elapsed, from } => {
                let elapsed = (elapsed + dt).min(1.5);
                let t = 1.0 - (1.0 - elapsed / 1.5).powi(2);
                place(
                    p,
                    actor,
                    DeckPose {
                        position: add(
                            from.position,
                            scale(sub(layout.recovery_stop, from.position), t),
                        ),
                        heading: 0.0,
                    },
                    ground,
                );
                if elapsed >= 1.5 {
                    job.stage = Stage::Fold;
                    p.phase = "parking".into();
                } else {
                    job.stage = Stage::Rollout { elapsed, from };
                }
            }
            Stage::Fold => {
                p.wing_fold = if ground.folding_wings {
                    (p.wing_fold + dt / 4.0).min(1.0)
                } else {
                    0.0
                };
                if !ground.folding_wings || p.wing_fold >= 1.0 {
                    p.phase = "parking".into();
                    p.recovery_requested_at = None;
                    job.stage = Stage::Taxi;
                }
            }
            _ => unreachable!(),
        }
        false
    }
}
