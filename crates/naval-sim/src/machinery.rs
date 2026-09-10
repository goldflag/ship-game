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
    // The module state vector is parallel to `def.modules`, so the index of the
    // borrowed module resolves the same entry `find(|m| m.id == module.id)` did.
    let known = actor
        .index
        .of(def)
        .filter(|ix| actor.damage.modules.len() == ix.modules)
        .and_then(|ix| Some((ix, ix.position(module)?)));
    let sea = sea.or_else(|| actor.sea.as_ref().map(|(s, t)| (s, *t)));
    let hp = match known {
        Some((ix, i)) => actor.damage.modules[ix.module_state(i)].hp,
        None => actor
            .damage
            .modules
            .iter()
            .find(|m| m.id == module.id)
            .map_or(0.0, |m| m.hp),
    };
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
            let i = match known {
                Some((ix, mi)) => ix.room(mi).expect("validated room"),
                None => def
                    .compartments
                    .iter()
                    .position(|r| &r.id == id)
                    .expect("validated room"),
            };
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
    kind_average(actor, def, "generator", sea)
}
/// Mean availability over every module of a kind, or 1.0 when the ship has none.
fn kind_average(
    actor: &Combatant,
    def: &ShipDefinition,
    kind: &str,
    sea: Option<(&SeaState, f64)>,
) -> f64 {
    if let Some(ix) = actor.index.of(def) {
        let modules = ix.kind(kind);
        return if modules.is_empty() {
            1.0
        } else {
            modules
                .iter()
                .map(|i| equipment_condition(actor, def, &def.modules[*i], sea).availability)
                .sum::<f64>()
                / modules.len() as f64
        };
    }
    let mut count = 0.0;
    let sum: f64 = def
        .modules
        .iter()
        .filter(|m| m.kind == kind)
        .map(|m| {
            count += 1.0;
            equipment_condition(actor, def, m, sea).availability
        })
        .sum();
    if count == 0.0 { 1.0 } else { sum / count }
}
pub fn mount_support(
    actor: &Combatant,
    def: &ShipDefinition,
    id: Option<&str>,
    sea: Option<(&SeaState, f64)>,
) -> (f64, f64) {
    let power = electrical_power(actor, def, sea);
    let indexed = actor.index.of(def);
    let served = indexed.and_then(|ix| ix.served(id));
    let (coverage, directors) = match indexed {
        Some(ix) => (id.is_some() && ix.coverage, ix.directors.len()),
        None => (
            id.is_some()
                && def
                    .modules
                    .iter()
                    .any(|m| m.kind == "fire-control" && m.serves_mount_ids.is_some()),
            def.modules
                .iter()
                .filter(|m| m.kind == "fire-control")
                .count(),
        ),
    };
    let best = match served {
        Some(served) => served
            .iter()
            .map(|i| equipment_condition(actor, def, &def.modules[*i], sea).availability)
            .fold(0.0, f64::max),
        None => def
            .modules
            .iter()
            .filter(|m| m.kind == "fire-control")
            .filter(|m| {
                !coverage
                    || m.serves_mount_ids
                        .as_ref()
                        .is_some_and(|ids| ids.iter().any(|s| Some(s.as_str()) == id))
            })
            .map(|m| equipment_condition(actor, def, m, sea).availability)
            .fold(0.0, f64::max),
    };
    (
        power,
        if !coverage && directors == 0 {
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
    let indexed = actor.index.of(def);
    let available = |id: &String| {
        let module = match indexed {
            Some(ix) => ix.module(id).map(|i| &def.modules[i]),
            None => def.modules.iter().find(|m| &m.id == id),
        };
        module.map_or(0.0, |m| {
            equipment_condition(actor, def, m, sea).availability
        })
    };
    let at = |i: &Option<usize>| {
        i.map_or(0.0, |i| {
            equipment_condition(actor, def, &def.modules[i], sea).availability
        })
    };
    if kind == "engine" {
        if let Some(s) = &def.submarine {
            let submerged = actor.motion.depth() > 0.5;
            if let Some((down, up)) = indexed.and_then(|ix| ix.submarine_engines.as_ref()) {
                let ids = if submerged { down } else { up };
                return ids.iter().map(at).sum::<f64>() / ids.len() as f64;
            }
            let ids = if submerged {
                &s.submerged_engine_ids
            } else {
                &s.surface_engine_ids
            };
            return ids.iter().map(available).sum::<f64>() / ids.len() as f64;
        }
        if let Some(p) = &def.propulsion {
            if let Some(groups) = indexed.map(|ix| &ix.propulsion) {
                return groups
                    .iter()
                    .map(|g| {
                        let steam = if g.boilers.is_empty() {
                            1.0
                        } else {
                            g.boilers.iter().map(at).sum::<f64>() / g.boilers.len() as f64
                        };
                        let drive = g.drives.iter().map(at).fold(f64::INFINITY, f64::min);
                        let shaft = if g.shafts.is_empty() {
                            1.0
                        } else {
                            g.shafts.iter().map(at).fold(f64::INFINITY, f64::min)
                        };
                        g.share * steam.min(drive).min(shaft)
                    })
                    .sum();
            }
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
    kind_average(actor, def, kind, sea)
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
    let found = match actor.index.of(def) {
        Some(ix) => ix.module(id).map(|i| &def.modules[i]),
        None => def.modules.iter().find(|m| m.id == id),
    };
    let Some(module) = found else {
        return false;
    };
    let state = equipment_condition(actor, def, module, sea);
    if recoverable {
        state.reason != EquipmentReason::Destroyed
    } else {
        state.availability > 0.0
    }
}
