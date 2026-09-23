//! Complete renderer-free fixed-tick battle authority, shared by native and WASM.
pub mod tick;
use crate::mobility::torpedo_speed;
pub use crate::navigation::Movement;
use crate::navigation::{self, WeaponsPolicy};
use crate::{
    aviation::{AirOrder, AirRelease, Aviation},
    bots::{self, AiLevel, BotState},
    capability,
    captain::{BotCaptain, Captain},
    catalog::Catalog,
    collisions::HullImpact,
    depth_charges::{self, DepthCharge},
    environment::{Island, SeaState},
    geometry::*,
    gunnery::PlayerGunOrders,
    impact::{DamageEvent, DepthChargeEffect, TorpedoEffect},
    motion::HelmCommand,
    rules::{DT, Outcome, Rules, Survivor, TeamId},
    shell::Shell,
    torpedoes::{self, Torpedo},
    vessel::{CompiledShip, Controller, Vessel},
};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, sync::Arc};
/// A ship's start in world metres (y up; a hull's bow is its local -z).
#[derive(Clone, Debug, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Spawn {
    pub x: f64,
    pub z: f64,
    /// Radians, clockwise seen from above: 0 steams toward -z, pi/2 toward +x,
    /// so the bow points along (sin h, -cos h) in x and z. Default spawns face
    /// team a at 0 and team b at pi, toward each other.
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
    /// Metres between the default spawn lines, 1000..=20000: team a at z = 0,
    /// team b at z = -spawnDistance, islands laid out around the midpoint.
    pub spawn_distance: f64,
    /// Metres per second, 0..=30; null takes the weather preset's wind.
    pub wind_speed: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub mission_rules: Option<crate::mission::MissionRules>,
    /// Omitted legacy setups explicitly resolve legacy-air-v1 from installed content.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub air_rules: Option<crate::aviation::AirRules>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Orders {
    pub helm: Option<HelmCommand>,
    pub guns: Option<PlayerGunOrders>,
    pub movement: Movement,
    pub target_id: Option<String>,
    pub control: Option<(String, String)>,
    pub weapons: WeaponsPolicy,
    pub formation_policy: navigation::FormationPolicy,
}
#[derive(Clone, Debug, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    #[ts(type = "number")]
    pub sequence: u64,
    #[ts(type = "number")]
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
    /// One tick's scratch, reused every tick: the event sink, this tick's
    /// helm by hull id, the shells that ended, the projectile ledger.
    scratch: tick::Tick,
    /// The adapter at the captain seam. The seeded crew by default; a
    /// scripted captain in tests, a replay or a log later.
    captain: Box<dyn Captain + Send + Sync>,
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
            return Err(format!(
                "Choose one to 30 ships per side; team a has {}, team b has {}",
                counts[0], counts[1]
            ));
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
                return Err(format!(
                    "Invalid ship instance identity {:?}: ids are 1-128 bytes and unique",
                    ship.id
                ));
            }
            let content = compiled
                .get(&ship.preset_id)
                .ok_or_else(|| {
                    format!(
                        "Unknown ship preset {:?} for ship {:?}; compiled: {}",
                        ship.preset_id,
                        ship.id,
                        compiled.keys().cloned().collect::<Vec<_>>().join(", ")
                    )
                })?
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
            let deployment = |why: String| {
                format!(
                    "Invalid fleet deployment: ship {:?} at x {}, z {} (heading {} rad) {why}",
                    a.motion.id, p.x, p.z, p.heading
                )
            };
            if ![p.x, p.z, p.heading].iter().all(|n| n.is_finite()) {
                return Err(deployment("must be finite".into()));
            }
            if setup.mission_rules.as_ref().is_some_and(|m| {
                !m.area
                    .contains([p.x, p.z], a.definition().hull.length / 2.0)
            }) {
                return Err(deployment("is outside the mission area".into()));
            }
            if p.x.abs() > 40000.0 || p.z.abs() > 40000.0 {
                return Err(deployment("is outside -40000..=40000 m".into()));
            }
            if let Some(other) = actors
                .iter()
                .find(|a: &&Vessel| (a.motion.x - p.x).hypot(a.motion.z - p.z) < 350.0)
            {
                return Err(deployment(format!(
                    "is {:.0} m from ship {:?}; keep ships 350 m apart",
                    (other.motion.x - p.x).hypot(other.motion.z - p.z),
                    other.motion.id
                )));
            }
            if let Some(island) = environment.islands.iter().find(|i| {
                let mut expanded = (*i).clone();
                expanded.rx += 250.0;
                expanded.rz += 250.0;
                expanded.radius(p.x, p.z) <= 1.05
            }) {
                return Err(format!(
                    "Deployment is too close to land: ship {:?} at x {}, z {} is within about 250 m of island {} (centre x {:.0}, z {:.0})",
                    a.motion.id, p.x, p.z, island.id, island.x, island.z
                ));
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
            scratch: Default::default(),
            captain: Box::new(BotCaptain),
        })
    }
    /// Swap the adapter at the captain seam. Every hull's decisions come from
    /// this one captain from the next `step` on; its crew memory stays on the
    /// vessels, so swapping back resumes the seeded crew where it left off.
    pub fn set_captain(&mut self, captain: Box<dyn Captain + Send + Sync>) {
        self.captain = captain;
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
    /// Local developer console seam: re-resolve the sea for a new wind from
    /// the next `step` on. The calibrated height and wavelength follow the same
    /// content curve as launch; the swell keeps its seeded phase. Explicit wind
    /// bypasses the forecast, so any listed weather resolves the same sea.
    /// `direction_deg` is [`SeaState::direction`] in degrees: where the waves run to.
    pub fn set_wind(
        &mut self,
        wind_mps: f64,
        direction_deg: f64,
    ) -> Result<(), crate::catalog::ContentError> {
        if !direction_deg.is_finite() {
            return Err(crate::catalog::ContentError::Invalid(
                "wind direction must be finite".into(),
            ));
        }
        let sea = self
            .catalog
            .resolve_environment(&self.map_id, "clear", self.seed, 1, 5000.0, Some(wind_mps))?
            .sea;
        self.sea = SeaState {
            direction: direction_deg.rem_euclid(360.0).to_radians(),
            phase: self.sea.phase,
            ..sea
        };
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
    fn emit(&mut self, mut event: DamageEvent) {
        if event.source_id.is_none() {
            let id = event
                .shell
                .as_ref()
                .map(|s| s.id)
                .or_else(|| event.torpedo.as_ref().map(|t| t.id))
                .or_else(|| event.depth_charge.as_ref().map(|c| c.id));
            event.source_id = id
                .and_then(|id| self.records.sources.get(&id))
                .map(|source| source.owner_id.clone());
        }
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
                source_id: hit.other_id,
                message: format!("{weapon} · {} hull damage", hit.damage),
                ..Default::default()
            })
        }
    }
    /// Advance the battle one tick. The tick is the sequence of phases in
    /// [`tick::Phase`], each a method on `Battle` that says what it reads and
    /// writes; the per-tick scratch crosses between them in a reused
    /// [`tick::Tick`], and the order is asserted at every phase entry.
    pub fn step(&mut self, orders: &BTreeMap<String, Orders>) {
        if self.outcome.is_some() {
            return;
        }
        self.advance_tick(orders);
    }
    /// Let the battle play out after scoring has stopped. No new player orders
    /// are admitted, and the deciding tick and tonnage remain authoritative.
    pub fn step_aftermath(&mut self) {
        if self.outcome.is_none() {
            return;
        }
        self.advance_tick(&BTreeMap::new());
    }
    fn advance_tick(&mut self, orders: &BTreeMap<String, Orders>) {
        let mut tick = std::mem::take(&mut self.scratch);
        tick.begin(self);
        self.observe(&mut tick);
        self.decide(&mut tick, orders);
        self.manoeuvre(&mut tick);
        self.fight(&mut tick, orders);
        self.strike(&mut tick);
        self.suffer(&mut tick, orders);
        self.settle(&mut tick);
        self.scratch = tick;
    }
    pub fn remaining_seconds(&self) -> Option<f64> {
        let tick = self.outcome.as_ref().map_or(self.tick, |o| o.final_tick);
        self.mission_rules.as_ref().map_or_else(
            || Some((self.rules.duration_seconds as f64 - tick as f64 * DT).max(0.0)),
            |mission| mission.remaining_seconds(tick),
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
