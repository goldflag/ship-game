use crate::{
    collisions::{HullImpact, damage_hull_contact},
    environment::{Island, TerrainField},
    geometry::local_to_world,
    hull::interpolate,
    vessel::Vessel,
};
pub fn resolve_land_contact(
    actor: &mut Vessel,
    islands: &[Island],
    fields: &[TerrainField],
) -> Vec<HullImpact> {
    let compiled = actor.compiled.clone();
    let hull = &compiled.definition.hull;
    let mut impacts = vec![];
    for island in islands {
        let ship = &actor.motion;
        if ((ship.x - island.x) / (island.rx + hull.length))
            .hypot((ship.z - island.z) / (island.rz + hull.length))
            > 1.3
        {
            continue;
        }
        let field = fields
            .iter()
            .find(|f| f.seed == island.seed && f.style == island.style)
            .expect("validated terrain");
        let bottom = |x, z| {
            let radius = island.radius(x, z);
            if radius >= 1.0 {
                ((1.0 - radius) * 500.0).max(-1000.0)
            } else {
                island.height_at(field, x, z).max(-45.0)
            }
        };
        let points: Vec<_> = hull
            .keel_heights
            .iter()
            .flat_map(|[station, keel]| {
                [-0.6, 0.0, 0.6].map(|side| {
                    local_to_world(
                        [
                            side * interpolate(&hull.half_breadths, *station),
                            *keel,
                            hull.length / 2.0 - station,
                        ],
                        ship.pose(),
                    )
                })
            })
            .collect();
        let Some(position) = points.iter().find(|p| bottom(p[0], p[2]) >= p[1]).copied() else {
            continue;
        };
        let (dx, dz) = (position[0] - island.x, position[2] - island.z);
        let distance = dx.hypot(dz);
        let (nx, nz) = if distance > 1e-6 {
            (dx / distance, dz / distance)
        } else {
            (1.0, 0.0)
        };
        let velocity = ship.velocity();
        let inward = -(velocity[0] * nx + velocity[2] * nz);
        if inward > 0.75 {
            let damage = damage_hull_contact(
                actor,
                &compiled.definition,
                position,
                0.5 * hull.mass_kg * inward.powi(2),
            );
            if damage > 0.0 {
                impacts.push(HullImpact {
                    actor_id: actor.motion.id.clone(),
                    other_id: None,
                    position,
                    damage,
                    kind: "grounding".into(),
                });
            }
        }
        let ship = &mut actor.motion;
        if inward > 0.0 {
            let vx = velocity[0] + nx * inward - ship.drift_x;
            let vz = velocity[2] + nz * inward - ship.drift_z;
            ship.speed = ship.heading.sin() * vx - ship.heading.cos() * vz;
            ship.sway_speed = ship.heading.cos() * vx + ship.heading.sin() * vz;
            if ship.speed.abs() < 1e-9 {
                ship.speed = 0.0;
            }
            if ship.sway_speed.abs() < 1e-9 {
                ship.sway_speed = 0.0;
            }
        }
        let clear = |offset| {
            points
                .iter()
                .all(|p| bottom(p[0] + nx * offset, p[2] + nz * offset) < p[1] - 0.02)
        };
        let (mut low, mut high) = (0.0, island.rx.max(island.rz) * 3.0 + hull.length);
        for _ in 0..24 {
            let mid = (low + high) / 2.0;
            if clear(mid) {
                high = mid;
            } else {
                low = mid;
            }
        }
        ship.x += nx * high;
        ship.z += nz * high;
    }
    impacts
}
