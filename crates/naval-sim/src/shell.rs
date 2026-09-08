use crate::{
    damage::{Combatant, HULL_HP_SCALE, damage_hull, damage_region},
    definition::{APProjectile, HEProjectile, ShipDefinition, Vec3},
    weapons::Ammunition,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LodgedShell {
    pub ship_id: String,
    pub position: Vec3,
    pub mount_id: Option<String>,
    pub module_id: Option<String>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Shell {
    pub bomb: Option<crate::aircraft_flight::FlightAttitude>,
    #[serde(rename = "type")]
    pub shell_type: Option<String>,
    pub id: i64,
    pub owner_id: String,
    pub position: Vec3,
    pub velocity: Vec3,
    pub age: f64,
    pub weapon_label: Option<String>,
    pub penetration_mm: f64,
    pub damage: f64,
    pub caliber_m: f64,
    pub visited: Vec<String>,
    pub drag_per_second: Option<f64>,
    pub water_drag_per_second: Option<f64>,
    pub ap: Option<APProjectile>,
    pub he: Option<HEProjectile>,
    pub ammunition: Option<Ammunition>,
    pub remaining_module_damage: Option<f64>,
    pub hull_damage: BTreeMap<String, f64>,
    pub hull_damage_consumed: BTreeMap<String, f64>,
    pub hull_region_damage: BTreeMap<String, f64>,
    pub equipment_damage: BTreeMap<String, f64>,
    pub wreckage_ships: Vec<String>,
    pub detonate_at_age: Option<f64>,
    pub last_hit_ship_id: Option<String>,
    pub lodged: Option<LodgedShell>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalDamageEvidence {
    pub region_id: String,
    pub region_name: String,
    pub condition: f64,
    pub multiplier: f64,
}
pub fn local_damage_evidence(
    actor: &Combatant,
    def: &ShipDefinition,
    point: Vec3,
    mount: Option<&str>,
    module: Option<&str>,
) -> Option<LocalDamageEvidence> {
    let r = damage_region(def, point, mount, module)?;
    let condition = actor
        .damage
        .regions
        .iter()
        .find(|s| s.id == r.id)
        .map_or(1.0, |s| s.hp / s.maximum);
    Some(LocalDamageEvidence {
        region_id: r.id.clone(),
        region_name: r.name.clone(),
        condition,
        multiplier: (condition * 2.0).min(1.0),
    })
}
pub fn damage_shell_hull(
    shell: &mut Shell,
    actor: &mut Combatant,
    total: f64,
    local: Option<&LocalDamageEvidence>,
) -> f64 {
    let id = actor.motion.id.clone();
    let previous = shell.hull_damage_consumed.get(&id).copied().unwrap_or(0.0);
    let key = format!(
        "{}:{}",
        id,
        local.map_or("legacy", |l| l.region_id.as_str())
    );
    let nominal = shell.hull_region_damage.get(&key).copied().unwrap_or(0.0);
    shell.hull_region_damage.insert(key, nominal.max(total));
    let remainder = actor.damage.hull_damage_remainder;
    let dealt = damage_hull(
        actor,
        (total - nominal).min(total - previous).max(0.0),
        local.map(|l| l.region_id.as_str()),
    );
    shell.hull_damage_consumed.insert(
        id.clone(),
        previous + (dealt + actor.damage.hull_damage_remainder - remainder) / HULL_HP_SCALE,
    );
    *shell.hull_damage.entry(id).or_default() += dealt;
    dealt
}
