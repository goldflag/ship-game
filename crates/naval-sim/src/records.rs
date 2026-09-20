//! Bounded inspectable combat evidence, independent of short-lived visual events.
use crate::{
    definition::Vec3,
    geometry::world_to_local,
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
    pub damage: f64,
}
#[derive(Clone, Debug, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct ShellHistory {
    #[ts(type = "number")]
    pub shell_id: i64,
    pub owner_id: String,
    #[ts(type = "number")]
    pub tick: u64,
    pub ammunition: Ammunition,
    pub impacts: Vec<ImpactRecord>,
    #[ts(as = "crate::frame_vocabulary::ShellOutcome")]
    pub outcome: String,
}
#[derive(Clone, Debug, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct DamageLogEntry {
    #[ts(type = "number")]
    pub id: u64,
    #[ts(type = "number")]
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
/// What struck the ship in a [`HitReport`].
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "kebab-case")]
pub enum HitWeapon {
    Shell,
    Torpedo,
    DepthCharge,
}
/// How one projectile's meeting with one ship ended.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "kebab-case")]
pub enum HitOutcome {
    /// Defeated a plate, or reached something inside the ship.
    Penetrated,
    /// Burst on the outside; blast and fragments did the damage.
    Burst,
    Stopped,
    Ricochet,
    /// An underwater warhead went off against the hull.
    Detonated,
    Dud,
}
/// The plate a [`HitReport`] turns on: the one that stopped the shell, or the
/// first it defeated.
#[derive(Clone, Debug, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(optional_fields)]
pub struct HitPlate {
    pub name: String,
    pub thickness_mm: f64,
    pub obliquity_deg: Option<f64>,
    pub resistance_mm: Option<f64>,
}
#[derive(Clone, Debug, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct HitModule {
    pub id: String,
    pub name: String,
    pub damage: f64,
    pub destroyed: bool,
}
/// One projectile's whole effect on one ship, kept to the end of the battle
/// for the after-action report. `position` is ship-local, where it first met
/// the ship.
#[derive(Clone, Debug, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(optional_fields)]
pub struct HitReport {
    #[ts(type = "number")]
    pub tick: u64,
    pub source_id: String,
    pub weapon: String,
    pub kind: HitWeapon,
    pub ammunition: Option<Ammunition>,
    pub position: Vec3,
    /// What it met first: a plate, a mount, a module or a room.
    pub struck: String,
    pub outcome: HitOutcome,
    pub plate: Option<HitPlate>,
    pub damage: f64,
    pub breach_area_m2: f64,
    /// Rooms this hit opened to the sea, by name.
    pub flooded: Vec<String>,
    pub modules: Vec<HitModule>,
    #[serde(skip)]
    projectile: i64,
}
/// A ship's line in the after-action report.
#[derive(Clone, Debug, Default, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(optional_fields)]
pub struct ShipReport {
    pub damage_taken: f64,
    pub shots_fired: u32,
    /// Projectiles of this ship's that struck an enemy hull, stopped or not.
    pub hits_landed: u32,
    pub dealt_by_weapon: BTreeMap<String, f64>,
    pub dealt_to: BTreeMap<String, f64>,
    #[ts(optional, type = "number")]
    pub lost_tick: Option<u64>,
    pub sunk_by: Option<String>,
    pub hits: Vec<HitReport>,
    /// Hits dropped from `hits` once it was full, least damaging first.
    pub hits_omitted: u32,
}
/// Damage dealt by each stable team up to `tick`.
#[derive(Clone, Debug, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct DamageSample {
    #[ts(type = "number")]
    pub tick: u64,
    pub dealt: [f64; 2],
}
/// Everything the after-action report reads beyond the score sheets. It rides
/// the debrief only, never an active frame, and nothing in the battle reads it.
#[derive(Clone, Debug, Default, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct AfterAction {
    pub ships: BTreeMap<String, ShipReport>,
    pub timeline: Vec<DamageSample>,
}
const MAX_HITS: usize = 400;
const TIMELINE_INTERVAL_TICKS: u64 = 300;
#[derive(Clone, Debug, Default, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct VesselScore {
    pub damage_dealt: f64,
    pub armor_blocked: f64,
    pub frags: u32,
    pub damage_log: Vec<DamageLogEntry>,
    #[serde(skip)]
    sequence: u64,
}
#[derive(Default, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct Records {
    pub scores: BTreeMap<String, VesselScore>,
    pub shell_history: Vec<ShellHistory>,
    #[serde(skip)]
    pub after_action: AfterAction,
    /// Module health as each tick opened, in actor order, so an underwater
    /// blast that reports no impacts can still name what it broke.
    #[serde(skip)]
    module_hp: Vec<Vec<f64>>,
    #[serde(skip)]
    pub sources: BTreeMap<i64, WeaponSource>,
    #[serde(skip)]
    last_damager: BTreeMap<String, String>,
    #[serde(skip)]
    credited: BTreeSet<String>,
    /// Whether the actor at each index was afloat when the tick opened, in
    /// actor order. A reused parallel vector: the identities are already in
    /// `actors`, so nothing needs cloning to answer "was this a live target".
    #[serde(skip)]
    eligible: Vec<bool>,
    #[serde(skip)]
    keep: Vec<i64>,
    #[serde(skip)]
    counts: Vec<(String, i32)>,
    /// Resolve once the shell finishes, including damage from a delayed burst.
    #[serde(skip)]
    armor_blocks: BTreeSet<(i64, String)>,
}
impl VesselScore {
    /// A score sheet for a frame, addressed through public IDs by the caller.
    pub fn addressed(
        damage_dealt: f64,
        armor_blocked: f64,
        frags: u32,
        damage_log: Vec<DamageLogEntry>,
    ) -> Self {
        Self {
            damage_dealt,
            armor_blocked,
            frags,
            damage_log,
            sequence: 0,
        }
    }
}
impl Records {
    /// Records for a frame: the sheets a viewer may see and no shell history.
    /// Private bookkeeping stays empty; nothing steps these.
    pub fn addressed(scores: BTreeMap<String, VesselScore>) -> Self {
        Self {
            scores,
            ..Default::default()
        }
    }
    pub fn begin_tick(&mut self, actors: &[Vessel]) {
        self.eligible.clear();
        self.eligible
            .extend(actors.iter().map(|a| a.physical_loss().is_none()));
        for a in actors {
            if !self.scores.contains_key(&a.motion.id) {
                self.scores.insert(a.motion.id.clone(), Default::default());
            }
        }
        self.module_hp.resize_with(actors.len(), Vec::new);
        for (hp, a) in self.module_hp.iter_mut().zip(actors) {
            hp.clear();
            hp.extend(a.damage.modules.iter().map(|m| m.hp));
        }
    }
    /// Remember who fired a projectile the first time it is seen in flight;
    /// that first sighting is also the shot the after-action report counts.
    pub fn source(&mut self, id: i64, source: impl FnOnce() -> WeaponSource) {
        if let std::collections::btree_map::Entry::Vacant(entry) = self.sources.entry(id) {
            let source = source();
            self.after_action
                .ships
                .entry(source.owner_id.clone())
                .or_default()
                .shots_fired += 1;
            entry.insert(source);
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
                damage: 0.0,
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
            if e.impact.as_ref().is_some_and(|i| {
                matches!(i.kind.as_str(), "armor" | "mount")
                    && (matches!(i.outcome.as_str(), "stopped" | "ricochet")
                        || source.ammunition == Ammunition::He
                            && i.outcome == "detonation"
                            && matches!((i.fragment_budget_mm, i.resistance_mm),
                                (Some(fragments), Some(armor)) if armor > 0.0 && fragments <= armor))
                    && i.through_wreckage != Some(true)
            }) && actors
                .iter()
                .find(|a| a.motion.id == source.owner_id)
                .is_some_and(|owner| {
                    actors.iter().enumerate().any(|(j, victim)| {
                        victim.motion.id == e.ship_id
                            && victim.team != owner.team
                            && self.eligible.get(j).copied().unwrap_or(false)
                    })
                })
            {
                self.armor_blocks.insert((id, e.ship_id.clone()));
            }
            self.report(e, id, &source, tick, actors);
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
    /// Fold one event into the victim's hit list: a projectile's impacts on a
    /// ship become one [`HitReport`], under the rules that decide whether the
    /// hit scores at all (an enemy, afloat when the tick opened, not wreckage).
    fn report(
        &mut self,
        e: &DamageEvent,
        projectile: i64,
        source: &WeaponSource,
        tick: u64,
        actors: &[Vessel],
    ) {
        let kind = if e.torpedo.is_some() {
            HitWeapon::Torpedo
        } else if e.depth_charge.is_some() {
            HitWeapon::DepthCharge
        } else {
            HitWeapon::Shell
        };
        let relevant = match kind {
            HitWeapon::Shell => e.impact.is_some(),
            HitWeapon::Torpedo => matches!(e.kind.as_str(), "torpedo-hit" | "torpedo-dud"),
            HitWeapon::DepthCharge => e.kind == "depth-charge-hit",
        };
        if !relevant
            || e.impact
                .as_ref()
                .is_some_and(|i| i.through_wreckage == Some(true))
        {
            return;
        }
        let Some(j) = actors.iter().position(|a| a.motion.id == e.ship_id) else {
            return;
        };
        let victim = &actors[j];
        if !self.eligible.get(j).copied().unwrap_or(false)
            || actors
                .iter()
                .find(|a| a.motion.id == source.owner_id)
                .is_none_or(|owner| owner.team == victim.team)
        {
            return;
        }
        let ship = self
            .after_action
            .ships
            .entry(e.ship_id.clone())
            .or_default();
        let index = ship
            .hits
            .iter()
            .rposition(|h| h.projectile == projectile)
            .unwrap_or_else(|| {
                if ship.hits.len() >= MAX_HITS {
                    let least = ship
                        .hits
                        .iter()
                        .enumerate()
                        .min_by(|a, b| a.1.damage.total_cmp(&b.1.damage))
                        .map_or(0, |(i, _)| i);
                    ship.hits.remove(least);
                    ship.hits_omitted += 1;
                }
                ship.hits.push(HitReport {
                    tick,
                    source_id: source.owner_id.clone(),
                    weapon: source.label.clone(),
                    kind,
                    ammunition: (kind == HitWeapon::Shell).then_some(source.ammunition),
                    position: e.impact.as_ref().map_or_else(
                        || world_to_local(e.position, victim.motion.pose()),
                        |i| i.position,
                    ),
                    struck: e
                        .impact
                        .as_ref()
                        .map_or_else(String::new, |i| i.target_name.clone()),
                    outcome: match kind {
                        HitWeapon::Shell => HitOutcome::Stopped,
                        _ if e.kind == "torpedo-dud" => HitOutcome::Dud,
                        _ => HitOutcome::Detonated,
                    },
                    plate: None,
                    damage: 0.0,
                    breach_area_m2: 0.0,
                    flooded: vec![],
                    modules: vec![],
                    projectile,
                });
                ship.hits.len() - 1
            });
        let created = ship.hits[index].damage == 0.0
            && ship.hits[index].plate.is_none()
            && ship.hits[index].modules.is_empty()
            && ship.hits[index].tick == tick;
        let hit = &mut ship.hits[index];
        let definition = &victim.compiled.definition;
        if let Some(i) = &e.impact {
            hit.damage += i.hull_damage.unwrap_or(0.0);
            let area = i.breach_area_m2.unwrap_or(0.0);
            hit.breach_area_m2 += area;
            if area > 0.0
                && let Some(room) = i
                    .compartment_id
                    .as_ref()
                    .and_then(|id| definition.compartments.iter().find(|c| &c.id == id))
                && !hit.flooded.contains(&room.name)
            {
                hit.flooded.push(room.name.clone());
            }
            let armor = matches!(i.kind.as_str(), "armor" | "mount") && i.thickness_mm.is_some();
            let halted = matches!(i.outcome.as_str(), "stopped" | "ricochet");
            if armor && (hit.plate.is_none() || halted) {
                hit.plate = Some(HitPlate {
                    name: i.target_name.clone(),
                    thickness_mm: i.thickness_mm.unwrap_or(0.0),
                    obliquity_deg: i.obliquity_deg,
                    resistance_mm: i.resistance_mm,
                });
            }
            // A shell is only as far along as its deepest impact: once inside
            // it stays a penetration whatever stops it later.
            hit.outcome = match (hit.outcome, i.outcome.as_str(), i.kind.as_str()) {
                (HitOutcome::Penetrated, ..) => HitOutcome::Penetrated,
                (_, "penetrated", _) | (_, _, "module" | "boundary" | "room") => {
                    HitOutcome::Penetrated
                }
                (_, "detonation", _) | (HitOutcome::Burst, ..) => HitOutcome::Burst,
                (_, "ricochet", _) => HitOutcome::Ricochet,
                (_, "stopped", _) => HitOutcome::Stopped,
                (current, ..) => current,
            };
            if e.kind == "burst" && hit.outcome != HitOutcome::Penetrated {
                hit.outcome = HitOutcome::Burst;
            }
            let damage = i.damage.unwrap_or(0.0);
            if matches!(i.kind.as_str(), "module" | "mount")
                && matches!(i.outcome.as_str(), "damaged" | "destroyed" | "detonation")
                && damage > 0.0
            {
                let destroyed = i.outcome != "damaged";
                match hit.modules.iter_mut().find(|m| m.id == i.target_id) {
                    Some(m) => {
                        m.damage += damage;
                        m.destroyed |= destroyed;
                    }
                    None => hit.modules.push(HitModule {
                        id: i.target_id.clone(),
                        name: i.target_name.clone(),
                        damage,
                        destroyed,
                    }),
                }
            }
        } else {
            hit.damage += e.hull_damage.unwrap_or(0.0);
            hit.breach_area_m2 = if hit.outcome == HitOutcome::Detonated {
                1.0
            } else {
                0.0
            };
            // "Torpedo hit · <protection> · <room> · flooding breach"
            let words: Vec<&str> = e.message.split(" · ").collect();
            if hit.outcome == HitOutcome::Detonated && words.len() >= 3 {
                hit.struck = words[words.len() - 2].into();
                hit.flooded = vec![hit.struck.clone()];
            }
            for (m, (state, before)) in definition
                .modules
                .iter()
                .zip(victim.damage.modules.iter().zip(&self.module_hp[j]))
            {
                if state.hp < *before {
                    hit.modules.push(HitModule {
                        id: state.id.clone(),
                        name: m.name.clone(),
                        damage: before - state.hp,
                        destroyed: state.hp == 0.0,
                    });
                }
            }
        }
        if created {
            self.after_action
                .ships
                .entry(source.owner_id.clone())
                .or_default()
                .hits_landed += 1;
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
        let Some(a) = actors.iter().find(|a| a.motion.id == owner) else {
            return;
        };
        let Some(j) = actors.iter().position(|a| a.motion.id == victim) else {
            return;
        };
        // Both lookups are pure, so testing eligibility after them keeps the
        // original "unknown or already lost victims score nothing" behaviour.
        if !self.eligible.get(j).copied().unwrap_or(false) {
            return;
        }
        let b = &actors[j];
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
        let dealer = self.after_action.ships.entry(owner.into()).or_default();
        *dealer.dealt_by_weapon.entry(weapon.into()).or_default() += damage;
        *dealer.dealt_to.entry(victim.into()).or_default() += damage;
        self.after_action
            .ships
            .entry(victim.into())
            .or_default()
            .damage_taken += damage;
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
    /// `active` is the sorted list of projectile ids still in flight.
    pub fn finish_tick(&mut self, actors: &[Vessel], active: &[i64], tick: u64) {
        self.armor_blocks.retain(|(id, victim)| {
            if active.binary_search(id).is_ok() {
                return true;
            }
            if let Some(source) = self.sources.get(id) {
                let dealt: f64 = self
                    .shell_history
                    .iter()
                    .find(|h| h.shell_id == *id)
                    .into_iter()
                    .flat_map(|h| &h.impacts)
                    .filter(|i| &i.ship_id == victim)
                    .map(|i| i.hull_damage.unwrap_or(0.0))
                    .sum();
                let blocked = (source.damage * crate::damage::HULL_HP_SCALE - dealt).max(0.0);
                if blocked.is_finite() {
                    self.scores.entry(victim.clone()).or_default().armor_blocked += blocked;
                }
            }
            false
        });
        for a in actors {
            if a.physical_loss().is_none() || self.credited.contains(&a.motion.id) {
                continue;
            }
            self.credited.insert(a.motion.id.clone());
            let owner = self.last_damager.get(&a.motion.id).cloned();
            let lost = self
                .after_action
                .ships
                .entry(a.motion.id.clone())
                .or_default();
            lost.lost_tick = Some(tick);
            lost.sunk_by = owner.clone();
            if let Some(owner) = owner {
                self.scores.entry(owner).or_default().frags += 1;
            }
        }
        if tick.is_multiple_of(TIMELINE_INTERVAL_TICKS) {
            let mut dealt = [0.0; 2];
            for a in actors {
                if let Some(score) = self.scores.get(&a.motion.id) {
                    dealt[a.team.index()] += score.damage_dealt;
                }
            }
            self.after_action
                .timeline
                .push(DamageSample { tick, dealt });
        }
        // Both ledgers are rebuilt every tick; reuse their storage and keep the
        // owner strings, so a steady battle stops allocating here entirely.
        let counts = &mut self.counts;
        for c in counts.iter_mut() {
            c.1 = 0;
        }
        let keep = &mut self.keep;
        keep.clear();
        for h in self.shell_history.iter().rev() {
            if h.outcome == "flying" {
                keep.push(h.shell_id);
                continue;
            }
            let count = match counts.iter_mut().find(|c| c.0 == h.owner_id) {
                Some(c) => &mut c.1,
                None => {
                    counts.push((h.owner_id.clone(), 0));
                    &mut counts.last_mut().unwrap().1
                }
            };
            *count += 1;
            if *count <= 16 {
                keep.push(h.shell_id);
            }
        }
        keep.sort_unstable();
        self.shell_history
            .retain(|h| keep.binary_search(&h.shell_id).is_ok());
        self.sources
            .retain(|id, _| active.binary_search(id).is_ok() || keep.binary_search(id).is_ok());
    }
}
