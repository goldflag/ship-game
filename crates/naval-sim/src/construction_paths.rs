//! Connected deck fittings. Native code owns support, fit and distributed loading;
//! the editor renders the same documented 16-interval parabolic sag approximation.
use crate::{construction_geometry as cg, definition::*, geometry::*};
use base64::Engine;
use std::io::Read;

const SAG_INTERVALS: usize = 16;
const MAX_LENGTH_M: f64 = 500.;

fn error(message: impl Into<String>, id: &str) -> ConstructionDiagnostic {
    ConstructionDiagnostic {
        severity: "error".into(),
        code: "equipment-path".into(),
        message: message.into(),
        source_id: Some(id.into()),
    }
}
fn finite(p: Vec3) -> bool {
    p.iter().all(|x| x.is_finite() && x.abs() <= 1000.)
}

pub(crate) fn supported_surface(
    surfaces: &[ConstructionSurface],
    point: Vec3,
    direction: Option<Vec3>,
    deck_only: bool,
    tolerance: f64,
) -> bool {
    surfaces.iter().any(|s| {
        !s.open
            && (!deck_only || s.normal[1] >= 0.35)
            && direction.is_none_or(|d| dot(s.normal, d) <= -0.5)
            && length(sub(
                cg::closest_point(&cg::prism(&s.vertices, 0.001), point),
                point,
            )) <= tolerance
    })
}

pub(crate) struct SupportSocket {
    pub position: Vec3,
}

pub(crate) struct FittingSurface {
    pub tree: crate::mount_clearance::SurfaceTree,
}
impl FittingSurface {
    pub fn new(
        e: &ConstructionEquipment,
        p: &ConstructionEquipmentPart,
    ) -> Result<Option<Self>, ConstructionDiagnostic> {
        let Some(surface) = &p.rigging_surface else {
            return Ok(None);
        };
        let invalid = || error("Invalid published rope attachment surface", &e.id);
        if surface.encoding != "deflate-f32-u32-v1"
            || surface.data.len() > 4_000_000
            || p.placement != "deck"
            || p.path.is_some()
            || p.wall_mount.is_some()
            || !matches!(
                p.kind.as_str(),
                "mast" | "director" | "funnel" | "deck-fitting"
            )
        {
            return Err(invalid());
        }
        let compressed = base64::engine::general_purpose::STANDARD
            .decode(&surface.data)
            .map_err(|_| invalid())?;
        let mut bytes = vec![];
        // Bounded even for malformed or adversarial compressed catalogs.
        flate2::read::ZlibDecoder::new(compressed.as_slice())
            .take(12_000_009)
            .read_to_end(&mut bytes)
            .map_err(|_| invalid())?;
        if bytes.len() < 8 {
            return Err(invalid());
        }
        let word =
            |offset: usize| u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap());
        let (vertices, triangles) = (word(0) as usize, word(4) as usize);
        if vertices == 0
            || vertices > 500_000
            || triangles == 0
            || triangles > 500_000
            || bytes.len() != 8 + 12 * (vertices + triangles)
        {
            return Err(invalid());
        }
        let pose = Pose {
            x: e.position[0],
            y: e.position[1],
            z: e.position[2],
            heading: e.bearing_deg.to_radians(),
            ..Default::default()
        };
        let mut points = Vec::with_capacity(vertices);
        for i in 0..vertices {
            let point = std::array::from_fn(|k| f32::from_bits(word(8 + i * 12 + k * 4)) as f64);
            if !finite(point)
                || (0..3).any(|k| (point[k] - p.bounds_center[k]).abs() > p.size[k] / 2. + 0.025)
            {
                return Err(invalid());
            }
            points.push(local_to_world(point, pose));
        }
        let mut faces = Vec::with_capacity(triangles);
        for i in 0..triangles {
            let indexes: [usize; 3] =
                std::array::from_fn(|k| word(8 + vertices * 12 + i * 12 + k * 4) as usize);
            if indexes.iter().any(|&i| i >= vertices) {
                return Err(invalid());
            }
            faces.push(indexes.map(|i| points[i]));
        }
        Ok(Some(Self {
            tree: crate::mount_clearance::SurfaceTree::new(faces),
        }))
    }
}

#[derive(Clone)]
pub(crate) struct Member {
    pub a: Vec3,
    pub b: Vec3,
    pub radius: f64,
    mass_kg: f64,
}
impl Member {
    /// A narrow oriented box encloses the round member for conservative fit checks.
    /// Unlike a route-wide AABB this preserves the empty space between members.
    pub fn cell(&self) -> cg::Cell {
        let along = normalize(sub(self.b, self.a));
        let reference = if along[1].abs() < 0.95 {
            [0., 1., 0.]
        } else {
            [1., 0., 0.]
        };
        let right = normalize(cross(reference, along));
        let up = cross(along, right);
        let center = scale(add(self.a, self.b), 0.5);
        let mut cell = cg::box_cell(
            [0.; 3],
            [
                2. * self.radius,
                2. * self.radius,
                length(sub(self.b, self.a)),
            ],
        );
        for face in std::sync::Arc::make_mut(&mut cell.faces) {
            for p in &mut face.vertices {
                *p = add(
                    center,
                    add(scale(right, p[0]), add(scale(up, p[1]), scale(along, p[2]))),
                );
            }
        }
        cell
    }
    fn inertia(&self, about: Vec3) -> Vec3 {
        let delta = sub(self.b, self.a);
        let len = length(delta);
        let axis = scale(delta, 1. / len);
        let shift = sub(scale(add(self.a, self.b), 0.5), about);
        std::array::from_fn(|i| {
            self.mass_kg
                * (len * len / 12. * (1. - axis[i] * axis[i])
                    + self.radius * self.radius / 4. * (1. + axis[i] * axis[i])
                    + dot(shift, shift)
                    - shift[i] * shift[i])
        })
    }
}

pub(crate) struct FittedPath {
    pub cells: Vec<cg::Cell>,
    pub mass: ConstructionMass,
}

pub(crate) fn compile(
    e: &ConstructionEquipment,
    p: &ConstructionEquipmentPart,
    surfaces: &[ConstructionSurface],
    hull: &[cg::Cell],
    hull_index: &cg::Broadphase,
    sockets: &[SupportSocket],
    fitting_surfaces: &[FittingSurface],
) -> Result<FittedPath, ConstructionDiagnostic> {
    let source = e
        .path
        .as_ref()
        .ok_or_else(|| error("Draw a connected path for this fitting", &e.id))?;
    let profile = p
        .path
        .as_ref()
        .ok_or_else(|| error("This fixed fitting cannot contain path points", &e.id))?;
    let base_mass = p.mass_kg.unwrap_or(0.);
    if p.kind != "deck-fitting"
        || p.placement != "deck"
        || ![
            "railing",
            "rope",
            "chain",
            "ladder",
            "inclined-ladder",
            "framed-ladder",
        ]
        .contains(&profile.kind.as_str())
        || !profile.diameter_m.is_finite()
        || !(0.005..=0.2).contains(&profile.diameter_m)
        || !profile.mass_kg_per_m.is_finite()
        || !(0.01..=1000.).contains(&profile.mass_kg_per_m)
        || !base_mass.is_finite()
        || !(0.01..=10000.).contains(&base_mass)
        || p.occupancy.as_ref().is_some_and(|x| !x.is_empty())
        || [
            p.power_kw,
            p.exhaust_kw,
            p.thrust_efficiency,
            p.rudder_area_m2,
            p.service_mass_kg,
            p.ammunition_capacity,
        ]
        .iter()
        .flatten()
        .any(|x| *x != 0.)
    {
        return Err(error(
            "Invalid catalog path profile or hardware mass",
            &e.id,
        ));
    }
    if !(2..=64).contains(&source.points.len()) || source.points.iter().any(|&p| !finite(p)) {
        return Err(error(
            "Use 2–64 finite local path points within 1000 m",
            &e.id,
        ));
    }
    let pose = Pose {
        x: e.position[0],
        y: e.position[1],
        z: e.position[2],
        heading: e.bearing_deg.to_radians(),
        ..Default::default()
    };
    let points: Vec<_> = source
        .points
        .iter()
        .map(|&p| local_to_world(p, pose))
        .collect();
    let lengths: Vec<_> = points.windows(2).map(|p| length(sub(p[1], p[0]))).collect();
    if points.iter().any(|&p| !finite(p))
        || lengths.iter().any(|&l| l < 0.05)
        || lengths.iter().sum::<f64>() > MAX_LENGTH_M
    {
        return Err(error(
            "Path segments must be at least 5 cm and total length at most 500 m",
            &e.id,
        ));
    }
    if matches!(profile.kind.as_str(), "inclined-ladder" | "framed-ladder") {
        return crate::construction_access::compile(e, p, surfaces, hull, hull_index);
    }
    if source.access.is_some() {
        return Err(error(
            "Access settings apply only to stairs and framed ladders",
            &e.id,
        ));
    }
    let railing = profile.kind == "railing";
    let ladder = profile.kind == "ladder";
    if !railing && (source.height_m.is_some() || source.rail_count.is_some()) {
        return Err(error("Height and rail count apply only to railings", &e.id));
    }
    let slack = source.slack_m.unwrap_or(0.);
    let slack_limit = lengths.iter().copied().fold(40., f64::min) * 0.5;
    if !slack.is_finite()
        || !(0.0..=slack_limit).contains(&slack)
        || ((railing || ladder) && slack != 0.)
    {
        return Err(error(
            "Slack must be 0–20 m and at most half the shortest segment; railings cannot sag",
            &e.id,
        ));
    }
    let mut members = vec![];
    let mut anchors = vec![];
    // Chain diameter describes the wire; the outer alternating-link envelope is
    // Four wire diameters wide. Fit/inertia use that conservative circular envelope.
    let radius = profile.diameter_m * if profile.kind == "chain" { 2. } else { 0.5 };
    if ladder {
        let width = profile.width_m.unwrap_or(0.);
        let stand = profile.stand_off_m.unwrap_or(0.);
        let spacing = profile.post_spacing_m.unwrap_or(0.);
        if !(0.2..=1.5).contains(&width)
            || !(0.08..=0.4).contains(&stand)
            || !(0.15..=0.5).contains(&spacing)
        {
            return Err(error(
                "Invalid ladder width, standoff or rung spacing",
                &e.id,
            ));
        }
        let normal = local_to_world(
            [0., 0., -1.],
            Pose {
                x: 0.,
                y: 0.,
                z: 0.,
                ..pose
            },
        );
        let mut centers: Vec<Vec3> = vec![];
        for span in source.points.windows(2) {
            let delta = sub(span[1], span[0]);
            let len = delta[0].hypot(delta[1]);
            if len < 0.05 {
                return Err(error("Draw the ladder along the wall, not into it", &e.id));
            }
            let right = [delta[1] / len, -delta[0] / len, 0.];
            let count = (len / spacing).ceil() as usize;
            for i in 0..=count {
                let center = add(span[0], scale(delta, i as f64 / count as f64));
                if centers.iter().any(|&p| length(sub(p, center)) < 1e-6) {
                    continue;
                }
                centers.push(center);
                let mut feet = vec![];
                for sign in [-1., 1.] {
                    let point = local_to_world(add(center, scale(right, sign * width / 2.)), pose);
                    let Some(foot) = crate::construction_wall_fittings::project(
                        surfaces,
                        point,
                        normal,
                        (width * 0.75).max(0.15),
                    ) else {
                        return Err(error(
                            "Every ladder rung needs a closed hull side behind both ends",
                            &e.id,
                        ));
                    };
                    anchors.push(foot);
                    feet.push(foot);
                }
                let outer = dot(feet[0], normal).max(dot(feet[1], normal)) + stand;
                let left = add(feet[0], scale(normal, outer - dot(feet[0], normal)));
                let right = add(feet[1], scale(normal, outer - dot(feet[1], normal)));
                for (a, b) in [(feet[0], left), (left, right), (right, feet[1])] {
                    members.push(Member {
                        a,
                        b,
                        radius,
                        mass_kg: length(sub(b, a)) * profile.mass_kg_per_m,
                    });
                }
            }
        }
    } else if railing {
        let original_height = profile.height_m.unwrap_or(1.1);
        let height = source.height_m.unwrap_or(original_height);
        let original_rails = profile.rail_count.unwrap_or(3.);
        let rail_count = source.rail_count.unwrap_or(original_rails);
        let spacing = profile.post_spacing_m.unwrap_or(1.5);
        let post_mass = profile.post_mass_kg.unwrap_or(0.);
        if !height.is_finite()
            || !original_height.is_finite()
            || !(0.3..=3.).contains(&original_height)
            || ![2., 3.].contains(&rail_count)
            || ![2., 3.].contains(&original_rails)
            || !(0.3..=3.).contains(&height)
            || !spacing.is_finite()
            || !(0.25..=3.).contains(&spacing)
            || !post_mass.is_finite()
            || !(0.01..=1000.).contains(&post_mass)
        {
            return Err(error(
                "Invalid railing height, post spacing or post mass",
                &e.id,
            ));
        }
        for (span, &len) in points.windows(2).zip(&lengths) {
            for level in 1..=rail_count as usize {
                let y = height * level as f64 / rail_count - radius;
                members.push(Member {
                    a: add(span[0], [0., y, 0.]),
                    b: add(span[1], [0., y, 0.]),
                    radius,
                    mass_kg: len * profile.mass_kg_per_m / original_rails,
                });
            }
            let intervals = (len / spacing).ceil() as usize;
            for i in 0..=intervals {
                let foot = add(
                    span[0],
                    scale(sub(span[1], span[0]), i as f64 / intervals as f64),
                );
                if anchors.iter().any(|&a| length(sub(a, foot)) < 1e-6) {
                    continue;
                }
                anchors.push(foot);
                members.push(Member {
                    a: foot,
                    b: add(foot, [0., height, 0.]),
                    radius,
                    mass_kg: post_mass * height / original_height,
                });
            }
        }
    } else {
        if profile.height_m.is_some()
            || profile.rail_count.is_some()
            || profile.post_spacing_m.is_some()
            || profile.post_mass_kg.is_some()
        {
            return Err(error(
                "Rope and chain profiles cannot contain railing post settings",
                &e.id,
            ));
        }
        anchors.extend(points.iter().copied());
        for span in points.windows(2) {
            let sample = |i: usize| {
                let t = i as f64 / SAG_INTERVALS as f64;
                sub(
                    add(span[0], scale(sub(span[1], span[0]), t)),
                    [0., 4. * slack * t * (1. - t), 0.],
                )
            };
            for i in 0..SAG_INTERVALS {
                let (a, b) = (sample(i), sample(i + 1));
                members.push(Member {
                    a,
                    b,
                    radius,
                    mass_kg: length(sub(b, a)) * profile.mass_kg_per_m,
                });
            }
        }
    }
    let actual_length: f64 = if railing || ladder {
        lengths.iter().sum()
    } else {
        members.iter().map(|m| length(sub(m.b, m.a))).sum()
    };
    if actual_length > MAX_LENGTH_M {
        return Err(error("The sagging path length exceeds 500 m", &e.id));
    }
    for &anchor in &anchors {
        let tolerance = if profile.kind == "chain" {
            (radius + 0.005).max(0.05)
        } else {
            0.05
        };
        if supported_surface(surfaces, anchor, None, railing, tolerance) {
            continue;
        }
        // A run may continue into a deckhouse or step: a foot covered by a later
        // block still stands in solid structure, although its deck surface is gone.
        if railing
            && hull_index
                .candidates_box(sub(anchor, [tolerance; 3]), add(anchor, [tolerance; 3]))
                .iter()
                .any(|&i| cg::contains(&hull[i], anchor))
        {
            continue;
        }
        let support = (!railing && !ladder)
            .then(|| {
                sockets
                    .iter()
                    .find(|s| length(sub(s.position, anchor)) <= 0.05)
            })
            .flatten();
        if support.is_some()
            || (!railing
                && !ladder
                && fitting_surfaces
                    .iter()
                    .any(|s| s.tree.distance(anchor, anchor, radius + 0.006) <= radius + 0.005))
        {
            continue;
        } else {
            return Err(error(
                if railing {
                    "Every railing post needs a supported deck surface within 5 cm"
                } else {
                    "Each rope or chain point needs a hull surface, a supported fitting surface or an explicit tie socket"
                },
                &e.id,
            ));
        }
    }
    let cells: Vec<_> = members.iter().map(Member::cell).collect();
    // Railings are thin cosmetic trim. Their posts still need the supported deck
    // checked above, but they never fail on contact with the hull, a fitting or
    // another route: shared posts, joined runs and rails meeting a wall are normal.
    for (member, cell) in members.iter().zip(&cells).filter(|_| !railing) {
        let fitted_tolerance = 4. * member.radius * member.radius * 0.005;
        if hull_index.candidates(cell).iter().any(|&i| {
            cg::intersection(cell, &hull[i])
                .is_some_and(|x| cg::moments(&x).volume > fitted_tolerance)
        }) {
            return Err(error(
                "A path member runs through the hull; raise its anchors or reduce slack",
                &e.id,
            ));
        }
    }
    let mass_kg = base_mass + members.iter().map(|m| m.mass_kg).sum::<f64>();
    let ends = [points[0], *points.last().unwrap()];
    let weighted_members = members.iter().fold([0.; 3], |sum, m| {
        add(sum, scale(add(m.a, m.b), m.mass_kg * 0.5))
    });
    let center = scale(
        add(
            weighted_members,
            scale(add(ends[0], ends[1]), base_mass * 0.5),
        ),
        1. / mass_kg,
    );
    let mut inertia = members
        .iter()
        .fold([0.; 3], |sum, m| add(sum, m.inertia(center)));
    for end in ends {
        let d = sub(end, center);
        inertia = add(
            inertia,
            std::array::from_fn(|i| base_mass * 0.5 * (dot(d, d) - d[i] * d[i])),
        );
    }
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
