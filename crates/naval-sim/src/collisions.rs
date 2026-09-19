use crate::{
    breaches::add_breach,
    damage::{Combatant, damage_hull},
    definition::{Hull, ShipDefinition, Vec3},
    geometry::{length, world_to_local},
    motion::ShipState,
    shell::local_damage_evidence,
    vessel::Vessel,
};
type Point = [f64; 2];
fn dot(a: Point, b: Point) -> f64 {
    a[0] * b[0] + a[1] * b[1]
}
fn cross(a: Point, b: Point) -> f64 {
    a[0] * b[1] - a[1] * b[0]
}
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HullImpact {
    pub actor_id: String,
    pub other_id: Option<String>,
    pub position: Vec3,
    pub damage: f64,
    pub kind: String,
}
pub fn damage_hull_contact(
    actor: &mut Combatant,
    def: &ShipDefinition,
    position: Vec3,
    energy: f64,
) -> f64 {
    if energy <= 25000.0 || actor.damage.sunk {
        return 0.0;
    }
    let mut point = world_to_local(position, actor.motion.pose());
    // Match the reference's centerline convention after rotated projections:
    // libm roundoff must not choose a different hull side or breach normal.
    if point[0].abs() < 1e-9 {
        point[0] = 0.0;
    }
    let amount = ((energy - 25000.0) / 1e6).sqrt() * 12.0;
    let local = local_damage_evidence(actor, def, point, None, None);
    let dealt = damage_hull(actor, amount, local.as_ref().map(|l| l.region_id.as_str()));
    let distance = |c: &crate::definition::Compartment| {
        if c.volumes.is_some() {
            return crate::construction_geometry::room_distance(c, point);
        }
        let cell = |center: Vec3, size: Vec3| {
            length(std::array::from_fn(|i| {
                ((point[i] - center[i]).abs() - size[i] / 2.0).max(0.0)
            }))
        };
        c.cells.as_ref().map_or_else(
            || cell(c.center, c.size),
            |cells| {
                cells
                    .iter()
                    .map(|c| cell(c.center, c.size))
                    .fold(f64::INFINITY, f64::min)
            },
        )
    };
    if let Some((i, _)) = def
        .compartments
        .iter()
        .enumerate()
        .min_by(|(_, a), (_, b)| distance(a).total_cmp(&distance(b)))
        && energy > 250000.0
    {
        add_breach(
            &mut actor.damage.compartments[i],
            point,
            2.0_f64.min((energy - 250000.0) / 1e8),
            -1,
            None,
            None,
            false,
        );
    }
    dealt
}
pub fn profile(hull: &Hull) -> Vec<Point> {
    let mut stations: Vec<_> = hull
        .half_breadths
        .iter()
        .flat_map(|[station, breadth]| {
            [
                [-breadth, hull.length / 2.0 - station],
                [*breadth, hull.length / 2.0 - station],
            ]
        })
        .collect();
    if let Some(v) = &hull.volume {
        stations = v
            .cells
            .iter()
            .flat_map(|c| {
                c.faces
                    .iter()
                    .flat_map(|f| f.vertices.iter().map(|p| [p[0], p[2]]))
            })
            .collect();
    }
    convex_profile(stations)
}
fn convex_profile(mut stations: Vec<Point>) -> Vec<Point> {
    stations.sort_by(|a, b| a[0].total_cmp(&b[0]).then_with(|| a[1].total_cmp(&b[1])));
    let half = |points: &[Point]| {
        let mut result: Vec<Point> = vec![];
        for &point in points {
            while result.len() >= 2 {
                let (a, b) = (result[result.len() - 2], result[result.len() - 1]);
                if cross(
                    [b[0] - a[0], b[1] - a[1]],
                    [point[0] - b[0], point[1] - b[1]],
                ) > 1e-10
                {
                    break;
                }
                result.pop();
            }
            result.push(point);
        }
        result.pop();
        result
    };
    let mut points = half(&stations);
    stations.reverse();
    points.extend(half(&stations));
    points
}
struct Body {
    pieces: Vec<crate::construction_geometry::Cell>,
    definition: std::sync::Arc<ShipDefinition>,
    constructed: bool,
    motion: ShipState,
    points: Vec<Point>,
    radius: f64,
    min_y: f64,
    max_y: f64,
    inverse_mass: f64,
    inverse_inertia: f64,
}
impl Body {
    fn new(actor: &Vessel) -> Self {
        let h = &actor.definition().hull;
        let p = &actor.motion;
        let (sin, cos) = (p.heading.sin(), p.heading.cos());
        let mass = h.mass_kg
            + actor
                .damage
                .compartments
                .iter()
                .map(|c| c.water_m3 * 1000.0)
                .sum::<f64>();
        let tilt = p.roll.sin().abs() * h.beam / 2.0 + p.pitch.sin().abs() * h.length / 2.0;
        let mut body = Self {
            pieces: vec![],
            definition: actor.compiled.definition.clone(),
            constructed: h.volume.is_some(),
            motion: p.clone(),
            points: actor
                .compiled
                .collision_profile
                .iter()
                .map(|v| [p.x + cos * v[0] - sin * v[1], p.z + sin * v[0] + cos * v[1]])
                .collect(),
            radius: h.length.hypot(h.beam) / 2.0,
            min_y: p.y - h.draft - tilt,
            max_y: p.y
                + h.deck_heights
                    .iter()
                    .map(|p| p[1])
                    .fold(f64::NEG_INFINITY, f64::max)
                + tilt,
            inverse_mass: 1.0 / mass,
            inverse_inertia: actor
                .definition()
                .loading
                .as_ref()
                .map_or(12.0 / (mass * (h.length.powi(2) + h.beam.powi(2))), |l| {
                    1. / (l.inertia_kg_m2[1] * mass / l.mass_kg)
                }),
        };
        // Legacy pairs can translate before encountering a constructed body.
        // Keep their original eager transform to preserve floating-point order.
        if !body.constructed {
            body.prepare_pieces();
        }
        body
    }
    fn prepare_pieces(&mut self) {
        if !self.pieces.is_empty() {
            return;
        }
        let h = &self.definition.hull;
        let p = &self.motion;
        self.pieces = if let Some(v) = &h.volume {
            v.cells
                .iter()
                .map(|c| crate::definition::ConvexVolume {
                    faces: c
                        .faces
                        .iter()
                        .map(|f| crate::definition::ConvexVolumeFacesItem {
                            vertices: f
                                .vertices
                                .iter()
                                .map(|q| crate::geometry::local_to_world(*q, p.pose()))
                                .collect(),
                        })
                        .collect(),
                })
                .collect()
        } else {
            let profile = profile(h);
            let top = h
                .deck_heights
                .iter()
                .map(|p| p[1])
                .fold(f64::NEG_INFINITY, f64::max);
            let polygon: Vec<_> = profile.iter().map(|q| [q[0], top, q[1]]).rev().collect();
            let cell = crate::construction_geometry::prism(&polygon, top + h.draft);
            vec![crate::definition::ConvexVolume {
                faces: cell
                    .faces
                    .iter()
                    .map(|f| crate::definition::ConvexVolumeFacesItem {
                        vertices: f
                            .vertices
                            .iter()
                            .map(|q| crate::geometry::local_to_world(*q, p.pose()))
                            .collect(),
                    })
                    .collect(),
            }]
        };
    }
    fn impulse(&mut self, lever: Point, direction: Point, magnitude: f64) {
        let p = &mut self.motion;
        let (dx, dz) = (
            direction[0] * magnitude * self.inverse_mass,
            direction[1] * magnitude * self.inverse_mass,
        );
        p.speed += p.heading.sin() * dx - p.heading.cos() * dz;
        p.sway_speed += p.heading.cos() * dx + p.heading.sin() * dz;
        p.yaw_rate += cross(lever, direction) * magnitude * self.inverse_inertia;
    }
    fn translate(&mut self, normal: Point, distance: f64) {
        let (dx, dz) = (normal[0] * distance, normal[1] * distance);
        self.motion.x += dx;
        self.motion.z += dz;
        for p in &mut self.points {
            p[0] += dx;
            p[1] += dz;
        }
        for c in &mut self.pieces {
            for f in std::sync::Arc::make_mut(&mut c.faces) {
                for p in &mut f.vertices {
                    p[0] += dx;
                    p[2] += dz;
                }
            }
        }
    }
}
fn project(points: impl Iterator<Item = Point>, axis: Point) -> (f64, f64) {
    points
        .map(|p| dot(p, axis))
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(min, max), v| {
            (min.min(v), max.max(v))
        })
}
#[derive(Debug, PartialEq)]
struct Contact {
    normal: Point,
    depth: f64,
    point: Point,
}
fn contact(a: &mut Body, b: &mut Body) -> Option<Contact> {
    let (am, bm) = (&a.motion, &b.motion);
    if (am.x - bm.x).hypot(am.z - bm.z) > a.radius + b.radius
        || a.max_y < b.min_y
        || b.max_y < a.min_y
    {
        return None;
    }
    if a.constructed || b.constructed {
        a.prepare_pieces();
        b.prepare_pieces();
        let index = crate::construction_geometry::Broadphase::sized_for(&b.pieces);
        let mut contacts = vec![];
        for ac in &a.pieces {
            // Sorted indices preserve the exhaustive loop's tie ordering.
            for j in index.candidates(ac) {
                let bc = &b.pieces[j];
                if !crate::construction_geometry::intersection(ac, bc)
                    .is_some_and(|c| crate::construction_geometry::moments(&c).volume > 1e-8)
                {
                    continue;
                }
                let ap = convex_profile(
                    ac.faces
                        .iter()
                        .flat_map(|f| f.vertices.iter().map(|p| [p[0], p[2]]))
                        .collect(),
                );
                let bp = convex_profile(
                    bc.faces
                        .iter()
                        .flat_map(|f| f.vertices.iter().map(|p| [p[0], p[2]]))
                        .collect(),
                );
                if let Some(c) = planar_contact(&ap, &bp) {
                    contacts.push(c);
                }
            }
        }
        return contacts
            .into_iter()
            .min_by(|a, b| a.depth.total_cmp(&b.depth));
    }
    planar_contact(&a.points, &b.points)
}
fn planar_contact(a: &[Point], b: &[Point]) -> Option<Contact> {
    let mut depth = f64::INFINITY;
    let mut normal = [0.0; 2];
    for points in [a, b] {
        for i in 0..points.len() {
            let (p, q) = (points[i], points[(i + 1) % points.len()]);
            let length = (q[0] - p[0]).hypot(q[1] - p[1]);
            if length < 1e-8 {
                continue;
            }
            let axis = [-(q[1] - p[1]) / length, (q[0] - p[0]) / length];
            let (amin, amax) = project(a.iter().copied(), axis);
            let (bmin, bmax) = project(b.iter().copied(), axis);
            if amax < bmin || bmax < amin {
                return None;
            }
            let positive = amax - bmin;
            let negative = bmax - amin;
            let overlap = positive.min(negative);
            // Preserve traversal order for numerically tied penetration depths.
            if overlap < depth - 1e-9 {
                depth = overlap;
                let sign = if positive <= negative + 1e-9 {
                    1.0
                } else {
                    -1.0
                };
                normal = [axis[0] * sign, axis[1] * sign];
            }
        }
    }
    if !depth.is_finite() {
        return None;
    }
    let tangent = [-normal[1], normal[0]];
    let (_, aface) = project(a.iter().copied(), normal);
    let (bface, _) = project(b.iter().copied(), normal);
    let (amin, amax) = project(
        a.iter().copied().filter(|p| aface - dot(*p, normal) < 0.01),
        tangent,
    );
    let (bmin, bmax) = project(
        b.iter().copied().filter(|p| dot(*p, normal) - bface < 0.01),
        tangent,
    );
    let along = (amin.max(bmin) + amax.min(bmax)) / 2.0;
    let across = (aface + bface) / 2.0;
    Some(Contact {
        normal,
        depth,
        point: [
            normal[0] * across + tangent[0] * along,
            normal[1] * across + tangent[1] * along,
        ],
    })
}
pub fn resolve_ship_collisions(actors: &mut [Vessel]) -> Vec<HullImpact> {
    let mut bodies: Vec<_> = actors.iter().map(Body::new).collect();
    let mut events = vec![];
    for _ in 0..12 {
        let mut touching = false;
        for i in 0..bodies.len() {
            for j in i + 1..bodies.len() {
                let (left, right) = bodies.split_at_mut(j);
                let (a, b) = (&mut left[i], &mut right[0]);
                let Some(hit) = contact(a, b) else {
                    continue;
                };
                touching = true;
                let (am, bm) = (&a.motion, &b.motion);
                let ra = [hit.point[0] - am.x, hit.point[1] - am.z];
                let rb = [hit.point[0] - bm.x, hit.point[1] - bm.z];
                let (av, bv) = (am.velocity(), bm.velocity());
                let relative = [
                    bv[0] - bm.yaw_rate * rb[1] - av[0] + am.yaw_rate * ra[1],
                    bv[2] + bm.yaw_rate * rb[0] - av[2] - am.yaw_rate * ra[0],
                ];
                let closing = dot(relative, hit.normal);
                if closing < 0.0 {
                    let effective = a.inverse_mass
                        + b.inverse_mass
                        + cross(ra, hit.normal).powi(2) * a.inverse_inertia
                        + cross(rb, hit.normal).powi(2) * b.inverse_inertia;
                    let magnitude = -closing / effective;
                    if closing < -0.75 {
                        let energy = 0.5 * closing.powi(2) / effective;
                        let y = a
                            .min_y
                            .max(b.min_y)
                            .max(0.0_f64.min(a.max_y).min(b.max_y) - 1.0);
                        let position = [hit.point[0], y, hit.point[1]];
                        for (victim, other, motion) in [(i, j, &a.motion), (j, i, &b.motion)] {
                            let other_id = actors[other].motion.id.clone();
                            let actor = &mut actors[victim];
                            actor.motion = motion.clone();
                            let compiled = actor.compiled.clone();
                            let damage = damage_hull_contact(
                                actor,
                                &compiled.definition,
                                position,
                                energy / 2.0,
                            );
                            if damage > 0.0 {
                                events.push(HullImpact {
                                    actor_id: actor.motion.id.clone(),
                                    other_id: Some(other_id),
                                    position,
                                    damage,
                                    kind: "collision".into(),
                                });
                            }
                        }
                    }
                    a.impulse(ra, hit.normal, -magnitude);
                    b.impulse(rb, hit.normal, magnitude);
                }
                let correction = (hit.depth + 0.002) / (a.inverse_mass + b.inverse_mass);
                a.translate(hit.normal, -correction * a.inverse_mass);
                b.translate(hit.normal, correction * b.inverse_mass);
            }
        }
        if !touching {
            break;
        }
    }
    for (actor, body) in actors.iter_mut().zip(bodies) {
        actor.motion = body.motion;
    }
    events
}

#[cfg(test)]
mod collision_index_tests {
    use super::*;
    use crate::{construction_geometry as cg, definition::*, rules::TeamId, vessel::CompiledShip};
    use std::sync::Arc;
    fn exhaustive_contact(a: &mut Body, b: &mut Body) -> Option<Contact> {
        let (am, bm) = (&a.motion, &b.motion);
        if (am.x - bm.x).hypot(am.z - bm.z) > a.radius + b.radius
            || a.max_y < b.min_y
            || b.max_y < a.min_y
        {
            return None;
        }
        if a.constructed || b.constructed {
            a.prepare_pieces();
            b.prepare_pieces();
            let mut contacts = vec![];
            for ac in &a.pieces {
                for bc in &b.pieces {
                    if !crate::construction_geometry::intersection(ac, bc)
                        .is_some_and(|c| crate::construction_geometry::moments(&c).volume > 1e-8)
                    {
                        continue;
                    }
                    let ap = convex_profile(
                        ac.faces
                            .iter()
                            .flat_map(|f| f.vertices.iter().map(|p| [p[0], p[2]]))
                            .collect(),
                    );
                    let bp = convex_profile(
                        bc.faces
                            .iter()
                            .flat_map(|f| f.vertices.iter().map(|p| [p[0], p[2]]))
                            .collect(),
                    );
                    if let Some(c) = planar_contact(&ap, &bp) {
                        contacts.push(c);
                    }
                }
            }
            return contacts
                .into_iter()
                .min_by(|a, b| a.depth.total_cmp(&b.depth));
        }
        planar_contact(&a.points, &b.points)
    }
    #[test]
    fn spatial_candidates_preserve_exhaustive_contacts_and_lazy_transforms() {
        let d = ShipDefinition {
            hull: Hull {
                kind: "constructed-volume-v1".into(),
                length: 30.,
                beam: 10.,
                draft: 3.,
                depth: 4.,
                mass_kg: 100000.,
                half_breadths: vec![[0., 5.], [30., 5.]],
                keel_heights: vec![[0., -3.], [30., -3.]],
                deck_heights: vec![[0., 4.], [30., 4.]],
                volume: Some(ConstructionGeometry {
                    version: 1.,
                    cells: (0..6)
                        .map(|i| cg::box_cell([0., 0., i as f64 * 4. - 10.], [8., 5., 4.]))
                        .collect(),
                    surfaces: vec![],
                }),
                ..Default::default()
            },
            ..Default::default()
        };
        let compiled = Arc::new(CompiledShip::new(Arc::new(d), None).unwrap());
        for x in [0., 7.9, 8., 8.00001, 20., 100.] {
            for roll in [0., 0.4, std::f64::consts::FRAC_PI_2, std::f64::consts::PI] {
                let a = Vessel::new("a", TeamId::A, compiled.clone());
                let mut b = Vessel::new("b", TeamId::B, compiled.clone());
                b.motion.x = x;
                b.motion.roll = roll;
                b.motion.heading = 0.2;
                let (mut ai, mut bi) = (Body::new(&a), Body::new(&b));
                assert!(ai.pieces.is_empty() && bi.pieces.is_empty());
                let actual = contact(&mut ai, &mut bi);
                let (mut ae, mut be) = (Body::new(&a), Body::new(&b));
                ae.prepare_pieces();
                be.prepare_pieces();
                assert_eq!(actual, exhaustive_contact(&mut ae, &mut be));
                if x == 100. {
                    assert!(ai.pieces.is_empty() && bi.pieces.is_empty());
                }
            }
        }
    }
}
