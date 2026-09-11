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
/// Ticks a mount holds its air track before looking for a nearer one. Firing,
/// lead and damage stay per tick; only the search is on this cadence.
pub const AA_SELECT_TICKS: u32 = 6;
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
fn nearer_distance(delta: Vec3, closest: f64) -> Option<f64> {
    // Reject clearly farther aircraft before paying for the scaled hypot/FMA
    // implementation in WASM. Keep a wide rounding margin around the boundary;
    // candidates and ties still use the original norm and strict comparison.
    if dot(delta, delta) > closest * closest * (1.0 + 32.0 * f64::EPSILON) {
        return None;
    }
    let distance = length(delta);
    (distance < closest).then_some(distance)
}
fn clear_lane(actor: &Vessel, from: Vec3, to: Vec3, actors: &[Vessel], air: &Aviation) -> bool {
    let delta = sub(to, from);
    let distance = length(delta);
    let direction = scale(delta, 1.0 / if distance == 0.0 { 1.0 } else { distance });
    !air.iter_planes().any(|p| {
        if p.team != actor.team || !airborne(p) {
            return false;
        }
        let relative = sub(p.position, from);
        let along = dot(relative, direction);
        along > 0.0
            && along < distance
            && nearer_distance(sub(relative, scale(direction, along)), 20.0).is_some()
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
/// A hostile air contact this ship can see, with its position extrapolated to
/// the current tick. The filter behind it costs a string comparison per
/// observation source per contact, and was repeated for every AA mount.
pub struct AirContact<'a> {
    pub track: &'a crate::sensors::ContactTrack,
    pub point: Vec3,
}
/// Contacts every AA mount of this ship would consider, in the order the mount
/// loop saw them. Computed once per ship per tick.
pub fn observable_air<'a>(
    actor: &Vessel,
    k: crate::sensors::Knowledge<'a>,
    out: &mut Vec<AirContact<'a>>,
) {
    out.clear();
    for c in k.sensors.iter_contacts(actor.team) {
        if c.kind != crate::sensors::ContactKind::Aircraft
            || c.affiliation != crate::sensors::Affiliation::Hostile
            || k.tick.saturating_sub(c.last_observed_tick) > 2 * crate::rules::TICK_RATE
            || !c.sources.iter().any(|s| s.observer_id == actor.motion.id)
        {
            continue;
        }
        out.push(AirContact {
            track: c,
            point: add(
                c.measured_position,
                scale(
                    c.velocity,
                    (k.tick - c.last_observed_tick) as f64 / crate::rules::TICK_RATE as f64,
                ),
            ),
        });
    }
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
    let index = actor
        .definition()
        .mounts
        .iter()
        .position(|mount| mount.id == m.id)
        .unwrap_or(0);
    let mut observable = vec![];
    if let Some(k) = knowledge {
        observable_air(actor, k, &mut observable);
    }
    update_observed_at(
        index,
        actor,
        m,
        state,
        actors,
        air,
        dt,
        seed,
        sequence,
        events,
        knowledge,
        &observable,
    )
}
/// The caller supplies the mount's index and this ship's observable air
/// contacts, both of which were recomputed for every mount.
#[allow(clippy::too_many_arguments)]
pub fn update_observed_at(
    index: usize,
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
    observable: &[AirContact<'_>],
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
    // Hold the chosen track for AA_SELECT_TICKS. Lead, fire, dispersion and
    // damage below still run every tick against its current position; only the
    // search for a better track is on a cadence. A track that dies, leaves
    // range or stops being visible fails the check here and the search runs
    // again on this same tick.
    let held = state.aa_select.is_some_and(|n| n > 0);
    if held && let Some(id) = state.aa_track.as_deref() {
        if let Some(k) = knowledge {
            if let Some(c) = observable.iter().find(|c| c.track.id == id)
                && let Some(d) = nearer_distance(sub(c.point, origin), closest)
                && let Some(resolved) = k.sensors.resolve_contact(actor.team, &c.track.id)
            {
                closest = d;
                target = Some((resolved, c.point, c.track.velocity));
            }
        } else if let Some(p) = air.iter_planes().find(|p| p.id == id)
            && p.hp > 0.0
            && p.team != actor.team
            && airborne(p)
            && !on_flight_deck(p)
            && let Some(d) = nearer_distance(sub(p.position, origin), closest)
        {
            closest = d;
            target = Some((p.id.as_str(), p.position, p.velocity));
        }
    }
    let searched = target.is_none();
    if searched {
        if let Some(k) = knowledge {
            for c in observable {
                if let Some(d) = nearer_distance(sub(c.point, origin), closest)
                    && let Some(id) = k.sensors.resolve_contact(actor.team, &c.track.id)
                {
                    closest = d;
                    target = Some((id, c.point, c.track.velocity));
                }
            }
        } else {
            for p in air.iter_planes() {
                if p.hp <= 0.0 || p.team == actor.team || !airborne(p) || on_flight_deck(p) {
                    continue;
                }
                if let Some(d) = nearer_distance(sub(p.position, origin), closest) {
                    closest = d;
                    target = Some((p.id.as_str(), p.position, p.velocity))
                }
            }
        }
    }
    let target_id = target.map(|(id, _, _)| id.to_owned());
    if searched {
        // Mounts are staggered by a hash of their id so a ship's whole battery
        // does not search on the same tick.
        state.aa_select = Some(if state.aa_select.is_none() {
            gunnery_seed(&state.id, 0) % AA_SELECT_TICKS + 1
        } else {
            AA_SELECT_TICKS
        });
        if state.aa_track.as_deref() != target_id.as_deref() {
            state.aa_track = target_id.clone();
        }
    } else if let Some(n) = state.aa_select.as_mut() {
        *n -= 1;
    }
    let (Some(target_id), Some((_, target_position, target_velocity))) = (target_id, target) else {
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
    let aligned = update_mount_at(
        index,
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
    if !aligned || state.status != MountStatus::Ready {
        return true;
    }
    let muzzle = local_to_world(muzzle_local(m, state, 0), actor.motion.pose());
    if !clear_lane(actor, muzzle, crew_aim, actors, air) {
        state.status = MountStatus::Blocked;
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
            state.status = MountStatus::Blocked;
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
            if clear
                && nearer_distance(
                    sub(endpoint, hit_position),
                    if heavy { 100.0 } else { 45.0 },
                )
                .is_some()
            {
                crate::aircraft_defense::near_fire(actual, position);
            }
            if clear
                && nearer_distance(sub(endpoint, hit_position), if heavy { 14.0 } else { 6.0 })
                    .is_some()
            {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distance_rejection_preserves_the_exact_norm_and_strict_boundary() {
        let mut random = 0x6e617661u32;
        for i in 0..200_000 {
            let mut sample = || {
                random = random.wrapping_mul(1664525).wrapping_add(1013904223);
                (random as f64 / u32::MAX as f64 - 0.5) * 40000.0
            };
            let delta = [sample(), sample(), sample()];
            let norm = length(delta);
            let closest = match i % 4 {
                0 => 3200.0,
                1 => norm,
                2 => f64::from_bits(norm.to_bits() + 1),
                _ => f64::from_bits(norm.to_bits() - 1),
            };
            assert_eq!(
                nearer_distance(delta, closest),
                (norm < closest).then_some(norm)
            );
        }
        for delta in [
            [0.0; 3],
            [1e-200; 3],
            [1e200; 3],
            [f64::INFINITY; 3],
            [f64::NAN; 3],
        ] {
            for closest in [0.0, 1e-199, 1200.0, 1e201, f64::INFINITY] {
                let norm = length(delta);
                assert_eq!(
                    nearer_distance(delta, closest),
                    (norm < closest).then_some(norm)
                );
            }
        }
    }
}
