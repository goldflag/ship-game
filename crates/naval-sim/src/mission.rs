//! Frozen, content-validated mission policy. Legacy callers omit MissionRules.
use crate::{
    aviation::AirWingState,
    catalog::Catalog,
    geometry::{clamp, wrap_angle},
    machinery::launcher_available,
    motion::HelmCommand,
    rules::{FinishReason, Outcome, TICK_RATE, TeamId},
    vessel::Vessel,
    weapons::Ammunition,
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FleetBudget {
    #[ts(type = "number")]
    pub max_displacement_kg: u64,
    pub max_ships: usize,
    pub max_aircraft: usize,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BattleArea {
    pub radius_m: f64,
    pub warning_margin_m: f64,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum ObservationPolicy {
    VisualV1,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum EliminationPolicy {
    PermanentIncapacity,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum TimeoutPolicy {
    Draw,
    /// The mission's objective scores both sides; the higher total wins.
    VictoryPoints,
}
/// A scenario's victory points: what each side earns from the other's losses.
/// Every decided mission that carries one is judged on points, however it ends.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MissionObjective {
    /// The ships a side is there to protect (transports, a convoy): the other
    /// side scores `protected_points` for each one sunk, whatever its size.
    pub protected_ship_ids: Vec<String>,
    pub protected_points: u32,
    /// Any other ship sunk scores this per 1000 tonnes to the side that did not lose it.
    pub points_per_kilotonne: f64,
    /// A side that must be gone by the deadline (a raid caught at dawn): each of
    /// its ships still afloat and not withdrawn when time runs out scores for
    /// the other side at this rate per 1000 tonnes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub exposed_at_deadline: Option<DeadlineExposure>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeadlineExposure {
    pub team: TeamId,
    pub points_per_kilotonne: f64,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum ScoreKind {
    /// A protected ship was sunk.
    Protected,
    /// Any other ship was sunk.
    Sunk,
    /// A ship was still inside the area when the deadline passed.
    Exposed,
}
/// One line of a victory-point tally: `team` earned `points` from `ship_id`.
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ScoreLine {
    pub team: TeamId,
    pub kind: ScoreKind,
    pub ship_id: String,
    pub preset_id: String,
    pub points: u32,
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Score {
    pub points: [u32; 2],
    pub lines: Vec<ScoreLine>,
}
/// Tally the objective over the fleet as it stands. `deadline` adds the
/// exposure of a side still in the area when time ran out.
pub fn score(
    actors: &[Vessel],
    withdrawn: &std::collections::BTreeSet<String>,
    objective: &MissionObjective,
    deadline: bool,
) -> Score {
    let mut tally = Score::default();
    for a in actors {
        let kilotonnes = a.definition().hull.mass_kg / 1_000_000.0;
        let line = if a.physical_loss().is_some() {
            if objective.protected_ship_ids.contains(&a.motion.id) {
                Some((ScoreKind::Protected, objective.protected_points))
            } else {
                Some((
                    ScoreKind::Sunk,
                    (kilotonnes * objective.points_per_kilotonne).round() as u32,
                ))
            }
        } else if deadline
            && !withdrawn.contains(&a.motion.id)
            && let Some(exposure) = &objective.exposed_at_deadline
            && exposure.team == a.team
        {
            Some((
                ScoreKind::Exposed,
                (kilotonnes * exposure.points_per_kilotonne).round() as u32,
            ))
        } else {
            None
        };
        if let Some((kind, points)) = line {
            let team = a.team.other();
            tally.points[team.index()] += points;
            tally.lines.push(ScoreLine {
                team,
                kind,
                ship_id: a.motion.id.clone(),
                preset_id: a.preset_id.clone(),
                points,
            });
        }
    }
    tally
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MissionRules {
    pub version: u32,
    pub id: String,
    pub air_profile_id: String,
    pub budget: FleetBudget,
    pub area: BattleArea,
    pub observation: ObservationPolicy,
    pub elimination: EliminationPolicy,
    #[ts(type = "number | null")]
    pub duration_seconds: Option<u64>,
    pub timeout: TimeoutPolicy,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub objective: Option<MissionObjective>,
    /// Team a's and team b's lookout reach short of full daylight, as a
    /// multiple of the common visual rule. Omitted is even.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub night_lookout: Option<[f64; 2]>,
}
/// Versioned PvE simulation cadence, in the style of `visual-sensors.v2.json`:
/// content, not a client flag. A battle applies it only while it carries
/// mission rules, so custom battles and the multiplayer server (which never set
/// `mission_rules`) keep the per-tick path bit for bit. Every entry counts
/// `Battle::tick`, never wall time, so 1x and 4x remain identical.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SimulationCadence {
    pub version: u32,
    /// The captain-loop `capability::update`; the post-damage call stays per tick.
    pub capability_ticks: u64,
    /// Fire spread, heat and damage-control jobs, integrated with a matching dt.
    pub damage_control_ticks: u64,
    /// Interval of the hydrostatic solve inside `update_stability`.
    pub stability_interval_seconds: f64,
}
impl Default for SimulationCadence {
    fn default() -> Self {
        serde_json::from_str(include_str!("../../../assets/gameplay/pve-cadence.v1.json"))
            .expect("versioned PvE cadence")
    }
}
impl SimulationCadence {
    /// Per-tick cadence: the shape the non-mission path already runs.
    pub const PER_TICK: Self = Self {
        version: 1,
        capability_ticks: 1,
        damage_control_ticks: 1,
        stability_interval_seconds: 0.5,
    };
    pub fn validate(&self) -> Result<(), String> {
        let ticks = 1..=60;
        if self.version != 1
            || !ticks.contains(&self.capability_ticks)
            || !ticks.contains(&self.damage_control_ticks)
            || !self.stability_interval_seconds.is_finite()
            || !(crate::rules::DT..=1.0).contains(&self.stability_interval_seconds)
        {
            return Err("Invalid PvE simulation cadence".into());
        }
        Ok(())
    }
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct FleetTotals {
    #[ts(type = "number")]
    pub displacement_kg: u64,
    pub ships: usize,
    pub aircraft: usize,
}
impl MissionRules {
    pub fn validate_profile(&self) -> Result<(), String> {
        if self.version != 1
            || self.id.is_empty()
            || self.id.len() > 64
            || self.air_profile_id.is_empty()
            || self.air_profile_id.len() > 64
            || !(1..=30).contains(&self.budget.max_ships)
            || self.budget.max_displacement_kg == 0
            || self.budget.max_displacement_kg > 1_000_000_000
            || self.budget.max_aircraft > 200
            || !self.area.radius_m.is_finite()
            || !(10000.0..=30000.0).contains(&self.area.radius_m)
            || !self.area.warning_margin_m.is_finite()
            || !(500.0..=3000.0).contains(&self.area.warning_margin_m)
            || self
                .duration_seconds
                .is_some_and(|s| !(1..=21600).contains(&s))
            || (self.timeout == TimeoutPolicy::VictoryPoints) != self.objective.is_some()
            || self
                .night_lookout
                .is_some_and(|l| l.iter().any(|n| !(0.5..=2.0).contains(n)))
            || self.objective.as_ref().is_some_and(|o| {
                o.protected_ship_ids.len() > 30
                    || o.protected_points > 1000
                    || !(0.0..=100.0).contains(&o.points_per_kilotonne)
                    || o.exposed_at_deadline
                        .as_ref()
                        .is_some_and(|e| !(0.0..=100.0).contains(&e.points_per_kilotonne))
            })
        {
            return Err("Invalid mission profile".into());
        }
        Ok(())
    }
    /// The host can choose an explicit deadline; the rest must match trusted content.
    pub fn validate_selection(&self, catalog: &Catalog) -> Result<(), String> {
        self.validate_profile()?;
        let trusted = catalog
            .missions
            .get(&self.id)
            .ok_or("Unknown mission profile")?;
        let mut expected = trusted.clone();
        expected.duration_seconds = self.duration_seconds;
        if self != &expected {
            return Err("Mission rules do not match installed content".into());
        }
        Ok(())
    }
    pub fn remaining_seconds(&self, tick: u64) -> Option<f64> {
        self.duration_seconds
            .map(|s| (s as f64 - tick as f64 / TICK_RATE as f64).max(0.0))
    }
}
impl FleetBudget {
    /// Inventory comes from compiled definitions, including future light carriers.
    pub fn resolve(&self, ids: &[String], catalog: &Catalog) -> Result<FleetTotals, String> {
        if ids.is_empty() {
            return Err("Choose at least one ship".into());
        }
        let mut total = FleetTotals::default();
        for id in ids {
            let entry = catalog.fleet_entries.get(id).ok_or("Unknown ship preset")?;
            let def = catalog
                .definitions
                .get(id)
                .ok_or("Unknown ship definition")?;
            total.displacement_kg = total
                .displacement_kg
                .checked_add(entry.displacement_kg)
                .ok_or("Invalid fleet tonnage")?;
            total.ships += 1;
            if let Some(wing) = &def.air_wing {
                for pool in &wing.squadrons {
                    if !pool.count.is_finite()
                        || pool.count < 0.0
                        || pool.count.fract() != 0.0
                        || pool.count > 1000.0
                    {
                        return Err("Invalid aircraft inventory".into());
                    }
                    total.aircraft += pool.count as usize;
                }
            }
        }
        if total.ships > self.max_ships {
            return Err(format!("Fleet exceeds {} ships", self.max_ships));
        }
        if total.displacement_kg > self.max_displacement_kg {
            return Err(format!(
                "Fleet exceeds {} tonnes",
                self.max_displacement_kg / 1000
            ));
        }
        if total.aircraft > self.max_aircraft {
            return Err(format!("Fleet exceeds {} aircraft", self.max_aircraft));
        }
        Ok(total)
    }
}
impl BattleArea {
    pub fn contains(&self, point: [f64; 2], hull_margin: f64) -> bool {
        point.iter().all(|n| n.is_finite())
            && point[0].hypot(point[1]) + hull_margin <= self.radius_m
    }
    /// Turn back through ordinary physics. Standing orders and surviving hulls
    /// remain intact, including an immobile ship drifting beyond the perimeter.
    pub fn constrain(&self, actor: &Vessel, command: HelmCommand) -> HelmCommand {
        if actor.physical_loss().is_some() {
            return command;
        }
        let p = &actor.motion;
        let radial = p.x.hypot(p.z);
        let look =
            p.speed.abs() * crate::mobility::SHIP_PACE * 75.0 + actor.definition().hull.length;
        let next = [p.x + p.heading.sin() * look, p.z - p.heading.cos() * look];
        if radial < self.radius_m - self.warning_margin_m && self.contains(next, 0.0) {
            return command;
        }
        let inward = (-p.x).atan2(p.z);
        let error = wrap_angle(inward - p.heading);
        // Once facing safely inward, retain enough ahead power to clear the edge.
        HelmCommand {
            throttle: command.throttle.clamp(0.45, 0.7),
            rudder: clamp(error * 2.0 - p.yaw_rate * 5.0, -1.0, 1.0),
            ..command
        }
    }
}

/// Does this physically surviving vessel retain a possible anti-ship attack?
/// Zero-HP equipment cannot be repaired by damage control. Reload, flooding of
/// intact equipment, deck queues, and propulsion loss are temporary/noncombat.
pub fn permanently_incapable(a: &Vessel, wing: Option<&AirWingState>) -> bool {
    let def = a.definition();
    let module_intact = |id: &str| a.damage.modules.iter().any(|m| m.id == id && m.hp > 0.0);
    if def.mounts.iter().zip(&a.mounts).any(|(m, s)| {
        let salvo = m.weapon.barrel_count;
        crate::anti_aircraft::surface_allowed(def, m)
            && s.hp > 0.0
            && (s.available(Ammunition::Ap) >= salvo
                || m.weapon.he.is_some() && s.available(Ammunition::He) >= salvo)
            && m.magazine_id.as_deref().is_none_or(module_intact)
    }) {
        return false;
    }
    if def.torpedo_tubes.iter().flatten().any(|tube| {
        a.torpedo_tubes
            .iter()
            .any(|s| s.id == tube.id && s.ammo > 0.0)
            && module_intact(&tube.magazine_id)
            && launcher_available(a, def, tube.launcher_module_id.as_deref(), true, None)
    }) {
        return false;
    }
    if let Some(wing) = wing {
        let service = def
            .air_wing
            .as_ref()
            .is_some_and(|w| module_intact(&w.service_module_id));
        if wing.planes.iter().any(|p| {
            !crate::aviation::terminal(p)
                && p.hp > 0.0
                && p.role != "fighter"
                && (service
                    || p.payload
                        && matches!(
                            p.phase.as_str(),
                            "takeoff" | "outbound" | "attack" | "returning" | "landing"
                        ))
        }) {
            return false;
        }
    }
    true
}
/// `withdrawn` ships left on their commander's order: they stop fighting
/// without being lost, and a side with nothing else left has withdrawn.
pub fn evaluate(
    tick: u64,
    actors: &[Vessel],
    aviation: &crate::aviation::Aviation,
    mission: &MissionRules,
    afloat_kg: [u64; 2],
    withdrawn: &std::collections::BTreeSet<String>,
) -> Option<Outcome> {
    let mut fighting = [false; 2];
    let mut left = [false; 2];
    for a in actors {
        if a.physical_loss().is_some() {
            continue;
        }
        if withdrawn.contains(&a.motion.id) {
            left[a.team.index()] = true;
        } else if !permanently_incapable(a, aviation.wing(&a.motion.id)) {
            fighting[a.team.index()] = true;
        }
    }
    let departed = |team: TeamId| !fighting[team.index()] && left[team.index()];
    let (reason, mut winner) = match fighting {
        [true, true] => {
            if !mission
                .duration_seconds
                .is_some_and(|s| tick >= s * TICK_RATE)
            {
                return None;
            }
            (FinishReason::TimeLimit, None)
        }
        [true, false] if departed(TeamId::B) => (FinishReason::Withdrawal, Some(TeamId::A)),
        [false, true] if departed(TeamId::A) => (FinishReason::Withdrawal, Some(TeamId::B)),
        [true, false] => (FinishReason::Destruction, Some(TeamId::A)),
        [false, true] => (FinishReason::Destruction, Some(TeamId::B)),
        [false, false] => (FinishReason::Destruction, None),
    };
    if mission.timeout == TimeoutPolicy::VictoryPoints
        && let Some(objective) = &mission.objective
    {
        let tally = score(
            actors,
            withdrawn,
            objective,
            reason == FinishReason::TimeLimit,
        );
        winner = match tally.points[0].cmp(&tally.points[1]) {
            std::cmp::Ordering::Greater => Some(TeamId::A),
            std::cmp::Ordering::Less => Some(TeamId::B),
            std::cmp::Ordering::Equal => None,
        };
    }
    Some(Outcome {
        winner_team_id: winner,
        reason,
        final_tick: tick,
        afloat_kg,
    })
}
