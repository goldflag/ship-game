use crate::mobility::torpedo_speed;
use crate::{
    ballistics::travel_factor,
    damage::{Combatant, HULL_HP_SCALE, damage_region},
    definition::{MountDefinition, ShipDefinition, TubeDefinition, Vec3},
    geometry::*,
    motion::{HelmCommand, ShipState},
    rules::DT,
    torpedoes::torpedo_intercept,
    vessel::Vessel,
    weapons::{Ammunition, MountState, muzzle_center_world, solve_ballistic},
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
pub enum AiLevel {
    Static,
    Moving,
    Easy,
    #[default]
    Normal,
    Hard,
}
impl AiLevel {
    pub fn passive(self) -> bool {
        matches!(self, Self::Static | Self::Moving)
    }
}
struct Skill {
    reaction: f64,
    opening: [f64; 2],
    reacquire: [f64; 2],
    settle: f64,
    velocity: f64,
    error: f64,
    cadence: f64,
    maneuver: [f64; 2],
    evade: f64,
}
fn skill(level: AiLevel) -> Skill {
    match level {
        AiLevel::Easy => Skill {
            reaction: 2.5,
            opening: [16.0, 24.0],
            reacquire: [7.0, 11.0],
            settle: 80.0,
            velocity: 0.3,
            error: 2.0,
            cadence: 3.0,
            maneuver: [35.0, 50.0],
            evade: 35.0,
        },
        AiLevel::Hard => Skill {
            reaction: 0.4,
            opening: [4.0, 7.0],
            reacquire: [1.0, 2.0],
            settle: 22.0,
            velocity: 0.85,
            error: 0.5,
            cadence: 0.35,
            maneuver: [14.0, 24.0],
            evade: 7.0,
        },
        _ => Skill {
            reaction: 1.0,
            opening: [8.0, 14.0],
            reacquire: [3.0, 6.0],
            settle: 45.0,
            velocity: 0.55,
            error: 1.0,
            cadence: 1.0,
            maneuver: [22.0, 38.0],
            evade: 15.0,
        },
    }
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GunOrder {
    pub fire_at: f64,
    pub along_hull: f64,
    pub height: f64,
    pub across_error: f64,
    pub range_error: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetTrack {
    pub id: String,
    pub fire_at: f64,
    pub observed_at: f64,
    pub observe_at: f64,
    pub pose: Pose,
    pub velocity: Vec3,
    pub quality: f64,
    pub focus: usize,
    pub refocus_at: f64,
    pub aim_points: Option<Vec<Vec3>>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BotState {
    pub ai_level: AiLevel,
    pub patrol_heading: Option<f64>,
    pub random_state: u32,
    pub time: f64,
    pub reaction_seconds: f64,
    pub preferred_range: f64,
    pub side: f64,
    pub course_offset: f64,
    pub cruise_throttle: f64,
    pub maneuver_at: f64,
    pub evade_until: f64,
    pub last_integrity: f64,
    pub opening_fire_at: Option<f64>,
    pub track: Option<TargetTrack>,
    pub guns: BTreeMap<String, GunOrder>,
}
impl BotState {
    fn random(&mut self) -> f64 {
        let mut x = self.random_state;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.random_state = x;
        f64::from(x) / 4294967296.0
    }
    fn between(&mut self, range: [f64; 2]) -> f64 {
        range[0] + self.random() * (range[1] - range[0])
    }
    fn revise(&mut self, gun: &mut GunOrder) {
        gun.along_hull = self.between([-0.045, 0.045]);
        gun.height = self.between([0.8, 3.0]);
        gun.across_error = self.between([-1.0, 1.0]);
        gun.range_error = self.between([-1.0, 1.0]);
    }
    pub fn new(id: &str, def: &ShipDefinition, seed: u32, ai_level: AiLevel) -> Self {
        let mut hash = seed;
        for c in id.encode_utf16() {
            hash = (hash ^ u32::from(c)).wrapping_mul(16777619);
        }
        let mut b = Self {
            ai_level,
            patrol_heading: None,
            random_state: hash.max(1),
            time: 0.0,
            reaction_seconds: 1.0,
            preferred_range: 4000.0,
            side: 1.0,
            course_offset: 0.0,
            cruise_throttle: 0.6,
            maneuver_at: 0.0,
            evade_until: 0.0,
            last_integrity: 0.0,
            opening_fire_at: None,
            track: None,
            guns: BTreeMap::new(),
        };
        b.reaction_seconds = b.between([0.9, 1.8]) * skill(ai_level).reaction;
        let caliber = def
            .mounts
            .iter()
            .map(|m| m.weapon.caliber_m)
            .fold(0.0, f64::max);
        b.preferred_range = b.between(if caliber >= 0.3 {
            [4200.0, 5800.0]
        } else {
            [3200.0, 4600.0]
        });
        b.side = if b.random() < 0.5 { -1.0 } else { 1.0 };
        for m in &def.mounts {
            let mut gun = GunOrder::default();
            b.revise(&mut gun);
            b.guns.insert(m.id.clone(), gun);
        }
        b
    }
    pub fn ready(&self, mount: Option<&MountDefinition>) -> bool {
        self.track.as_ref().is_some_and(|t| {
            !self.ai_level.passive()
                && self.time >= t.fire_at
                && mount.is_none_or(|m| self.time >= self.guns[&m.id].fire_at)
        })
    }
    pub fn did_fire(&mut self, mount: &MountDefinition) {
        let mut gun = self.guns.remove(&mount.id).expect("compiled gun");
        gun.fire_at = self.time
            + mount.weapon.reload_seconds
            + self.between(if mount.battery == "main" {
                [0.8, 3.5]
            } else {
                [0.2, 1.4]
            }) * skill(self.ai_level).cadence;
        self.revise(&mut gun);
        self.guns.insert(mount.id.clone(), gun);
    }
    pub fn update(
        &mut self,
        actor: &Combatant,
        def: &ShipDefinition,
        target: Option<(&Combatant, &ShipDefinition)>,
        time: f64,
    ) {
        self.time = time;
        let Some((target, target_def)) =
            target.filter(|_| !self.ai_level.passive() && !actor.damage.sunk)
        else {
            self.track = None;
            return;
        };
        let skill = skill(self.ai_level);
        if self.track.as_ref().is_none_or(|t| t.id != target.motion.id) {
            let first = self.opening_fire_at.is_none();
            if first {
                self.opening_fire_at = Some(time + self.between(skill.opening));
            }
            let opening = self.opening_fire_at.unwrap();
            let fire_at = if first {
                opening
            } else {
                opening.max(time + self.between(skill.reacquire))
            };
            self.track = Some(TargetTrack {
                id: target.motion.id.clone(),
                fire_at,
                observed_at: time,
                observe_at: time + self.reaction_seconds,
                pose: target.motion.pose(),
                velocity: target.motion.velocity(),
                quality: 0.0,
                focus: (self.random() * 3.0).floor() as usize,
                refocus_at: time + self.between([18.0, 30.0]),
                aim_points: None,
            });
            // Preserve authoring order: JS object insertion order determines random consumption.
            for m in &def.mounts {
                let mut gun = self.guns.remove(&m.id).unwrap();
                gun.fire_at = fire_at + self.between([0.0, 2.0]);
                self.revise(&mut gun);
                self.guns.insert(m.id.clone(), gun);
            }
        }
        let mut track = self.track.take().unwrap();
        track.quality = (track.quality + DT / skill.settle).min(1.0);
        if time >= track.observe_at {
            let v = target.motion.velocity();
            let change = length(sub(v, track.velocity));
            track.quality = (track.quality - (change * 0.035).min(0.35)).max(0.0);
            track.velocity = add(
                scale(track.velocity, 1.0 - skill.velocity),
                scale(v, skill.velocity),
            );
            track.pose = target.motion.pose();
            track.aim_points = damage_aware_aim_points(actor, target, target_def);
            track.observed_at = time;
            track.observe_at = time + self.reaction_seconds;
            if self.last_integrity - actor.damage.integrity > skill.evade * HULL_HP_SCALE {
                self.evade_until = time + self.between([8.0, 14.0]);
                self.maneuver_at = time;
            }
            self.last_integrity = actor.damage.integrity;
        }
        if time >= track.refocus_at {
            track.focus = (track.focus + 1 + (self.random() * 2.0).floor() as usize) % 3;
            track.refocus_at = time + self.between([18.0, 30.0]);
        }
        self.track = Some(track);
        if time >= self.maneuver_at {
            self.course_offset = self.between([-0.22, 0.22]);
            self.cruise_throttle = self.between([0.5, 0.8]);
            if time > 0.0 && self.random() < 0.18 {
                self.side *= -1.0;
            }
            self.maneuver_at = time + self.between(skill.maneuver);
        }
    }
    /// PvE crews read only transmitted observations. No enemy Combatant or
    /// damage model is available in this path.
    pub fn update_contact(
        &mut self,
        actor: &Combatant,
        def: &ShipDefinition,
        contact: Option<&crate::sensors::ContactTrack>,
        time: f64,
    ) {
        self.time = time;
        let Some(contact) =
            contact.filter(|c| c.targetable() && !self.ai_level.passive() && !actor.damage.sunk)
        else {
            self.track = None;
            return;
        };
        let skill = skill(self.ai_level);
        if self.track.as_ref().is_none_or(|t| t.id != contact.id) {
            let first = self.opening_fire_at.is_none();
            if first {
                self.opening_fire_at = Some(time + self.between(skill.opening));
            }
            let fire_at = if first {
                self.opening_fire_at.unwrap()
            } else {
                self.opening_fire_at
                    .unwrap()
                    .max(time + self.between(skill.reacquire))
            };
            self.track = Some(TargetTrack {
                id: contact.id.clone(),
                fire_at,
                observed_at: time,
                observe_at: time,
                pose: contact.pose(),
                velocity: contact.velocity,
                quality: 0.0,
                focus: (self.random() * 3.0).floor() as usize,
                refocus_at: time + self.between([18.0, 30.0]),
                aim_points: None,
            });
            for m in &def.mounts {
                let mut gun = self.guns.remove(&m.id).unwrap();
                gun.fire_at = fire_at + self.between([0.0, 2.0]);
                self.revise(&mut gun);
                self.guns.insert(m.id.clone(), gun);
            }
        }
        let mut track = self.track.take().unwrap();
        track.quality = if contact.status == crate::sensors::TrackStatus::Lost {
            (track.quality - DT / 10.0).max(0.0)
        } else {
            (track.quality + DT / skill.settle).min(1.0)
        };
        let observed_at = contact.last_observed_tick as f64 / crate::rules::TICK_RATE as f64;
        if track.observed_at <= observed_at {
            track.quality = (track.quality
                - (length(sub(contact.velocity, track.velocity)) * 0.035).min(0.35))
            .max(0.0);
            track.pose = contact.pose();
            track.pose.x = contact.measured_position[0];
            track.pose.y = contact.measured_position[1];
            track.pose.z = contact.measured_position[2];
            track.velocity = contact.velocity;
            track.observed_at = observed_at;
        }
        if self.last_integrity - actor.damage.integrity > skill.evade * HULL_HP_SCALE {
            self.evade_until = time + self.between([8.0, 14.0]);
            self.maneuver_at = time;
        }
        self.last_integrity = actor.damage.integrity;
        if time >= track.refocus_at {
            track.focus = (track.focus + 1 + (self.random() * 2.0).floor() as usize) % 3;
            track.refocus_at = time + self.between([18.0, 30.0]);
        }
        self.track = Some(track);
        if time >= self.maneuver_at {
            self.course_offset = self.between([-0.22, 0.22]);
            self.cruise_throttle = self.between([0.5, 0.8]);
            if time > 0.0 && self.random() < 0.18 {
                self.side *= -1.0;
            }
            self.maneuver_at = time + self.between(skill.maneuver);
        }
    }
}
/// Select the strongest operational surface mount in this battery.
pub fn battery_mount(actor: &Vessel, secondary: bool) -> Option<&MountDefinition> {
    actor
        .definition()
        .mounts
        .iter()
        .zip(&actor.mounts)
        .filter(|(m, state)| {
            (m.battery == "secondary") == secondary
                && crate::anti_aircraft::surface_allowed(actor.definition(), m)
                && state.hp > 0.0
                && state.ammo > 0.0
        })
        .max_by(|(a, _), (b, _)| a.weapon.caliber_m.total_cmp(&b.weapon.caliber_m))
        .map(|(m, _)| m)
}

pub fn gun_range(m: &MountDefinition) -> f64 {
    let caliber = m.weapon.caliber_m;
    if caliber >= 0.2 {
        18000.0
    } else if caliber >= 0.1 {
        8000.0
    } else if caliber >= 0.03 {
        3500.0
    } else {
        1800.0
    }
}
pub fn ammunition(def: &ShipDefinition, mount: &MountDefinition, state: &MountState) -> Ammunition {
    let protection = def
        .armor
        .iter()
        .filter(|a| {
            a.exterior == Some(true) || a.plate.as_ref().is_some_and(|p| p.exterior == Some(true))
        })
        .map(|a| a.thickness_mm)
        .fold(0.0, f64::max);
    let preferred =
        if mount.weapon.he.is_some() && (mount.weapon.caliber_m < 0.2 || protection < 80.0) {
            Ammunition::He
        } else {
            Ammunition::Ap
        };
    let count = mount.weapon.barrel_count.unwrap_or(2.0);
    if state.available(preferred) >= count {
        preferred
    } else if preferred == Ammunition::Ap
        && mount.weapon.he.is_some()
        && state.available(Ammunition::He) >= count
    {
        Ammunition::He
    } else {
        Ammunition::Ap
    }
}
pub fn damage_aware_aim_points(
    actor: &Combatant,
    target: &Combatant,
    def: &ShipDefinition,
) -> Option<Vec<Vec3>> {
    if !target.damage.regions.iter().any(|r| r.hp < r.maximum * 0.5) {
        return None;
    }
    let side = if world_to_local(
        [actor.motion.x, actor.motion.y, actor.motion.z],
        target.motion.pose(),
    )[0] < 0.0
    {
        -1.0
    } else {
        1.0
    };
    let mut options = vec![];
    for i in 0..8 {
        let z = -def.hull.length / 2.0 + (i as f64 + 0.5) * def.hull.length / 8.0;
        let point = [side * def.hull.beam * 0.3, 0.8, z];
        let condition = damage_region(def, point, None, None)
            .and_then(|r| target.damage.regions.iter().find(|s| s.id == r.id))
            .map_or(1.0, |r| r.hp / r.maximum);
        let internal = def
            .modules
            .iter()
            .enumerate()
            .filter(|(_, m)| (m.center[2] - z).abs() < def.hull.length / 16.0)
            .map(|(i, m)| {
                target.damage.modules[i].hp / m.hp * if m.kind == "magazine" { 0.9 } else { 0.6 }
            })
            .fold(0.0, f64::max);
        options.push((point, condition + internal));
    }
    for (i, m) in def
        .modules
        .iter()
        .enumerate()
        .filter(|(_, m)| m.kind == "fire-control")
    {
        let hp = target.damage.modules[i].hp / m.hp;
        if hp > 0.0 {
            options.push((m.center, 0.9 * hp));
        }
    }
    options.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0[2].total_cmp(&b.0[2])));
    Some(options.into_iter().take(3).map(|o| o.0).collect())
}
pub fn torpedo_aim(bot: &BotState, motion: &ShipState, tube: &TubeDefinition) -> Option<Vec3> {
    let track = bot.track.as_ref()?;
    let point = add(
        [track.pose.x, 0.0, track.pose.z],
        scale(track.velocity, bot.time - track.observed_at),
    );
    torpedo_intercept(
        local_to_world(tube.position, motion.pose()),
        point,
        track.velocity,
        torpedo_speed(tube.weapon.speed),
    )
}
fn distance(a: &Vessel, b: &Vessel) -> f64 {
    (a.motion.x - b.motion.x).hypot(a.motion.z - b.motion.z)
}
pub fn target(actor: &Vessel, actors: &[Vessel]) -> Option<usize> {
    if actor.bot.as_ref().is_some_and(|b| b.ai_level.passive()) {
        return None;
    }
    let enemies: Vec<_> = actors
        .iter()
        .enumerate()
        .filter(|(_, a)| a.team != actor.team && a.physical_loss().is_none())
        .collect();
    let nearest = enemies
        .iter()
        .min_by(|(_, a), (_, b)| distance(actor, a).total_cmp(&distance(actor, b)))?;
    let previous = enemies
        .iter()
        .find(|(_, a)| Some(&a.motion.id) == actor.target_id.as_ref());
    Some(
        previous
            .filter(|(_, p)| distance(actor, p) <= distance(actor, nearest.1) * 1.25)
            .unwrap_or(nearest)
            .0,
    )
}
fn steer(actor: &Vessel, heading: f64) -> f64 {
    clamp(
        wrap_angle(heading - actor.motion.heading) * 2.0 - actor.motion.yaw_rate * 5.0,
        -1.0,
        1.0,
    )
}
fn avoid_ships(actor: &Vessel, heading: f64, actors: &[Vessel]) -> f64 {
    avoid_known_ships(actor, heading, actors, false)
}
fn avoid_known_ships(actor: &Vessel, heading: f64, actors: &[Vessel], own_only: bool) -> f64 {
    let (mut x, mut z) = (heading.sin(), -heading.cos());
    for other in actors {
        if other.motion.id == actor.motion.id
            || other.motion.y < -20.0
            || (own_only && other.team != actor.team)
        {
            continue;
        }
        let separation = distance(actor, other);
        let clearance =
            (actor.definition().hull.length + other.definition().hull.length) / 2.0 + 180.0;
        if separation > 0.0 && separation < clearance {
            let weight = (1.0 - separation / clearance) * 4.0;
            x += (actor.motion.x - other.motion.x) / separation * weight;
            z += (actor.motion.z - other.motion.z) / separation * weight;
        }
    }
    x.atan2(-z)
}
pub fn helm(
    bot: &mut BotState,
    actor: &Vessel,
    target: Option<&Vessel>,
    actors: &[Vessel],
) -> HelmCommand {
    if actor.damage.sunk || bot.ai_level == AiLevel::Static {
        return HelmCommand::default();
    }
    if bot.ai_level == AiLevel::Moving {
        let patrol = *bot
            .patrol_heading
            .get_or_insert(actor.motion.heading + std::f64::consts::FRAC_PI_2);
        return HelmCommand {
            throttle: 0.55,
            rudder: steer(actor, avoid_ships(actor, patrol, actors)),
            depth_m: actor.submarine.as_ref().map(|_| 0.0),
            ..Default::default()
        };
    }
    let Some(target) = target else {
        return HelmCommand::default();
    };
    let range = distance(actor, target);
    let bearing = (target.motion.x - actor.motion.x).atan2(actor.motion.z - target.motion.z);
    let hurt = actor.damage.integrity / actor.damage.max_integrity < 0.35;
    let preferred = bot.preferred_range * if hurt { 1.35 } else { 1.0 };
    let evading = bot.time < bot.evade_until;
    let angle = std::f64::consts::PI
        * if evading {
            0.74
        } else if range > preferred + 700.0 {
            1.0 / 3.0
        } else if range < preferred - 900.0 {
            0.7
        } else {
            0.5
        };
    let mut heading = bearing + bot.side * (angle + bot.course_offset);
    let def = actor.definition();
    let tubes: Vec<_> = def
        .torpedo_tubes
        .iter()
        .flatten()
        .enumerate()
        .filter(|(i, t)| {
            actor.torpedo_tubes[*i].ammo > 0.0
                && actor
                    .damage
                    .modules
                    .iter()
                    .find(|m| m.id == t.magazine_id)
                    .is_none_or(|m| m.hp != 0.0)
        })
        .map(|(_, t)| t)
        .collect();
    if !tubes.is_empty() && !evading && def.torpedo_launchers.as_ref().is_none_or(Vec::is_empty) {
        let tube = tubes
            .iter()
            .min_by(|a, b| {
                wrap_angle(bearing - actor.motion.heading - radians(a.bearing_deg))
                    .abs()
                    .total_cmp(
                        &wrap_angle(bearing - actor.motion.heading - radians(b.bearing_deg)).abs(),
                    )
            })
            .unwrap();
        let aim = torpedo_aim(bot, &actor.motion, tube);
        heading = aim.map_or(bearing, |p| {
            (p[0] - actor.motion.x).atan2(actor.motion.z - p[2])
        }) - radians(tube.bearing_deg);
    }
    heading = avoid_ships(actor, heading, actors);
    let torpedo_range = tubes.iter().map(|t| t.weapon.range_m).fold(0.0, f64::max);
    let dive = !tubes.is_empty()
        && range
            < torpedo_range
                * if actor
                    .submarine
                    .as_ref()
                    .is_some_and(|s| s.target_depth_m > 0.0)
                {
                    1.8
                } else {
                    1.6
                };
    HelmCommand {
        throttle: if evading {
            0.85
        } else if range > preferred + 700.0 {
            0.8
        } else {
            bot.cruise_throttle
        },
        rudder: steer(actor, heading),
        depth_m: def.submarine.as_ref().map(|s| {
            if dive {
                s.periscope_depth_m.min(s.max_torpedo_depth_m)
            } else {
                0.0
            }
        }),
        ..Default::default()
    }
}
pub fn helm_contact(
    bot: &BotState,
    actor: &Vessel,
    contact: Option<&crate::sensors::ContactTrack>,
    actors: &[Vessel],
) -> HelmCommand {
    if bot.ai_level.passive() || actor.physical_loss().is_some() {
        return HelmCommand::default();
    }
    let Some(contact) = contact else {
        return HelmCommand::default();
    };
    let point = contact.estimated_position;
    let range = (point[0] - actor.motion.x).hypot(point[2] - actor.motion.z);
    let bearing = (point[0] - actor.motion.x).atan2(actor.motion.z - point[2]);
    let evading = bot.time < bot.evade_until;
    let preferred = bot.preferred_range
        * if actor.damage.integrity / actor.damage.max_integrity < 0.35 {
            1.35
        } else {
            1.0
        };
    let angle = if evading || range < preferred - 900.0 {
        0.7
    } else if range > preferred + 700.0 {
        1.0 / 3.0
    } else {
        0.5
    };
    let heading = avoid_known_ships(
        actor,
        bearing + bot.side * (angle * std::f64::consts::PI + bot.course_offset),
        actors,
        true,
    );
    HelmCommand {
        throttle: if evading {
            0.85
        } else if range > preferred + 700.0 {
            0.8
        } else {
            bot.cruise_throttle
        },
        rudder: steer(actor, heading),
        ..Default::default()
    }
}
pub fn aim(
    bot: Option<&BotState>,
    motion: &ShipState,
    target: &Combatant,
    def: &ShipDefinition,
    mount: &MountDefinition,
    state: &mut MountState,
) -> Vec3 {
    aim_solution(
        bot,
        motion,
        mount,
        state,
        target.motion.pose(),
        target.motion.velocity(),
        def.hull.length,
        0.0,
    )
}
pub fn aim_contact(
    bot: Option<&BotState>,
    motion: &ShipState,
    target: &crate::sensors::ContactTrack,
    mount: &MountDefinition,
    state: &mut MountState,
) -> Vec3 {
    aim_solution(
        bot,
        motion,
        mount,
        state,
        target.pose(),
        target.velocity,
        target.estimated_length(),
        target.uncertainty_m,
    )
}
#[allow(clippy::too_many_arguments)]
fn aim_solution(
    bot: Option<&BotState>,
    motion: &ShipState,
    mount: &MountDefinition,
    state: &mut MountState,
    fallback_pose: Pose,
    fallback_velocity: Vec3,
    hull_length: f64,
    uncertainty: f64,
) -> Vec3 {
    let track = bot.and_then(|b| b.track.as_ref());
    let default_gun = GunOrder {
        height: 0.8,
        ..Default::default()
    };
    let gun = bot
        .and_then(|b| b.guns.get(&mount.id))
        .unwrap_or(&default_gun);
    let pose = track.map_or(fallback_pose, |t| t.pose);
    let velocity = track.map_or(fallback_velocity, |t| t.velocity);
    let inherited = motion.velocity();
    let along = (track.map_or(1, |t| t.focus) as f64 - 1.0) * 0.23 + gun.along_hull;
    let selected = track.and_then(|t| {
        t.aim_points
            .as_ref()
            .filter(|p| !p.is_empty())
            .and_then(|p| p.get(t.focus % p.len()))
    });
    let local = selected.map_or(
        [
            0.0,
            gun.height
                + if mount.battery == "secondary" {
                    2.0
                } else {
                    0.0
                },
            along * hull_length,
        ],
        |p| [p[0], p[1], p[2] + gun.along_hull * hull_length * 0.25],
    );
    let time = bot.map_or(0.0, |b| b.time);
    let mut point = add(
        local_to_world(local, pose),
        scale(velocity, time - track.map_or(time, |t| t.observed_at)),
    );
    point[1] = point[1].max(0.5);
    let from = muzzle_center_world(mount, state, motion);
    let (dx, dz) = (point[0] - from[0], point[2] - from[2]);
    let range = dx.hypot(dz).max(1.0);
    let error = (4.0 + range * 0.003 + uncertainty * 0.5)
        * (1.0 + 3.0 * (1.0 - track.map_or(0.0, |t| t.quality)))
        * skill(bot.map_or(AiLevel::Normal, |b| b.ai_level)).error;
    point[0] += (dx * gun.range_error - dz * gun.across_error * 0.6) / range * error;
    point[2] += (dz * gun.range_error + dx * gun.across_error * 0.6) / range * error;
    let cached = state
        .lead_cache
        .as_ref()
        .filter(|c| length(sub(point, c.point)) < 10.0);
    let mut time = cached.map_or_else(
        || (point[0] - from[0]).hypot(point[2] - from[2]) / mount.weapon.muzzle_speed,
        |c| c.time,
    );
    let drag = mount
        .weapon
        .ballistics
        .as_ref()
        .map_or(0.0, |b| b.drag_per_second);
    for _ in 0..if cached.is_some() { 1 } else { 3 } {
        let Some(solution) = solve_ballistic(
            from,
            sub(
                add(point, scale(velocity, time)),
                scale(inherited, travel_factor(time, drag)),
            ),
            mount.weapon.muzzle_speed,
            drag,
        ) else {
            break;
        };
        time = solution.time;
    }
    state.lead_cache = Some(crate::weapons::LeadCache { time, point });
    add(point, scale(velocity, time))
}
pub fn clear_firing_lane(actor: &Vessel, target: &Vessel, actors: &[Vessel]) -> bool {
    clear_lane_to(
        actor,
        [target.motion.x, target.motion.y, target.motion.z],
        actors,
    )
}
pub fn clear_lane_to(actor: &Vessel, point: Vec3, actors: &[Vessel]) -> bool {
    let (dx, dz) = (point[0] - actor.motion.x, point[2] - actor.motion.z);
    let squared = dx * dx + dz * dz;
    if squared < 1.0 {
        return false;
    }
    !actors.iter().any(|other| {
        if other.motion.id == actor.motion.id || other.team != actor.team || other.motion.y < -20.0
        {
            return false;
        }
        let along = ((other.motion.x - actor.motion.x) * dx
            + (other.motion.z - actor.motion.z) * dz)
            / squared;
        if along <= 0.0 || along >= 1.0 {
            return false;
        }
        (other.motion.x - actor.motion.x - along * dx)
            .hypot(other.motion.z - actor.motion.z - along * dz)
            < other.definition().hull.length / 2.0 + 35.0
    })
}

pub fn reaction_scale(level: AiLevel) -> f64 {
    skill(level).reaction
}
