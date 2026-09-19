//! Team projection is an authority boundary. Nothing here reconstructs enemy
//! damage, ammunition, orders or motion from a hidden Vessel for presentation.
use crate::{
    battle::Battle,
    impact::DamageEvent,
    presentation::{Filtered, Mode, TeamActors},
    records::{Records, VesselScore},
    rules::{TeamId, mix32},
    sensors::ContactKind,
    snapshot::{BattleFrame, ObservedAircraft, ObservedShip, ShipOutcome, TeamFrame, TeamView},
};
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

impl Battle {
    pub(crate) fn point_observable(&self, point: [f64; 3], team: TeamId) -> bool {
        let entities = crate::sensors::entities(&self.actors, &self.aviation);
        self.point_visible_to(point, team, &entities)
    }
    fn point_visible_to(
        &self,
        point: [f64; 3],
        team: TeamId,
        entities: &[crate::sensors::VisualEntity],
    ) -> bool {
        let conditions = self.visual_conditions;
        entities
            .iter()
            .filter(|e| e.team == team && e.can_observe())
            .any(|observer| {
                let distance = (point[0] - observer.eye[0]).hypot(point[2] - observer.eye[2]);
                let reach: f64 = if observer.kind == ContactKind::Aircraft {
                    12000.0
                } else {
                    6000.0
                };
                let horizon = 3570.0 * (observer.eye[1].max(0.0).sqrt() + point[1].max(0.0).sqrt());
                distance <= reach.min(conditions.visibility_m).min(horizon)
                    && crate::sensors::line_visible(
                        observer.eye,
                        point,
                        &self.islands,
                        &self.catalog.terrain,
                    )
            })
    }
    pub(crate) fn public_entity_id(&self, id: &str, team: TeamId) -> Option<String> {
        if self
            .actors
            .iter()
            .any(|a| a.team == team && a.motion.id == id)
            || self
                .aviation
                .wings
                .iter()
                .flat_map(|w| &w.state.planes)
                .any(|p| p.team == team && p.id == id)
        {
            return Some(id.into());
        }
        self.sensors
            .track(team, id)
            .map(|c| c.id.clone())
            .or_else(|| self.sensors.contact(team, id).map(|c| c.id.clone()))
    }
    fn public_projectile_id(&self, id: i64, team: TeamId) -> i64 {
        // The integer mixer is a permutation, avoiding count-revealing gaps and
        // preserving cross-frame/effect identity within a battle.
        mix32(id as u32 ^ self.seed ^ (0xa17f_8329_u32.wrapping_mul(team.index() as u32 + 1)))
            as i64
    }
    pub(crate) fn observed_event(&self, event: &DamageEvent, team: TeamId) -> Option<DamageEvent> {
        let own = self
            .actors
            .iter()
            .any(|a| a.team == team && a.motion.id == event.ship_id);
        if !own && !self.point_observable(event.position, team) {
            return None;
        }
        let mut e = event.clone();
        // Only owned sources are disclosed; enemy source identity stays private.
        e.source_id = e.source_id.filter(|id| {
            self.actors
                .iter()
                .any(|a| a.team == team && &a.motion.id == id)
        });
        e.ship_id = self.public_entity_id(&e.ship_id, team).unwrap_or_default();
        e.message = match e.kind.as_str() {
            "shot" => "Gunfire",
            "sunk" => "Ship sinking",
            "module" => "Damage aboard",
            "contact" => "Hull contact",
            "torpedo-launch" => "Torpedo away",
            "aircraft-fire" => "Aircraft fire",
            "aircraft-release" => "Weapon released",
            "burst" => "Explosion",
            "penetration" => "Armor hit",
            "ricochet" => "Ricochet",
            _ => "Combat report",
        }
        .into();
        if !own {
            e.hull_damage = None;
            e.defeat_cause = None;
            e.impact = None;
        }
        if let Some(effect) = e.shell.as_mut() {
            effect.id = self.public_projectile_id(effect.id, team);
        }
        if let Some(effect) = e.torpedo.as_mut() {
            effect.id = self.public_projectile_id(effect.id, team);
        }
        if let Some(effect) = e.depth_charge.as_mut() {
            effect.id = self.public_projectile_id(effect.id, team);
        }
        if let Some(impact) = e.impact.as_mut() {
            impact.shell_id = self.public_projectile_id(impact.shell_id, team);
        }
        if let Some(effect) = e.aircraft.as_mut() {
            effect.id = self
                .public_entity_id(&effect.id, team)
                .unwrap_or_else(|| "unidentified-aircraft".into());
        }
        // Impact evidence describes the owned damaged hull only. Incoming source
        // identity and enemy exact damage are not ordinary combat feedback.
        Some(e)
    }
    /// One team's frame, narrowed to `detail` (see [`crate::snapshot::detailed`]).
    /// Owned hulls stream through the presentation filter; everything else is
    /// what the team's sensors report, addressed through public IDs.
    pub fn team_frame<'a>(
        &'a self,
        team: TeamId,
        detail: &'a [String],
    ) -> Result<TeamFrame<'a>, serde_json::Error> {
        let own: BTreeSet<_> = self
            .actors
            .iter()
            .filter(|a| a.team == team)
            .map(|a| a.motion.id.as_str())
            .collect();
        let mut wings = vec![];
        for wing in self
            .aviation
            .wings
            .iter()
            .filter(|w| own.contains(w.owner_id.as_str()))
        {
            let mut wing = serde_json::to_value(Filtered(wing, Mode::Wing))?;
            for plane in wing["state"]["planes"].as_array_mut().unwrap() {
                let plane = plane.as_object_mut().unwrap();
                // Owned pilot navigation now derives only from own positions
                // and team reports, so the command map can show its actual leg.
                plane.remove("kills");
                if let Some(id) = plane.get("targetId").and_then(Value::as_str) {
                    let id = self.public_entity_id(id, team);
                    plane.insert("targetId".into(), id.map_or(Value::Null, Value::String));
                }
            }
            wings.push(wing);
        }
        let observers = crate::sensors::entities(&self.actors, &self.aviation);
        let projectiles = |items: &[Value]| -> Vec<Value> {
            items
                .iter()
                .filter_map(|p| {
                    let point: [f64; 3] = serde_json::from_value(p["position"].clone()).ok()?;
                    if !self.point_visible_to(point, team, &observers) {
                        return None;
                    }
                    let mut p = p.clone();
                    let object = p.as_object_mut().unwrap();
                    if let Some(id) = object.get("id").and_then(Value::as_i64) {
                        object.insert("id".into(), json!(self.public_projectile_id(id, team)));
                    }
                    let owner_id = object
                        .get("ownerId")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_owned();
                    object.insert(
                        "ownerId".into(),
                        self.public_entity_id(&owner_id, team)
                            .map_or(json!(""), Value::String),
                    );
                    if !own.contains(owner_id.as_str()) {
                        if let Some(weapon) =
                            object.get_mut("weapon").and_then(Value::as_object_mut)
                        {
                            weapon.retain(|key, _| {
                                matches!(key.as_str(), "diameterM" | "lengthM" | "speed")
                            });
                        }
                        for field in [
                            "weaponLabel",
                            "damage",
                            "penetrationMm",
                            "ap",
                            "he",
                            "tubeId",
                            "launcherId",
                        ] {
                            object.remove(field);
                        }
                    }
                    Some(p)
                })
                .collect()
        };
        fn values<T: Serialize>(items: &T) -> Result<Vec<Value>, serde_json::Error> {
            match serde_json::to_value(items)? {
                Value::Array(items) => Ok(items),
                _ => Err(serde::ser::Error::custom("projectiles are an array")),
            }
        }
        let shells = projectiles(&values(&Filtered(&self.shells, Mode::Shell))?);
        let torpedoes = projectiles(&values(&self.torpedoes)?);
        let depth_charges = projectiles(&values(&self.depth_charges)?);
        let releases = projectiles(&values(&self.air_releases)?);
        let contacts = self.sensors.contacts(team);
        let observed_ships: Vec<_> = self
            .sensors
            .observed(team)
            .filter(|(c, _)| {
                c.kind == ContactKind::Surface
                    && !c
                        .visible_condition
                        .as_ref()
                        .is_some_and(|condition| condition.sinking)
            })
            .map(|(c, e)| ObservedShip {
                id: c.id.clone(),
                preset_id: e.preset_id.clone().unwrap_or_default(),
                position: e.position,
                heading: e.motion.heading,
                pitch: e.motion.pitch,
                roll: e.motion.roll,
                velocity: e.motion.velocity,
                observed_tick: c.last_observed_tick,
                health: e.health,
                mounts: e.mounts.clone(),
                launchers: e.launchers.clone(),
                observers: c.sources.iter().map(|s| s.observer_id.clone()).collect(),
            })
            .collect();
        let observed_aircraft: Vec<_> = self
            .sensors
            .observed(team)
            .filter_map(|(c, e)| {
                e.aircraft.as_ref().map(|aircraft| ObservedAircraft {
                    id: c.id.clone(),
                    model_id: aircraft.model_id.clone(),
                    position: e.position,
                    heading: e.motion.heading,
                    pitch: e.motion.pitch,
                    roll: e.motion.roll,
                    velocity: e.motion.velocity,
                    observed_tick: c.last_observed_tick,
                    health: e.health,
                    controls: aircraft.controls,
                    wing_fold: aircraft.wing_fold,
                    payload: aircraft.payload,
                    observers: c.sources.iter().map(|s| s.observer_id.clone()).collect(),
                })
            })
            .collect();
        let mut tonnage: [Option<u64>; 2] = [None, None];
        tonnage[team.index()] = Some(crate::rules::afloat_kg(&self.survivors())[team.index()]);
        // Own vessels keep their live score sheet: damage dealt, ships sunk and a
        // hit log addressed through public contact IDs. Other teams' records and
        // the shell history stay private until the debrief.
        let scores: BTreeMap<String, VesselScore> = self
            .records
            .scores
            .iter()
            .filter(|(id, _)| own.contains(id.as_str()))
            .map(|(id, score)| {
                let log = score
                    .damage_log
                    .iter()
                    .filter_map(|entry| {
                        let mut entry = entry.clone();
                        entry.source_id = self.public_entity_id(&entry.source_id, team)?;
                        entry.target_id = self.public_entity_id(&entry.target_id, team)?;
                        Some(entry)
                    })
                    .collect();
                (
                    id.clone(),
                    VesselScore::addressed(
                        score.damage_dealt,
                        score.armor_blocked,
                        score.frags,
                        log,
                    ),
                )
            })
            .collect();
        // Full information belongs in the debrief, never in the active world.
        let debrief = self.outcome.is_some().then(|| {
            let mut debrief = self.full_frame(&[]);
            debrief.ship_outcomes = Some(
                self.actors
                    .iter()
                    .map(|actor| {
                        let status = if actor.physical_loss().is_some() {
                            ShipOutcome::Sunk
                        } else if crate::mission::permanently_incapable(
                            actor,
                            self.aviation.wing(&actor.motion.id),
                        ) {
                            ShipOutcome::Incapacitated
                        } else {
                            ShipOutcome::Operational
                        };
                        (actor.motion.id.clone(), status)
                    })
                    .collect(),
            );
            Box::new(debrief)
        });
        Ok(BattleFrame {
            tick: self.tick,
            actors: TeamActors(self, team, detail),
            wings,
            shells,
            torpedoes,
            depth_charges,
            releases,
            events: &self.team_events[team.index()],
            outcome: self.outcome.as_ref(),
            records: Records::addressed(scores),
            afloat_kg: tonnage,
            remaining_seconds: self.remaining_seconds(),
            view: Some(TeamView::Team),
            team: Some(team),
            mission_rules: self.mission_rules.as_ref(),
            contacts: Some(contacts),
            observed_ships: Some(observed_ships),
            observed_aircraft: Some(observed_aircraft),
            recon_coverage: Some(self.sensors.coverage(team)),
            ship_outcomes: None,
            debrief,
            mission: None,
        })
    }
}
