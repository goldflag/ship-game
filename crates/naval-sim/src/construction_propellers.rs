//! Automatic external shaft runs, faired bearing housings and hull-seated fins.
//! The same native lofts own visual geometry, clearance and provisional steel mass.
//! They never add sealed hull volume or an engine-power bonus.
use crate::{construction_geometry as cg, definition::*, geometry::*};
type Member = ConstructionPropellerSupportMembersItem;
type Contact = ConstructionPropellerSupportMembersItemHullContact;
const SIDES: usize = 24;

/// First hull face along a ray, including openings (which cannot carry a bearing).
fn hull_hit(
    surfaces: &[ConstructionSurface],
    start: Vec3,
    direction: Vec3,
    reach: f64,
) -> Option<Contact> {
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
            inside.then_some((distance, point, s))
        })
        .min_by(|a, b| a.0.total_cmp(&b.0))?;
    (!hit.2.open).then_some(Contact {
        point: hit.1,
        normal: hit.2.normal,
    })
}
fn seat(hit: &Contact) -> Vec3 {
    sub(hit.point, scale(hit.normal, 0.02))
}

/// Homothetic elliptical rings give closed convex frusta between sections.
/// The last ring is sheared onto the actual hull plane, not a floating tangent.
// The loft is one geometric primitive; its eight inputs are all independent.
#[allow(clippy::too_many_arguments)]
fn loft(
    start: Vec3,
    end: Vec3,
    width_axis: Vec3,
    radius: f64,
    aspect: f64,
    profile: &[(f64, f64)],
    kind: &str,
    contact: Option<Contact>,
) -> Member {
    let along = normalize(sub(end, start));
    let width = normalize(sub(width_axis, scale(along, dot(width_axis, along))));
    let thick = normalize(cross(along, width));
    let mut rings: Vec<Vec<Vec3>> = profile
        .iter()
        .map(|(t, size)| {
            let center = add(start, scale(sub(end, start), *t));
            (0..SIDES)
                .map(|j| {
                    let a = j as f64 * std::f64::consts::TAU / SIDES as f64;
                    add(
                        center,
                        add(
                            scale(width, radius * size * aspect * a.cos()),
                            scale(thick, radius * size * a.sin()),
                        ),
                    )
                })
                .collect()
        })
        .collect();
    if let Some(hit) = &contact {
        for (i, ring) in rings.iter_mut().enumerate() {
            if kind == "shaft" && i + 1 != profile.len() {
                continue;
            }
            let center = add(start, scale(sub(end, start), profile[i].0));
            // Parallel oblique sections keep tapered loft faces planar/convex.
            // Shearing just the final flared ring twists the intervening quads.
            for point in ring {
                *point = sub(
                    *point,
                    scale(
                        along,
                        dot(sub(*point, center), hit.normal) / dot(along, hit.normal),
                    ),
                );
            }
        }
    }
    Member {
        start,
        end,
        radius_m: radius,
        kind: kind.into(),
        rings: Some(rings),
        hull_contact: contact,
    }
}
fn radial_axis(along: Vec3) -> Vec3 {
    normalize(cross(
        if along[1].abs() < 0.95 {
            [0., 1., 0.]
        } else {
            [1., 0., 0.]
        },
        along,
    ))
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
    let brace_reach = (diameter * 4.).clamp(2., 10.);
    let radius = (diameter * 0.04).clamp(0.03, 0.22);
    // Trace to the actual hull, regardless of shaft length. The finite hull
    // faces bound the result; the normal support clearance checks still apply.
    let hit = hull_hit(surfaces, start, forward, f64::INFINITY);
    let shaft_length = hit
        .as_ref()
        .map_or(diameter * 0.65, |h| length(sub(seat(h), start)));
    let bearing = add(
        start,
        scale(forward, shaft_length.min(diameter * 0.65) * 0.45),
    );
    let right = normalize(cross(forward, [0., 1., 0.]));
    let lateral = dot(e.position, right);
    let directions = if lateral.abs() < radius {
        [-0.55, 0.55]
    } else {
        [0., -lateral.signum() * 0.7]
    };
    let mut braces = vec![];
    // A short direct shaft needs only a hull-exit fairing, not a fin through the hull.
    if shaft_length > diameter * 0.35 {
        for side in directions {
            let direction = normalize(add([0., 1., 0.], scale(right, side)));
            if let Some(top) = hull_hit(surfaces, bearing, direction, brace_reach) {
                // Avoid a grazing side-plating hit: its projected foot becomes
                // an enormous fin. The inward brace can still seat underneath.
                if top.normal[1] > -0.15 || dot(direction, top.normal) > -0.3 {
                    continue;
                }
                let end = seat(&top);
                let span = length(sub(end, bearing));
                let thickness = (radius * 0.48).min(span * 0.08);
                braces.push(loft(
                    bearing,
                    end,
                    forward,
                    thickness,
                    6.,
                    &[(0., 1.65), (0.13, 1.), (0.78, 1.), (0.92, 1.25), (1., 1.85)],
                    "strut",
                    Some(top),
                ));
            }
        }
    }
    if hit.is_none() && braces.is_empty() {
        return None;
    }
    let housing_end = add(bearing, scale(forward, diameter * 0.22));
    let end = hit.as_ref().map_or(housing_end, seat);
    let shaft_start = add(start, scale(forward, -0.02));
    let mut members = vec![loft(
        shaft_start,
        end,
        radial_axis(forward),
        radius,
        1.,
        &[(0., 1.), (1., 1.)],
        "shaft",
        hit.clone(),
    )];
    if !braces.is_empty() {
        members.push(loft(
            shaft_start,
            housing_end,
            radial_axis(forward),
            radius,
            1.,
            &[
                (0., 1.04),
                (0.12, 1.72),
                (0.24, 1.85),
                (0.78, 1.85),
                (0.91, 1.60),
                (1., 1.04),
            ],
            "bearing",
            None,
        ));
    }
    members.extend(braces);
    if let Some(contact) = hit {
        let length = (diameter * 0.75).min(shaft_length * 0.48);
        // A tapered, flared exit shares the shaft's axis and seats into the closed skin.
        members.push(loft(
            sub(end, scale(forward, length)),
            end,
            radial_axis(forward),
            radius,
            1.,
            &[
                (0., 1.03),
                (0.18, 1.3),
                (0.60, 2.05),
                (0.84, 2.5),
                (1., 2.85),
            ],
            "fairing",
            Some(contact),
        ));
    }
    Some(ConstructionPropellerSupport {
        equipment_id: e.id.clone(),
        members,
    })
}

/// Every consecutive pair is a convex clearance/mass cell. Visuals use the same
/// native rings, omitting internal caps so smooth normals cross ring boundaries.
pub(crate) fn cells(m: &Member) -> Vec<cg::Cell> {
    let rings = m.rings.clone().unwrap_or_else(|| {
        loft(
            m.start,
            m.end,
            radial_axis(normalize(sub(m.end, m.start))),
            m.radius_m,
            1.,
            &[(0., 1.), (1., 1.)],
            &m.kind,
            None,
        )
        .rings
        .unwrap()
    });
    rings
        .windows(2)
        .map(|pair| {
            let (a, b) = (&pair[0], &pair[1]);
            let mut faces = vec![
                ConvexVolumeFacesItem {
                    vertices: a.iter().copied().rev().collect(),
                },
                ConvexVolumeFacesItem {
                    vertices: b.clone(),
                },
            ];
            for i in 0..a.len() {
                let j = (i + 1) % a.len();
                faces.push(ConvexVolumeFacesItem {
                    vertices: vec![a[i], a[j], b[j], b[i]],
                });
            }
            cg::Cell {
                faces: faces.into(),
            }
        })
        .collect()
}

/// Hull penetration is confined to the explicitly declared attachment skin.
/// A fin crossing another hull section or a shaft crossing a hull is still invalid.
pub(crate) fn crosses_hull(m: &Member, cell: &cg::Cell, hull: &[cg::Cell]) -> bool {
    hull.iter()
        .filter_map(|h| cg::intersection(cell, h))
        .any(|overlap| {
            let Some(hit) = &m.hull_contact else {
                return cg::moments(&overlap).volume > 1e-5;
            };
            let plane = dot(hit.normal, hit.point);
            // Only a thin slab at the actual contact is allowed. Another hull
            // section can protrude outside this face's plane on a nonconvex ship.
            [
                (hit.normal, plane - 0.04),
                (scale(hit.normal, -1.), -plane - 0.04),
            ]
            .iter()
            .any(|(normal, offset)| {
                cg::clip(&overlap, *normal, *offset).is_some_and(|c| cg::moments(&c).volume > 1e-5)
            })
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sloping_seats_keep_every_loft_cell_planar_convex_and_closed() {
        for kind in ["strut", "fairing", "shaft"] {
            let contact = Contact {
                point: [0., 3., 0.],
                normal: normalize([0., -1., 0.7]),
            };
            let member = loft(
                [0., 0., 0.],
                seat(&contact),
                [0., 0., 1.],
                0.08,
                if kind == "strut" { 6. } else { 1. },
                if kind == "shaft" {
                    &[(0., 1.), (1., 1.)]
                } else {
                    &[(0., 1.6), (0.15, 1.), (0.8, 1.), (1., 1.85)]
                },
                kind,
                Some(contact.clone()),
            );
            for point in member.rings.as_ref().unwrap().last().unwrap() {
                assert!((dot(sub(*point, contact.point), contact.normal) + 0.02).abs() < 1e-8);
            }
            for cell in cells(&member) {
                assert!(cg::moments(&cell).volume > 0.);
                for face in cell.faces.iter() {
                    let n = cg::normal(&face.vertices);
                    let plane = dot(n, face.vertices[0]);
                    for p in &face.vertices {
                        assert!((dot(n, *p) - plane).abs() < 1e-8, "nonplanar {kind}");
                    }
                    for p in cell.faces.iter().flat_map(|f| &f.vertices) {
                        assert!(dot(n, *p) - plane < 1e-8, "nonconvex {kind}");
                    }
                }
            }
        }
    }
    #[test]
    fn hull_contact_does_not_allow_a_member_to_pass_through_the_hull() {
        let hull = vec![cg::box_cell([0., 0., 0.], [4., 4., 4.])];
        let contact = Contact {
            point: [0., -2., 0.],
            normal: [0., -1., 0.],
        };
        let member = loft(
            [0., -4., 0.],
            seat(&contact),
            [1., 0., 0.],
            0.1,
            4.,
            &[(0., 1.), (1., 2.)],
            "strut",
            Some(contact),
        );
        assert!(
            cells(&member)
                .iter()
                .all(|c| !crosses_hull(&member, c, &hull))
        );
        let obstruction = vec![cg::box_cell([0., -3., 0.], [1., 0.3, 1.])];
        assert!(
            cells(&member)
                .iter()
                .any(|c| crosses_hull(&member, c, &obstruction))
        );
    }
}
