//! Complete renderer-free fixed-tick battle authority, shared by native and WASM.
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
    pub events: Vec<Event>,
    pub(crate) team_events: [Vec<Event>; 2],
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
    pub(crate) visual_conditions: crate::sensors::VisualConditions,
    visual_rules: crate::sensors::VisualRules,
    displacement: Vec<u64>,
    rules: Rules,
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
        let aviation = Aviation::with_rules(&actors, catalog.aircraft.clone(), air_rules)?;
        let visual_conditions =
            crate::sensors::VisualConditions::resolve(&catalog, &setup.map_id, &setup.weather);
        Ok(Self {
            records: Default::default(),
            catalog,
            actors,
            aviation,
            shells: vec![],
            torpedoes: vec![],
            depth_charges: vec![],
            air_releases: vec![],
            events: vec![],
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
            mission_rules: setup.mission_rules,
            sensors: Default::default(),
            visual_conditions,
            visual_rules: Default::default(),
        })
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
                    self.team_event_sequence[team.index()] += 1;
                    let events = &mut self.team_events[team.index()];
                    events.push(Event {
                        sequence: self.team_event_sequence[team.index()],
                        tick: self.tick,
                        data,
                    });
                    if events.len() > 128 {
                        events.remove(0);
                    }
                }
            }
        }
        self.records.event(&event, self.tick, &self.actors);
        self.event_sequence += 1;
        self.events.push(Event {
            sequence: self.event_sequence,
            tick: self.tick,
            data: event,
        });
        if self.events.len() > 128 {
            self.events.remove(0);
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
        let mut commands = Vec::with_capacity(self.actors.len());
        for i in 0..self.actors.len() {
            let mut actor = self.actors.remove(i);
            let def = actor.compiled.definition.clone();
            actor.sea = Some((self.sea.clone(), time));
            let actor_id = actor.motion.id.clone();
            capability::update(&mut actor, &def, self.aviation.wing(&actor_id));
            let order = orders.get(&actor.motion.id);
            let mut command = HelmCommand::default();
            if actor.physical_loss().is_some() {
                actor.target_id = None
            } else {
                let contact = self.mission_rules.as_ref().and_then(|_| {
                    self.sensors.surface_target(
                        actor.team,
                        [actor.motion.x, actor.motion.y, actor.motion.z],
                        order.and_then(|o| o.target_id.as_deref()),
                        actor.target_id.as_deref(),
                    )
                });
                let target = self
                    .mission_rules
                    .is_none()
                    .then(|| {
                        order
                            .and_then(|o| o.target_id.as_ref())
                            .and_then(|id| {
                                self.actors.iter().find(|a| {
                                    a.motion.id == *id
                                        && a.team != actor.team
                                        && a.physical_loss().is_none()
                                })
                            })
                            .or_else(|| bots::target(&actor, &self.actors).map(|j| &self.actors[j]))
                    })
                    .flatten();
                if actor.controller == Controller::Bot
                    || order.is_some_and(|o| o.guns.is_none() || o.helm.is_none())
                {
                    let mut bot = actor.bot.take().unwrap();
                    if self.mission_rules.is_some() {
                        bot.update_contact(&actor, &def, contact, time);
                        command = bots::helm_contact(&bot, &actor, contact, &self.actors);
                    } else {
                        bot.update(
                            &actor,
                            &def,
                            target.map(|t| (&t.state, t.definition())),
                            time,
                        );
                        command = bots::helm(&mut bot, &actor, target, &self.actors);
                    }
                    if bot.ai_level != AiLevel::Static {
                        command = avoid_land(&actor.motion, command, &self.islands)
                    }
                    actor.bot = Some(bot);
                    actor.target_id = contact
                        .map(|c| c.id.clone())
                        .or_else(|| target.map(|t| t.motion.id.clone()));
                }
                if let Some(o) = order {
                    if let Some(helm) = o.helm {
                        command = helm
                    } else {
                        match &o.movement {
                            Movement::Autonomous => (),
                            Movement::Hold => command = HelmCommand::default(),
                            Movement::Move { position: [x, z] } => {
                                let distance = (x - actor.motion.x).hypot(z - actor.motion.z);
                                let angle = wrap_angle(
                                    (x - actor.motion.x).atan2(actor.motion.z - z)
                                        - actor.motion.heading,
                                );
                                command = avoid_land(
                                    &actor.motion,
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
                                let mut state = actor
                                    .navigation
                                    .take()
                                    .unwrap_or_else(|| NavigationState::new(o.movement.clone()));
                                let speed_limit = self.actors.iter().filter(|a| a.team == actor.team && a.physical_loss().is_none())
                                    .filter(|a| orders.get(&a.motion.id).is_some_and(|o|
                                        matches!(&o.movement, Movement::Escort { leader_id, .. } if leader_id == &actor_id)))
                                    .map(|a| a.definition().handling.forward_speed * 0.85)
                                    .fold(def.handling.forward_speed, f64::min);
                                command = navigation::command(
                                    &actor,
                                    &self.actors,
                                    &self.islands,
                                    &o.movement,
                                    &mut state,
                                    self.tick,
                                    speed_limit,
                                );
                                actor.navigation = Some(state);
                            }
                        }
                    }
                }
            }
            if let Some(mission) = &self.mission_rules {
                command = avoid_land(
                    &actor.motion,
                    mission.area.constrain(&actor, command),
                    &self.islands,
                );
            }
            commands.push(command);
            self.actors.insert(i, actor);
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
        let mut events = vec![];
        for i in 0..self.actors.len() {
            let mut a = self.actors.remove(i);
            let target = a
                .target_id
                .as_ref()
                .and_then(|id| self.actors.iter().find(|t| t.motion.id == *id));
            let contact = self
                .mission_rules
                .as_ref()
                .and(a.target_id.as_deref())
                .and_then(|id| self.sensors.contact(a.team, id))
                .filter(|c| c.targetable());
            let player = orders.get(&a.motion.id).and_then(|o| o.guns.as_ref());
            let weapons = orders
                .get(&a.motion.id)
                .map_or_else(WeaponsPolicy::default, |o| o.weapons);
            gunnery::operate_observed(
                &mut a,
                &mut GunneryContext {
                    actors: &self.actors,
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
                &mut a,
                &self.actors,
                target,
                contact.is_some(),
                player,
                &mut self.torpedoes,
                &mut self.depth_charges,
                &mut self.sequence,
                &mut events,
                weapons,
            );
            self.actors.insert(i, a);
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
                completed.push((
                    self.shells[i].id,
                    serde_json::to_value(end)
                        .unwrap()
                        .as_str()
                        .unwrap()
                        .to_string(),
                ));
                self.shells.remove(i);
            }
        }
        step_torpedoes(
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
        for (i, a) in self.actors.iter_mut().enumerate() {
            let compiled = a.compiled.clone();
            let def = &compiled.definition;
            if let Some((priority, focus)) =
                orders.get(&a.motion.id).and_then(|o| o.control.as_ref())
            {
                a.damage.control.priority = priority.clone();
                a.damage.control.focus = focus.clone()
            }
            for e in crate::damage_control::update_damage_control(a, def, DT, None) {
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
            self.records.complete_shell(id, &end)
        }
        let active = self
            .shells
            .iter()
            .map(|s| s.id)
            .chain(self.torpedoes.iter().map(|t| t.id))
            .chain(self.depth_charges.iter().map(|c| c.id))
            .collect();
        self.records.finish_tick(&self.actors, &active);
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
    actors: &[Vessel],
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
    let aims: BTreeMap<_, _> = def
        .torpedo_tubes
        .iter()
        .flatten()
        .map(|t| {
            (
                t.id.clone(),
                player.map(|p| p.aim).unwrap_or_else(|| {
                    (target.is_some() || observed_target)
                        .then(|| {
                            a.bot
                                .as_ref()
                                .and_then(|b| bots::torpedo_aim(b, &a.motion, t))
                        })
                        .flatten()
                }),
            )
        })
        .collect();
    torpedoes::train_launchers(a, def, &|t| aims[&t.id], DT, None);
    for (i, t) in def.torpedo_tubes.iter().flatten().enumerate() {
        let mut state = a.torpedo_tubes[i].clone();
        let aim = aims[&t.id];
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
                !torpedoes::clear_torpedo_lane(a, solution.origin, aim, t.weapon.speed, actors)
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
                solution.heading.sin() * t.weapon.speed,
                0.0,
                -solution.heading.cos() * t.weapon.speed,
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
        let mut state = a.depth_charge_launchers[i].clone();
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
        let travel = (w.speed * DT).min(w.range_m - t.distance);
        let mut to = add(from, scale(t.velocity, travel / w.speed));
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
            && hit.is_none_or(|(_, _, ht)| at < ht)
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
        if let Some((victim, point, at)) = hit {
            let a = &mut actors[victim];
            let def = a.compiled.definition.clone();
            let armed = t.distance + travel * at >= w.arming_distance_m;
            let hp = a.damage.integrity;
            let message = if armed {
                torpedoes::damage_torpedo_hit(a, &def, point, w, t.id)
            } else {
                "Torpedo dud · impact before arming".into()
            };
            if armed {
                let id = a.motion.id.clone();
                capability::update(a, &def, air.wing(&id))
            }
            events.push(DamageEvent {
                kind: if armed { "torpedo-hit" } else { "torpedo-dud" }.into(),
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
