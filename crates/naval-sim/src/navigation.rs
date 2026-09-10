//! Persistent captain navigation. Orders own destinations; local safety never
//! replaces an escort with an attack or changes the player's route.
use crate::{
    environment::{Island, avoid_land},
    geometry::wrap_angle,
    machinery::system_health,
    motion::HelmCommand,
    vessel::Vessel,
};
use serde::{Deserialize, Serialize};

pub const MAX_WAYPOINTS: usize = 32;
const SHORE_BUFFER_M: f64 = 150.0;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[ts(rename = "MovementOrder")]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Movement {
    #[default]
    Autonomous,
    /// Legacy stop order; new fleet commands use HoldArea for station keeping.
    Hold,
    Move {
        position: [f64; 2],
    },
    Route {
        waypoints: Vec<[f64; 2]>,
        speed_mps: f64,
        looped: bool,
    },
    HoldArea {
        position: [f64; 2],
        radius_m: f64,
    },
    /// Ship-local [starboard, aft] meters. Column slots follow the leader's
    /// track at the aft distance; other formations rotate with the formation
    /// axis. `slot` orders guide succession (lowest slot takes the guide).
    Escort {
        leader_id: String,
        offset: [f64; 2],
        radius_m: f64,
        #[serde(default)]
        formation: Formation,
        #[serde(default)]
        slot: u32,
    },
}

/// How a formation keeps its shape through a turn. Column followers turn in
/// succession along the leader's track; screen and line-abreast stations are
/// fixed to a formation axis that rotates toward the leader's course at a
/// bounded rate, so every ship turns together.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "kebab-case")]
pub enum Formation {
    #[default]
    Column,
    Screen,
    LineAbreast,
}

/// Distance a ship must run before another breadcrumb is recorded.
pub const TRAIL_STEP_M: f64 = 20.0;
/// How much track every actor keeps behind it.
pub const TRAIL_LENGTH_M: f64 = 8000.0;
/// A formation axis follows the guide's course at three degrees a second, so a
/// screen leans into a turn together instead of snapping around the guide's bow.
pub const AXIS_RATE_RAD_PER_S: f64 = 0.0524;

/// One recorded point of an actor's track.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Breadcrumb {
    pub position: [f64; 2],
    pub heading: f64,
    pub speed: f64,
    /// Arc length run along the trail when this point was recorded.
    pub distance: f64,
}

/// Where an actor has been, and the formation axis its followers steer by. It is
/// recorded for every actor each tick, so manual helm, bots and standing orders
/// all leave the same track behind them.
#[derive(Clone, Debug, Default)]
pub struct Trail {
    points: std::collections::VecDeque<Breadcrumb>,
    axis: Option<f64>,
    axis_rate: f64,
}
impl Trail {
    pub fn record(&mut self, position: [f64; 2], heading: f64, speed: f64) {
        let travelled = match self.points.back() {
            Some(last) => {
                let step = distance(last.position, position);
                if step < TRAIL_STEP_M {
                    return;
                }
                last.distance + step
            }
            None => 0.0,
        };
        self.points.push_back(Breadcrumb {
            position,
            heading,
            speed,
            distance: travelled,
        });
        while self
            .points
            .front()
            .is_some_and(|p| travelled - p.distance > TRAIL_LENGTH_M)
            && self.points.len() > 1
        {
            self.points.pop_front();
        }
    }
    /// Turn the formation axis toward the guide's course the short way round,
    /// at the bounded rate. It starts on the guide's own heading.
    pub fn steady_axis(&mut self, heading: f64, dt: f64) {
        let axis = *self.axis.get_or_insert(heading);
        let limit = AXIS_RATE_RAD_PER_S * dt;
        let change = wrap_angle(heading - axis).clamp(-limit, limit);
        self.axis = Some(wrap_angle(axis + change));
        self.axis_rate = if dt > 0.0 { change / dt } else { 0.0 };
    }
    pub fn axis(&self, heading: f64) -> f64 {
        self.axis.unwrap_or(heading)
    }
    pub fn axis_rate(&self) -> f64 {
        self.axis_rate
    }
    pub fn len(&self) -> usize {
        self.points.len()
    }
    pub fn is_empty(&self) -> bool {
        self.points.is_empty()
    }
    /// The point `distance_m` of run track behind `head`, interpolated between
    /// breadcrumbs. None when the recorded track is shorter than that.
    pub fn behind(&self, head: Breadcrumb, distance_m: f64) -> Option<Breadcrumb> {
        if distance_m <= 0.0 {
            return Some(head);
        }
        let mut next = head;
        let mut travelled = 0.0;
        for point in self.points.iter().rev() {
            let step = distance(point.position, next.position);
            if travelled + step >= distance_m {
                let t = if step > 1e-9 {
                    (distance_m - travelled) / step
                } else {
                    0.0
                };
                return Some(Breadcrumb {
                    position: [
                        next.position[0] + (point.position[0] - next.position[0]) * t,
                        next.position[1] + (point.position[1] - next.position[1]) * t,
                    ],
                    heading: wrap_angle(
                        next.heading + wrap_angle(point.heading - next.heading) * t,
                    ),
                    speed: next.speed + (point.speed - next.speed) * t,
                    distance: distance_m,
                });
            }
            travelled += step;
            next = *point;
        }
        None
    }
}
pub type Trails = std::collections::BTreeMap<String, Trail>;

/// A follower's station and how fast that station itself travels. Column slots
/// ride the guide's own track at the ordered distance astern; every other
/// formation rides the formation axis, so the whole body turns together.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Station {
    pub position: [f64; 2],
    pub velocity: [f64; 2],
    /// How fast the station itself swings about the guide, in radians a second.
    /// A slot on the guide's track does not swing at all; a heading-relative
    /// slot swings with the guide's bow; an axis slot only leans over at the
    /// bounded axis rate. Outer slots reserve guide speed in proportion to it.
    pub sweep_rate: f64,
}

/// The one place battle stepping, the formation report and the captain agree on
/// where a follower belongs. Non-escort orders have no station.
pub fn station_for(order: &Movement, leader: &Vessel, trail: Option<&Trail>) -> Option<Station> {
    let Movement::Escort {
        offset, formation, ..
    } = order
    else {
        return None;
    };
    let head = Breadcrumb {
        position: point(leader),
        heading: leader.motion.heading,
        speed: leader.motion.speed,
        distance: 0.0,
    };
    // A column slot is a place on the water the guide has already crossed. A slot
    // ahead of the guide, or one further back than the recorded track, has no such
    // place and keeps the heading-relative station with its turn reservation.
    if *formation == Formation::Column
        && offset[1] > 0.0
        && let Some(track) = trail.and_then(|t| t.behind(head, offset[1]))
    {
        let (sin, cos) = track.heading.sin_cos();
        // The slot slides along the track as fast as the guide is running now,
        // pointed the way the guide was pointed there: a follower keeps pace
        // without sprinting sideways, and drops back the moment the guide slows.
        let along = leader.motion.speed;
        return Some(Station {
            position: [
                track.position[0] + offset[0] * cos,
                track.position[1] + offset[0] * sin,
            ],
            velocity: [along * sin, -along * cos],
            sweep_rate: 0.0,
        });
    }
    let column = *formation == Formation::Column;
    let axis = if column {
        leader.motion.heading
    } else {
        trail.map_or(leader.motion.heading, |t| t.axis(leader.motion.heading))
    };
    let rate = if column {
        leader.motion.yaw_rate
    } else {
        trail.map_or(0.0, |t| t.axis_rate())
    };
    let (sin, cos) = axis.sin_cos();
    let world = [
        offset[0] * cos - offset[1] * sin,
        offset[0] * sin + offset[1] * cos,
    ];
    let velocity = leader.motion.velocity();
    Some(Station {
        position: [leader.motion.x + world[0], leader.motion.z + world[1]],
        // The station itself travels faster/slower than the hull center in a turn.
        velocity: [velocity[0] - rate * world[1], velocity[2] + rate * world[0]],
        sweep_rate: rate,
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WeaponsPolicy {
    pub guns: bool,
    pub aa: bool,
    pub torpedoes: bool,
}
impl Default for WeaponsPolicy {
    fn default() -> Self {
        Self {
            guns: true,
            aa: true,
            torpedoes: true,
        }
    }
}
impl WeaponsPolicy {
    pub fn fleet_default() -> Self {
        Self {
            torpedoes: false,
            ..Self::default()
        }
    }
}

/// An explicit fleet decision; damage never silently detaches an escort.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "kebab-case")]
pub enum FormationPolicy {
    #[default]
    AwaitDecision,
    SlowForStragglers,
    LeaveStragglers,
}
#[derive(Clone, Debug, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct Straggler {
    pub ship_id: String,
    pub available_speed_mps: f64,
    pub gap_m: f64,
}
#[derive(Clone, Debug, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct FormationReport {
    pub stragglers: Vec<Straggler>,
    pub speed_limit_mps: f64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "kebab-case")]
pub enum NavigationStatus {
    #[default]
    FollowingRoute,
    Holding,
    Rejoining,
    OnStation,
    FormingColumn,
    LeaderLost,
    Blocked,
    Immobile,
    Avoiding,
    Straggling,
    SlowingForStragglers,
    EvadingAircraft,
    EvadingTorpedo,
}

#[derive(Clone, Debug, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct NavigationState {
    pub order: Movement,
    pub waypoint: usize,
    pub status: NavigationStatus,
    pub destination: Option<[f64; 2]>,
    pub formation: Option<FormationReport>,
    #[serde(skip)]
    column_until_tick: u64,
    #[serde(skip)]
    pub(crate) evasion: Option<crate::fleet_evasion::Evasion>,
    #[serde(skip)]
    path: Vec<[f64; 2]>,
    #[serde(skip)]
    path_target: Option<[f64; 2]>,
    #[serde(skip)]
    next_plan_tick: u64,
    #[serde(skip)]
    lost_hold: Option<[f64; 2]>,
}
impl NavigationState {
    pub fn new(order: Movement) -> Self {
        Self {
            order,
            waypoint: 0,
            status: NavigationStatus::FollowingRoute,
            destination: None,
            formation: None,
            column_until_tick: 0,
            evasion: None,
            path: vec![],
            path_target: None,
            next_plan_tick: 0,
            lost_hold: None,
        }
    }
}

fn distance(a: [f64; 2], b: [f64; 2]) -> f64 {
    (a[0] - b[0]).hypot(a[1] - b[1])
}
fn point(a: &Vessel) -> [f64; 2] {
    [a.motion.x, a.motion.z]
}
pub fn maximum_speed(a: &Vessel) -> f64 {
    a.definition().handling.forward_speed * system_health(a, a.definition(), "engine", None).sqrt()
}

/// Only owned capabilities enter this report. A healthy displaced ship needs
/// catch-up room, not a damage decision; a damaged ship can warn before it falls
/// kilometres behind. LeaveStragglers preserves its escort order for recovery.
pub fn formation_report(
    leader: &Vessel,
    actors: &[Vessel],
    orders: &std::collections::BTreeMap<String, crate::battle::Orders>,
    policy: FormationPolicy,
    trails: &Trails,
) -> FormationReport {
    let maximum = maximum_speed(leader);
    let requested = match orders.get(&leader.motion.id).map(|o| &o.movement) {
        Some(Movement::Route { speed_mps, .. }) => maximum.min(*speed_mps),
        _ => leader.motion.speed.abs(),
    };
    let mut report = FormationReport {
        stragglers: vec![],
        speed_limit_mps: maximum,
    };
    for follower in actors
        .iter()
        .filter(|a| a.team == leader.team && a.physical_loss().is_none())
    {
        let Some(
            order @ Movement::Escort {
                leader_id, offset, ..
            },
        ) = orders.get(&follower.motion.id).map(|o| &o.movement)
        else {
            continue;
        };
        if leader_id != &leader.motion.id {
            continue;
        }
        let design = follower.definition().handling.forward_speed;
        let available = maximum_speed(follower);
        let damaged = available < design * 0.85;
        let steering_failed =
            system_health(follower, follower.definition(), "steering", None) < 0.01;
        let station = station_for(order, leader, trails.get(leader_id)).unwrap();
        if (damaged && available + 0.5 < requested) || steering_failed {
            report.stragglers.push(Straggler {
                ship_id: follower.motion.id.clone(),
                available_speed_mps: if steering_failed { 0.0 } else { available },
                gap_m: distance(point(follower), station.position),
            });
        }
        // Reserve outer-station speed while the station itself is swinging,
        // retaining the established straight-line reserve. A column slot on the
        // guide's track never swings, so it reserves nothing; an axis station
        // reserves only what the bounded axis rate actually demands. Damage
        // changes the cap only after a decision.
        let capability = if policy == FormationPolicy::SlowForStragglers {
            available
        } else {
            design
        };
        let turn_speed = station.sweep_rate.abs() * offset[0].hypot(offset[1]);
        report.speed_limit_mps = report
            .speed_limit_mps
            .min((capability * 0.85 - turn_speed).max(capability * 0.4));
    }
    if policy == FormationPolicy::SlowForStragglers {
        for straggler in &report.stragglers {
            report.speed_limit_mps = report
                .speed_limit_mps
                .min(straggler.available_speed_mps * 0.85);
        }
    }
    report
}

/// Conservative ellipses enclose every authored coastline lobe plus the hull
/// and shoal margin. Graph edges are checked continuously, not at coarse samples.
fn clear_segment(from: [f64; 2], to: [f64; 2], islands: &[Island], margin: f64) -> bool {
    islands.iter().all(|i| {
        let rx = i.rx * 1.22 + margin;
        let rz = i.rz * 1.22 + margin;
        let p = [(from[0] - i.x) / rx, (from[1] - i.z) / rz];
        let d = [(to[0] - from[0]) / rx, (to[1] - from[1]) / rz];
        let n = d[0] * d[0] + d[1] * d[1];
        let t = if n > 0.0 {
            (-(p[0] * d[0] + p[1] * d[1]) / n).clamp(0.0, 1.0)
        } else {
            0.0
        };
        (p[0] + t * d[0]).hypot(p[1] + t * d[1]) > 1.0
    })
}

/// A ship can drift into the extra planning buffer while its entire hull is
/// still clear of shore. Let its first leg leave that buffer, but never enter
/// it from outside, move closer to the island, or relax physical hull clearance.
fn clear_departure(from: [f64; 2], to: [f64; 2], islands: &[Island], margin: f64) -> bool {
    islands.iter().all(|island| {
        let one = std::slice::from_ref(island);
        if clear_segment(from, to, one, margin) {
            return true;
        }
        if clear_segment(from, from, one, margin)
            || !clear_segment(from, to, one, (margin - SHORE_BUFFER_M).max(0.0))
        {
            return false;
        }
        let rx = island.rx * 1.22 + margin;
        let rz = island.rz * 1.22 + margin;
        // Nonnegative derivative of squared elliptical distance: this entire
        // straight leg moves outward, including at its closest point (the start).
        (from[0] - island.x) * (to[0] - from[0]) / (rx * rx)
            + (from[1] - island.z) * (to[1] - from[1]) / (rz * rz)
            >= 0.0
    })
}

pub fn destination_is_clear(a: &Vessel, destination: [f64; 2], islands: &[Island]) -> bool {
    clear_segment(
        destination,
        destination,
        islands,
        a.definition().hull.length * 0.5 + SHORE_BUFFER_M,
    )
}

/// A small visibility graph is rebuilt only when the destination changes or a
/// blocked route is retried. Node order and equal-cost choices are deterministic.
fn plan_path(
    from: [f64; 2],
    to: [f64; 2],
    islands: &[Island],
    margin: f64,
) -> Option<Vec<[f64; 2]>> {
    if !clear_segment(to, to, islands, margin) {
        return None;
    }
    if clear_departure(from, to, islands, margin) {
        return Some(vec![to]);
    }
    let mut nodes = vec![from, to];
    for i in islands {
        for n in 0..16 {
            let angle = n as f64 * std::f64::consts::TAU / 16.0;
            let p = [
                i.x + (i.rx * 1.22 + margin + 180.0) * 1.08 * angle.cos(),
                i.z + (i.rz * 1.22 + margin + 180.0) * 1.08 * angle.sin(),
            ];
            if clear_segment(p, p, islands, margin) {
                nodes.push(p);
            }
        }
    }
    let mut costs = vec![f64::INFINITY; nodes.len()];
    let mut prev = vec![usize::MAX; nodes.len()];
    let mut visited = vec![false; nodes.len()];
    costs[0] = 0.0;
    for _ in 0..nodes.len() {
        let Some(u) = (0..nodes.len())
            .filter(|&n| !visited[n] && costs[n].is_finite())
            .min_by(|&a, &b| costs[a].total_cmp(&costs[b]))
        else {
            break;
        };
        if u == 1 {
            break;
        }
        visited[u] = true;
        for v in 0..nodes.len() {
            if visited[v] {
                continue;
            }
            let clear = if u == 0 {
                clear_departure(nodes[u], nodes[v], islands, margin)
            } else {
                clear_segment(nodes[u], nodes[v], islands, margin)
            };
            if clear {
                let cost = costs[u] + distance(nodes[u], nodes[v]);
                if cost < costs[v] {
                    costs[v] = cost;
                    prev[v] = u;
                }
            }
        }
    }
    if !costs[1].is_finite() {
        return None;
    }
    let mut path = vec![];
    let mut u = 1;
    while u != 0 {
        path.push(nodes[u]);
        u = prev[u];
    }
    path.reverse();
    Some(path)
}

fn steer(a: &Vessel, heading: f64) -> f64 {
    (wrap_angle(heading - a.motion.heading) * 2.0 - a.motion.yaw_rate * 5.0).clamp(-1.0, 1.0)
}

/// Predict close approaches using physical motion only. Both ships turn to
/// starboard for a head-on meeting; passing ships do not attract each other.
fn avoid_neighbors(
    a: &Vessel,
    actors: &[Vessel],
    contacts: Option<&[crate::sensors::ContactTrack]>,
    heading: f64,
    speed: f64,
) -> (f64, f64, bool) {
    let own = a.motion.velocity();
    let mut desired = [heading.sin(), -heading.cos()];
    let mut safe_speed = speed;
    let mut avoiding = false;
    let physical = actors
        .iter()
        .filter(|b| {
            b.motion.id != a.motion.id
                && b.motion.y >= -20.0
                && (contacts.is_none() || b.team == a.team)
        })
        .map(|b| {
            (
                [b.motion.x, b.motion.z],
                b.motion.velocity(),
                b.definition().hull.length,
            )
        });
    let observed = contacts
        .into_iter()
        .flatten()
        .filter(|c| {
            c.kind == crate::sensors::ContactKind::Surface
                && c.status != crate::sensors::TrackStatus::Stale
        })
        .map(|c| {
            (
                [c.estimated_position[0], c.estimated_position[2]],
                c.velocity,
                c.estimated_length(),
            )
        });
    for (position, theirs, length) in physical.chain(observed) {
        let r = [position[0] - a.motion.x, position[1] - a.motion.z];
        let gap = r[0].hypot(r[1]);
        let clearance = (a.definition().hull.length + length) * 0.6 + 100.0;
        if gap > clearance + (a.motion.speed.abs() + theirs[0].hypot(theirs[2])) * 45.0 {
            continue;
        }
        let velocity = [theirs[0] - own[0], theirs[2] - own[2]];
        let v2 = velocity[0] * velocity[0] + velocity[1] * velocity[1];
        let approach = r[0] * velocity[0] + r[1] * velocity[1];
        let time = if v2 > 0.01 {
            (-approach / v2).clamp(0.0, 45.0)
        } else {
            0.0
        };
        let closest = (r[0] + velocity[0] * time).hypot(r[1] + velocity[1] * time);
        if gap >= clearance && (approach >= 0.0 || closest > clearance) {
            continue;
        }
        avoiding = true;
        let ahead = r[0] * a.motion.heading.sin() - r[1] * a.motion.heading.cos();
        let side = r[0] * a.motion.heading.cos() + r[1] * a.motion.heading.sin();
        let head_on = ahead > 0.0 && side.abs() < clearance * 0.6;
        let weight = (1.0 - closest / (clearance * 1.5)).clamp(0.2, 1.0) * 2.5;
        if head_on {
            desired[0] += a.motion.heading.cos() * weight;
            desired[1] += a.motion.heading.sin() * weight;
        } else if gap > 0.1 {
            desired[0] -= r[0] / gap * weight;
            desired[1] -= r[1] / gap * weight;
        }
        if ahead > 0.0 && gap < clearance * 1.4 {
            safe_speed = safe_speed.min(speed * 0.4);
        }
    }
    (desired[0].atan2(-desired[1]), safe_speed, avoiding)
}

/// Recheck a temporary threat turn against known nearby hulls. Land and mission
/// boundaries are applied by Battle after this correction, just as for orders.
pub fn safe_correction(
    a: &Vessel,
    actors: &[Vessel],
    contacts: &[crate::sensors::ContactTrack],
    state: &mut NavigationState,
    command: HelmCommand,
) -> HelmCommand {
    let maximum = maximum_speed(a).max(0.05);
    let heading = a.motion.heading + (command.rudder + a.motion.yaw_rate * 5.0) * 0.5;
    let (heading, speed, avoiding) = avoid_neighbors(
        a,
        actors,
        Some(contacts),
        heading,
        maximum * command.throttle,
    );
    if !avoiding {
        return command;
    }
    state.status = NavigationStatus::Avoiding;
    HelmCommand {
        rudder: steer(a, heading),
        throttle: command.throttle.min(speed / maximum),
        ..command
    }
}

/// speed_limit reserves catch-up speed for formation members. It is supplied by
/// the authoritative order set, so selecting/following a ship cannot change it.
/// `trails` carries every actor's recorded track and formation axis; a follower
/// reads its guide's entry from it.
#[allow(clippy::too_many_arguments)]
pub fn command(
    a: &Vessel,
    actors: &[Vessel],
    islands: &[Island],
    order: &Movement,
    state: &mut NavigationState,
    tick: u64,
    speed_limit: f64,
    trails: &Trails,
) -> HelmCommand {
    command_observed(
        a,
        actors,
        islands,
        order,
        state,
        tick,
        speed_limit,
        trails,
        None,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn command_observed(
    a: &Vessel,
    actors: &[Vessel],
    islands: &[Island],
    order: &Movement,
    state: &mut NavigationState,
    tick: u64,
    speed_limit: f64,
    trails: &Trails,
    contacts: Option<&[crate::sensors::ContactTrack]>,
) -> HelmCommand {
    if state.order != *order {
        *state = NavigationState::new(order.clone());
    }
    let at = point(a);
    let maximum = maximum_speed(a);
    if maximum < 0.05 || system_health(a, a.definition(), "steering", None) < 0.01 {
        state.status = NavigationStatus::Immobile;
        return HelmCommand::default();
    }
    let margin = a.definition().hull.length * 0.5 + SHORE_BUFFER_M;
    let mut final_speed = 0.0;
    let mut requested = maximum.min(speed_limit);
    let mut radius = 80.0;
    let destination = match order {
        Movement::Route {
            waypoints,
            speed_mps,
            looped,
        } => {
            if waypoints.is_empty() {
                state.status = NavigationStatus::Blocked;
                return HelmCommand::default();
            }
            state.waypoint = state.waypoint.min(waypoints.len() - 1);
            requested = requested.min(*speed_mps);
            let arrival = (a.motion.speed.abs() * 6.0).max(80.0);
            if distance(at, waypoints[state.waypoint]) < arrival {
                if state.waypoint + 1 < waypoints.len() {
                    state.waypoint += 1;
                } else if *looped && waypoints.len() > 1 {
                    state.waypoint = 0;
                }
            }
            if *looped || state.waypoint + 1 < waypoints.len() {
                final_speed = requested;
            }
            state.status = NavigationStatus::FollowingRoute;
            waypoints[state.waypoint]
        }
        Movement::Move { position } => {
            state.status = NavigationStatus::FollowingRoute;
            *position
        }
        Movement::HoldArea { position, radius_m } => {
            radius = *radius_m * 0.6;
            state.status = NavigationStatus::Holding;
            *position
        }
        Movement::Escort {
            leader_id,
            radius_m,
            ..
        } => {
            radius = (*radius_m * 0.1).clamp(40.0, 100.0);
            if let Some(leader) = actors.iter().find(|b| {
                b.motion.id == *leader_id && b.team == a.team && b.physical_loss().is_none()
            }) {
                state.lost_hold = None;
                let station = station_for(order, leader, trails.get(leader_id)).unwrap();
                let mut destination = station.position;
                let mut station_velocity = station.velocity;
                state.status = NavigationStatus::Rejoining;
                // Where the slot will be once the guide has run on for a while.
                let next_station = [
                    destination[0] + station_velocity[0] * 15.0,
                    destination[1] + station_velocity[1] * 15.0,
                ];
                let obstructed_slot =
                    !clear_segment(point(leader), destination, islands, margin + 100.0)
                        || !clear_segment(destination, next_station, islands, margin + 150.0);
                if obstructed_slot {
                    state.column_until_tick = tick + 600;
                }
                if obstructed_slot || tick < state.column_until_tick {
                    let index = actors.iter().filter(|b| b.motion.id < a.motion.id && b.navigation.as_ref().is_some_and(|n|
                        matches!(&n.order, Movement::Escort { leader_id: id, .. } if id == leader_id))).count();
                    let aft = 450.0 + index as f64 * 400.0;
                    let (sin, cos) = leader.motion.heading.sin_cos();
                    let offset_world = [-aft * sin, aft * cos];
                    destination = [
                        leader.motion.x + offset_world[0],
                        leader.motion.z + offset_world[1],
                    ];
                    let velocity = leader.motion.velocity();
                    station_velocity = [
                        velocity[0] - leader.motion.yaw_rate * offset_world[1],
                        velocity[2] + leader.motion.yaw_rate * offset_world[0],
                    ];
                    state.status = NavigationStatus::FormingColumn;
                }
                let error = [destination[0] - at[0], destination[1] - at[1]];
                let range = error[0].hypot(error[1]);
                if clear_segment(at, destination, islands, margin) {
                    if range < radius && station_velocity[0].hypot(station_velocity[1]) < 0.25 {
                        state.status = NavigationStatus::OnStation;
                        state.destination = Some(destination);
                        return sail(
                            a,
                            actors,
                            contacts,
                            islands,
                            state,
                            a.motion.heading,
                            0.0,
                            maximum,
                        );
                    }
                    let velocity = [
                        station_velocity[0] + error[0] / 35.0,
                        station_velocity[1] + error[1] / 35.0,
                    ];
                    // A slot on the guide's track stops when the guide stops.
                    // Leave room to shed catch-up speed instead of running past it.
                    let braking = station_velocity[0].hypot(station_velocity[1])
                        + (2.0 * a.definition().handling.braking * range).sqrt();
                    let speed = velocity[0].hypot(velocity[1]).min(maximum).min(braking);
                    if range < radius && state.status != NavigationStatus::FormingColumn {
                        state.status = NavigationStatus::OnStation;
                    }
                    state.destination = Some(destination);
                    let heading = if speed > 0.15 {
                        velocity[0].atan2(-velocity[1])
                    } else {
                        a.motion.heading
                    };
                    let command =
                        sail(a, actors, contacts, islands, state, heading, speed, maximum);
                    if maximum < a.definition().handling.forward_speed * 0.85
                        && maximum + 0.5 < leader.motion.speed.abs()
                        && state.status != NavigationStatus::Avoiding
                    {
                        state.status = NavigationStatus::Straggling;
                    }
                    return command;
                }
                destination
            } else {
                state.status = NavigationStatus::LeaderLost;
                *state.lost_hold.get_or_insert(at)
            }
        }
        Movement::Autonomous | Movement::Hold => return HelmCommand::default(),
    };
    state.destination = Some(destination);
    let range = distance(at, destination);
    if range < radius && final_speed == 0.0 {
        if state.status == NavigationStatus::FollowingRoute {
            state.status = NavigationStatus::Holding;
        }
        return sail(
            a,
            actors,
            contacts,
            islands,
            state,
            a.motion.heading,
            0.0,
            maximum,
        );
    }
    let changed = state
        .path_target
        .is_none_or(|p| distance(p, destination) > 100.0);
    let obstructed = state
        .path
        .first()
        .is_some_and(|p| !clear_departure(at, *p, islands, margin));
    if (changed || state.path.is_empty() || obstructed) && tick >= state.next_plan_tick {
        state.path = plan_path(at, destination, islands, margin).unwrap_or_default();
        state.path_target = Some(destination);
        state.next_plan_tick = tick + 60;
    }
    while state.path.len() > 1 && distance(at, state.path[0]) < 100.0 {
        state.path.remove(0);
    }
    let Some(next) = state.path.first().copied() else {
        state.status = NavigationStatus::Blocked;
        return HelmCommand::default();
    };
    // Brake before the final station rather than orbiting a point at full speed.
    let braking_speed = (2.0 * a.definition().handling.braking * (range - radius).max(0.0)).sqrt();
    let speed = if state.path.len() > 1 {
        requested
    } else {
        requested.min(braking_speed.max(final_speed))
    };
    let heading = (next[0] - at[0]).atan2(at[1] - next[1]);
    sail(a, actors, contacts, islands, state, heading, speed, maximum)
}

#[allow(clippy::too_many_arguments)]
fn sail(
    a: &Vessel,
    actors: &[Vessel],
    contacts: Option<&[crate::sensors::ContactTrack]>,
    islands: &[Island],
    state: &mut NavigationState,
    heading: f64,
    speed: f64,
    maximum: f64,
) -> HelmCommand {
    let (heading, speed, avoiding) = avoid_neighbors(a, actors, contacts, heading, speed);
    if avoiding {
        state.status = NavigationStatus::Avoiding;
    }
    let error = wrap_angle(heading - a.motion.heading).abs();
    // Maintain steerage through large turns; slow sufficiently to avoid tracing
    // a full-speed circle around a nearby waypoint.
    let speed = if error > 1.0 {
        speed.min(maximum * 0.4)
    } else {
        speed
    };
    let rudder = steer(a, heading);
    let turn_loss =
        1.0 - 0.22 * a.motion.rudder.powi(2) * (a.motion.speed.abs() / maximum).clamp(0.0, 1.0);
    let command = HelmCommand {
        throttle: (speed / (maximum * turn_loss)).clamp(0.0, 1.0),
        rudder,
        ..Default::default()
    };
    avoid_land(&a.motion, command, islands)
}
