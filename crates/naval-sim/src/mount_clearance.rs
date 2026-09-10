//! Physical gun movement interlocks. All inputs are original authored CPU data;
//! neither rendering meshes nor firing rays participate in movement acceptance.
use crate::{
    definition::{GunPart, ShipDefinition, Vec3},
    geometry::*,
    mount_frames::mount_frame,
    structure::{bounds, structural_surfaces},
    weapons::{MountState, barrel_height, barrel_offset},
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearancePose {
    pub train: f64,
    pub elevation: f64,
    pub recoil: f64,
}
impl From<&MountState> for ClearancePose {
    fn from(s: &MountState) -> Self {
        Self {
            train: s.train,
            elevation: s.elevation,
            recoil: s.recoil,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearanceResult {
    pub pose: ClearancePose,
    pub blocked: bool,
    pub obstruction_id: Option<String>,
}
#[derive(Clone, Copy, Debug)]
struct Box3 {
    center: Vec3,
    size: Vec3,
}
impl Box3 {
    fn points(points: impl Iterator<Item = Vec3>) -> Self {
        let (center, size) = bounds(points);
        Self { center, size }
    }
    fn transformed(self, frame: Pose) -> Self {
        let (c, s) = (frame.heading.cos().abs(), frame.heading.sin().abs());
        Self {
            center: local_to_world(self.center, frame),
            size: [
                c * self.size[0] + s * self.size[2],
                self.size[1],
                s * self.size[0] + c * self.size[2],
            ],
        }
    }
    fn separation(self, other: Self) -> f64 {
        length(std::array::from_fn(|i| {
            ((self.center[i] - other.center[i]).abs() - (self.size[i] + other.size[i]) / 2.0)
                .max(0.0)
        }))
    }
}
#[derive(Clone, Debug)]
struct Chunk {
    bounds: Box3,
    triangles: Vec<[Vec3; 3]>,
    children: Option<Box<[Chunk; 2]>>,
}
impl Chunk {
    fn new(mut triangles: Vec<[Vec3; 3]>) -> Self {
        let bounds = Box3::points(triangles.iter().flatten().copied());
        if triangles.len() <= 12 {
            return Self { bounds, triangles, children: None };
        }
        let axis = (0..3).max_by(|&a, &b| bounds.size[a].total_cmp(&bounds.size[b])).unwrap();
        triangles.sort_unstable_by(|a, b| {
            let center = |t: &[Vec3; 3]| t.iter().map(|p| p[axis]).sum::<f64>();
            center(a).total_cmp(&center(b))
        });
        let right = triangles.split_off(triangles.len() / 2);
        Self { bounds, triangles: vec![], children: Some(Box::new([Self::new(triangles), Self::new(right)])) }
    }
    fn distance(&self, capsule: Capsule, bounds: Box3, nearest: &mut f64) {
        if bounds.separation(self.bounds) - capsule.radius >= *nearest { return; }
        if let Some(children) = &self.children {
            let first = usize::from(bounds.separation(children[1].bounds) < bounds.separation(children[0].bounds));
            children[first].distance(capsule, bounds, nearest);
            children[1 - first].distance(capsule, bounds, nearest);
        } else {
            for triangle in &self.triangles {
                *nearest = nearest.min(segment_triangle_distance(capsule.a, capsule.b, *triangle) - capsule.radius);
            }
        }
    }
}
#[derive(Clone, Debug)]
struct Body {
    id: String,
    mount: Option<usize>,
    // Only a barrel's own intended enclosure is exempt. Extra parented roof
    // equipment retains collision, including against its parent's barrels.
    enclosure: bool,
    bounds: Box3,
    tree: Chunk,
}
impl Body {
    fn new(id: String, mount: Option<usize>, enclosure: bool, triangles: Vec<[Vec3; 3]>) -> Self {
        let bounds = Box3::points(triangles.iter().flatten().copied());
        let tree = Chunk::new(triangles);
        Self {
            id,
            mount,
            enclosure,
            bounds,
            tree,
        }
    }
    fn distance(&self, capsule: Capsule, limit: f64) -> f64 {
        let bounds = capsule.bounds();
        if bounds.separation(self.bounds) - capsule.radius >= limit {
            return limit;
        }
        let mut nearest = limit;
        self.tree.distance(capsule, bounds, &mut nearest);
        nearest
    }
}
#[derive(Clone, Copy, Debug)]
struct Capsule {
    a: Vec3,
    b: Vec3,
    radius: f64,
}
impl Capsule {
    fn bounds(self) -> Box3 {
        Box3::points([self.a, self.b].into_iter())
    }
    fn transformed(self, frame: Pose) -> Self {
        Self {
            a: local_to_world(self.a, frame),
            b: local_to_world(self.b, frame),
            ..self
        }
    }
    fn inverse(self, frame: Pose) -> Self {
        Self {
            a: world_to_local(self.a, frame),
            b: world_to_local(self.b, frame),
            ..self
        }
    }
}
#[derive(Clone, Debug)]
pub struct MountClearance {
    enabled: Vec<bool>,
    margin: f64,
    bodies: Vec<Body>,
    // Maximum distance from each yaw/elevation axis bounds every point's speed.
    radii: Vec<f64>,
}
impl MountClearance {
    pub fn new(def: &ShipDefinition) -> Result<Option<Self>, String> {
        let Some(profile) = &def.mount_clearance else {
            return Ok(None);
        };
        if profile.version != 1.0
            || !profile.margin_m.is_finite()
            || !(0.0..=0.2).contains(&profile.margin_m)
        {
            return Err("Invalid mount clearance profile".into());
        }
        let mut enabled = vec![false; def.mounts.len()];
        for id in &profile.mount_ids {
            let index = def
                .mounts
                .iter()
                .position(|m| &m.id == id)
                .ok_or("Unknown clearance mount")?;
            if enabled[index] {
                return Err("Duplicate clearance mount".into());
            }
            enabled[index] = true;
        }
        if !enabled.iter().any(|&v| v) {
            return Err("Mount clearance requires mounts".into());
        }
        let mut bodies = Vec::new();
        for s in structural_surfaces(def)? {
            bodies.push(Body::new(
                s.id,
                None,
                false,
                s.triangles
                    .iter()
                    .map(|t| t.map(|i| s.vertices[i]))
                    .collect(),
            ));
        }
        let mut radii = vec![0.0_f64; def.mounts.len()];
        for (index, mount) in def.mounts.iter().enumerate() {
            let w = &mount.weapon;
            let triangles = gunhouse(w);
            radii[index] = triangles
                .iter()
                .flatten()
                .map(|p| length(*p))
                .fold(0.0, f64::max)
                .max(
                    w.muzzle_forward.abs()
                        + w.recoil_m
                        + w.pivot_height.abs()
                        + w.barrel_spacing * 4.0
                        + 3.0,
                );
            bodies.push(Body::new(
                format!("{}.gunhouse", mount.id),
                Some(index),
                true,
                triangles,
            ));
            // Original shared rangefinder cylinder and hoods are yaw fittings.
            if mount.rangefinder {
                let primary = w.caliber_m > 0.2;
                let width = w
                    .rangefinder_width
                    .unwrap_or(if primary { 10.5 } else { 6.2 });
                let forward = w.rangefinder_forward.unwrap_or(-2.35);
                let y = w.gunhouse_size[2] - 0.85;
                let radius = if primary { 0.31 } else { 0.22 };
                bodies.push(Body::new(
                    format!("{}.rangefinder", mount.id),
                    Some(index),
                    true,
                    box_triangles([0.0, y, -forward], [width, radius * 2.0, radius * 2.0]),
                ));
                for side in [-1.0, 1.0] {
                    bodies.push(Body::new(
                        format!("{}.rangefinder-hood-{side}", mount.id),
                        Some(index),
                        true,
                        box_triangles(
                            [side * width / 2.0, y, -forward],
                            if primary {
                                [0.75, 1.05, 1.35]
                            } else {
                                [0.45, 0.6, 0.8]
                            },
                        ),
                    ));
                }
            }
        }
        for body in &profile.bodies {
            let mount = body
                .mount_id
                .as_ref()
                .map(|id| {
                    def.mounts
                        .iter()
                        .position(|m| &m.id == id)
                        .ok_or("Unknown clearance body mount")
                })
                .transpose()?;
            if body.surface.vertices.is_empty() || body.surface.triangles.is_empty() {
                return Err("Empty clearance body".into());
            }
            if body
                .surface
                .vertices
                .iter()
                .flatten()
                .any(|x| !x.is_finite())
            {
                return Err("Non-finite clearance body".into());
            }
            let mut triangles = Vec::new();
            for t in &body.surface.triangles {
                let mut points = [[0.0; 3]; 3];
                for j in 0..3 {
                    if t[j] < 0.0 || t[j].fract() != 0.0 || !t[j].is_finite() {
                        return Err("Invalid clearance triangle".into());
                    }
                    points[j] = *body
                        .surface
                        .vertices
                        .get(t[j] as usize)
                        .ok_or("Invalid clearance triangle")?;
                }
                triangles.push(points);
            }
            if let Some(index) = mount {
                radii[index] = radii[index].max(
                    body.surface
                        .vertices
                        .iter()
                        .map(|p| length(*p))
                        .fold(0.0, f64::max),
                );
            }
            bodies.push(Body::new(body.id.clone(), mount, false, triangles));
        }
        Ok(Some(Self {
            enabled,
            margin: profile.margin_m,
            bodies,
            radii,
        }))
    }

    pub fn enabled(&self, index: usize) -> bool {
        self.enabled.get(index).copied().unwrap_or(false)
    }

    /// Smallest physical surface gap involving this mount (including its
    /// independently posed descendants), capped for broad-phase efficiency.
    pub fn minimum_clearance(
        &self,
        def: &ShipDefinition,
        index: usize,
        poses: &[ClearancePose],
        limit: f64,
    ) -> (f64, Option<String>) {
        if index >= def.mounts.len()
            || poses.len() != def.mounts.len()
            || poses
                .iter()
                .any(|p| !p.train.is_finite() || !p.elevation.is_finite())
        {
            return (f64::NEG_INFINITY, Some("invalid-poses".into()));
        }
        let changed = self.affected(def, index);
        self.distance(def, poses, &changed, limit)
    }

    /// Preserve the permitted angular interval, then accept only a continuously
    /// clear path. Recoil is represented by its complete cycle envelope.
    pub fn resolve(
        &self,
        def: &ShipDefinition,
        index: usize,
        poses: &[ClearancePose],
        requested: ClearancePose,
    ) -> ClearanceResult {
        if index >= def.mounts.len()
            || poses.len() != def.mounts.len()
            || poses
                .iter()
                .any(|p| !p.train.is_finite() || !p.elevation.is_finite())
            || ![requested.train, requested.elevation, requested.recoil]
                .iter()
                .all(|v| v.is_finite())
        {
            return ClearanceResult {
                pose: poses.get(index).copied().unwrap_or_default(),
                blocked: true,
                obstruction_id: Some("invalid-poses".into()),
            };
        }
        let w = &def.mounts[index].weapon;
        let requested = ClearancePose {
            train: clamp(
                requested.train,
                -radians(w.traverse_deg),
                radians(w.traverse_deg),
            ),
            elevation: clamp(
                requested.elevation,
                radians(w.elevation_min_deg),
                radians(w.elevation_max_deg),
            ),
            recoil: clamp(requested.recoil, 0.0, 1.0),
        };
        let result = |pose, blocked, obstruction_id| ClearanceResult {
            pose,
            blocked,
            obstruction_id,
        };
        if !self.enabled(index) {
            return result(requested, false, None);
        }
        let start = poses[index];
        if ![requested.train, requested.elevation, requested.recoil]
            .iter()
            .all(|v| v.is_finite())
        {
            return result(start, true, Some("invalid-pose".into()));
        }
        let changed = self.affected(def, index);
        let yaw = requested.train - start.train;
        let elevation = requested.elevation - start.elevation;
        // Descendant origins add lever arm under parent yaw. Both bodies in a
        // checked pair may move, so twice the largest bound is conservative.
        let radius = changed
            .iter()
            .enumerate()
            .filter(|(_, v)| **v)
            .map(|(i, _)| {
                self.radii[i] + length(sub(def.mounts[i].position, def.mounts[index].position))
            })
            .fold(0.0, f64::max);
        let speed = 2.0 * radius * (yaw.abs() + elevation.abs());
        if speed < 1e-12 {
            return result(requested, false, None);
        }
        let mut candidate = poses.to_vec();
        let at = |t: f64| ClearancePose {
            train: start.train + yaw * t,
            elevation: start.elevation + elevation * t,
            recoil: requested.recoil,
        };
        let mut t = 0.0;
        let (mut gap, mut obstacle) =
            self.distance(def, &candidate, &changed, speed + self.margin + 1.0);
        if gap <= 1e-7 {
            return result(start, true, obstacle);
        }
        // The desired margin is a stop line, while physical distance provides
        // the sweep bound. This permits movement away from a margin contact
        // without an arbitrary angular jump or a sticky zero-sized first step.
        let stop_gap = self.margin.min(gap);
        for _ in 0..256 {
            let step = ((gap - 1e-7) * 0.8 / speed).min(1.0 - t);
            if step <= 1e-12 {
                return result(at(t), true, obstacle);
            }
            let next = t + step;
            candidate[index] = at(next);
            let (next_gap, next_obstacle) = self.distance(
                def,
                &candidate,
                &changed,
                speed * (1.0 - next) + self.margin + 1.0,
            );
            if next_gap < stop_gap - 1e-9 {
                // Already at the stop line: retain the exact certified pose.
                // Re-bisecting sub-micrometre progress every combat tick both
                // wastes work and prevents blocked-state caches from settling.
                if gap <= stop_gap + 1e-7 {
                    return result(at(t), true, next_obstacle.or(obstacle));
                }
                let (mut low, mut high) = (t, next);
                // This entire interval was certified physically clear by the
                // Lipschitz bound; locate its margin boundary, not a collision.
                for _ in 0..30 {
                    let mid = (low + high) / 2.0;
                    candidate[index] = at(mid);
                    if self.distance(def, &candidate, &changed, stop_gap + 0.01).0 >= stop_gap {
                        low = mid;
                    } else {
                        high = mid;
                    }
                }
                return result(at(low), true, next_obstacle.or(obstacle));
            }
            t = next;
            gap = next_gap;
            obstacle = next_obstacle;
            if t >= 1.0 - 1e-12 {
                return result(requested, false, None);
            }
        }
        // A large diagnostic jump can exhaust conservative advancement before
        // reaching contact. Do not mislabel the nearest distant body as a hit.
        result(at(t), true, Some("sweep-budget".into()))
    }

    fn affected(&self, def: &ShipDefinition, index: usize) -> Vec<bool> {
        let mut result = vec![false; def.mounts.len()];
        result[index] = true;
        for i in index + 1..def.mounts.len() {
            if let Some(parent) = &def.mounts[i].parent_mount_id {
                if let Some(p) = def.mounts[..i].iter().position(|m| &m.id == parent) {
                    result[i] = result[p];
                }
            }
        }
        result
    }
    fn distance(
        &self,
        def: &ShipDefinition,
        poses: &[ClearancePose],
        changed: &[bool],
        limit: f64,
    ) -> (f64, Option<String>) {
        let frames: Vec<_> = (0..def.mounts.len())
            .map(|i| mount_frame(def, i, &|j| poses[j].train))
            .collect();
        let barrels: Vec<Vec<_>> = def
            .mounts
            .iter()
            .enumerate()
            .map(|(i, m)| {
                barrel_capsules(&m.weapon, poses[i].elevation)
                    .into_iter()
                    .map(|c| c.transformed(frames[i]))
                    .collect()
            })
            .collect();
        let barrel_bounds: Vec<_> = barrels
            .iter()
            .map(|capsules| {
                let mut bounds = Box3::points(capsules.iter().flat_map(|c| [c.a, c.b]));
                let radius = capsules.iter().map(|c| c.radius).fold(0.0, f64::max);
                bounds.size = bounds.size.map(|v| v + 2.0 * radius);
                bounds
            })
            .collect();
        let body_bounds: Vec<_> = self
            .bodies
            .iter()
            .map(|body| {
                body.mount
                    .map_or(body.bounds, |i| body.bounds.transformed(frames[i]))
            })
            .collect();
        let (mut gap, mut id) = (limit, None);
        for (i, capsules) in barrels.iter().enumerate() {
            for (body, bounds) in self.bodies.iter().zip(&body_bounds) {
                if body.enclosure && body.mount == Some(i) {
                    continue;
                }
                if !changed[i] && !body.mount.is_some_and(|j| changed[j]) {
                    continue;
                }
                if barrel_bounds[i].separation(*bounds) >= gap {
                    continue;
                }
                for &capsule in capsules {
                    let local = body.mount.map_or(capsule, |j| capsule.inverse(frames[j]));
                    let d = body.distance(local, gap);
                    if d < gap {
                        gap = d;
                        id = Some(body.id.clone());
                    }
                }
            }
            for j in i + 1..barrels.len() {
                if !changed[i] && !changed[j] {
                    continue;
                }
                if barrel_bounds[i].separation(barrel_bounds[j]) >= gap {
                    continue;
                }
                for a in capsules {
                    for b in &barrels[j] {
                        if a.bounds().separation(b.bounds()) - a.radius - b.radius >= gap {
                            continue;
                        }
                        let d = segment_segment_distance(a.a, a.b, b.a, b.b) - a.radius - b.radius;
                        if d < gap {
                            gap = d;
                            id = Some(format!("{}:barrels:{}", def.mounts[i].id, def.mounts[j].id));
                        }
                    }
                }
            }
        }
        (gap, id)
    }
}

fn barrel_capsules(w: &GunPart, elevation: f64) -> Vec<Capsule> {
    let mut result = vec![];
    let radius = w
        .barrel_base_radius
        .unwrap_or(if w.caliber_m > 0.2 { 0.69 } else { 0.30 });
    let trunnion = w.trunnion_forward;
    let enclosed = w.mounting_style.as_deref().unwrap_or("enclosed") == "enclosed";
    let sections = if enclosed {
        // Split the original taper into <=0.5 m frusta. Their maximum end
        // radius encloses each piece without fattening the thin forward tube
        // to its breech radius. Include all possible recoil translations.
        let controls = [
            (trunnion + 0.4, radius * 0.83),
            (trunnion + 2.4, radius * 0.76),
            (trunnion + 2.6, radius * 0.64),
            (w.muzzle_forward - 2.0, radius * 0.43),
            (w.muzzle_forward + 0.035, radius * 0.40),
        ];
        let mut sections = vec![(trunnion - 0.65, trunnion + 0.7, radius * 1.12)];
        for pair in controls.windows(2) {
            let ((a, ra), (b, rb)) = (pair[0], pair[1]);
            let count = ((b - a).abs() / 0.5).ceil().max(1.0) as usize;
            for i in 0..count {
                let (t, u) = (i as f64 / count as f64, (i + 1) as f64 / count as f64);
                sections.push((
                    a + (b - a) * t,
                    a + (b - a) * u,
                    (ra + (rb - ra) * t).max(ra + (rb - ra) * u),
                ));
            }
        }
        sections
    } else {
        vec![
            (
                trunnion - 1.55,
                trunnion + 0.2,
                radius.max(w.caliber_m * 1.6),
            ),
            (trunnion, w.muzzle_forward + 0.035, radius),
        ]
    };
    for barrel in 0..w.barrel_count.unwrap_or(2.0) as usize {
        let (x, row) = (barrel_offset(w, barrel), barrel_height(w, barrel));
        let point = |forward: f64| {
            let along = forward - trunnion;
            [
                x,
                w.pivot_height + along * elevation.sin() + row * elevation.cos(),
                -(trunnion + along * elevation.cos() - row * elevation.sin()),
            ]
        };
        for &(a, b, radius) in &sections {
            result.push(Capsule {
                a: point(a - w.recoil_m),
                b: point(b),
                radius,
            });
        }
    }
    result
}

fn gunhouse(w: &GunPart) -> Vec<[Vec3; 3]> {
    let convert = |v: Vec3| [-v[1], v[2], -v[0]];
    if let Some(mesh) = &w.gunhouse_mesh {
        return mesh
            .faces
            .iter()
            .map(|f| f.indices.map(|i| convert(mesh.vertices[i as usize])))
            .collect();
    }
    if let Some(shape) = &w.gunhouse_shape {
        let n = shape.footprint.len();
        let vertices: Vec<_> = shape
            .footprint
            .iter()
            .map(|p| convert([p[0], p[1], w.gunhouse_base_height.unwrap_or(0.25)]))
            .chain(shape.roof.iter().map(|v| convert(*v)))
            .collect();
        return prism_triangles(&vertices, n);
    }
    let [length, width, height] = w.gunhouse_size;
    if w.mounting_style.as_deref().unwrap_or("enclosed") == "enclosed" {
        let outline = [
            (-0.51, -0.34),
            (-0.37, -0.5),
            (0.31, -0.5),
            (0.50, -0.30),
            (0.50, 0.30),
            (0.31, 0.5),
            (-0.37, 0.5),
            (-0.51, 0.34),
        ];
        let vertices: Vec<_> = outline
            .iter()
            .map(|&(a, b)| convert([a * length, b * width, 0.25]))
            .chain(
                outline
                    .iter()
                    .map(|&(a, b)| convert([a * length * 0.89 - 0.18, b * width * 0.91, height])),
            )
            .collect();
        return prism_triangles(&vertices, 8);
    }
    // Original open-carriage proxy excludes the empty air above its cradle.
    let height = height
        .min(w.pivot_height + w.barrel_base_radius.unwrap_or(w.caliber_m * 0.85) * 1.5 + 0.16);
    box_triangles([0.0, height / 2.0, 0.0], [width, height, length])
}
fn prism_triangles(vertices: &[Vec3], n: usize) -> Vec<[Vec3; 3]> {
    let mut triangles = vec![];
    for i in 0..n {
        let j = (i + 1) % n;
        triangles.push([vertices[i], vertices[j], vertices[n + j]]);
        triangles.push([vertices[i], vertices[n + j], vertices[n + i]]);
    }
    for i in 1..n - 1 {
        triangles.push([vertices[0], vertices[i + 1], vertices[i]]);
        triangles.push([vertices[n], vertices[n + i], vertices[n + i + 1]]);
    }
    triangles
}
fn box_triangles(center: Vec3, size: Vec3) -> Vec<[Vec3; 3]> {
    let vertices: Vec<_> = [-1.0, 1.0]
        .iter()
        .flat_map(|&y| {
            [(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)].map(|(x, z)| {
                add(
                    center,
                    [x * size[0] / 2.0, y * size[1] / 2.0, z * size[2] / 2.0],
                )
            })
        })
        .collect();
    prism_triangles(&vertices, 4)
}

fn point_segment_distance(p: Vec3, a: Vec3, b: Vec3) -> f64 {
    let ab = sub(b, a);
    let n = dot(ab, ab);
    length(sub(
        p,
        add(
            a,
            scale(
                ab,
                if n > 1e-20 {
                    clamp(dot(sub(p, a), ab) / n, 0.0, 1.0)
                } else {
                    0.0
                },
            ),
        ),
    ))
}
fn segment_segment_distance(p: Vec3, q: Vec3, a: Vec3, b: Vec3) -> f64 {
    let (u, v, w) = (sub(q, p), sub(b, a), sub(p, a));
    let (aa, bb, cc, dd, ee) = (dot(u, u), dot(u, v), dot(v, v), dot(u, w), dot(v, w));
    if aa < 1e-20 {
        return point_segment_distance(p, a, b);
    }
    if cc < 1e-20 {
        return point_segment_distance(a, p, q);
    }
    let denom = aa * cc - bb * bb;
    let mut s = if denom > 1e-20 {
        clamp((bb * ee - cc * dd) / denom, 0.0, 1.0)
    } else {
        0.0
    };
    let mut t = (bb * s + ee) / cc;
    if t < 0.0 {
        t = 0.0;
        s = clamp(-dd / aa, 0.0, 1.0);
    } else if t > 1.0 {
        t = 1.0;
        s = clamp((bb - dd) / aa, 0.0, 1.0);
    }
    length(sub(add(p, scale(u, s)), add(a, scale(v, t))))
}
fn point_triangle_distance(p: Vec3, [a, b, c]: [Vec3; 3]) -> f64 {
    let n = cross(sub(b, a), sub(c, a));
    let nn = dot(n, n);
    if nn > 1e-20 {
        let projected = sub(p, scale(n, dot(sub(p, a), n) / nn));
        if [(a, b), (b, c), (c, a)]
            .iter()
            .all(|&(u, v)| dot(cross(sub(v, u), sub(projected, u)), n) >= -1e-12)
        {
            return dot(sub(p, a), n).abs() / nn.sqrt();
        }
    }
    point_segment_distance(p, a, b)
        .min(point_segment_distance(p, b, c))
        .min(point_segment_distance(p, c, a))
}
fn segment_triangle_distance(p: Vec3, q: Vec3, triangle: [Vec3; 3]) -> f64 {
    let [a, b, c] = triangle;
    let n = cross(sub(b, a), sub(c, a));
    let delta = sub(q, p);
    let denom = dot(n, delta);
    if denom.abs() > 1e-16 {
        let t = dot(n, sub(a, p)) / denom;
        if (0.0..=1.0).contains(&t)
            && point_triangle_distance(add(p, scale(delta, t)), triangle) < 1e-8
        {
            return 0.0;
        }
    }
    point_triangle_distance(p, triangle)
        .min(point_triangle_distance(q, triangle))
        .min(segment_segment_distance(p, q, a, b))
        .min(segment_segment_distance(p, q, b, c))
        .min(segment_segment_distance(p, q, c, a))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn spatial_tree_matches_exhaustive_triangle_distance() {
        let triangles: Vec<_> = (0..80).map(|i| {
            let x = (i % 10) as f64 * 2.0;
            let z = (i / 10) as f64 * 3.0;
            [[x, 0.0, z], [x + 1.0, 0.5, z], [x, 0.0, z + 2.0]]
        }).collect();
        let body = Body::new("test".into(), None, false, triangles.clone());
        for i in 0..100 {
            let x = i as f64 * 0.23 - 2.0;
            let capsule = Capsule { a: [x, -0.2, 1.0], b: [x + 0.4, 0.8, 17.0], radius: 0.12 };
            for limit in [0.02, 1.0, 100.0] {
                let exhaustive = triangles.iter().fold(limit, |gap: f64, t| gap.min(segment_triangle_distance(capsule.a, capsule.b, *t) - capsule.radius));
                assert!((body.distance(capsule, limit) - exhaustive).abs() < 1e-10);
            }
        }
    }
    #[test]
    fn finite_segment_triangle_distances_include_face_edge_vertex_and_parallel_contact() {
        let t = [[0.0, 0.0, 0.0], [2.0, 0.0, 0.0], [0.0, 0.0, 2.0]];
        assert!(segment_triangle_distance([0.3, -1.0, 0.3], [0.3, 1.0, 0.3], t) < 1e-10);
        assert!(
            (segment_triangle_distance([0.3, 1.0, 0.3], [0.4, 1.0, 0.4], t) - 1.0).abs() < 1e-10
        );
        assert!(
            (segment_triangle_distance([-1.0, 0.0, -1.0], [-2.0, 0.0, -2.0], t) - 2.0_f64.sqrt())
                .abs()
                < 1e-10
        );
        assert!(segment_triangle_distance([-1.0, 0.0, 0.5], [1.0, 0.0, 0.5], t) < 1e-10);
        assert!(
            segment_segment_distance(
                [0.0, 0.0, 0.0],
                [1.0, 0.0, 0.0],
                [0.5, -1.0, 0.0],
                [0.5, 1.0, 0.0]
            ) < 1e-10
        );
    }
}
