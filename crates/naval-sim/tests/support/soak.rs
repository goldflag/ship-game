//! Bots against real coasts: watch every hull of a battle for land while it is
//! stepped. `run` soaks an omniscient custom battle on a map's own default line;
//! `Monitor` watches any battle after each tick (the PvE soak drives the worker's
//! own runtime). Shared by the `terrain_soak` test and the `terrain_soak` and
//! `pve_soak` examples.
#![allow(dead_code)]
use naval_sim::{
    battle::{Battle, BattleSetup},
    catalog::Catalog,
    rules::TeamId,
    vessel::{CompiledShip, Vessel},
};
use std::{
    collections::{BTreeMap, VecDeque},
    sync::Arc,
};

/// Seconds of track a ship must stay within `CIRCLING_M` of its own average,
/// somewhere in the window within `NEAR_LAND_M` of the coast, to count as stuck
/// or circling there. Five minutes: a slow cruiser's single full turn when its
/// crew changes sides takes up to about four and a half, in open sea as well
/// as near land, and damaged ships circle in open water too.
pub const WINDOW_S: usize = 300;
pub const CIRCLING_M: f64 = 700.0;
pub const NEAR_LAND_M: f64 = 1500.0;

#[derive(Debug, Default, Clone)]
pub struct ShipReport {
    pub id: String,
    pub preset: String,
    /// Ticks the hull rested on the ground after the tick's contact resolution.
    pub aground_ticks: u64,
    /// Contact events scored as grounding damage.
    pub groundings: u64,
    /// Least clearance of the hull's centre from land, less half its length.
    pub least_margin_m: f64,
    /// Whole windows spent inside a `CIRCLING_M` circle near land while able and
    /// asked to fight.
    pub stuck_windows: u64,
    /// The first stuck window: when and where, the hull's speed, top speed and
    /// health, and its range to its target.
    pub stuck_detail: Option<String>,
    pub afloat: bool,
}
#[derive(Debug)]
pub struct Report {
    pub map: String,
    pub seconds: f64,
    pub ships: Vec<ShipReport>,
    pub decided: bool,
}
impl Report {
    pub fn aground(&self) -> Vec<&ShipReport> {
        self.ships
            .iter()
            .filter(|s| s.aground_ticks > 0 || s.groundings > 0)
            .collect()
    }
    pub fn stuck(&self) -> Vec<&ShipReport> {
        self.ships.iter().filter(|s| s.stuck_windows > 0).collect()
    }
    pub fn summary(&self) -> String {
        let least = self
            .ships
            .iter()
            .map(|s| s.least_margin_m)
            .fold(f64::INFINITY, f64::min);
        format!(
            "{}: {:.0} s{}, {} ships, {} aground ({} ticks, {} grounding hits), {} stuck, least hull margin {:.0} m{}",
            self.map,
            self.seconds,
            if self.decided { " (decided)" } else { "" },
            self.ships.len(),
            self.aground().len(),
            self.ships.iter().map(|s| s.aground_ticks).sum::<u64>(),
            self.ships.iter().map(|s| s.groundings).sum::<u64>(),
            self.stuck().len(),
            least,
            self.ships
                .iter()
                .filter(|s| s.aground_ticks > 0 || s.groundings > 0 || s.stuck_windows > 0)
                .map(|s| format!(
                    "\n  {} ({}): {} aground ticks, {} hits, {} stuck windows, margin {:.0} m{}",
                    s.id,
                    s.preset,
                    s.aground_ticks,
                    s.groundings,
                    s.stuck_windows,
                    s.least_margin_m,
                    s.stuck_detail
                        .as_ref()
                        .map_or(String::new(), |d| format!(" (first: {d})"))
                ))
                .collect::<String>()
        )
    }
}

/// Whether any of the hull's ground points sits on the ground (within 5 cm):
/// where contact resolution leaves a hull it has just pushed out.
fn resting_on_ground(battle: &Battle, a: &Vessel) -> bool {
    let basis = a.motion.basis();
    a.compiled.ground_points.iter().any(|p| {
        let w = basis.local_to_world(*p);
        w[1] - battle.terrain.height(w[0], w[2]) < 0.05
    })
}

/// Watches a battle tick by tick: call `observe` after every step.
pub struct Monitor {
    map: String,
    ships: Vec<ShipReport>,
    /// Each ship's position and centre margin from land, once a second.
    tracks: Vec<VecDeque<([f64; 2], f64)>>,
    seen: u64,
}
impl Monitor {
    pub fn new(battle: &Battle) -> Self {
        Self {
            map: battle.map_id.clone(),
            ships: battle
                .actors
                .iter()
                .map(|a| ShipReport {
                    id: a.motion.id.clone(),
                    preset: a.preset_id.clone(),
                    least_margin_m: f64::INFINITY,
                    ..Default::default()
                })
                .collect(),
            tracks: vec![VecDeque::new(); battle.actors.len()],
            seen: 0,
        }
    }
    pub fn observe(&mut self, battle: &Battle) {
        let ticks = battle.tick;
        for event in battle.events.iter().filter(|e| e.sequence > self.seen) {
            if event.data.kind == "contact"
                && event.data.message.starts_with("Grounding")
                && let Some(r) = self.ships.iter_mut().find(|r| r.id == event.data.ship_id)
            {
                r.groundings += 1;
            }
        }
        self.seen = battle.events.back().map_or(self.seen, |e| e.sequence);
        let alive = |team: TeamId| {
            battle
                .actors
                .iter()
                .any(|a| a.team == team && a.physical_loss().is_none())
        };
        for (i, a) in battle.actors.iter().enumerate() {
            let report = &mut self.ships[i];
            report.afloat = a.physical_loss().is_none();
            if !report.afloat {
                continue;
            }
            if resting_on_ground(battle, a) {
                report.aground_ticks += 1;
            }
            let half = a.definition().hull.length / 2.0;
            let margin = battle.terrain.clearance(a.motion.x, a.motion.z) - half;
            report.least_margin_m = report.least_margin_m.min(margin);
            if ticks.is_multiple_of(60) {
                let track = &mut self.tracks[i];
                track.push_back(([a.motion.x, a.motion.z], margin));
                if track.len() > WINDOW_S {
                    track.pop_front();
                }
                let fighting = alive(a.team.other())
                    && naval_sim::navigation::maximum_speed(a) > 1.0
                    && a.definition().submarine.is_none();
                if track.len() == WINDOW_S && fighting && ticks.is_multiple_of(60 * 60) {
                    let n = track.len() as f64;
                    let centre = track
                        .iter()
                        .fold([0.0, 0.0], |c, (p, _)| [c[0] + p[0] / n, c[1] + p[1] / n]);
                    let spread = track
                        .iter()
                        .map(|(p, _)| (p[0] - centre[0]).hypot(p[1] - centre[1]))
                        .fold(0.0, f64::max);
                    let near_land = track.iter().any(|(_, m)| *m < NEAR_LAND_M);
                    if spread < CIRCLING_M && near_land {
                        report.stuck_windows += 1;
                        let range = a
                            .target_id
                            .as_ref()
                            .and_then(|id| battle.actors.iter().find(|b| &b.motion.id == id))
                            .map_or(f64::NAN, |b| {
                                (b.motion.x - a.motion.x).hypot(b.motion.z - a.motion.z)
                            });
                        report.stuck_detail.get_or_insert_with(|| {
                            format!(
                                "t {} s at ({:.0}, {:.0}), speed {:.1} of {:.1} m/s, health {:.2}, target range {:.0} m",
                                ticks / 60,
                                a.motion.x,
                                a.motion.z,
                                a.motion.speed,
                                naval_sim::navigation::maximum_speed(a),
                                a.damage.integrity / a.damage.max_integrity,
                                range
                            )
                        });
                    }
                }
            }
        }
    }
    pub fn report(self, battle: &Battle) -> Report {
        Report {
            map: self.map,
            seconds: battle.tick as f64 / 60.0,
            ships: self.ships,
            decided: battle.outcome.is_some(),
        }
    }
}

/// An omniscient custom battle: `fleet` a side on the map's default line
/// `distance` apart, every ship a Normal bot, stepped for `seconds` or until
/// decided.
pub fn run(
    catalog: &Arc<Catalog>,
    compiled: &BTreeMap<String, Arc<CompiledShip>>,
    map: &str,
    fleet: &[&str],
    distance: f64,
    seconds: u64,
    seed: u32,
) -> Report {
    let ships: Vec<_> = ["a", "b"]
        .into_iter()
        .flat_map(|team| {
            fleet.iter().enumerate().map(move |(i, preset)| {
                serde_json::json!({"id": format!("{team}-{i}"), "presetId": preset, "team": team,
                    "controller": "bot", "aiLevel": "normal", "spawn": null})
            })
        })
        .collect();
    let setup: BattleSetup = serde_json::from_value(serde_json::json!({
        "ships": ships, "seed": seed, "mapId": map, "weather": "clear",
        "spawnDistance": distance, "windSpeed": null
    }))
    .unwrap();
    let mut battle = Battle::new(catalog.clone(), compiled, setup).unwrap();
    let mut monitor = Monitor::new(&battle);
    let orders = BTreeMap::new();
    while battle.tick < seconds * 60 && battle.outcome.is_none() {
        battle.step(&orders);
        monitor.observe(&battle);
    }
    monitor.report(&battle)
}
