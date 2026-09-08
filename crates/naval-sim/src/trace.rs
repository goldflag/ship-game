//! Migration harness shared by native and WASM. Not a substitute for a battle host.
use crate::{
    definition::Handling,
    motion::{HelmCommand, ShipState, step_ship},
};
use serde::{Deserialize, Serialize};
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MotionTrace {
    pub id: String,
    pub handling: Handling,
    pub inputs: Vec<MotionInput>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MotionInput {
    pub ticks: u32,
    pub command: HelmCommand,
}
#[derive(Serialize)]
pub struct MotionTraceOutput {
    pub checkpoints: Vec<ShipState>,
}
pub fn motion_trace(input: MotionTrace) -> Result<MotionTraceOutput, String> {
    if input.inputs.len() > 1024
        || input.inputs.iter().map(|i| u64::from(i.ticks)).sum::<u64>() > 108000
    {
        return Err("Trace exceeds one match".into());
    }
    let h = &input.handling;
    if ![
        h.forward_speed,
        h.reverse_speed,
        h.acceleration,
        h.braking,
        h.rudder_rate,
        h.max_yaw_rate,
    ]
    .iter()
    .all(|n| n.is_finite() && *n > 0.0)
    {
        return Err("Invalid handling".into());
    }
    let mut ship = ShipState::new(input.id);
    let mut checkpoints = Vec::new();
    for input in input.inputs {
        for _ in 0..input.ticks {
            step_ship(&mut ship, input.command, h, 1.0, 1.0, None);
        }
        checkpoints.push(ship.clone());
    }
    Ok(MotionTraceOutput { checkpoints })
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectileTrace {
    pub preset_id: String,
    pub actor_id: String,
    pub shell: crate::shell::Shell,
    pub ticks: u32,
}
#[derive(Serialize)]
pub struct ProjectileTraceOutput {
    pub ticks: u32,
    pub end: Option<crate::projectile::ProjectileEnd>,
    pub shell: crate::shell::Shell,
    pub events: Vec<crate::impact::DamageEvent>,
    pub damage: crate::damage::DamageState,
    pub mounts: Vec<crate::weapons::MountState>,
}
pub fn projectile_trace(
    input: ProjectileTrace,
    compiled: std::sync::Arc<crate::vessel::CompiledShip>,
) -> Result<ProjectileTraceOutput, String> {
    let s = &input.shell;
    if input.ticks > 3600
        || input.actor_id.len() > 128
        || s.owner_id.len() > 128
        || !s.visited.is_empty()
        || !s.hull_damage.is_empty()
        || !s.hull_region_damage.is_empty()
        || s.lodged.is_some()
        || s.age != 0.0
        || !s
            .position
            .iter()
            .chain(&s.velocity)
            .all(|n| n.is_finite() && n.abs() <= 100000.0)
        || ![
            s.penetration_mm,
            s.damage,
            s.caliber_m,
            s.drag_per_second.unwrap_or(0.0),
        ]
        .iter()
        .all(|n| n.is_finite() && *n >= 0.0 && *n <= 100000.0)
    {
        return Err("Invalid projectile migration trace".into());
    }
    let mut actors = vec![crate::vessel::Vessel::new(
        input.actor_id,
        crate::rules::TeamId::A,
        compiled,
    )];
    let mut shell = input.shell;
    let mut ticks = 0;
    let mut end = None;
    let mut events = vec![];
    while ticks < input.ticks && end.is_none() {
        ticks += 1;
        let (result, emitted) = crate::projectile::advance_projectile(
            &mut shell,
            &mut actors,
            crate::rules::DT,
            &[],
            &[],
            &|_, _| 0.0,
        );
        end = result;
        events.extend(emitted);
    }
    let actor = actors.pop().unwrap();
    Ok(ProjectileTraceOutput {
        ticks,
        end,
        shell,
        events,
        damage: actor.state.damage,
        mounts: actor.state.mounts,
    })
}
