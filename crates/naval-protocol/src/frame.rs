//! The frame a seat receives: the battle's declared frame
//! (`naval_sim::snapshot::BattleFrame`) plus what only the session knows. Both
//! transports send exactly this, through the one codec
//! (`naval_sim::frame_delta`); the generated `SessionFrame.ts` is the client's
//! type for it. Declared here because the server and the custom-battle
//! worker both name it and the battle cannot: helm seats, standing orders and
//! connection state belong to the session.
use crate::session::{FleetNotice, FleetOrderState, Session};
use naval_sim::{
    frame_delta::FrameDelta,
    rules::TeamId,
    snapshot::{FullFrame, TeamFrame},
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;

/// Where the match stands. Local battles only run and finish; the server adds
/// the load barrier, the countdown and cancellation.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Loading,
    Countdown,
    Running,
    Finished,
    Cancelled,
}
impl Phase {
    /// The server's phase names, which are also its wire spelling.
    pub fn parse(phase: &str) -> Option<Self> {
        Some(match phase {
            "loading" => Self::Loading,
            "countdown" => Self::Countdown,
            "running" => Self::Running,
            "finished" => Self::Finished,
            "cancelled" => Self::Cancelled,
            _ => return None,
        })
    }
}

/// What a seat sees. `B` is the battle frame for that seat's knowledge
/// ([`FullFrame`] or [`TeamFrame`]), flattened. The session fields that only
/// one transport sets are absent, never null, when unset.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SessionFrame<'a, B> {
    #[serde(flatten)]
    #[ts(flatten)]
    pub battle: B,
    /// The ship each seat holds the helm of; `None` when the seat's fleet
    /// sails on standing orders.
    pub selected_ship_ids: [Option<&'a str>; 2],
    /// The receiving owner's acknowledged standing orders. Local only: a server
    /// frame is shared by both seats and carries neither's.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub fleet_orders: Option<BTreeMap<String, FleetOrderState>>,
    /// Fleet news for the receiving owner, oldest first. Local only.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub fleet_notices: Option<&'a [FleetNotice]>,
    pub phase: Phase,
    /// Why the match ended early, when the server ended it.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub reason: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub connected: Option<[bool; 2]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub loaded: Option<[bool; 2]>,
    /// Seconds until the simulation clock starts, during the countdown.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub countdown: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub connection_epochs: Option<[u32; 2]>,
}

/// Connection state the server adds to every frame it publishes.
#[derive(Clone, Copy, Debug)]
pub struct Connection<'a> {
    pub phase: Phase,
    pub reason: Option<&'a str>,
    pub connected: [bool; 2],
    pub loaded: [bool; 2],
    pub countdown: Option<f64>,
}

impl Session {
    /// The frame a local seat (owner 0) receives: the team's knowledge for a
    /// live mission, everything otherwise, narrowed to `detail`.
    pub fn local_team_frame<'a>(
        &'a self,
        detail: &'a [String],
    ) -> Result<SessionFrame<'a, TeamFrame<'a>>, serde_json::Error> {
        Ok(self.local_frame(self.battle.team_frame(TeamId::A, detail)?, true))
    }
    /// See [`Self::local_team_frame`].
    pub fn local_full_frame<'a>(&'a self, detail: &'a [String]) -> SessionFrame<'a, FullFrame<'a>> {
        self.local_frame(self.battle.full_frame(detail), false)
    }
    fn local_frame<'a, B>(&'a self, battle: B, own_seat_only: bool) -> SessionFrame<'a, B> {
        let selected = &self.control.players;
        SessionFrame {
            battle,
            selected_ship_ids: [
                selected[0].selected_ship_id.as_deref(),
                if own_seat_only {
                    None
                } else {
                    selected[1].selected_ship_id.as_deref()
                },
            ],
            fleet_orders: Some(self.fleet_orders(0)),
            fleet_notices: Some(self.fleet_notices(0)),
            phase: if self.battle.outcome.is_some() {
                Phase::Finished
            } else {
                Phase::Running
            },
            reason: None,
            connected: None,
            loaded: None,
            countdown: None,
            connection_epochs: None,
        }
    }
    /// The frame the server publishes to both seats: full knowledge, every
    /// hull in full, plus connection state.
    pub fn server_frame<'a>(
        &'a self,
        connection: Connection<'a>,
    ) -> SessionFrame<'a, FullFrame<'a>> {
        let players = &self.control.players;
        SessionFrame {
            battle: self.battle.full_frame(&[]),
            selected_ship_ids: [
                players[0].selected_ship_id.as_deref(),
                players[1].selected_ship_id.as_deref(),
            ],
            fleet_orders: None,
            fleet_notices: None,
            phase: connection.phase,
            reason: connection.reason,
            connected: Some(connection.connected),
            loaded: Some(connection.loaded),
            countdown: connection.countdown,
            connection_epochs: Some(std::array::from_fn(|i| players[i].epoch)),
        }
    }
    /// The immutable match baseline: the server frame at admission, as the
    /// encoder every publication forks from and as the complete text every
    /// client receives with its match metadata. Both are the same normalized
    /// frame, so a client applies each update to exactly what the encoder
    /// diffed against.
    pub fn server_baseline(
        &self,
        connection: Connection<'_>,
    ) -> Result<(FrameDelta, String), serde_json::Error> {
        let frame = self.server_frame(connection);
        let mut delta = FrameDelta::default();
        delta.encode(&frame)?;
        Ok((delta, FrameDelta::complete(&frame)?))
    }
}
