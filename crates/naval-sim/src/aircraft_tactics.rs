use crate::{
    aircraft::{Aircraft, in_flight},
    aircraft_flight::{FlightOptions, fly},
    definition::Vec3,
    geometry::*,
};
pub fn fighter_target(
    p: &mut Aircraft,
    planes: &[&Aircraft],
    carrier: Vec3,
    dt: f64,
    target_flight: Option<&str>,
) -> Option<usize> {
    p.pilot.think -= dt;
    let current = planes.iter().position(|o| {
        Some(&o.id) == p.pilot.hostile_id.as_ref()
            && target_flight.is_none_or(|id| o.flight_id.as_deref() == Some(id))
            && o.team != p.team
            && in_flight(o)
    });
    if p.pilot.think > 0.0
        && let Some(i) = current
        && length(sub(planes[i].position, p.position)) < 6500.0
        && length(sub(planes[i].position, carrier)) < 7500.0
    {
        return Some(i);
    }
    p.pilot.think = 0.65;
    let mut engagements = std::collections::BTreeMap::<&str, u32>::new();
    for ally in planes {
        if ally.id != p.id
            && ally.team == p.team
            && in_flight(ally)
            && let Some(id) = &ally.pilot.hostile_id
        {
            *engagements.entry(id).or_default() += 1;
        }
    }
    let mut best = None;
    let mut best_score = f64::INFINITY;
    for (i, o) in planes.iter().enumerate() {
        if o.team == p.team
            || !in_flight(o)
            || target_flight.is_some_and(|id| o.flight_id.as_deref() != Some(id))
        {
            continue;
        }
        let distance = length(sub(o.position, p.position));
        let home = length(sub(o.position, carrier));
        if distance > 6500.0 || home > 7500.0 {
            continue;
        }
        let inbound = dot(o.velocity, sub(carrier, o.position)) > 0.0;
        let threat = if o.payload && inbound && home < 4500.0 {
            0.5
        } else {
            1.0
        };
        let engaged = engagements.get(o.id.as_str()).copied().unwrap_or(0);
        let score = (distance + home * 0.15)
            * threat
            * if Some(i) == current { 0.7 } else { 1.0 }
            * (1.0 + f64::from(engaged) * 0.35);
        if score < best_score {
            best = Some(i);
            best_score = score;
        }
    }
    let id = best.map(|i| planes[i].id.clone());
    if p.pilot.hostile_id != id {
        p.pilot.aim_time = 0.0;
    }
    p.pilot.hostile_id = id;
    best
}
#[derive(Clone, Copy, Debug, serde::Serialize)]
pub struct FighterAim {
    pub time: f64,
    pub alignment: f64,
    pub direction: Vec3,
    pub distance: f64,
    pub point: Vec3,
}
pub fn fighter_gun_aim(p: &Aircraft, hostile: &Aircraft) -> FighterAim {
    let relative = sub(hostile.position, p.position);
    let velocity = sub(hostile.velocity, p.velocity);
    let a = dot(velocity, velocity) - 720.0_f64.powi(2);
    let b = 2.0 * dot(relative, velocity);
    let c = dot(relative, relative);
    let discriminant = b * b - 4.0 * a * c;
    let time = if discriminant >= 0.0 {
        [
            (-b - discriminant.sqrt()) / (2.0 * a),
            (-b + discriminant.sqrt()) / (2.0 * a),
        ]
        .into_iter()
        .filter(|t| *t > 0.0 && t.is_finite())
        .reduce(f64::min)
    } else {
        None
    }
    .unwrap_or_else(|| length(relative) / 720.0);
    let direction = normalize(add(relative, scale(velocity, time)));
    FighterAim {
        time,
        alignment: dot(p.forward(), direction),
        direction,
        distance: length(relative),
        point: add(hostile.position, scale(hostile.velocity, time)),
    }
}
pub fn clear_fighter_lane(p: &Aircraft, aim: Vec3, planes: &[&Aircraft]) -> bool {
    let ray = sub(aim, p.position);
    let distance = length(ray);
    let direction = normalize(ray);
    !planes.iter().any(|o| {
        if o.id == p.id || o.team != p.team || !in_flight(o) {
            return false;
        }
        let relative = sub(o.position, p.position);
        let along = dot(relative, direction);
        along > 0.0 && along < distance && length(sub(relative, scale(direction, along))) < 18.0
    })
}
pub fn steer_fighter(p: &mut Aircraft, hostile: &Aircraft, planes: &[&Aircraft], dt: f64) -> bool {
    let delta = sub(hostile.position, p.position);
    let distance = length(delta);
    p.pilot.break_cooldown = (p.pilot.break_cooldown - dt).max(0.0);
    let forward = normalize(p.velocity);
    let threatened = planes.iter().any(|o| {
        o.team != p.team
            && o.role == "fighter"
            && in_flight(o)
            && length(sub(o.position, p.position)) < 450.0
            && dot(forward, normalize(sub(o.position, p.position))) < -0.65
            && dot(
                normalize(o.velocity),
                normalize(sub(p.position, o.position)),
            ) > 0.9
    });
    if p.pilot.break_time <= 0.0
        && p.pilot.break_cooldown <= 0.0
        && (distance < 160.0 || threatened)
    {
        p.pilot.break_time = 4.0;
        p.pilot.break_cooldown = 11.0;
        let side = if !p.id.encode_utf16().last().unwrap_or(0).is_multiple_of(2) {
            1.0
        } else {
            -1.0
        };
        p.pilot.break_point = Some(add(
            p.position,
            [
                (p.heading + side * 0.85).sin() * 1100.0,
                if p.position[1] < 200.0 { 90.0 } else { 40.0 },
                -(p.heading + side * 0.85).cos() * 1100.0,
            ],
        ));
    }
    if p.pilot.break_time > 0.0
        && let Some(point) = p.pilot.break_point
    {
        p.pilot.break_time -= dt;
        p.pilot.aim_time = 0.0;
        fly(p, point, 116.0, dt, FlightOptions::default());
        return false;
    }
    let aim = add(
        hostile.position,
        scale(hostile.velocity, clamp(distance / 220.0, 0.15, 2.5)),
    );
    let tail =
        dot(forward, normalize(hostile.velocity)) > 0.6 && dot(forward, normalize(delta)) > 0.7;
    let speed = if tail && distance < 400.0 {
        clamp(
            length(hostile.velocity) + (distance - 220.0) * 0.07,
            65.0,
            115.0,
        )
    } else {
        115.0
    };
    fly(p, aim, speed, dt, FlightOptions::default());
    true
}
pub fn orbit_point(p: &Aircraft, anchor: Vec3, radius: f64, side: f64) -> Vec3 {
    let angle = (p.position[0] - anchor[0]).atan2(p.position[2] - anchor[2]) + side * 0.65;
    add(anchor, [angle.sin() * radius, 0.0, angle.cos() * radius])
}
pub fn strike_ingress(p: &mut Aircraft, target_heading: f64, target: Vec3) -> Vec3 {
    if p.pilot.attack_heading.is_none() {
        p.pilot.attack_heading = Some(if p.role == "torpedo-bomber" {
            let side = if (p.position[0] - target[0]) * target_heading.cos()
                + (p.position[2] - target[2]) * target_heading.sin()
                > 0.0
            {
                -1.0
            } else {
                1.0
            };
            target_heading + side * std::f64::consts::FRAC_PI_2
        } else {
            (target[0] - p.position[0]).atan2(p.position[2] - target[2])
        });
        p.pilot.attack_stage = Some("ingress".into());
    }
    let heading = p.pilot.attack_heading.unwrap();
    let stand = if p.role == "torpedo-bomber" {
        2600.0
    } else {
        3000.0
    };
    [
        target[0] - heading.sin() * stand,
        if p.role == "torpedo-bomber" {
            90.0
        } else {
            850.0
        },
        target[2] + heading.cos() * stand,
    ]
}
