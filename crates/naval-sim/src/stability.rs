use crate::{
    damage::Combatant,
    definition::ShipDefinition,
    environment::SeaResponse,
    floodwater::{Scratch, WaterBody, refresh, water_body, water_body_with},
    geometry::*,
    hydrostatics::{HullHydrostatics, righting_arms},
};
#[derive(Clone, Debug, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(optional_fields)]
pub struct StabilityState {
    pub sample_roll: Option<f64>,
    pub sample_pitch: Option<f64>,
    pub roll_slope: Option<f64>,
    pub pitch_slope: Option<f64>,
    pub elapsed: f64,
    pub target_y: f64,
    pub roll_rate: f64,
    pub pitch_rate: f64,
    pub capsize_seconds: f64,
    /// Always empty on the wire: the presentation filter drops the bodies and
    /// the client rebuilds water surfaces from compartment volumes and hull pose.
    pub water: Vec<WaterBody>,
    pub roll_arm: f64,
    pub pitch_arm: f64,
    pub displacement_m3: f64,
    pub reserve_m3: f64,
    #[ts(as = "crate::frame_vocabulary::VesselStatus")]
    pub status: String,
    pub combat_lost: bool,
    #[serde(skip)]
    scratch: Scratch,
    #[serde(skip)]
    weighted_radii: Option<[f64; 2]>,
}
impl Default for StabilityState {
    fn default() -> Self {
        Self {
            sample_roll: None,
            sample_pitch: None,
            roll_slope: None,
            pitch_slope: None,
            elapsed: 0.5,
            target_y: 0.0,
            roll_rate: 0.0,
            pitch_rate: 0.0,
            capsize_seconds: 0.0,
            water: vec![],
            roll_arm: 0.0,
            pitch_arm: 0.0,
            displacement_m3: 0.0,
            reserve_m3: 0.0,
            status: "operational".into(),
            combat_lost: false,
            scratch: Scratch::default(),
            weighted_radii: None,
        }
    }
}
pub fn water_level(actor: &Combatant, def: &ShipDefinition, i: usize, volume: Option<f64>) -> f64 {
    let state = &actor.damage.compartments[i];
    let room = &def.compartments[i];
    let volume = volume.unwrap_or(state.water_m3);
    if def.stability.is_none() {
        return local_to_world(
            [
                room.center[0],
                room.center[1] - room.size[1] / 2.0 + volume / room.capacity_m3 * room.size[1],
                room.center[2],
            ],
            actor.motion.pose(),
        )[1];
    }
    actor.motion.y
        + if let Some(body) = actor.damage.stability.water.get(i) {
            body.level_at_volume(room, volume)
        } else {
            water_body(room, state.water_m3, actor.motion.roll, actor.motion.pitch)
                .level_at_volume(room, volume)
        }
}
fn wreck_depth(def: &ShipDefinition) -> f64 {
    if def.submarine.is_some() {
        -1000.0
    } else {
        -50.0_f64.max((def.hull.length / 2.0).hypot(def.hull.beam / 2.0) + def.hull.depth + 10.0)
    }
}
/// Levers through which the wave slope works the hull, as fractions of beam and
/// length. The CPU swell is four times the visible peak wavelength and so a
/// quarter as steep; these are tuned for the motion a hull of that size shows in
/// that wind, not derived from GM. `tests/sea_motion.rs` holds the bands. Pitch
/// beyond 0.8 drives the cargo hulls out of their linear range head-on into a
/// 30 m/s sea. The berth's presentation copy is `src/game/BerthMotion.ts`.
pub const WAVE_ROLL_LEVER: f64 = 0.14;
pub const WAVE_PITCH_LEVER: f64 = 0.8;
/// `interval` is how often the hydrostatic solve runs: half a second for every
/// battle without mission rules, and whatever the PvE cadence asset says for a
/// mission. Roll and pitch still integrate every tick; between solves they use
/// the linearised righting arm about the last sampled attitude, which is what
/// keeps a longer interval from injecting energy into a short hull.
pub fn update_stability(
    actor: &mut Combatant,
    def: &ShipDefinition,
    hydro: &HullHydrostatics,
    dt: f64,
    interval: f64,
    sea: Option<SeaResponse>,
) {
    let Some(profile) = &def.stability else {
        return;
    };
    if dt <= 0.0 || actor.damage.sunk && actor.motion.y <= wreck_depth(def) {
        return;
    }
    let damage = &mut actor.damage;
    let s = &mut damage.stability;
    let p = &mut actor.motion;
    s.elapsed += dt;
    if s.elapsed >= interval {
        s.elapsed %= interval;
        let mut work = std::mem::take(&mut s.scratch);
        if s.water.len() > def.compartments.len() {
            s.water.truncate(def.compartments.len());
        }
        for (i, c) in def.compartments.iter().enumerate() {
            let volume = damage.compartments[i].water_m3;
            match s.water.get_mut(i) {
                Some(body) => refresh(body, c, volume, p.roll, p.pitch, &mut work),
                None => s
                    .water
                    .push(water_body_with(c, volume, p.roll, p.pitch, &mut work)),
            }
        }
        s.scratch = work;
        actor.motion_mass = crate::maneuvering::MassProperties::flooded(def, &s.water);
        let water: f64 = s.water.iter().map(|w| w.volume).sum();
        let mass = def.hull.mass_kg + water * 1025.0;
        let center = std::array::from_fn(|axis| {
            (profile.dry_center_of_gravity[axis] * def.hull.mass_kg
                + s.water
                    .iter()
                    .map(|w| w.volume * 1025.0 * w.center[axis])
                    .sum::<f64>())
                / mass
        });
        if def.hull.buoyancy.is_some() {
            let dry = def
                .loading
                .as_ref()
                .expect("weighted combat profile retains loading");
            let delta = sub(profile.dry_center_of_gravity, center);
            let mut inertia = dry.inertia_kg_m2;
            let parallel = [
                delta[1] * delta[1] + delta[2] * delta[2],
                delta[0] * delta[0] + delta[2] * delta[2],
                delta[0] * delta[0] + delta[1] * delta[1],
            ];
            for axis in 0..3 {
                inertia[axis] += dry.mass_kg * parallel[axis];
            }
            for w in &s.water {
                let water_i = w.inertia_m3(center);
                for axis in 0..3 {
                    inertia[axis] += 1025. * water_i[axis];
                }
            }
            s.weighted_radii = Some([inertia[2] / mass, inertia[0] / mass]);
        }
        let volume = mass / (1025.0 * profile.buoyancy_scale);
        let full = hydro.full_volume();
        s.displacement_m3 = volume;
        s.reserve_m3 = (full - volume).max(0.0);
        if !damage.sunk && volume >= full {
            damage.sunk = true;
            damage.defeat_cause = Some("flooding".into());
            s.status = "sinking".into();
            s.combat_lost = true;
        }
        if def.hull.volume.is_none()
            && sea.is_none()
            && !damage.sunk
            && water == 0.0
            && p.y == 0.0
            && p.roll == 0.0
            && p.pitch == 0.0
            && s.roll_rate == 0.0
            && s.pitch_rate == 0.0
        {
            s.target_y = 0.0;
            s.roll_arm = 0.0;
            s.pitch_arm = 0.0;
            return;
        }
        let (fy, fc) = if actor.submarine.is_some() || damage.sunk {
            (p.y, hydro.sample(p.y, p.roll, p.pitch).center)
        } else {
            let f = hydro.flotation_near(volume, p.roll, p.pitch, s.target_y);
            (f.y, f.center)
        };
        let arms = righting_arms(fc, center, p.roll, p.pitch);
        let epsilon = 0.0001;
        s.sample_roll = Some(p.roll);
        s.sample_pitch = Some(p.pitch);
        s.roll_slope = Some(
            (righting_arms(
                hydro.sample(fy, p.roll + epsilon, p.pitch).center,
                center,
                p.roll + epsilon,
                p.pitch,
            )
            .0 - arms.0)
                / epsilon,
        );
        s.pitch_slope = Some(
            (righting_arms(
                hydro.sample(fy, p.roll, p.pitch + epsilon).center,
                center,
                p.roll,
                p.pitch + epsilon,
            )
            .1 - arms.1)
                / epsilon,
        );
        let wave = if damage.sunk { None } else { sea };
        s.roll_arm = arms.0 + wave.map_or(0.0, |w| w.roll) * def.hull.beam * WAVE_ROLL_LEVER;
        s.pitch_arm = arms.1 + wave.map_or(0.0, |w| w.pitch) * def.hull.length * WAVE_PITCH_LEVER;
        s.target_y = fy;
    }
    if damage.sunk {
        p.wave_heave = 0.0;
    }
    if actor.submarine.is_none() && !damage.sunk {
        let previous = p.y;
        let mean = p.mean_y();
        let blend = 1.0 - (-dt / 1.5).exp();
        p.wave_heave += (sea.map_or(0.0, |s| s.heave) - p.wave_heave) * blend;
        p.y = mean + clamp((s.target_y - mean) * blend, -dt, dt) + p.wave_heave;
        p.vertical_speed = (p.y - previous) / dt;
    }
    s.roll_rate = (s.roll_rate
        + 9.81
            * (s.roll_arm
                + s.roll_slope.unwrap_or(0.0) * (p.roll - s.sample_roll.unwrap_or(p.roll)))
            / s.weighted_radii.map_or_else(
                || {
                    def.loading
                        .as_ref()
                        .map_or((def.hull.beam * 0.4).powi(2), |l| {
                            l.inertia_kg_m2[2] / l.mass_kg
                        })
                },
                |r| r[0],
            )
            * dt)
        * (-dt / 4.0).exp();
    s.pitch_rate = (s.pitch_rate
        + 9.81
            * (s.pitch_arm
                + s.pitch_slope.unwrap_or(0.0) * (p.pitch - s.sample_pitch.unwrap_or(p.pitch)))
            / s.weighted_radii.map_or_else(
                || {
                    def.loading
                        .as_ref()
                        .map_or((def.hull.length * 0.28).powi(2), |l| {
                            l.inertia_kg_m2[0] / l.mass_kg
                        })
                },
                |r| r[1],
            )
            * dt)
        * (-dt / 3.0).exp();
    p.roll = clamp(
        p.roll + s.roll_rate * dt,
        -std::f64::consts::PI,
        std::f64::consts::PI,
    );
    p.pitch = clamp(
        p.pitch + s.pitch_rate * dt,
        -std::f64::consts::FRAC_PI_2,
        std::f64::consts::FRAC_PI_2,
    );
    if p.roll.abs() == std::f64::consts::PI && s.roll_rate * p.roll > 0.0 {
        s.roll_rate = 0.0;
    }
    if p.pitch.abs() == std::f64::consts::FRAC_PI_2 && s.pitch_rate * p.pitch > 0.0 {
        s.pitch_rate = 0.0;
    }
    let inverted = p.roll.abs() > radians(100.0) && s.roll_arm * p.roll >= -0.01;
    s.capsize_seconds = if inverted {
        s.capsize_seconds + dt
    } else {
        0.0
    };
    if s.capsize_seconds >= 10.0 {
        if !damage.sunk {
            damage.defeat_cause = Some("capsize".into());
        }
        damage.sunk = true;
        s.status = "capsized".into();
        s.combat_lost = true;
    }
}
pub fn update_sinking(actor: &mut Combatant, def: &ShipDefinition, dt: f64) {
    if !actor.damage.sunk || dt <= 0.0 {
        return;
    }
    let p = &mut actor.motion;
    let speed = (p.vertical_speed.min(-0.08) - 0.015 * dt).max(-0.65);
    let y = p.y.min(wreck_depth(def).max(p.y + speed * dt));
    p.vertical_speed = (y - p.y) / dt;
    p.y = y;
}
