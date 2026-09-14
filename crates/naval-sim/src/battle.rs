//! Complete renderer-free fixed-tick battle authority, shared by native and WASM.
use crate::mobility::torpedo_speed;
pub use crate::navigation::Movement;
use crate::navigation::{self, NavigationState, WeaponsPolicy};
use crate::{
    aircraft::{AirOrder, AirRelease},
    aviation::Aviation,
    aviation_step::AirContext,
    bots::{self, AiLevel, BotState},
    capability,
    catalog::Catalog,
    collisions::HullImpact,
    depth_charges::{self, DepthCharge},
    environment::{Island, SeaState, avoid_land},
    geometry::*,
    gunnery::{self, GunneryContext, PlayerGunOrders},
    impact::{DamageEvent, DepthChargeEffect, TorpedoEffect},
    machinery::system_health,
    motion::{HelmCommand, step_ship},
    rules::{self, DT, Outcome, Rules, Survivor, TeamId},
    shell::Shell,
    torpedoes::{self, Torpedo},
    vessel::{CompiledShip, Controller, Vessel},
};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, sync::Arc};
#[derive(Clone, Debug, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Spawn {
    pub x: f64,
    pub z: f64,
    pub heading: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShipSetup {
    pub id: String,
    pub preset_id: String,
    pub team: TeamId,
    pub controller: Controller,
    pub ai_level: AiLevel,
    pub spawn: Option<Spawn>,
}
#[derive(Clone, Debug, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BattleSetup {
    pub ships: Vec<ShipSetup>,
    pub seed: u32,
    pub map_id: String,
    pub weather: String,
    pub spawn_distance: f64,
    pub wind_speed: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub mission_rules: Option<crate::mission::MissionRules>,
    /// Omitted legacy setups explicitly resolve legacy-air-v1 from installed content.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub air_rules: Option<crate::air_rules::AirRules>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Orders {
    pub helm: Option<HelmCommand>,
    pub guns: Option<PlayerGunOrders>,
    pub movement: Movement,
    pub target_id: Option<String>,
    pub control: Option<(String, String)>,
    #[serde(default)]
    pub weapons: WeaponsPolicy,
    #[serde(default)]
    pub formation_policy: navigation::FormationPolicy,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub sequence: u64,
    pub tick: u64,
    #[serde(flatten)]
    pub data: DamageEvent,
}
/// Geometry and terrain are shared; battle state owns mutable instances only.
pub struct Battle {
    pub records: crate::records::Records,
    pub catalog: Arc<Catalog>,
    pub actors: Vec<Vessel>,
    pub aviation: Aviation,
    pub shells: Vec<Shell>,
    pub torpedoes: Vec<Torpedo>,
    pub depth_charges: Vec<DepthCharge>,
    pub air_releases: Vec<AirRelease>,
    /// Ring buffer: the bound drops the oldest event, which on a `Vec` moved
    /// the whole 128-entry window on every emission. `VecDeque` serialises as
    /// the same JSON array, in the same order.
    pub events: std::collections::VecDeque<Event>,
    /// Ring buffers, for the same reason.
    pub(crate) team_events: [std::collections::VecDeque<Event>; 2],
    team_event_sequence: [u64; 2],
    pub tick: u64,
    pub outcome: Option<Outcome>,
    pub seed: u32,
    pub sea: SeaState,
    pub islands: Vec<Island>,
    pub map_id: String,
    pub sequence: i64,
    pub dispersion: u32,
    pub mission_rules: Option<crate::mission::MissionRules>,
    event_sequence: u64,
    pub sensors: crate::sensors::Sensors,
    navigation_reports: [Vec<crate::sensors::ContactTrack>; 2],
    pub(crate) visual_conditions: crate::sensors::VisualConditions,
    visual_rules: crate::sensors::VisualRules,
    /// PvE simulation cadence, loaded from content. `PER_TICK` for every battle
    /// without mission rules, so custom battles and the server never sample it.
    cadence: crate::mission::SimulationCadence,
    displacement: Vec<u64>,
    rules: Rules,
    /// Every actor's recorded track and formation axis, kept outside navigation
    /// state so manual helm, bots and standing orders all leave a wake to follow.
    pub trails: navigation::Trails,
    /// Reused per-tick scratch: the projectile ids still in flight, sorted.
    active_projectiles: Vec<i64>,
}
impl Battle {
    pub fn new(
        catalog: Arc<Catalog>,
        compiled: &BTreeMap<String, Arc<CompiledShip>>,
        setup: BattleSetup,
    ) -> Result<Self, String> {
        let counts = [TeamId::A, TeamId::B]
            .map(|team| setup.ships.iter().filter(|s| s.team == team).count());
        if counts.iter().any(|n| !(1..=30).contains(n)) {
            return Err("Choose one to 30 ships per side".into());
        }
        if let Some(mission) = &setup.mission_rules {
            mission.validate_selection(&catalog)?;
            for team in [TeamId::A, TeamId::B] {
                mission.budget.resolve(
                    &setup
                        .ships
                        .iter()
                        .filter(|s| s.team == team)
                        .map(|s| s.preset_id.clone())
                        .collect::<Vec<_>>(),
                    &catalog,
                )?;
            }
        }
        let environment = if let Some(rules) = &setup.mission_rules {
            catalog.resolve_pve_environment(
                &setup.map_id,
                &setup.weather,
                setup.seed,
                rules,
                setup.wind_speed,
            )
        } else {
            catalog.resolve_environment(
                &setup.map_id,
                &setup.weather,
                setup.seed,
                *counts.iter().max().unwrap(),
                setup.spawn_distance,
                setup.wind_speed,
            )
        }
        .map_err(|e| e.to_string())?;
        let mut actors = vec![];
        let mut slots = [0usize; 2];
        let mut displacement = vec![];
        for ship in setup.ships {
            if ship.id.is_empty()
                || ship.id.len() > 128
                || actors.iter().any(|a: &Vessel| a.motion.id == ship.id)
            {
                return Err("Invalid ship instance identity".into());
            }
            let content = compiled
                .get(&ship.preset_id)
                .ok_or("Unknown ship preset")?
                .clone();
            let mut a = Vessel::new(ship.id, ship.team, content);
            a.preset_id = ship.preset_id.clone();
            a.controller = ship.controller;
            // Keep dormant bot memory on player ships so changing control does not reset crews.
            a.bot = Some(BotState::new(
                &a.motion.id,
                a.definition(),
                setup.seed,
                ship.ai_level,
            ));
            let slot = slots[ship.team.index()];
            slots[ship.team.index()] += 1;
            let offset = if slot == 0 {
                0.0
            } else {
                slot.div_ceil(2) as f64 * if slot % 2 == 1 { 1.0 } else { -1.0 }
            };
            let p = ship.spawn.unwrap_or(Spawn {
                x: offset * 650.0,
                z: if ship.team == TeamId::A {
                    0.0
                } else {
                    -setup.spawn_distance
                },
                heading: if ship.team == TeamId::A {
                    0.0
                } else {
                    std::f64::consts::PI
                },
            });
            if ![p.x, p.z, p.heading].iter().all(|n| n.is_finite())
                || setup.mission_rules.as_ref().is_some_and(|m| {
                    !m.area
                        .contains([p.x, p.z], a.definition().hull.length / 2.0)
                })
                || p.x.abs() > 40000.0
                || p.z.abs() > 40000.0
                || actors
                    .iter()
                    .any(|a: &Vessel| (a.motion.x - p.x).hypot(a.motion.z - p.z) < 350.0)
            {
                return Err("Invalid fleet deployment".into());
            }
            if environment.islands.iter().any(|i| {
                let mut expanded = i.clone();
                expanded.rx += 250.0;
                expanded.rz += 250.0;
                expanded.radius(p.x, p.z) <= 1.05
            }) {
                return Err("Deployment is too close to land".into());
            }
            a.motion.x = p.x;
            a.motion.z = p.z;
            a.motion.heading = p.heading;
            displacement.push(catalog.fleet_entries[&ship.preset_id].displacement_kg);
            actors.push(a);
        }
        let air_profile_id = setup
            .mission_rules
            .as_ref()
            .map_or("legacy-air-v1", |m| m.air_profile_id.as_str());
        let air_rules = setup
            .air_rules
            .unwrap_or_else(|| catalog.air_profiles[air_profile_id].clone());
        air_rules.validate_selection(&catalog)?;
        if setup.mission_rules.is_some() && air_rules.id != air_profile_id {
            return Err("Air operations profile does not match the mission".into());
        }
        let mut aviation = Aviation::with_rules(&actors, catalog.aircraft.clone(), air_rules)?;
        aviation.airspace = setup.mission_rules.as_ref().map(|m| m.area.clone());
        let visual_conditions =
            crate::sensors::VisualConditions::resolve(&catalog, &setup.map_id, &setup.weather);
        let cadence = match setup.mission_rules {
            Some(_) => {
                let cadence = crate::mission::SimulationCadence::default();
                cadence.validate()?;
                cadence
            }
            None => crate::mission::SimulationCadence::PER_TICK,
        };
        Ok(Self {
            records: Default::default(),
            catalog,
            actors,
            aviation,
            shells: vec![],
            torpedoes: vec![],
            depth_charges: vec![],
            air_releases: vec![],
            events: Default::default(),
            team_events: Default::default(),
            team_event_sequence: [0; 2],
            tick: 0,
            outcome: None,
            seed: setup.seed,
            sea: environment.sea,
            islands: environment.islands,
            map_id: setup.map_id,
            sequence: 0,
            dispersion: 0,
            event_sequence: 0,
            displacement,
            rules: Rules::default(),
            trails: Default::default(),
            mission_rules: setup.mission_rules,
            sensors: Default::default(),
            navigation_reports: Default::default(),
            visual_conditions,
            visual_rules: Default::default(),
            cadence,
            active_projectiles: vec![],
        })
    }
    /// The cadence this battle runs on: content for a mission, `PER_TICK` for
    /// every custom battle and every server match.
    pub fn cadence(&self) -> crate::mission::SimulationCadence {
        self.cadence
    }
    /// Test and diagnostic seam only: nothing on the client or protocol side can
    /// reach it, so a PvE cadence stays a property of installed content.
    #[doc(hidden)]
    pub fn set_cadence(
        &mut self,
        cadence: crate::mission::SimulationCadence,
    ) -> Result<(), String> {
        cadence.validate()?;
        self.cadence = cadence;
        Ok(())
    }
    pub fn survivors(&self) -> Vec<Survivor> {
        self.actors
            .iter()
            .enumerate()
            .map(|(i, a)| Survivor {
                team: a.team,
                displacement_kg: self.displacement[i],
                physical_loss: a.physical_loss(),
            })
            .collect()
    }
    pub fn command_air(&mut self, actor_id: &str, flight: &str, order: AirOrder) -> bool {
        if self.outcome.is_some() {
            return false;
        }
        let Some(a) = self.actors.iter().find(|a| a.motion.id == actor_id) else {
            return false;
        };
        use crate::sensors::{Affiliation, ContactKind};
        match &order {
            AirOrder::Strike { contact_id } | AirOrder::InterceptContact { contact_id } => {
                if self.mission_rules.is_none()
                    || self.sensors.contact(a.team, contact_id).is_none_or(|c| {
                        c.affiliation != Affiliation::Hostile
                            || c.kind
                                != if matches!(order, AirOrder::Strike { .. }) {
                                    ContactKind::Surface
                                } else {
                                    ContactKind::Aircraft
                                }
                    })
                {
                    return false;
                }
            }
            // Omniscient compatibility commands cannot bypass PvE observations.
            AirOrder::Attack { .. } | AirOrder::Intercept { .. }
                if self.mission_rules.is_some() =>
            {
                return false;
            }
            _ => {}
        }
        self.aviation.command_squadron(
            a,
            flight,
            order,
            &self.actors,
            Some((&self.sea, self.tick as f64 * DT)),
        )
    }
    fn emit(&mut self, event: DamageEvent) {
        if self.mission_rules.is_some() {
            for team in [TeamId::A, TeamId::B] {
                if let Some(data) = self.observed_event(&event, team) {
                    if event.kind == "sunk" {
                        self.sensors
                            .confirm_sinking(team, &event.ship_id, self.tick);
                    } else if event.kind == "aircraft-lost"
                        && let Some(aircraft) = &event.aircraft
                    {
                        self.sensors.confirm_aircraft_loss(team, &aircraft.id);
                    }
                    self.team_event_sequence[team.index()] += 1;
                    let events = &mut self.team_events[team.index()];
                    events.push_back(Event {
                        sequence: self.team_event_sequence[team.index()],
                        tick: self.tick,
                        data,
                    });
                    if events.len() > 128 {
                        events.pop_front();
                    }
                }
            }
        }
        self.records.event(&event, self.tick, &self.actors);
        self.event_sequence += 1;
        self.events.push_back(Event {
            sequence: self.event_sequence,
            tick: self.tick,
            data: event,
        });
        if self.events.len() > 128 {
            self.events.pop_front();
        }
    }
    fn contacts(&mut self, impacts: Vec<HullImpact>) {
        for hit in impacts {
            let weapon = if hit.kind == "grounding" {
                "Grounding"
            } else {
                "Ramming"
            };
            if let Some(owner) = hit.other_id.as_ref().filter(|id| {
                let owner = self.actors.iter().find(|a| a.motion.id == **id);
                let victim = self.actors.iter().find(|a| a.motion.id == hit.actor_id);
                matches!((owner, victim), (Some(a), Some(b)) if a.team != b.team)
            }) {
                self.sequence += 1;
                self.records.hit(
                    owner,
                    &hit.actor_id,
                    self.sequence,
                    weapon,
                    hit.damage,
                    false,
                    self.tick,
                    &self.actors,
                );
            }
            self.emit(DamageEvent {
                kind: "contact".into(),
                ship_id: hit.actor_id,
                position: hit.position,
                hull_damage: Some(hit.damage),
                message: format!("{weapon} · {} hull damage", hit.damage),
                ..Default::default()
            })
        }
    }
    pub fn step(&mut self, orders: &BTreeMap<String, Orders>) {
        if self.outcome.is_some() {
            return;
        }
        self.records.begin_tick(&self.actors);
        // Record every actor's track before any captain reads it, so a follower
        // steers for water its guide has actually crossed.
        for a in &self.actors {
            let trail = self.trails.entry(a.motion.id.clone()).or_default();
            trail.record([a.motion.x, a.motion.z], a.motion.heading, a.motion.speed);
            trail.steady_axis(a.motion.heading, DT);
        }
        if self.mission_rules.is_some() && self.tick.is_multiple_of(self.visual_rules.cadence_ticks)
        {
            self.sensors.update(
                self.tick,
                &crate::sensors::entities(&self.actors, &self.aviation),
                &self.islands,
                &self.catalog.terrain,
                self.visual_conditions,
                &self.visual_rules,
            );
        }
        let time = self.tick as f64 * DT;
        // Sensors change on their fixed cadence; all captains share these
        // measured snapshots instead of cloning every report on every tick.
        if self.mission_rules.is_some() && self.tick.is_multiple_of(self.visual_rules.cadence_ticks)
        {
            self.navigation_reports = [
                self.sensors.contacts(rules::TeamId::A),
                self.sensors.contacts(rules::TeamId::B),
            ];
        }
        let navigation_contacts = self
            .mission_rules
            .as_ref()
            .map(|_| &self.navigation_reports);
        let capability_sweep = self.tick.is_multiple_of(self.cadence.capability_ticks);
        let mut commands = Vec::with_capacity(self.actors.len());
        // The actor stays in place: every callee here already skips the ship it
        // is steering (by identity or by team), so an index-based split shows
        // the same fleet in the same order without memmoving the whole vector
        // out and back twice a tick.
        for i in 0..self.actors.len() {
            let def = self.actors[i].compiled.definition.clone();
            self.actors[i].sea = Some((self.sea.clone(), time));
            let actor_id = self.actors[i].motion.id.clone();
            let team = self.actors[i].team;
            let wing = self.aviation.wing(&actor_id);
            // The post-damage call at the end of the previous tick already left
            // this state current; nothing between the two touches its inputs.
            // On the mission cadence the sweep is a refresh, not a dependency:
            // gunnery re-derives the disabled set from `combat_lost` and
            // magazine availability, and mission scoring reads raw state.
            if capability_sweep {
                capability::update(&mut self.actors[i], &def, wing);
            }
            let order = orders.get(&actor_id);
            let mut command = HelmCommand::default();
            if self.actors[i].physical_loss().is_some() {
                self.actors[i].target_id = None
            } else {
                let contact = if self.mission_rules.is_some() {
                    let mount = bots::battery_mount(&self.actors[i], false)
                        .or_else(|| bots::battery_mount(&self.actors[i], true))
                        .and_then(|m| def.mounts.iter().position(|d| std::ptr::eq(d, m)));
                    let position = [
                        self.actors[i].motion.x,
                        self.actors[i].motion.y,
                        self.actors[i].motion.z,
                    ];
                    let requested = order.and_then(|o| o.target_id.as_deref());
                    if let Some(mount) = mount {
                        self.sensors.battery_target(
                            team,
                            position,
                            &def.mounts[mount],
                            requested,
                            self.actors[i].target_id.as_deref(),
                        )
                    } else {
                        self.sensors.surface_target(
                            team,
                            position,
                            requested,
                            self.actors[i].target_id.as_deref(),
                        )
                    }
                } else {
                    None
                };
                let target = self
                    .mission_rules
                    .is_none()
                    .then(|| {
                        order
                            .and_then(|o| o.target_id.as_ref())
                            .and_then(|id| {
                                self.actors.iter().position(|a| {
                                    a.motion.id == *id
                                        && a.team != team
                                        && a.physical_loss().is_none()
                                })
                            })
                            .or_else(|| bots::target(&self.actors[i], &self.actors))
                    })
                    .flatten();
                if self.actors[i].controller == Controller::Bot
                    || order.is_some_and(|o| o.guns.is_none() || o.helm.is_none())
                {
                    let mut bot = self.actors[i].bot.take().unwrap();
                    if self.mission_rules.is_some() {
                        bot.update_contact(&self.actors[i], &def, contact, time);
                        command = bots::helm_contact(&bot, &self.actors[i], contact, &self.actors);
                    } else {
                        bot.update(
                            &self.actors[i],
                            &def,
                            target.map(|j| (&self.actors[j].state, self.actors[j].definition())),
                            time,
                        );
                        command = bots::helm(
                            &mut bot,
                            &self.actors[i],
                            target.map(|j| &self.actors[j]),
                            &self.actors,
                        );
                    }
                    if bot.ai_level != AiLevel::Static {
                        command = avoid_land(&self.actors[i].motion, command, &self.islands)
                    }
                    self.actors[i].bot = Some(bot);
                    let chosen = contact
                        .map(|c| c.id.clone())
                        .or_else(|| target.map(|j| self.actors[j].motion.id.clone()));
                    self.actors[i].target_id = chosen;
                }
                if let Some(o) = order {
                    if let Some(helm) = o.helm {
                        command = helm
                    } else {
                        match &o.movement {
                            Movement::Autonomous => {
                                if self.mission_rules.is_some() {
                                    let formation = navigation::formation_report(
                                        &self.actors[i],
                                        &self.actors,
                                        orders,
                                        o.formation_policy,
                                        &self.trails,
                                    );
                                    command.throttle = command.throttle.min(
                                        formation.speed_limit_mps
                                            / navigation::maximum_speed(&self.actors[i]).max(0.05),
                                    );
                                    let mut state = self.actors[i]
                                        .navigation
                                        .take()
                                        .filter(|s| s.order == o.movement)
                                        .unwrap_or_else(|| {
                                            NavigationState::new(o.movement.clone())
                                        });
                                    state.status = if !formation.stragglers.is_empty()
                                        && o.formation_policy
                                            == navigation::FormationPolicy::SlowForStragglers
                                    {
                                        navigation::NavigationStatus::SlowingForStragglers
                                    } else {
                                        navigation::NavigationStatus::FollowingRoute
                                    };
                                    state.formation = Some(formation);
                                    self.actors[i].navigation = Some(state);
                                }
                            }
                            Movement::Hold => command = HelmCommand::default(),
                            Movement::Move { position: [x, z] } => {
                                let motion = &self.actors[i].motion;
                                let distance = (x - motion.x).hypot(z - motion.z);
                                let angle =
                                    wrap_angle((x - motion.x).atan2(motion.z - z) - motion.heading);
                                command = avoid_land(
                                    &self.actors[i].motion,
                                    HelmCommand {
                                        throttle: if distance < 80.0 {
                                            0.0
                                        } else {
                                            (distance / 800.0).clamp(0.2, 0.8)
                                        },
                                        rudder: clamp(angle * 2.0, -1.0, 1.0),
                                        ..Default::default()
                                    },
                                    &self.islands,
                                )
                            }
                            Movement::Route { .. }
                            | Movement::HoldArea { .. }
                            | Movement::Escort { .. } => {
                                let mut state = self.actors[i]
                                    .navigation
                                    .take()
                                    .unwrap_or_else(|| NavigationState::new(o.movement.clone()));
                                let speed_limit = self.actors.iter().filter(|a| a.motion.id != actor_id && a.team == team && a.physical_loss().is_none())
                                    .filter(|a| orders.get(&a.motion.id).is_some_and(|o|
                                        matches!(&o.movement, Movement::Escort { leader_id, .. } if leader_id == &actor_id)))
                                    .map(|a| a.definition().handling.forward_speed * 0.85)
                                    .fold(def.handling.forward_speed, f64::min);
                                let formation = self.mission_rules.as_ref().map(|_| {
                                    navigation::formation_report(
                                        &self.actors[i],
                                        &self.actors,
                                        orders,
                                        o.formation_policy,
                                        &self.trails,
                                    )
                                });
                                let speed_limit = formation
                                    .as_ref()
                                    .map_or(speed_limit, |f| f.speed_limit_mps);
                                command = navigation::command_observed(
                                    &self.actors[i],
                                    &self.actors,
                                    &self.islands,
                                    &o.movement,
                                    &mut state,
                                    self.tick,
                                    speed_limit,
                                    &self.trails,
                                    navigation_contacts
                                        .as_ref()
                                        .map(|reports| reports[team.index()].as_slice()),
                                );
                                if formation.as_ref().is_some_and(|f| !f.stragglers.is_empty())
                                    && o.formation_policy
                                        == navigation::FormationPolicy::SlowForStragglers
                                    && state.status == navigation::NavigationStatus::FollowingRoute
                                {
                                    state.status =
                                        navigation::NavigationStatus::SlowingForStragglers;
                                }
                                state.formation = formation;
                                self.actors[i].navigation = Some(state);
                            }
                        }
                    }
                }
            }
            if let Some(reports) = &navigation_contacts
                && self.actors[i].physical_loss().is_none()
                && order.is_none_or(|o| o.helm.is_none())
                && self.actors[i]
                    .bot
                    .as_ref()
                    .is_some_and(|b| !matches!(b.ai_level, AiLevel::Static | AiLevel::Moving))
            {
                let mut state = self.actors[i].navigation.take().unwrap_or_else(|| {
                    NavigationState::new(order.map_or(Movement::Autonomous, |o| o.movement.clone()))
                });
                let wakes = crate::fleet_evasion::visible_wakes(
                    &self.actors[i],
                    &self.torpedoes,
                    &self.islands,
                    &self.catalog.terrain,
                    self.visual_conditions.visibility_m,
                );
                command = crate::fleet_evasion::command(
                    &self.actors[i],
                    &reports[team.index()],
                    &wakes,
                    self.tick,
                    &mut state,
                    command,
                );
                if matches!(
                    state.status,
                    navigation::NavigationStatus::EvadingAircraft
                        | navigation::NavigationStatus::EvadingTorpedo
                ) {
                    command = navigation::safe_correction(
                        &self.actors[i],
                        &self.actors,
                        &reports[team.index()],
                        &mut state,
                        command,
                    );
                }
                self.actors[i].navigation = Some(state);
            }
            if let Some(mission) = &self.mission_rules {
                command = avoid_land(
                    &self.actors[i].motion,
                    mission.area.constrain(&self.actors[i], command),
                    &self.islands,
                );
            }
            commands.push(command);
        }
        for (i, a) in self.actors.iter_mut().enumerate() {
            let def = a.compiled.definition.clone();
            let h = def
                .submarine
                .as_ref()
                .filter(|_| a.motion.depth() > 0.5)
                .map_or(&def.handling, |s| &s.submerged_handling);
            let power = system_health(a, &def, "engine", None);
            let steering = system_health(a, &def, "steering", None);
            let sea = (self.sea.wind_mps != 0.0).then(|| {
                self.sea
                    .handling(&def.hull, &a.motion, a.submarine.is_some())
            });
            a.helm = commands[i];
            step_ship(&mut a.motion, commands[i], h, power, steering, sea)
        }
        let hits = crate::collisions::resolve_ship_collisions(&mut self.actors);
        self.contacts(hits);
        for i in 0..self.actors.len() {
            let hits = crate::land::resolve_land_contact(
                &mut self.actors[i],
                &self.islands,
                &self.catalog.terrain,
            );
            self.contacts(hits)
        }
        for actor in &mut self.actors {
            actor.firing_visibility_seconds = (actor.firing_visibility_seconds - DT).max(0.0);
        }
        let mut events = vec![];
        for i in 0..self.actors.len() {
            // The ship used to be lifted out of the vector and put back so the
            // gunnery and underwater callees could hold the rest as `&[Vessel]`.
            // Splitting the vector around it gives the same view — every other
            // actor, in fleet order — without the two memmoves.
            let target_index = self.actors[i].target_id.as_ref().and_then(|id| {
                (0..self.actors.len()).find(|&j| j != i && self.actors[j].motion.id == *id)
            });
            let contact = self
                .mission_rules
                .as_ref()
                .and(self.actors[i].target_id.as_deref())
                .and_then(|id| self.sensors.contact(self.actors[i].team, id))
                .filter(|c| c.targetable());
            let (a, fleet) = crate::vessel::Fleet::split(&mut self.actors, i);
            let target = target_index.and_then(|j| fleet.get(j));
            if self.mission_rules.is_some() && a.controller == Controller::Bot {
                let secondary = bots::battery_mount(a, true).and_then(|mount| {
                    self.sensors.battery_target(
                        a.team,
                        [a.motion.x, a.motion.y, a.motion.z],
                        mount,
                        orders
                            .get(&a.motion.id)
                            .and_then(|o| o.target_id.as_deref()),
                        a.secondary_bot
                            .as_ref()
                            .and_then(|b| b.track.as_ref())
                            .map(|t| t.id.as_str()),
                    )
                });
                if secondary.is_some() || a.secondary_bot.is_some() {
                    let def = a.compiled.definition.clone();
                    let mut bot = a.secondary_bot.take().unwrap_or_else(|| {
                        BotState::new(
                            &format!("{}:secondary", a.motion.id),
                            &def,
                            self.seed,
                            a.bot.as_ref().map_or(AiLevel::Normal, |b| b.ai_level),
                        )
                    });
                    bot.update_contact(a, &def, secondary, time);
                    a.secondary_bot = Some(bot);
                }
            }
            let player = orders.get(&a.motion.id).and_then(|o| o.guns.as_ref());
            let weapons = orders
                .get(&a.motion.id)
                .map_or_else(WeaponsPolicy::default, |o| o.weapons);
            gunnery::operate_observed(
                a,
                &mut GunneryContext {
                    actors: fleet,
                    aviation: &mut self.aviation,
                    shells: &mut self.shells,
                    sequence: &mut self.sequence,
                    dispersion: &mut self.dispersion,
                    events: &mut events,
                    seed: self.seed,
                    dt: DT,
                },
                target,
                contact,
                player,
                weapons,
                self.mission_rules
                    .as_ref()
                    .map(|_| crate::sensors::Knowledge {
                        sensors: &self.sensors,
                        tick: self.tick,
                        islands: &self.islands,
                        terrain: &self.catalog.terrain,
                    }),
            );
            operate_underwater(
                a,
                fleet,
                target,
                contact.is_some(),
                player,
                &mut self.torpedoes,
                &mut self.depth_charges,
                &mut self.sequence,
                &mut events,
                weapons,
            );
        }
        self.aviation.step(
            &mut AirContext {
                knowledge: self
                    .mission_rules
                    .as_ref()
                    .map(|_| crate::sensors::Knowledge {
                        sensors: &self.sensors,
                        tick: self.tick,
                        islands: &self.islands,
                        terrain: &self.catalog.terrain,
                    }),
                actors: &self.actors,
                shells: &mut self.shells,
                torpedoes: &mut self.torpedoes,
                releases: &mut self.air_releases,
                sequence: &mut self.sequence,
                events: &mut events,
                seed: self.seed,
                sea: Some((&self.sea, time)),
            },
            DT,
            time,
        );
        for shell in &self.shells {
            self.records
                .sources
                .entry(shell.id)
                .or_insert_with(|| crate::records::WeaponSource {
                    owner_id: shell.owner_id.clone(),
                    label: shell.weapon_label.clone().unwrap_or_else(|| "Shell".into()),
                    ammunition: shell.ammunition.unwrap_or_default(),
                });
        }
        for t in &self.torpedoes {
            self.records
                .sources
                .entry(t.id)
                .or_insert_with(|| crate::records::WeaponSource {
                    owner_id: t.owner_id.clone(),
                    label: format!(
                        "{} · {}",
                        t.weapon.name,
                        if t.tube_id == "aircraft.payload" {
                            "Air torpedo"
                        } else {
                            "Torpedo"
                        }
                    ),
                    ammunition: Default::default(),
                });
        }
        for c in &self.depth_charges {
            self.records
                .sources
                .entry(c.id)
                .or_insert_with(|| crate::records::WeaponSource {
                    owner_id: c.owner_id.clone(),
                    label: format!("{} · Depth charge", c.weapon.name),
                    ammunition: Default::default(),
                });
        }
        let mut completed = vec![];
        for i in (0..self.shells.len()).rev() {
            let (end, mut emitted) = crate::projectile::advance_projectile(
                &mut self.shells[i],
                &mut self.actors,
                DT,
                &self.islands,
                &self.catalog.terrain,
                &|x, z| self.sea.height(x, z, time),
            );
            events.append(&mut emitted);
            if let Some(end) = end {
                completed.push((self.shells[i].id, end.as_str()));
                self.shells.remove(i);
            }
        }
        step_torpedoes(
            self.seed,
            &mut self.torpedoes,
            &mut self.actors,
            &mut self.aviation,
            &self.islands,
            &self.catalog.terrain,
            &mut events,
        );
        step_charges(
            &mut self.depth_charges,
            &mut self.actors,
            &self.aviation,
            &mut events,
        );
        // Fires and damage-control work integrate over a whole window on the
        // mission cadence: the same equations, one explicit Euler step of
        // `damage_control_ticks * DT` instead of that many tick-sized ones.
        // Hits still raise heat every tick through `damage_control::heat_*`.
        let control_ticks = self.cadence.damage_control_ticks;
        let control_step = self
            .tick
            .is_multiple_of(control_ticks)
            .then_some(control_ticks as f64 * DT);
        for (i, a) in self.actors.iter_mut().enumerate() {
            let compiled = a.compiled.clone();
            let def = &compiled.definition;
            if let Some((priority, focus)) =
                orders.get(&a.motion.id).and_then(|o| o.control.as_ref())
            {
                a.damage.control.priority = priority.clone();
                a.damage.control.focus = focus.clone()
            }
            let ignitions = match control_step {
                Some(dt) => crate::damage_control::update_damage_control(a, def, dt, None),
                // Between windows the standing pump assignments in
                // `damage.control.pumping` keep running, unchanged.
                None => Vec::new(),
            };
            for e in ignitions {
                let m = def.modules.iter().find(|m| m.id == e.module_id).unwrap();
                events.push(DamageEvent {
                    kind: "module".into(),
                    ship_id: e.ship_id,
                    position: e.position,
                    message: format!("{} ignition · ammunition lost, hull opened", m.name),
                    detonation: Some(true),
                    ..Default::default()
                });
            }
            let sunk = a.damage.sunk;
            let response = (self.sea.amplitude_m != 0.0
                || (a.motion.yaw_rate * a.motion.speed).abs() > 1e-6)
                .then(|| {
                    self.sea
                        .response(&def.hull, &a.motion, a.submarine.is_some(), time)
                });
            crate::flooding::update_flooding(
                a,
                def,
                &compiled.hydro,
                DT,
                self.cadence.stability_interval_seconds,
                response,
                (self.sea.amplitude_m != 0.0).then_some((&self.sea, time)),
            );
            crate::submarine::step_submarine(
                a,
                def,
                commands[i],
                DT,
                response.map_or(0.0, |r| r.heave),
            );
            let id = a.motion.id.clone();
            capability::update(a, def, self.aviation.wing(&id));
            if !sunk && a.damage.sunk {
                events.push(DamageEvent {
                    kind: "sunk".into(),
                    position: [a.motion.x, a.motion.y, a.motion.z],
                    ship_id: id,
                    defeat_cause: a.damage.defeat_cause.clone(),
                    message: format!(
                        "{} sinking · {}",
                        def.name,
                        a.damage.defeat_cause.as_deref().unwrap_or("flooding")
                    ),
                    ..Default::default()
                });
            }
        }
        for e in events {
            self.emit(e)
        }
        for (id, end) in completed {
            self.records.complete_shell(id, end)
        }
        // One reused sorted buffer instead of a fresh BTreeSet of node
        // allocations for every projectile in flight, every tick.
        let mut active = std::mem::take(&mut self.active_projectiles);
        active.clear();
        active.extend(
            self.shells
                .iter()
                .map(|s| s.id)
                .chain(self.torpedoes.iter().map(|t| t.id))
                .chain(self.depth_charges.iter().map(|c| c.id)),
        );
        active.sort_unstable();
        self.records.finish_tick(&self.actors, &active);
        self.active_projectiles = active;
        self.tick += 1;
        self.outcome = if let Some(mission) = &self.mission_rules {
            crate::mission::evaluate(
                self.tick,
                &self.actors,
                &self.aviation,
                mission,
                rules::afloat_kg(&self.survivors()),
            )
        } else {
            rules::evaluate_outcome(self.tick, &self.survivors(), &self.rules)
        };
    }
    pub fn remaining_seconds(&self) -> Option<f64> {
        self.mission_rules.as_ref().map_or_else(
            || Some((self.rules.duration_seconds as f64 - self.tick as f64 * DT).max(0.0)),
            |mission| mission.remaining_seconds(self.tick),
        )
    }
}
#[allow(clippy::too_many_arguments)]
fn operate_underwater(
    a: &mut Vessel,
    actors: crate::vessel::Fleet<'_>,
    target: Option<&Vessel>,
    observed_target: bool,
    player: Option<&PlayerGunOrders>,
    torpedoes: &mut Vec<Torpedo>,
    charges: &mut Vec<DepthCharge>,
    sequence: &mut i64,
    events: &mut Vec<DamageEvent>,
    weapons: WeaponsPolicy,
) {
    let compiled = a.compiled.clone();
    let def = &compiled.definition;
    a.tube_launch_cooldown = (a.tube_launch_cooldown - DT).max(0.0);
    // Aims by tube index. Ships without tubes allocate nothing, and the tube
    // identity never has to be cloned into a map key to be found again.
    let aims: Vec<Option<crate::definition::Vec3>> = def
        .torpedo_tubes
        .iter()
        .flatten()
        .map(|t| {
            player.map(|p| p.aim).unwrap_or_else(|| {
                (target.is_some() || observed_target)
                    .then(|| {
                        a.bot
                            .as_ref()
                            .and_then(|b| bots::torpedo_aim(b, &a.motion, t))
                    })
                    .flatten()
            })
        })
        .collect();
    let aim_for = |tube: &crate::definition::TubeDefinition| {
        def.torpedo_tubes
            .iter()
            .flatten()
            .position(|t| std::ptr::eq(t, tube))
            .and_then(|i| aims[i])
    };
    torpedoes::train_launchers(a, def, &aim_for, DT, None);
    for (i, t) in def.torpedo_tubes.iter().flatten().enumerate() {
        // Move the tube state out and back rather than cloning its two strings
        // every tick; nothing reachable from here reads the vessel's own tubes.
        let mut state = std::mem::replace(
            &mut a.torpedo_tubes[i],
            torpedoes::TubeState {
                id: String::new(),
                ammo: 0.0,
                reload: 0.0,
                status: String::new(),
            },
        );
        let aim = aims[i];
        let solution = torpedoes::tube_solution(
            a,
            def,
            t,
            &mut state,
            aim.unwrap_or([f64::NAN, 0.0, f64::NAN]),
            DT,
            None,
        );
        if state.status == "ready" && a.tube_launch_cooldown > 0.0 {
            state.status = "reloading".into()
        }
        if state.status == "ready"
            && a.controller == Controller::Bot
            && aim.is_some_and(|aim| {
                !torpedoes::clear_torpedo_lane(
                    a,
                    solution.origin,
                    aim,
                    torpedo_speed(t.weapon.speed),
                    actors,
                )
            })
        {
            state.status = "blocked".into()
        }
        let fire = player.map_or_else(
            || {
                a.controller == Controller::Bot
                    && weapons.torpedoes
                    && (target.is_some() || observed_target)
                    && a.bot.as_ref().is_some_and(|b| b.ready(None))
            },
            |p| {
                aim.is_some()
                    && p.battery == "torpedo"
                    && p.weapon_group_id
                        .as_ref()
                        .is_none_or(|id| *id == format!("torpedo:{}", t.weapon.id))
                    && p.fire
            },
        );
        if fire && state.status == "ready" {
            *sequence += 1;
            let velocity = [
                solution.heading.sin() * torpedo_speed(t.weapon.speed),
                0.0,
                -solution.heading.cos() * torpedo_speed(t.weapon.speed),
            ];
            torpedoes.push(Torpedo {
                id: *sequence,
                owner_id: a.motion.id.clone(),
                tube_id: t.id.clone(),
                position: solution.origin,
                velocity,
                age: 0.0,
                distance: 0.0,
                weapon: t.weapon.clone(),
            });
            state.ammo -= 1.0;
            state.reload = if state.ammo > 0.0 {
                t.weapon.reload_seconds
            } else {
                0.0
            };
            state.status = if state.ammo > 0.0 {
                "reloading"
            } else {
                "empty"
            }
            .into();
            a.tube_launch_cooldown = t.weapon.launch_interval_seconds;
            events.push(DamageEvent {
                kind: "torpedo-launch".into(),
                position: solution.origin,
                ship_id: a.motion.id.clone(),
                message: format!("{} · torpedo away", t.name),
                torpedo: Some(TorpedoEffect {
                    id: *sequence,
                    velocity,
                    diameter_m: t.weapon.diameter_m,
                }),
                ..Default::default()
            });
        }
        a.torpedo_tubes[i] = state;
    }
    a.depth_charge_cooldown = (a.depth_charge_cooldown - DT).max(0.0);
    for (i, l) in def.depth_charge_launchers.iter().flatten().enumerate() {
        let mut state = std::mem::replace(
            &mut a.depth_charge_launchers[i],
            depth_charges::DepthChargeLauncherState {
                id: String::new(),
                ammo: 0.0,
                reload: 0.0,
                status: String::new(),
            },
        );
        depth_charges::update_launcher(a, def, l, &mut state, DT, a.depth_charge_cooldown, None);
        let fire = player.map_or_else(
            || {
                a.controller == Controller::Bot
                    && weapons.torpedoes
                    && a.bot.as_ref().is_some_and(|b| b.ready(None))
                    && target.is_some_and(|t| depth_charges::bot_should_drop(a, t, l, actors))
            },
            |p| {
                p.battery == "depth-charge"
                    && p.weapon_group_id
                        .as_ref()
                        .is_none_or(|id| *id == format!("depth-charge:{}", l.weapon.id))
                    && p.fire
            },
        );
        if state.status == "ready" && fire {
            *sequence += 1;
            let charge = depth_charges::launch(a, l, *sequence);
            events.push(DamageEvent {
                kind: "depth-charge-launch".into(),
                position: charge.position,
                ship_id: a.motion.id.clone(),
                message: format!("{} · depth charge away", l.name),
                depth_charge: Some(DepthChargeEffect {
                    id: charge.id,
                    radius_m: charge.weapon.blast_radius_m,
                }),
                ..Default::default()
            });
            charges.push(charge);
            state.ammo -= 1.0;
            state.reload = if state.ammo > 0.0 {
                l.weapon.reload_seconds
            } else {
                0.0
            };
            state.status = if state.ammo > 0.0 {
                "reloading"
            } else {
                "empty"
            }
            .into();
            a.depth_charge_cooldown = l.weapon.launch_interval_seconds;
        }
        a.depth_charge_launchers[i] = state;
    }
}
fn step_torpedoes(
    seed: u32,
    torpedoes: &mut Vec<Torpedo>,
    actors: &mut [Vessel],
    air: &mut Aviation,
    islands: &[Island],
    fields: &[crate::environment::TerrainField],
    events: &mut Vec<DamageEvent>,
) {
    for i in (0..torpedoes.len()).rev() {
        let t = &mut torpedoes[i];
        let from = t.position;
        let w = &t.weapon;
        let travel = (torpedo_speed(w.speed) * DT).min(w.range_m - t.distance);
        let mut to = add(from, scale(t.velocity, travel / torpedo_speed(w.speed)));
        if from[1] > 0.0 {
            to[1] = (-w.running_depth_m).max(from[1] + t.velocity[1] * DT - 0.5 * 9.81 * DT * DT);
            t.velocity[1] = if to[1] > 0.0 {
                t.velocity[1] - 9.81 * DT
            } else {
                0.0
            };
        } else {
            to[1] += clamp(-w.running_depth_m - to[1], -0.6 * DT, 0.6 * DT)
        }
        let hit = torpedoes::first_torpedo_hit(t, from, to, actors);
        t.age += DT;
        let evidence = TorpedoEffect {
            id: t.id,
            velocity: t.velocity,
            diameter_m: w.diameter_m,
        };
        let land = crate::environment::first_land_hit(islands, fields, from, to);
        if let Some((at, point)) = land
            && hit.is_none_or(|(_, _, ht, _)| at < ht)
        {
            events.push(DamageEvent {
                kind: "torpedo-expired".into(),
                position: point,
                ship_id: t.owner_id.clone(),
                message: "Torpedo struck the coast".into(),
                torpedo: Some(evidence),
                ..Default::default()
            });
            torpedoes.remove(i);
            continue;
        }
        if let Some((victim, point, at, normal)) = hit {
            let a = &mut actors[victim];
            let def = a.compiled.definition.clone();
            let armed = t.distance + travel * at >= w.arming_distance_m;
            let direction = sub(
                world_to_local(to, a.motion.pose()),
                world_to_local(from, a.motion.pose()),
            );
            let glancing = armed
                && torpedoes::torpedo_dud_roll(seed, t.id)
                    < torpedoes::glancing_dud_chance(direction, normal);
            let detonates = armed && !glancing;
            let hp = a.damage.integrity;
            let message = if detonates {
                torpedoes::damage_torpedo_hit(a, &def, point, w, t.id)
            } else if glancing {
                "Torpedo dud · glancing impact".into()
            } else {
                "Torpedo dud · impact before arming".into()
            };
            if detonates {
                let id = a.motion.id.clone();
                capability::update(a, &def, air.wing(&id))
            }
            events.push(DamageEvent {
                kind: if detonates {
                    "torpedo-hit"
                } else {
                    "torpedo-dud"
                }
                .into(),
                position: local_to_world(point, a.motion.pose()),
                ship_id: a.motion.id.clone(),
                message,
                hull_damage: Some((hp - a.damage.integrity).max(0.0)),
                torpedo: Some(evidence.clone()),
                ..Default::default()
            });
        }
        t.position = to;
        t.distance += travel;
        if hit.is_none() && t.distance >= w.range_m - 1e-6 {
            events.push(DamageEvent {
                kind: "torpedo-expired".into(),
                position: to,
                ship_id: t.owner_id.clone(),
                message: "Torpedo reached maximum range".into(),
                torpedo: Some(evidence),
                ..Default::default()
            });
        }
        if hit.is_some() || t.distance >= w.range_m - 1e-6 {
            torpedoes.remove(i);
        }
    }
}
fn step_charges(
    charges: &mut Vec<DepthCharge>,
    actors: &mut [Vessel],
    air: &Aviation,
    events: &mut Vec<DamageEvent>,
) {
    for i in (0..charges.len()).rev() {
        let c = &mut charges[i];
        let result = depth_charges::step(c, DT);
        let evidence = DepthChargeEffect {
            id: c.id,
            radius_m: c.weapon.blast_radius_m,
        };
        if let Some(position) = result.splash {
            events.push(DamageEvent {
                kind: "depth-charge-splash".into(),
                position,
                ship_id: c.owner_id.clone(),
                message: "Depth charge entering water".into(),
                depth_charge: Some(evidence.clone()),
                ..Default::default()
            });
        }
        if !result.detonated {
            continue;
        }
        events.push(DamageEvent {
            kind: "depth-charge-blast".into(),
            position: c.position,
            ship_id: c.owner_id.clone(),
            message: format!(
                "Depth charge detonated at {} m",
                c.weapon.detonation_depth_m
            ),
            depth_charge: Some(evidence.clone()),
            ..Default::default()
        });
        for a in &mut *actors {
            let def = a.compiled.definition.clone();
            let hp = a.damage.integrity;
            let Some(message) = depth_charges::damage_depth_charge(c, a, &def) else {
                continue;
            };
            let id = a.motion.id.clone();
            capability::update(a, &def, air.wing(&id));
            events.push(DamageEvent {
                kind: "depth-charge-hit".into(),
                position: c.position,
                ship_id: id,
                message,
                hull_damage: Some((hp - a.damage.integrity).max(0.0)),
                depth_charge: Some(evidence.clone()),
                ..Default::default()
            });
        }
        charges.remove(i);
    }
}

#[cfg(test)]
mod torpedo_contact_tests {
    use super::*;
    use crate::{rules::TeamId, vessel::CompiledShip};
    use std::sync::Arc;

    fn contact(angle: f64, seed: u32, armed: bool) -> (Vessel, DamageEvent) {
        let mut def: crate::definition::ShipDefinition =
            serde_json::from_str(include_str!("../../../public/models/type-viic.json")).unwrap();
        // A flat, vertical side isolates incidence from the submarine's curved hull.
        let mut value = serde_json::to_value(&def).unwrap();
        value["hull"]["sections"] = serde_json::json!([
            {"station":0,"points":[[0,-4],[3,-4],[3,4]]},
            {"station":def.hull.length,"points":[[0,-4],[3,-4],[3,4]]}
        ]);
        def = serde_json::from_value(value).unwrap();
        let weapon = def.torpedo_tubes.as_ref().unwrap()[0].weapon.clone();
        // A synthetic hull has no published table; the mesh solver stands in.
        let compiled = Arc::new(CompiledShip::new(Arc::new(def), None).unwrap());
        let mut actors = vec![Vessel::new("target", TeamId::B, compiled)];
        let direction = [radians(angle).sin(), 0.0, radians(angle).cos()];
        let point = [-3.0, -weapon.running_depth_m, 0.0];
        let t = Torpedo {
            id: 42,
            owner_id: "player".into(),
            tube_id: "aircraft.payload".into(),
            position: sub(
                point,
                scale(direction, torpedo_speed(weapon.speed) * DT * 0.5),
            ),
            velocity: scale(direction, torpedo_speed(weapon.speed)),
            distance: if armed { 1000.0 } else { 0.0 },
            age: 0.0,
            weapon,
        };
        let mut rounds = vec![t];
        let mut events = vec![];
        let mut air = Aviation::new(&actors, BTreeMap::new());
        step_torpedoes(
            seed,
            &mut rounds,
            &mut actors,
            &mut air,
            &[],
            &[],
            &mut events,
        );
        assert!(rounds.is_empty(), "contact must consume the projectile");
        assert_eq!(events.len(), 1);
        (actors.remove(0), events.remove(0))
    }

    #[test]
    fn contact_pistol_curve_and_seed_are_stable() {
        for (angle, expected) in [
            (90.0, 0.0),
            (45.0, 0.0),
            (20.0, 0.0),
            (10.0, 0.45),
            (0.0, 0.9),
        ] {
            let chance = torpedoes::glancing_dud_chance(
                [radians(angle).sin(), 0.0, radians(angle).cos()],
                [1.0, 0.0, 0.0],
            );
            assert!((chance - expected).abs() < 1e-12);
        }
        assert_eq!(torpedoes::torpedo_dud_roll(123, 42), 0.41204642434604466); // Shared native/TS vector.
        assert_ne!(
            torpedoes::torpedo_dud_roll(123, 42),
            torpedoes::torpedo_dud_roll(124, 42)
        );
    }

    #[test]
    fn glancing_duds_are_harmless_and_detonations_keep_full_damage() {
        let dud_seed = (0..100)
            .find(|s| torpedoes::torpedo_dud_roll(*s, 42) < 0.45)
            .unwrap();
        let hit_seed = (0..100)
            .find(|s| torpedoes::torpedo_dud_roll(*s, 42) >= 0.45)
            .unwrap();
        let (dud, event) = contact(10.0, dud_seed, true);
        assert_eq!(event.kind, "torpedo-dud");
        assert_eq!(event.message, "Torpedo dud · glancing impact");
        assert_eq!(event.hull_damage, Some(0.0));
        assert_eq!(dud.damage.integrity, dud.damage.max_integrity);
        assert!(
            dud.damage
                .compartments
                .iter()
                .all(|c| c.breach_area_m2 == 0.0)
        );
        assert!(
            dud.damage
                .modules
                .iter()
                .zip(&dud.definition().modules)
                .all(|(state, def)| state.hp == def.hp)
        );
        let (_, repeated) = contact(10.0, dud_seed, true);
        assert_eq!(event.message, repeated.message);
        let (square, square_event) = contact(90.0, dud_seed, true);
        let (glance, glance_event) = contact(10.0, hit_seed, true);
        assert_eq!(square_event.kind, "torpedo-hit");
        assert_eq!(glance_event.kind, "torpedo-hit");
        assert_eq!(square_event.hull_damage, glance_event.hull_damage);
        assert!(glance_event.hull_damage.unwrap() > 0.0);
        let breach = |a: &Vessel| {
            a.damage
                .compartments
                .iter()
                .map(|c| c.breach_area_m2)
                .sum::<f64>()
        };
        assert!(breach(&glance) > 0.0);
        assert!((breach(&square) - breach(&glance)).abs() < 1e-12);
        let (_, unarmed) = contact(10.0, dud_seed, false);
        assert_eq!(unarmed.message, "Torpedo dud · impact before arming");
        assert_eq!(unarmed.hull_damage, Some(0.0));
    }
}
