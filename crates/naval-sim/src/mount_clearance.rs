//! Physical gun movement interlocks. All inputs are original authored CPU data;
//! neither rendering meshes nor firing rays participate in movement acceptance.
use crate::{
    definition::{GunPart, MountClearanceProfile, ShipDefinition, Vec3},
    geometry::*,
    mount_frames::mount_frame,
    structure::{bounds, structural_surfaces},
    weapons::{MountState, barrel_height, barrel_offset},
};
use serde::{Deserialize, Serialize};

// Keep the installation preview/combat entry points stable while each geometry
// encoding retains its own collision algorithm.
pub use crate::installation_clearance::{mount_pose_clear, move_mount_with_clearance};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ClearanceMode {
    SweptBodies,
    Installation,
}

pub(crate) fn clearance_mode(profile: &MountClearanceProfile) -> Result<ClearanceMode, String> {
    let bodies = profile.mount_ids.is_some() || profile.bodies.is_some();
    let installation =
        profile.mounts.is_some() || profile.structures.is_some() || profile.neighbors.is_some();
    if bodies == installation {
        return Err("Mount clearance requires exactly one geometry encoding".into());
    }
    let (mode, min_margin, max_margin) = if bodies {
        if profile.mount_ids.is_none() || profile.bodies.is_none() {
            return Err("Mount clearance bodies require mountIds and bodies".into());
        }
        (ClearanceMode::SweptBodies, 0.0, 0.2)
    } else {
        if profile.mounts.is_none() || profile.structures.is_none() || profile.neighbors.is_none() {
            return Err("Installation clearance requires mounts, structures and neighbors".into());
        }
        (ClearanceMode::Installation, 0.001, 0.5)
    };
    if profile.version != 1.0
        || !profile.margin_m.is_finite()
        || !(min_margin..=max_margin).contains(&profile.margin_m)
        || profile.basis.trim().is_empty()
    {
        return Err("Invalid mount clearance profile".into());
    }
    Ok(mode)
}

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
    fn transformed(self, frame: &Basis) -> Self {
        let (c, s) = frame.heading_spread();
        Self {
            center: frame.local_to_world(self.center),
            size: [
                c * self.size[0] + s * self.size[2],
                self.size[1],
                s * self.size[0] + c * self.size[2],
            ],
        }
    }
    fn gaps(self, other: Self) -> Vec3 {
        std::array::from_fn(|i| {
            ((self.center[i] - other.center[i]).abs() - (self.size[i] + other.size[i]) / 2.0)
                .max(0.0)
        })
    }
    fn separation(self, other: Self) -> f64 {
        length(self.gaps(other))
    }
    /// Whether `self.separation(other)` exceeds `reach`, when that is beyond
    /// doubt. Broad-phase rejections need the comparison, not a correctly
    /// rounded distance, so squares settle it wherever they differ by far more
    /// than the rounding of either side; `None` inside that band and for a
    /// non-positive reach, where the caller's original expression decides.
    fn beyond(self, other: Self, reach: f64) -> Option<bool> {
        let gaps = self.gaps(other);
        let squared = dot(gaps, gaps);
        if reach > 0.0 && squared.is_finite() && reach.is_finite() {
            let reach = reach * reach;
            if (squared - reach).abs() > 1e-9 * squared.max(reach) {
                return Some(squared > reach);
            }
        }
        None
    }
    /// `self.separation(other) - slack >= limit`.
    fn clears(self, other: Self, slack: f64, limit: f64) -> bool {
        self.beyond(other, limit + slack)
            .unwrap_or_else(|| self.separation(other) - slack >= limit)
    }
    /// `self.separation(near) < self.separation(far)`, by the same rule.
    fn nearer(self, near: Self, far: Self) -> bool {
        let (a, b) = (self.gaps(near), self.gaps(far));
        let (a2, b2) = (dot(a, a), dot(b, b));
        if a2.is_finite() && b2.is_finite() && (a2 - b2).abs() > 1e-9 * a2.max(b2) {
            return a2 < b2;
        }
        length(a) < length(b)
    }
}
/// A clearance body's triangles never deform: moving mounts transform the
/// query into the body's frame. Keep the edge and plane terms with that shared
/// geometry instead of deriving them for every barrel section on every tick.
#[derive(Clone, Debug)]
struct PreparedTriangle {
    vertices: [Vec3; 3],
    edges: [Vec3; 3],
    edge_squared: [f64; 3],
    normal: Vec3,
    normal_squared: f64,
}
impl PreparedTriangle {
    fn new(vertices: [Vec3; 3]) -> Self {
        let [a, b, c] = vertices;
        let edges = [sub(b, a), sub(c, b), sub(a, c)];
        let normal = cross(sub(b, a), sub(c, a));
        Self {
            vertices,
            edges,
            edge_squared: edges.map(|e| dot(e, e)),
            normal,
            normal_squared: dot(normal, normal),
        }
    }
    fn point_distance(&self, p: Vec3) -> f64 {
        let n = self.normal;
        let nn = self.normal_squared;
        if nn > 1e-20 {
            let projected = sub(p, scale(n, dot(sub(p, self.vertices[0]), n) / nn));
            if (0..3)
                .all(|i| dot(cross(self.edges[i], sub(projected, self.vertices[i])), n) >= -1e-12)
            {
                return dot(sub(p, self.vertices[0]), n).abs() / nn.sqrt();
            }
        }
        let edge =
            |i| point_edge_distance(p, self.vertices[i], self.edges[i], self.edge_squared[i]);
        edge(0).min(edge(1)).min(edge(2))
    }
    fn distance(&self, p: Vec3, q: Vec3) -> f64 {
        let n = self.normal;
        let delta = sub(q, p);
        let denom = dot(n, delta);
        if denom.abs() > 1e-16 {
            let t = dot(n, sub(self.vertices[0], p)) / denom;
            if (0.0..=1.0).contains(&t) && self.point_distance(add(p, scale(delta, t))) < 1e-8 {
                return 0.0;
            }
        }
        let [a, b, c] = self.vertices;
        self.point_distance(p)
            .min(self.point_distance(q))
            .min(segment_segment_distance(p, q, a, b))
            .min(segment_segment_distance(p, q, b, c))
            .min(segment_segment_distance(p, q, c, a))
    }
}
#[derive(Clone, Debug)]
struct Chunk {
    bounds: Box3,
    triangles: Vec<PreparedTriangle>,
    children: Option<Box<[Chunk; 2]>>,
}
impl Chunk {
    fn new(mut triangles: Vec<[Vec3; 3]>) -> Self {
        let bounds = Box3::points(triangles.iter().flatten().copied());
        if triangles.len() <= 12 {
            return Self {
                bounds,
                triangles: triangles.into_iter().map(PreparedTriangle::new).collect(),
                children: None,
            };
        }
        let axis = (0..3)
            .max_by(|&a, &b| bounds.size[a].total_cmp(&bounds.size[b]))
            .unwrap();
        triangles.sort_unstable_by(|a, b| {
            let center = |t: &[Vec3; 3]| t.iter().map(|p| p[axis]).sum::<f64>();
            center(a).total_cmp(&center(b))
        });
        let right = triangles.split_off(triangles.len() / 2);
        Self {
            bounds,
            triangles: vec![],
            children: Some(Box::new([Self::new(triangles), Self::new(right)])),
        }
    }
    fn distance(&self, capsule: Capsule, bounds: Box3, nearest: &mut f64) {
        if bounds.clears(self.bounds, capsule.radius, *nearest) {
            return;
        }
        if let Some(children) = &self.children {
            let first = usize::from(bounds.nearer(children[1].bounds, children[0].bounds));
            children[first].distance(capsule, bounds, nearest);
            children[1 - first].distance(capsule, bounds, nearest);
        } else {
            for triangle in &self.triangles {
                *nearest = nearest.min(triangle.distance(capsule.a, capsule.b) - capsule.radius);
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

/// Shared triangle acceleration for renderer-free construction support checks.
pub(crate) struct SurfaceTree(Body);
impl SurfaceTree {
    pub fn new(triangles: Vec<[Vec3; 3]>) -> Self {
        Self(Body::new(String::new(), None, false, triangles))
    }
    pub fn distance(&self, a: Vec3, b: Vec3, limit: f64) -> f64 {
        self.0.distance(Capsule { a, b, radius: 0. }, limit)
    }
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
        self.distance_within(capsule, capsule.bounds(), limit)
    }
    /// `bounds` is `capsule.bounds()`, which a posed barrel already holds.
    fn distance_within(&self, capsule: Capsule, bounds: Box3, limit: f64) -> f64 {
        if bounds.clears(self.bounds, capsule.radius, limit) {
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
    fn transformed(self, frame: &Basis) -> Self {
        Self {
            a: frame.local_to_world(self.a),
            b: frame.local_to_world(self.b),
            ..self
        }
    }
    fn inverse(self, frame: &Basis) -> Self {
        Self {
            a: frame.world_to_local(self.a),
            b: frame.world_to_local(self.b),
            ..self
        }
    }
}
/// Broad phase over immutable obstacles. Query results are restored to authored
/// order so equal-distance obstruction IDs and conservative sweep arithmetic agree.
#[derive(Clone, Debug)]
struct BodyIndex {
    bounds: Box3,
    indices: Vec<usize>,
    children: Option<Box<[BodyIndex; 2]>>,
}
impl BodyIndex {
    fn new(bodies: &[Body], mut indices: Vec<usize>) -> Option<Self> {
        if indices.is_empty() {
            return None;
        }
        let bounds = Box3::points(indices.iter().flat_map(|&i| {
            let b = bodies[i].bounds;
            [
                std::array::from_fn(|a| b.center[a] - b.size[a] * 0.5),
                std::array::from_fn(|a| b.center[a] + b.size[a] * 0.5),
            ]
        }));
        if indices.len() <= 12 {
            return Some(Self {
                bounds,
                indices,
                children: None,
            });
        }
        let axis = (0..3)
            .max_by(|&a, &b| bounds.size[a].total_cmp(&bounds.size[b]))
            .unwrap();
        indices.sort_by(|&a, &b| {
            bodies[a].bounds.center[axis]
                .total_cmp(&bodies[b].bounds.center[axis])
                .then(a.cmp(&b))
        });
        let right = indices.split_off(indices.len() / 2);
        Some(Self {
            bounds,
            indices: vec![],
            children: Some(Box::new([
                Self::new(bodies, indices).unwrap(),
                Self::new(bodies, right).unwrap(),
            ])),
        })
    }
    fn query(&self, bounds: Box3, limit: f64, out: &mut Vec<usize>) {
        // Outward numerical slack only admits extra candidates; it never relaxes
        // the original per-body narrow phase or clearance margin.
        if bounds
            .beyond(self.bounds, limit + 1e-8)
            .unwrap_or_else(|| bounds.separation(self.bounds) > limit + 1e-8)
        {
            return;
        }
        if let Some(children) = &self.children {
            for child in children.iter() {
                child.query(bounds, limit, out);
            }
        } else {
            out.extend_from_slice(&self.indices);
        }
    }
}
/// One mount's barrels in ship coordinates at one pose. `key` is the frame and
/// elevation they were built from, compared bit for bit before any reuse.
#[derive(Clone, Debug)]
struct PosedMount {
    key: [u64; 5],
    frame: Basis,
    capsules: Vec<Capsule>,
    capsule_bounds: Vec<Box3>,
    /// Runs of neighbouring barrel sections: a box around each run, its largest
    /// radius, and the run. A body or another run clearly beyond that box is
    /// beyond every section in it, which skips the per-section rejections.
    runs: Vec<(Box3, f64, std::ops::Range<usize>)>,
    bounds: Box3,
}
/// Sections per run; a run of an enclosed barrel is about four metres of tube.
const RUN: usize = 8;
/// Every mount of one hull, posed. A sweep moves one mount and its descendants;
/// the rest keep their barrels between steps, mounts and ticks.
#[derive(Default)]
struct Posed {
    mounts: Vec<Option<PosedMount>>,
    candidates: Vec<usize>,
    moving: Vec<usize>,
}
thread_local! {
    /// Posed hulls by clearance geometry and caller-chosen owner, most recent last.
    static POSED: std::cell::RefCell<Vec<(u64, usize, Posed)>> = const { std::cell::RefCell::new(Vec::new()) };
}
const POSED_HULLS: usize = 32;
static GEOMETRIES: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
/// A gap one mount measured, with the poses it was measured at. The sweep
/// already trusts that no point of a mount moves faster than its reach times
/// its angular rate, so the same bound says how far that gap can have closed
/// since: while what is left clears the sweep's needs, the mount is free to take
/// its requested pose and no geometry has to be measured to say so.
#[derive(Clone, Debug)]
pub struct ClearBound {
    generation: u64,
    poses: Vec<[f64; 2]>,
    gap: f64,
}
#[derive(Clone, Debug)]
pub struct MountClearance {
    /// Unique per built geometry, so a posed hull is never reused across designs.
    generation: u64,
    /// Per mount, every mount whose motion can close one of its checked gaps,
    /// itself included: those near enough for a gap within the sweep's search
    /// distance, or every mount when any is carried by another.
    relevant: Vec<Vec<usize>>,
    /// Per mount, each mount that moves it (itself and its carriers) with the
    /// farthest any of its points sits from that mount's axis.
    levers: Vec<Vec<(usize, f64)>>,
    enabled: Vec<bool>,
    margin: f64,
    bodies: Vec<Body>,
    static_index: Option<BodyIndex>,
    moving: Vec<usize>,
    // Maximum distance from each yaw/elevation axis bounds every point's speed.
    radii: Vec<f64>,
}
impl MountClearance {
    pub fn new(def: &ShipDefinition) -> Result<Option<Self>, String> {
        let Some(profile) = &def.mount_clearance else {
            return Ok(None);
        };
        if clearance_mode(profile)? == ClearanceMode::Installation {
            crate::installation_clearance::validate_profile(def)?;
            return Ok(None);
        }
        let mount_ids = profile
            .mount_ids
            .as_ref()
            .expect("validated bodies encoding");
        let authored_bodies = profile.bodies.as_ref().expect("validated bodies encoding");
        let mut enabled = vec![false; def.mounts.len()];
        for id in mount_ids {
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
        for body in authored_bodies {
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
        let nested = def.mounts.iter().any(|m| m.parent_mount_id.is_some());
        let relevant = (0..def.mounts.len())
            .map(|i| {
                (0..def.mounts.len())
                    .filter(|&j| {
                        nested
                            || i == j
                            || length(sub(def.mounts[i].position, def.mounts[j].position))
                                - radii[i]
                                - radii[j]
                                < profile.margin_m + 2.0
                    })
                    .collect()
            })
            .collect();
        let levers = (0..def.mounts.len())
            .map(|i| {
                let mut chain = vec![(i, radii[i])];
                let mut at = i;
                while let Some(parent) = def.mounts[at]
                    .parent_mount_id
                    .as_ref()
                    .and_then(|id| def.mounts[..at].iter().position(|m| &m.id == id))
                {
                    chain.push((
                        parent,
                        radii[i] + length(sub(def.mounts[i].position, def.mounts[parent].position)),
                    ));
                    at = parent;
                }
                chain
            })
            .collect();
        Ok(Some(Self {
            generation: GEOMETRIES.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
            relevant,
            levers,
            enabled,
            margin: profile.margin_m,
            static_index: BodyIndex::new(
                &bodies,
                (0..bodies.len())
                    .filter(|&i| bodies[i].mount.is_none())
                    .collect(),
            ),
            moving: (0..bodies.len())
                .filter(|&i| bodies[i].mount.is_some())
                .collect(),
            bodies,
            radii,
        }))
    }

    /// Offline runtime projection: retain every body within a mount's existing
    /// conservative sweep-radius bound. Nested installations keep all bodies.
    /// This removes unreachable geometry; it never substitutes enclosing shells.
    pub fn reachable_body_ids(&self, def: &ShipDefinition) -> std::collections::BTreeSet<String> {
        let nested = def.mounts.iter().any(|m| m.parent_mount_id.is_some());
        self.bodies
            .iter()
            .filter(|body| {
                nested
                    || body.mount.is_some()
                    || def.mounts.iter().enumerate().any(|(i, m)| {
                        let distance = length(std::array::from_fn(|a| {
                            ((m.position[a] - body.bounds.center[a]).abs()
                                - body.bounds.size[a] * 0.5)
                                .max(0.)
                        }));
                        distance <= self.radii[i] + self.margin + 1.
                    })
            })
            .map(|b| b.id.clone())
            .collect()
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
        let mut posed = Posed::default();
        self.pose(def, poses, None, &mut posed);
        self.distance(def, &mut posed, &changed, limit)
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
        self.resolve_for(0, def, index, poses, requested, &mut None)
    }
    /// `owner` names the hull being posed (any stable value, such as the address
    /// of its mount states) so two hulls of one class keep separate posed
    /// barrels. It selects a cache only; the result never depends on it, nor on
    /// `bound`, which the mount keeps between calls.
    pub fn resolve_for(
        &self,
        owner: usize,
        def: &ShipDefinition,
        index: usize,
        poses: &[ClearancePose],
        requested: ClearancePose,
        bound: &mut Option<ClearBound>,
    ) -> ClearanceResult {
        if let Some(result) = self.certified(def, index, poses, requested, bound) {
            return result;
        }
        let mut posed = POSED.with_borrow_mut(|hulls| {
            hulls
                .iter()
                .position(|h| h.0 == self.generation && h.1 == owner)
                .map(|i| hulls.remove(i).2)
                .unwrap_or_default()
        });
        let result = self.sweep(def, index, poses, requested, &mut posed, bound);
        POSED.with_borrow_mut(|hulls| {
            if hulls.len() >= POSED_HULLS {
                hulls.remove(0);
            }
            hulls.push((self.generation, owner, posed));
        });
        result
    }
    /// The sweep's answer when a kept bound already decides it. Every gap this
    /// mount checks closes no faster than the two mounts involved move, so since
    /// the bound was measured it has lost at most twice the largest motion among
    /// the mounts that matter, and along the requested path at most `speed` more.
    /// If what remains stays above the stop line, and above the step the sweep's
    /// iteration budget needs, the sweep would reach the requested pose without
    /// meeting anything: that is its result, and the remainder is the new bound.
    fn certified(
        &self,
        def: &ShipDefinition,
        index: usize,
        poses: &[ClearancePose],
        requested: ClearancePose,
        bound: &mut Option<ClearBound>,
    ) -> Option<ClearanceResult> {
        let kept = bound.as_mut()?;
        if kept.generation != self.generation
            || kept.poses.len() != poses.len()
            || poses.len() != def.mounts.len()
            || index >= poses.len()
            || !self.enabled(index)
        {
            return None;
        }
        let w = &def.mounts[index].weapon;
        let [min_train, max_train] = def.mounts[index]
            .traverse_limits_deg
            .unwrap_or([-w.traverse_deg, w.traverse_deg])
            .map(radians);
        let requested = ClearancePose {
            train: clamp(requested.train, min_train, max_train),
            elevation: clamp(
                requested.elevation,
                radians(w.elevation_min_deg),
                radians(w.elevation_max_deg),
            ),
            recoil: clamp(requested.recoil, 0.0, 1.0),
        };
        let start = poses[index];
        let turned = |a: usize| {
            (poses[a].train - kept.poses[a][0]).abs()
                + (poses[a].elevation - kept.poses[a][1]).abs()
        };
        let motion = self.relevant[index]
            .iter()
            .map(|&m| {
                self.levers[m]
                    .iter()
                    .map(|&(a, lever)| lever * turned(a))
                    .sum::<f64>()
            })
            .fold(0.0, f64::max);
        let changed = self.affected(def, index);
        let radius = changed
            .iter()
            .enumerate()
            .filter(|(_, v)| **v)
            .map(|(i, _)| {
                self.radii[i] + length(sub(def.mounts[i].position, def.mounts[index].position))
            })
            .fold(0.0, f64::max);
        let speed = 2.0
            * radius
            * ((requested.train - start.train).abs()
                + (requested.elevation - start.elevation).abs());
        let left = kept.gap - 2.0 * motion - speed;
        // NaN poses or requests fail this comparison and take the full sweep.
        if !(speed >= 1e-12 && left >= self.margin.max(speed / 100.0) + 1e-6) {
            return None;
        }
        kept.gap = left;
        for (kept, pose) in kept.poses.iter_mut().zip(poses) {
            *kept = [pose.train, pose.elevation];
        }
        kept.poses[index] = [requested.train, requested.elevation];
        Some(ClearanceResult {
            pose: requested,
            blocked: false,
            obstruction_id: None,
        })
    }
    fn sweep(
        &self,
        def: &ShipDefinition,
        index: usize,
        poses: &[ClearancePose],
        requested: ClearancePose,
        posed: &mut Posed,
        bound: &mut Option<ClearBound>,
    ) -> ClearanceResult {
        *bound = None;
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
        let [min_train, max_train] = def.mounts[index]
            .traverse_limits_deg
            .unwrap_or([-w.traverse_deg, w.traverse_deg])
            .map(radians);
        let requested = ClearancePose {
            train: clamp(requested.train, min_train, max_train),
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
        self.pose(def, &candidate, None, posed);
        let (mut gap, mut obstacle) =
            self.distance(def, posed, &changed, speed + self.margin + 1.0);
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
            self.pose(def, &candidate, Some(&changed), posed);
            let (next_gap, next_obstacle) = self.distance(
                def,
                posed,
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
                    self.pose(def, &candidate, Some(&changed), posed);
                    if self.distance(def, posed, &changed, stop_gap + 0.01).0 >= stop_gap {
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
                // Measured at the pose just accepted, among these neighbours.
                *bound = Some(ClearBound {
                    generation: self.generation,
                    poses: candidate.iter().map(|p| [p.train, p.elevation]).collect(),
                    gap,
                });
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
            if let Some(parent) = &def.mounts[i].parent_mount_id
                && let Some(p) = def.mounts[..i].iter().position(|m| &m.id == parent)
            {
                result[i] = result[p];
            }
        }
        result
    }
    /// Bring `posed` to `poses`. Only mounts in `only` can have moved since the
    /// last call with this `posed`; `None` checks every mount. A mount whose
    /// frame and elevation are unchanged keeps its barrels.
    fn pose(
        &self,
        def: &ShipDefinition,
        poses: &[ClearancePose],
        only: Option<&[bool]>,
        posed: &mut Posed,
    ) {
        posed.mounts.resize_with(def.mounts.len(), || None);
        for (i, m) in def.mounts.iter().enumerate() {
            if only.is_some_and(|only| !only[i]) && posed.mounts[i].is_some() {
                continue;
            }
            let frame = mount_frame(def, i, &|j| poses[j].train);
            let key =
                [frame.x, frame.y, frame.z, frame.heading, poses[i].elevation].map(f64::to_bits);
            if posed.mounts[i].as_ref().is_some_and(|p| p.key == key) {
                continue;
            }
            let frame = Basis::of(frame);
            // A tracking mount is re-posed at every sweep step; keep its buffers.
            let (mut capsules, mut capsule_bounds, mut runs) = match posed.mounts[i].take() {
                Some(p) => (p.capsules, p.capsule_bounds, p.runs),
                None => Default::default(),
            };
            capsules.clear();
            capsules.extend(
                barrel_capsules(&m.weapon, poses[i].elevation, def.hull.volume.is_some())
                    .into_iter()
                    .map(|c| c.transformed(&frame)),
            );
            let mut bounds = Box3::points(capsules.iter().flat_map(|c| [c.a, c.b]));
            let radius = capsules.iter().map(|c| c.radius).fold(0.0, f64::max);
            bounds.size = bounds.size.map(|v| v + 2.0 * radius);
            capsule_bounds.clear();
            capsule_bounds.extend(capsules.iter().map(|c| c.bounds()));
            runs.clear();
            runs.extend((0..capsules.len()).step_by(RUN).map(|start| {
                let run = start..(start + RUN).min(capsules.len());
                let mut bounds =
                    Box3::points(capsules[run.clone()].iter().flat_map(|c| [c.a, c.b]));
                // A section's own box is never thinner than 0.01 mm, which
                // can reach past the run's points on a flat axis.
                bounds.size = bounds.size.map(|v| v + 0.00002);
                let radius = capsules[run.clone()]
                    .iter()
                    .map(|c| c.radius)
                    .fold(0.0, f64::max);
                (bounds, radius, run)
            }));
            posed.mounts[i] = Some(PosedMount {
                key,
                frame,
                runs,
                capsule_bounds,
                capsules,
                bounds,
            });
        }
    }
    fn distance(
        &self,
        def: &ShipDefinition,
        posed: &mut Posed,
        changed: &[bool],
        limit: f64,
    ) -> (f64, Option<String>) {
        let Posed {
            mounts,
            candidates,
            moving: moving_bodies,
        } = posed;
        let mount = |i: usize| mounts[i].as_ref().expect("posed mount");
        moving_bodies.clear();
        moving_bodies.extend(
            self.moving
                .iter()
                .copied()
                .filter(|&i| self.bodies[i].mount.is_some_and(|m| changed[m])),
        );
        let (mut gap, mut id) = (limit, None);
        for i in 0..def.mounts.len() {
            let barrels = mount(i);
            candidates.clear();
            if changed[i] {
                if let Some(tree) = &self.static_index {
                    tree.query(barrels.bounds, gap, candidates);
                }
                candidates.extend_from_slice(&self.moving);
                candidates.sort_unstable();
            } else {
                candidates.extend_from_slice(moving_bodies);
            }
            for &index in candidates.iter() {
                let body = &self.bodies[index];
                let bounds = body
                    .mount
                    .map_or(body.bounds, |j| body.bounds.transformed(&mount(j).frame));
                if body.enclosure && body.mount == Some(i) {
                    continue;
                }
                if !changed[i] && !body.mount.is_some_and(|j| changed[j]) {
                    continue;
                }
                if barrels.bounds.clears(bounds, 0.0, gap) {
                    continue;
                }
                for (run_bounds, run_radius, run) in &barrels.runs {
                    // Rejecting a section leaves `gap` alone, so a run whose box
                    // is clearly out of reach changes nothing section by section.
                    if body.mount.is_none()
                        && run_bounds.beyond(body.bounds, gap + run_radius) == Some(true)
                    {
                        continue;
                    }
                    for k in run.clone() {
                        let capsule = barrels.capsules[k];
                        let d = match body.mount {
                            Some(j) => body.distance(capsule.inverse(&mount(j).frame), gap),
                            None => body.distance_within(capsule, barrels.capsule_bounds[k], gap),
                        };
                        if d < gap {
                            gap = d;
                            id = Some(body.id.clone());
                        }
                    }
                }
            }
            for j in i + 1..def.mounts.len() {
                if !changed[i] && !changed[j] {
                    continue;
                }
                let other = mount(j);
                if barrels.bounds.clears(other.bounds, 0.0, gap) {
                    continue;
                }
                // Section pairs keep their authored order; only whole runs of
                // the other mount that one section clearly cannot reach drop out.
                for (a, a_bounds) in barrels.capsules.iter().zip(&barrels.capsule_bounds) {
                    for (run_bounds, run_radius, run) in &other.runs {
                        if a_bounds.beyond(*run_bounds, gap + a.radius + run_radius) == Some(true) {
                            continue;
                        }
                        for k in run.clone() {
                            let (b, b_bounds) = (&other.capsules[k], &other.capsule_bounds[k]);
                            if a_bounds
                                .beyond(*b_bounds, gap + a.radius + b.radius)
                                .unwrap_or_else(|| {
                                    a_bounds.separation(*b_bounds) - a.radius - b.radius >= gap
                                })
                            {
                                continue;
                            }
                            let d =
                                segment_segment_distance(a.a, a.b, b.a, b.b) - a.radius - b.radius;
                            if d < gap {
                                gap = d;
                                id = Some(format!(
                                    "{}:barrels:{}",
                                    def.mounts[i].id, def.mounts[j].id
                                ));
                            }
                        }
                    }
                }
            }
        }
        (gap, id)
    }
}

/// Conservative separate body/barrel bounds for initial construction fitting.
/// A single whole-model box fills the empty space under superfiring barrels.
pub(crate) fn installation_bounds(w: &GunPart, elevation: f64) -> Vec<(Vec3, Vec3)> {
    let mut bounds = vec![crate::structure::bounds(gunhouse(w).into_iter().flatten())];
    bounds.extend(barrel_capsules(w, elevation, true).into_iter().map(|c| {
        let b = c.bounds();
        (b.center, b.size.map(|v| v + 2. * c.radius))
    }));
    bounds
}

fn barrel_capsules(w: &GunPart, elevation: f64, constructed: bool) -> Vec<Capsule> {
    if constructed
        && matches!(
            w.id.as_str(),
            "flak38-m43u-20-twin" | "flak38-20-single" | "flak28-40-single"
        )
    {
        return german_light_capsules(w, elevation);
    }
    if constructed && w.mounting_style.as_deref() == Some("oerlikon") && w.barrel_count == 1.0 {
        return oerlikon_mk4_capsules(w, elevation);
    }
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
    let (sin, cos) = (elevation.sin(), elevation.cos());
    for barrel in 0..w.barrel_count as usize {
        let (x, row) = (barrel_offset(w, barrel), barrel_height(w, barrel));
        let point = |forward: f64| {
            let along = forward - trunnion;
            [
                x,
                w.pivot_height + along * sin + row * cos,
                -(trunnion + along * cos - row * sin),
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

/// Original create_light recipe: receiver, cradle, grips, magazine, sight and
/// guard follow elevation. Their dimensions differ substantially from the
/// generic 1.55 m breech / 0.30 m barrel proxy used by larger open mounts.
fn german_light_capsules(w: &GunPart, elevation: f64) -> Vec<Capsule> {
    let twin = w.id == "flak38-m43u-20-twin";
    let bofors = w.id == "flak28-40-single";
    let mut result = vec![];
    for barrel in 0..w.barrel_count as usize {
        let x = barrel_offset(w, barrel);
        let mut pieces = vec![
            ([0., 0., -0.72], [0., 0., 0.45], 0.205),
            ([0., -0.24, -0.65], [0., -0.24, 0.62], 0.06),
            (
                [0., 0., 0.26],
                [0., 0., w.muzzle_forward - w.trunnion_forward + 0.005],
                if bofors { 0.068 } else { 0.037 },
            ),
            ([0., 0., -0.68], [0., -0.11, -0.79], 0.025),
        ];
        if bofors {
            pieces.push(([0., 0.25, -0.33], [0., 0.49, -0.11], 0.15));
        } else {
            let side = if twin && x < 0. { -1. } else { 1. };
            pieces.push((
                [side * 0.25, 0.22, -0.30],
                [side * 0.25, 0.22, -0.06],
                0.205,
            ));
            for sign in [-1., 1.] {
                pieces.push(([sign * 0.085, 0.1, -0.4], [sign * 0.30, 0.11, -0.78], 0.032));
                pieces.push((
                    [sign * 0.30, 0.11, -0.78],
                    [sign * 0.30, -0.08, -0.85],
                    0.031,
                ));
            }
        }
        pieces.push((
            [0.20, 0.47, if bofors { -0.32 } else { -0.11 }],
            [0.20, 0.55, if bofors { -0.32 } else { -0.11 }],
            0.115,
        ));
        if twin && barrel == 0 {
            for (a, b) in [
                ([0., 0.2, 0.], [0., 0.2, 0.6]),
                ([0., 0.2, 0.6], [0., -0.27, 0.85]),
                ([0., -0.27, 0.85], [0., -0.27, 2.45]),
            ] {
                pieces.push(([a[0] - x, a[1], a[2]], [b[0] - x, b[1], b[2]], 0.019));
            }
        }
        let point = |p: Vec3| {
            [
                x + p[0],
                w.pivot_height + p[2] * elevation.sin() + p[1] * elevation.cos(),
                -(w.trunnion_forward + p[2] * elevation.cos() - p[1] * elevation.sin()),
            ]
        };
        for (mut a, b, radius) in pieces {
            a[2] -= w.recoil_m;
            result.push(Capsule {
                a: point(a),
                b: point(b),
                radius,
            });
        }
    }
    result
}

/// Conservative rigid fitting envelopes from assets/parts/us-oerlikon/geometry.py.
/// Coordinates are lateral/up/forward relative to the retained trunnion. Keep
/// the original short receiver and shoulder cups, rather than the generic large
/// exposed-gun breech. This path is opt-in for constructed Mk4 installations;
/// historical installation clearance remains unchanged.
fn oerlikon_mk4_capsules(w: &GunPart, elevation: f64) -> Vec<Capsule> {
    let mut pieces = vec![
        ([0., 0., -0.465], [0., 0., 0.4], 0.105),
        ([0., 0., 0.1], [0., 0., 1.0], 0.059),
        (
            [0., 0., 1.0],
            [0., 0., w.muzzle_forward - w.trunnion_forward + 0.005],
            0.035_f64.max(w.barrel_base_radius.unwrap_or(0.035)),
        ),
        ([0., 0.1855, 0.02], [0., 0.1855, 0.2], 0.15),
        ([-0.234, 0., -0.424], [0.234, 0., -0.424], 0.021),
        ([0., 0.045, -0.48], [0.057, 0.43, -0.085], 0.012),
        ([0.057, 0.43, -0.085], [0.057, 0.43, -0.085], 0.091),
    ];
    for lateral in [-0.2115, 0.1015] {
        pieces.push(([-lateral, 0., -0.424], [-lateral, 0.13, -0.784], 0.023));
        let path = [
            (-0.595, -0.07),
            (-0.735, -0.02),
            (-0.754, 0.085),
            (-0.695, 0.185),
            (-0.59, 0.187),
        ];
        for p in path.windows(2) {
            pieces.push((
                [-lateral, p[0].1 + 0.09, p[0].0 - 0.034],
                [-lateral, p[1].1 + 0.09, p[1].0 - 0.034],
                0.033,
            ));
        }
        pieces.push(([-lateral, 0.02, -0.424], [-lateral, 0.175, -0.48], 0.014));
        pieces.push(([-lateral, 0.175, -0.48], [-lateral, 0.09, -0.605], 0.019));
    }
    let point = |p: Vec3| {
        [
            p[0],
            w.pivot_height + p[2] * elevation.sin() + p[1] * elevation.cos(),
            -(w.trunnion_forward + p[2] * elevation.cos() - p[1] * elevation.sin()),
        ]
    };
    pieces
        .into_iter()
        .map(|(mut a, b, radius)| {
            a[2] -= w.recoil_m;
            Capsule {
                a: point(a),
                b: point(b),
                radius,
            }
        })
        .collect()
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
    point_edge_distance(p, a, ab, n)
}
fn point_edge_distance(p: Vec3, a: Vec3, ab: Vec3, n: f64) -> f64 {
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
#[cfg(test)]
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
#[cfg(test)]
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
    fn original_german_light_mechanisms_stay_inside_clearance_across_elevation() {
        let catalog: crate::definition::PartCatalog =
            serde_json::from_str(include_str!("../../../assets/parts/guns.json")).unwrap();
        for id in [
            "flak38-m43u-20-twin",
            "flak38-20-single",
            "flak28-40-single",
        ] {
            let w = catalog.parts.iter().find(|p| p.id == id).unwrap();
            for degrees in [-5_f64, 0., 30., 80.] {
                let angle = degrees.to_radians();
                let capsules = german_light_capsules(w, angle);
                for barrel in 0..w.barrel_count as usize {
                    let x = barrel_offset(w, barrel);
                    for recoil in [0., w.recoil_m] {
                        for p in [
                            [0., 0., w.muzzle_forward - w.trunnion_forward],
                            [0., 0., -0.715],
                            [0., -0.24, 0.62],
                            [0., -0.11, -0.79],
                            [
                                0.2,
                                0.61,
                                if id == "flak28-40-single" {
                                    -0.32
                                } else {
                                    -0.11
                                },
                            ],
                        ] {
                            let forward = p[2] - recoil;
                            let point = [
                                x + p[0],
                                w.pivot_height + forward * angle.sin() + p[1] * angle.cos(),
                                -(w.trunnion_forward + forward * angle.cos() - p[1] * angle.sin()),
                            ];
                            assert!(
                                capsules
                                    .iter()
                                    .any(|c| point_segment_distance(point, c.a, c.b)
                                        <= c.radius + 1e-6),
                                "{id} at {degrees}: {point:?}"
                            );
                        }
                    }
                }
            }
        }
    }
    #[test]
    fn spatial_tree_matches_exhaustive_triangle_distance() {
        let triangles: Vec<_> = (0..80)
            .map(|i| {
                let x = (i % 10) as f64 * 2.0;
                let z = (i / 10) as f64 * 3.0;
                [[x, 0.0, z], [x + 1.0, 0.5, z], [x, 0.0, z + 2.0]]
            })
            .collect();
        let body = Body::new("test".into(), None, false, triangles.clone());
        for i in 0..100 {
            let x = i as f64 * 0.23 - 2.0;
            let capsule = Capsule {
                a: [x, -0.2, 1.0],
                b: [x + 0.4, 0.8, 17.0],
                radius: 0.12,
            };
            for limit in [0.02, 1.0, 100.0] {
                let exhaustive = triangles.iter().fold(limit, |gap: f64, t| {
                    gap.min(segment_triangle_distance(capsule.a, capsule.b, *t) - capsule.radius)
                });
                assert!((body.distance(capsule, limit) - exhaustive).abs() < 1e-10);
            }
        }
    }
    #[test]
    fn prepared_triangles_preserve_face_edge_and_degenerate_distances() {
        let triangles = [
            [[0., 0., 0.], [2., 0., 0.], [0., 0., 2.]],
            [[10., -3., 7.], [12., -2., 7.], [10., -3., 9.]],
            [[0., 0., 0.], [1., 0., 0.], [2., 0., 0.]],
            [[0., 0., 0.]; 3],
            [[0., 0., 0.], [1e-11, 0., 0.], [0., 0., 1e-11]],
        ];
        for triangle in triangles {
            let body = Body::new("test".into(), None, false, vec![triangle]);
            for i in 0..100 {
                let p = [i as f64 * 0.17 - 3., (i % 7) as f64 - 3., 0.3];
                for q in [p, [p[0], -p[1], 0.3], [0.3, 1e-12, 0.3], [0.; 3]] {
                    let capsule = Capsule {
                        a: p,
                        b: q,
                        radius: 0.12,
                    };
                    let expected = segment_triangle_distance(p, q, triangle) - capsule.radius;
                    assert_eq!(
                        body.distance(capsule, 100.).to_bits(),
                        expected.to_bits(),
                        "{triangle:?}, {p:?} -> {q:?}"
                    );
                }
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

#[cfg(test)]
mod index_regression {
    use super::*;
    #[test]
    fn constructed_ship_index_matches_linear_clearance_including_obstacle_identity() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../public/models/resolute.json");
        let def: ShipDefinition = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        let indexed = MountClearance::new(&def).unwrap().unwrap();
        let mut linear = indexed.clone();
        let tree = linear.static_index.as_mut().unwrap();
        tree.children = None;
        tree.indices = (0..linear.bodies.len())
            .filter(|&i| linear.bodies[i].mount.is_none())
            .collect();
        let mut poses = vec![ClearancePose::default(); def.mounts.len()];
        for sample in 0..40 {
            for (i, pose) in poses.iter_mut().enumerate() {
                pose.train = radians(((sample * 37 + i * 23) % 300) as f64 - 150.);
                pose.elevation = radians(((sample * 13 + i * 7) % 80) as f64);
                pose.recoil = (sample % 3) as f64 * 0.5;
            }
            for mount in [0, 3, 9, 17] {
                for limit in [0.01, 1., 30.] {
                    assert_eq!(
                        indexed.minimum_clearance(&def, mount, &poses, limit),
                        linear.minimum_clearance(&def, mount, &poses, limit)
                    );
                }
                let request = ClearancePose {
                    train: poses[mount].train + 0.2,
                    elevation: poses[mount].elevation + 0.1,
                    recoil: 1.,
                };
                // Test final swept pose as well as the narrow phase; every stop ID is retained.
                let a = indexed.resolve(&def, mount, &poses, request);
                let b = linear.resolve(&def, mount, &poses, request);
                assert_eq!(
                    serde_json::to_string(&a).unwrap(),
                    serde_json::to_string(&b).unwrap()
                );
            }
        }
    }
}
