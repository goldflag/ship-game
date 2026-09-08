use crate::{
    damage::Combatant,
    definition::ShipDefinition,
    environment::{SeaResponse, SeaState},
    geometry::*,
    hydrostatics::HullHydrostatics,
    machinery::electrical_power,
    stability::{update_sinking, update_stability, water_level},
};
fn sign(n: f64) -> f64 {
    if n == 0.0 { 0.0 } else { n.signum() }
}
/// Sequential connection transfers conserve water; all sea pressure comes from CPU samples.
pub fn update_flooding(
    actor: &mut Combatant,
    def: &ShipDefinition,
    hydro: &HullHydrostatics,
    dt: f64,
    response: Option<SeaResponse>,
    sea: Option<(&SeaState, f64)>,
) {
    if dt <= 0.0 {
        return;
    }
    if !actor.damage.sunk && actor.damage.integrity <= 0.0 {
        actor.damage.sunk = true;
        actor.damage.defeat_cause = Some("hull-failure".into());
    }
    update_stability(actor, def, hydro, dt, response);
    let power = if def.compartments.iter().any(|c| c.pump_m3_per_second > 0.0) {
        electrical_power(actor, def, sea)
    } else {
        0.0
    };
    for (i, c) in def.compartments.iter().enumerate() {
        let internal = water_level(actor, def, i, None);
        let inflow: f64 = actor.damage.compartments[i]
            .breaches
            .iter()
            .map(|b| {
                let world = local_to_world(b.position, actor.motion.pose());
                let surface = sea.map_or(0.0, |(s, t)| s.height(world[0], world[2], t));
                let bottom = world[1] - surface - b.radius_m;
                let top = world[1] - surface + b.radius_m;
                let internal = internal - surface;
                let mut cuts = vec![bottom, top];
                cuts.extend(
                    [0.0, internal]
                        .into_iter()
                        .filter(|y| *y > bottom && *y < top),
                );
                cuts.sort_by(f64::total_cmp);
                let mut flow = 0.0;
                for cut in cuts.windows(2) {
                    let (a, b) = (cut[0], cut[1]);
                    let mid = (a + b) / 2.0;
                    if mid < 0.0_f64.min(internal) {
                        flow += sign(-internal) * internal.abs().sqrt() * (b - a);
                    } else if mid < 0.0_f64.max(internal) {
                        let surface = internal.max(0.0);
                        let sign = if internal > 0.0 { -1.0 } else { 1.0 };
                        flow += sign * 2.0 / 3.0
                            * ((surface - a).max(0.0).powf(1.5) - (surface - b).max(0.0).powf(1.5));
                    }
                }
                0.6 * b.area_m2 / (2.0 * b.radius_m) * (2.0_f64 * 9.81).sqrt() * flow
            })
            .sum();
        let pumping = if actor.damage.sunk {
            0.0
        } else {
            c.pump_m3_per_second * power + actor.damage.control.pumping[i]
        };
        let state = &mut actor.damage.compartments[i];
        state.water_m3 = clamp(state.water_m3 + (inflow - pumping) * dt, 0.0, c.capacity_m3);
    }
    for (i, c) in def.connections.iter().enumerate() {
        let state = &actor.damage.connections[i];
        if state.state == "closed" {
            continue;
        }
        let (ai, bi) = (state.from_index, state.to_index);
        let (a, b) = (
            actor.damage.compartments[ai].water_m3,
            actor.damage.compartments[bi].water_m3,
        );
        let portal = c.position.map_or(f64::NEG_INFINITY, |p| {
            local_to_world(p, actor.motion.pose())[1]
        });
        let head = |a: f64, b: f64| {
            if c.position.is_some() {
                (a - portal).max(0.0) - (b - portal).max(0.0)
            } else {
                a - b
            }
        };
        let difference = head(
            water_level(actor, def, ai, None),
            water_level(actor, def, bi, None),
        );
        let area = if state.state == "damaged" {
            state.damage_area_m2
        } else {
            c.area_m2
        };
        let direction = sign(difference);
        let mut requested = (0.6 * area * (2.0 * 9.81 * difference.abs()).sqrt() * dt)
            .min(if direction > 0.0 { a } else { b })
            .min(if direction > 0.0 {
                def.compartments[bi].capacity_m3 - b
            } else {
                def.compartments[ai].capacity_m3 - a
            });
        let remaining = |transfer| {
            direction
                * head(
                    water_level(actor, def, ai, Some(a - direction * transfer)),
                    water_level(actor, def, bi, Some(b + direction * transfer)),
                )
        };
        if requested > 0.0 && remaining(requested) < 0.0 {
            let (mut low, mut high) = (0.0, requested);
            for _ in 0..28 {
                let mid = (low + high) / 2.0;
                if remaining(mid) >= 0.0 {
                    low = mid;
                } else {
                    high = mid;
                }
            }
            requested = low;
        }
        actor.damage.compartments[ai].water_m3 -= direction * requested;
        actor.damage.compartments[bi].water_m3 += direction * requested;
    }
    let water: f64 = actor.damage.compartments.iter().map(|c| c.water_m3).sum();
    if def.stability.is_none() {
        if !actor.damage.sunk && water >= def.hull.reserve_buoyancy_m3 {
            actor.damage.defeat_cause.get_or_insert("flooding".into());
            actor.damage.sunk = true;
        }
        if actor.submarine.is_none() && !actor.damage.sunk {
            actor.motion.y = -water / def.hull.waterplane_area_m2;
        }
        let mass = def.hull.mass_kg + water * 1000.0;
        let moment = |axis| {
            actor
                .damage
                .compartments
                .iter()
                .zip(&def.compartments)
                .map(|(c, r)| c.water_m3 * 1000.0 * r.center[axis])
                .sum::<f64>()
        };
        let roll = clamp(-moment(0) / mass * 0.5, -0.45, 0.45);
        let pitch = clamp(moment(2) / mass * 0.02, -0.2, 0.2);
        let blend = if actor.damage.sunk {
            1.0 - (-dt / 4.0).exp()
        } else {
            1.0
        };
        actor.motion.roll += (roll - actor.motion.roll) * blend;
        actor.motion.pitch += (pitch - actor.motion.pitch) * blend;
    }
    update_sinking(actor, def, dt);
}
