//! Bounded inspectable combat evidence, independent of short-lived visual events.
use crate::{
    impact::{DamageEvent, ImpactRecord},
    vessel::Vessel,
    weapons::Ammunition,
};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
#[derive(Clone, Debug)]
pub struct WeaponSource {
    pub owner_id: String,
    pub label: String,
    pub ammunition: Ammunition,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellHistory {
    pub shell_id: i64,
    pub owner_id: String,
    pub tick: u64,
    pub ammunition: Ammunition,
    pub impacts: Vec<ImpactRecord>,
    pub outcome: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DamageLogEntry {
    pub id: u64,
    pub tick: u64,
    pub source_id: String,
    pub target_id: String,
    pub weapon: String,
    pub damage: f64,
    pub hits: usize,
    #[serde(skip)]
    first_tick: u64,
    #[serde(skip)]
    projectiles: BTreeSet<i64>,
}
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VesselScore {
    pub damage_dealt: f64,
    pub frags: u32,
    pub damage_log: Vec<DamageLogEntry>,
    #[serde(skip)]
    sequence: u64,
}
#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Records {
    pub scores: BTreeMap<String, VesselScore>,
    pub shell_history: Vec<ShellHistory>,
    #[serde(skip)]
    pub sources: BTreeMap<i64, WeaponSource>,
    #[serde(skip)]
    last_damager: BTreeMap<String, String>,
    #[serde(skip)]
    credited: BTreeSet<String>,
    #[serde(skip)]
    eligible: BTreeSet<String>,
}
impl Records {
    pub fn begin_tick(&mut self, actors: &[Vessel]) {
        self.eligible = actors
            .iter()
            .filter(|a| a.physical_loss().is_none())
            .map(|a| a.motion.id.clone())
            .collect();
        for a in actors {
            self.scores.entry(a.motion.id.clone()).or_default();
        }
    }
    pub fn event(&mut self, e: &DamageEvent, tick: u64, actors: &[Vessel]) {
        let id = e
            .shell
            .as_ref()
            .map(|s| s.id)
            .or_else(|| e.torpedo.as_ref().map(|t| t.id))
            .or_else(|| e.depth_charge.as_ref().map(|c| c.id));
        let source = id.and_then(|id| self.sources.get(&id)).cloned();
        if let Some(shell) = &e.shell {
            let source = source.clone().unwrap_or(WeaponSource {
                owner_id: "unknown".into(),
                label: format!(
                    "{} mm {}",
                    (shell.caliber_m * 1000.0).round() as i64,
                    if shell.ammunition == Some(Ammunition::He) {
                        "HE"
                    } else {
                        "AP"
                    }
                ),
                ammunition: shell.ammunition.unwrap_or_default(),
            });
            let index = self
                .shell_history
                .iter()
                .position(|h| h.shell_id == shell.id)
                .unwrap_or_else(|| {
                    self.shell_history.push(ShellHistory {
                        shell_id: shell.id,
                        owner_id: source.owner_id.clone(),
                        tick,
                        ammunition: source.ammunition,
                        impacts: vec![],
                        outcome: "flying".into(),
                    });
                    self.shell_history.len() - 1
                });
            let h = &mut self.shell_history[index];
            if matches!(e.kind.as_str(), "shot" | "bomb-release") {
                h.ammunition = shell.ammunition.unwrap_or_default()
            }
            if let Some(impact) = &e.impact {
                h.impacts.push(impact.clone());
                if impact.terminal == Some(true) {
                    h.outcome = if matches!(e.kind.as_str(), "stopped" | "ricochet" | "burst") {
                        e.kind.clone()
                    } else {
                        "internal".into()
                    };
                }
            }
        }
        if let (Some(id), Some(source)) = (id, source) {
            let damage = e
                .impact
                .as_ref()
                .and_then(|i| i.hull_damage)
                .or(e.hull_damage)
                .unwrap_or(0.0);
            let breach = e
                .impact
                .as_ref()
                .and_then(|i| i.breach_area_m2)
                .unwrap_or(0.0)
                > 0.0;
            if e.impact
                .as_ref()
                .is_none_or(|i| i.through_wreckage != Some(true))
            {
                self.hit(
                    &source.owner_id,
                    &e.ship_id,
                    id,
                    &source.label,
                    damage,
                    breach,
                    tick,
                    actors,
                )
            }
        }
    }
    #[allow(clippy::too_many_arguments)]
    pub fn hit(
        &mut self,
        owner: &str,
        victim: &str,
        projectile: i64,
        weapon: &str,
        damage: f64,
        breach: bool,
        tick: u64,
        actors: &[Vessel],
    ) {
        if !self.eligible.contains(victim) {
            return;
        }
        let Some(a) = actors.iter().find(|a| a.motion.id == owner) else {
            return;
        };
        let Some(b) = actors.iter().find(|a| a.motion.id == victim) else {
            return;
        };
        if a.team == b.team {
            return;
        }
        if damage > 0.0 || breach {
            self.last_damager.insert(victim.into(), owner.into());
        }
        if damage <= 0.0 || !damage.is_finite() {
            return;
        }
        self.scores.entry(owner.into()).or_default().damage_dealt += damage;
        for subject in [owner, victim] {
            let score = self.scores.entry(subject.into()).or_default();
            let index = score.damage_log.iter().position(|e| {
                tick >= e.first_tick
                    && tick - e.first_tick <= 60
                    && e.source_id == owner
                    && e.target_id == victim
                    && e.weapon == weapon
            });
            let mut e = index
                .map(|i| score.damage_log.remove(i))
                .unwrap_or_else(|| {
                    score.sequence += 1;
                    DamageLogEntry {
                        id: score.sequence,
                        tick,
                        source_id: owner.into(),
                        target_id: victim.into(),
                        weapon: weapon.into(),
                        damage: 0.0,
                        hits: 0,
                        first_tick: tick,
                        projectiles: BTreeSet::new(),
                    }
                });
            e.projectiles.insert(projectile);
            e.tick = tick;
            e.damage += damage;
            e.hits = e.projectiles.len();
            score.damage_log.insert(0, e);
            score.damage_log.truncate(40);
        }
    }
    pub fn complete_shell(&mut self, id: i64, end: &str) {
        if let Some(h) = self.shell_history.iter_mut().find(|h| h.shell_id == id)
            && h.outcome == "flying"
        {
            h.outcome = if matches!(end, "splash" | "passed-through")
                && h.impacts.last().is_some_and(|i| i.outcome == "ricochet")
            {
                "ricochet"
            } else {
                end
            }
            .into()
        }
    }
    pub fn finish_tick(&mut self, actors: &[Vessel], active: &BTreeSet<i64>) {
        for a in actors {
            if a.physical_loss().is_some()
                && self.credited.insert(a.motion.id.clone())
                && let Some(owner) = self.last_damager.get(&a.motion.id)
            {
                self.scores.entry(owner.clone()).or_default().frags += 1;
            }
        }
        let mut counts = BTreeMap::new();
        let mut keep = BTreeSet::new();
        for h in self.shell_history.iter().rev() {
            if h.outcome == "flying" {
                keep.insert(h.shell_id);
                continue;
            }
            let count = counts.entry(h.owner_id.clone()).or_insert(0);
            *count += 1;
            if *count <= 16 {
                keep.insert(h.shell_id);
            }
        }
        self.shell_history.retain(|h| keep.contains(&h.shell_id));
        self.sources
            .retain(|id, _| active.contains(id) || keep.contains(id));
    }
}
