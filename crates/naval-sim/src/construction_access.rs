//! Adjustable access fittings. Mirrors the original access_geometry.ts member
//! recipe; native cells own support, clearance, distributed mass and inertia.
use crate::{
    construction_geometry as cg,
    construction_paths::{FittedPath, supported_surface},
    definition::*,
    geometry::*,
};

struct Member {
    name: &'static str,
    a: Vec3,
    b: Vec3,
    width: f64,
    depth: f64,
    round: bool,
}
fn add_member(
    out: &mut Vec<Member>,
    name: &'static str,
    a: Vec3,
    b: Vec3,
    width: f64,
    depth: f64,
    round: bool,
) {
    out.push(Member {
        name,
        a,
        b,
        width,
        depth,
        round,
    });
}
fn lerp(a: Vec3, b: Vec3, t: f64) -> Vec3 {
    add(a, scale(sub(b, a), t))
}
fn error(id: &str, message: &str) -> ConstructionDiagnostic {
    ConstructionDiagnostic {
        severity: "error".into(),
        code: "equipment-path".into(),
        source_id: Some(id.into()),
        message: message.into(),
    }
}

pub(crate) fn compile(
    e: &ConstructionEquipment,
    p: &ConstructionEquipmentPart,
    surfaces: &[ConstructionSurface],
    hull: &[cg::Cell],
    hull_index: &cg::Broadphase,
) -> Result<FittedPath, ConstructionDiagnostic> {
    let source = e.path.as_ref().unwrap();
    let stairs = p.path.as_ref().unwrap().kind == "inclined-ladder";
    let defaults = ConstructionAccessSettings {
        width_m: if stairs { 0.75 } else { 0.5 },
        stand_off_m: 0.2,
        handrails: "both".into(),
        grab_height_m: 0.9,
    };
    let settings = source.access.as_ref().unwrap_or(&defaults);
    let (width, stand, grab) = (
        settings.width_m,
        settings.stand_off_m,
        settings.grab_height_m,
    );
    if source.points.len() != 2
        || source.slack_m.unwrap_or(0.) != 0.
        || source.height_m.is_some()
        || source.rail_count.is_some()
        || !(0.35..=1.5).contains(&width)
        || !(0.12..=0.4).contains(&stand)
        || !(0.0..=1.2).contains(&grab)
        || !["both", "left", "right", "none"].contains(&settings.handrails.as_str())
    {
        return Err(error(
            &e.id,
            "Use two ladder endpoints, width 0.35–1.5 m, standoff 0.12–0.4 m and grab height 0–1.2 m",
        ));
    }
    let (mut a, mut b) = (source.points[0], source.points[1]);
    if b[1] < a[1] {
        std::mem::swap(&mut a, &mut b);
    }
    let delta = sub(b, a);
    let rise = delta[1];
    let run = delta[0].hypot(delta[2]);
    if !(0.5..=12.).contains(&rise) {
        return Err(error(&e.id, "Ladder rise must be 0.5–12 m"));
    }
    let pose = Pose {
        x: e.position[0],
        y: e.position[1],
        z: e.position[2],
        heading: e.bearing_deg.to_radians(),
        ..Default::default()
    };
    let world = |v| local_to_world(v, pose);
    let mut members = vec![];
    let mut anchors = vec![];
    if stairs {
        let angle = rise.atan2(run).to_degrees();
        if !(30.0..=75.0).contains(&angle) || run < 0.4 {
            return Err(error(
                &e.id,
                "Stairs need a 30–75° incline; move the upper or lower endpoint",
            ));
        }
        let forward = scale([delta[0], 0., delta[2]], 1. / run);
        let right = [-forward[2], 0., forward[0]];
        let top = add(b, scale(forward, -0.28));
        let count = (rise / 0.24).ceil() as usize;
        let going = (run - 0.28) / count as f64;
        let depth = (going + 0.035).clamp(0.16, 0.30);
        let side = |v, sign| add(v, scale(right, sign * (width / 2. + 0.02)));
        for sign in [-1., 1.] {
            let lower = side(add(a, [0., 0.075, 0.]), sign);
            let upper = side(add(top, [0., -0.055, 0.]), sign);
            add_member(&mut members, "stringer", lower, upper, 0.045, 0.12, false);
            add_member(
                &mut members,
                "foot-bracket",
                side(add(a, [0., 0.016, 0.]), sign),
                lower,
                0.055,
                0.08,
                false,
            );
            for point in [a, b] {
                let c = side(point, sign);
                anchors.push(world(c));
                add_member(
                    &mut members,
                    "deck-shoe",
                    add(add(c, scale(forward, -0.12)), [0., 0.016, 0.]),
                    add(add(c, scale(forward, 0.12)), [0., 0.016, 0.]),
                    0.14,
                    0.032,
                    false,
                );
            }
            add_member(
                &mut members,
                "landing-knee",
                upper,
                side(add(b, [0., 0.04, 0.]), sign),
                0.055,
                0.08,
                false,
            );
            if settings.handrails == "both"
                || settings.handrails == if sign < 0. { "left" } else { "right" }
            {
                let n = (run.hypot(rise) / 1.35).ceil().max(1.) as usize;
                for i in 0..=n {
                    let base = lerp(lower, upper, i as f64 / n as f64);
                    add_member(
                        &mut members,
                        "stanchion",
                        base,
                        add(base, [0., 0.95, 0.]),
                        0.032,
                        0.032,
                        true,
                    );
                }
                for (name, height, diameter) in
                    [("handrail", 0.95, 0.038), ("midrail", 0.49, 0.024)]
                {
                    add_member(
                        &mut members,
                        name,
                        add(lower, [0., height, 0.]),
                        add(upper, [0., height, 0.]),
                        diameter,
                        diameter,
                        true,
                    );
                }
            }
        }
        for i in 1..=count {
            let c = add(lerp(a, top, i as f64 / count as f64), [0., -0.022, 0.]);
            add_member(
                &mut members,
                "tread",
                add(c, scale(right, -width / 2.)),
                add(c, scale(right, width / 2.)),
                0.044,
                depth,
                false,
            );
        }
    } else {
        if delta[0].abs() > 0.01 || delta[2].abs() > rise * 0.5 {
            return Err(error(
                &e.id,
                "Framed ladders climb straight up the supporting wall",
            ));
        }
        let count = (rise / 0.30).ceil() as usize;
        let brackets = (rise / 1.5).ceil().max(1.) as usize;
        let outer = |v| add(v, [0., 0., -stand]);
        let normal = local_to_world(
            [0., 0., -1.],
            Pose {
                heading: pose.heading,
                ..Default::default()
            },
        );
        for sign in [-1., 1.] {
            let foot = add(a, [sign * (width / 2. + 0.018), 0., 0.]);
            let head = add(b, [sign * (width / 2. + 0.018), 0., 0.]);
            add_member(
                &mut members,
                "side-rail",
                outer(foot),
                add(outer(head), [0., grab, 0.]),
                0.036,
                0.06,
                false,
            );
            for i in 0..=brackets {
                let seat = lerp(foot, head, i as f64 / brackets as f64);
                let Some(wall) =
                    crate::construction_wall_fittings::project(surfaces, world(seat), normal, 0.1)
                else {
                    return Err(error(
                        &e.id,
                        "Every framed-ladder bracket needs a closed hull side",
                    ));
                };
                // Straight rails require the wall endpoints to be seated correctly.
                if length(sub(wall, world(seat))) > 0.015 {
                    return Err(error(
                        &e.id,
                        "Place both framed-ladder endpoints on the supporting wall",
                    ));
                }
                anchors.push(wall);
                add_member(
                    &mut members,
                    "wall-bracket",
                    seat,
                    outer(seat),
                    0.035,
                    0.035,
                    true,
                );
                let pad = add(seat, [0., 0., -0.008]);
                add_member(
                    &mut members,
                    "wall-pad",
                    add(pad, [0., -0.065, 0.]),
                    add(pad, [0., 0.065, 0.]),
                    0.09,
                    0.016,
                    false,
                );
            }
        }
        for i in 0..=count {
            let c = outer(lerp(a, b, i as f64 / count as f64));
            add_member(
                &mut members,
                "rung",
                add(c, [-width / 2., 0., 0.]),
                add(c, [width / 2., 0., 0.]),
                0.028,
                0.028,
                true,
            );
        }
    }
    for &anchor in &anchors {
        if !supported_surface(surfaces, anchor, None, stairs, 0.025) {
            return Err(error(
                &e.id,
                if stairs {
                    "Both feet at each end of the stairs need a closed deck surface"
                } else {
                    "Every ladder bracket needs a closed wall"
                },
            ));
        }
    }
    let mut cells = vec![];
    let mut masses = vec![];
    for m in &members {
        let z = normalize(sub(m.b, m.a));
        let x = if m.name == "tread" {
            [0., 1., 0.]
        } else if z[0].hypot(z[2]) > 1e-8 {
            scale([z[2], 0., -z[0]], 1. / z[0].hypot(z[2]))
        } else {
            [1., 0., 0.]
        };
        let y = cross(z, x);
        let center = scale(add(m.a, m.b), 0.5);
        let mut cell = cg::box_cell([0.; 3], [m.width, m.depth, length(sub(m.b, m.a))]);
        for face in std::sync::Arc::make_mut(&mut cell.faces) {
            for v in &mut face.vertices {
                *v = world(add(
                    center,
                    add(scale(x, v[0]), add(scale(y, v[1]), scale(z, v[2]))),
                ));
            }
        }
        for i in hull_index.candidates(&cell) {
            if let Some(overlap) =
                cg::intersection(&cell, &hull[i]).filter(|c| cg::moments(c).volume > 1e-7)
            {
                // Mounting knees and rail ends may seat locally into their own
                // anchors; this never grants a corridor through an entire hull.
                let seated = overlap
                    .faces
                    .iter()
                    .flat_map(|f| &f.vertices)
                    .all(|&v| anchors.iter().any(|&a| length(sub(v, a)) <= 0.18));
                if !seated {
                    return Err(error(
                        &e.id,
                        "A ladder member intersects the hull; move the endpoints clear of the deck edge",
                    ));
                }
            }
        }
        // Provisional steel loading: channel stringers and folded treads use
        // their material fraction, tubes a 35% area fraction of the envelope.
        let fraction = if m.round {
            std::f64::consts::PI / 4. * 0.35
        } else {
            match m.name {
                "tread" => 0.18,
                "stringer" => 0.22,
                _ => 1.,
            }
        };
        masses.push((cg::moments(&cell), 7850. * fraction));
        cells.push(cell);
    }
    let base = p.mass_kg.unwrap_or(1.);
    let mass_kg = base + masses.iter().map(|(m, d)| m.volume * d).sum::<f64>();
    let midpoint = scale(add(world(a), world(b)), 0.5);
    let center = scale(
        masses.iter().fold(scale(midpoint, base), |sum, (m, d)| {
            add(sum, scale(m.center(), m.volume * d))
        }),
        1. / mass_kg,
    );
    let shift = sub(midpoint, center);
    let inertia = masses.iter().fold(
        std::array::from_fn(|i| base * (dot(shift, shift) - shift[i] * shift[i])),
        |sum, (m, d)| add(sum, m.inertia(*d, center)),
    );
    Ok(FittedPath {
        cells,
        mass: ConstructionMass {
            id: e.id.clone(),
            kind: "equipment".into(),
            mass_kg,
            center,
            inertia_kg_m2: inertia,
        },
    })
}
