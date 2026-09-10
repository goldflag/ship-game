use crate::{definition::Vec3, geometry::*};
#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
pub struct FireDiscipline {
    pub remaining: f64,
    pub sequence: u32,
    pub panic: bool,
    pub yaw: f64,
    pub pitch: f64,
}
pub fn gunnery_seed(id: &str, mut seed: u32) -> u32 {
    for c in id.encode_utf16() {
        seed = (seed ^ u32::from(c)).wrapping_mul(16777619);
    }
    seed
}
fn sample(seed: u32, sequence: u32, channel: u32) -> f64 {
    let mut x = seed ^ sequence.wrapping_add(1).wrapping_mul(0x9e3779b9) ^ channel;
    x = (x ^ (x >> 16)).wrapping_mul(0x21f0aaad);
    x = (x ^ (x >> 15)).wrapping_mul(0x735a2d97);
    f64::from(x ^ (x >> 15)) / 4294967296.0
}
pub fn step_discipline(s: &mut FireDiscipline, dt: f64, pressure: f64, seed: u32, engaged: bool) {
    s.remaining = (s.remaining - dt).max(0.0);
    if !engaged {
        s.panic = false;
        return;
    }
    if s.remaining > 0.0 {
        return;
    }
    let sequence = s.sequence;
    s.sequence = s.sequence.wrapping_add(1);
    s.panic = !s.panic && sample(seed, sequence, 0) < 0.18 + 0.42 * clamp(pressure, 0.0, 1.0);
    s.remaining = if s.panic {
        2.0 + 2.0 * sample(seed, sequence, 1)
    } else {
        4.0 + 3.0 * sample(seed, sequence, 1)
    };
    s.yaw = if sample(seed, sequence, 2) < 0.5 {
        -1.0
    } else {
        1.0
    } * (0.18 + 0.42 * sample(seed, sequence, 3));
    s.pitch = -0.08 + 0.45 * sample(seed, sequence, 4);
}
pub fn panic_aim(origin: Vec3, target: Vec3, s: &FireDiscipline) -> Vec3 {
    let delta = sub(target, origin);
    let distance = length(delta);
    let yaw = delta[0].atan2(-delta[2]) + s.yaw;
    let pitch = clamp(
        delta[1].atan2(delta[0].hypot(delta[2])) + s.pitch,
        0.12,
        1.35,
    );
    add(
        origin,
        scale(
            [
                yaw.sin() * pitch.cos(),
                pitch.sin(),
                -yaw.cos() * pitch.cos(),
            ],
            distance,
        ),
    )
}
pub fn aa_spread(distance: f64) -> f64 {
    0.06 + distance / 20000.0
}
pub fn aa_damage(caliber: f64) -> f64 {
    // Overlapping batteries remain dangerous; their per-hit damage is modestly
    // below the original 8/16/40 tuning so positioned fighters matter more.
    if caliber > 0.08 {
        36.0
    } else if caliber > 0.025 {
        14.0
    } else {
        7.0
    }
}
pub fn fighter_spread(bank: f64) -> f64 {
    // A burst represents several rounds. Disciplined fire needs a reasonable
    // chance of landing two damaging bursts within the finite 16-burst load;
    // banking and panic still spoil the solution rather than granting hits.
    0.026 + bank.abs() * 0.018
}
pub const FIGHTER_DAMAGE: f64 = 80.0;
