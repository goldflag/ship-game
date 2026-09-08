//! Strict versioned wire inputs. Sender identity comes from the authenticated connection.
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;
pub const PROTOCOL_VERSION: u32 = 3;
pub const MAX_COMMAND_BYTES: usize = 4096;
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum Battery {
    Main,
    Secondary,
    Torpedo,
    DepthCharge,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum Ammo {
    Ap,
    He,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HeldInput {
    /// False preserves a standing movement order while the player aims and fires.
    pub manual_helm: Option<bool>,
    pub throttle: f64,
    pub rudder: f64,
    pub aim: [f64; 3],
    pub fire: bool,
    pub battery: Battery,
    pub weapon_group_id: Option<String>,
    pub ammunition: Ammo,
    pub depth_m: Option<f64>,
    pub emergency_blow: Option<bool>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Command {
    Air {
        flight_id: String,
        order: naval_sim::aircraft::AirOrder,
    },
    Recall {
        flight_id: Option<String>,
    },
    DamageControl {
        priority: ControlPriority,
        focus: Option<String>,
    },
    Select,
    Input {
        input: HeldInput,
    },
    Move {
        position: [f64; 2],
    },
    Focus {
        target_id: String,
    },
    Hold,
    Autonomous,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum ControlPriority {
    Balanced,
    Flooding,
    Fires,
    Repairs,
}
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommandEnvelope {
    pub sequence: u32,
    pub connection_epoch: u32,
    pub ship_id: String,
    pub command: Command,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "kebab-case", deny_unknown_fields)]
pub enum MovementOrder {
    Autonomous,
    Hold,
    Move { position: [f64; 2] },
}
#[derive(Clone, Debug)]
pub struct ShipControl {
    pub owner: usize,
    pub afloat: bool,
    pub movement: MovementOrder,
    pub target_id: Option<String>,
    pub input: Option<HeldInput>,
    input_tick: u64,
}
#[derive(Clone, Debug)]
pub struct PlayerControl {
    pub epoch: u32,
    pub selected_ship_id: Option<String>,
    sequence: u32,
    connected: bool,
}
#[derive(Clone, Debug)]
pub struct FleetControl {
    pub ships: BTreeMap<String, ShipControl>,
    pub players: [PlayerControl; 2],
    input_timeout_ticks: u64,
}
#[derive(Clone, Debug, thiserror::Error, PartialEq, Eq)]
pub enum CommandError {
    #[error("Command is too large")]
    TooLarge,
    #[error("Malformed command")]
    Malformed,
    #[error("Connection has been replaced")]
    StaleConnection,
    #[error("Sequence has already been applied")]
    Duplicate,
    #[error("Ship does not belong to this player")]
    Ownership,
    #[error("Ship has been lost")]
    Lost,
    #[error("Select the ship before using direct controls")]
    NotSelected,
    #[error("Target must be a surviving enemy vessel")]
    Target,
    #[error("Input outside allowed bounds")]
    Bounds,
}
pub fn decode_command(bytes: &[u8]) -> Result<CommandEnvelope, CommandError> {
    if bytes.len() > MAX_COMMAND_BYTES {
        return Err(CommandError::TooLarge);
    }
    let c: CommandEnvelope = serde_json::from_slice(bytes).map_err(|_| CommandError::Malformed)?;
    validate_command(&c)?;
    Ok(c)
}
fn validate_command(c: &CommandEnvelope) -> Result<(), CommandError> {
    if c.sequence == 0 || c.ship_id.is_empty() || c.ship_id.len() > 128 {
        return Err(CommandError::Bounds);
    }
    let coordinate = |n: &f64| n.is_finite() && n.abs() <= 40000.0;
    let identity = |s: &str| !s.is_empty() && s.len() <= 128;
    match &c.command {
        Command::Air { flight_id, order } => {
            if !identity(flight_id) {
                return Err(CommandError::Bounds);
            }
            use naval_sim::aircraft::AirOrder;
            let valid = match order {
                AirOrder::Attack { target_id } => identity(target_id),
                AirOrder::Patrol { point } => point.iter().all(coordinate),
                AirOrder::Defend { target_id } => target_id.as_ref().is_none_or(|id| identity(id)),
                AirOrder::Intercept { flight_id } | AirOrder::Escort { flight_id } => {
                    identity(flight_id)
                }
                AirOrder::Return => true,
            };
            if !valid {
                return Err(CommandError::Bounds);
            }
        }
        Command::Recall { flight_id } => {
            if flight_id.as_ref().is_some_and(|id| !identity(id)) {
                return Err(CommandError::Bounds);
            }
        }
        Command::DamageControl { focus, .. } => {
            if focus.as_ref().is_some_and(|id| !identity(id)) {
                return Err(CommandError::Bounds);
            }
        }
        Command::Input { input: i } => {
            if !i.throttle.is_finite()
                || i.throttle.abs() > 1.0
                || !i.rudder.is_finite()
                || i.rudder.abs() > 1.0
                || i.aim.iter().any(|n| !coordinate(n))
                || i.depth_m
                    .is_some_and(|d| !d.is_finite() || !(0.0..=1000.0).contains(&d))
                || i.weapon_group_id
                    .as_ref()
                    .is_some_and(|id| id.is_empty() || id.len() > 1024)
            {
                return Err(CommandError::Bounds);
            }
        }
        Command::Move { position } => {
            if position.iter().any(|n| !coordinate(n)) {
                return Err(CommandError::Bounds);
            }
        }
        Command::Focus { target_id } if (target_id.is_empty() || target_id.len() > 128) => {
            return Err(CommandError::Bounds);
        }
        _ => {}
    }
    Ok(())
}
impl FleetControl {
    pub fn new(ships: impl IntoIterator<Item = (String, usize)>) -> Result<Self, CommandError> {
        let mut state = Self {
            ships: BTreeMap::new(),
            players: std::array::from_fn(|_| PlayerControl {
                epoch: 1,
                selected_ship_id: None,
                sequence: 0,
                connected: true,
            }),
            input_timeout_ticks: naval_sim::rules::Rules::default().held_input_timeout_ms
                * naval_sim::rules::TICK_RATE
                / 1000,
        };
        for (id, owner) in ships {
            if owner >= 2 || state.ships.contains_key(&id) || id.is_empty() {
                return Err(CommandError::Ownership);
            }
            state.players[owner]
                .selected_ship_id
                .get_or_insert_with(|| id.clone());
            state.ships.insert(
                id,
                ShipControl {
                    owner,
                    afloat: true,
                    movement: MovementOrder::Autonomous,
                    target_id: None,
                    input: None,
                    input_tick: 0,
                },
            );
        }
        Ok(state)
    }
    /// Called only after decoding and within the worker's deterministic command order.
    pub fn apply(
        &mut self,
        sender: usize,
        command: CommandEnvelope,
        tick: u64,
    ) -> Result<(), CommandError> {
        // Revalidate typed callers too; direct construction cannot bypass wire bounds.
        validate_command(&command)?;
        let p = self.players.get(sender).ok_or(CommandError::Ownership)?;
        if !p.connected || p.epoch != command.connection_epoch {
            return Err(CommandError::StaleConnection);
        }
        if command.sequence <= p.sequence {
            return Err(CommandError::Duplicate);
        }
        let ship = self
            .ships
            .get(&command.ship_id)
            .ok_or(CommandError::Ownership)?;
        if ship.owner != sender {
            return Err(CommandError::Ownership);
        }
        if !ship.afloat {
            return Err(CommandError::Lost);
        }
        if matches!(command.command, Command::Input { .. })
            && p.selected_ship_id.as_deref() != Some(&command.ship_id)
        {
            return Err(CommandError::NotSelected);
        }
        if let Command::Focus { target_id } = &command.command
            && !self
                .ships
                .get(target_id)
                .is_some_and(|s| s.owner != sender && s.afloat)
        {
            return Err(CommandError::Target);
        }
        if matches!(command.command, Command::Select) {
            if let Some(old) = p
                .selected_ship_id
                .as_ref()
                .and_then(|id| self.ships.get_mut(id))
            {
                old.input = None;
            }
            self.players[sender].selected_ship_id = Some(command.ship_id.clone());
        }
        let ship = self.ships.get_mut(&command.ship_id).unwrap();
        match command.command {
            Command::Air { .. }
            | Command::Recall { .. }
            | Command::DamageControl { .. }
            | Command::Select => {}
            Command::Input { input } => {
                ship.input = Some(input);
                ship.input_tick = tick;
            }
            Command::Move { position } => ship.movement = MovementOrder::Move { position },
            Command::Hold => ship.movement = MovementOrder::Hold,
            Command::Focus { target_id } => ship.target_id = Some(target_id),
            Command::Autonomous => {
                ship.movement = MovementOrder::Autonomous;
                ship.target_id = None;
            }
        }
        self.players[sender].sequence = command.sequence;
        Ok(())
    }
    pub fn expire_inputs(&mut self, tick: u64) {
        for s in self.ships.values_mut() {
            if tick.saturating_sub(s.input_tick) >= self.input_timeout_ticks {
                s.input = None;
            }
        }
    }
    pub fn disconnect(&mut self, player: usize, epoch: u32) -> bool {
        let Some(p) = self.players.get_mut(player) else {
            return false;
        };
        if p.epoch != epoch {
            return false;
        }
        p.connected = false;
        for s in self.ships.values_mut().filter(|s| s.owner == player) {
            s.input = None;
        }
        true
    }
    pub fn reconnect(&mut self, player: usize) -> Result<u32, CommandError> {
        let p = self
            .players
            .get_mut(player)
            .ok_or(CommandError::Ownership)?;
        p.epoch = p
            .epoch
            .checked_add(1)
            .ok_or(CommandError::StaleConnection)?;
        p.sequence = 0;
        p.connected = true;
        for s in self.ships.values_mut().filter(|s| s.owner == player) {
            s.input = None;
        }
        Ok(p.epoch)
    }
}

pub mod session;
