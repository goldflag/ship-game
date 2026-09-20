//! Carrier aircraft state and orders. Positions and mechanisms are CPU authoritative.
use crate::{definition::Vec3, rules::TeamId};
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum AirOrder {
    #[serde(rename = "search-area")]
    SearchArea {
        center: [f64; 2],
        #[serde(rename = "radiusM")]
        radius_m: f64,
        altitude: SearchAltitude,
        policy: SearchPolicy,
    },
    Strike {
        #[serde(rename = "contactId")]
        contact_id: String,
    },
    #[serde(rename = "intercept-contact")]
    InterceptContact {
        #[serde(rename = "contactId")]
        contact_id: String,
    },
    Attack {
        #[serde(rename = "targetId")]
        target_id: String,
    },
    Patrol {
        point: Vec3,
    },
    Defend {
        #[serde(rename = "targetId")]
        #[ts(optional = nullable)]
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
/// Search choices are operational tuning, not new aircraft capabilities.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
pub enum SearchAltitude {
    Low,
    Medium,
    High,
}
impl SearchAltitude {
    pub(super) fn metres(self) -> f64 {
        match self {
            Self::Low => 200.0,
            Self::Medium => 850.0,
            Self::High => 1500.0,
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
pub enum SearchPolicy {
    Report,
    Shadow,
    Strike,
}
#[derive(Clone, Debug, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct SearchProgress {
    pub entry_position: Vec3,
    pub route: Vec<Vec3>,
    pub waypoint: usize,
    pub elapsed_seconds: f64,
    pub deadline_seconds: f64,
    pub shadow_seconds: f64,
    /// Actual flown samples, never a promise that nearby water is empty.
    pub trail: Vec<SearchSample>,
}
#[derive(Clone, Debug, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct SearchSample {
    pub position: Vec3,
    #[ts(type = "number")]
    pub tick: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(optional_fields)]
pub struct AirFlight {
    pub id: String,
    pub name: String,
    pub squadron_id: String,
    pub plane_ids: Vec<String>,
    pub order: AirOrder,
    pub notice: Option<String>,
    pub merged_into: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(optional_fields)]
pub struct Aircraft {
    pub id: String,
    pub owner_id: String,
    pub team: TeamId,
    pub squadron_id: String,
    pub model_id: String,
    #[ts(type = "import('../../ships/blueprint').AircraftRole")]
    pub role: String,
    #[ts(as = "crate::frame_vocabulary::FlightPhase")]
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
    /// Managed routing datum, distinct from the fitted visual root.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deck_datum: Option<Vec3>,
    #[serde(skip)]
    pub deck_local_attitude: Option<crate::aviation::aircraft_flight::FlightAttitude>,
    pub deck_position: Option<Vec3>,
    pub deck_heading: Option<f64>,
    pub timer: f64,
    pub flight_time: f64,
    pub cooldown: f64,
    pub target_id: Option<String>,
    /// Absent in a team frame: kills are scored from team reports there.
    #[ts(as = "Option<_>")]
    pub kills: u32,
    pub controls: crate::aviation::aircraft_flight::FlightControls,
    pub previous_controls: Option<crate::aviation::aircraft_flight::FlightControls>,
    pub previous_attitude: Option<crate::aviation::aircraft_flight::FlightAttitude>,
    /// Published as the pilot's visible activity alone (see
    /// [`AircraftBehavior`]); controller state stays private.
    #[ts(rename = "behavior", as = "Option<AircraftBehavior>")]
    pub pilot: AirPilot,
    pub deck_slot: Option<usize>,
    pub flight_id: Option<String>,
    pub recovery_requested_at: Option<f64>,
    pub loss_reason: Option<String>,
    pub navigation_target: Option<Vec3>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub search: Option<SearchProgress>,
    pub sortie: Option<u32>,
    pub wreck: Option<AirWreck>,
}
#[derive(Clone, Debug, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct AirWreck {
    pub age: f64,
    pub roll_rate: f64,
    pub impacted: bool,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AirPilot {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub maneuver: Option<crate::aviation::aircraft_tactics::FighterManeuver>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub formation: Option<crate::aviation::aircraft_formation::FormationState>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub defense: Option<crate::aviation::aircraft_defense::DefenseState>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recovery: Option<crate::aviation::aircraft_recovery::RecoveryProgress>,
    pub fire_discipline: Option<crate::aviation::air_gunnery::FireDiscipline>,
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
    /// Seconds spent orbiting a lost strike report; bounds the search.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub search_seconds: f64,
}
/// What the frame publishes of a pilot: the notices and manoeuvre a flight
/// line can show. The presentation filter writes it in the pilot's place
/// (`presentation::aircraft_behavior`); every other pilot field stays private.
#[derive(Clone, Debug, Default, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(optional_fields)]
pub struct AircraftBehavior {
    pub recovery_notice: Option<String>,
    pub evasion_notice: Option<String>,
    pub maneuver: Option<String>,
}
fn is_zero(v: &f64) -> bool {
    *v == 0.0
}
#[derive(Clone, Debug, Default, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(optional_fields)]
pub struct AirWingState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recovery: Option<crate::aviation::air_recovery::CarrierRecovery>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deck: Option<crate::aviation::deck_operations::DeckStatus>,
    pub planes: Vec<Aircraft>,
    pub launch_cooldown: f64,
    pub flights: Vec<AirFlight>,
    pub flight_sequence: u32,
    pub transfer_cooldown: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(optional_fields)]
pub struct AirRelease {
    #[ts(type = "number")]
    pub id: i64,
    pub owner_id: String,
    pub position: Vec3,
    pub velocity: Vec3,
    #[serde(skip_serializing_if = "Option::is_none")]
    /// Another team's weapon is cut to its visible dimensions and speed in a team
    /// frame (`team_view`); the owner's travels whole.
    #[ts(
        type = "Pick<import('../../ships/blueprint').TorpedoPart, 'diameterM' | 'lengthM' | 'speed'> & Partial<import('../../ships/blueprint').TorpedoPart>",
        optional
    )]
    pub weapon: Option<crate::definition::TorpedoPart>,
}
pub(super) const FIGHTER_AMMO_BURSTS: f64 = 16.0;
/// Assign a closed-set string in place. The stored bytes are identical to
/// `*slot = value.into()`; only the allocation is reused.
#[inline]
pub(super) fn set_str(slot: &mut String, value: &str) {
    if slot != value {
        slot.clear();
        slot.push_str(value);
    }
}
#[inline]
pub(super) fn set_opt_str(slot: &mut Option<String>, value: &str) {
    match slot {
        Some(existing) => set_str(existing, value),
        None => *slot = Some(value.to_owned()),
    }
}
pub(super) fn terminal_phase(phase: &str) -> bool {
    matches!(phase, "lost" | "withdrawn")
}
pub(super) fn airborne_phase(phase: &str) -> bool {
    matches!(
        phase,
        "takeoff" | "outbound" | "attack" | "returning" | "landing"
    )
}
pub fn terminal(p: &Aircraft) -> bool {
    terminal_phase(&p.phase)
}
pub fn airborne(p: &Aircraft) -> bool {
    airborne_phase(&p.phase)
}
pub(super) fn in_flight(p: &Aircraft) -> bool {
    airborne(p) && p.hp > 0.0
}
/// What a pilot is permitted to observe about another aircraft, borrowed
/// rather than cloned. Every field carries exactly the value the previous
/// `Aircraft` copy carried, so pilot decisions are unchanged; the fields the
/// pilot controllers never read are simply absent.
#[derive(Clone, Copy, Debug)]
pub(super) struct PlaneView<'a> {
    pub id: &'a str,
    pub flight_id: Option<&'a str>,
    pub hostile_id: Option<&'a str>,
    pub team: TeamId,
    pub role: &'a str,
    pub phase: &'a str,
    pub position: Vec3,
    pub velocity: Vec3,
    pub hp: f64,
    pub ammo: f64,
}
impl<'a> PlaneView<'a> {
    /// True airspeed; `velocity` is paced world motion, as on the aircraft itself.
    pub(super) fn airspeed(&self) -> f64 {
        crate::geometry::length(self.velocity) / crate::mobility::SHIP_PACE
    }
    pub(super) fn of(p: &'a Aircraft) -> Self {
        Self {
            id: &p.id,
            flight_id: p.flight_id.as_deref(),
            hostile_id: p.pilot.hostile_id.as_deref(),
            team: p.team,
            role: &p.role,
            phase: &p.phase,
            position: p.position,
            velocity: p.velocity,
            hp: p.hp,
            ammo: p.ammo,
        }
    }
    pub(super) fn in_flight(&self) -> bool {
        airborne_phase(self.phase) && self.hp > 0.0
    }
}
pub(crate) fn on_flight_deck(p: &Aircraft) -> bool {
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
        || p.phase == "takeoff" && p.timer <= crate::aviation::aircraft_flight::TAKEOFF_ROLL_SECONDS
}
pub fn active_flight(f: &AirFlight, planes: &[Aircraft]) -> bool {
    planes.iter().any(|p| {
        p.flight_id.as_ref() == Some(&f.id)
            && !matches!(
                p.phase.as_str(),
                "ready"
                    | "rearming"
                    | "lost"
                    | "withdrawn"
                    | "hangar"
                    | "repairing"
                    | "raising"
                    | "lowering"
            )
    })
}
pub(super) fn aircraft_service_seconds(base: f64, hp: f64) -> f64 {
    base * (1.0 + (100.0 - hp.clamp(0.0, 100.0)) / 100.0)
}
impl Aircraft {
    /// True airspeed. `velocity` is world motion, which carries the world pace.
    pub(super) fn airspeed(&self) -> f64 {
        crate::geometry::length(self.velocity) / crate::mobility::SHIP_PACE
    }
    pub(super) fn forward(&self) -> Vec3 {
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
    ground: &std::collections::BTreeMap<String, crate::aviation::aircraft_deck::GroundPose>,
) -> Option<AirWingState> {
    let wing = def.air_wing.as_ref()?;
    Some(AirWingState {
        recovery: None,
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
                    deck_datum: None,
                    deck_local_attitude: None,
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
                    search: None,
                    sortie: None,
                    wreck: None,
                })
            })
            .collect(),
        ..Default::default()
    })
}
