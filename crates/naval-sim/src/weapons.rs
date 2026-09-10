use crate::{
    ballistics::{Arc, GRAVITY, solve_drag_arc, travel_factor},
    definition::{GunPart, MountDefinition, ShipDefinition, Vec3},
    geometry::*,
    motion::ShipState,
    mount_frames::{CarrierFrame, mount_bearing, mount_frame, mount_position},
};
use serde::{Deserialize, Serialize};
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Ammunition {
    #[default]
    Ap,
    He,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AimCache {
    pub time: f64,
    pub train: f64,
    pub elevation: f64,
    pub point: Vec3,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MountState {
    /// Derived before operation; never accepted from or sent to a client.
    #[serde(skip)]
    pub carrier: Option<CarrierFrame>,
    pub aa_discipline: Option<crate::air_gunnery::FireDiscipline>,
    pub lead_cache: Option<LeadCache>,
    pub id: String,
    pub train: f64,
    pub elevation: f64,
    pub reload: f64,
    pub ammo: f64,
    pub hp: f64,
    pub recoil: f64,
    pub he_ammo: f64,
    pub loaded: Ammunition,
    pub queued: Option<Ammunition>,
    pub status: String,
    pub aim_cache: Option<AimCache>,
    #[serde(skip)]
    blocked_cache: Option<BlockedCache>,
    #[serde(skip)]
    clearance_cache: Option<ClearanceCache>,
}
#[derive(Clone, Debug)]
struct ClearanceCache {
    geometry: usize,
    poses: Vec<[f64; 2]>,
    requested: [f64; 2],
    result: crate::mount_clearance::ClearanceResult,
}
#[derive(Clone, Debug)]
struct BlockedCache {
    train: f64,
    elevation: f64,
    carrier: Option<CarrierFrame>,
    carried: Vec<Pose>,
    blocked: bool,
}
impl MountState {
    pub fn new(m: &MountDefinition) -> Self {
        let count = m.weapon.barrel_count.unwrap_or(2.0);
        Self {
            carrier: None,
            id: m.id.clone(),
            train: 0.0,
            elevation: radians(1.0),
            reload: 0.0,
            ammo: m.weapon.ammo_per_barrel * count,
            he_ammo: (m.weapon.ammo_per_barrel
                * m.weapon.he.as_ref().map_or(0.0, |h| h.stock_fraction))
            .floor()
                * count,
            loaded: Ammunition::Ap,
            hp: 100.0,
            recoil: 0.0,
            status: "turning".into(),
            queued: None,
            aim_cache: None,
            lead_cache: None,
            aa_discipline: None,
            blocked_cache: None,
            clearance_cache: None,
        }
    }
    pub fn available(&self, kind: Ammunition) -> f64 {
        match kind {
            Ammunition::He => self.ammo.min(self.he_ammo).max(0.0),
            Ammunition::Ap => (self.ammo - self.he_ammo).max(0.0),
        }
    }
    pub fn expend_salvo(&mut self, m: &MountDefinition, reload: f64) -> usize {
        let count = m.weapon.barrel_count.unwrap_or(2.0);
        self.ammo -= count;
        if self.loaded == Ammunition::He {
            self.he_ammo -= count;
        }
        self.reload = reload;
        self.recoil = 1.0;
        self.status = "reloading".into();
        count as usize
    }
    pub fn select_ammunition(&mut self, m: &MountDefinition, requested: Ammunition) {
        let kind = if requested == Ammunition::He && m.weapon.he.is_none() {
            Ammunition::Ap
        } else {
            requested
        };
        self.queued = None;
        if self.loaded == kind {
            return;
        }
        self.loaded = kind;
        self.reload = self.reload.max(m.weapon.reload_seconds);
        self.aim_cache = None;
    }
    pub fn queue_ammunition(&mut self, m: &MountDefinition, requested: Ammunition) {
        let kind = if requested == Ammunition::He && m.weapon.he.is_none() {
            Ammunition::Ap
        } else {
            requested
        };
        if kind == self.loaded {
            self.queued = None;
            return;
        }
        if self.available(kind) < m.weapon.barrel_count.unwrap_or(2.0) {
            return;
        }
        self.queued = Some(kind);
        if self.reload == 0.0 && self.available(self.loaded) < m.weapon.barrel_count.unwrap_or(2.0)
        {
            self.select_ammunition(m, kind);
        }
    }
}
pub fn gun_work_rate(power: f64) -> f64 {
    0.25 + 0.75 * clamp(power, 0.0, 1.0)
}
pub fn barrel_offset(w: &GunPart, i: usize) -> f64 {
    (if w.barrel_count == Some(8.0) {
        (i % 4) as f64 - 1.5
    } else {
        i as f64 - (w.barrel_count.unwrap_or(2.0) - 1.0) / 2.0
    }) * w.barrel_spacing
}
pub fn barrel_height(w: &GunPart, i: usize) -> f64 {
    if w.barrel_count == Some(8.0) {
        (if i < 4 { -0.5 } else { 0.5 }) * w.barrel_vertical_spacing.unwrap()
    } else {
        0.0
    }
}
pub fn muzzle_local(m: &MountDefinition, state: &MountState, barrel: usize) -> Vec3 {
    let bearing = mount_bearing(m, state);
    let elevation = state.elevation;
    let w = &m.weapon;
    let row = barrel_height(w, barrel);
    let forward = w.trunnion_forward + (w.muzzle_forward - w.trunnion_forward) * elevation.cos()
        - row * elevation.sin();
    let lateral = barrel_offset(w, barrel);
    add(
        mount_position(m, state),
        [
            bearing.cos() * lateral + bearing.sin() * forward,
            w.pivot_height
                + row * elevation.cos()
                + (w.muzzle_forward - w.trunnion_forward) * elevation.sin(),
            bearing.sin() * lateral - bearing.cos() * forward,
        ],
    )
}
pub fn muzzle_center_local(
    m: &MountDefinition,
    train: f64,
    elevation: f64,
    carrier: Option<CarrierFrame>,
) -> Vec3 {
    let w = &m.weapon;
    let count = w.barrel_count.unwrap_or(2.0);
    let bearing = radians(m.bearing_deg) + carrier.map_or(0.0, |c| c.heading) + train;
    let position = carrier.map_or(m.position, |c| c.position);
    let forward = w.trunnion_forward + (w.muzzle_forward - w.trunnion_forward) * elevation.cos();
    let (cos, sin) = (bearing.cos(), bearing.sin());
    let vertical = w.pivot_height + (w.muzzle_forward - w.trunnion_forward) * elevation.sin();
    let (mut x, mut y, mut z) = (0.0, 0.0, 0.0);
    for barrel in 0..count as usize {
        let lateral = barrel_offset(w, barrel);
        let row = barrel_height(w, barrel);
        let bore_forward = forward - row * elevation.sin();
        x += (position[0] + cos * lateral + sin * bore_forward) / count;
        y += (position[1] + vertical + row * elevation.cos()) / count;
        z += (position[2] + sin * lateral - cos * bore_forward) / count;
    }
    [x, y, z]
}
pub fn shot_direction(m: &MountDefinition, s: &MountState, pose: Pose) -> Vec3 {
    let b = mount_bearing(m, s);
    rotate(
        [
            b.sin() * s.elevation.cos(),
            s.elevation.sin(),
            -b.cos() * s.elevation.cos(),
        ],
        pose,
    )
}
pub fn solve_ballistic(from: Vec3, target: Vec3, speed: f64, drag: f64) -> Option<Arc> {
    let delta = sub(target, from);
    let range = delta[0].hypot(delta[2]);
    if !(1.0..=30000.0).contains(&range) || target.iter().any(|v| !v.is_finite()) {
        return None;
    }
    if drag > 1e-8 {
        return solve_drag_arc(from, target, speed, drag);
    }
    let v2 = speed * speed;
    let d = v2 * v2 - GRAVITY * (GRAVITY * range * range + 2.0 * delta[1] * v2);
    if d < 0.0 {
        return None;
    }
    let angle = ((v2 - d.sqrt()) / (GRAVITY * range)).atan();
    Some(Arc {
        direction: [
            delta[0] / range * angle.cos(),
            angle.sin(),
            delta[2] / range * angle.cos(),
        ],
        time: range / (speed * angle.cos()),
    })
}
#[derive(Clone, Debug)]
struct Obstruction {
    center: Vec3,
    size: Vec3,
    mount_id: Option<String>,
}
#[derive(Clone, Debug)]
pub struct Obstructions {
    entries: Vec<Obstruction>,
    carried: Vec<(usize, Vec<Obstruction>)>,
    pub clearance: Option<crate::mount_clearance::MountClearance>,
}
impl Obstructions {
    pub fn new(d: &ShipDefinition) -> Self {
        let mut entries: Vec<_> = d
            .obstructions
            .iter()
            .map(|b| Obstruction {
                center: b.center,
                size: b.size,
                mount_id: None,
            })
            .collect();
        let mut carried = vec![];
        for (index, m) in d.mounts.iter().enumerate() {
            let mut boxes = vec![];
            let position = if m.parent_mount_id.is_some() {
                [0.0; 3]
            } else {
                m.position
            };
            let w = &m.weapon;
            let [l, width, height] = w.gunhouse_size;
            let mut push = |x: f64, y: f64, size: Vec3| {
                boxes.push(Obstruction {
                    center: [position[0] + x, position[1] + y, position[2]],
                    size,
                    mount_id: Some(m.id.clone()),
                })
            };
            if w.mounting_style.as_deref() != Some("open-pedestal") {
                push(0.0, height / 2.0, [width, height, l]);
            } else {
                let radius = w.barrel_base_radius.unwrap_or(w.caliber_m * 0.85);
                let body = height.min(w.pivot_height + 0.16f64.max(radius * 1.5 + 0.16));
                push(0.0, body / 2.0, [width, body, l]);
                let top = w.pivot_height + 0.405;
                if top > body {
                    for sign in [-1.0, 1.0] {
                        push(
                            sign * width * 0.395,
                            (body + top) / 2.0,
                            [width * 0.07 + 0.11, top - body, l],
                        );
                    }
                }
            }
            if m.parent_mount_id.is_some() {
                carried.push((index, boxes));
            } else {
                entries.extend(boxes);
            }
        }
        Self {
            entries,
            carried,
            clearance: crate::mount_clearance::MountClearance::new(d)
                .expect("validated original mount clearance geometry"),
        }
    }
    fn intersects(&self, from: Vec3, to: Vec3, mount_id: &str, poses: &[Pose]) -> bool {
        self.entries.iter().any(|e| {
            e.mount_id.as_deref() != Some(mount_id)
                && segment_box(from, to, e.center, e.size).is_some()
        }) || self.carried.iter().zip(poses).any(|((_, boxes), pose)| {
            let from = world_to_local(from, *pose);
            let to = world_to_local(to, *pose);
            boxes.iter().any(|e| {
                e.mount_id.as_deref() != Some(mount_id)
                    && segment_box(from, to, e.center, e.size).is_some()
            })
        })
    }
}
#[allow(clippy::too_many_arguments)]
pub fn update_mount(
    m: &MountDefinition,
    s: &mut MountState,
    d: &ShipDefinition,
    p: &ShipState,
    aim: Option<Vec3>,
    dt: f64,
    inherited: Vec3,
    power: f64,
    obstructions: &Obstructions,
    mounted_states: &[MountState],
) -> bool {
    let work = gun_work_rate(power);
    let was_reloading = s.reload > 0.0;
    s.reload = (s.reload - dt * work).max(0.0);
    if was_reloading
        && s.reload == 0.0
        && let Some(queued) = s.queued.take()
    {
        s.loaded = queued;
        s.aim_cache = None;
    }
    s.recoil = (s.recoil - dt / 1.4).max(0.0);
    let reject = |s: &mut MountState, status: &str| {
        s.status = status.into();
        false
    };
    if s.hp <= 0.0 {
        return reject(s, "disabled");
    }
    if s.available(s.loaded) < m.weapon.barrel_count.unwrap_or(2.0) {
        return reject(s, "empty");
    }
    if d.submarine.is_some() && p.depth() > 0.5
        || local_to_world(muzzle_local(m, s, 0), p.pose())[1] <= p.wave_heave
    {
        return reject(s, "submerged");
    }
    let cache = s
        .aim_cache
        .as_ref()
        .filter(|c| aim.is_some_and(|a| length(sub(a, c.point)) < 10.0));
    let (mut desired_train, mut desired_elevation) =
        cache.map_or((s.train, s.elevation), |c| (c.train, c.elevation));
    let mut reachable = aim.is_some();
    let mut time = cache.map_or_else(
        || {
            aim.map_or(0.0, |a| {
                length(sub(a, [p.x, p.y, p.z])) / m.weapon.muzzle_speed
            })
        },
        |c| c.time,
    );
    for _ in 0..if cache.is_some() { 1 } else { 3 } {
        let Some(aim) = aim else {
            break;
        };
        let midpoint = local_to_world(
            muzzle_center_local(m, desired_train, desired_elevation, s.carrier),
            p.pose(),
        );
        let drag = m
            .weapon
            .ballistics
            .as_ref()
            .map_or(0.0, |b| b.drag_per_second);
        let travel = travel_factor(time, drag);
        let relative = [
            aim[0] - inherited[0] * travel,
            aim[1] - inherited[1] * travel,
            aim[2] - inherited[2] * travel,
        ];
        let Some(solution) = solve_ballistic(midpoint, relative, m.weapon.muzzle_speed, drag)
        else {
            reachable = false;
            desired_train = s.train;
            desired_elevation = s.elevation;
            break;
        };
        time = solution.time;
        let direction = normalize(world_to_local(
            add([p.x, p.y, p.z], solution.direction),
            p.pose(),
        ));
        desired_train = wrap_angle(
            direction[0].atan2(-direction[2])
                - radians(m.bearing_deg)
                - s.carrier.map_or(0.0, |c| c.heading),
        );
        desired_elevation = clamp(direction[1], -1.0, 1.0).asin();
    }
    s.aim_cache = if reachable {
        aim.map(|point| AimCache {
            time,
            train: desired_train,
            elevation: desired_elevation,
            point,
        })
    } else {
        None
    };
    let w = &m.weapon;
    let limit = radians(w.traverse_deg);
    let train = clamp(desired_train, -limit, limit);
    let elevation = clamp(
        desired_elevation,
        radians(w.elevation_min_deg),
        radians(w.elevation_max_deg),
    );
    let train_rate = radians(w.traverse_rate_deg) * dt * work;
    let elevation_rate = radians(w.elevation_rate_deg) * dt * work;
    let requested_train = s.train + clamp(train - s.train, -train_rate, train_rate);
    let requested_elevation =
        s.elevation + clamp(elevation - s.elevation, -elevation_rate, elevation_rate);
    let mut mechanically_blocked = false;
    if let Some(clearance) = &obstructions.clearance {
        let index = d
            .mounts
            .iter()
            .position(|mount| mount.id == m.id)
            .expect("known mount");
        if clearance.enabled(index) {
            // Physical movement needs actual independent neighbors. Legacy
            // callers without a complete pose array must fail closed.
            if mounted_states.len() != d.mounts.len() {
                return reject(s, "blocked");
            }
            let mut poses: Vec<_> = mounted_states
                .iter()
                .map(crate::mount_clearance::ClearancePose::from)
                .collect();
            poses[index] = crate::mount_clearance::ClearancePose::from(&*s);
            let key: Vec<_> = poses.iter().map(|p| [p.train, p.elevation]).collect();
            let requested = [requested_train, requested_elevation];
            let geometry = clearance as *const _ as usize;
            let accepted =
                if let Some(cache) = s.clearance_cache.as_ref().filter(|c| {
                    c.geometry == geometry && c.poses == key && c.requested == requested
                }) {
                    cache.result.clone()
                } else {
                    let result = clearance.resolve(
                        d,
                        index,
                        &poses,
                        crate::mount_clearance::ClearancePose {
                            train: requested_train,
                            elevation: requested_elevation,
                            recoil: s.recoil,
                        },
                    );
                    s.clearance_cache = Some(ClearanceCache {
                        geometry,
                        poses: key,
                        requested,
                        result: result.clone(),
                    });
                    result
                };
            s.train = accepted.pose.train;
            s.elevation = accepted.pose.elevation;
            mechanically_blocked = accepted.blocked;
        } else {
            s.train = requested_train;
            s.elevation = requested_elevation;
        }
    } else {
        s.train = requested_train;
        s.elevation = requested_elevation;
    }
    // A parent can move an obstruction even when this gun has not traversed.
    // Use the detached mount's updated train when posing its own descendants.
    let carried: Vec<_> = obstructions
        .carried
        .iter()
        .map(|(index, _)| {
            mount_frame(d, *index, &|i| {
                if d.mounts[i].id == m.id {
                    s.train
                } else {
                    mounted_states[i].train
                }
            })
        })
        .collect();
    let blocked = if let Some(cache) = s.blocked_cache.as_ref().filter(|c| {
        c.train == s.train
            && c.elevation == s.elevation
            && c.carrier == s.carrier
            && c.carried == carried
    }) {
        cache.blocked
    } else {
        let breech = add(mount_position(m, s), [0.0, w.pivot_height, 0.0]);
        let blocked = (0..w.barrel_count.unwrap_or(2.0) as usize).any(|barrel| {
            let muzzle = muzzle_local(m, s, barrel);
            let direction = normalize(sub(muzzle, breech));
            obstructions.intersects(
                breech,
                add(muzzle, scale(direction, d.hull.length)),
                &m.id,
                &carried,
            )
        });
        s.blocked_cache = Some(BlockedCache {
            train: s.train,
            elevation: s.elevation,
            carrier: s.carrier,
            carried,
            blocked,
        });
        blocked
    };
    if blocked || mechanically_blocked {
        return reject(s, "blocked");
    }
    if !reachable {
        return reject(s, "out-of-range");
    }
    if desired_train.abs() > limit + 1e-6
        || desired_elevation < radians(w.elevation_min_deg) - 1e-6
        || desired_elevation > radians(w.elevation_max_deg) + 1e-6
    {
        return reject(s, "out-of-arc");
    }
    if (desired_train - s.train).abs() >= 0.0015
        || (desired_elevation - s.elevation).abs() >= 0.0008
    {
        return reject(s, "turning");
    }
    s.status = if s.reload > 0.0 { "reloading" } else { "ready" }.into();
    true
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LeadCache {
    pub time: f64,
    pub point: Vec3,
}
pub fn muzzle_center_world(m: &MountDefinition, state: &MountState, ship: &ShipState) -> Vec3 {
    local_to_world(
        muzzle_center_local(m, state.train, state.elevation, state.carrier),
        ship.pose(),
    )
}
