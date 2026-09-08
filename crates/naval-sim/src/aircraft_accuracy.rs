use crate::{
    air_gunnery::{fighter_spread, gunnery_seed},
    aircraft::Aircraft,
    ballistics::{dispersed_direction, dispersed_speed},
    definition::Vec3,
    geometry::*,
};
pub fn strike_aim_error(p: &Aircraft, heading: f64, seed: u32, sortie: u32) -> Vec3 {
    let key = gunnery_seed(&p.id, seed);
    let pass = sortie.wrapping_mul(17).wrapping_add(p.pilot.attempts);
    let across = (dispersed_speed(1.0, 1.0, key, pass) - 1.0) * 24.0;
    let along = (dispersed_speed(1.0, 1.0, key ^ 0xa53c9e17, pass) - 1.0)
        * if p.role == "dive-bomber" { 45.0 } else { 100.0 };
    [
        heading.cos() * across + heading.sin() * along,
        0.0,
        heading.sin() * across - heading.cos() * along,
    ]
}
#[derive(Clone, Copy, Debug, serde::Serialize)]
pub struct FighterBurst {
    pub end: Vec3,
    pub hit: bool,
}
pub fn fighter_burst(p: &Aircraft, aim: Vec3, seed: u32, sortie: u32) -> FighterBurst {
    let delta = sub(aim, p.position);
    let distance = length(delta);
    let panic = p.pilot.fire_discipline.as_ref().is_some_and(|d| d.panic);
    let direction = dispersed_direction(
        if panic { p.forward() } else { normalize(delta) },
        fighter_spread(p.bank) * if panic { 2.0 } else { 1.0 },
        gunnery_seed(&p.id, seed),
        sortie
            .wrapping_mul(31)
            .wrapping_add(p.ammo as u32)
            .wrapping_sub(1),
    );
    let end = add(p.position, scale(direction, distance));
    FighterBurst {
        end,
        hit: length(sub(end, aim)) <= 7.0,
    }
}
