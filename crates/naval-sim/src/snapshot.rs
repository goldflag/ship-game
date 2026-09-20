//! The battle's half of the frame the renderer consumes, declared once as
//! [`BattleFrame`] and exported to TypeScript from here. The session's half
//! (`naval_protocol::frame::SessionFrame`) flattens it and adds what a seat
//! sees that the battle does not know: the helm ship, standing orders, phase.
//!
//! Two instantiations exist. [`FullFrame`] streams every hull through the
//! presentation filter (custom battles, the match server, the debrief).
//! [`TeamFrame`] is the information boundary for a live mission: owned hulls
//! stream through the same filter, everything else is what the team's sensors
//! report. Simulation objects never come back from clients.
use crate::{
    aviation::{AirRelease, CarrierWing, FlightControls},
    battle::{Battle, Event},
    depth_charges::DepthCharge,
    mission::MissionRules,
    presentation::{Actors, Filtered, Mode, TeamActors},
    recon::ReconCoverage,
    records::Records,
    rules::{Outcome, TeamId},
    sensors::ContactTrack,
    shell::Shell,
    torpedoes::Torpedo,
    vessel::Vessel,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, VecDeque};
use ts_rs::TS;

#[derive(Clone, Copy)]
pub enum PresentationView {
    FullKnowledge,
    Team(crate::rules::TeamId),
}
/// Complete authority state, for the migration checks and the simulation
/// equality gate. Not a frame: nothing here is filtered.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot<'a> {
    pub tick: u64,
    pub actors: &'a [Vessel],
    pub wings: &'a [CarrierWing],
    pub shells: &'a [Shell],
    pub torpedoes: &'a [Torpedo],
    pub depth_charges: &'a [DepthCharge],
    pub releases: &'a [AirRelease],
    /// The event ring buffer, which serialises as the same JSON array a slice
    /// did. Kept as the deque so a snapshot needs no contiguity pass.
    pub events: &'a std::collections::VecDeque<Event>,
    pub outcome: &'a Option<Outcome>,
    pub records: &'a Records,
    pub afloat_kg: [u64; 2],
    pub remaining_seconds: Option<f64>,
}

/// The battle half of a frame. Every field a receiver may read is declared
/// here; the generated `BattleFrame.ts` is the client's type for it.
///
/// The eight collection parameters are the projections whose element shapes
/// are filtered views of simulation objects rather than declared types (a hull
/// without its bot, a shell without its damage ledger): Rust instantiates them
/// with streaming adapters, TypeScript with arrays of the element types it
/// renders. Declaring those element shapes in Rust is the next candidate; this
/// frame is where they will land. `X` is the debrief's own instantiation,
/// hidden from the TypeScript signature where it is simply the frame again.
///
/// Optional fields are absent, never null, on the wire and on the receiver:
/// the frame codec (`frame_delta`) owns that invariant for every nested
/// object too, with one declared exception (`frame_delta::KEEP_NULL`).
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(
    export,
    concrete(X = ()),
    bound = "A: TS, W: TS, S: TS, T: TS, D: TS, R: TS, E: TS, C: TS"
)]
pub struct BattleFrame<'a, A, W, S, T, D, R, E, C, X> {
    #[ts(type = "number")]
    pub tick: u64,
    pub actors: A,
    pub wings: W,
    pub shells: S,
    pub torpedoes: T,
    pub depth_charges: D,
    pub releases: R,
    pub events: E,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub outcome: Option<&'a Outcome>,
    pub records: C,
    /// Tonnage afloat per stable team; a team view knows only its own.
    #[ts(type = "[number | null, number | null]")]
    pub afloat_kg: [Option<u64>; 2],
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub remaining_seconds: Option<f64>,
    // A team view carries what its sensors report instead of the other side.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub view: Option<TeamView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub team: Option<TeamId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub mission_rules: Option<&'a MissionRules>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub contacts: Option<Vec<ContactTrack>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub observed_ships: Option<Vec<ObservedShip>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub observed_aircraft: Option<Vec<ObservedAircraft>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub recon_coverage: Option<ReconCoverage>,
    /// Every hull's fate, on the debrief only.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub ship_outcomes: Option<BTreeMap<String, ShipOutcome>>,
    /// Every hit, shot count and damage tally, once the battle is decided: on a
    /// team view's debrief, and on the full frame a custom battle plays from.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub after_action: Option<&'a crate::records::AfterAction>,
    /// Full information once the mission is decided, never in the active world.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "BattleFrame<A, W, S, T, D, R, E, C>")]
    pub debrief: Option<Box<X>>,
    /// The mission generation record, on a PvE debrief, for a results export
    /// the client does not read yet.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "unknown")]
    pub mission: Option<Value>,
}

/// Marks a frame projected for one team.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum TeamView {
    Team,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum ShipOutcome {
    Operational,
    Sunk,
    Incapacitated,
}
/// A surface contact as the team last saw it. Health is a sampled 0–1
/// fraction. Gun attitudes are visible from outside: `[train, elevation,
/// recoil]` per mount and the train of each torpedo launcher, both in
/// definition order. Readiness and ammunition are not.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ObservedShip {
    pub id: String,
    pub preset_id: String,
    pub position: [f64; 3],
    pub heading: f64,
    pub pitch: f64,
    pub roll: f64,
    pub velocity: [f64; 3],
    #[ts(type = "number")]
    pub observed_tick: u64,
    pub health: f64,
    pub mounts: Vec<[f64; 3]>,
    pub launchers: Vec<f64>,
    pub observers: Vec<String>,
}
/// An aircraft contact as the team last saw it. A slung torpedo or bomb is
/// visible from outside, so the observation carries it; rounds are not.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ObservedAircraft {
    pub id: String,
    pub model_id: String,
    pub position: [f64; 3],
    pub heading: f64,
    pub pitch: f64,
    pub roll: f64,
    pub velocity: [f64; 3],
    #[ts(type = "number")]
    pub observed_tick: u64,
    pub health: f64,
    pub controls: FlightControls,
    pub wing_fold: f64,
    pub payload: bool,
    pub observers: Vec<String>,
}

/// Every hull, streamed through the presentation filter.
pub type FullFrame<'a> = BattleFrame<
    'a,
    Actors<'a>,
    Filtered<'a, [CarrierWing]>,
    Filtered<'a, [Shell]>,
    &'a [Torpedo],
    &'a [DepthCharge],
    &'a [AirRelease],
    &'a VecDeque<Event>,
    &'a Records,
    (),
>;
/// One team's knowledge: owned hulls streamed, the rest as observed.
pub type TeamFrame<'a> = BattleFrame<
    'a,
    TeamActors<'a>,
    Vec<Value>,
    Vec<Value>,
    Vec<Value>,
    Vec<Value>,
    Vec<Value>,
    &'a VecDeque<Event>,
    Records,
    FullFrame<'a>,
>;

/// Ships whose damage-control rooms, portable pumping and flood connections are
/// worth their bandwidth: only the hull whose damage-control panel is on screen
/// reads them. An empty list keeps them for every ship, which is what the
/// server, the migration checks and the differential tests want.
pub(crate) fn detailed(detail: &[String], id: &str) -> bool {
    detail.is_empty() || detail.iter().any(|d| d == id)
}
impl Battle {
    pub fn snapshot(&self) -> Snapshot<'_> {
        Snapshot {
            tick: self.tick,
            actors: &self.actors,
            wings: &self.aviation.wings,
            shells: &self.shells,
            torpedoes: &self.torpedoes,
            depth_charges: &self.depth_charges,
            releases: &self.air_releases,
            events: &self.events,
            outcome: &self.outcome,
            records: &self.records,
            afloat_kg: crate::rules::afloat_kg(&self.survivors()),
            remaining_seconds: self.remaining_seconds(),
        }
    }
    /// The full-knowledge frame, narrowed to `detail` (see [`detailed`]).
    pub fn full_frame<'a>(&'a self, detail: &'a [String]) -> FullFrame<'a> {
        BattleFrame {
            tick: self.tick,
            actors: Actors(&self.actors, detail),
            wings: Filtered(&self.aviation.wings, Mode::Wing),
            shells: Filtered(&self.shells, Mode::Shell),
            torpedoes: &self.torpedoes,
            depth_charges: &self.depth_charges,
            releases: &self.air_releases,
            events: &self.events,
            outcome: self.outcome.as_ref(),
            records: &self.records,
            afloat_kg: crate::rules::afloat_kg(&self.survivors()).map(Some),
            remaining_seconds: self.remaining_seconds(),
            view: None,
            team: None,
            mission_rules: None,
            contacts: None,
            observed_ships: None,
            observed_aircraft: None,
            recon_coverage: None,
            ship_outcomes: None,
            // Full knowledge already; the report is only worth its bytes once decided.
            after_action: self.outcome.is_some().then_some(&self.records.after_action),
            debrief: None,
            mission: None,
        }
    }
}
impl Battle {
    /// The migration-era tree projection: the same frame as [`Self::full_frame`]
    /// and [`Self::team_frame`], with hull, wing and shell filtering done on a
    /// JSON tree by the original code. The differential tests compare the
    /// streaming filter against it field for field; nothing ships it.
    pub fn presentation_value(
        &self,
        viewer: PresentationView,
    ) -> Result<serde_json::Value, serde_json::Error> {
        self.detailed_presentation_value(viewer, &[])
    }
    /// The tree projection, narrowed to `detail` (see [`detailed`]).
    pub fn detailed_presentation_value(
        &self,
        viewer: PresentationView,
        detail: &[String],
    ) -> Result<serde_json::Value, serde_json::Error> {
        match viewer {
            PresentationView::FullKnowledge => self.reference_tree(detail),
            PresentationView::Team(team) => {
                let mut frame = serde_json::to_value(self.team_frame(team, detail)?)?;
                frame["actors"] = Value::Array(self.reference_team_actors(team, detail)?);
                if frame.get("debrief").is_some() {
                    frame["debrief"]["actors"] = self.reference_tree(&[])?["actors"].take();
                }
                Ok(frame)
            }
        }
    }
    /// Full knowledge with the original tree filter (see [`Self::presentation_value`]).
    pub(crate) fn reference_tree(&self, detail: &[String]) -> Result<Value, serde_json::Error> {
        let mut frame = serde_json::to_value(self.snapshot())?;
        // The declared frame leaves an undecided outcome and an unlimited clock
        // absent rather than null.
        for key in ["outcome", "remainingSeconds"] {
            if frame[key].is_null() {
                frame.as_object_mut().unwrap().remove(key);
            }
        }
        for actor in frame["actors"].as_array_mut().unwrap() {
            let detailed = detailed(detail, actor["motion"]["id"].as_str().unwrap_or_default());
            let actor = actor.as_object_mut().unwrap();
            let level = actor.get("bot").and_then(|b| b.get("aiLevel")).cloned();
            actor.remove("bot");
            if !detailed {
                // Portable pumping and flood connections reach only the on-screen
                // damage-control panel; a room keeps the two fields hull fire
                // effects and the inspection view read for every ship.
                actor["damage"]["control"]["pumping"] = serde_json::json!([]);
                actor["damage"]["connections"] = serde_json::json!([]);
                for room in actor["damage"]["control"]["rooms"].as_array_mut().unwrap() {
                    room.as_object_mut()
                        .unwrap()
                        .retain(|key, _| matches!(key.as_str(), "heat" | "intensity"));
                }
            }
            // Compartment volumes and hull pose fully determine water surfaces.
            // The browser's read-only inspection reconstructs these cached meshes;
            // sending every dry compartment's tilted plane dominates bandwidth.
            actor["damage"]["stability"]["water"] = serde_json::json!([]);
            if let Some(level) = level {
                actor.insert("aiLevel".into(), level);
            }
            for mount in actor["mounts"].as_array_mut().unwrap() {
                let m = mount.as_object_mut().unwrap();
                m.remove("leadCache");
                m.remove("aaDiscipline");
                if let Some(cache) = m.get_mut("aimCache").and_then(|c| c.as_object_mut()) {
                    cache.remove("point");
                }
            }
        }
        for wing in frame["wings"].as_array_mut().unwrap() {
            for plane in wing["state"]["planes"].as_array_mut().unwrap() {
                let plane = plane.as_object_mut().unwrap();
                if let Some(pilot) = plane.remove("pilot") {
                    plane.insert(
                        "behavior".into(),
                        serde_json::Value::Object(crate::presentation::aircraft_behavior(&pilot)),
                    );
                }
            }
        }
        for shell in frame["shells"].as_array_mut().unwrap() {
            let s = shell.as_object_mut().unwrap();
            for key in [
                "visited",
                "remainingModuleDamage",
                "hullDamage",
                "hullDamageConsumed",
                "hullRegionDamage",
                "equipmentDamage",
                "wreckageShips",
                "detonateAtAge",
                "lastHitShipId",
                "lodged",
            ] {
                s.remove(key);
            }
        }
        Ok(frame)
    }
    /// The team's own hulls with the original tree filter, targets addressed
    /// as the team knows them (see [`Self::presentation_value`]).
    fn reference_team_actors(
        &self,
        team: TeamId,
        detail: &[String],
    ) -> Result<Vec<Value>, serde_json::Error> {
        let Value::Array(actors) = self.reference_tree(detail)?["actors"].take() else {
            unreachable!("actors is an array");
        };
        Ok(actors
            .into_iter()
            .filter(|actor| actor["team"] == serde_json::to_value(team).unwrap())
            .map(|mut actor| {
                // A captain's target is an opaque observation ID in PvE.
                if let Some(id) = actor["targetId"].as_str() {
                    actor["targetId"] = self
                        .public_entity_id(id, team)
                        .map_or(Value::Null, Value::String);
                }
                actor
            })
            .collect())
    }
}
