//! Frozen, content-validated mission policy. Legacy callers omit MissionRules.
use crate::{
    aircraft::AirWingState,
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
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MissionRules {
    pub version: u32,
    pub id: String,
    pub budget: FleetBudget,
    pub area: BattleArea,
    pub observation: ObservationPolicy,
    pub elimination: EliminationPolicy,
    #[ts(type = "number | null")]
    pub duration_seconds: Option<u64>,
    pub timeout: TimeoutPolicy,
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
        let look = p.speed.abs() * 75.0 + actor.definition().hull.length;
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
        let salvo = m.weapon.barrel_count.unwrap_or(2.0);
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
            p.phase != "lost"
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
pub fn evaluate(
    tick: u64,
    actors: &[Vessel],
    aviation: &crate::aviation::Aviation,
    mission: &MissionRules,
    afloat_kg: [u64; 2],
) -> Option<Outcome> {
    let mut fighting = [false; 2];
    for a in actors {
        if a.physical_loss().is_none() && !permanently_incapable(a, aviation.wing(&a.motion.id)) {
            fighting[a.team.index()] = true;
        }
    }
    let (reason, winner) = match fighting {
        [true, true] => {
            if !mission
                .duration_seconds
                .is_some_and(|s| tick >= s * TICK_RATE)
            {
                return None;
            }
            (FinishReason::TimeLimit, None)
        }
        [true, false] => (FinishReason::Destruction, Some(TeamId::A)),
        [false, true] => (FinishReason::Destruction, Some(TeamId::B)),
        [false, false] => (FinishReason::Destruction, None),
    };
    Some(Outcome {
        winner_team_id: winner,
        reason,
        final_tick: tick,
        afloat_kg,
    })
}
