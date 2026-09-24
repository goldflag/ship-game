//! Grounding: hulls against the map's terrain. A hull point at or below the ground
//! (`Terrain::height`, the sea floor included) puts the ship aground; the contact
//! point's escape direction is the push-out normal, the closing speed along it
//! scores contact damage, and the ship is moved out along it until every point
//! clears.
use crate::{
    collisions::{HullImpact, damage_hull_contact},
    definition::{Hull, Vec3},
    hull::interpolate,
    terrain::Terrain,
    vessel::Vessel,
};

/// Ship-local points that can touch the ground: three across each keel station of
/// an authored hull, or every vertex of a downward-facing constructed surface.
pub fn ground_points(hull: &Hull) -> Vec<Vec3> {
    if let Some(v) = &hull.volume {
        return v
            .surfaces
            .iter()
            .filter(|s| s.normal[1] < 0.)
            .flat_map(|s| s.vertices.iter().copied())
            .collect();
    }
    hull.keel_heights
        .iter()
        .flat_map(|[station, keel]| {
            [-0.6, 0.0, 0.6].map(|side| {
                [
                    side * interpolate(&hull.half_breadths, *station),
                    *keel,
                    hull.length / 2.0 - station,
                ]
            })
        })
        .collect()
}

/// Largest push-out tried, metres: only a hull placed deep inland needs more.
const MAX_PUSH_M: f64 = 4096.0;

pub fn resolve_land_contact(actor: &mut Vessel, terrain: &Terrain) -> Vec<HullImpact> {
    if !terrain.has_land() {
        return vec![];
    }
    let compiled = actor.compiled.clone();
    let hull = &compiled.definition.hull;
    let basis = actor.motion.basis();
    // The hull's transformed bounding box: when its lowest corner clears the
    // highest ground under its footprint, no point can be aground.
    let [low, high] = compiled.ground_box;
    let (mut floor, mut x0, mut z0, mut x1, mut z1) = (
        f64::INFINITY,
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    );
    for corner in 0..8 {
        let local = std::array::from_fn(|i| {
            if corner >> i & 1 == 0 {
                low[i]
            } else {
                high[i]
            }
        });
        let p = basis.local_to_world(local);
        floor = floor.min(p[1]);
        (x0, z0, x1, z1) = (x0.min(p[0]), z0.min(p[2]), x1.max(p[0]), z1.max(p[2]));
    }
    if terrain.highest(x0, z0, x1, z1) < floor {
        return vec![];
    }
    let points: Vec<Vec3> = compiled
        .ground_points
        .iter()
        .map(|p| basis.local_to_world(*p))
        .collect();
    let bottom = |x: f64, z: f64| terrain.height(x, z);
    let Some(position) = points.iter().find(|p| bottom(p[0], p[2]) >= p[1]).copied() else {
        return vec![];
    };
    // Away from the coast at the contact. A contact already up on the land has
    // its own nearest land sample underfoot, so a hull still afloat amidships
    // takes the way out from its centre instead.
    let from = if bottom(position[0], position[2]) > 0.0
        && bottom(actor.motion.x, actor.motion.z) <= 0.0
    {
        [actor.motion.x, actor.motion.z]
    } else {
        [position[0], position[2]]
    };
    let [nx, nz] = terrain.escape(from[0], from[1]);
    let mut impacts = vec![];
    // Contact energy and the body-speed round trip below use physical motion.
    let ship = &actor.motion;
    let velocity = ship.physical_velocity();
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
    let clear = |offset: f64| {
        points
            .iter()
            .all(|p| bottom(p[0] + nx * offset, p[2] + nz * offset) < p[1] - 0.02)
    };
    // Bracket the push-out, then bisect it as finely as before.
    let mut high = 8.0;
    while high < MAX_PUSH_M && !clear(high) {
        high *= 2.0;
    }
    let mut low = 0.0;
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
    impacts
}
