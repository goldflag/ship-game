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
    let point = world_to_local(position, actor.motion.pose());
    let amount = ((energy - 25000.0) / 1e6).sqrt() * 12.0;
    let local = local_damage_evidence(actor, def, point, None, None);
    let dealt = damage_hull(actor, amount, local.as_ref().map(|l| l.region_id.as_str()));
    let distance = |c: &crate::definition::Compartment| {
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
        Self {
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
            inverse_inertia: 12.0 / (mass * (h.length.powi(2) + h.beam.powi(2))),
        }
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
    }
}
fn project(points: impl Iterator<Item = Point>, axis: Point) -> (f64, f64) {
    points
        .map(|p| dot(p, axis))
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(min, max), v| {
            (min.min(v), max.max(v))
        })
}
struct Contact {
    normal: Point,
    depth: f64,
    point: Point,
}
fn contact(a: &Body, b: &Body) -> Option<Contact> {
    let (am, bm) = (&a.motion, &b.motion);
    if (am.x - bm.x).hypot(am.z - bm.z) > a.radius + b.radius
        || a.max_y < b.min_y
        || b.max_y < a.min_y
    {
        return None;
    }
    let mut depth = f64::INFINITY;
    let mut normal = [0.0; 2];
    for points in [&a.points, &b.points] {
        for i in 0..points.len() {
            let (p, q) = (points[i], points[(i + 1) % points.len()]);
            let length = (q[0] - p[0]).hypot(q[1] - p[1]);
            if length < 1e-8 {
                continue;
            }
            let axis = [-(q[1] - p[1]) / length, (q[0] - p[0]) / length];
            let (amin, amax) = project(a.points.iter().copied(), axis);
            let (bmin, bmax) = project(b.points.iter().copied(), axis);
            if amax < bmin || bmax < amin {
                return None;
            }
            let positive = amax - bmin;
            let negative = bmax - amin;
            let overlap = positive.min(negative);
            if overlap < depth {
                depth = overlap;
                let sign = if positive <= negative { 1.0 } else { -1.0 };
                normal = [axis[0] * sign, axis[1] * sign];
            }
        }
    }
    if !depth.is_finite() {
        return None;
    }
    let tangent = [-normal[1], normal[0]];
    let (_, aface) = project(a.points.iter().copied(), normal);
    let (bface, _) = project(b.points.iter().copied(), normal);
    let (amin, amax) = project(
        a.points
            .iter()
            .copied()
            .filter(|p| aface - dot(*p, normal) < 0.01),
        tangent,
    );
    let (bmin, bmax) = project(
        b.points
            .iter()
            .copied()
            .filter(|p| dot(*p, normal) - bface < 0.01),
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
