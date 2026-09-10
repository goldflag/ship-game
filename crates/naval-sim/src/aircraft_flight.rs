use crate::{aircraft::Aircraft, definition::Vec3, geometry::*};
use serde::{Deserialize, Serialize};
pub const TAKEOFF_ROLL_SECONDS: f64 = 3.6;
pub const TAKEOFF_CLIMB_SECONDS: f64 = 2.4;
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct FlightControls {
    pub gear: f64,
    pub hook: f64,
    pub brakes: f64,
    pub aileron: f64,
    pub elevator: f64,
    pub rudder: f64,
    pub propeller: f64,
}
impl Default for FlightControls {
    fn default() -> Self {
        Self {
            gear: 1.0,
            hook: 0.0,
            brakes: 0.0,
            aileron: 0.0,
            elevator: 0.0,
            rudder: 0.0,
            propeller: 0.0,
        }
    }
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct FlightAttitude {
    pub heading: f64,
    pub pitch: f64,
    pub bank: f64,
}
#[derive(Clone, Copy, Debug, Default)]
pub struct FlightOptions {
    pub dive: bool,
    pub landing: bool,
    pub bank_limit: Option<f64>,
    pub altitude_lookahead: Option<f64>,
    pub turn_rate: f64,
}
pub fn approach(value: f64, target: f64, rate: f64, dt: f64) -> f64 {
    value + clamp(target - value, -rate * dt, rate * dt)
}
pub fn fly(p: &mut Aircraft, point: Vec3, requested_speed: f64, dt: f64, options: FlightOptions) {
    if dt <= 0.0 {
        return;
    }
    p.navigation_target = Some(point);
    let performance = crate::aircraft_performance::performance_for(p);
    let min_speed = performance.min_speed;
    let speed = length(p.velocity).max(min_speed);
    let (dx, dz) = (point[0] - p.position[0], point[2] - p.position[2]);
    let horizontal = dx.hypot(dz);
    let error = wrap_angle(dx.atan2(-dz) - p.heading);
    let max_bank = options
        .bank_limit
        .unwrap_or(if options.landing {
            0.38
        } else {
            performance.max_bank
        })
        .min(performance.max_bank);
    let desired = clamp(
        -((error / 2.2 + options.turn_rate) * speed / 9.81).atan(),
        -max_bank,
        max_bank,
    );
    let (old_bank, old_pitch) = (p.bank, p.pitch);
    p.bank = approach(p.bank, desired, performance.roll_rate, dt);
    let turn = -9.81 * p.bank.tan() / (speed * p.pitch.cos()).max(30.0);
    p.heading = wrap_angle(p.heading + turn * dt);
    let mut desired_pitch = clamp(
        (point[1] - p.position[1]).atan2(
            horizontal
                .min(options.altitude_lookahead.unwrap_or(f64::INFINITY))
                .max(if options.landing { 45.0 } else { speed * 2.0 }),
        ),
        if options.dive { -1.05 } else { -0.24 },
        performance
            .climb_pitch
            .min((performance.climb_rate / speed).min(1.0).asin()),
    );
    let pullout = 22.0 + (-p.velocity[1]).max(0.0) * 3.0;
    if !options.landing && p.position[1] < pullout {
        desired_pitch = desired_pitch.max(0.12);
    }
    p.pitch = approach(
        p.pitch,
        desired_pitch,
        if options.dive { 0.25 } else { 0.18 },
        dt,
    );
    // Recovery and launch prescribe carrier-relative speeds. Cruise/attack orders
    // use airframe scaling so differences are present below the maximum speed too.
    let prescribed = options.landing || p.phase == "takeoff";
    let requested = requested_speed
        * if prescribed {
            1.0
        } else {
            performance.speed_scale
        };
    let drag = p.bank.abs() * performance.turn_drag + p.controls.brakes * 14.0;
    let target = (requested.min(performance.max_speed) - p.pitch.sin() * 30.0 - drag)
        .clamp(min_speed, performance.max_speed);
    // Climbing spends kinetic energy against gravity; bank adds induced drag.
    // Descents recover energy, with airspeed bounded by the airframe limit.
    let energy_cost = if prescribed {
        0.0
    } else {
        9.81 * p.pitch.sin() + performance.turn_drag * p.bank.sin().powi(2) * 0.45
    };
    let acceleration = (performance.acceleration - energy_cost).max(0.5);
    let next = approach(
        speed,
        target,
        if target >= speed {
            acceleration
        } else {
            performance.acceleration + energy_cost.max(0.0)
        },
        dt,
    );
    p.velocity = scale(p.forward(), next);
    p.position = add(p.position, scale(p.velocity, dt));
    p.controls.aileron = clamp((p.bank - old_bank) / dt * 0.45, -0.35, 0.35);
    p.controls.elevator = clamp(
        -(p.pitch - old_pitch) / dt * 0.8 - p.bank.abs() * 0.035,
        -0.3,
        0.3,
    );
    p.controls.rudder = clamp(turn * 0.28, -0.16, 0.16);
}
pub fn step_mechanisms(p: &mut Aircraft, dt: f64, deck: bool) {
    let c = &mut p.controls;
    let parked = matches!(p.phase.as_str(), "ready" | "queued" | "rearming");
    let gear = deck
        || p.phase == "landing"
        || p.phase == "takeoff" && p.timer < TAKEOFF_ROLL_SECONDS + 1.5;
    c.gear = approach(c.gear, if gear { 1.0 } else { 0.0 }, 0.35, dt);
    c.hook = approach(
        c.hook,
        if matches!(p.phase.as_str(), "landing" | "rollout") {
            1.0
        } else {
            0.0
        },
        0.5,
        dt,
    );
    c.brakes = approach(
        c.brakes,
        if p.role == "dive-bomber" && p.phase == "attack" && p.pitch < -0.3 && p.payload {
            1.0
        } else {
            0.0
        },
        0.8,
        dt,
    );
    c.propeller = wrap_angle(
        c.propeller
            + if parked {
                0.0
            } else if deck {
                35.0
            } else {
                95.0
            } * dt,
    );
    if deck {
        c.aileron = approach(c.aileron, 0.0, 0.5, dt);
        c.elevator = approach(c.elevator, 0.0, 0.5, dt);
        c.rudder = approach(c.rudder, 0.0, 0.5, dt);
    }
}
