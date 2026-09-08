use crate::{
    contacts::{ContactKind, contact_armor, ship_contacts},
    damage_control::{heat_module, heat_mount, heat_room},
    definition::Vec3,
    geometry::*,
    hull::hull_contains,
    impact::{DamageEvent, ImpactRecord, ShellEffect},
    machinery::{equipment_box, equipment_pose},
    protection::plate_response,
    shell::{Shell, damage_shell_hull, local_damage_evidence},
    vessel::Vessel,
};
#[derive(Clone, Copy, PartialEq, Eq)]
enum TargetKind {
    Module,
    Mount,
    Boundary,
    Room,
}
struct Target {
    kind: TargetKind,
    index: usize,
    id: String,
    name: String,
    point: Vec3,
    distance: f64,
}
fn nearest(point: Vec3, center: Vec3, size: Vec3) -> Vec3 {
    std::array::from_fn(|i| {
        clamp(
            point[i],
            center[i] - size[i] / 2.0,
            center[i] + size[i] / 2.0,
        )
    })
}
/// Bounded protected target rays. Every intervening ship can shield blast and fragments.
pub fn burst_shell(shell: &mut Shell, actors: &mut [Vessel]) -> Vec<DamageEvent> {
    let Some((explosive, fragment)) = shell
        .he
        .as_ref()
        .map(|c| (c.explosive_kg, c.fragment_penetration_mm))
        .or_else(|| {
            shell
                .ap
                .as_ref()
                .map(|c| (c.explosive_kg, c.fragment_penetration_mm))
        })
    else {
        return vec![];
    };
    let name = if shell.he.is_some() { "HE" } else { "AP" };
    let radius = clamp(3.0 * explosive.cbrt(), 0.5, 15.0);
    let mut rays = 0;
    let mut burst_ship = shell
        .lodged
        .as_ref()
        .map(|l| l.ship_id.clone())
        .or_else(|| shell.last_hit_ship_id.clone())
        .unwrap_or_default();
    let effect = ShellEffect::from_shell(shell);
    let position = shell.position;
    let mut events = vec![];
    let shields: Vec<_> = actors
        .iter()
        .enumerate()
        .filter(|(_, a)| {
            let p = world_to_local(position, a.motion.pose());
            p[0].abs() <= a.definition().hull.beam / 2.0 + radius + 15.0
                && p[2].abs() <= a.definition().hull.length / 2.0 + radius + 20.0
        })
        .map(|(i, _)| i)
        .collect();
    for &ai in &shields {
        let actor = &actors[ai];
        let def = actor.definition();
        let origin = world_to_local(position, actor.motion.pose());
        let mut targets = vec![];
        let mut target = |kind, index, id: String, name: String, point| {
            let distance = length(sub(point, origin));
            if distance < radius {
                targets.push(Target {
                    kind,
                    index,
                    id,
                    name,
                    point,
                    distance,
                });
            }
        };
        for (i, m) in def.modules.iter().enumerate() {
            let pose = equipment_pose(actor, def, m);
            let (center, size) = equipment_box(def, m);
            let local = pose.map_or(origin, |p| world_to_local(origin, p));
            let point = nearest(local, center, size);
            target(
                TargetKind::Module,
                i,
                m.id.clone(),
                m.name.clone(),
                pose.map_or(point, |p| local_to_world(point, p)),
            );
        }
        for (i, r) in def.compartments.iter().enumerate() {
            if actor.damage.control.rooms[i].fuel > 0.0
                && !def
                    .modules
                    .iter()
                    .any(|m| m.compartment_id.as_ref() == Some(&r.id))
            {
                target(
                    TargetKind::Room,
                    i,
                    r.id.clone(),
                    r.name.clone(),
                    nearest(origin, r.center, r.size),
                );
            }
        }
        for (i, m) in def.mounts.iter().enumerate() {
            target(
                TargetKind::Mount,
                i,
                m.id.clone(),
                m.name.clone(),
                [
                    m.position[0],
                    m.position[1] + m.weapon.gunhouse_size[2] / 2.0,
                    m.position[2],
                ],
            );
        }
        for (i, c) in def.connections.iter().enumerate() {
            if c.thickness_mm.is_some()
                && actor.damage.connections[i].state != "open"
                && let Some(b) = &c.bounds
            {
                target(
                    TargetKind::Boundary,
                    i,
                    actor.damage.connections[i].id.clone(),
                    "Watertight boundary".into(),
                    nearest(origin, b.center, b.size),
                );
            }
        }
        targets.sort_by(|a, b| {
            a.distance
                .total_cmp(&b.distance)
                .then_with(|| a.id.cmp(&b.id))
        });
        for target in targets {
            if rays >= 128 {
                break;
            }
            rays += 1;
            let mut budget = fragment;
            let mut blocked = false;
            let mut probe = shell.clone();
            probe.visited.clear();
            let destination = local_to_world(target.point, actors[ai].motion.pose());
            for &si in &shields {
                let shield = &actors[si];
                let protection = shield.definition();
                let from = world_to_local(position, shield.motion.pose());
                let to = world_to_local(destination, shield.motion.pose());
                if !segment_overlaps_box(
                    from,
                    to,
                    shield.compiled.shell_center,
                    shield.compiled.shell_size,
                ) {
                    continue;
                }
                let direction = normalize(sub(to, from));
                for hit in ship_contacts(
                    &probe,
                    position,
                    destination,
                    shield,
                    protection,
                    &shield.compiled.contacts,
                ) {
                    if hit.kind == ContactKind::Module {
                        let module = &protection.modules[hit.index as usize];
                        let own = si == ai
                            && target.kind == TargetKind::Module
                            && hit.index as usize == target.index;
                        if own {
                            let pose = equipment_pose(shield, protection, module);
                            let (center, size) = equipment_box(protection, module);
                            let local = pose.map_or(origin, |p| world_to_local(origin, p));
                            if module.protection_mm.is_none()
                                || (0..3)
                                    .all(|i| (local[i] - center[i]).abs() < size[i] / 2.0 - 1e-6)
                            {
                                continue;
                            }
                        }
                        let resistance = module.protection_mm.unwrap_or(50.0);
                        budget -= resistance;
                        blocked |= resistance > 0.0;
                    } else {
                        let armor = (hit.kind == ContactKind::Armor)
                            .then(|| contact_armor(protection, &hit));
                        let thickness = armor.as_ref().map_or_else(
                            || {
                                if hit.kind == ContactKind::Mount {
                                    protection.mounts[hit.index as usize].weapon.armor_mm
                                } else {
                                    protection.connections[hit.index as usize]
                                        .thickness_mm
                                        .unwrap()
                                }
                            },
                            |a| a.thickness_mm,
                        );
                        let incidence = if target.distance > 1e-8 && length(hit.normal) > 0.0 {
                            dot(direction, hit.normal).abs()
                        } else {
                            1.0
                        };
                        let material = armor
                            .as_ref()
                            .and_then(|a| a.plate.as_ref())
                            .map_or("steel", |p| p.material.as_str());
                        let response = plate_response(thickness, material, incidence, 0.01);
                        budget -= response.resistance_mm;
                        blocked |= response.resistance_mm > 0.0;
                    }
                    if budget <= 0.0 {
                        break;
                    }
                }
                if budget <= 0.0 {
                    break;
                }
            }
            if budget <= 0.0 {
                continue;
            }
            let exposure = if blocked {
                0.35 * budget / fragment
            } else {
                1.0
            };
            let amount = shell
                .he
                .as_ref()
                .map_or(shell.damage * 0.75, |he| he.damage)
                * (1.0 - target.distance / radius)
                * exposure;
            let actor = &mut actors[ai];
            let compiled = actor.compiled.clone();
            let def = &compiled.definition;
            let mut damage = 0.0;
            let mut connection_ids = None;
            match target.kind {
                TargetKind::Room => {
                    heat_room(actor, def, target.index, amount);
                    continue;
                }
                TargetKind::Module => {
                    let state = &mut actor.damage.modules[target.index];
                    damage = state.hp.min(amount);
                    state.hp -= damage;
                    heat_module(actor, def, target.index, amount);
                }
                TargetKind::Mount => {
                    let state = &mut actor.mounts[target.index];
                    damage = state.hp.min(amount);
                    state.hp -= damage;
                    heat_mount(actor, target.index, amount);
                }
                TargetKind::Boundary => {
                    let state = &mut actor.damage.connections[target.index];
                    state.state = "damaged".into();
                    state.damage_area_m2 = def.connections[target.index].area_m2.min(
                        state.damage_area_m2
                            + shell.caliber_m.powi(2) * (1.0 - target.distance / radius) * exposure,
                    );
                    connection_ids = Some(vec![state.id.clone()]);
                }
            }
            if damage == 0.0 && connection_ids.is_none() {
                continue;
            }
            if burst_ship.is_empty() {
                burst_ship = actor.motion.id.clone();
            }
            let local = local_damage_evidence(
                actor,
                def,
                target.point,
                (target.kind == TargetKind::Mount).then_some(target.id.as_str()),
                (target.kind == TargetKind::Module).then_some(target.id.as_str()),
            );
            let hull_damage = if damage > 0.0 {
                let total = shell.he.as_ref().map_or(
                    shell.damage * 0.85 * (damage / (shell.damage * 0.75)).min(1.0),
                    |he| he.damage.min(damage) * 0.5,
                );
                damage_shell_hull(shell, actor, total, local.as_ref())
            } else {
                0.0
            };
            events.push(DamageEvent {
                kind: "burst".into(),
                position,
                message: format!("{name} burst · {}", target.name),
                ship_id: actor.motion.id.clone(),
                shell: Some(effect.clone()),
                impact: Some(ImpactRecord {
                    shell_id: shell.id,
                    ship_id: actor.motion.id.clone(),
                    target_id: target.id,
                    target_name: target.name,
                    kind: match target.kind {
                        TargetKind::Module => "module",
                        TargetKind::Mount => "mount",
                        TargetKind::Boundary => "boundary",
                        TargetKind::Room => "room",
                    }
                    .into(),
                    position: target.point,
                    penetration_before_mm: fragment,
                    penetration_after_mm: budget.max(0.0),
                    outcome: "damaged".into(),
                    damage: Some(damage),
                    hull_damage: Some(hull_damage),
                    local_damage: local,
                    through_wreckage: Some(shell.wreckage_ships.contains(&actor.motion.id)),
                    connection_ids,
                    fuze: Some("armed".into()),
                    fuze_remaining_seconds: Some(0.0),
                    ..Default::default()
                }),
                ..Default::default()
            });
        }
    }
    let actor = actors.iter_mut().find(|a| a.motion.id == burst_ship);
    let mut hull_damage = 0.0;
    let mut local = position;
    let inside = actor.is_some();
    if let Some(actor) = actor {
        local = world_to_local(position, actor.motion.pose());
        let penetrated = shell
            .hull_damage
            .get(&actor.motion.id)
            .copied()
            .unwrap_or(0.0)
            > 0.0
            || shell.hull_region_damage.iter().any(|(key, amount)| {
                key.starts_with(&format!("{}:", actor.motion.id)) && *amount > 0.0
            });
        if shell.ap.is_some() && penetrated && hull_contains(&actor.definition().hull, local) {
            let evidence = local_damage_evidence(actor, actor.definition(), local, None, None);
            hull_damage = damage_shell_hull(shell, actor, shell.damage * 0.65, evidence.as_ref());
        }
    }
    events.push(DamageEvent {
        kind: "burst".into(),
        position,
        message: format!("{name} shell burst"),
        ship_id: burst_ship.clone(),
        shell: Some(effect),
        detonation: Some(true),
        blast_radius_m: Some(radius),
        impact: Some(ImpactRecord {
            shell_id: shell.id,
            ship_id: burst_ship,
            target_id: format!("{}-burst", name.to_lowercase()),
            target_name: if inside {
                format!("{name} shell burst")
            } else {
                "Burst outside ship".into()
            },
            kind: "burst".into(),
            position: local,
            penetration_before_mm: shell.penetration_mm,
            penetration_after_mm: 0.0,
            outcome: "detonation".into(),
            hull_damage: Some(hull_damage),
            terminal: Some(true),
            fuze: Some("armed".into()),
            fuze_remaining_seconds: Some(0.0),
            ..Default::default()
        }),
        ..Default::default()
    });
    events
}
