use crate::{
    damage::Combatant,
    definition::{Module, ShipDefinition, Vec3},
    environment::SeaState,
    geometry::*,
    stability::water_level,
};
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EquipmentReason {
    Operational,
    Damaged,
    Destroyed,
    Flooded,
}
#[derive(Clone, Copy, Debug)]
pub struct EquipmentCondition {
    pub availability: f64,
    pub reason: EquipmentReason,
}
pub fn equipment_pose(actor: &Combatant, def: &ShipDefinition, module: &Module) -> Option<Pose> {
    let id = module.torpedo_launcher_id.as_ref()?;
    let l = def
        .torpedo_launchers
        .as_ref()?
        .iter()
        .find(|l| &l.id == id)?;
    Some(Pose {
        x: l.position[0],
        y: l.position[1],
        z: l.position[2],
        heading: actor.launcher_trains.get(id).copied().unwrap_or(0.0),
        ..Pose::default()
    })
}
pub fn equipment_box(def: &ShipDefinition, module: &Module) -> (Vec3, Vec3) {
    let launcher = module
        .torpedo_launcher_id
        .as_ref()
        .and_then(|id| def.torpedo_launchers.as_ref()?.iter().find(|l| &l.id == id));
    (
        launcher.map_or(module.center, |l| sub(module.center, l.position)),
        module.size,
    )
}
pub fn equipment_center(actor: &Combatant, def: &ShipDefinition, module: &Module) -> Vec3 {
    let (center, _) = equipment_box(def, module);
    equipment_pose(actor, def, module).map_or(center, |pose| local_to_world(center, pose))
}
pub fn equipment_condition(
    actor: &Combatant,
    def: &ShipDefinition,
    module: &Module,
    sea: Option<(&SeaState, f64)>,
) -> EquipmentCondition {
    let sea = sea.or_else(|| actor.sea.as_ref().map(|(s, t)| (s, *t)));
    let hp = actor
        .damage
        .modules
        .iter()
        .find(|m| m.id == module.id)
        .map_or(0.0, |m| m.hp);
    let reason = if hp <= 0.0 {
        EquipmentReason::Destroyed
    } else if let Some(tolerance) = module.immersion_tolerance_m {
        let center = equipment_center(actor, def, module);
        let datum = local_to_world(
            [
                center[0],
                center[1] - module.size[1] / 2.0 + tolerance,
                center[2],
            ],
            actor.motion.pose(),
        );
        let flooded = if let Some(id) = &module.compartment_id {
            let i = def
                .compartments
                .iter()
                .position(|r| &r.id == id)
                .expect("validated room");
            actor.damage.compartments[i].water_m3 > 0.0
                && water_level(actor, def, i, None) >= datum[1]
        } else {
            datum[1] <= sea.map_or(0.0, |(s, t)| s.height(datum[0], datum[2], t))
        };
        if flooded {
            EquipmentReason::Flooded
        } else if hp < module.hp {
            EquipmentReason::Damaged
        } else {
            EquipmentReason::Operational
        }
    } else if hp < module.hp {
        EquipmentReason::Damaged
    } else {
        EquipmentReason::Operational
    };
    EquipmentCondition {
        reason,
        availability: if matches!(
            reason,
            EquipmentReason::Destroyed | EquipmentReason::Flooded
        ) {
            0.0
        } else {
            hp / module.hp
        },
    }
}
pub fn electrical_power(
    actor: &Combatant,
    def: &ShipDefinition,
    sea: Option<(&SeaState, f64)>,
) -> f64 {
    if actor.damage.sunk {
        return 0.0;
    }
    let generators: Vec<_> = def
        .modules
        .iter()
        .filter(|m| m.kind == "generator")
        .collect();
    if generators.is_empty() {
        1.0
    } else {
        generators
            .iter()
            .map(|m| equipment_condition(actor, def, m, sea).availability)
            .sum::<f64>()
            / generators.len() as f64
    }
}
pub fn mount_support(
    actor: &Combatant,
    def: &ShipDefinition,
    id: Option<&str>,
    sea: Option<(&SeaState, f64)>,
) -> (f64, f64) {
    let power = electrical_power(actor, def, sea);
    let directors: Vec<_> = def
        .modules
        .iter()
        .filter(|m| m.kind == "fire-control")
        .collect();
    let coverage = id.is_some() && directors.iter().any(|m| m.serves_mount_ids.is_some());
    let served: Vec<_> = directors
        .iter()
        .filter(|m| {
            !coverage
                || m.serves_mount_ids
                    .as_ref()
                    .is_some_and(|ids| ids.iter().any(|s| Some(s.as_str()) == id))
        })
        .collect();
    let best = served
        .iter()
        .map(|m| equipment_condition(actor, def, m, sea).availability)
        .fold(0.0, f64::max);
    (
        power,
        if !coverage && directors.is_empty() {
            1.0
        } else {
            best * (0.35 + 0.65 * power)
        },
    )
}
pub fn system_health(
    actor: &Combatant,
    def: &ShipDefinition,
    kind: &str,
    sea: Option<(&SeaState, f64)>,
) -> f64 {
    if actor.damage.sunk {
        return 0.0;
    }
    let available = |id: &String| {
        def.modules.iter().find(|m| &m.id == id).map_or(0.0, |m| {
            equipment_condition(actor, def, m, sea).availability
        })
    };
    if kind == "engine" {
        if let Some(s) = &def.submarine {
            let ids = if actor.motion.depth() > 0.5 {
                &s.submerged_engine_ids
            } else {
                &s.surface_engine_ids
            };
            return ids.iter().map(available).sum::<f64>() / ids.len() as f64;
        }
        if let Some(p) = &def.propulsion {
            return p
                .groups
                .iter()
                .map(|g| {
                    let steam = if g.boiler_ids.is_empty() {
                        1.0
                    } else {
                        g.boiler_ids.iter().map(available).sum::<f64>() / g.boiler_ids.len() as f64
                    };
                    let drive = g
                        .drive_ids
                        .iter()
                        .map(available)
                        .fold(f64::INFINITY, f64::min);
                    let shaft = if g.shaft_ids.is_empty() {
                        1.0
                    } else {
                        g.shaft_ids
                            .iter()
                            .map(available)
                            .fold(f64::INFINITY, f64::min)
                    };
                    g.share * steam.min(drive).min(shaft)
                })
                .sum();
        }
    }
    let modules: Vec<_> = def.modules.iter().filter(|m| m.kind == kind).collect();
    if modules.is_empty() {
        1.0
    } else {
        modules
            .iter()
            .map(|m| equipment_condition(actor, def, m, sea).availability)
            .sum::<f64>()
            / modules.len() as f64
    }
}
/// The launcher owner is shared by readiness and permanent capability checks.
pub fn launcher_available(
    actor: &Combatant,
    def: &ShipDefinition,
    id: Option<&str>,
    recoverable: bool,
    sea: Option<(&SeaState, f64)>,
) -> bool {
    let Some(id) = id else {
        return true;
    };
    let Some(module) = def.modules.iter().find(|m| m.id == id) else {
        return false;
    };
    let state = equipment_condition(actor, def, module, sea);
    if recoverable {
        state.reason != EquipmentReason::Destroyed
    } else {
        state.availability > 0.0
    }
}
