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
    stability_interval: f64,
    response: Option<SeaResponse>,
    sea: Option<(&SeaState, f64)>,
) {
    update_flooding_with_transfer_step(
        actor,
        def,
        hydro,
        dt,
        dt,
        stability_interval,
        response,
        sea,
    );
}

pub(crate) const TRANSFER_TICKS: u64 = 6;
pub(crate) fn transfer_step(tick: u64) -> f64 {
    if tick == 0 {
        crate::rules::DT
    } else if tick.is_multiple_of(TRANSFER_TICKS) {
        TRANSFER_TICKS as f64 * crate::rules::DT
    } else {
        0.
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn update_flooding_with_transfer_step(
    actor: &mut Combatant,
    def: &ShipDefinition,
    hydro: &HullHydrostatics,
    dt: f64,
    transfer_dt: f64,
    stability_interval: f64,
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
    update_stability(actor, def, hydro, dt, stability_interval, response);
    if transfer_dt > 0. {
        update_transfers(actor, def, transfer_dt, sea);
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
    if def.hull.volume.is_some() {
        for i in 0..def.compartments.len() {
            let y = water_level(actor, def, i, None);
            actor.damage.compartments[i].water_level_y = Some(y);
        }
    }
}

/// Sample pressures and pumping once for this bounded transfer window. The
/// existing per-connection limits still prevent overfill and head reversal.
fn update_transfers(
    actor: &mut Combatant,
    def: &ShipDefinition,
    dt: f64,
    sea: Option<(&SeaState, f64)>,
) {
    let power = if def.compartments.iter().any(|c| c.pump_m3_per_second > 0.0) {
        electrical_power(actor, def, sea)
    } else {
        0.0
    };
    for (i, c) in def.compartments.iter().enumerate() {
        let internal = water_level(actor, def, i, None);
        let mut inflow: f64 = actor.damage.compartments[i]
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
        // Explicit openings are persistent geometry state, independent of repairable breaches.
        for opening in def
            .openings
            .iter()
            .flatten()
            .filter(|o| o.compartment_id == c.id)
        {
            if opening
                .sealed_by_mount_id
                .as_ref()
                .is_some_and(|id| actor.mounts.iter().any(|m| m.id == *id && m.hp > 0.))
                || opening.sealed_by_module_id.as_ref().is_some_and(|id| {
                    actor
                        .damage
                        .modules
                        .iter()
                        .any(|m| m.id == *id && m.hp > 0.)
                })
            {
                continue;
            }
            let world = local_to_world(opening.position, actor.motion.pose());
            let external = sea.map_or(0., |(s, t)| s.height(world[0], world[2], t));
            let head = (external - world[1]).max(0.) - (internal - world[1]).max(0.);
            inflow += 0.6 * opening.area_m2 * sign(head) * (2. * 9.81 * head.abs()).sqrt();
        }
        let pumping = if actor.damage.sunk {
            0.0
        } else {
            let fixed_power = if def.hull.volume.is_some() && c.pump_m3_per_second > 0. {
                crate::construction_services::availability(actor, def, Some(&c.id), sea)
            } else {
                power
            };
            c.pump_m3_per_second * fixed_power + actor.damage.control.pumping[i]
        };
        let state = &mut actor.damage.compartments[i];
        state.water_m3 = clamp(state.water_m3 + (inflow - pumping) * dt, 0.0, c.capacity_m3);
    }
    if def.connections.iter().any(|c| c.patches.is_some()) {
        // Grouping changes storage order. Restore the original global fragment
        // order only for active transfers, since each transfer changes the next head.
        let mut flows = vec![];
        for (i, c) in def.connections.iter().enumerate() {
            let state = &actor.damage.connections[i];
            if state.state == "closed" {
                continue;
            }
            if let Some(patches) = &c.patches {
                for (j, patch) in patches.iter().enumerate() {
                    let area = if state.state == "damaged" {
                        state.patch_damage_m2.as_ref().map_or_else(
                            || patch.area_m2 * (state.damage_area_m2 / c.area_m2),
                            |d| d[j],
                        )
                    } else {
                        patch.area_m2
                    };
                    if area > 0. {
                        flows.push((
                            patch.transfer_order,
                            state.from_index,
                            state.to_index,
                            Some(patch.position),
                            area,
                        ));
                    }
                }
            } else {
                let area = if state.state == "damaged" {
                    state.damage_area_m2
                } else {
                    c.area_m2
                };
                flows.push((
                    c.transfer_order.unwrap_or(i as f64),
                    state.from_index,
                    state.to_index,
                    c.position,
                    area,
                ));
            }
        }
        flows.sort_by(|a, b| a.0.total_cmp(&b.0));
        for (_, ai, bi, position, area) in flows {
            transfer(actor, def, ai, bi, position, area, dt);
        }
    } else {
        for (i, c) in def.connections.iter().enumerate() {
            let state = &actor.damage.connections[i];
            if state.state == "closed" {
                continue;
            }
            let area = if state.state == "damaged" {
                state.damage_area_m2
            } else {
                c.area_m2
            };
            transfer(
                actor,
                def,
                state.from_index,
                state.to_index,
                c.position,
                area,
                dt,
            );
        }
    }
}

fn transfer(
    actor: &mut Combatant,
    def: &ShipDefinition,
    ai: usize,
    bi: usize,
    position: Option<crate::definition::Vec3>,
    area: f64,
    dt: f64,
) {
    let (a, b) = (
        actor.damage.compartments[ai].water_m3,
        actor.damage.compartments[bi].water_m3,
    );
    let portal = position.map_or(f64::NEG_INFINITY, |p| {
        local_to_world(p, actor.motion.pose())[1]
    });
    let head = |a: f64, b: f64| {
        if position.is_some() {
            (a - portal).max(0.0) - (b - portal).max(0.0)
        } else {
            a - b
        }
    };
    let difference = head(
        water_level(actor, def, ai, None),
        water_level(actor, def, bi, None),
    );
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

#[cfg(test)]
mod cadence_tests {
    use super::*;
    use crate::{
        definition::{Compartment, FloodConnection},
        rules::DT,
    };

    fn fixture() -> (ShipDefinition, Combatant, HullHydrostatics) {
        let mut def: ShipDefinition =
            serde_json::from_str(include_str!("../../../public/models/bismarck.json")).unwrap();
        def.stability = None;
        def.hull.volume = None;
        def.hull.reserve_buoyancy_m3 = 1e6;
        def.openings = None;
        def.compartments = ["a", "b", "c"]
            .into_iter()
            .map(|id| Compartment {
                id: id.into(),
                name: id.into(),
                center: [0., 2., 0.],
                size: [5., 4., 5.],
                capacity_m3: 100.,
                ..Default::default()
            })
            .collect();
        def.connections = [("a", "b"), ("b", "c")]
            .into_iter()
            .map(|(a, b)| FloodConnection {
                id: Some(format!("{a}-{b}")),
                from_id: a.into(),
                to_id: b.into(),
                area_m2: 0.5,
                state: Some("open".into()),
                ..Default::default()
            })
            .collect();
        let mut actor = Combatant::new("test", &def);
        for (room, fill) in actor.damage.compartments.iter_mut().zip([100., 0., 50.]) {
            room.water_m3 = fill;
        }
        actor.damage.control.pumping.fill(0.);
        let hydro = HullHydrostatics::new(&def.hull, None);
        (def, actor, hydro)
    }

    #[test]
    fn cadenced_transfers_conserve_water_and_track_small_steps() {
        let (def, mut coarse, hydro) = fixture();
        let mut fine = coarse.clone();
        let mut worst = 0.0_f64;
        let mut boundary_error = 0.0_f64;
        for tick in 0..=3600 {
            update_flooding(&mut fine, &def, &hydro, DT, 0.5, None, None);
            update_flooding_with_transfer_step(
                &mut coarse,
                &def,
                &hydro,
                DT,
                transfer_step(tick),
                0.5,
                None,
                None,
            );
            let total: f64 = coarse.damage.compartments.iter().map(|r| r.water_m3).sum();
            assert!((total - 150.).abs() < 1e-9);
            for (a, b) in coarse
                .damage
                .compartments
                .iter()
                .zip(&fine.damage.compartments)
            {
                assert!((0. ..=100.).contains(&a.water_m3));
                let error = (a.water_m3 - b.water_m3).abs();
                worst = worst.max(error);
                if tick.is_multiple_of(TRANSFER_TICKS) {
                    boundary_error = boundary_error.max(error);
                }
            }
        }
        // Between samples, the middle room can receive both portals' flow.
        // Bound that intentional lag by the maximum four-metre pressure head.
        let held_flow = 2. * 0.6 * 0.5 * (2.0_f64 * 9.81 * 4.).sqrt() * TRANSFER_TICKS as f64 * DT;
        assert!(worst < held_flow, "maximum held fill error {worst} m3");
        assert!(
            boundary_error < def.compartments[0].capacity_m3 * 0.001,
            "integrated fill error {boundary_error} m3"
        );
    }

    #[test]
    fn constructed_flooding_tracks_small_steps_with_open_connections() {
        let catalog = crate::catalog::Catalog::load(&crate::catalog::installed_manifest()).unwrap();
        for id in ["valiant", "resolute"] {
            let compiled = std::sync::Arc::new(catalog.compile(id).unwrap());
            let mut coarse =
                crate::vessel::Vessel::new("test", crate::rules::TeamId::A, compiled.clone()).state;
            let def = &compiled.definition;
            let mut breaches = 0;
            for (i, room) in def.compartments.iter().enumerate() {
                if room.center[1] + coarse.motion.y < -0.5 && breaches < 3 {
                    crate::breaches::add_breach(
                        &mut coarse.damage.compartments[i],
                        room.center,
                        0.04,
                        i as i64,
                        None,
                        None,
                        false,
                    );
                    breaches += 1;
                }
            }
            assert!(breaches > 0);
            for link in &mut coarse.damage.connections {
                link.state = "open".into();
            }
            let mut fine = coarse.clone();
            let (mut water_error, mut draft_error) = (0.0_f64, 0.0_f64);
            for tick in 0..=3600 {
                update_flooding(&mut fine, def, &compiled.hydro, DT, 0.5, None, None);
                update_flooding_with_transfer_step(
                    &mut coarse,
                    def,
                    &compiled.hydro,
                    DT,
                    transfer_step(tick),
                    0.5,
                    None,
                    None,
                );
                let total = |a: &Combatant| {
                    a.damage
                        .compartments
                        .iter()
                        .map(|c| c.water_m3)
                        .sum::<f64>()
                };
                water_error = water_error.max((total(&coarse) - total(&fine)).abs());
                draft_error = draft_error.max((coarse.motion.y - fine.motion.y).abs());
                for (room, state) in def.compartments.iter().zip(&coarse.damage.compartments) {
                    assert!((0. ..=room.capacity_m3 + 1e-8).contains(&state.water_m3));
                }
            }
            assert!(water_error < 1., "{id} water error {water_error} m3");
            assert!(draft_error < 0.02, "{id} draft error {draft_error} m");
            assert_eq!(coarse.damage.sunk, fine.damage.sunk);
        }
    }

    #[test]
    fn sinking_does_not_wait_for_a_transfer_tick() {
        let (def, mut actor, hydro) = fixture();
        actor.damage.integrity = 0.;
        for tick in 1..TRANSFER_TICKS {
            let before = actor.motion.y;
            update_flooding_with_transfer_step(
                &mut actor,
                &def,
                &hydro,
                DT,
                transfer_step(tick),
                0.5,
                None,
                None,
            );
            assert!(actor.damage.sunk);
            assert!(
                actor.motion.y < before,
                "sinking motion must advance on every tick"
            );
        }
    }
}
