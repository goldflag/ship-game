//! Hand-authored historical actions. A scenario fixes the order of battle, the
//! chart, the time of day and each group's opening orders; the opponent follows
//! one of a few scripted plans drawn from the seed; victory points judge the
//! result. A scenario is a [`PvePlan`] with a fixed setup and a [`RaidScript`],
//! so the fleet-command runtime, the team frame, restart and the debrief run
//! unchanged. Content lives in `assets/gameplay/scenarios/`.
use crate::{
    admiral::{Directives, escort, group_stations, members},
    battle::{Battle, BattleSetup, ShipSetup, Spawn},
    bots::AiLevel,
    catalog::Catalog,
    formations::{StationClass, formation_stations},
    mission::MissionRules,
    navigation::{Formation, Movement, WeaponsPolicy},
    pve::{FleetShip, GroupStation, PvePlan, Random, TaskGroup, member_order},
    rules::{TICK_RATE, TeamId, mix32},
    vessel::Controller,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use ts_rs::TS;

/// The raid's single task group.
pub const RAID_GROUP_ID: &str = "raid";
/// How often the raid commander reconsiders, in ticks.
const RAID_CADENCE_TICKS: u64 = 120;
/// A waypoint counts as reached once the raid's guide passes this close.
const WAYPOINT_REACHED_M: f64 = 1500.0;
/// Guns stay tight this long after the raid first sights the enemy, so its
/// torpedoes go first and its flashes do not give it away.
const SILENT_APPROACH_SECONDS: u64 = 90;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Scenario {
    pub version: u32,
    pub id: String,
    pub map_id: String,
    /// A `times` preset from the battle conditions.
    pub time_of_day: String,
    /// Weather presets, one drawn per battle from the seed.
    pub weather: Vec<String>,
    /// Trusted mission rules; the catalog registers them under their own id.
    pub mission: MissionRules,
    pub groups: Vec<ScenarioGroup>,
    pub raid: Raid,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScenarioShip {
    pub id: String,
    pub preset_id: String,
}
/// One of the owner's task groups: where its guide starts and what it was
/// doing when the scenario opens. Followers take their formation stations.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScenarioGroup {
    pub id: String,
    pub name: String,
    pub formation: Formation,
    pub guide: Spawn,
    pub ships: Vec<ScenarioShip>,
    pub orders: OpeningOrders,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum OpeningOrders {
    /// Steam a closed circuit at a set speed (physical metres per second).
    Patrol {
        waypoints: Vec<[f64; 2]>,
        speed_mps: f64,
    },
    /// Keep station around the guide's starting position.
    Hold { radius_m: f64 },
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Raid {
    pub group_name: String,
    pub formation: Formation,
    pub entry: Spawn,
    /// Ways out of the area. A withdrawing raid makes for the nearest, and a
    /// raider within `exit_radius_m` of it has left the battle.
    pub exits: Vec<[f64; 2]>,
    pub exit_radius_m: f64,
    /// The column steams at this fraction of its slowest ship's top speed.
    pub speed_fraction: f64,
    pub forces: RaidForces,
    pub plans: Vec<RaidPlan>,
    /// The share of its tonnage the raid will lose before it breaks off: a
    /// value between the two, drawn per battle.
    pub break_fraction: [f64; 2],
    /// A raid that has to be clear by dawn turns for home with this many
    /// seconds in hand over its straight run to the exit.
    pub dawn_margin_seconds: f64,
}
/// The raid's ships at each difficulty, which also sets their crews.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RaidForces {
    pub easy: Vec<ScenarioShip>,
    pub normal: Vec<ScenarioShip>,
    pub hard: Vec<ScenarioShip>,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RaidPlan {
    pub id: String,
    pub weight: u32,
    /// The raid's course from its entry, in order.
    pub route: Vec<[f64; 2]>,
    /// Seconds the raid stays at the end of its route before withdrawing.
    pub hold_seconds: u64,
    /// A bold plan stays for its objective whatever the clock says.
    pub presses_past_dawn: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScenarioRequest {
    pub version: u32,
    pub scenario_id: String,
    pub seed: u32,
    pub difficulty: AiLevel,
}
/// What the owner knows before battle: the conditions, the clock, what to
/// protect and their own opening orders. Nothing about the raid.
#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioBriefing {
    pub id: String,
    pub time_of_day: String,
    pub weather: String,
    #[ts(type = "number")]
    pub duration_seconds: u64,
    pub protected_ship_ids: Vec<String>,
    pub openings: Vec<GroupOpening>,
}
#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct GroupOpening {
    pub group_id: String,
    pub orders: OpeningOrders,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum WithdrawReason {
    /// The raid finished its plan.
    Completed,
    /// The raid lost more than it was willing to.
    Losses,
    /// The raid turned for home to be clear by dawn.
    Dawn,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RaidPhase {
    Advance,
    Strike { since_tick: u64 },
    Withdraw(WithdrawReason),
}
/// The raid commander's plan and its progress through it. Deterministic: it
/// reads only the battle's own state, on a fixed tick cadence.
#[derive(Clone, Debug)]
pub struct RaidScript {
    plan: RaidPlan,
    exits: Vec<[f64; 2]>,
    /// The exit chosen when the raid turned for home.
    exit: Option<[f64; 2]>,
    exit_radius_m: f64,
    speed_fraction: f64,
    break_fraction: f64,
    dawn_margin_seconds: f64,
    original_kg: f64,
    next_waypoint: usize,
    phase: RaidPhase,
    /// Latched once the raid has fired torpedoes, been hit, or held its guns
    /// long enough after first sighting the enemy.
    guns_free: bool,
    first_sighting: Option<u64>,
}
/// A scenario's frozen choices: what was drawn from the seed, and the owner's
/// opening orders.
#[derive(Clone, Debug)]
pub struct ScenarioPlan {
    pub id: String,
    pub weather: String,
    openings: Vec<(String, OpeningOrders, Spawn)>,
    protected: Vec<String>,
    pub(crate) script: RaidScript,
    initial: RaidScript,
}

impl Scenario {
    /// Shape checks that need no ship definitions: a browser worker's manifest
    /// carries only the designs its battle admits, so presets are checked when
    /// a scenario is generated.
    pub fn validate(&self) -> Result<(), String> {
        let valid_point = |p: &[f64; 2]| p.iter().all(|n| n.is_finite() && n.abs() <= 40000.0);
        let valid_spawn = |s: &Spawn| valid_point(&[s.x, s.z]) && s.heading.is_finite();
        let raid = &self.raid;
        let forces = [&raid.forces.easy, &raid.forces.normal, &raid.forces.hard];
        let owned = self.groups.iter().flat_map(|g| &g.ships).map(|s| &s.id);
        let fail = !(self.version == 1
            && !self.id.is_empty()
            && self.id.len() <= 64
            && !self.weather.is_empty()
            && self.mission.timeout == crate::mission::TimeoutPolicy::VictoryPoints
            && self.mission.duration_seconds.is_some()
            && !self.groups.is_empty()
            && self.groups.len() <= 9
            && self.groups.iter().all(|g| {
                !g.ships.is_empty()
                    && g.id != RAID_GROUP_ID
                    && valid_spawn(&g.guide)
                    && match &g.orders {
                        OpeningOrders::Patrol {
                            waypoints,
                            speed_mps,
                        } => {
                            (2..=crate::navigation::MAX_WAYPOINTS).contains(&waypoints.len())
                                && waypoints.iter().all(valid_point)
                                && (1.0..=20.0).contains(speed_mps)
                        }
                        OpeningOrders::Hold { radius_m } => (200.0..=5000.0).contains(radius_m),
                    }
            })
            && ids_unique(self.groups.iter().map(|g| &g.id))
            && ids_unique(owned.clone())
            && forces.iter().all(|f| {
                !f.is_empty() && ids_unique(f.iter().map(|s| &s.id).chain(owned.clone()))
            })
            && valid_spawn(&raid.entry)
            && (1..=4).contains(&raid.exits.len())
            && raid.exits.iter().all(valid_point)
            && (500.0..=10000.0).contains(&raid.exit_radius_m)
            && (0.3..=1.0).contains(&raid.speed_fraction)
            && (0.0..=1.0).contains(&raid.break_fraction[0])
            && (raid.break_fraction[0]..=1.0).contains(&raid.break_fraction[1])
            && (0.0..=1800.0).contains(&raid.dawn_margin_seconds)
            && !raid.plans.is_empty()
            && raid.plans.iter().all(|p| {
                p.weight > 0
                    && (1..crate::navigation::MAX_WAYPOINTS).contains(&p.route.len())
                    && p.route.iter().all(valid_point)
                    && p.hold_seconds <= 3600
            })
            && self.mission.objective.as_ref().is_some_and(|o| {
                o.protected_ship_ids.iter().all(|id| {
                    self.groups
                        .iter()
                        .flat_map(|g| &g.ships)
                        .any(|s| &s.id == id)
                })
            }));
        if fail {
            return Err(format!("Invalid scenario {:?}", self.id));
        }
        Ok(())
    }
}
fn ids_unique<'a>(ids: impl Iterator<Item = &'a String>) -> bool {
    let mut seen = BTreeSet::new();
    ids.into_iter().all(|id| {
        !id.is_empty()
            && id.len() <= 64
            && id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
            && seen.insert(id)
    })
}

/// Lay a group out on its formation stations around the guide's spawn, turned
/// to the guide's heading. The heaviest ship guides, as `admiral::members`
/// makes it.
fn place_group(
    catalog: &Catalog,
    formation: Formation,
    guide: &Spawn,
    ships: &[ScenarioShip],
) -> Result<Vec<(ScenarioShip, Spawn)>, String> {
    let definition = |s: &ScenarioShip| {
        catalog
            .definitions
            .get(&s.preset_id)
            .ok_or_else(|| format!("Scenario ship {:?} has no design {:?}", s.id, s.preset_id))
    };
    for ship in ships {
        definition(ship)?;
    }
    let mut ordered: Vec<_> = ships.to_vec();
    ordered.sort_by(|a, b| {
        member_order(
            (&catalog.definitions[&a.preset_id], &a.id),
            (&catalog.definitions[&b.preset_id], &b.id),
        )
    });
    let class = |s: &ScenarioShip| StationClass::of(&catalog.definitions[&s.preset_id]);
    let followers: Vec<_> = ordered[1..]
        .iter()
        .map(|s| (s.id.clone(), class(s)))
        .collect();
    let stations = formation_stations(formation, (&ordered[0].id, class(&ordered[0])), &followers);
    let (sin, cos) = guide.heading.sin_cos();
    Ok(ordered
        .into_iter()
        .map(|ship| {
            let [starboard, aft] = stations
                .iter()
                .find(|s| s.id == ship.id)
                .map_or([0.0, 0.0], |s| s.offset);
            let spawn = Spawn {
                x: guide.x + cos * starboard - sin * aft,
                z: guide.z + sin * starboard + cos * aft,
                heading: guide.heading,
            };
            (ship, spawn)
        })
        .collect())
}

impl PvePlan {
    /// Build the fixed order of battle for a scenario and draw the raid's
    /// plan, weather and resolve from the seed.
    pub fn scenario(catalog: &Catalog, request: ScenarioRequest) -> Result<Self, String> {
        if request.version != 1
            || !matches!(
                request.difficulty,
                AiLevel::Easy | AiLevel::Normal | AiLevel::Hard
            )
        {
            return Err("Choose a supported scenario version and difficulty".into());
        }
        let scenario = catalog
            .scenarios
            .get(&request.scenario_id)
            .ok_or("Unknown scenario")?;
        let mission = catalog
            .missions
            .get(&scenario.mission.id)
            .ok_or("Scenario mission content is unavailable")?
            .clone();
        let mut random = Random(mix32(request.seed ^ 0x5343_454e));
        let weather = scenario.weather[random.index(scenario.weather.len())].clone();
        let total: u32 = scenario.raid.plans.iter().map(|p| p.weight).sum();
        let mut pick = random.next() % total;
        let plan = scenario
            .raid
            .plans
            .iter()
            .find(|p| {
                let hit = pick < p.weight;
                pick = pick.saturating_sub(p.weight);
                hit
            })
            .unwrap()
            .clone();
        let [low, high] = scenario.raid.break_fraction;
        let break_fraction = low + (high - low) * random.unit();

        let mut ships = vec![];
        let mut groups = vec![];
        let mut assignments = vec![];
        let mut openings = vec![];
        for group in &scenario.groups {
            for (ship, spawn) in place_group(catalog, group.formation, &group.guide, &group.ships)?
            {
                assignments.push(FleetShip {
                    id: ship.id.clone(),
                    preset_id: ship.preset_id.clone(),
                    group_id: group.id.clone(),
                });
                ships.push(ShipSetup {
                    id: ship.id,
                    preset_id: ship.preset_id,
                    team: TeamId::A,
                    controller: Controller::Bot,
                    ai_level: AiLevel::Normal,
                    spawn: Some(spawn),
                });
            }
            groups.push(TaskGroup {
                id: group.id.clone(),
                name: group.name.clone(),
                station: GroupStation::Front,
                formation: Some(group.formation),
            });
            openings.push((group.id.clone(), group.orders.clone(), group.guide.clone()));
        }
        let raid = &scenario.raid;
        let forces = match request.difficulty {
            AiLevel::Easy => &raid.forces.easy,
            AiLevel::Hard => &raid.forces.hard,
            _ => &raid.forces.normal,
        };
        let mut enemy_assignments = vec![];
        let mut original_kg = 0.0;
        for (ship, spawn) in place_group(catalog, raid.formation, &raid.entry, forces)? {
            original_kg += catalog.definitions[&ship.preset_id].hull.mass_kg;
            enemy_assignments.push(FleetShip {
                id: ship.id.clone(),
                preset_id: ship.preset_id.clone(),
                group_id: RAID_GROUP_ID.into(),
            });
            ships.push(ShipSetup {
                id: ship.id,
                preset_id: ship.preset_id,
                team: TeamId::B,
                controller: Controller::Bot,
                ai_level: request.difficulty,
                spawn: Some(spawn),
            });
        }
        let ids = |team: TeamId| {
            ships
                .iter()
                .filter(|s| s.team == team)
                .map(|s| s.preset_id.clone())
                .collect::<Vec<_>>()
        };
        let totals = mission.budget.resolve(&ids(TeamId::A), catalog)?;
        mission.budget.resolve(&ids(TeamId::B), catalog)?;
        let selected: BTreeSet<_> = ships.iter().map(|s| &s.preset_id).collect();
        let identities = catalog
            .identities
            .iter()
            .filter(|id| selected.contains(&id.id))
            .cloned()
            .collect();
        let script = RaidScript {
            plan,
            exits: raid.exits.clone(),
            exit: None,
            exit_radius_m: raid.exit_radius_m,
            speed_fraction: raid.speed_fraction,
            break_fraction,
            dawn_margin_seconds: raid.dawn_margin_seconds,
            original_kg,
            next_waypoint: 0,
            phase: RaidPhase::Advance,
            guns_free: false,
            first_sighting: None,
        };
        Ok(Self {
            setup: BattleSetup {
                ships,
                seed: request.seed,
                map_id: scenario.map_id.clone(),
                weather: weather.clone(),
                spawn_distance: 16000.0,
                wind_speed: None,
                time_of_day: Some(scenario.time_of_day.clone()),
                air_rules: Some(catalog.air_profiles[&mission.air_profile_id].clone()),
                mission_rules: Some(mission.clone()),
            },
            groups,
            assignments,
            enemy_groups: vec![TaskGroup {
                id: RAID_GROUP_ID.into(),
                name: raid.group_name.clone(),
                station: GroupStation::Front,
                formation: Some(raid.formation),
            }],
            enemy_assignments,
            identities,
            totals,
            scenario: Some(ScenarioPlan {
                id: scenario.id.clone(),
                weather,
                openings,
                protected: mission
                    .objective
                    .as_ref()
                    .map_or(vec![], |o| o.protected_ship_ids.clone()),
                initial: script.clone(),
                script,
            }),
        })
    }
}

impl ScenarioPlan {
    pub fn briefing(&self, setup: &BattleSetup) -> ScenarioBriefing {
        ScenarioBriefing {
            id: self.id.clone(),
            time_of_day: setup.time_of_day.clone().unwrap_or_default(),
            weather: self.weather.clone(),
            duration_seconds: setup
                .mission_rules
                .as_ref()
                .and_then(|m| m.duration_seconds)
                .unwrap_or(0),
            protected_ship_ids: self.protected.clone(),
            openings: self
                .openings
                .iter()
                .map(|(group_id, orders, _)| GroupOpening {
                    group_id: group_id.clone(),
                    orders: orders.clone(),
                })
                .collect(),
        }
    }
    /// A restarted battle starts the raid's plan over.
    pub fn reset(&mut self) {
        self.script = self.initial.clone();
    }
    /// The owner's opening order for a group's guide.
    pub(crate) fn opening(&self, group_id: &str) -> Option<Movement> {
        let (_, orders, guide) = self.openings.iter().find(|(id, ..)| id == group_id)?;
        Some(match orders {
            OpeningOrders::Patrol {
                waypoints,
                speed_mps,
            } => Movement::Route {
                waypoints: waypoints.clone(),
                speed_mps: *speed_mps,
                looped: true,
            },
            OpeningOrders::Hold { radius_m } => Movement::HoldArea {
                position: [guide.x, guide.z],
                radius_m: *radius_m,
            },
        })
    }
    /// The raid's standing weapons: torpedoes free throughout, guns tight on
    /// the silent approach. The owner's ships keep the fleet default.
    pub fn raid_weapons(&self) -> WeaponsPolicy {
        WeaponsPolicy {
            guns: self.script.guns_free,
            aa: true,
            torpedoes: true,
        }
    }
    pub fn debrief(&self, battle: &Battle) -> serde_json::Value {
        let score = battle
            .mission_rules
            .as_ref()
            .and_then(|m| m.objective.as_ref())
            .map(|objective| {
                crate::mission::score(
                    &battle.actors,
                    &battle.withdrawn,
                    objective,
                    battle
                        .outcome
                        .as_ref()
                        .is_some_and(|o| o.reason == crate::rules::FinishReason::TimeLimit),
                )
            });
        let withdrawal = match self.script.phase {
            RaidPhase::Withdraw(reason) => Some(reason),
            _ => None,
        };
        serde_json::json!({
            "id": self.id,
            "weather": self.weather,
            "plan": self.script.plan.id,
            "withdrawal": withdrawal,
            "score": score,
        })
    }
}

impl RaidScript {
    /// The raid's orders for this tick, or none between decisions.
    pub(crate) fn directives(&mut self, plan: &PvePlan, battle: &Battle) -> Directives {
        let mut orders = Directives::new();
        if !battle.tick.is_multiple_of(RAID_CADENCE_TICKS) {
            return orders;
        }
        let Some(group) = plan.enemy_groups.iter().find(|g| g.id == RAID_GROUP_ID) else {
            return orders;
        };
        let ships = members(battle, &plan.enemy_assignments, group, TeamId::B);
        let Some(leader) = ships.first() else {
            return orders;
        };
        let slowest = ships
            .iter()
            .map(|a| a.definition().handling.forward_speed)
            .fold(f64::INFINITY, f64::min);
        let speed = slowest * self.speed_fraction;
        let withdraw_speed = slowest * (self.speed_fraction + 0.1).min(0.95);
        let here = [leader.motion.x, leader.motion.z];
        let distance = |p: [f64; 2]| (p[0] - here[0]).hypot(p[1] - here[1]);
        let nearest_exit = self
            .exits
            .iter()
            .copied()
            .min_by(|a, b| distance(*a).total_cmp(&distance(*b)))
            .unwrap();
        if !self.guns_free {
            let raiders = || {
                battle.actors.iter().filter(|a| {
                    a.team == TeamId::B
                        && plan.enemy_assignments.iter().any(|s| s.id == a.motion.id)
                })
            };
            if self.first_sighting.is_none()
                && battle
                    .sensors
                    .iter_contacts(TeamId::B)
                    .any(|c| c.kind == crate::sensors::ContactKind::Surface)
            {
                self.first_sighting = Some(battle.tick);
            }
            let torpedoes_away = battle
                .torpedoes
                .iter()
                .any(|t| raiders().any(|a| a.motion.id == t.owner_id));
            let hit = raiders().any(|a| a.damage.integrity < a.damage.max_integrity);
            let waited = self
                .first_sighting
                .is_some_and(|t| battle.tick - t >= SILENT_APPROACH_SECONDS * TICK_RATE);
            self.guns_free = torpedoes_away || hit || waited;
        }
        if !matches!(self.phase, RaidPhase::Withdraw(_)) {
            let remaining_kg: f64 = ships.iter().map(|a| a.definition().hull.mass_kg).sum();
            let remaining_seconds = battle
                .mission_rules
                .as_ref()
                .and_then(|m| m.remaining_seconds(battle.tick))
                .unwrap_or(f64::INFINITY);
            let run_home =
                distance(nearest_exit) / (withdraw_speed * crate::mobility::SHIP_PACE).max(1.0);
            if remaining_kg < self.original_kg * (1.0 - self.break_fraction) {
                self.phase = RaidPhase::Withdraw(WithdrawReason::Losses);
            } else if !self.plan.presses_past_dawn
                && remaining_seconds < run_home + self.dawn_margin_seconds
            {
                self.phase = RaidPhase::Withdraw(WithdrawReason::Dawn);
            }
        }
        if self.phase == RaidPhase::Advance {
            while self
                .plan
                .route
                .get(self.next_waypoint)
                .is_some_and(|p| distance(*p) < WAYPOINT_REACHED_M)
            {
                self.next_waypoint += 1;
            }
            if self.next_waypoint >= self.plan.route.len() {
                self.phase = if self.plan.hold_seconds > 0 {
                    RaidPhase::Strike {
                        since_tick: battle.tick,
                    }
                } else {
                    RaidPhase::Withdraw(WithdrawReason::Completed)
                };
            }
        }
        if let RaidPhase::Strike { since_tick } = self.phase
            && battle.tick - since_tick >= self.plan.hold_seconds * TICK_RATE
        {
            self.phase = RaidPhase::Withdraw(WithdrawReason::Completed);
        }
        if matches!(self.phase, RaidPhase::Withdraw(_)) && self.exit.is_none() {
            self.exit = Some(nearest_exit);
        }
        let movement = match self.phase {
            RaidPhase::Advance => Movement::Route {
                waypoints: self.plan.route[self.next_waypoint..].to_vec(),
                speed_mps: speed,
                looped: false,
            },
            RaidPhase::Strike { .. } => Movement::HoldArea {
                position: *self.plan.route.last().unwrap(),
                radius_m: 1500.0,
            },
            RaidPhase::Withdraw(_) => Movement::Route {
                waypoints: vec![self.exit.unwrap_or(nearest_exit)],
                speed_mps: withdraw_speed,
                looped: false,
            },
        };
        orders.insert(leader.motion.id.clone(), (movement, None));
        let (formation, stations) = group_stations(group, &ships);
        for ship in ships.iter().skip(1) {
            if let Some(station) = stations.iter().find(|s| s.id == ship.motion.id) {
                orders.insert(
                    ship.motion.id.clone(),
                    (escort(ship, leader, plan, formation, station), None),
                );
            }
        }
        orders
    }
    /// Afloat raiders that have reached the exit on their way home.
    pub(crate) fn withdrawals(&self, plan: &PvePlan, battle: &Battle) -> Vec<String> {
        let Some(exit) = self.exit else {
            return vec![];
        };
        battle
            .actors
            .iter()
            .filter(|a| {
                a.team == TeamId::B
                    && a.physical_loss().is_none()
                    && plan.enemy_assignments.iter().any(|s| s.id == a.motion.id)
                    && (a.motion.x - exit[0]).hypot(a.motion.z - exit[1]) <= self.exit_radius_m
            })
            .map(|a| a.motion.id.clone())
            .collect()
    }
}
