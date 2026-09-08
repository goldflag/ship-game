use crate::{
    air_gunnery::gunnery_seed,
    aircraft::{AirFlight, Aircraft},
    aircraft_flight::{FlightOptions, fly},
    definition::Vec3,
    geometry::*,
};
pub fn formation_offset(f: &AirFlight, p: &Aircraft, time: f64, seed: u32) -> Vec3 {
    let slot = f.plane_ids.iter().position(|id| id == &p.id).unwrap_or(0);
    if slot == 0 {
        return [0.0; 3];
    }
    let row = (slot as f64 / 2.0).ceil();
    let side = if slot % 2 != 0 { -1.0 } else { 1.0 };
    let phase = f64::from(gunnery_seed(
        &format!("{}/{}/formation", p.id, p.sortie.unwrap_or(0)),
        seed,
    )) / 4294967296.0
        * std::f64::consts::TAU;
    [
        side * row * 32.0 + (time * 0.31 + phase).sin() * 1.5,
        row * 3.0 + (time * 0.23 + phase * 2.0).sin() * 0.7,
        row * 27.0 + (time * 0.27 + phase * 3.0).sin() * 2.0,
    ]
}
pub fn formation_leader(f: &AirFlight, planes: &[Aircraft]) -> Option<usize> {
    f.plane_ids
        .iter()
        .filter_map(|id| planes.iter().position(|p| &p.id == id))
        .find(|&i| {
            planes[i].hp >= 25.0
                && planes[i].flight_time <= 470.0
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
        formation_offset(f, p, time, seed),
        formation_offset(f, leader, time, seed),
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
