use crate::{
    aircraft::AirWingState, damage::Combatant, definition::ShipDefinition, machinery::*,
    weapons::Ammunition,
};
/// Weapon availability is independent of physical survival. Temporary immersion
/// may recover; losing weapons never removes afloat displacement from scoring.
pub fn update(actor: &mut Combatant, def: &ShipDefinition, wing: Option<&AirWingState>) {
    if actor.damage.sunk || actor.damage.integrity <= 0.0 {
        if !actor.damage.sunk {
            actor.damage.defeat_cause = Some("hull-failure".into())
        }
        actor.damage.stability.combat_lost = true;
        if actor.damage.stability.status != "capsized" {
            actor.damage.stability.status = "sinking".into()
        }
        for m in &mut actor.mounts {
            m.status = "disabled".into()
        }
        return;
    }
    let hp = |id: &str| {
        actor
            .damage
            .modules
            .iter()
            .find(|m| m.id == id)
            .map_or(0.0, |m| m.hp)
    };
    let available = |id: &str| {
        def.modules
            .iter()
            .find(|m| m.id == id)
            .is_some_and(|m| equipment_condition(actor, def, m, None).availability > 0.0)
    };
    let armed = wing.is_some_and(|w| {
        w.planes.iter().any(|p| {
            matches!(
                p.phase.as_str(),
                "takeoff" | "outbound" | "attack" | "returning" | "landing"
            ) && p.payload
        })
    });
    let reserves = wing.is_some_and(|w| {
        w.planes
            .iter()
            .any(|p| p.phase != "lost" && p.role != "fighter")
    });
    let service = def.air_wing.as_ref().map(|w| w.service_module_id.as_str());
    let mut usable = armed || reserves && service.is_some_and(available);
    let mut recoverable = armed || reserves && service.is_some_and(|id| hp(id) > 0.0);
    let mut any_salvo = false;
    let mut disabled = vec![];
    for (i, m) in def.mounts.iter().enumerate() {
        let s = &actor.mounts[i];
        let n = m.weapon.barrel_count.unwrap_or(2.0);
        let loaded = s.available(Ammunition::Ap) >= n
            || m.weapon.he.is_some() && s.available(Ammunition::He) >= n;
        any_salvo |= loaded;
        if s.hp > 0.0 && loaded {
            usable |= m.magazine_id.as_deref().is_none_or(available);
            recoverable |= m.magazine_id.as_deref().is_none_or(|id| hp(id) > 0.0)
        }
        disabled.push(s.hp <= 0.0 || m.magazine_id.as_deref().is_some_and(|id| !available(id)));
    }
    let mut loaded_underwater = false;
    let mut check = |magazine: &str, launcher: Option<&str>| {
        loaded_underwater = true;
        usable |= launcher_available(actor, def, launcher, false, None) && available(magazine);
        recoverable |= launcher_available(actor, def, launcher, true, None) && hp(magazine) > 0.0;
    };
    for t in def.torpedo_tubes.iter().flatten() {
        if actor
            .torpedo_tubes
            .iter()
            .any(|s| s.id == t.id && s.ammo > 0.0)
        {
            check(&t.magazine_id, t.launcher_module_id.as_deref())
        }
    }
    for l in def.depth_charge_launchers.iter().flatten() {
        if actor
            .depth_charge_launchers
            .iter()
            .any(|s| s.id == l.id && s.ammo > 0.0)
        {
            check(&l.magazine_id, l.launcher_module_id.as_deref())
        }
    }
    let mobile = system_health(actor, def, "engine", None) > 0.001;
    actor.damage.stability.combat_lost |= !recoverable;
    actor.damage.stability.status = if usable {
        if mobile { "operational" } else { "immobile" }
    } else if mobile {
        "disarmed"
    } else {
        "disabled"
    }
    .into();
    if actor.damage.stability.combat_lost && actor.damage.defeat_cause.is_none() {
        actor.damage.defeat_cause = Some(
            if !any_salvo && !loaded_underwater {
                "ammunition-exhausted"
            } else {
                "weapons-lost"
            }
            .into(),
        )
    }
    for (i, m) in actor.mounts.iter_mut().enumerate() {
        if actor.damage.stability.combat_lost || disabled[i] {
            m.status = "disabled".into()
        }
    }
}
