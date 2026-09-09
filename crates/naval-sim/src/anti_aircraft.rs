use crate::{
    air_gunnery::*,
    aircraft::{airborne, on_flight_deck},
    aviation::Aviation,
    ballistics::*,
    definition::{MountDefinition, ShipDefinition, Vec3},
    geometry::*,
    impact::{AirburstEffect, AircraftEffect, DamageEvent},
    machinery::mount_support,
    vessel::{Controller, Vessel},
    weapons::*,
};
pub fn range(m: &MountDefinition) -> f64 {
    let w = &m.weapon;
    if w.elevation_max_deg < 70.0 || w.caliber_m > 0.14 {
        0.0
    } else if w.caliber_m > 0.08 {
        3200.0
    } else if w.caliber_m > 0.025 {
        1800.0
    } else {
        1200.0
    }
}
pub fn surface_allowed(d: &ShipDefinition, m: &MountDefinition) -> bool {
    m.weapon.caliber_m > 0.08 || !d.mounts.iter().any(|m| m.weapon.caliber_m > 0.08)
}
fn clear_lane(actor: &Vessel, from: Vec3, to: Vec3, actors: &[Vessel], air: &Aviation) -> bool {
    let delta = sub(to, from);
    let distance = length(delta);
    let direction = normalize(delta);
    !air.planes().iter().any(|p| {
        if p.team != actor.team || !airborne(p) {
            return false;
        }
        let relative = sub(p.position, from);
        let along = dot(relative, direction);
        along > 0.0 && along < distance && length(sub(relative, scale(direction, along))) < 20.0
    }) && !actors.iter().any(|f| {
        f.motion.id != actor.motion.id && f.team == actor.team && !f.damage.sunk && {
            let h = &f.definition().hull;
            segment_box(
                world_to_local(from, f.motion.pose()),
                world_to_local(to, f.motion.pose()),
                [0.0, (h.depth - 2.0 * h.draft) / 2.0, 0.0],
                [h.beam, h.depth, h.length],
            )
            .is_some()
        }
    })
}
/// The state is detached from the actor during this call. AA claims at most one
/// update of a mount; the surface path advances it only if this returns false.
#[allow(clippy::too_many_arguments)]
pub fn update(
    actor: &Vessel,
    m: &MountDefinition,
    state: &mut MountState,
    actors: &[Vessel],
    air: &mut Aviation,
    dt: f64,
    seed: u32,
    sequence: &mut i64,
    events: &mut Vec<DamageEvent>,
) -> bool {
    update_observed(
        actor, m, state, actors, air, dt, seed, sequence, events, None,
    )
}
#[allow(clippy::too_many_arguments)]
pub fn update_observed(
    actor: &Vessel,
    m: &MountDefinition,
    state: &mut MountState,
    actors: &[Vessel],
    air: &mut Aviation,
    dt: f64,
    seed: u32,
    sequence: &mut i64,
    events: &mut Vec<DamageEvent>,
    knowledge: Option<crate::sensors::Knowledge<'_>>,
) -> bool {
    let reach = range(m);
    if reach == 0.0
        || actor.damage.sunk
        || actor.damage.stability.combat_lost
        || actor.motion.mean_y() < -1.0
        || state.hp <= 0.0
        || state.ammo <= 0.0
        || actor.controller == Controller::Bot
            && actor.bot.as_ref().is_some_and(|b| b.ai_level.passive())
    {
        return false;
    }
    let origin = local_to_world(muzzle_local(m, state, 0), actor.motion.pose());
    let mut closest = reach;
    let mut target = None;
    if let Some(k) = knowledge {
        for c in k.sensors.contacts(actor.team) {
            if c.kind != crate::sensors::ContactKind::Aircraft
                || c.affiliation != crate::sensors::Affiliation::Hostile
                || k.tick.saturating_sub(c.last_observed_tick) > 2 * crate::rules::TICK_RATE
                || !c.sources.iter().any(|s| s.observer_id == actor.motion.id)
            {
                continue;
            }
            let point = add(
                c.measured_position,
                scale(
                    c.velocity,
                    (k.tick - c.last_observed_tick) as f64 / crate::rules::TICK_RATE as f64,
                ),
            );
            let d = length(sub(point, origin));
            if d < closest
                && let Some(id) = k.sensors.resolve_contact(actor.team, &c.id)
            {
                closest = d;
                target = Some((id.to_owned(), point, c.velocity));
            }
        }
    } else {
        for p in air.planes() {
            if p.hp <= 0.0 || p.team == actor.team || !airborne(p) || on_flight_deck(p) {
                continue;
            }
            let d = length(sub(p.position, origin));
            if d < closest {
                closest = d;
                target = Some((p.id.clone(), p.position, p.velocity))
            }
        }
    }
    let Some((target_id, target_position, target_velocity)) = target else {
        if let Some(s) = state.aa_discipline.as_mut() {
            step_discipline(s, dt, 0.0, 0, false)
        }
        return false;
    };
    let discipline = state.aa_discipline.get_or_insert_with(Default::default);
    let inbound = dot(target_velocity, sub(origin, target_position)) > 0.0;
    let pressure = 1.0 - state.hp / 100.0
        + if inbound {
            (1.0 - closest / 1500.0).max(0.0)
        } else {
            0.0
        };
    step_discipline(
        discipline,
        dt,
        pressure,
        gunnery_seed(&format!("{}:{}", actor.motion.id, m.id), seed),
        true,
    );
    let panic = discipline.panic;
    let flight_time = closest / m.weapon.muzzle_speed;
    let aim = add(target_position, scale(target_velocity, flight_time));
    let crew_aim = if panic {
        panic_aim(origin, target_position, discipline)
    } else {
        aim
    };
    let barrels = m.weapon.barrel_count.unwrap_or(2.0) as usize;
    if state.available(state.loaded) < barrels as f64 {
        state.select_ammunition(
            m,
            if state.loaded == Ammunition::Ap {
                Ammunition::He
            } else {
                Ammunition::Ap
            },
        )
    }
    let velocity = actor.motion.velocity();
    let (power, fire_control) = mount_support(actor, actor.definition(), Some(&m.id), None);
    let aligned = update_mount(
        m,
        state,
        actor.definition(),
        &actor.motion,
        Some(crew_aim),
        dt,
        velocity,
        power,
        &actor.compiled.obstructions,
        &actor.mounts,
    );
    if !aligned || state.status != "ready" {
        return true;
    }
    let muzzle = local_to_world(muzzle_local(m, state, 0), actor.motion.pose());
    if !clear_lane(actor, muzzle, crew_aim, actors, air) {
        state.status = "blocked".into();
        return true;
    }
    let heavy = m.weapon.caliber_m > 0.08;
    let burst_time = state.aim_cache.as_ref().map_or(flight_time, |c| c.time);
    let drag = m
        .weapon
        .ballistics
        .as_ref()
        .map_or(0.0, |b| b.drag_per_second);
    let mut shots = vec![];
    for barrel in 0..barrels {
        let position = local_to_world(muzzle_local(m, state, barrel), actor.motion.pose());
        *sequence += 1;
        let direction = dispersed_direction(
            shot_direction(m, state, actor.motion.pose()),
            aa_spread(closest) + (1.0 - fire_control) * 0.0015,
            seed,
            *sequence as u32,
        );
        let (endpoint, _) = ballistic_step(
            position,
            add(scale(direction, m.weapon.muzzle_speed), velocity),
            burst_time,
            drag,
        );
        if !clear_lane(actor, position, endpoint, actors, air) {
            state.status = "blocked".into();
            return true;
        }
        shots.push((position, direction, endpoint));
    }
    state.expend_salvo(m, m.weapon.reload_seconds.max(0.35));
    for (position, direction, endpoint) in shots {
        if let Some(actual) = air.plane_mut(&target_id) {
            let hit_position = if knowledge.is_some() {
                add(actual.position, scale(actual.velocity, burst_time))
            } else {
                aim
            };
            let clear = knowledge.is_none_or(|k| {
                crate::sensors::line_visible(position, actual.position, k.islands, k.terrain)
            });
            if clear && length(sub(endpoint, hit_position)) < if heavy { 14.0 } else { 6.0 } {
                actual.hp -= aa_damage(m.weapon.caliber_m);
            }
        }
        events.push(DamageEvent {
            kind: "aircraft-fire".into(),
            ship_id: actor.motion.id.clone(),
            position,
            message: format!("{} · AA fire", m.name),
            aircraft: Some(AircraftEffect {
                id: target_id.clone(),
                caliber_m: Some(m.weapon.caliber_m),
                target: Some(endpoint),
                tracer_speed: Some(m.weapon.muzzle_speed),
                direction: Some(direction),
                velocity: Some(velocity),
                panic: Some(panic),
                drag_per_second: Some(drag),
                airburst: heavy.then_some(AirburstEffect {
                    flight_time: burst_time,
                    caliber_m: m.weapon.caliber_m,
                }),
                ..Default::default()
            }),
            ..Default::default()
        });
    }
    true
}
