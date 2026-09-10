use crate::{
    aircraft::{Aircraft, PlaneView, set_opt_str, set_str},
    aircraft_flight::{FlightOptions, fly},
    definition::Vec3,
    geometry::*,
};
#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FighterManeuver {
    pub kind: String,
    pub speed: f64,
    pub pursuit_seconds: f64,
}

fn threatens(hostile: &PlaneView<'_>, ally: &PlaneView<'_>) -> bool {
    let delta = sub(ally.position, hostile.position);
    length(delta) < 650.0
        && dot(normalize(hostile.velocity), normalize(delta)) > 0.85
        && dot(normalize(ally.velocity), normalize(scale(delta, -1.0))) < -0.55
}
pub fn fighter_target(
    p: &mut Aircraft,
    planes: &[PlaneView<'_>],
    carrier: Vec3,
    dt: f64,
    target_flight: Option<&str>,
) -> Option<usize> {
    p.pilot.think = (p.pilot.think - dt).max(0.0);
    let best = crate::fighter_coordination::target(p, planes, carrier, target_flight);
    let id = best.map(|i| planes[i].id);
    // The stored identity is unchanged when it already matches, so the string
    // is only reallocated when the pilot actually switches tracks.
    if p.pilot.hostile_id.as_deref() != id {
        p.pilot.aim_time = 0.0;
        p.pilot.hostile_id = id.map(str::to_owned);
    }
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
pub fn fighter_gun_aim(p: &Aircraft, hostile: &PlaneView<'_>) -> FighterAim {
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
/// Accumulate a continuous firing solution, independently of navigation lead.
pub fn fighter_fire_ready(
    p: &mut Aircraft,
    gun: &FighterAim,
    pursuing: bool,
    lane_clear: bool,
    dt: f64,
) -> bool {
    let panic = p.pilot.fire_discipline.as_ref().is_some_and(|d| d.panic);
    let on_aim = pursuing
        && gun.distance > 80.0
        && gun.distance < if panic { 220.0 } else { 320.0 }
        && gun.alignment > if panic { 0.9985 } else { 0.997 }
        && p.bank.abs() < 1.15
        && lane_clear
        && p.cooldown <= 0.0;
    p.pilot.aim_time = if on_aim { p.pilot.aim_time + dt } else { 0.0 };
    on_aim && p.pilot.aim_time >= if panic { 0.45 } else { 0.18 } && p.cooldown <= 0.0
}
pub fn clear_fighter_lane(p: &Aircraft, aim: Vec3, planes: &[PlaneView<'_>]) -> bool {
    let ray = sub(aim, p.position);
    let distance = length(ray);
    let direction = normalize(ray);
    !planes.iter().any(|o| {
        if o.id == p.id || o.team != p.team || !o.in_flight() {
            return false;
        }
        let relative = sub(o.position, p.position);
        let along = dot(relative, direction);
        along > 0.0 && along < distance && length(sub(relative, scale(direction, along))) < 18.0
    })
}
pub fn steer_fighter(
    p: &mut Aircraft,
    hostile: &PlaneView<'_>,
    planes: &[PlaneView<'_>],
    dt: f64,
) -> bool {
    let delta = sub(hostile.position, p.position);
    let distance = length(delta);
    p.pilot.break_cooldown = (p.pilot.break_cooldown - dt).max(0.0);
    p.pilot.break_time = (p.pilot.break_time - dt).max(0.0);
    let forward = normalize(p.velocity);
    let threatened = planes.iter().any(|o| {
        o.team != p.team
            && o.role == "fighter"
            && o.in_flight()
            && length(sub(o.position, p.position)) < 450.0
            && dot(forward, normalize(sub(o.position, p.position))) < -0.65
            && dot(
                normalize(o.velocity),
                normalize(sub(p.position, o.position)),
            ) > 0.9
    });
    let closing = dot(sub(p.velocity, hostile.velocity), normalize(delta));
    let alignment = dot(forward, normalize(delta));
    let speed_advantage = length(p.velocity) - length(hostile.velocity);
    let maneuver = p.pilot.maneuver.get_or_insert_default();
    maneuver.pursuit_seconds = if alignment < 0.8 && distance < 1400.0 {
        maneuver.pursuit_seconds + dt
    } else {
        0.0
    };
    if p.pilot.break_time <= 0.0 && p.pilot.break_cooldown <= 0.0 {
        let key = crate::air_gunnery::SeedKey::new(0)
            .text(&p.id)
            .text("/")
            .number(p.sortie.unwrap_or(0))
            .text("/maneuver")
            .finish();
        let side = if key % 2 == 0 { 1.0 } else { -1.0 };
        let choice = if threatened {
            // Draw a pursuer across a nearby wingman's nose when one is available.
            let support = planes
                .iter()
                .filter(|a| {
                    a.id != p.id && a.team == p.team && a.role == "fighter" && a.in_flight()
                })
                .filter(|a| length(sub(a.position, p.position)) < 1600.0)
                .min_by(|a, b| {
                    length(sub(a.position, p.position))
                        .total_cmp(&length(sub(b.position, p.position)))
                });
            let heading = support.map_or(p.heading + side * 1.1, |a| {
                (a.position[0] - p.position[0]).atan2(p.position[2] - a.position[2])
            });
            Some((
                "defensive-break",
                add(
                    p.position,
                    [
                        heading.sin() * 1100.0,
                        if p.position[1] > 300.0 && key % 3 == 0 {
                            -80.0
                        } else {
                            90.0
                        },
                        -heading.cos() * 1100.0,
                    ],
                ),
                116.0,
                4.0,
            ))
        } else if distance < 150.0
            || distance < 280.0
                && closing > 45.0
                && alignment > 0.7
                && dot(forward, normalize(hostile.velocity)) > 0.6
        {
            Some((
                "extend",
                add(
                    p.position,
                    [p.heading.sin() * 1400.0, 60.0, -p.heading.cos() * 1400.0],
                ),
                120.0,
                4.5,
            ))
        } else if distance < 1000.0
            && alignment < 0.75
            && speed_advantage > 20.0
            && p.position[1] > 150.0
            // Spend existing height advantage closing on a lower target;
            // another climb would repeatedly postpone low-level interception.
            && p.position[1] - hostile.position[1] < 150.0
        {
            let mut point = add(hostile.position, scale(hostile.velocity, -1.5));
            point[1] = p.position[1] + 120.0;
            Some(("high-yo-yo", point, 88.0, 3.5))
        } else if maneuver.pursuit_seconds > 18.0 && distance > 350.0 {
            let mut point = add(hostile.position, scale(hostile.velocity, -3.0));
            point[0] += side * 350.0;
            point[2] += side * 180.0;
            point[1] = (hostile.position[1] - 80.0).max(100.0);
            Some(("reposition", point, 108.0, 4.0))
        } else {
            None
        };
        if let Some((kind, point, speed, seconds)) = choice {
            set_str(&mut maneuver.kind, kind);
            maneuver.speed = speed;
            maneuver.pursuit_seconds = 0.0;
            p.pilot.break_point = Some(point);
            p.pilot.break_time = seconds;
            p.pilot.break_cooldown = seconds + 7.0;
        }
    }
    if p.pilot.break_time > 0.0
        && let Some(point) = p.pilot.break_point
    {
        p.pilot.aim_time = 0.0;
        let speed = p.pilot.maneuver.as_ref().unwrap().speed;
        fly(p, point, speed, dt, FlightOptions::default());
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
    let covering = planes
        .iter()
        .any(|a| a.id != p.id && a.team == p.team && a.in_flight() && threatens(hostile, a));
    set_str(
        &mut p.pilot.maneuver.as_mut().unwrap().kind,
        if covering {
            "cover-wingman"
        } else if tail {
            "tail-pursuit"
        } else {
            "lead-pursuit"
        },
    );
    // Trim excess closure before reaching the overshoot gate. Gun lead remains
    // independent of this navigation aim and still requires a clear friendly lane.
    let navigation_aim = if tail && distance < 450.0 && closing > 12.0 {
        add(hostile.position, scale(hostile.velocity, -0.7))
    } else {
        aim
    };
    // Convert a substantial altitude advantage before passing overhead. The
    // normal flight controller still owns pitch rate and low-altitude pullout.
    let diving = p.position[1] > hostile.position[1] + 150.0;
    fly(
        p,
        navigation_aim,
        speed,
        dt,
        FlightOptions {
            dive: diving,
            ..FlightOptions::default()
        },
    );
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
        set_opt_str(&mut p.pilot.attack_stage, "ingress");
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
