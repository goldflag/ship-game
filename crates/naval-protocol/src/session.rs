//! Authenticated addressed commands drive the same battle used by local WASM.
use crate::*;
use naval_sim::{
    battle::{Battle, Movement, Orders},
    gunnery::PlayerGunOrders,
    motion::HelmCommand,
    rules::{FinishReason, Outcome, TeamId, afloat_kg},
    vessel::Controller,
    weapons::Ammunition,
};
pub struct Session {
    pub input_ready: [bool; 2],
    pub battle: Battle,
    pub control: FleetControl,
    pub owners: [TeamId; 2],
    priorities: BTreeMap<String, (String, String)>,
}
impl Session {
    pub fn new(battle: Battle, owners: [TeamId; 2]) -> Result<Self, CommandError> {
        if owners[0] == owners[1] {
            return Err(CommandError::Ownership);
        }
        let control = FleetControl::new(
            battle
                .actors
                .iter()
                .map(|a| (a.motion.id.clone(), if a.team == owners[0] { 0 } else { 1 })),
        )?;
        Ok(Self {
            input_ready: [true; 2],
            battle,
            control,
            owners,
            priorities: BTreeMap::new(),
        })
    }
    pub fn apply(&mut self, sender: usize, c: CommandEnvelope) -> Result<(), CommandError> {
        if self.battle.outcome.is_some() {
            return Err(CommandError::Lost);
        }
        self.control.apply(sender, c.clone(), self.battle.tick)?;
        let actor = self
            .battle
            .actors
            .iter()
            .find(|a| a.motion.id == c.ship_id)
            .ok_or(CommandError::Ownership)?;
        match c.command {
            Command::Air { flight_id, order } => {
                if !self.battle.command_air(&c.ship_id, &flight_id, order) {
                    return Err(CommandError::Target);
                }
            }
            Command::Recall { flight_id } => {
                if self.battle.aviation.wing(&c.ship_id).is_none_or(|w| {
                    flight_id
                        .as_ref()
                        .is_some_and(|id| !w.flights.iter().any(|f| f.id == *id))
                }) {
                    return Err(CommandError::Target);
                }
                self.battle
                    .aviation
                    .recall(&c.ship_id, flight_id.as_deref())
            }
            Command::DamageControl { priority, focus } => {
                let focus = focus.unwrap_or_default();
                if !focus.is_empty()
                    && !actor
                        .definition()
                        .compartments
                        .iter()
                        .any(|c| c.id == focus)
                    && !actor.definition().mounts.iter().any(|m| m.id == focus)
                {
                    return Err(CommandError::Target);
                }
                let priority = match priority {
                    ControlPriority::Balanced => "balanced",
                    ControlPriority::Flooding => "flooding",
                    ControlPriority::Fires => "fires",
                    ControlPriority::Repairs => "repairs",
                };
                self.priorities.insert(c.ship_id, (priority.into(), focus));
            }
            _ => (),
        }
        Ok(())
    }
    pub fn step(&mut self) {
        self.control.expire_inputs(self.battle.tick);
        let mut orders = BTreeMap::new();
        for a in &mut self.battle.actors {
            let c = &self.control.ships[&a.motion.id];
            let selected = self.input_ready[c.owner]
                && self.control.players[c.owner].connected
                && self.control.players[c.owner].selected_ship_id.as_ref() == Some(&a.motion.id);
            a.controller = if selected {
                Controller::Player
            } else {
                Controller::Bot
            };
            let mut o = Orders {
                movement: match c.movement {
                    MovementOrder::Autonomous => Movement::Autonomous,
                    MovementOrder::Hold => Movement::Hold,
                    MovementOrder::Move { position } => Movement::Move { position },
                },
                target_id: c.target_id.clone(),
                control: self.priorities.get(&a.motion.id).cloned(),
                ..Default::default()
            };
            if selected {
                let input = c.input.as_ref();
                let battery = input.map_or("main", |i| match i.battery {
                    Battery::Main => "main",
                    Battery::Secondary => "secondary",
                    Battery::Torpedo => "torpedo",
                    Battery::DepthCharge => "depth-charge",
                });
                let kind = input.map_or(Ammunition::Ap, |i| {
                    if i.ammunition == Ammo::He {
                        Ammunition::He
                    } else {
                        Ammunition::Ap
                    }
                });
                let group = input.and_then(|i| i.weapon_group_id.clone());
                o.guns = Some(PlayerGunOrders {
                    battery: battery.into(),
                    weapon_group_id: group.clone(),
                    aim: input.map(|i| i.aim),
                    fire: input.is_some_and(|i| i.fire),
                    ammunition: BTreeMap::from([(group.unwrap_or_else(|| battery.into()), kind)]),
                });
                o.helm = input
                    .filter(|i| i.manual_helm != Some(false))
                    .map(|i| HelmCommand {
                        throttle: i.throttle,
                        rudder: i.rudder,
                        depth_m: i.depth_m,
                        emergency_blow: i.emergency_blow,
                    });
            }
            orders.insert(a.motion.id.clone(), o);
        }
        self.battle.step(&orders);
        for a in &self.battle.actors {
            self.control.ships.get_mut(&a.motion.id).unwrap().afloat = a.physical_loss().is_none();
        }
    }
    pub fn finish(&mut self, winner: Option<TeamId>, reason: FinishReason) {
        if self.battle.outcome.is_none() {
            self.battle.outcome = Some(Outcome {
                winner_team_id: winner,
                reason,
                final_tick: self.battle.tick,
                afloat_kg: afloat_kg(&self.battle.survivors()),
            });
        }
    }
}
