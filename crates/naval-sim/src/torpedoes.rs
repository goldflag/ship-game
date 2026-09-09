use crate::{
    breaches::add_breach,
    damage::{Combatant, damage_blast_hull},
    definition::{ShipDefinition, TorpedoPart, TubeDefinition, Vec3},
    environment::SeaState,
    geometry::*,
    machinery::{equipment_condition, launcher_available},
    structure::{StructuralSurface, structural_hits, structural_surfaces},
    vessel::Vessel,
};
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct TubeState {
    pub id: String,
    pub ammo: f64,
    pub reload: f64,
    pub status: String,
}
impl TubeState {
    pub fn new(t: &TubeDefinition) -> Self {
        Self {
            id: t.id.clone(),
            ammo: t.ammo,
            reload: 0.0,
            status: if t.ammo > 0.0 { "ready" } else { "empty" }.into(),
        }
    }
}
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Torpedo {
    pub id: i64,
    pub owner_id: String,
    pub tube_id: String,
    pub position: Vec3,
    pub velocity: Vec3,
    pub distance: f64,
    pub age: f64,
    pub weapon: TorpedoPart,
}
pub fn tube_local_position(actor: &Combatant, def: &ShipDefinition, tube: &TubeDefinition) -> Vec3 {
    let Some(l) = tube
        .launcher_id
        .as_ref()
        .and_then(|id| def.torpedo_launchers.as_ref()?.iter().find(|l| &l.id == id))
    else {
        return tube.position;
    };
    let train = actor.launcher_trains.get(&l.id).copied().unwrap_or(0.0);
    add(
        l.position,
        rotate(
            sub(tube.position, l.position),
            Pose {
                heading: train,
                ..Default::default()
            },
        ),
    )
}
pub fn train_launchers(
    actor: &mut Combatant,
    def: &ShipDefinition,
    aim_for: &impl Fn(&TubeDefinition) -> Option<Vec3>,
    dt: f64,
    sea: Option<(&SeaState, f64)>,
) {
    for l in def.torpedo_launchers.iter().flatten() {
        let tubes: Vec<_> = def
            .torpedo_tubes
            .iter()
            .flatten()
            .filter(|t| t.launcher_id.as_ref() == Some(&l.id))
            .collect();
        let Some(t) = tubes
            .iter()
            .find(|t| {
                actor
                    .torpedo_tubes
                    .iter()
                    .any(|s| s.id == t.id && s.ammo > 0.0)
            })
            .or_else(|| tubes.first())
        else {
            continue;
        };
        let magazine = def.modules.iter().find(|m| m.id == t.magazine_id);
        if actor.damage.sunk
            || actor.damage.stability.combat_lost
            || !launcher_available(actor, def, t.launcher_module_id.as_deref(), false, sea)
            || magazine.is_none_or(|m| equipment_condition(actor, def, m, sea).availability <= 0.0)
        {
            continue;
        }
        let Some(aim) = aim_for(t).filter(|p| p.iter().all(|v| v.is_finite())) else {
            continue;
        };
        let local = world_to_local(aim, actor.motion.pose());
        let desired = (local[0] - l.position[0]).atan2(l.position[2] - local[2]);
        let train = actor.launcher_trains.entry(l.id.clone()).or_default();
        let rate = radians(l.traverse_rate_deg) * dt;
        if let Some([lo, hi]) = l.traverse_limits_deg {
            let (lo, hi) = (radians(lo), radians(hi));
            *train = clamp(*train, lo, hi);
            let target = clamp(desired, lo, hi);
            *train += clamp(target - *train, -rate, rate);
        } else {
            *train = wrap_angle(*train + clamp(wrap_angle(desired - *train), -rate, rate));
        }
    }
}
pub fn torpedo_intercept(from: Vec3, point: Vec3, velocity: Vec3, speed: f64) -> Option<Vec3> {
    let (dx, dz) = (point[0] - from[0], point[2] - from[2]);
    let a = velocity[0].powi(2) + velocity[2].powi(2) - speed.powi(2);
    let b = 2.0 * (dx * velocity[0] + dz * velocity[2]);
    let c = dx.powi(2) + dz.powi(2);
    let time = if a.abs() < 1e-8 {
        if b.abs() > 1e-8 {
            -c / b
        } else if c < 1e-8 {
            0.0
        } else {
            f64::INFINITY
        }
    } else {
        let d = b * b - 4.0 * a * c;
        if d < 0.0 {
            return None;
        }
        [(-b - d.sqrt()) / (2.0 * a), (-b + d.sqrt()) / (2.0 * a)]
            .into_iter()
            .filter(|t| *t >= 0.0)
            .fold(f64::INFINITY, f64::min)
    };
    if time.is_finite() && time >= 0.0 {
        Some(add(point, scale([velocity[0], 0.0, velocity[2]], time)))
    } else {
        None
    }
}
#[derive(Clone, Copy, Debug, serde::Serialize)]
pub struct TubeSolution {
    pub origin: Vec3,
    pub heading: f64,
    pub range: f64,
}
pub fn tube_solution(
    actor: &Combatant,
    def: &ShipDefinition,
    tube: &TubeDefinition,
    state: &mut TubeState,
    aim: Vec3,
    dt: f64,
    sea: Option<(&SeaState, f64)>,
) -> TubeSolution {
    state.reload = (state.reload - dt).max(0.0);
    let origin = local_to_world(tube_local_position(actor, def, tube), actor.motion.pose());
    let heading = (aim[0] - origin[0]).atan2(origin[2] - aim[2]);
    let range = (aim[0] - origin[0]).hypot(aim[2] - origin[2]);
    let magazine = def.modules.iter().find(|m| m.id == tube.magazine_id);
    let launcher = tube
        .launcher_id
        .as_ref()
        .and_then(|id| def.torpedo_launchers.as_ref()?.iter().find(|l| &l.id == id));
    let train = tube
        .launcher_id
        .as_ref()
        .and_then(|id| actor.launcher_trains.get(id))
        .copied()
        .unwrap_or_else(|| radians(tube.bearing_deg));
    let relative = wrap_angle(heading - actor.motion.heading);
    let in_arc = launcher.map_or_else(
        || wrap_angle(relative - train).abs() <= radians(tube.arc_deg) + 1e-8,
        |l| {
            l.launch_arcs_deg
                .iter()
                .any(|[a, b]| relative >= radians(*a) && relative <= radians(*b))
        },
    );
    state.status = if actor.damage.sunk
        || actor.damage.stability.combat_lost
        || !launcher_available(actor, def, tube.launcher_module_id.as_deref(), false, sea)
        || magazine.is_none_or(|m| equipment_condition(actor, def, m, sea).availability <= 0.0)
    {
        "disabled"
    } else if state.ammo == 0.0 {
        "empty"
    } else if def
        .submarine
        .as_ref()
        .is_some_and(|s| actor.motion.depth() > s.max_torpedo_depth_m)
    {
        "too-deep"
    } else if launcher.is_none() && origin[1] > 0.0 {
        "above-water"
    } else if !aim.iter().all(|v| v.is_finite()) || !in_arc {
        "out-of-arc"
    } else if range < tube.weapon.arming_distance_m {
        "too-close"
    } else if range > tube.weapon.range_m {
        "out-of-range"
    } else if state.reload > 0.0 {
        "reloading"
    } else if launcher.is_some() && wrap_angle(relative - train).abs() > radians(tube.arc_deg) {
        "turning"
    } else {
        "ready"
    }
    .into();
    TubeSolution {
        origin,
        heading,
        range,
    }
}
pub fn clear_torpedo_lane(
    actor: &Vessel,
    origin: Vec3,
    aim: Vec3,
    speed: f64,
    actors: &[Vessel],
) -> bool {
    let (dx, dz) = (aim[0] - origin[0], aim[2] - origin[2]);
    let range = dx.hypot(dz);
    if range < 1.0 {
        return false;
    }
    let (vx, vz, time) = (dx / range * speed, dz / range * speed, range / speed);
    !actors.iter().any(|other| {
        if other.motion.id == actor.motion.id || other.team != actor.team || other.motion.y < -20.0
        {
            return false;
        }
        let v = other.motion.velocity();
        let (rx, rz) = (other.motion.x - origin[0], other.motion.z - origin[2]);
        let (ux, uz) = (v[0] - vx, v[2] - vz);
        let t = clamp(
            -(rx * ux + rz * uz) / 0.001_f64.max(ux * ux + uz * uz),
            0.0,
            time,
        );
        (rx + ux * t).hypot(rz + uz * t) < other.definition().hull.length / 2.0 + 5.0
    })
}
pub fn torpedo_hull(def: &ShipDefinition) -> Result<Vec<StructuralSurface>, String> {
    let mut d = def.clone();
    let h = &def.hull;
    let interpolate = |points: &[[f64; 2]], s: f64| {
        let i = points
            .windows(2)
            .position(|p| s >= p[0][0] && s <= p[1][0])
            .unwrap_or(0);
        let (a, b) = (points[i], points[i + 1]);
        a[1] + (b[1] - a[1]) * (s - a[0]) / (b[0] - a[0])
    };
    let mut sections = h.sections.clone().unwrap_or_else(|| {
        h.half_breadths
            .iter()
            .map(|&[station, width]| {
                let bottom = interpolate(&h.keel_heights, station);
                let top = interpolate(&h.deck_heights, station);
                crate::definition::HullSectionsItem {
                    station,
                    points: vec![
                        [0.0, bottom],
                        [width * 0.6, bottom],
                        [width, 0.0],
                        [width, top],
                    ],
                }
            })
            .collect()
    });
    if sections
        .iter()
        .any(|s| s.points.len() != sections[0].points.len())
    {
        for s in &mut sections {
            let bottom = s.points[0][1];
            let top = s.points.last().unwrap()[1];
            s.points = (0..33)
                .map(|i| {
                    let y = bottom + (top - bottom) * i as f64 / 32.0;
                    let mut width: f64 = 0.0;
                    for p in s.points.windows(2) {
                        let ([wa, ya], [wb, yb]) = (p[0], p[1]);
                        if y >= ya - 1e-6 && y <= yb + 1e-6 {
                            width = width.max(if (yb - ya).abs() < 1e-8 {
                                wa.max(wb)
                            } else {
                                wa + (wb - wa) * (y - ya) / (yb - ya)
                            });
                        }
                    }
                    [width, y]
                })
                .collect();
        }
    }
    d.hull.sections = Some(sections);
    d.structures = Some(vec![]);
    d.structural_plating = Some(crate::definition::ShipDefinitionStructuralPlating {
        hull_mm: 1.0,
        superstructure_mm: 1.0,
        note: "Collision envelope only".into(),
    });
    structural_surfaces(&d)
}
pub fn first_torpedo_hit(
    t: &Torpedo,
    from: Vec3,
    to: Vec3,
    actors: &[Vessel],
) -> Option<(usize, Vec3, f64, Vec3)> {
    let mut result = None;
    for (i, a) in actors.iter().enumerate() {
        if a.motion.id == t.owner_id {
            continue;
        }
        let h = &a.definition().hull;
        let radius = (h.beam / 2.0)
            .hypot(h.draft.max((h.depth - h.draft).abs()))
            .hypot(h.length / 2.0)
            + 1e-5;
        let p = [a.motion.x, a.motion.y, a.motion.z];
        if !(0..3)
            .all(|i| from[i].min(to[i]) <= p[i] + radius && from[i].max(to[i]) >= p[i] - radius)
        {
            continue;
        }
        let (from, to) = (
            world_to_local(from, a.motion.pose()),
            world_to_local(to, a.motion.pose()),
        );
        if segment_box(
            from,
            to,
            [0.0, h.depth / 2.0 - h.draft, 0.0],
            [h.beam, h.depth, h.length],
        )
        .is_none()
        {
            continue;
        }
        if let Some(hit) = structural_hits(from, to, &a.compiled.torpedo_hull).first()
            && result.is_none_or(|(_, _, t, _)| hit.hit.t < t)
        {
            result = Some((i, hit.hit.point, hit.hit.t, hit.hit.normal));
        }
    }
    result
}
pub fn torpedo_protection(def: &ShipDefinition, point: Vec3) -> (f64, f64, String) {
    let mut result = (0.0_f64, 0.0_f64, String::new());
    if let Some(protection) = &def.underwater_protection {
        for zone in &protection.zones {
            if !(0..3).all(|i| (point[i] - zone.center[i]).abs() <= zone.size[i] / 2.0 + 1e-6) {
                continue;
            }
            if zone.damage_reduction > result.0 || zone.breach_reduction > result.1 {
                result.2 = zone.name.clone();
            }
            result.0 = result.0.max(zone.damage_reduction);
            result.1 = result.1.max(zone.breach_reduction);
        }
    }
    result
}
pub fn damage_torpedo_hit(
    actor: &mut Combatant,
    def: &ShipDefinition,
    point: Vec3,
    weapon: &TorpedoPart,
    projectile: i64,
) -> String {
    let (damage_reduction, breach_reduction, name) = torpedo_protection(def, point);
    let label = if name.is_empty() {
        "Torpedo hit".into()
    } else {
        format!("Torpedo hit · {name}")
    };
    damage_underwater_blast(
        actor,
        def,
        point,
        weapon.damage * 0.625 * (1.0 - damage_reduction),
        weapon.breach_area_m2 * (7.0 / 11.0) * (1.0 - breach_reduction),
        &label,
        projectile,
    )
}
pub fn damage_underwater_blast(
    actor: &mut Combatant,
    def: &ShipDefinition,
    point: Vec3,
    amount: f64,
    area: f64,
    label: &str,
    projectile: i64,
) -> String {
    damage_blast_hull(actor, def, point, amount);
    let distance = |center: Vec3, size: Vec3| {
        length(std::array::from_fn(|i| {
            ((point[i] - center[i]).abs() - size[i] / 2.0).max(0.0)
        }))
    };
    let compartment = def
        .compartments
        .iter()
        .enumerate()
        .min_by(|(_, a), (_, b)| {
            let dist = |c: &crate::definition::Compartment| {
                c.cells.as_ref().map_or_else(
                    || distance(c.center, c.size),
                    |cells| {
                        cells
                            .iter()
                            .map(|c| distance(c.center, c.size))
                            .fold(f64::INFINITY, f64::min)
                    },
                )
            };
            dist(a).total_cmp(&dist(b))
        });
    if let Some((i, _)) = compartment {
        add_breach(
            &mut actor.damage.compartments[i],
            point,
            area,
            projectile,
            None,
            None,
            false,
        );
    }
    if let Some((i, m)) = def
        .modules
        .iter()
        .enumerate()
        .filter(|(_, m)| distance(m.center, m.size) < 8.0)
        .min_by(|(_, a), (_, b)| distance(a.center, a.size).total_cmp(&distance(b.center, b.size)))
    {
        actor.damage.modules[i].hp = (actor.damage.modules[i].hp
            - amount * 0.5 * (1.0 - distance(m.center, m.size) / 8.0))
            .max(0.0);
    }
    format!(
        "{label}{} · flooding breach",
        compartment.map_or(String::new(), |(_, c)| format!(" · {}", c.name))
    )
}

/// Gameplay contact-pistol tuning: reliable at >=20 degrees to the surface,
/// rising linearly to 90% duds at grazing incidence. Direction and normal are local.
pub fn glancing_dud_chance(direction: Vec3, normal: Vec3) -> f64 {
    let sine = dot(normalize(direction), normalize(normal))
        .abs()
        .clamp(0.0, 1.0);
    0.9 * (1.0 - sine.asin() / radians(20.0)).clamp(0.0, 1.0)
}

/// Stateless seeded roll; projectile order and display frame rate cannot change it.
pub fn torpedo_dud_roll(seed: u32, projectile: i64) -> f64 {
    let mut x = seed ^ (projectile as u32).wrapping_mul(0x9e3779b9) ^ 0x746f7270;
    x ^= x >> 16;
    x = x.wrapping_mul(0x85ebca6b);
    x ^= x >> 13;
    x = x.wrapping_mul(0xc2b2ae35);
    x ^= x >> 16;
    x as f64 / 4294967296.0
}
