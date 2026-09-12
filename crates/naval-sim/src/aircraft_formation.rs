use crate::{
    air_gunnery::SeedKey,
    aircraft::{AirFlight, Aircraft, set_str},
    aircraft_flight::{FlightOptions, fly},
    definition::Vec3,
    geometry::*,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormationState {
    pub kind: String,
    pub offset: Vec3,
}

fn layout_seed(f: &AirFlight, p: &Aircraft, seed: u32) -> u32 {
    SeedKey::new(seed)
        .text(&f.id)
        .text("/")
        .number(p.sortie.unwrap_or(0))
        .text("/layout")
        .finish()
}

pub fn formation_kind(f: &AirFlight, p: &Aircraft, seed: u32) -> &'static str {
    if p.pilot.attack_stage.as_deref() == Some("run") {
        return if p.role == "torpedo-bomber" {
            "line-abreast"
        } else {
            "trail"
        };
    }
    if p.role == "fighter" {
        return "pairs";
    }
    let key = layout_seed(f, p, seed);
    match key % 3 {
        0 => "vic",
        1 => "sections",
        _ => "echelon",
    }
}

pub fn formation_offset(f: &AirFlight, p: &Aircraft, time: f64, seed: u32) -> Vec3 {
    let slot = f.plane_ids.iter().position(|id| id == &p.id).unwrap_or(0);
    if slot == 0 {
        return [0.0; 3];
    }
    let row = (slot as f64 / 2.0).ceil();
    let side = if slot % 2 != 0 { -1.0 } else { 1.0 };
    let layout_seed = layout_seed(f, p, seed);
    let spacing = 0.92 + f64::from(layout_seed % 17) * 0.01;
    let spread = if p
        .pilot
        .defense
        .as_ref()
        .is_some_and(|s| s.spread_seconds > 0.0)
    {
        1.7
    } else {
        1.0
    };
    let (x, z) = match formation_kind(f, p, seed) {
        "line-abreast" => (side * row * 65.0, row * 8.0),
        "trail" => (side * 18.0, slot as f64 * 70.0),
        "pairs" => (
            if slot % 2 == 1 { -42.0 } else { 0.0 } + (slot / 2) as f64 * 80.0,
            (slot / 2) as f64 * 85.0 + (slot % 2) as f64 * 35.0,
        ),
        "sections" => {
            let member = slot % 3;
            let section = (slot / 3) as f64;
            (
                section * 130.0
                    + match member {
                        1 => -38.0,
                        2 => 38.0,
                        _ => 0.0,
                    },
                section * 140.0 + if member == 0 { 0.0 } else { 38.0 },
            )
        }
        "echelon" => (
            slot as f64 * 35.0 * if layout_seed % 2 == 0 { 1.0 } else { -1.0 },
            slot as f64 * 38.0,
        ),
        _ => (side * row * 40.0, row * 36.0),
    };
    let phase = f64::from(
        SeedKey::new(seed)
            .text(&p.id)
            .text("/")
            .number(p.sortie.unwrap_or(0))
            .text("/formation")
            .finish(),
    ) / 4294967296.0
        * std::f64::consts::TAU;
    [
        x * spacing * spread + (time * 0.19 + phase).sin() * 3.0,
        row * 3.0 + (time * 0.23 + phase * 2.0).sin() * 0.7,
        z * spacing + (time * 0.17 + phase * 3.0).sin() * 4.0,
    ]
}
pub fn formation_leader(
    f: &AirFlight,
    planes: &[Aircraft],
    endurance: &crate::air_rules::EndurancePolicy,
) -> Option<usize> {
    f.plane_ids
        .iter()
        .filter_map(|id| planes.iter().position(|p| &p.id == id))
        .find(|&i| {
            planes[i].hp >= 25.0
                && !endurance.needs_recall(planes[i].flight_time, false)
                && matches!(planes[i].phase.as_str(), "outbound" | "attack")
        })
}
pub fn formation_position(
    f: &AirFlight,
    p: &Aircraft,
    leader: &Aircraft,
    time: f64,
    seed: u32,
) -> Vec3 {
    let offset = sub(
        p.pilot
            .formation
            .as_ref()
            .map_or_else(|| formation_offset(f, p, time, seed), |s| s.offset),
        leader
            .pilot
            .formation
            .as_ref()
            .map_or_else(|| formation_offset(f, leader, time, seed), |s| s.offset),
    );
    let (c, s) = (leader.heading.cos(), leader.heading.sin());
    add(
        leader.position,
        [
            c * offset[0] - s * offset[2],
            offset[1],
            s * offset[0] + c * offset[2],
        ],
    )
}
pub fn fly_formation(
    p: &mut Aircraft,
    leader: &Aircraft,
    f: &AirFlight,
    dt: f64,
    time: f64,
    seed: u32,
) {
    let desired = formation_offset(f, p, time, seed);
    let kind = formation_kind(f, p, seed);
    let state = p.pilot.formation.get_or_insert_with(|| FormationState {
        kind: String::new(),
        offset: desired,
    });
    set_str(&mut state.kind, kind);
    for (axis, target) in desired.into_iter().enumerate() {
        state.offset[axis] += clamp(target - state.offset[axis], -8.0 * dt, 8.0 * dt);
    }
    let slot = formation_position(f, p, leader, time, seed);
    let offset = sub(slot, leader.position);
    let speed = length(leader.velocity).max(34.0);
    let turn = -9.81 * leader.bank.tan() / (speed * leader.pitch.cos()).max(30.0);
    let slot_velocity = add(leader.velocity, [-turn * offset[2], 0.0, turn * offset[0]]);
    let error = sub(slot, p.position);
    let desired = add(slot_velocity, scale(error, 0.24));
    let speed = clamp(length(desired), speed - 20.0, speed + 24.0);
    let point = add(p.position, scale(desired, 3.0));
    fly(
        p,
        point,
        speed + p.pitch.sin() * 30.0 + p.bank.abs() * 3.0 + p.controls.brakes * 14.0,
        dt,
        FlightOptions {
            turn_rate: turn,
            altitude_lookahead: Some(speed * 3.0),
            dive: leader.pitch < -0.24,
            ..Default::default()
        },
    );
}
