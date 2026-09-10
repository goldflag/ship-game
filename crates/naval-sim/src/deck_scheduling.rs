use super::*;

#[derive(
    Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize, ts_rs::TS,
)]
#[serde(rename_all = "kebab-case")]
pub enum DeckPolicy {
    #[default]
    Balanced,
    LaunchFirst,
    RecoverFirst,
}

#[derive(Clone, Debug, Default)]
pub(super) struct BatchSchedule {
    pub policy: DeckPolicy,
    launched: usize,
    recovered: usize,
}
impl BatchSchedule {
    fn launch_due(&self, group_size: usize) -> bool {
        let launches = group_size
            * if self.policy == DeckPolicy::LaunchFirst {
                2
            } else {
                1
            };
        let recoveries = group_size
            * if self.policy == DeckPolicy::RecoverFirst {
                2
            } else {
                1
            };
        self.recovered >= recoveries
            || self.launched > 0 && self.launched < launches
            || self.launched == 0 && self.recovered == 0 && self.policy == DeckPolicy::LaunchFirst
    }
    pub fn launched(&mut self) {
        self.launched += 1;
        self.recovered = 0;
    }
    pub fn recovered(&mut self) {
        self.recovered += 1;
        self.launched = 0;
    }
}
impl DeckOperations {
    pub fn set_policy(&mut self, policy: DeckPolicy) {
        // Preference changes retain completed work rather than resetting a batch.
        self.batch.policy = policy;
    }

    pub(super) fn launch_waiting(&self, state: &AirWingState) -> bool {
        self.queue
            .iter()
            .filter(|r| r.action == DeckAction::Launch)
            .any(|r| {
                state.planes.iter().any(|p| {
                    p.flight_id.as_deref() == Some(r.flight_id.as_str())
                        && p.hp > 0.0
                        && p.deck_slot.is_some()
                        && matches!(
                            p.phase.as_str(),
                            "ready" | "queued" | "taxi" | "launch-ready"
                        )
                })
            })
    }

    /// Bounded preference, never a runway lock. A missing/dead/cancelled launch
    /// task cannot hold returning aircraft outside the carrier forever.
    pub(super) fn launch_batch_due(&self, state: &AirWingState) -> bool {
        if !self.launch_waiting(state) {
            return false;
        }
        self.batch.launch_due(self.group_size)
    }

    /// Prefer this group next, after committed moves and required safety work.
    /// Requests remain skippable when physical conditions change; a preference
    /// cannot pin the runway or prevent automatic clearing of a smaller deck.
    pub fn prioritize(
        &mut self,
        state: &AirWingState,
        actor: &Vessel,
        id: u64,
    ) -> Result<(), String> {
        let index = self
            .queue
            .iter()
            .position(|r| r.id == id)
            .ok_or("Deck task is no longer queued")?;
        let request = &self.queue[index];
        if request.automatic {
            return Err("Automatic deck clearance already takes priority".into());
        }
        if self.active.as_ref().is_some_and(|job| job.request_id == id) {
            return Err("This group's current move is already in progress".into());
        }
        let group: Vec<_> = state
            .planes
            .iter()
            .filter(|p| {
                p.flight_id.as_deref() == Some(request.flight_id.as_str())
                    && !crate::aircraft::terminal(p)
            })
            .collect();
        if group.is_empty() {
            return Err("No surviving aircraft in this group".into());
        }
        match request.action {
            DeckAction::Raise => {
                if state
                    .planes
                    .iter()
                    .filter(|p| p.deck_slot.is_some())
                    .count()
                    >= self.capacity
                {
                    return Err("Cannot prioritize this lift: the deck is full".into());
                }
                if !Self::near_returners(state, actor).is_empty() || self.launch_waiting(state) {
                    return Err("Flight operations need a clear deck before this lift".into());
                }
            }
            DeckAction::Stow | DeckAction::Repair => {
                if !group.iter().any(|p| {
                    p.deck_slot.is_some() && matches!(p.phase.as_str(), "ready" | "rearming")
                        || request.action == DeckAction::Repair
                            && p.phase == "hangar"
                            && p.hp < self.repair_ceiling
                }) {
                    return Err("Waiting for this group's aircraft to land".into());
                }
            }
            DeckAction::Rearm => {
                if !group
                    .iter()
                    .all(|p| p.phase == "ready" && p.deck_slot.is_some())
                {
                    return Err("The whole surviving group must be ready on deck to rearm".into());
                }
            }
            DeckAction::Launch => {}
        }
        let request = self.queue.remove(index).unwrap();
        let automatic = self.queue.iter().take_while(|r| r.automatic).count();
        self.queue.insert(automatic, request);
        self.next_request_id = Some(id);
        self.notice =
            Some("Prioritized task follows the current move and required deck clearance".into());
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn continuous_backlogs_get_bounded_turns_despite_repeated_preference_changes() {
        for (policy, cycle) in [
            (DeckPolicy::Balanced, "RRRRLLLL"),
            (DeckPolicy::LaunchFirst, "LLLLLLLLRRRR"),
            (DeckPolicy::RecoverFirst, "RRRRRRRRLLLL"),
        ] {
            let mut batch = BatchSchedule::default();
            let mut observed = String::new();
            // Both operations are feasible here. Geometry integration separately
            // tests blocked paths, automatic clearance and complete mixed traffic.
            for _ in 0..cycle.len() * 10 {
                batch.policy = DeckPolicy::Balanced;
                batch.policy = policy;
                if batch.launch_due(4) {
                    observed.push('L');
                    batch.launched();
                } else {
                    observed.push('R');
                    batch.recovered();
                }
            }
            assert_eq!(observed, cycle.repeat(10), "{policy:?}");
        }
    }
}
