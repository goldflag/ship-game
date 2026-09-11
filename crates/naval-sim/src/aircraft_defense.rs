//! Short, persistent reactions to locally observed attackers and close gunfire.
//! This controller receives permitted pilot observations, never a hidden threat list.
use crate::{
    aircraft::{Aircraft, PlaneView, set_opt_str},
    aircraft_flight::{FlightOptions, fly},
    definition::Vec3,
    geometry::*,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DefenseState {
    pub fire_seconds: f64,
    pub fire_direction: Vec3,
    pub cooldown: f64,
    pub maneuver_seconds: f64,
    pub spread_seconds: f64,
    pub heading: f64,
    pub altitude: f64,
    pub side: f64,
    pub sequence: u32,
    pub notice: Option<String>,
}

/// Called by the physical burst resolver only for a hit or a nearby shot.
/// The cue contains the observed direction of fire, not an enemy unit identity.
pub fn near_fire(p: &mut Aircraft, origin: Vec3) {
    let direction = normalize(sub(origin, p.position));
    let state = p.pilot.defense.get_or_insert_default();
    state.fire_seconds = 3.0;
    state.fire_direction = direction;
}

pub fn tick(p: &mut Aircraft, dt: f64) {
    if let Some(s) = &mut p.pilot.defense {
        s.fire_seconds = (s.fire_seconds - dt).max(0.0);
        s.cooldown = (s.cooldown - dt).max(0.0);
        s.maneuver_seconds = (s.maneuver_seconds - dt).max(0.0);
        s.spread_seconds = (s.spread_seconds - dt).max(0.0);
        if s.maneuver_seconds == 0.0 {
            s.notice = None;
        }
    }
}

pub fn evade_bomber(
    p: &mut Aircraft,
    observations: &[PlaneView<'_>],
    slot: usize,
    seed: u32,
    dt: f64,
) -> bool {
    if p.role == "fighter" || !matches!(p.phase.as_str(), "outbound" | "attack" | "returning") {
        return false;
    }
    let threat = observations
        .iter()
        .filter(|other| other.team != p.team && other.role == "fighter" && other.in_flight())
        .filter_map(|other| {
            let delta = sub(p.position, other.position);
            let distance = length(delta);
            (distance < 1400.0 && dot(normalize(other.velocity), normalize(delta)) > 0.65)
                .then_some((distance, normalize(scale(delta, -1.0))))
        })
        .min_by(|a, b| a.0.total_cmp(&b.0));
    let under_fire = p
        .pilot
        .defense
        .as_ref()
        .is_some_and(|s| s.fire_seconds > 0.0);
    if threat.is_none()
        && !under_fire
        && p.pilot
            .defense
            .as_ref()
            .is_none_or(|s| s.maneuver_seconds <= 0.0)
    {
        return false;
    }
    let state = p.pilot.defense.get_or_insert_default();
    if threat.is_some() || under_fire {
        state.spread_seconds = 14.0;
    }
    // Protect the short release window. Only an immediate threat to survival
    // warrants throwing away a settled bomb/torpedo solution.
    let committed = p.phase == "attack"
        && p.payload
        && (p.pitch < -0.3 || p.role == "torpedo-bomber" && p.position[1] < 55.0);
    let severe = p.hp < 45.0 && (under_fire || threat.is_some_and(|t| t.0 < 350.0));
    if state.maneuver_seconds <= 0.0
        && state.cooldown <= 0.0
        && (!committed || severe)
        && (threat.is_some() || under_fire)
    {
        let key = crate::air_gunnery::SeedKey::new(seed)
            .text(&p.id)
            .text("/")
            .number(p.sortie.unwrap_or(0))
            .text("/defense/")
            .number(state.sequence)
            .finish();
        let incoming = threat.map_or(state.fire_direction, |t| t.1);
        let across = dot(incoming, [p.heading.cos(), 0.0, p.heading.sin()]);
        // Wingmen break outwards, preserving their lateral order. The leader
        // turns away from the observed firing direction.
        state.side = if slot > 0 {
            if slot % 2 == 1 { -1.0 } else { 1.0 }
        } else if across.abs() > 0.1 {
            -across.signum()
        } else if key % 2 == 0 {
            1.0
        } else {
            -1.0
        };
        state.heading = p.heading + state.side * (0.35 + (key % 5) as f64 * 0.055);
        let descend = key % 3 == 0 && p.position[1] > 250.0;
        state.altitude = (p.position[1] + if descend { -65.0 } else { 45.0 }).max(70.0);
        state.maneuver_seconds = 4.0 + (key % 3) as f64;
        state.cooldown = state.maneuver_seconds + 10.0;
        state.sequence += 1;
        state.notice = Some(
            if committed {
                "Breaking off unsafe attack"
            } else if under_fire {
                "Evading gunfire"
            } else {
                "Evading fighter"
            }
            .into(),
        );
        if committed {
            set_opt_str(&mut p.pilot.attack_stage, "egress");
        }
    }
    if state.maneuver_seconds <= 0.0 {
        return false;
    }
    let point = [
        p.position[0] + state.heading.sin() * 900.0,
        state.altitude,
        p.position[2] - state.heading.cos() * 900.0,
    ];
    fly(
        p,
        point,
        if p.role == "dive-bomber" { 100.0 } else { 88.0 },
        dt,
        FlightOptions::default(),
    );
    true
}
