//! Mutable durability and compartment state. Hull survival is independent of weapon capability.
use crate::{
    damage_control::ControlState,
    definition::{ShipDefinition, Vec3},
    geometry::contains,
    motion::ShipState,
    rules::PhysicalLoss,
    stability::StabilityState,
    submarine::SubmarineState,
    weapons::MountState,
};
use serde::{Deserialize, Serialize};
pub const HULL_HP_SCALE: f64 = 35.0;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Breach {
    pub position: Vec3,
    pub area_m2: f64,
    pub radius_m: f64,
    pub shell_id: i64,
    pub normal: Option<Vec3>,
    pub footprint_area_m2: Option<f64>,
    pub initial_area_m2: Option<f64>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompartmentState {
    pub id: String,
    pub water_m3: f64,
    pub breach_area_m2: f64,
    pub breaches: Vec<Breach>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionState {
    pub id: String,
    pub state: String,
    pub damage_area_m2: f64,
    pub from_index: usize,
    pub to_index: usize,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RegionState {
    pub id: String,
    pub hp: f64,
    pub maximum: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ModuleState {
    pub id: String,
    pub hp: f64,
    pub detonated: bool,
    pub ignition: f64,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DamageState {
    pub regions: Vec<RegionState>,
    pub control: ControlState,
    pub stability: StabilityState,
    pub integrity: f64,
    pub max_integrity: f64,
    pub hull_damage_remainder: f64,
    pub modules: Vec<ModuleState>,
    pub compartments: Vec<CompartmentState>,
    pub connections: Vec<ConnectionState>,
    pub sunk: bool,
    pub defeat_cause: Option<String>,
}
/// Core ship state shared by all weapon systems. Immutable content stays outside snapshots.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Combatant {
    /// Content lookup tables for this ship's definition; never published.
    #[serde(skip)]
    pub index: std::sync::Arc<crate::vessel::ShipIndex>,
    #[serde(skip)]
    pub sea: Option<(crate::environment::SeaState, f64)>,
    pub depth_charge_launchers: Vec<crate::depth_charges::DepthChargeLauncherState>,
    pub torpedo_tubes: Vec<crate::torpedoes::TubeState>,
    pub motion: ShipState,
    pub mounts: Vec<MountState>,
    pub damage: DamageState,
    pub submarine: Option<SubmarineState>,
    pub launcher_trains: std::collections::BTreeMap<String, f64>,
}
impl Combatant {
    pub fn new(id: impl Into<String>, def: &ShipDefinition) -> Self {
        Self {
            index: std::sync::Arc::new(crate::vessel::ShipIndex::new(def)),
            sea: None,
            torpedo_tubes: def
                .torpedo_tubes
                .iter()
                .flatten()
                .map(crate::torpedoes::TubeState::new)
                .collect(),
            depth_charge_launchers: def
                .depth_charge_launchers
                .iter()
                .flatten()
                .map(crate::depth_charges::DepthChargeLauncherState::new)
                .collect(),
            motion: ShipState::new(id),
            mounts: def.mounts.iter().map(MountState::new).collect(),
            damage: DamageState::new(def),
            submarine: def.submarine.as_ref().map(|_| SubmarineState::default()),
            launcher_trains: def
                .torpedo_launchers
                .iter()
                .flatten()
                .map(|l| (l.id.clone(), 0.0))
                .collect(),
        }
    }
    pub fn physical_loss(&self) -> Option<PhysicalLoss> {
        if self.damage.integrity <= 0.0 {
            Some(PhysicalLoss::HullFailure)
        } else if self.damage.sunk {
            Some(match self.damage.defeat_cause.as_deref() {
                Some("capsize") => PhysicalLoss::Capsize,
                Some("hull-failure") => PhysicalLoss::HullFailure,
                _ => PhysicalLoss::Flooding,
            })
        } else {
            None
        }
    }
}
pub fn max_hull_integrity(def: &ShipDefinition) -> f64 {
    // Gentle small-hull bonus (mass^0.8), anchored to Bismarck’s existing 50,750 HP.
    ((def.hull.mass_kg / 43_978_000.0).powf(0.8) * 1450.0 * HULL_HP_SCALE).round()
}
impl DamageState {
    pub fn new(def: &ShipDefinition) -> Self {
        let maximum = max_hull_integrity(def);
        Self {
            regions: def
                .local_damage
                .iter()
                .flat_map(|d| &d.regions)
                .map(|r| RegionState {
                    id: r.id.clone(),
                    hp: r.durability_fraction * maximum,
                    maximum: r.durability_fraction * maximum,
                })
                .collect(),
            control: ControlState::new(def),
            stability: StabilityState::default(),
            integrity: maximum,
            max_integrity: maximum,
            hull_damage_remainder: 0.0,
            modules: def
                .modules
                .iter()
                .map(|m| ModuleState {
                    id: m.id.clone(),
                    hp: m.hp,
                    detonated: false,
                    ignition: 0.0,
                })
                .collect(),
            compartments: def
                .compartments
                .iter()
                .map(|c| CompartmentState {
                    id: c.id.clone(),
                    water_m3: 0.0,
                    breach_area_m2: 0.0,
                    breaches: vec![],
                })
                .collect(),
            connections: def
                .connections
                .iter()
                .map(|c| ConnectionState {
                    id: c
                        .id
                        .clone()
                        .unwrap_or_else(|| format!("{}:{}", c.from_id, c.to_id)),
                    state: c.state.clone().unwrap_or_else(|| "open".into()),
                    damage_area_m2: if c.state.as_deref() == Some("damaged") {
                        c.area_m2
                    } else {
                        0.0
                    },
                    from_index: def
                        .compartments
                        .iter()
                        .position(|r| r.id == c.from_id)
                        .expect("validated connection"),
                    to_index: def
                        .compartments
                        .iter()
                        .position(|r| r.id == c.to_id)
                        .expect("validated connection"),
                })
                .collect(),
            sunk: false,
            defeat_cause: None,
        }
    }
    pub fn consume_structure(&mut self, amount: f64, region_id: Option<&str>) -> f64 {
        if amount <= 0.0 {
            return 0.0;
        }
        let Some(r) = self
            .regions
            .iter_mut()
            .find(|r| Some(r.id.as_str()) == region_id)
        else {
            return amount;
        };
        let before = r.hp;
        let half = r.maximum / 2.0;
        let full = amount.min((before - half).max(0.0));
        r.hp -= full;
        r.hp *= (-(amount - full) / half).exp();
        if r.hp < 0.001 * HULL_HP_SCALE {
            r.hp = 0.0;
        }
        before - r.hp
    }
}
pub fn damage_region<'a>(
    def: &'a ShipDefinition,
    point: Vec3,
    mount: Option<&str>,
    module: Option<&str>,
) -> Option<&'a crate::definition::DamageRegion> {
    let regions = &def.local_damage.as_ref()?.regions;
    if let Some(id) = module
        && let Some(r) = regions.iter().find(|r| r.module_id.as_deref() == Some(id))
    {
        return Some(r);
    }
    if let Some(id) = mount {
        return regions.iter().find(|r| r.mount_id.as_deref() == Some(id));
    }
    regions
        .iter()
        .filter(|r| {
            r.mount_id.is_none() && r.module_id.is_none() && contains(r.center, r.size, point)
        })
        .min_by(|a, b| {
            (a.size[0] * a.size[1] * a.size[2]).total_cmp(&(b.size[0] * b.size[1] * b.size[2]))
        })
}
pub fn damage_hull(actor: &mut Combatant, amount: f64, region: Option<&str>) -> f64 {
    if actor.physical_loss().is_some() {
        return 0.0;
    }
    let consumed = actor
        .damage
        .consume_structure(amount.max(0.0) * HULL_HP_SCALE, region);
    let pending = consumed + actor.damage.hull_damage_remainder;
    let whole = (pending + 1e-9).floor();
    actor.damage.hull_damage_remainder = (pending - whole).max(0.0);
    let dealt = actor.damage.integrity.min(whole);
    actor.damage.integrity -= dealt;
    dealt
}
pub fn damage_blast_hull(
    actor: &mut Combatant,
    def: &ShipDefinition,
    point: Vec3,
    amount: f64,
) -> f64 {
    let Some(local) = &def.local_damage else {
        return damage_hull(actor, amount, None);
    };
    let radius = 10.0_f64.max(amount.max(0.0).cbrt() * 3.0);
    let regions: Vec<_> = local
        .regions
        .iter()
        .filter(|r| r.kind == "hull")
        .filter_map(|r| {
            let delta = std::array::from_fn(|i| {
                ((point[i] - r.center[i]).abs() - r.size[i] / 2.0).max(0.0)
            });
            let w = (1.0 - crate::geometry::length(delta) / radius).max(0.0);
            (w > 0.0).then_some((r, w))
        })
        .collect();
    let total: f64 = regions.iter().map(|(_, w)| w).sum();
    regions
        .iter()
        .map(|(r, w)| damage_hull(actor, amount * w / total, Some(&r.id)))
        .sum()
}
