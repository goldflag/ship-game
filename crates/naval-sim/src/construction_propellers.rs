//! Automatic external shaft runs and bearing braces. These add weight and
//! clearance bodies, never sealed hull volume or an engine-power bonus.
use crate::{construction_geometry as cg, definition::*, geometry::*};
type Member = ConstructionPropellerSupportMembersItem;

/// First hull face along a ray, including openings (which cannot carry a bearing).
fn hull_hit(
    surfaces: &[ConstructionSurface],
    start: Vec3,
    direction: Vec3,
    reach: f64,
) -> Option<Vec3> {
    let hit = surfaces
        .iter()
        .filter_map(|s| {
            let denominator = dot(s.normal, direction);
            if denominator >= -1e-6 {
                return None;
            }
            let distance = dot(sub(s.vertices[0], start), s.normal) / denominator;
            if distance < 0.05 || distance > reach {
                return None;
            }
            let point = add(start, scale(direction, distance));
            let inside = s
                .vertices
                .iter()
                .zip(s.vertices.iter().cycle().skip(1))
                .all(|(a, b)| dot(cross(sub(*b, *a), sub(point, *a)), s.normal) >= -1e-7);
            inside.then_some((distance, point, s.open))
        })
        .min_by(|a, b| a.0.total_cmp(&b.0))?;
    // Seat the end 2 cm into the skin to avoid a floating tangent connection.
    (!hit.2).then(|| add(hit.1, scale(direction, 0.02)))
}

pub(crate) fn derive(
    e: &ConstructionEquipment,
    p: &ConstructionEquipmentPart,
    surfaces: &[ConstructionSurface],
) -> Option<ConstructionPropellerSupport> {
    if p.kind != "propeller" || p.placement != "underwater" {
        return None;
    }
    let socket = p.sockets.as_ref()?.iter().find(|s| s.id == "attachment")?;
    let pose = Pose {
        x: e.position[0],
        y: e.position[1],
        z: e.position[2],
        heading: e.bearing_deg.to_radians(),
        ..Default::default()
    };
    let start = local_to_world(socket.position, pose);
    let forward = normalize(sub(local_to_world(socket.direction, pose), e.position));
    if forward[1].abs() > 0.1 || length(forward) < 0.9 {
        return None;
    }
    let diameter = p.size[0].max(p.size[1]);
    let reach = (diameter * 4.).clamp(2., 20.);
    let radius = (diameter * 0.04).clamp(0.03, 0.22);
    let end = hull_hit(surfaces, start, forward, reach);
    let shaft_length = end.map_or(diameter * 0.65, |end| length(sub(end, start)));
    // A brace sits forward of the existing bearing, clear of the entire blade sweep.
    let bearing = add(start, scale(forward, shaft_length.min(diameter * 0.65)));
    let right = normalize(cross(forward, [0., 1., 0.]));
    let mut braces = vec![];
    for side in [-1., 1.] {
        let direction = normalize(add([0., 1., 0.], scale(right, side * 0.55)));
        if let Some(top) = hull_hit(surfaces, bearing, direction, reach.min(10.)) {
            braces.push(Member {
                start: bearing,
                end: top,
                radius_m: radius * 0.7,
                kind: "strut".into(),
            });
        }
    }
    if braces.is_empty()
        && let Some(top) = hull_hit(surfaces, bearing, [0., 1., 0.], reach.min(10.)) {
            braces.push(Member {
                start: bearing,
                end: top,
                radius_m: radius * 0.7,
                kind: "strut".into(),
            });
        }
    if end.is_none() && braces.is_empty() {
        return None;
    }
    let mut members = vec![Member {
        start: add(start, scale(forward, -0.02)),
        end: end.unwrap_or(bearing),
        radius_m: radius,
        kind: "shaft".into(),
    }];
    members.extend(braces);
    Some(ConstructionPropellerSupport {
        equipment_id: e.id.clone(),
        members,
    })
}

/// Matching 24-sided cylinders for physical fit, mass and exported visuals.
pub(crate) fn cell(m: &Member) -> cg::Cell {
    let along = normalize(sub(m.end, m.start));
    let reference = if along[1].abs() < 0.95 {
        [0., 1., 0.]
    } else {
        [1., 0., 0.]
    };
    let right = normalize(cross(reference, along));
    let up = cross(along, right);
    let cap: Vec<_> = (0..24)
        .map(|i| {
            let angle = i as f64 * std::f64::consts::TAU / 24.;
            add(
                m.end,
                add(
                    scale(right, m.radius_m * angle.cos()),
                    scale(up, m.radius_m * angle.sin()),
                ),
            )
        })
        .collect();
    cg::prism(&cap, length(sub(m.end, m.start)))
}
