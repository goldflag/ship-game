use crate::{
    anti_aircraft,
    aviation::Aviation,
    ballistics::*,
    bots,
    definition::{MountDefinition, Vec3},
    geometry::*,
    impact::{DamageEvent, ShellEffect},
    machinery::{electrical_power, equipment_condition, mount_support},
    shell::Shell,
    vessel::{Controller, Vessel},
    weapons::*,
};
use std::collections::BTreeMap;
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerGunOrders {
    pub battery: String,
    pub weapon_group_id: Option<String>,
    pub aim: Option<Vec3>,
    pub fire: bool,
    pub ammunition: BTreeMap<String, Ammunition>,
}
/// Group identity derives from fitted weapon characteristics, like the authoring
/// adapter. Normalize integral JSON numbers to JavaScript's stable group keys.
pub fn group_id(m: &MountDefinition) -> String {
    let w = &m.weapon;
    let b = w.ballistics.as_ref();
    let mut fields = serde_json::json!([
        w.caliber_m,
        w.reload_seconds,
        w.muzzle_speed,
        w.projectile_mass_kg,
        w.penetration_mm,
        w.damage,
        w.traverse_rate_deg,
        w.elevation_min_deg,
        w.elevation_max_deg,
        w.elevation_rate_deg,
        b.map_or(0.0, |b| b.drag_per_second),
        b.map_or(0.0, |b| b.dispersion_rad),
        b.map_or(0.0, |b| b.muzzle_speed_sigma_fraction.unwrap_or(0.0)),
        b.map_or(w.muzzle_speed, |b| b
            .penetration_reference_speed_mps
            .unwrap_or(w.muzzle_speed)),
        w.ap.as_ref().map(|a| [
            a.arming_resistance_mm,
            a.fuze_delay_seconds,
            a.explosive_kg,
            a.fragment_penetration_mm
        ]),
        w.he.as_ref()
            .map(|h| [h.explosive_kg, h.fragment_penetration_mm, h.damage])
    ]);
    fn normalize(v: &mut serde_json::Value) {
        match v {
            serde_json::Value::Array(a) => a.iter_mut().for_each(normalize),
            serde_json::Value::Number(n) => {
                let f = n.as_f64().unwrap();
                if f.fract() == 0.0 && f.abs() < 9e15 {
                    *v = serde_json::json!(f as i64)
                }
            }
            _ => (),
        }
    }
    normalize(&mut fields);
    format!("{}:gun:{}", m.battery, fields)
}
pub struct GunneryContext<'a> {
    pub actors: &'a [Vessel],
    pub aviation: &'a mut Aviation,
    pub shells: &'a mut Vec<Shell>,
    pub sequence: &'a mut i64,
    pub dispersion: &'a mut u32,
    pub events: &'a mut Vec<DamageEvent>,
    pub seed: u32,
    pub dt: f64,
}
/// Each mount is temporarily detached, avoiding fleet clones and mutable aliases
/// while both automatic and manual paths inspect the owning vessel.
pub fn operate(
    actor: &mut Vessel,
    ctx: &mut GunneryContext<'_>,
    target: Option<&Vessel>,
    player: Option<&PlayerGunOrders>,
) {
    let compiled = actor.compiled.clone();
    let def = &compiled.definition;
    let power = electrical_power(actor, def, None);
    let lane = target.is_some_and(|t| bots::clear_firing_lane(actor, t, ctx.actors));
    let velocity = actor.motion.velocity();
    for (i, m) in def.mounts.iter().enumerate() {
        if actor.damage.stability.combat_lost
            || m.magazine_id.as_ref().is_some_and(|id| {
                def.modules
                    .iter()
                    .find(|m| &m.id == id)
                    .is_some_and(|module| {
                        equipment_condition(actor, def, module, None).availability == 0.0
                    })
            })
        {
            actor.mounts[i].status = "disabled".into();
            continue;
        }
        let allowed = anti_aircraft::surface_allowed(def, m);
        let group = &compiled.weapon_group_ids[i];
        let selected = allowed
            && player.is_some_and(|p| {
                p.battery == m.battery && p.weapon_group_id.as_ref().is_none_or(|id| id == group)
            });
        let manual = selected && player.unwrap().weapon_group_id.is_some();
        let mut state = actor.mounts[i].clone();
        if !manual
            && anti_aircraft::update(
                actor,
                m,
                &mut state,
                ctx.actors,
                ctx.aviation,
                ctx.dt,
                ctx.seed,
                ctx.sequence,
                ctx.events,
            )
        {
            actor.mounts[i] = state;
            continue;
        }
        if !allowed {
            update_mount(
                m,
                &mut state,
                def,
                &actor.motion,
                None,
                ctx.dt,
                velocity,
                power,
                &compiled.obstructions,
            );
            actor.mounts[i] = state;
            continue;
        }
        let mut aim = None;
        let mut fire = false;
        if let Some(p) = player {
            if let Some(kind) = p
                .ammunition
                .get(group)
                .or_else(|| p.ammunition.get(&m.battery))
            {
                state.queue_ammunition(m, *kind)
            }
            let Some(point) = p.aim else {
                state.status = "out-of-arc".into();
                actor.mounts[i] = state;
                continue;
            };
            aim = Some(point);
            fire = p.fire && selected;
        } else if actor.controller == Controller::Bot
            && let Some(t) = target
        {
            state.select_ammunition(m, bots::ammunition(t.definition(), m, &state));
            let in_range = (t.motion.x - actor.motion.x).hypot(t.motion.z - actor.motion.z)
                <= bots::gun_range(m);
            if in_range
                && state.hp > 0.0
                && state.available(state.loaded) >= m.weapon.barrel_count.unwrap_or(2.0)
            {
                aim = Some(bots::aim(
                    actor.bot.as_ref(),
                    &actor.motion,
                    t,
                    t.definition(),
                    m,
                    &mut state,
                ))
            }
            fire = in_range && lane && actor.bot.as_ref().is_some_and(|b| b.ready(Some(m)));
        }
        let aligned = update_mount(
            m,
            &mut state,
            def,
            &actor.motion,
            aim,
            ctx.dt,
            velocity,
            power,
            &compiled.obstructions,
        );
        if !actor.damage.sunk && fire && aligned && state.status == "ready" {
            if actor.controller == Controller::Bot
                && let Some(bot) = actor.bot.as_mut()
            {
                bot.did_fire(m)
            }
            let barrels = state.expend_salvo(m, m.weapon.reload_seconds);
            let w = &m.weapon;
            let spread = w.ballistics.as_ref().map_or(0.0, |b| b.dispersion_rad)
                + (1.0 - mount_support(actor, def, Some(&m.id), None).1) * 0.0015;
            let ammo = if state.loaded == Ammunition::He {
                "HE"
            } else {
                "AP"
            };
            let label = format!(
                "{} mm {ammo} · {}",
                (w.caliber_m * 1000.0).round() as i64,
                if m.battery == "main" {
                    "Main"
                } else {
                    "Secondary"
                }
            );
            for barrel in 0..barrels {
                let position = local_to_world(
                    muzzle_local(m, state.train, state.elevation, barrel),
                    actor.motion.pose(),
                );
                let shot = *ctx.dispersion;
                *ctx.dispersion = ctx.dispersion.wrapping_add(1);
                let direction = dispersed_direction(
                    shot_direction(m, &state, actor.motion.pose()),
                    spread,
                    ctx.seed,
                    shot,
                );
                let speed = dispersed_speed(
                    w.muzzle_speed,
                    w.ballistics
                        .as_ref()
                        .map_or(0.0, |b| b.muzzle_speed_sigma_fraction.unwrap_or(0.0)),
                    ctx.seed,
                    shot,
                );
                let shell_velocity = add(scale(direction, speed), velocity);
                *ctx.sequence += 1;
                let shell = Shell {
                    id: *ctx.sequence,
                    owner_id: actor.motion.id.clone(),
                    weapon_label: Some(label.clone()),
                    position,
                    velocity: shell_velocity,
                    penetration_mm: if state.loaded == Ammunition::He {
                        0.0
                    } else {
                        velocity_penetration(
                            w.penetration_mm,
                            w.ballistics.as_ref().map_or(w.muzzle_speed, |b| {
                                b.penetration_reference_speed_mps.unwrap_or(w.muzzle_speed)
                            }),
                            length(shell_velocity),
                        )
                    },
                    damage: w.damage,
                    caliber_m: w.caliber_m,
                    ammunition: Some(state.loaded),
                    ap: if state.loaded == Ammunition::Ap {
                        w.ap.clone()
                    } else {
                        None
                    },
                    he: if state.loaded == Ammunition::He {
                        w.he.clone()
                    } else {
                        None
                    },
                    drag_per_second: Some(w.ballistics.as_ref().map_or(0.0, |b| b.drag_per_second)),
                    ..Default::default()
                };
                ctx.events.push(DamageEvent {
                    kind: "shot".into(),
                    position,
                    ship_id: actor.motion.id.clone(),
                    message: format!("{} fired", m.name),
                    shell: Some(ShellEffect::from_shell(&shell)),
                    ..Default::default()
                });
                ctx.shells.push(shell);
            }
        }
        actor.mounts[i] = state;
    }
}
