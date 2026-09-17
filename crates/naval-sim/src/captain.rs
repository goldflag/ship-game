//! The captain seam: one interface between what a vessel has been told and
//! what its helm and batteries actually do this tick.
//!
//! Three order sources reach `Battle::step`. The player relay and the PvE
//! admiral both arrive as standing [`Orders`] in the map `step` is handed:
//! the session builds the player's from protocol commands (direct helm, gun
//! input, movement, focus target, weapons policy) and the local runtime
//! copies the admiral's [`crate::admiral`] directives into the same standing
//! orders. The third source is the captain — the ship's own seeded,
//! renderer-free crew — and until this seam existed it ran inline in `step`,
//! writing `target_id`, `navigation` and `secondary_bot` straight into the
//! vessel, so no bot decision could be logged, replayed or scripted.
//!
//! [`Captain`] is the interface: given a [`Watch`] (what the vessel may see),
//! its [`Crew`] memory and its standing orders, an adapter yields one
//! [`Decision`]. `step` applies every decision in one place. Two adapters make
//! the seam real: [`BotCaptain`], which is the decision loop that used to run
//! inline, and the scripted captains in `tests/captain.rs`.
//!
//! The bot captain is a seam extraction, not a behaviour change: it consumes
//! the crew's seeded generator in exactly the order the inline loop did, so
//! the simulation equality gate stays bit-identical.
use crate::{
    battle::Orders,
    bots::{self, AiLevel, BotState},
    environment::{Island, TerrainField, avoid_land},
    geometry::{clamp, wrap_angle},
    motion::HelmCommand,
    navigation::{self, Movement, NavigationState, Trails},
    sensors::{ContactTrack, Sensors},
    torpedoes::Torpedo,
    vessel::{Controller, Vessel},
};
use std::collections::BTreeMap;

/// What a mission captain is allowed to know: the team's report store and the
/// navigation reports sampled on the sensor cadence. A legacy custom or server
/// battle has no reports; its captains see every hull in the [`Watch`].
pub struct Reports<'a> {
    pub sensors: &'a Sensors,
    /// This team's contacts as of the last sensor sample.
    pub contacts: &'a [ContactTrack],
    /// Weather visibility for torpedo wakes, metres.
    pub visibility_m: f64,
}

/// A vessel's view of the world for one tick. The vessel itself is
/// `fleet[index]`, with its crew memory lifted out into the [`Crew`] the
/// captain is handed alongside this view.
pub struct Watch<'a> {
    /// Every hull in `Battle::actors` order. Legacy battles are omniscient;
    /// mission captains only use own-team hulls from it and read the enemy
    /// through `reports`.
    pub fleet: &'a [Vessel],
    pub index: usize,
    /// Standing orders for the whole fleet: a guide reads its escorts' orders
    /// to know who is keeping station on it.
    pub orders: &'a BTreeMap<String, Orders>,
    /// `Some` in a mission battle, `None` in a legacy one.
    pub reports: Option<Reports<'a>>,
    pub islands: &'a [Island],
    pub terrain: &'a [TerrainField],
    pub trails: &'a Trails,
    pub torpedoes: &'a [Torpedo],
    pub tick: u64,
    pub time: f64,
}
impl Watch<'_> {
    pub fn actor(&self) -> &Vessel {
        &self.fleet[self.index]
    }
}

/// The captain's memory, carried on the hull between ticks so it serialises
/// with the vessel: the crew model with its seeded generator, and the state of
/// the standing order being executed. Lifted off the vessel for the decision
/// and restored afterwards, so the captain reads the fleet immutably while it
/// advances its own state.
#[derive(Default)]
pub struct Crew {
    pub bot: Option<BotState>,
    pub navigation: Option<NavigationState>,
}
impl Crew {
    pub fn lift(vessel: &mut Vessel) -> Self {
        Self {
            bot: vessel.bot.take(),
            navigation: vessel.navigation.take(),
        }
    }
    pub fn restore(self, vessel: &mut Vessel) {
        vessel.bot = self.bot;
        vessel.navigation = self.navigation;
    }
}

/// What the batteries are to engage after this decision.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Target {
    /// The captain did not have the conn or the guns this tick; the vessel
    /// keeps whatever target it had.
    Keep,
    /// Engage this contact or hull, or `None` to disengage.
    Engage(Option<String>),
}

/// One tick's decision for one vessel.
#[derive(Clone, Debug, PartialEq)]
pub struct Decision {
    pub helm: HelmCommand,
    pub target: Target,
}

/// The seam. `Battle::step` consults the captain twice a tick for every hull
/// that is still afloat: [`conn`](Self::conn) before the hulls move, and
/// [`secondary_battery`](Self::secondary_battery) after they have, when the
/// gunnery pass needs the secondary battery's own track.
pub trait Captain {
    /// The helm and main-battery target for this tick. `standing` is the
    /// vessel's entry in the orders map, if any: a direct helm in it takes the
    /// conn from the captain, a movement in it is the captain's to execute.
    fn conn(&self, watch: &Watch<'_>, crew: &mut Crew, standing: Option<&Orders>) -> Decision;
    /// Mission battles only: the secondary battery's own crew model and
    /// track, kept apart from the main battery's so the two engage
    /// independently. `battery` is the crew model lifted off the vessel, or
    /// `None` before the battery has ever had a contact to engage.
    fn secondary_battery(
        &self,
        actor: &Vessel,
        sensors: &Sensors,
        requested: Option<&str>,
        seed: u32,
        time: f64,
        battery: &mut Option<BotState>,
    );
}

/// The seeded crew: the bot decision loop that used to run inline in
/// `Battle::step`, stage for stage and in the same order.
pub struct BotCaptain;
impl Captain for BotCaptain {
    fn conn(&self, w: &Watch<'_>, crew: &mut Crew, standing: Option<&Orders>) -> Decision {
        let actor = w.actor();
        let def = actor.definition();
        let team = actor.team;
        let mut command = HelmCommand::default();
        let mut target = Target::Keep;
        // What the batteries may engage. Mission captains score the team's
        // permitted reports for their strongest battery; legacy captains pick
        // the nearest hull outright.
        let contact = w.reports.as_ref().and_then(|r| {
            let mount = bots::battery_mount(actor, false)
                .or_else(|| bots::battery_mount(actor, true))
                .and_then(|m| def.mounts.iter().position(|d| std::ptr::eq(d, m)));
            let position = [actor.motion.x, actor.motion.y, actor.motion.z];
            let requested = standing.and_then(|o| o.target_id.as_deref());
            if let Some(mount) = mount {
                r.sensors.battery_target(
                    team,
                    position,
                    &def.mounts[mount],
                    requested,
                    actor.target_id.as_deref(),
                )
            } else {
                r.sensors
                    .surface_target(team, position, requested, actor.target_id.as_deref())
            }
        });
        let passive = crew.bot.as_ref().is_some_and(|b| b.ai_level.passive());
        let target_index = w
            .reports
            .is_none()
            .then(|| {
                standing
                    .and_then(|o| o.target_id.as_ref())
                    .and_then(|id| {
                        w.fleet.iter().position(|a| {
                            a.motion.id == *id && a.team != team && a.physical_loss().is_none()
                        })
                    })
                    .or_else(|| bots::target(actor, passive, w.fleet))
            })
            .flatten();
        // The captain has the conn, or at least the guns: a player who is not
        // steering or not firing still relies on the crew for the rest.
        if actor.controller == Controller::Bot
            || standing.is_some_and(|o| o.guns.is_none() || o.helm.is_none())
        {
            let bot = crew
                .bot
                .as_mut()
                .expect("every battle hull carries its crew memory");
            if w.reports.is_some() {
                bot.update_contact(actor, def, contact, w.time);
                command = bots::helm_contact(bot, actor, contact, w.fleet);
            } else {
                bot.update(
                    actor,
                    def,
                    target_index.map(|j| (&w.fleet[j].state, w.fleet[j].definition())),
                    w.time,
                );
                command = bots::helm(bot, actor, target_index.map(|j| &w.fleet[j]), w.fleet);
            }
            if bot.ai_level != AiLevel::Static {
                command = avoid_land(&actor.motion, command, w.islands)
            }
            target = Target::Engage(
                contact
                    .map(|c| c.id.clone())
                    .or_else(|| target_index.map(|j| w.fleet[j].motion.id.clone())),
            );
        }
        // Standing orders: a direct helm takes the conn; a movement order is
        // executed through navigation, which keeps its own state in the crew.
        if let Some(o) = standing {
            if let Some(helm) = o.helm {
                command = helm
            } else {
                match &o.movement {
                    Movement::Autonomous => {
                        if w.reports.is_some() {
                            let formation = navigation::formation_report(
                                actor,
                                w.fleet,
                                w.orders,
                                o.formation_policy,
                                w.trails,
                            );
                            command.throttle = command.throttle.min(
                                formation.speed_limit_mps
                                    / navigation::maximum_speed(actor).max(0.05),
                            );
                            let mut state = crew
                                .navigation
                                .take()
                                .filter(|s| s.order == o.movement)
                                .unwrap_or_else(|| NavigationState::new(o.movement.clone()));
                            state.status = if !formation.stragglers.is_empty()
                                && o.formation_policy
                                    == navigation::FormationPolicy::SlowForStragglers
                            {
                                navigation::NavigationStatus::SlowingForStragglers
                            } else {
                                navigation::NavigationStatus::FollowingRoute
                            };
                            state.formation = Some(formation);
                            crew.navigation = Some(state);
                        }
                    }
                    Movement::Hold => command = HelmCommand::default(),
                    Movement::Move { position: [x, z] } => {
                        let motion = &actor.motion;
                        let distance = (x - motion.x).hypot(z - motion.z);
                        let angle = wrap_angle((x - motion.x).atan2(motion.z - z) - motion.heading);
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
                            w.islands,
                        )
                    }
                    Movement::Route { .. } | Movement::HoldArea { .. } | Movement::Escort { .. } => {
                        let mut state = crew
                            .navigation
                            .take()
                            .unwrap_or_else(|| NavigationState::new(o.movement.clone()));
                        let speed_limit = w
                            .fleet
                            .iter()
                            .filter(|a| {
                                a.motion.id != actor.motion.id
                                    && a.team == team
                                    && a.physical_loss().is_none()
                            })
                            .filter(|a| {
                                w.orders.get(&a.motion.id).is_some_and(|o| {
                                    matches!(&o.movement, Movement::Escort { leader_id, .. } if leader_id == &actor.motion.id)
                                })
                            })
                            .map(|a| a.definition().handling.forward_speed * 0.85)
                            .fold(def.handling.forward_speed, f64::min);
                        let formation = w.reports.as_ref().map(|_| {
                            navigation::formation_report(
                                actor,
                                w.fleet,
                                w.orders,
                                o.formation_policy,
                                w.trails,
                            )
                        });
                        let speed_limit = formation
                            .as_ref()
                            .map_or(speed_limit, |f| f.speed_limit_mps);
                        command = navigation::command_observed(
                            actor,
                            w.fleet,
                            w.islands,
                            &o.movement,
                            &mut state,
                            w.tick,
                            speed_limit,
                            w.trails,
                            w.reports.as_ref().map(|r| r.contacts),
                        );
                        if formation.as_ref().is_some_and(|f| !f.stragglers.is_empty())
                            && o.formation_policy
                                == navigation::FormationPolicy::SlowForStragglers
                            && state.status == navigation::NavigationStatus::FollowingRoute
                        {
                            state.status = navigation::NavigationStatus::SlowingForStragglers;
                        }
                        state.formation = formation;
                        crew.navigation = Some(state);
                    }
                }
            }
        }
        // Threat response: a mission captain not under direct helm turns away
        // from reported aircraft and visible wakes, preserving its standing
        // order and current waypoint.
        if let Some(r) = &w.reports
            && actor.physical_loss().is_none()
            && standing.is_none_or(|o| o.helm.is_none())
            && crew
                .bot
                .as_ref()
                .is_some_and(|b| !matches!(b.ai_level, AiLevel::Static | AiLevel::Moving))
        {
            let mut state = crew.navigation.take().unwrap_or_else(|| {
                NavigationState::new(standing.map_or(Movement::Autonomous, |o| o.movement.clone()))
            });
            let wakes = crate::fleet_evasion::visible_wakes(
                actor,
                w.torpedoes,
                w.islands,
                w.terrain,
                r.visibility_m,
            );
            command =
                crate::fleet_evasion::command(actor, r.contacts, &wakes, w.tick, &mut state, command);
            if matches!(
                state.status,
                navigation::NavigationStatus::EvadingAircraft
                    | navigation::NavigationStatus::EvadingTorpedo
            ) {
                command = navigation::safe_correction(actor, w.fleet, r.contacts, &mut state, command);
            }
            crew.navigation = Some(state);
        }
        Decision {
            helm: command,
            target,
        }
    }
    fn secondary_battery(
        &self,
        actor: &Vessel,
        sensors: &Sensors,
        requested: Option<&str>,
        seed: u32,
        time: f64,
        battery: &mut Option<BotState>,
    ) {
        let secondary = bots::battery_mount(actor, true).and_then(|mount| {
            sensors.battery_target(
                actor.team,
                [actor.motion.x, actor.motion.y, actor.motion.z],
                mount,
                requested,
                battery
                    .as_ref()
                    .and_then(|b| b.track.as_ref())
                    .map(|t| t.id.as_str()),
            )
        });
        if secondary.is_some() || battery.is_some() {
            let def = actor.definition();
            let mut bot = battery.take().unwrap_or_else(|| {
                BotState::new(
                    &format!("{}:secondary", actor.motion.id),
                    def,
                    seed,
                    actor.bot.as_ref().map_or(AiLevel::Normal, |b| b.ai_level),
                )
            });
            bot.update_contact(actor, def, secondary, time);
            *battery = Some(bot);
        }
    }
}
