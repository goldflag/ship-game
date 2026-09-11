//! Self-contained presentation state. Transport adapters may encode a baseline
//! against this state; simulation objects never come back from clients.
use crate::{
    aircraft::AirRelease,
    aviation::CarrierWing,
    battle::{Battle, Event},
    depth_charges::DepthCharge,
    records::Records,
    rules::Outcome,
    shell::Shell,
    torpedoes::Torpedo,
    vessel::Vessel,
};
#[derive(Clone, Copy)]
pub enum PresentationView {
    FullKnowledge,
    Team(crate::rules::TeamId),
}
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
    pub events: &'a [Event],
    pub outcome: &'a Option<Outcome>,
    pub records: &'a Records,
    pub afloat_kg: [u64; 2],
    pub remaining_seconds: Option<f64>,
}
/// Ships whose damage-control rooms, portable pumping and flood connections are
/// worth their bandwidth: only the hull whose damage-control panel is on screen
/// reads them. An empty list keeps them for every ship, which is what the
/// server, the migration checks and the differential tests want.
pub(crate) fn detailed(detail: &[String], id: &str) -> bool {
    detail.is_empty() || detail.iter().any(|d| d == id)
}
impl Battle {
    pub fn presentation_snapshot(&self) -> impl serde::Serialize + '_ {
        self.detailed_presentation_snapshot(&[])
    }
    /// Full-knowledge streaming projection, narrowed to `detail` (see [`detailed`]).
    pub fn detailed_presentation_snapshot<'a>(
        &'a self,
        detail: &'a [String],
    ) -> impl serde::Serialize + 'a {
        crate::presentation::Presentation(self.snapshot(), detail)
    }
    pub fn team_presentation_snapshot(
        &self,
        team: crate::rules::TeamId,
    ) -> impl serde::Serialize + '_ {
        self.detailed_team_presentation_snapshot(team, &[])
    }
    /// Team projection, narrowed to `detail` (see [`detailed`]).
    pub fn detailed_team_presentation_snapshot<'a>(
        &'a self,
        team: crate::rules::TeamId,
        detail: &'a [String],
    ) -> impl serde::Serialize + 'a {
        crate::presentation::TeamPresentation(self, team, detail)
    }
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
}
impl Battle {
    /// Preserve the game's inspectable damage model, while keeping bot tracking,
    /// RNG, blast budgets and collision ledgers behind the authority boundary.
    pub fn presentation_value(
        &self,
        viewer: PresentationView,
    ) -> Result<serde_json::Value, serde_json::Error> {
        self.presentation_value_impl(viewer, true, &[])
    }
    /// The tree projection, narrowed to `detail` (see [`detailed`]). Only the
    /// local worker uses this; the server always publishes every hull in full.
    pub fn detailed_presentation_value(
        &self,
        viewer: PresentationView,
        detail: &[String],
    ) -> Result<serde_json::Value, serde_json::Error> {
        self.presentation_value_impl(viewer, true, detail)
    }
    /// The streaming team projection supplies owned hulls itself. All other
    /// fields still pass through the same information-boundary implementation.
    pub(crate) fn team_presentation_fields(
        &self,
        team: crate::rules::TeamId,
    ) -> Result<serde_json::Value, serde_json::Error> {
        self.presentation_value_impl(PresentationView::Team(team), false, &[])
    }
    fn presentation_value_impl(
        &self,
        viewer: PresentationView,
        include_owned_actors: bool,
        detail: &[String],
    ) -> Result<serde_json::Value, serde_json::Error> {
        let mut frame = match viewer {
            PresentationView::FullKnowledge => serde_json::to_value(self.snapshot())?,
            // Do not serialize hidden hull damage and carrier state merely to
            // discard them afterward. Effects are whitelisted in team_view.
            PresentationView::Team(team) => serde_json::json!({
                "actors": self.actors.iter().filter(|a| include_owned_actors && a.team == team).collect::<Vec<_>>(),
                "wings": self.aviation.wings.iter().filter(|w| self.actors.iter().any(|a| a.team == team && a.motion.id == w.owner_id)).collect::<Vec<_>>(),
                "shells": self.shells, "torpedoes": self.torpedoes,
                "depthCharges": self.depth_charges, "releases": self.air_releases,
            }),
        };
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
        match viewer {
            PresentationView::FullKnowledge => Ok(frame),
            PresentationView::Team(team) => self.team_presentation(frame, team),
        }
    }
}
