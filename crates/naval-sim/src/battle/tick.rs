//! One tick of the battle: the phases [`Battle::step`] runs, the order they
//! must run in, and the scratch state that crosses between them.
//!
//! `Battle::step` is the real interface of the whole simulation — every
//! weapons, damage, flooding and aviation module is reachable only through
//! it — and it used to be one four-hundred-line function whose interface was
//! unwritten: a helm vector built early and read back **by index into
//! `actors`** two hundred lines later, an event vector six sub-steps appended
//! to and one drained, and ordering invariants held only in comments (trails
//! before any captain reads them, sensors on their cadence, the records
//! bracket, the counter advancing before the outcome is judged).
//!
//! This module writes that interface down once. [`Tick`] owns the per-tick
//! scratch: the event sink, this tick's helm for every hull **by id**, the
//! shells that ended, the projectile ledger and the cadence flags. [`Phase`]
//! is the order, asserted at every phase entry in debug builds. Each phase is
//! a method on [`Battle`] whose doc comment says what it reads and writes, so
//! a test or a diagnostic can run one phase on its own against a fixture
//! instead of stepping the whole battle to see one effect.
//!
//! The split is a seam, not a behaviour change: every sub-step runs in the
//! order it did, consuming the seeded generators in the same order, which the
//! simulation equality gate checks bit for bit.
use super::{Battle, Orders, operate_underwater, step_charges, step_torpedoes};
use crate::{
    aviation::AirContext,
    capability,
    captain::{Crew, Decision, Reports, Target, Watch},
    environment::avoid_land,
    gunnery::{self, GunneryContext},
    impact::DamageEvent,
    machinery::system_health,
    motion::{HelmCommand, step_ship},
    navigation::WeaponsPolicy,
    rules::{self, DT, TeamId},
    vessel::Controller,
};
use std::collections::BTreeMap;

/// The phases of one tick, in the only order they may run.
///
/// The order carries the invariants that used to be comments in `step`:
///
/// - **Observe before Decide.** Trails are recorded and the mission's sensors
///   sampled before any captain reads them, so a follower steers for water
///   its guide has actually crossed and every captain shares one measured
///   report set.
/// - **Decide before Manoeuvre and Suffer.** The helm each hull steams on
///   and the depth its submarine steers to are this tick's decision, looked
///   up by hull id, never by position in the fleet.
/// - **Fight before Strike.** Projectiles launched this tick are in flight
///   before the in-flight pass advances them; the records know every weapon
///   source before its first impact can be scored.
/// - **Strike before Suffer.** Hits raise heat and open compartments before
///   damage control, flooding and capability judge the hull.
/// - **Settle last, and once.** Every event of the tick is published in the
///   order it was raised, the records close the tick they opened in Observe,
///   the counter advances, and the outcome is judged for the tick that just
///   closed.
///
/// Weapon capability is refreshed twice: on the mission's capability cadence
/// in Decide, and unconditionally for every hull at the end of Suffer. The
/// end-of-tick call is the one that leaves the state current for the next
/// tick's gunnery; the Decide sweep only re-derives it after a cadence window
/// in which nothing that feeds it changed. Both are kept so the step stays bit
/// for bit what it was.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Phase {
    /// Between ticks: the previous tick settled, or none has begun.
    #[default]
    Idle,
    /// [`Tick::begin`] ran: the cadence flags are set for this tick.
    Begun,
    Observe,
    Decide,
    Manoeuvre,
    Fight,
    Strike,
    Suffer,
    Settle,
}
impl Phase {
    /// The phase that may follow this one.
    pub fn next(self) -> Self {
        match self {
            Self::Idle => Self::Begun,
            Self::Begun => Self::Observe,
            Self::Observe => Self::Decide,
            Self::Decide => Self::Manoeuvre,
            Self::Manoeuvre => Self::Fight,
            Self::Fight => Self::Strike,
            Self::Strike => Self::Suffer,
            Self::Suffer => Self::Settle,
            Self::Settle => Self::Idle,
        }
    }
}

/// One tick's scratch state, owned by the battle and reused every tick so a
/// steady battle allocates nothing here. `Battle::tick` is the counter; this
/// is what crosses between the phases of one step of it.
#[derive(Default)]
pub struct Tick {
    phase: Phase,
    /// Simulated seconds since the battle began, `tick * DT`.
    pub time: f64,
    /// Whether a mission battle samples its sensors and refreshes every
    /// team's navigation reports this tick (the visual cadence). Never set in
    /// a custom or server battle, which has no reports.
    pub reports_refresh: bool,
    /// Whether weapon capability is re-derived for every hull before its
    /// captain decides (the mission's capability cadence; every tick
    /// elsewhere).
    pub capability_sweep: bool,
    /// The damage-control window closing this tick, as the Euler step in
    /// seconds — `damage_control_ticks * DT` — or `None` between windows,
    /// when the standing pump assignments keep running unchanged.
    pub control_step: Option<f64>,
    /// This tick's helm for every hull, by id. Keys are retained across
    /// ticks (the fleet is fixed at `Battle::new`), so nothing is allocated
    /// after the first tick; `decide` overwrites every entry.
    helm: BTreeMap<String, HelmCommand>,
    /// The event sink. Fight, Strike and Suffer raise events here in the
    /// order they happen; Settle publishes them in that order through
    /// `Battle::emit`. Contact events (ramming, grounding) do not pass
    /// through it: `Manoeuvre` publishes them at once, because the records
    /// score a contact against the fleet as it stood at the moment of impact.
    pub events: Vec<DamageEvent>,
    /// Shells that ended this tick, with how they ended, for the records.
    completed: Vec<(i64, &'static str)>,
    /// Sorted ids of every projectile still in flight at the end of the tick.
    active: Vec<i64>,
}
impl Tick {
    /// Open a tick: reset the scratch and derive the cadence flags from the
    /// battle's counter. The previous tick must have settled.
    pub fn begin(&mut self, battle: &Battle) {
        debug_assert_eq!(
            self.phase,
            Phase::Idle,
            "a tick began before the previous one settled"
        );
        self.phase = Phase::Begun;
        self.time = battle.tick as f64 * DT;
        self.reports_refresh = battle.mission_rules.is_some()
            && battle
                .tick
                .is_multiple_of(battle.visual_rules.cadence_ticks);
        self.capability_sweep = battle.tick.is_multiple_of(battle.cadence.capability_ticks);
        let control_ticks = battle.cadence.damage_control_ticks;
        self.control_step = battle
            .tick
            .is_multiple_of(control_ticks)
            .then_some(control_ticks as f64 * DT);
        self.events.clear();
        self.completed.clear();
    }
    pub fn phase(&self) -> Phase {
        self.phase
    }
    /// The helm decided for this hull this tick. Panics if Decide has not
    /// given it one: a hull that is not in the fleet, or a phase run out of
    /// order.
    pub fn helm(&self, id: &str) -> HelmCommand {
        self.helm
            .get(id)
            .copied()
            .unwrap_or_else(|| panic!("no helm was decided for {id} this tick"))
    }
    /// Record the helm decided for a hull. Allocates only the first time a
    /// hull id is seen.
    pub fn set_helm(&mut self, id: &str, helm: HelmCommand) {
        match self.helm.get_mut(id) {
            Some(slot) => *slot = helm,
            None => {
                self.helm.insert(id.to_owned(), helm);
            }
        }
    }
    /// Declare every phase before `phase` done, so that one phase can be run
    /// on its own against a fixture (tests, diagnostics). Requires
    /// [`begin`](Self::begin) first.
    pub fn skip_to(&mut self, phase: Phase) {
        assert!(
            self.phase != Phase::Idle && !matches!(phase, Phase::Idle | Phase::Begun),
            "skip_to needs a begun tick and a real phase"
        );
        while self.phase.next() != phase {
            self.phase = self.phase.next();
        }
    }
    fn enter(&mut self, phase: Phase) {
        debug_assert_eq!(
            self.phase.next(),
            phase,
            "tick phase {phase:?} entered after {:?}",
            self.phase
        );
        self.phase = phase;
    }
}

impl Battle {
    /// **Observe.** Open the records for this tick, record every hull's
    /// track, and on the report cadence sample the mission's sensors.
    ///
    /// Reads: every hull's motion, the aviation state, islands, terrain and
    /// visual conditions. Writes: `records` (the tick opens here and closes
    /// in [`settle`](Self::settle)), `trails`, and on `reports_refresh`
    /// `sensors` and both teams' `navigation_reports`.
    pub fn observe(&mut self, tick: &mut Tick) {
        tick.enter(Phase::Observe);
        self.records.begin_tick(&self.actors);
        for a in &self.actors {
            let trail = self.trails.entry(a.motion.id.clone()).or_default();
            trail.record([a.motion.x, a.motion.z], a.motion.heading, a.motion.speed);
            trail.steady_axis(a.motion.heading, DT);
        }
        if tick.reports_refresh {
            self.sensors.update(
                self.tick,
                &crate::sensors::entities(&self.actors, &self.aviation),
                &self.islands,
                &self.catalog.terrain,
                self.visual_conditions,
                &self.visual_rules,
            );
            // Sensors change on their fixed cadence; all captains share these
            // measured snapshots instead of cloning every report on every tick.
            self.navigation_reports = [
                self.sensors.contacts(TeamId::A),
                self.sensors.contacts(TeamId::B),
            ];
        }
    }
    /// **Decide.** Every hull's captain takes the conn: standing orders and
    /// what the hull may see go in, one decision comes out, and it is applied
    /// here and nowhere else — the target on the vessel, the helm into the
    /// tick by hull id after the arena has kept it inside the mission area
    /// and off the land.
    ///
    /// Reads: the fleet in `actors` order, `orders`, the mission's reports,
    /// islands, terrain, `trails`, torpedoes. Writes: each vessel's `sea`,
    /// its capability on `capability_sweep`, its `target_id`, `bot` and
    /// `navigation` memory; `tick.helm` for every hull.
    pub fn decide(&mut self, tick: &mut Tick, orders: &BTreeMap<String, Orders>) {
        tick.enter(Phase::Decide);
        let time = tick.time;
        // The actor stays in place: every callee here already skips the ship it
        // is steering (by identity or by team), so an index-based split shows
        // the same fleet in the same order without memmoving the whole vector
        // out and back twice a tick.
        for i in 0..self.actors.len() {
            let def = self.actors[i].compiled.definition.clone();
            self.actors[i].sea = Some((self.sea.clone(), time));
            let team = self.actors[i].team;
            // The post-damage call at the end of the previous tick already left
            // this state current; nothing between the two touches its inputs.
            // On the mission cadence the sweep is a refresh, not a dependency:
            // gunnery re-derives the disabled set from `combat_lost` and
            // magazine availability, and mission scoring reads raw state.
            if tick.capability_sweep {
                let wing = self.aviation.wing(&self.actors[i].motion.id);
                capability::update(&mut self.actors[i], &def, wing);
            }
            // The captain seam: the vessel's standing orders (player relay or
            // PvE admiral) and what it may see go in, one decision comes out,
            // and it is applied here and nowhere else.
            let decision = if self.actors[i].physical_loss().is_some() {
                Decision {
                    helm: HelmCommand::default(),
                    target: Target::Engage(None),
                }
            } else {
                let mut crew = Crew::lift(&mut self.actors[i]);
                let watch = Watch {
                    fleet: &self.actors,
                    index: i,
                    orders,
                    reports: self.mission_rules.as_ref().map(|_| Reports {
                        sensors: &self.sensors,
                        contacts: &self.navigation_reports[team.index()],
                        visibility_m: self.visual_conditions.visibility_m,
                    }),
                    islands: &self.islands,
                    terrain: &self.catalog.terrain,
                    trails: &self.trails,
                    torpedoes: &self.torpedoes,
                    tick: self.tick,
                    time,
                };
                let standing = orders.get(self.actors[i].motion.id.as_str());
                let decision = self.captain.conn(&watch, &mut crew, standing);
                crew.restore(&mut self.actors[i]);
                decision
            };
            if let Target::Engage(target_id) = decision.target {
                self.actors[i].target_id = target_id;
            }
            let mut command = decision.helm;
            // The arena's rule, not the captain's: every helm, whoever gave
            // it, is kept inside the mission area and off the land.
            if let Some(mission) = &self.mission_rules {
                command = avoid_land(
                    &self.actors[i].motion,
                    mission.area.constrain(&self.actors[i], command),
                    &self.islands,
                );
            }
            tick.set_helm(&self.actors[i].motion.id, command);
        }
    }
    /// **Manoeuvre.** Every hull steams on this tick's helm, then hulls that
    /// met collide and hulls that met the coast ground.
    ///
    /// Reads: `tick.helm` by hull id, each hull's handling, engine and
    /// steering health, the sea. Writes: each vessel's `helm` and `motion`,
    /// contact damage, and — published at once, ahead of the sink — the
    /// contact events and their records.
    pub fn manoeuvre(&mut self, tick: &mut Tick) {
        tick.enter(Phase::Manoeuvre);
        for a in self.actors.iter_mut() {
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
            let command = tick.helm(&a.motion.id);
            a.helm = command;
            step_ship(&mut a.motion, command, h, power, steering, sea)
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
    }
    /// **Fight.** Every hull's batteries, tubes and launchers operate against
    /// its target, then the air wings fly, and every projectile now in flight
    /// is known to the records.
    ///
    /// Reads: `orders` (gun input, weapons policy, focus target), each hull's
    /// `target_id`, the mission's sensors, the fleet. Writes: mounts, tubes
    /// and launchers, `secondary_bot`, `firing_visibility_seconds`, `shells`,
    /// `torpedoes`, `depth_charges`, `air_releases`, `aviation`, `sequence`,
    /// `dispersion`, `records.sources`; events into the sink.
    pub fn fight(&mut self, tick: &mut Tick, orders: &BTreeMap<String, Orders>) {
        tick.enter(Phase::Fight);
        let time = tick.time;
        for actor in &mut self.actors {
            actor.firing_visibility_seconds = (actor.firing_visibility_seconds - DT).max(0.0);
        }
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
                let mut battery = a.secondary_bot.take();
                self.captain.secondary_battery(
                    a,
                    &self.sensors,
                    orders
                        .get(&a.motion.id)
                        .and_then(|o| o.target_id.as_deref()),
                    self.seed,
                    time,
                    &mut battery,
                );
                a.secondary_bot = battery;
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
                    events: &mut tick.events,
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
                &mut tick.events,
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
                events: &mut tick.events,
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
    }
    /// **Strike.** Every projectile in flight advances one tick: shells fly,
    /// burst, splash or pass through; torpedoes run and hit, dud or expire;
    /// depth charges sink and detonate.
    ///
    /// Reads: islands, terrain, the sea surface. Writes: `shells`,
    /// `torpedoes`, `depth_charges` (ended ones removed), the struck hulls'
    /// damage and capability, `tick.completed`; events into the sink.
    pub fn strike(&mut self, tick: &mut Tick) {
        tick.enter(Phase::Strike);
        let time = tick.time;
        for i in (0..self.shells.len()).rev() {
            let (end, mut emitted) = crate::projectile::advance_projectile(
                &mut self.shells[i],
                &mut self.actors,
                DT,
                &self.islands,
                &self.catalog.terrain,
                &|x, z| self.sea.height(x, z, time),
            );
            tick.events.append(&mut emitted);
            if let Some(end) = end {
                tick.completed.push((self.shells[i].id, end.as_str()));
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
            &mut tick.events,
        );
        step_charges(
            &mut self.depth_charges,
            &mut self.actors,
            &self.aviation,
            &mut tick.events,
        );
    }
    /// **Suffer.** Every hull takes this tick's consequences: damage-control
    /// orders and, on the control cadence, one window of fires and repairs;
    /// flooding and stability against the sea; the submarine's depth on this
    /// tick's helm; weapon capability re-derived; a hull that went under
    /// raises its sinking.
    ///
    /// Reads: `orders` (damage-control priority and focus), `tick.helm` by
    /// hull id, `tick.control_step`, the sea, the air wing. Writes: each
    /// vessel's `damage`, floodwater, stability, `motion` (depth, heave),
    /// capability; events into the sink.
    pub fn suffer(&mut self, tick: &mut Tick, orders: &BTreeMap<String, Orders>) {
        tick.enter(Phase::Suffer);
        let time = tick.time;
        // Fires and damage-control work integrate over a whole window on the
        // mission cadence: the same equations, one explicit Euler step of
        // `damage_control_ticks * DT` instead of that many tick-sized ones.
        // Hits still raise heat every tick through `damage_control::heat_*`.
        let control_step = tick.control_step;
        for a in self.actors.iter_mut() {
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
                tick.events.push(DamageEvent {
                    kind: "module".into(),
                    ship_id: e.ship_id,
                    position: e.position,
                    message: format!("{} ignition · ammunition lost, hull opened", m.name),
                    detonation: Some(true),
                    ..Default::default()
                });
            }
            // Whether the hull was already under when this tick's flooding
            // began: a sinking is raised once, on the tick it happens.
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
            let helm = tick.helm(&a.motion.id);
            crate::submarine::step_submarine(a, def, helm, DT, response.map_or(0.0, |r| r.heave));
            let id = a.motion.id.clone();
            capability::update(a, def, self.aviation.wing(&id));
            if !sunk && a.damage.sunk {
                tick.events.push(DamageEvent {
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
    }
    /// **Settle.** Publish every event the tick raised, in order; close the
    /// shell histories that ended; close the records for the tick Observe
    /// opened; advance the counter; judge the outcome of the tick that just
    /// closed.
    ///
    /// Reads: the sink, `tick.completed`, every projectile still in flight,
    /// the fleet. Writes: `events` and `team_events` (through `emit`),
    /// `sensors` (confirmed sinkings and losses), `records`, `tick`,
    /// `outcome`. Leaves the tick idle for the next `begin`.
    pub fn settle(&mut self, tick: &mut Tick) {
        tick.enter(Phase::Settle);
        for e in tick.events.drain(..) {
            self.emit(e)
        }
        for (id, end) in tick.completed.drain(..) {
            self.records.complete_shell(id, end)
        }
        // One reused sorted buffer instead of a fresh BTreeSet of node
        // allocations for every projectile in flight, every tick.
        tick.active.clear();
        tick.active.extend(
            self.shells
                .iter()
                .map(|s| s.id)
                .chain(self.torpedoes.iter().map(|t| t.id))
                .chain(self.depth_charges.iter().map(|c| c.id)),
        );
        tick.active.sort_unstable();
        self.records.finish_tick(&self.actors, &tick.active);
        // The counter advances first: the outcome is judged for the tick that
        // just closed, and `remaining_seconds` counts from the same value.
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
        tick.enter(Phase::Idle);
    }
}
