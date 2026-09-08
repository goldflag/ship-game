use crate::{
    ballistics::{ballistic_step, travel_factor, velocity_penetration},
    burst::burst_shell,
    contacts::{ShipContact, ship_contacts},
    definition::Vec3,
    environment::{Island, TerrainField, first_land_hit},
    geometry::*,
    hull::hull_contains,
    impact::{DamageEvent, ShellEffect, resolve_ship_contact},
    machinery::equipment_pose,
    shell::Shell,
    vessel::Vessel,
};
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProjectileEnd {
    Burst,
    Stopped,
    PassedThrough,
    Splash,
    Expired,
}
fn inside_hull(point: Vec3, actors: &[Vessel], owner: &str) -> bool {
    actors.iter().any(|a| {
        a.motion.id != owner
            && hull_contains(&a.definition().hull, world_to_local(point, a.motion.pose()))
    })
}
/// Every contact splits elapsed time. A single bounded tick can cross air, armor and water.
pub fn advance_projectile(
    shell: &mut Shell,
    actors: &mut [Vessel],
    dt: f64,
    islands: &[Island],
    fields: &[TerrainField],
    surface_at: &impl Fn(f64, f64) -> f64,
) -> (Option<ProjectileEnd>, Vec<DamageEvent>) {
    let mut remaining = dt;
    let mut events = vec![];
    for _ in 0..64 {
        if let Some(l) = &shell.lodged
            && let Some(actor) = actors.iter().find(|a| a.motion.id == l.ship_id)
        {
            let def = actor.definition();
            let mount = l
                .mount_id
                .as_ref()
                .and_then(|id| def.mounts.iter().position(|m| &m.id == id));
            let module = l
                .module_id
                .as_ref()
                .and_then(|id| def.modules.iter().find(|m| &m.id == id));
            let pose = module
                .and_then(|m| equipment_pose(actor, def, m))
                .or_else(|| {
                    mount.map(|i| {
                        let m = &def.mounts[i];
                        Pose {
                            x: m.position[0],
                            y: m.position[1],
                            z: m.position[2],
                            heading: radians(m.bearing_deg) + actor.mounts[i].train,
                            ..Pose::default()
                        }
                    })
                });
            let local = pose.map_or(l.position, |p| local_to_world(l.position, p));
            shell.position = local_to_world(local, actor.motion.pose());
        }
        if shell
            .detonate_at_age
            .is_some_and(|age| shell.age >= age - 1e-10)
        {
            let surface = surface_at(shell.position[0], shell.position[2]);
            let water = shell.position[1] <= surface
                && !inside_hull(shell.position, actors, &shell.owner_id);
            let mut burst = burst_shell(shell, actors);
            if water {
                for e in &mut burst {
                    e.water_burst_y = Some(surface);
                }
            }
            events.extend(burst);
            return (Some(ProjectileEnd::Burst), events);
        }
        if remaining <= 1e-10 {
            return (None, events);
        }
        if shell.age >= 180.0 {
            return (Some(ProjectileEnd::Expired), events);
        }
        let mut horizon = remaining.min(180.0 - shell.age).min(
            shell
                .detonate_at_age
                .map_or(remaining, |age| age - shell.age),
        );
        if shell.lodged.is_some() {
            shell.age += horizon;
            remaining -= horizon;
            continue;
        }
        let from = shell.position;
        let in_water =
            from[1] <= surface_at(from[0], from[2]) && !inside_hull(from, actors, &shell.owner_id);
        if in_water && length(shell.velocity) < 20.0 && shell.detonate_at_age.is_none() {
            return (
                Some(if shell.visited.is_empty() {
                    ProjectileEnd::Splash
                } else {
                    ProjectileEnd::PassedThrough
                }),
                events,
            );
        }
        if in_water {
            let drag =
                1.0_f64.max(length(shell.velocity) * 0.04 * 0.38 / shell.caliber_m.max(0.007));
            shell.water_drag_per_second.get_or_insert(drag);
        }
        let drag = if in_water {
            shell.water_drag_per_second.unwrap()
        } else {
            shell.drag_per_second.unwrap_or(0.0)
        };
        let mut flight = ballistic_step(from, shell.velocity, horizon, drag);
        let mut crosses_sea = false;
        let ends_in_water = flight.0[1] <= surface_at(flight.0[0], flight.0[2]);
        if in_water != ends_in_water && (in_water || from[1] > surface_at(from[0], from[2])) {
            let (mut low, mut high) = (0.0, horizon);
            for _ in 0..40 {
                let mid = (low + high) / 2.0;
                let point = ballistic_step(from, shell.velocity, mid, drag).0;
                if (point[1] <= surface_at(point[0], point[2])) == in_water {
                    low = mid;
                } else {
                    high = mid;
                }
            }
            let crossing = ballistic_step(from, shell.velocity, high, drag);
            if !inside_hull(crossing.0, actors, &shell.owner_id) {
                horizon = high;
                flight = crossing;
                crosses_sea = true;
            }
        }
        let end = flight.0;
        let mut nearest: Option<(usize, ShipContact)> = None;
        for (i, actor) in actors.iter().enumerate() {
            if actor.motion.id == shell.owner_id {
                continue;
            }
            let p = [actor.motion.x, actor.motion.y, actor.motion.z];
            let radius = actor.compiled.shell_radius;
            if !(0..3).all(|i| {
                from[i].min(end[i]) <= p[i] + radius && from[i].max(end[i]) >= p[i] - radius
            }) {
                continue;
            }
            if !segment_overlaps_box(
                world_to_local(from, actor.motion.pose()),
                world_to_local(end, actor.motion.pose()),
                actor.compiled.shell_center,
                actor.compiled.shell_size,
            ) {
                continue;
            }
            if let Some(hit) = ship_contacts(
                shell,
                from,
                end,
                actor,
                actor.definition(),
                &actor.compiled.contacts,
            )
            .into_iter()
            .next()
                && nearest.as_ref().is_none_or(|(_, h)| hit.t < h.t)
            {
                nearest = Some((i, hit));
            }
        }
        if let Some((t, point)) = first_land_hit(islands, fields, from, end)
            && nearest.as_ref().is_none_or(|(_, h)| t < h.t)
        {
            shell.position = point;
            events.push(DamageEvent {
                kind: "stopped".into(),
                position: point,
                message: "Shell struck the coast".into(),
                normal: Some([0.0, 1.0, 0.0]),
                shell: Some(ShellEffect::from_shell(shell)),
                ..Default::default()
            });
            return (Some(ProjectileEnd::Stopped), events);
        }
        if let Some((i, hit)) = nearest {
            let elapsed = if drag > 1e-9 {
                -(-drag * hit.t * travel_factor(horizon, drag)).ln_1p() / drag
            } else {
                horizon * hit.t
            };
            let at_hit = ballistic_step(from, shell.velocity, elapsed, drag);
            shell.penetration_mm = velocity_penetration(
                shell.penetration_mm,
                length(shell.velocity),
                length(at_hit.1),
            );
            shell.velocity = at_hit.1;
            shell.age += elapsed;
            remaining -= elapsed;
            let actor = &mut actors[i];
            let compiled = actor.compiled.clone();
            shell.position = local_to_world(hit.point, actor.motion.pose());
            let (stopped, event) =
                resolve_ship_contact(shell, &hit, actor, &compiled.definition, None);
            events.push(event);
            if stopped && shell.lodged.is_none() && shell.detonate_at_age.is_none() {
                return (Some(ProjectileEnd::Stopped), events);
            }
            continue;
        }
        shell.penetration_mm = velocity_penetration(
            shell.penetration_mm,
            length(shell.velocity),
            length(flight.1),
        );
        shell.velocity = flight.1;
        shell.position = end;
        shell.age += horizon;
        remaining -= horizon;
        if crosses_sea && in_water {
            shell.position[1] = surface_at(end[0], end[2]) + 1e-7;
            shell.water_drag_per_second = None;
        } else if crosses_sea {
            shell.position[1] = surface_at(end[0], end[2]) - 1e-7;
            events.push(DamageEvent {
                kind: "splash".into(),
                position: [end[0], surface_at(end[0], end[2]), end[2]],
                message: "Shell entering water".into(),
                shell: Some(ShellEffect::from_shell(shell)),
                ..Default::default()
            });
            if shell.he.is_some() {
                shell.detonate_at_age = Some(shell.age);
                continue;
            }
            let before = length(shell.velocity);
            shell.velocity = scale(shell.velocity, 0.75);
            shell.penetration_mm =
                velocity_penetration(shell.penetration_mm, before, length(shell.velocity));
            shell.water_drag_per_second = Some(
                1.0_f64.max(length(shell.velocity) * 0.04 * 0.38 / shell.caliber_m.max(0.007)),
            );
            if let Some(ap) = &shell.ap
                && shell.detonate_at_age.is_none()
                && shell.velocity[1].abs() / length(shell.velocity) > 0.15
            {
                shell.detonate_at_age = Some(shell.age + ap.fuze_delay_seconds);
            }
        }
    }
    (Some(ProjectileEnd::Expired), events)
}
