use crate::{
    breaches::add_breach, damage::Combatant, definition::ShipDefinition, geometry::clamp,
    motion::HelmCommand,
};
#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmarineState {
    pub target_depth_m: f64,
    pub ballast_m3: f64,
    pub emergency_blow: bool,
    pub planes: f64,
    pub trim_pitch: f64,
    pub wave_heave: f64,
    pub wave_speed: f64,
}
pub fn order_depth(actor: &mut Combatant, def: &ShipDefinition, depth: f64, emergency: bool) {
    if actor.damage.sunk || !depth.is_finite() {
        return;
    }
    if let (Some(s), Some(e)) = (&mut actor.submarine, &def.submarine) {
        s.target_depth_m = if emergency {
            0.0
        } else {
            clamp(depth, 0.0, e.max_depth_m)
        };
        s.emergency_blow = emergency;
    }
}
pub fn step_submarine(
    actor: &mut Combatant,
    def: &ShipDefinition,
    command: HelmCommand,
    dt: f64,
    sea_heave: f64,
) {
    if actor.submarine.is_none() || actor.damage.sunk {
        return;
    }
    let Some(e) = &def.submarine else {
        return;
    };
    if let Some(depth) = command.depth_m {
        order_depth(actor, def, depth, command.emergency_blow.unwrap_or(false));
    }
    let s = actor.submarine.as_mut().unwrap();
    let p = &mut actor.motion;
    let depth = p.depth();
    let water: f64 = actor.damage.compartments.iter().map(|c| c.water_m3).sum();
    let capacity = e.ballast_capacity_m3;
    let immersion = clamp(
        depth / 0.5_f64.max(def.hull.depth - def.hull.draft),
        0.0,
        1.0,
    );
    let neutral = e.neutral_ballast_fraction * immersion;
    let down_speed = -(p.vertical_speed - s.wave_speed);
    let desired_speed = clamp(
        (s.target_depth_m - depth) * 0.22,
        -e.max_rise_speed,
        e.max_dive_speed,
    );
    let speed_error = desired_speed - down_speed;
    let target = if s.target_depth_m == 0.0 {
        0.0
    } else {
        clamp(neutral - water / capacity + speed_error * 0.3, 0.0, 1.0) * capacity
    };
    let rate = if target > s.ballast_m3 {
        e.flood_rate_m3_per_second
    } else if s.emergency_blow {
        e.emergency_blow_rate_m3_per_second
    } else {
        e.blow_rate_m3_per_second
    };
    s.ballast_m3 += clamp(target - s.ballast_m3, -rate * dt, rate * dt);
    let authority = clamp(p.speed.abs() / e.submerged_handling.forward_speed, 0.0, 1.0);
    let order = if s.emergency_blow {
        -1.0
    } else {
        clamp(speed_error, -1.0, 1.0)
    };
    s.planes += clamp(order - s.planes, -dt * 0.6, dt * 0.6);
    let acceleration = (s.ballast_m3 / capacity + water / capacity - neutral) * 1.8
        + s.planes * authority * 0.4
        - down_speed * 0.25;
    let next_speed = clamp(
        down_speed + acceleration * dt,
        -e.max_rise_speed,
        e.max_dive_speed,
    );
    let next_depth = (depth + next_speed * dt).max(0.0);
    let previous = s.wave_heave;
    s.wave_heave += (sea_heave - previous) * (1.0 - (-dt / 1.5).exp());
    s.wave_speed = if dt > 0.0 {
        (s.wave_heave - previous) / dt
    } else {
        0.0
    };
    p.wave_heave = s.wave_heave;
    p.y = -next_depth + s.wave_heave;
    p.vertical_speed = if next_depth == 0.0 { 0.0 } else { -next_speed } + s.wave_speed;
    let pitch = -clamp(next_speed / 3.0_f64.max(p.speed.abs()) * 0.24, -0.14, 0.14);
    let previous_trim = s.trim_pitch;
    s.trim_pitch += (pitch - s.trim_pitch) * (1.0 - (-dt / 2.0).exp());
    p.pitch = clamp(
        p.pitch + s.trim_pitch
            - if def.stability.is_some() {
                previous_trim
            } else {
                0.0
            },
        -0.3,
        0.3,
    );
    if next_depth == 0.0 && s.ballast_m3 < 0.01 {
        s.emergency_blow = false;
    }
    if next_depth > e.max_depth_m
        && let Some((i, r)) = def
            .compartments
            .iter()
            .enumerate()
            .min_by(|(_, a), (_, b)| a.center[2].abs().total_cmp(&b.center[2].abs()))
    {
        add_breach(
            &mut actor.damage.compartments[i],
            [0.0, -def.hull.draft, r.center[2]],
            (next_depth - e.max_depth_m) * 0.0001 * dt,
            -1,
            Some(0.05),
            Some([0.0, -1.0, 0.0]),
            true,
        );
    }
}
