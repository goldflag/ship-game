//! Carrier aircraft state and orders. Positions and mechanisms are CPU authoritative.
use crate::{definition::Vec3, rules::TeamId};
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum AirOrder {
    Attack {
        #[serde(rename = "targetId")]
        target_id: String,
    },
    Patrol {
        point: Vec3,
    },
    Defend {
        #[serde(rename = "targetId")]
        target_id: Option<String>,
    },
    Intercept {
        #[serde(rename = "flightId")]
        flight_id: String,
    },
    Escort {
        #[serde(rename = "flightId")]
        flight_id: String,
    },
    Return,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AirFlight {
    pub id: String,
    pub name: String,
    pub squadron_id: String,
    pub plane_ids: Vec<String>,
    pub order: AirOrder,
    pub notice: Option<String>,
    pub merged_into: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Aircraft {
    pub id: String,
    pub owner_id: String,
    pub team: TeamId,
    pub squadron_id: String,
    pub model_id: String,
    pub role: String,
    pub phase: String,
    pub position: Vec3,
    pub previous_position: Vec3,
    pub velocity: Vec3,
    pub heading: f64,
    pub pitch: f64,
    pub bank: f64,
    pub hp: f64,
    pub ammo: f64,
    pub payload: bool,
    pub wing_fold: f64,
    pub deck_position: Option<Vec3>,
    pub deck_heading: Option<f64>,
    pub timer: f64,
    pub flight_time: f64,
    pub cooldown: f64,
    pub target_id: Option<String>,
    pub kills: u32,
    pub controls: crate::aircraft_flight::FlightControls,
    pub previous_controls: Option<crate::aircraft_flight::FlightControls>,
    pub previous_attitude: Option<crate::aircraft_flight::FlightAttitude>,
    pub pilot: AirPilot,
    pub deck_slot: Option<usize>,
    pub flight_id: Option<String>,
    pub recovery_requested_at: Option<f64>,
    pub loss_reason: Option<String>,
    pub navigation_target: Option<Vec3>,
    pub sortie: Option<u32>,
    pub wreck: Option<AirWreck>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AirWreck {
    pub age: f64,
    pub roll_rate: f64,
    pub impacted: bool,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AirPilot {
    pub fire_discipline: Option<crate::air_gunnery::FireDiscipline>,
    pub think: f64,
    pub hostile_id: Option<String>,
    pub aim_time: f64,
    pub break_time: f64,
    pub break_cooldown: f64,
    pub break_point: Option<Vec3>,
    pub attack_heading: Option<f64>,
    pub attack_stage: Option<String>,
    pub attempts: u32,
    pub recovery_stage: Option<String>,
    pub recovery_side: Option<f64>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AirWingState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deck: Option<crate::deck_operations::DeckStatus>,
    pub planes: Vec<Aircraft>,
    pub launch_cooldown: f64,
    pub flights: Vec<AirFlight>,
    pub flight_sequence: u32,
    pub transfer_cooldown: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AirRelease {
    pub id: i64,
    pub owner_id: String,
    pub position: Vec3,
    pub velocity: Vec3,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub weapon: Option<crate::definition::TorpedoPart>,
}
pub const FIGHTER_AMMO_BURSTS: f64 = 16.0;
pub fn airborne(p: &Aircraft) -> bool {
    matches!(
        p.phase.as_str(),
        "takeoff" | "outbound" | "attack" | "returning" | "landing"
    )
}
pub fn in_flight(p: &Aircraft) -> bool {
    airborne(p) && p.hp > 0.0
}
pub fn on_flight_deck(p: &Aircraft) -> bool {
    p.deck_slot.is_some()
        && matches!(
            p.phase.as_str(),
            "ready"
                | "queued"
                | "taxi"
                | "rollout"
                | "parking"
                | "rearming"
                | "raising"
                | "lowering"
                | "launch-ready"
        )
        || p.phase == "takeoff" && p.timer <= crate::aircraft_flight::TAKEOFF_ROLL_SECONDS
}
pub fn active_flight(f: &AirFlight, planes: &[Aircraft]) -> bool {
    planes.iter().any(|p| {
        p.flight_id.as_ref() == Some(&f.id)
            && !matches!(
                p.phase.as_str(),
                "ready" | "rearming" | "lost" | "hangar" | "repairing" | "raising" | "lowering"
            )
    })
}
pub fn aircraft_service_seconds(base: f64, hp: f64) -> f64 {
    base * (1.0 + (100.0 - hp.clamp(0.0, 100.0)) / 100.0)
}
impl Aircraft {
    pub fn forward(&self) -> Vec3 {
        [
            self.heading.sin() * self.pitch.cos(),
            self.pitch.sin(),
            -self.heading.cos() * self.pitch.cos(),
        ]
    }
}
pub fn create_air_wing(
    def: &crate::definition::ShipDefinition,
    owner_id: &str,
    team: TeamId,
    ground: &std::collections::BTreeMap<String, crate::aircraft_deck::GroundPose>,
) -> Option<AirWingState> {
    let wing = def.air_wing.as_ref()?;
    Some(AirWingState {
        planes: wing
            .squadrons
            .iter()
            .flat_map(|s| {
                (0..s.count as usize).map(move |i| Aircraft {
                    id: format!("{owner_id}/{}/{}", s.id, i + 1),
                    owner_id: owner_id.into(),
                    team,
                    squadron_id: s.id.clone(),
                    model_id: s.model_id.clone(),
                    role: s.role.clone(),
                    phase: "ready".into(),
                    position: [0.0; 3],
                    previous_position: [0.0; 3],
                    velocity: [0.0; 3],
                    heading: 0.0,
                    pitch: 0.0,
                    bank: 0.0,
                    hp: 100.0,
                    ammo: if s.role == "fighter" {
                        FIGHTER_AMMO_BURSTS
                    } else {
                        0.0
                    },
                    payload: s.role != "fighter",
                    wing_fold: if ground[&s.model_id].folding_wings {
                        1.0
                    } else {
                        0.0
                    },
                    deck_position: None,
                    deck_heading: None,
                    timer: 0.0,
                    flight_time: 0.0,
                    cooldown: 0.0,
                    target_id: None,
                    kills: 0,
                    controls: Default::default(),
                    previous_controls: None,
                    previous_attitude: None,
                    pilot: Default::default(),
                    deck_slot: None,
                    flight_id: None,
                    recovery_requested_at: None,
                    loss_reason: None,
                    navigation_target: None,
                    sortie: None,
                    wreck: None,
                })
            })
            .collect(),
        ..Default::default()
    })
}
